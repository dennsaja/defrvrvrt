const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

// Parse CSV dengan benar (handle quoted commas)
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || "").trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

function parseCSVLine(line) {
  const cols = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.replace(/^"|"$/g, "").trim()); cur = ""; }
    else { cur += ch; }
  }
  cols.push(cur.replace(/^"|"$/g, "").trim());
  return cols;
}

async function fetchFromSheets(csvUrl) {
  if (!csvUrl) return [];
  const res = await fetch(csvUrl + "&t=" + Date.now());
  const text = await res.text();
  return parseCSV(text);
}

// Kirim perintah edit/hapus ke Google Apps Script
async function sendToAppsScript(action, payload) {
  const gsUrl = process.env.GS_SCRIPT_URL;
  if (!gsUrl || gsUrl.includes("GANTI")) throw new Error("GS_SCRIPT_URL belum dikonfigurasi");
  const res = await fetch(gsUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { success: true, raw: text }; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    verifyAdmin(req);
  } catch (err) {
    return res.status(403).json({ error: "Akses ditolak. Hanya admin." });
  }

  // ── GET: ambil semua data dari Sheets ─────────────────────────────
  if (req.method === "GET") {
    try {
      const csvUrl = process.env.GS_URL;
      if (!csvUrl) return res.status(400).json({ error: "GS_URL belum dikonfigurasi" });
      const data = await fetchFromSheets(csvUrl);
      // Tambah field _rowIndex (nomor baris di sheet, mulai 2 karena baris 1 header)
      data.forEach((r, i) => { r._rowIndex = i + 2; });
      return res.status(200).json({ success: true, data, total: data.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT: edit laporan (kirim ke Apps Script) ───────────────────────
  if (req.method === "PUT") {
    try {
      const { rowIndex, data: rowData } = req.body || {};
      if (!rowIndex) return res.status(400).json({ error: "rowIndex wajib diisi" });
      const result = await sendToAppsScript("edit", { rowIndex, data: rowData });
      // Juga update di Supabase jika ada id
      if (rowData && rowData.id && process.env.SUPABASE_URL) {
        try {
          const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
          await supabase.from("laporan").update({
            jenis_kegiatan: rowData["Jenis Kegiatan"] || rowData.jenis_kegiatan,
            tanggal: rowData["Tanggal"] || rowData.tanggal,
            waktu: rowData["Waktu"] || rowData.waktu,
            nama_client: rowData["Nama Client"] || rowData.nama_client,
            catatan: rowData["Catatan"] || rowData.catatan,
          }).eq("id", rowData.id);
        } catch (e) { /* Supabase optional */ }
      }
      return res.status(200).json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: hapus laporan ──────────────────────────────────────────
  if (req.method === "DELETE") {
    try {
      const { rowIndex, id } = req.body || {};
      if (!rowIndex) return res.status(400).json({ error: "rowIndex wajib diisi" });
      const result = await sendToAppsScript("delete", { rowIndex });
      // Juga hapus di Supabase jika ada id
      if (id && process.env.SUPABASE_URL) {
        try {
          const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
          await supabase.from("laporan").delete().eq("id", id);
        } catch (e) { /* Supabase optional */ }
      }
      return res.status(200).json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
