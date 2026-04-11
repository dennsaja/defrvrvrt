const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
}

function verifyAdmin(req) {
  const decoded = verifyToken(req);
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET: teknisi ambil tugas miliknya / admin ambil semua ─────────
  if (req.method === "GET") {
    try {
      const decoded = verifyToken(req);
      let query = supabase.from("tugas").select("*").order("created_at", { ascending: false });
      if (decoded.role !== "admin") {
        query = query.eq("teknisi", decoded.username);
      }
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  // ── POST: admin buat tugas baru ───────────────────────────────────
  if (req.method === "POST") {
    try {
      verifyAdmin(req);
      const { teknisi, jenis_kegiatan, nama_client, tempat, link_maps, barang, catatan } = req.body || {};

      if (!teknisi || !jenis_kegiatan || !catatan)
        return res.status(400).json({ error: "teknisi, jenis_kegiatan, dan catatan wajib diisi" });

      const { data, error } = await supabase.from("tugas").insert([{
        teknisi,
        jenis_kegiatan,
        nama_client: nama_client || "-",
        tempat: tempat || "-",
        link_maps: link_maps || null,
        barang: barang || "-",
        catatan,
        status: "pending"
      }]).select().single();

      if (error) return res.status(500).json({ error: "Gagal simpan: " + error.message });
      return res.status(200).json({ success: true, data });
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }
  }

  // ── PUT: teknisi update status tugas / admin edit tugas ───────────
  if (req.method === "PUT") {
    try {
      const decoded = verifyToken(req);
      const { id, status, jenis_kegiatan, nama_client, tempat, link_maps, barang, catatan } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });

      const { data: existing } = await supabase.from("tugas").select("*").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Tugas tidak ditemukan" });

      let updateData = {};
      if (decoded.role === "admin") {
        // Admin bisa edit semua field
        if (jenis_kegiatan !== undefined) updateData.jenis_kegiatan = jenis_kegiatan;
        if (nama_client !== undefined) updateData.nama_client = nama_client;
        if (tempat !== undefined) updateData.tempat = tempat;
        if (link_maps !== undefined) updateData.link_maps = link_maps;
        if (barang !== undefined) updateData.barang = barang;
        if (catatan !== undefined) updateData.catatan = catatan;
        if (status !== undefined) updateData.status = status;
      } else {
        // Teknisi hanya bisa update status miliknya
        if (existing.teknisi !== decoded.username)
          return res.status(403).json({ error: "Bukan tugasmu" });
        if (status) updateData.status = status;
      }

      const { data, error } = await supabase.from("tugas").update(updateData).eq("id", id).select().single();
      if (error) return res.status(500).json({ error: error.message });

      // Jika status berubah menjadi selesai, otomatis buat entri di laporan
      if (updateData.status === "selesai" && existing.status !== "selesai") {
        const now = new Date();
        const tanggal = now.toISOString().split("T")[0];
        const waktu   = now.toTimeString().substring(0, 5);
        await supabase.from("laporan").insert([{
          teknisi:       data.teknisi,
          jenis_kegiatan: data.jenis_kegiatan,
          tanggal,
          waktu,
          nama_client:   data.nama_client || "-",
          tempat:        data.tempat      || "-",
          estimasi:      "-",
          catatan:       data.catatan     || "-",
          foto:          null,
          sumber:        "tugas"          // penanda asal dari tugas admin
        }]);
      }

      return res.status(200).json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: admin hapus tugas ─────────────────────────────────────
  if (req.method === "DELETE") {
    try {
      verifyAdmin(req);
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });

      const { error } = await supabase.from("tugas").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
