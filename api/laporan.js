const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Whitelist jenis kegiatan
const VALID_JENIS = ["Pemasangan Baru", "Perbaikan", "Pemeliharaan", "Instalasi CCTV"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Upload: konstanta
const MAX_BASE64_LEN = Math.ceil(10 * 1024 * 1024 * 1.37); // ~10MB
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], JWT_SECRET);
}

function s(str, max = 500) {
  if (str === null || str === undefined) return null;
  return String(str).replace(/\0/g, "").trim().substring(0, max);
}

function validateBase64Image(b64) {
  if (!b64 || typeof b64 !== "string") return false;
  if (!b64.startsWith("data:image/")) return false;
  if (b64.length > 14 * 1024 * 1024) return false;
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

// Generate Report ID: RPT-YYYYMMDD-XXXX (4 huruf random)
function generateReportId() {
  const now = new Date();
  const date = now.toISOString().split("T")[0].replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RPT-${date}-${rand}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── UPLOAD FOTO (dulunya /api/upload) ────────────────────────────
  // POST /api/laporan?action=upload
  if (req.method === "POST" && req.query.action === "upload") {
    try {
      verifyToken(req);

      const { base64 } = req.body || {};
      if (!base64 || typeof base64 !== "string")
        return res.status(400).json({ error: "base64 diperlukan" });

      if (base64.length > MAX_BASE64_LEN)
        return res.status(400).json({ error: "File terlalu besar (maks 10MB)" });

      if (!base64.startsWith("data:image/"))
        return res.status(400).json({ error: "Hanya file gambar yang diizinkan" });

      const mimeMatch = base64.match(/^data:(image\/[a-z]+);base64,/);
      if (!mimeMatch) return res.status(400).json({ error: "Format base64 tidak valid" });
      const mime = mimeMatch[1];
      if (!ALLOWED_MIMES.includes(mime))
        return res.status(400).json({ error: "Format gambar tidak didukung" });

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
  }

  // ── SUBMIT KE GOOGLE SHEETS (dulunya /api/submit) ────────────────
  // POST /api/laporan?action=submit
  if (req.method === "POST" && req.query.action === "submit") {
    try {
      verifyToken(req);

      if (!process.env.GS_URL) {
        return res.status(200).json({ success: true, note: "GS_URL tidak dikonfigurasi" });
      }

      await fetch(process.env.GS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(req.body)
      });

      return res.status(200).json({ success: true });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const decoded = verifyToken(req);
      const { range } = req.query || {};

      let query = supabase.from("laporan").select("*")
        .eq("teknisi", decoded.username)
        .order("created_at", { ascending: false });

      if (range === "today") {
        const today = new Date().toISOString().split("T")[0];
        query = query.eq("tanggal", today);
      } else if (range === "month") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        query = query.gte("tanggal", d.toISOString().split("T")[0]);
      }

      query = query.limit(500);
      const { data, error } = await query;
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
      const { jenis_kegiatan, tanggal, waktu, nama_client, tempat, estimasi, catatan, foto, foto_2, paket, pppoe } = req.body || {};

      if (!jenis_kegiatan || !tanggal || !waktu || !catatan)
        return res.status(400).json({ error: "Data tidak lengkap" });

      if (!VALID_JENIS.includes(jenis_kegiatan))
        return res.status(400).json({ error: "Jenis kegiatan tidak valid: " + jenis_kegiatan });

      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal))
        return res.status(400).json({ error: "Format tanggal tidak valid" });

      if (!/^\d{2}:\d{2}$/.test(waktu))
        return res.status(400).json({ error: "Format waktu tidak valid" });

      const fotoUrl  = await uploadFotoToStorage(supabase, foto,   process.env.SUPABASE_URL);
      const fotoUrl2 = foto_2 ? await uploadFotoToStorage(supabase, foto_2, process.env.SUPABASE_URL) : null;

      // Generate report_id unik
      let report_id = generateReportId();
      for (let i = 0; i < 3; i++) {
        const { data: existing } = await supabase.from("laporan").select("id").eq("report_id", report_id).limit(1);
        if (!existing || existing.length === 0) break;
        report_id = generateReportId();
      }

      const { data, error } = await supabase.from("laporan").insert([{
        teknisi:        decoded.username,
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client:    s(nama_client, 100) || "-",
        tempat:         s(tempat, 200)       || "-",
        estimasi:       s(estimasi, 50)      || "-",
        catatan:        s(catatan, 2000),
        foto:           fotoUrl  || null,
        foto_2:         fotoUrl2 || null,
        paket:          jenis_kegiatan === "Pemasangan Baru" ? (s(paket, 100) || null) : null,
        pppoe:          jenis_kegiatan === "Pemasangan Baru" ? (s(pppoe, 100) || null) : null,
        report_id,
      }]).select().single();

      if (error) return res.status(500).json({ error: "Gagal menyimpan laporan: " + error.message });

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
      const { id, jenis_kegiatan, tanggal, waktu, nama_client, tempat, estimasi, catatan, paket, pppoe } = req.body || {};

      if (!id) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      if (jenis_kegiatan && !VALID_JENIS.includes(jenis_kegiatan))
        return res.status(400).json({ error: "Jenis kegiatan tidak valid" });

      const { data: existing } = await supabase
        .from("laporan").select("id,teknisi").eq("id", id).single();
      if (!existing) return res.status(404).json({ error: "Laporan tidak ditemukan" });
      if (existing.teknisi !== decoded.username)
        return res.status(403).json({ error: "Akses ditolak" });

      const updateData = {
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client: s(nama_client, 100) || "-",
        tempat:      s(tempat, 200)       || "-",
        estimasi:    s(estimasi, 50)      || "-",
        catatan:     s(catatan, 2000),
      };
      if (jenis_kegiatan === "Pemasangan Baru") {
        updateData.paket = s(paket, 100) || null;
        updateData.pppoe = s(pppoe, 100) || null;
      }

      const { data, error } = await supabase.from("laporan").update(updateData).eq("id", id).select().single();

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
