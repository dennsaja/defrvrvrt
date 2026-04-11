const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const MAX_BASE64_LEN = Math.ceil(10 * 1024 * 1024 * 1.37); // ~10MB
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  try {
    verifyToken(req);

    const { base64 } = req.body || {};
    if (!base64 || typeof base64 !== "string")
      return res.status(400).json({ error: "base64 diperlukan" });

    // Validasi ukuran
    if (base64.length > MAX_BASE64_LEN)
      return res.status(400).json({ error: "File terlalu besar (maks 10MB)" });

    // Validasi MIME type dari header base64
    if (!base64.startsWith("data:image/"))
      return res.status(400).json({ error: "Hanya file gambar yang diizinkan" });

    const mimeMatch = base64.match(/^data:(image\/[a-z]+);base64,/);
    if (!mimeMatch) return res.status(400).json({ error: "Format base64 tidak valid" });
    const mime = mimeMatch[1];
    if (!ALLOWED_MIMES.includes(mime))
      return res.status(400).json({ error: "Format gambar tidak didukung" });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const ext = mime.split("/")[1];
    const fileName = `laporan_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer = Buffer.from(base64.split(",")[1], "base64");

    const { error } = await supabase.storage
      .from("laporan")
      .upload(fileName, buffer, { contentType: mime, upsert: false });

    if (error) return res.status(500).json({ error: "Gagal upload: " + error.message });

    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/laporan/${fileName}`;
    return res.status(200).json({ url });

  } catch (err) {
    if (err.name === "JsonWebTokenError")
      return res.status(401).json({ error: "Token tidak valid" });
    return res.status(500).json({ error: "Internal error" });
  }
};
