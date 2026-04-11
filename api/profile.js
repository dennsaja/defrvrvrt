const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB decoded (~6.7MB base64)
const MAX_BASE64_LEN = Math.ceil(MAX_IMAGE_SIZE * 1.37);

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

function s(str, max = 200) {
  if (str === null || str === undefined) return null;
  return String(str).replace(/\0/g, "").trim().substring(0, max);
}

function validateBase64Image(b64) {
  if (!b64 || typeof b64 !== "string") return false;
  if (!b64.startsWith("data:image/")) return false;
  if (b64.length > MAX_BASE64_LEN) return false;
  if (!b64.includes(",")) return false;
  const mime = b64.match(/^data:(image\/[a-z]+);base64,/)?.[1];
  return ["image/jpeg", "image/png", "image/webp"].includes(mime);
}

async function uploadImageToStorage(supabase, base64, supabaseUrl, prefix) {
  if (!validateBase64Image(base64)) return null;
  try {
    const mime = base64.match(/^data:(image\/[a-z]+);base64,/)[1];
    const ext = mime.split("/")[1];
    const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    const { error } = await supabase.storage
      .from("avatars")
      .upload(fileName, buffer, { contentType: mime, upsert: false });
    if (error) { console.warn(`${prefix} upload error:`, error.message); return null; }
    return `${supabaseUrl}/storage/v1/object/public/avatars/${fileName}`;
  } catch (e) {
    console.warn(`Upload ${prefix} gagal:`, e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  let decoded;
  try { decoded = verifyToken(req); }
  catch (err) { return res.status(401).json({ error: "Unauthorized" }); }

  // Admin tidak punya profil di DB
  if (decoded.role === "admin")
    return res.status(403).json({ error: "Admin tidak punya profil teknisi" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id,username,nama_lengkap,phone,email,foto_profil,foto_cover,created_at")
        .eq("id", decoded.id).single();
      if (error) return res.status(500).json({ error: "Gagal mengambil profil" });
      return res.status(200).json({ success: true, user: data });
    } catch (err) {
      return res.status(500).json({ error: "Internal error" });
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────
  if (req.method === "PUT") {
    try {
      const { username, nama_lengkap, phone, foto_profil, foto_cover } = req.body || {};
      const updates = {};

      // Validasi username
      if (username !== undefined && username !== null) {
        const cleanUser = s(username, 20);
        if (cleanUser !== decoded.username) {
          if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUser))
            return res.status(400).json({ error: "Username hanya boleh huruf, angka, underscore (3-20 karakter)" });
          const { data: exist } = await supabase
            .from("users").select("id").eq("username", cleanUser).single();
          if (exist) return res.status(400).json({ error: "Username sudah dipakai oleh orang lain" });
          updates.username = cleanUser;
        }
      }

      if (nama_lengkap !== undefined)
        updates.nama_lengkap = s(nama_lengkap, 100) || null;

      if (phone !== undefined && phone !== null && phone !== "") {
        const cleanPhone = s(phone, 15);
        if (!/^08\d{8,11}$/.test(cleanPhone))
          return res.status(400).json({ error: "Format HP: 08xxxxxxxxxx" });
        updates.phone = cleanPhone;
      }

      if (foto_profil && foto_profil.startsWith("data:image")) {
        if (!validateBase64Image(foto_profil))
          return res.status(400).json({ error: "Foto profil tidak valid atau terlalu besar (maks 5MB)" });
        const url = await uploadImageToStorage(supabase, foto_profil, process.env.SUPABASE_URL, "avatar");
        if (url) updates.foto_profil = url;
      }

      if (foto_cover && foto_cover.startsWith("data:image")) {
        if (!validateBase64Image(foto_cover))
          return res.status(400).json({ error: "Foto cover tidak valid atau terlalu besar (maks 5MB)" });
        const url = await uploadImageToStorage(supabase, foto_cover, process.env.SUPABASE_URL, "cover");
        if (url) updates.foto_cover = url;
      }

      if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: "Tidak ada data yang diubah" });

      // ✅ Sync laporan SEBELUM update username
      if (updates.username) {
        await supabase.from("laporan")
          .update({ teknisi: updates.username })
          .eq("teknisi", decoded.username);
        // Sync tugas juga
        await supabase.from("tugas")
          .update({ teknisi: updates.username })
          .eq("teknisi", decoded.username);
      }

      const { data, error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", decoded.id)
        .select("id,username,nama_lengkap,phone,email,foto_profil,foto_cover,created_at")
        .single();

      if (error) return res.status(500).json({ error: "Gagal menyimpan profil" });
      return res.status(200).json({ success: true, user: data });

    } catch (err) {
      console.error("PROFILE PUT error:", err.message);
      return res.status(500).json({ error: "Internal error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
