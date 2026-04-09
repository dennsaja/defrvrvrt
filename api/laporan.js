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

    if (error) {
      console.warn("Storage upload error:", error.message);
      return null;
    }

    return supabaseUrl + "/storage/v1/object/public/laporan-foto/" + fileName;
  } catch (e) {
    console.warn("Upload foto gagal:", e.message);
    return null;
  }
}

async function kirimKeSheets(gsScriptUrl, payload) {
  if (!gsScriptUrl || gsScriptUrl.includes("pub?")) return; // skip jika URL CSV bukan Apps Script
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // ── GET: ambil laporan dari Supabase ──────────────────────────────
  if (req.method === "GET") {
    try {
      const decoded = verifyToken(req);
      const { data, error } = await supabase
        .from("laporan")
        .select("*")
        .eq("teknisi", decoded.username)
        .order("created_at", { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  // ── POST: simpan laporan baru ─────────────────────────────────────
  if (req.method === "POST") {
    try {
      const decoded = verifyToken(req);
      const { jenis_kegiatan, tanggal, waktu, nama_client, catatan, foto } = req.body || {};

      if (!jenis_kegiatan || !tanggal || !waktu || !catatan) {
        return res.status(400).json({ error: "Data tidak lengkap" });
      }

      // Upload foto ke Supabase Storage → dapat URL publik
      const fotoUrl = await uploadFotoToStorage(supabase, foto, process.env.SUPABASE_URL);

      // Simpan ke tabel laporan Supabase
      const { data, error } = await supabase
        .from("laporan")
        .insert([{
          teknisi: decoded.username,
          jenis_kegiatan,
          tanggal,
          waktu,
          nama_client: nama_client || "-",
          catatan,
          foto: fotoUrl || null   // simpan URL, bukan base64
        }])
        .select()
        .single();

      if (error) {
        console.error("SUPABASE INSERT ERROR:", error);
        return res.status(500).json({ error: "Gagal simpan ke database: " + error.message });
      }

      // Kirim ke Google Sheets via Apps Script (GS_SCRIPT_URL)
      // Berbeda dengan GS_URL yang hanya untuk baca CSV
      await kirimKeSheets(process.env.GS_SCRIPT_URL, {
        teknisi: decoded.username,
        hp: decoded.phone || "",
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client: nama_client || "-",
        catatan,
        foto_url: fotoUrl || "-"   // URL foto yang bisa dibuka
      });

      return res.status(200).json({ success: true, data, foto_url: fotoUrl });

    } catch (err) {
      console.error("LAPORAN POST ERROR:", err);
      if (err.name === "JsonWebTokenError") {
        return res.status(401).json({ error: "Token tidak valid, silakan login ulang" });
      }
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
