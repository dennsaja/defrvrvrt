const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
}

async function uploadAvatarToStorage(supabase, base64, supabaseUrl) {
  if (!base64 || !base64.includes(",")) return null;
  try {
    const ext = base64.startsWith("data:image/png") ? "png" : "jpg";
    const fileName = "avatar_" + Date.now() + "." + ext;
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    const { error } = await supabase.storage
      .from("avatars")
      .upload(fileName, buffer, { contentType, upsert: false });
    if (error) { console.warn("Avatar upload error:", error.message); return null; }
    return supabaseUrl + "/storage/v1/object/public/avatars/" + fileName;
  } catch (e) {
    console.warn("Upload avatar gagal:", e.message);
    return null;
  }
}

async function uploadCoverToStorage(supabase, base64, supabaseUrl) {
  if (!base64 || !base64.includes(",")) return null;
  try {
    const ext = base64.startsWith("data:image/png") ? "png" : "jpg";
    const fileName = "cover_" + Date.now() + "." + ext;
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    const { error } = await supabase.storage
      .from("avatars")
      .upload(fileName, buffer, { contentType, upsert: false });
    if (error) { console.warn("Cover upload error:", error.message); return null; }
    return supabaseUrl + "/storage/v1/object/public/avatars/" + fileName;
  } catch (e) {
    console.warn("Upload cover gagal:", e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  let decoded;
  try { decoded = verifyToken(req); }
  catch (err) { return res.status(401).json({ error: "Unauthorized" }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET: ambil profil terkini ─────────────────────────────────────
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id,username,nama_lengkap,phone,email,foto_profil,foto_cover,created_at")
        .eq("id", decoded.id).single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, user: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT: update profil ────────────────────────────────────────────
  if (req.method === "PUT") {
    try {
      const { username, nama_lengkap, phone, foto_profil, foto_cover } = req.body || {};
      const updates = {};

      // Validasi & tandai username baru jika diubah
      if (username && username !== decoded.username) {
        const { data: exist } = await supabase
          .from("users").select("id").eq("username", username).single();
        if (exist) return res.status(400).json({ error: "Username sudah dipakai oleh orang lain" });
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
          return res.status(400).json({ error: "Username hanya boleh huruf, angka, underscore, 3-20 karakter" });
        updates.username = username;
      }
      if (nama_lengkap !== undefined) updates.nama_lengkap = nama_lengkap;
      if (phone) {
        if (!/^08\d{8,11}$/.test(phone))
          return res.status(400).json({ error: "Format HP: 08xxxxxxxxxx" });
        updates.phone = phone;
      }

      // Upload foto profil jika ada
      if (foto_profil && foto_profil.startsWith("data:image")) {
        const url = await uploadAvatarToStorage(supabase, foto_profil, process.env.SUPABASE_URL);
        if (url) updates.foto_profil = url;
      }

      // Upload foto cover jika ada
      if (foto_cover && foto_cover.startsWith("data:image")) {
        const url = await uploadCoverToStorage(supabase, foto_cover, process.env.SUPABASE_URL);
        if (url) updates.foto_cover = url;
      }

      if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: "Tidak ada data yang diubah" });

      // ✅ FIX: Jika username berubah, update semua laporan lama DULU
      // sebelum update users — agar referensi username lama (decoded.username) masih valid
      if (updates.username) {
        const { error: laporanError } = await supabase
          .from("laporan")
          .update({ teknisi: updates.username })
          .eq("teknisi", decoded.username);
        if (laporanError) {
          console.warn("Gagal sync laporan:", laporanError.message);
          // Lanjut saja, jangan gagalkan seluruh request
        }
      }

      // Update tabel users
      const { data, error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", decoded.id)
        .select("id,username,nama_lengkap,phone,email,foto_profil,foto_cover,created_at")
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, user: data });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
