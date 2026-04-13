const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const { sendPushToUser, sendPushToRole } = require("./push");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_STATUS = ["pending", "proses", "selesai"];
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

async function uploadFotoToStorage(supabase, base64, supabaseUrl) {
  if (!base64 || !base64.includes(",")) return null;
  try {
    const ext = base64.startsWith("data:image/png") ? "png" : "jpg";
    const fileName = "tugas_" + Date.now() + "." + ext;
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    const { error } = await supabase.storage
      .from("laporan-foto")
      .upload(fileName, buffer, { contentType, upsert: false });
    if (error) { console.warn("Storage upload error:", error.message); return null; }
    return supabaseUrl + "/storage/v1/object/public/laporan-foto/" + fileName;
  } catch (e) {
    console.warn("Upload foto tugas gagal:", e.message);
    return null;
  }
}

const processingSelesai = new Set();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // GET
  if (req.method === "GET") {
    try {
      const decoded = verifyToken(req);

      if (decoded.role !== "admin") {
        // Ambil tugas milik teknisi ini + tugas broadcast yang belum selesai
        const [resMilik, resBroadcast] = await Promise.all([
          supabase.from("tugas").select("*")
            .eq("teknisi", decoded.username)
            .order("created_at", { ascending: false }).limit(200),
          supabase.from("tugas").select("*")
            .eq("is_broadcast", true)
            .not("status", "eq", "selesai")
            .order("created_at", { ascending: false }).limit(200)
        ]);

        const milik = resMilik.data || [];
        const milikIds = new Set(milik.map(m => m.id));
        const broadcast = (resBroadcast.data || []).filter(b => !milikIds.has(b.id));

        const merged = [...milik, ...broadcast].sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        );
        return res.status(200).json(merged);
      }

      // Admin: ambil semua
      const { data, error } = await supabase.from("tugas")
        .select("*").order("created_at", { ascending: false }).limit(200);
      if (error) return res.status(500).json({ error: "Gagal mengambil data" });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: "Token tidak valid" });
    }
  }

  // POST: admin buat tugas
  if (req.method === "POST") {
    try {
      verifyAdmin(req);
      const {
        teknisi,
        is_broadcast,
        jenis_kegiatan,
        nama_client,
        tempat,
        link_maps,
        barang,
        catatan,
        foto
      } = req.body || {};

      if (!jenis_kegiatan || !catatan)
        return res.status(400).json({ error: "jenis_kegiatan dan catatan wajib diisi" });

      const isBroadcast = is_broadcast === true || is_broadcast === "true";

      if (!isBroadcast && !teknisi)
        return res.status(400).json({ error: "Pilih teknisi atau aktifkan broadcast ke semua" });

      if (link_maps && typeof link_maps === "string" && link_maps.length > 0) {
        try { new URL(link_maps); } catch {
          return res.status(400).json({ error: "Format link maps tidak valid (harus URL)" });
        }
      }

      const fotoUrl = foto ? await uploadFotoToStorage(supabase, foto, process.env.SUPABASE_URL) : null;

      const payload = {
        teknisi:        isBroadcast ? "BROADCAST" : s(teknisi, 50),
        is_broadcast:   isBroadcast,
        jenis_kegiatan: s(jenis_kegiatan, 50),
        nama_client:    s(nama_client, 100) || "-",
        tempat:         s(tempat, 200) || "-",
        link_maps:      link_maps ? s(link_maps, 500) : null,
        barang:         s(barang, 500) || "-",
        catatan:        s(catatan, 2000),
        status:         "pending",
        foto:           fotoUrl || null,
      };

      const { data, error } = await supabase.from("tugas").insert([payload]).select().single();
      if (error) return res.status(500).json({ error: "Gagal menyimpan tugas: " + error.message });

      // Kirim push notification
      try {
        const pushPayload = {
          title: "Tugas Baru",
          body:  `${data.jenis_kegiatan}${data.tempat && data.tempat !== "-" ? " - " + data.tempat : ""}`,
          tag:   "tugas-baru",
          url:   "/",
          requireInteraction: true,
        };
        if (isBroadcast) {
          await sendPushToRole(supabase, "teknisi", pushPayload);
        } else {
          await sendPushToUser(supabase, data.teknisi, pushPayload);
        }
      } catch (pushErr) {
        console.warn("Push notif gagal:", pushErr.message);
      }

      return res.status(200).json({ success: true, data });
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }
  }

  // PUT
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
        const isMilik  = existing.teknisi === decoded.username;
        const isBcast  = existing.is_broadcast === true;
        if (!isMilik && !isBcast)
          return res.status(403).json({ error: "Bukan tugasmu" });
        if (!status) return res.status(400).json({ error: "Status wajib diisi" });
        if (!VALID_STATUS.includes(status))
          return res.status(400).json({ error: "Status tidak valid untuk teknisi" });
        updateData.status = status;
        if (status === "selesai" && isBcast) {
          updateData.diselesaikan_oleh = decoded.username;
        }
      }

      if (Object.keys(updateData).length === 0)
        return res.status(400).json({ error: "Tidak ada data untuk diupdate" });

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

        if (goingSelesai) {
          const penyelesai = updateData.diselesaikan_oleh || existing.teknisi;
          const { data: existingLap } = await supabase.from("laporan")
            .select("id").eq("tugas_id", id).limit(1);

          if (!existingLap || existingLap.length === 0) {
            const now = new Date();
            await supabase.from("laporan").insert([{
              teknisi:        penyelesai,
              jenis_kegiatan: data.jenis_kegiatan,
              tanggal:        now.toISOString().split("T")[0],
              waktu:          now.toTimeString().substring(0, 5),
              nama_client:    data.nama_client || "-",
              tempat:         data.tempat      || "-",
              estimasi:       "-",
              catatan:        data.catatan     || "-",
              foto:           data.foto        || null,
              sumber:         "tugas",
              tugas_id:       id,
            }]);
          }

          // Broadcast selesai: hapus dari tabel tugas (tidak perlu muncul lagi)
          if (data.is_broadcast) {
            await supabase.from("tugas").delete().eq("id", id);
            // Push ke admin: ada tugas broadcast yang selesai
            try {
              await sendPushToRole(supabase, "admin", {
                title: "Tugas Selesai",
                body:  `${data.jenis_kegiatan} diselesaikan oleh ${updateData.diselesaikan_oleh || existing.teknisi}`,
                tag:   "tugas-selesai-" + id,
                url:   "/",
              });
            } catch(e) { console.warn("Push admin gagal:", e.message); }
            return res.status(200).json({ success: true, data, broadcast_deleted: true });
          }
        }

        // Push ke admin jika tugas spesifik selesai
        if (goingSelesai && !data.is_broadcast) {
          try {
            await sendPushToRole(supabase, "admin", {
              title: "Tugas Selesai",
              body:  `${data.jenis_kegiatan} oleh ${existing.teknisi} telah selesai`,
              tag:   "tugas-selesai-" + id,
              url:   "/",
            });
          } catch(e) { console.warn("Push admin gagal:", e.message); }
        }

        return res.status(200).json({ success: true, data });
      } finally {
        if (goingSelesai) processingSelesai.delete(id);
      }
    } catch (err) {
      return res.status(err.message === "Bukan admin" ? 403 : 401).json({ error: err.message });
    }
  }

  // DELETE
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
