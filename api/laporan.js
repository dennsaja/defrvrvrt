const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
}

async function uploadFotoToStorage(supabase, base64, supabaseUrl) {
  if (!base64 || !base64.includes(",")) return null;
  try {
    const ext = base64.startsWith("data:image/png") ? "png" : "jpg";
    const fileName = "foto_" + Date.now() + "." + ext;
    const buffer = Buffer.from(base64.split(",")[1], "base64");
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    const { error } = await supabase.storage
      .from("laporan-foto")
      .upload(fileName, buffer, { contentType, upsert: false });
    if (error) { console.warn("Storage upload error:", error.message); return null; }
    return supabaseUrl + "/storage/v1/object/public/laporan-foto/" + fileName;
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
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("Gagal kirim ke Sheets:", e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ───────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const decoded = verifyToken(req);
      const { data, error } = await supabase
        .from("laporan").select("*")
        .eq("teknisi", decoded.username)
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  // ── POST: buat laporan baru ───────────────────────────────────────
  if (req.method === "POST") {
    try {
      const decoded = verifyToken(req);
      const { jenis_kegiatan, tanggal, waktu, nama_client, tempat, estimasi, catatan, foto } = req.body || {};

      if (!jenis_kegiatan || !tanggal || !waktu || !catatan)
        return res.status(400).json({ error: "Data tidak lengkap" });

      const fotoUrl = await uploadFotoToStorage(supabase, foto, process.env.SUPABASE_URL);

      const { data, error } = await supabase.from("laporan").insert([{
        teknisi: decoded.username,
        jenis_kegiatan, tanggal, waktu,
        nama_client: nama_client || "-",
        tempat: tempat || "-",
        estimasi: estimasi || "-",
        catatan,
        foto: fotoUrl || null
      }]).select().single();

      if (error) return res.status(500).json({ error: "Gagal simpan: " + error.message });

      await kirimKeSheets(process.env.GS_SCRIPT_URL, {
        teknisi: decoded.username,
        hp: decoded.phone || "",
        jenis_kegiatan, tanggal, waktu,
        nama_client: nama_client || "-",
        tempat: tempat || "-",
        estimasi: estimasi || "-",
        catatan,
        foto_url: fotoUrl || "-"
      });

      return res.status(200).json({ success: true, data, foto_url: fotoUrl });
    } catch (err) {
      if (err.name === "JsonWebTokenError")
        return res.status(401).json({ error: "Token tidak valid, silakan login ulang" });
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT: edit laporan milik teknisi sendiri ───────────────────────
  if (req.method === "PUT") {
    try {
      const decoded = verifyToken(req);
      const { id, jenis_kegiatan, tanggal, waktu, nama_client, tempat, estimasi, catatan } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });

      // Pastikan laporan milik teknisi ini
      const { data: existing } = await supabase
        .from("laporan").select("id,teknisi").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Laporan tidak ditemukan" });
      if (existing.teknisi !== decoded.username)
        return res.status(403).json({ error: "Bukan laporan kamu" });

      const { data, error } = await supabase.from("laporan").update({
        jenis_kegiatan, tanggal, waktu,
        nama_client: nama_client || "-",
        tempat: tempat || "-",
        estimasi: estimasi || "-",
        catatan
      }).eq("id", id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: hapus laporan milik teknisi sendiri ───────────────────
  if (req.method === "DELETE") {
    try {
      const decoded = verifyToken(req);
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });

      const { data: existing } = await supabase
        .from("laporan").select("id,teknisi").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Laporan tidak ditemukan" });
      if (existing.teknisi !== decoded.username)
        return res.status(403).json({ error: "Bukan laporan kamu" });

      const { error } = await supabase.from("laporan").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
