const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Status yang diizinkan untuk teknisi
const VALID_STATUS = ["pending", "proses", "selesai"];
// Status yang hanya bisa diset admin
const ADMIN_ONLY_STATUS = ["dibatalkan", "ditunda"];
const ALL_VALID_STATUS = [...VALID_STATUS, ...ADMIN_ONLY_STATUS];

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

function verifyAdmin(req) {
  const decoded = verifyToken(req);
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

function s(str, max = 500) {
  if (str === null || str === undefined) return null;
  return String(str).replace(/\0/g, "").trim().substring(0, max);
}

// Set untuk cegah race condition double-selesai → double laporan insert
const processingSelesai = new Set();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const decoded = verifyToken(req);
      let query = supabase.from("tugas").select("*").order("created_at", { ascending: false }).limit(200);
      if (decoded.role !== "admin") query = query.eq("teknisi", decoded.username);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: "Gagal mengambil data" });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: "Token tidak valid" });
    }
  }

  // ── POST: admin buat tugas baru ──────────────────────────────────
  if (req.method === "POST") {
    try {
      verifyAdmin(req);
      const { teknisi, jenis_kegiatan, nama_client, tempat, link_maps, barang, catatan } = req.body || {};

      if (!teknisi || !jenis_kegiatan || !catatan)
        return res.status(400).json({ error: "teknisi, jenis_kegiatan, dan catatan wajib diisi" });

      // Validasi link_maps jika ada
      if (link_maps && typeof link_maps === "string" && link_maps.length > 0) {
        try { new URL(link_maps); } catch {
          return res.status(400).json({ error: "Format link maps tidak valid (harus URL)" });
        }
      }

      const { data, error } = await supabase.from("tugas").insert([{
        teknisi:       s(teknisi, 50),
        jenis_kegiatan: s(jenis_kegiatan, 50),
        nama_client:   s(nama_client, 100) || "-",
        tempat:        s(tempat, 200) || "-",
        link_maps:     link_maps ? s(link_maps, 500) : null,
        barang:        s(barang, 500) || "-",
        catatan:       s(catatan, 2000),
        status:        "pending",
      }]).select().single();

      if (error) return res.status(500).json({ error: "Gagal menyimpan tugas" });
      return res.status(200).json({ success: true, data });
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────
  if (req.method === "PUT") {
    try {
      const decoded = verifyToken(req);
      const { id, status, jenis_kegiatan, nama_client, tempat, link_maps, barang, catatan } = req.body || {};

      if (!id) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      const { data: existing } = await supabase.from("tugas").select("*").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Tugas tidak ditemukan" });

      let updateData = {};

      if (decoded.role === "admin") {
        if (jenis_kegiatan !== undefined) updateData.jenis_kegiatan = s(jenis_kegiatan, 50);
        if (nama_client !== undefined)    updateData.nama_client    = s(nama_client, 100);
        if (tempat !== undefined)         updateData.tempat         = s(tempat, 200);
        if (link_maps !== undefined) {
          if (link_maps && link_maps.length > 0) {
            try { new URL(link_maps); updateData.link_maps = s(link_maps, 500); }
            catch { return res.status(400).json({ error: "Format link maps tidak valid" }); }
          } else { updateData.link_maps = null; }
        }
        if (barang !== undefined)  updateData.barang  = s(barang, 500);
        if (catatan !== undefined) updateData.catatan = s(catatan, 2000);
        if (status !== undefined) {
          if (!ALL_VALID_STATUS.includes(status))
            return res.status(400).json({ error: "Status tidak valid" });
          updateData.status = status;
        }
      } else {
        // Teknisi hanya bisa update status miliknya ke status yang diizinkan
        if (existing.teknisi !== decoded.username)
          return res.status(403).json({ error: "Bukan tugasmu" });
        if (!status) return res.status(400).json({ error: "Status wajib diisi" });
        if (!VALID_STATUS.includes(status))
          return res.status(400).json({ error: "Status tidak valid untuk teknisi" });
        updateData.status = status;
      }

      if (Object.keys(updateData).length === 0)
        return res.status(400).json({ error: "Tidak ada data untuk diupdate" });

      // ✅ Cegah race condition double insert laporan saat selesai
      const goingSelesai = updateData.status === "selesai" && existing.status !== "selesai";
      if (goingSelesai) {
        if (processingSelesai.has(id))
          return res.status(409).json({ error: "Permintaan sedang diproses, tunggu sebentar" });
        processingSelesai.add(id);
      }

      try {
        const { data, error } = await supabase.from("tugas")
          .update(updateData).eq("id", id).select().single();
        if (error) return res.status(500).json({ error: "Gagal update tugas" });

        // Auto-insert laporan saat status berubah ke selesai (hanya sekali)
        if (goingSelesai) {
          // Cek dulu apakah laporan dari tugas ini sudah ada
          const { data: existingLap } = await supabase.from("laporan")
            .select("id").eq("tugas_id", id).limit(1);

          if (!existingLap || existingLap.length === 0) {
            const now = new Date();
            await supabase.from("laporan").insert([{
              teknisi:        data.teknisi,
              jenis_kegiatan: data.jenis_kegiatan,
              tanggal:        now.toISOString().split("T")[0],
              waktu:          now.toTimeString().substring(0, 5),
              nama_client:    data.nama_client || "-",
              tempat:         data.tempat      || "-",
              estimasi:       "-",
              catatan:        data.catatan     || "-",
              foto:           null,
              sumber:         "tugas",
              tugas_id:       id, // ← foreign key untuk cegah duplikat
            }]);
          }
        }

        return res.status(200).json({ success: true, data });
      } finally {
        if (goingSelesai) processingSelesai.delete(id);
      }
    } catch (err) {
      return res.status(err.message === "Bukan admin" ? 403 : 401).json({ error: err.message });
    }
  }

  // ── DELETE: admin hapus tugas ────────────────────────────────────
  if (req.method === "DELETE") {
    try {
      verifyAdmin(req);
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      const { error } = await supabase.from("tugas").delete().eq("id", id);
      if (error) return res.status(500).json({ error: "Gagal menghapus tugas" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
