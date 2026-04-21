const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

function s(str, max = 500) {
  if (!str && str !== 0) return null;
  return String(str).replace(/\0/g, "").trim().substring(0, max);
}

function validateBase64Image(b64) {
  if (!b64 || typeof b64 !== "string") return false;
  if (!b64.startsWith("data:image/")) return false;
  if (b64.length > 14 * 1024 * 1024) return false;
  if (!b64.includes(",")) return false;
  const mime = b64.match(/^data:(image\/[a-z]+);base64,/)?.[1];
  return ["image/jpeg","image/png","image/webp","image/gif"].includes(mime);
}

async function uploadFoto(supabase, base64, supabaseUrl, prefix = "brg") {
  if (!validateBase64Image(base64)) return null;
  try {
    const mime = base64.match(/^data:(image\/[a-z]+);base64,/)[1];
    const ext  = mime.split("/")[1] === "png" ? "png" : "jpg";
    const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    const { error } = await supabase.storage
      .from("laporan-foto")
      .upload(fileName, buffer, { contentType: mime, upsert: false });
    if (error) { console.warn("Barang foto upload error:", error.message); return null; }
    return `${supabaseUrl}/storage/v1/object/public/laporan-foto/${fileName}`;
  } catch (e) { console.warn("Upload barang gagal:", e.message); return null; }
}

// Generate ID khusus barang: BRG-YYYYMMDD-XXXX
function generateBarangId() {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BRG-${date}-${rand}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  let decoded;
  try { decoded = verifyToken(req); }
  catch { return res.status(401).json({ error: "Unauthorized" }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      let query = supabase.from("barang_laporan").select("*")
        .order("created_at", { ascending: false }).limit(500);
      // Teknisi hanya lihat miliknya, admin lihat semua
      if (decoded.role !== "admin") query = query.eq("teknisi", decoded.username);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: "Gagal mengambil data" });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(500).json({ error: "Internal error" });
    }
  }

  // ── POST: teknisi buat laporan barang ─────────────────────────
  if (req.method === "POST") {
    try {
      const { nama_barang, tanggal, keperluan, foto, foto_2 } = req.body || {};

      if (!nama_barang || !tanggal || !keperluan)
        return res.status(400).json({ error: "nama_barang, tanggal, dan keperluan wajib diisi" });

      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal))
        return res.status(400).json({ error: "Format tanggal tidak valid" });

      // Generate barang_id unik
      let barang_id = generateBarangId();
      for (let i = 0; i < 3; i++) {
        const { data: ex } = await supabase.from("barang_laporan")
          .select("id").eq("barang_id", barang_id).limit(1);
        if (!ex || ex.length === 0) break;
        barang_id = generateBarangId();
      }

      const fotoUrl  = foto   ? await uploadFoto(supabase, foto,   process.env.SUPABASE_URL, "brg") : null;
      const fotoUrl2 = foto_2 ? await uploadFoto(supabase, foto_2, process.env.SUPABASE_URL, "brg2") : null;

      const { data, error } = await supabase.from("barang_laporan").insert([{
        barang_id,
        teknisi:    decoded.username,
        nama_barang: s(nama_barang, 200),
        tanggal,
        keperluan:  s(keperluan, 1000),
        foto:       fotoUrl  || null,
        foto_2:     fotoUrl2 || null,
      }]).select().single();

      if (error) return res.status(500).json({ error: "Gagal menyimpan: " + error.message });
      return res.status(200).json({ success: true, data });
    } catch (err) {
      console.error("BARANG POST:", err.message);
      return res.status(500).json({ error: "Internal error" });
    }
  }

  // ── DELETE: admin hapus, atau teknisi hapus miliknya ──────────
  if (req.method === "DELETE") {
    try {
      const { id } = req.body || {};
      if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      const { data: existing } = await supabase.from("barang_laporan")
        .select("id,teknisi").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Data tidak ditemukan" });

      // Hanya admin atau pemilik yang bisa hapus
      if (decoded.role !== "admin" && existing.teknisi !== decoded.username)
        return res.status(403).json({ error: "Akses ditolak" });

      const { error } = await supabase.from("barang_laporan").delete().eq("id", id);
      if (error) return res.status(500).json({ error: "Gagal menghapus" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Internal error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
