const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Nilai yang diizinkan untuk jenis_kegiatan
const VALID_JENIS = ["Pemasangan Baru", "Perbaikan", "Pemeliharaan"];

// Validasi UUID v4
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

// Sanitasi string: batasi panjang, hilangkan null bytes
function s(str, max = 500) {
  if (str === null || str === undefined) return null;
  return String(str).replace(/\0/g, "").trim().substring(0, max);
}

// Validasi base64 image: cek ukuran maks ~10MB (base64 ~13.3MB string)
function validateBase64Image(b64) {
  if (!b64 || typeof b64 !== "string") return false;
  if (!b64.startsWith("data:image/")) return false;
  if (b64.length > 14 * 1024 * 1024) return false; // ~10MB decoded
  if (!b64.includes(",")) return false;
  return true;
}

async function uploadFotoToStorage(supabase, base64, supabaseUrl) {
  if (!validateBase64Image(base64)) return null;
  try {
    const mimeMatch = base64.match(/^data:(image\/[a-z]+);base64,/);
    if (!mimeMatch) return null;
    const mime = mimeMatch[1];
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedMimes.includes(mime)) return null;

    const ext = mime.split("/")[1];
    const fileName = `foto_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer = Buffer.from(base64.split(",")[1], "base64");

    const { error } = await supabase.storage
      .from("laporan-foto")
      .upload(fileName, buffer, { contentType: mime, upsert: false });
    if (error) { console.warn("Storage upload error:", error.message); return null; }
    return `${supabaseUrl}/storage/v1/object/public/laporan-foto/${fileName}`;
  } catch (e) {
    console.warn("Upload foto gagal:", e.message);
    return null;
  }
}

async function kirimKeSheets(gsScriptUrl, payload) {
  if (!gsScriptUrl || gsScriptUrl.includes("GANTI")) return;
  try {
    await fetch(gsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // timeout 10 detik
    });
  } catch (e) {
    console.warn("Gagal kirim ke Sheets:", e.message);
  }
}

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
      const { data, error } = await supabase
        .from("laporan").select("*")
        .eq("teknisi", decoded.username)
        .order("created_at", { ascending: false })
        .limit(500); // batas maks baca
      if (error) return res.status(500).json({ error: "Gagal mengambil data" });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: "Token tidak valid" });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const decoded = verifyToken(req);
      const { jenis_kegiatan, tanggal, waktu, nama_client, tempat, estimasi, catatan, foto } = req.body || {};

      // Validasi wajib
      if (!jenis_kegiatan || !tanggal || !waktu || !catatan)
        return res.status(400).json({ error: "Data tidak lengkap" });

      // Whitelist jenis kegiatan
      if (!VALID_JENIS.includes(jenis_kegiatan))
        return res.status(400).json({ error: "Jenis kegiatan tidak valid" });

      // Validasi format tanggal YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal))
        return res.status(400).json({ error: "Format tanggal tidak valid" });

      // Validasi format waktu HH:MM
      if (!/^\d{2}:\d{2}$/.test(waktu))
        return res.status(400).json({ error: "Format waktu tidak valid" });

      const fotoUrl = await uploadFotoToStorage(supabase, foto, process.env.SUPABASE_URL);

      const { data, error } = await supabase.from("laporan").insert([{
        teknisi:       decoded.username,
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client:   s(nama_client, 100) || "-",
        tempat:        s(tempat, 200)       || "-",
        estimasi:      s(estimasi, 50)      || "-",
        catatan:       s(catatan, 2000),
        foto:          fotoUrl || null,
      }]).select().single();

      if (error) return res.status(500).json({ error: "Gagal menyimpan laporan" });

      await kirimKeSheets(process.env.GS_SCRIPT_URL, {
        teknisi: decoded.username,
        hp: "", // hp tidak ada di token, ambil dari profile jika butuh
        jenis_kegiatan, tanggal, waktu,
        nama_client: s(nama_client, 100) || "-",
        tempat: s(tempat, 200) || "-",
        estimasi: s(estimasi, 50) || "-",
        catatan: s(catatan, 2000),
        foto_url: fotoUrl || "-",
      });

      return res.status(200).json({ success: true, data, foto_url: fotoUrl });
    } catch (err) {
      if (err.name === "JsonWebTokenError")
        return res.status(401).json({ error: "Token tidak valid, silakan login ulang" });
      console.error("POST laporan error:", err.message);
      return res.status(500).json({ error: "Internal error" });
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────
  if (req.method === "PUT") {
    try {
      const decoded = verifyToken(req);
      const { id, jenis_kegiatan, tanggal, waktu, nama_client, tempat, estimasi, catatan } = req.body || {};

      if (!id) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      if (jenis_kegiatan && !VALID_JENIS.includes(jenis_kegiatan))
        return res.status(400).json({ error: "Jenis kegiatan tidak valid" });

      const { data: existing } = await supabase
        .from("laporan").select("id,teknisi").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Laporan tidak ditemukan" });
      if (existing.teknisi !== decoded.username)
        return res.status(403).json({ error: "Akses ditolak" });

      const { data, error } = await supabase.from("laporan").update({
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client: s(nama_client, 100) || "-",
        tempat:      s(tempat, 200)       || "-",
        estimasi:    s(estimasi, 50)      || "-",
        catatan:     s(catatan, 2000),
      }).eq("id", id).select().single();

      if (error) return res.status(500).json({ error: "Gagal update laporan" });
      return res.status(200).json({ success: true, data });
    } catch (err) {
      return res.status(401).json({ error: "Token tidak valid" });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    try {
      const decoded = verifyToken(req);
      const { id } = req.body || {};

      if (!id) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      const { data: existing } = await supabase
        .from("laporan").select("id,teknisi").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Laporan tidak ditemukan" });
      if (existing.teknisi !== decoded.username)
        return res.status(403).json({ error: "Akses ditolak" });

      const { error } = await supabase.from("laporan").delete().eq("id", id);
      if (error) return res.status(500).json({ error: "Gagal menghapus laporan" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(401).json({ error: "Token tidak valid" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
