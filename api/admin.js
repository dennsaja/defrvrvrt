const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

function parseCSVLine(line) {
  const cols = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.replace(/^"|"$/g, "").trim()); cur = ""; }
    else { cur += ch; }
  }
  cols.push(cur.replace(/^"|"$/g, "").trim());
  return cols;
}

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

async function fetchFromSheets(csvUrl) {
  if (!csvUrl) return [];
  const res = await fetch(csvUrl + "&t=" + Date.now());
  const text = await res.text();
  return parseCSV(text);
}

async function sendToAppsScript(action, payload) {
  const gsUrl = process.env.GS_SCRIPT_URL;
  if (!gsUrl || gsUrl.includes("GANTI")) throw new Error("GS_SCRIPT_URL belum dikonfigurasi");
  const res = await fetch(gsUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: true, raw: text }; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try { verifyAdmin(req); }
  catch (err) { return res.status(403).json({ error: "Akses ditolak. Hanya admin." }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ───────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const csvUrl = process.env.GS_URL;
      if (!csvUrl) return res.status(400).json({ error: "GS_URL belum dikonfigurasi" });
      const data = await fetchFromSheets(csvUrl);
      data.forEach((r, i) => { r._rowIndex = i + 2; });
      return res.status(200).json({ success: true, data, total: data.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT: edit di Sheets + Supabase ────────────────────────────────
  if (req.method === "PUT") {
    try {
      const { rowIndex, supabaseId, data: rowData } = req.body || {};
      if (!rowIndex) return res.status(400).json({ error: "rowIndex wajib diisi" });

      // Update di Google Sheets
      const result = await sendToAppsScript("edit", { rowIndex, data: rowData });

      // Sync ke Supabase — utamakan id langsung, fallback ke teknisi+tanggal+waktu
      try {
        const updatePayload = {
          jenis_kegiatan: rowData["Jenis Kegiatan"] || rowData.jenis_kegiatan,
          nama_client:    rowData["Nama Client"]    || rowData.nama_client,
          tempat:         rowData["Tempat"]         || rowData.tempat,
          estimasi:       rowData["Estimasi"]       || rowData.estimasi,
          catatan:        rowData["Catatan"]        || rowData.catatan,
        };

        if (supabaseId) {
          // Update langsung by primary key — paling akurat
          await supabase.from("laporan").update(updatePayload).eq("id", supabaseId);
        } else {
          // Fallback: cari by teknisi+tanggal+waktu
          const teknisi = rowData["Teknisi"] || rowData.teknisi;
          const tanggal = rowData["Tanggal"] || rowData.tanggal;
          const waktu   = (rowData["Waktu"] || rowData.waktu || "").substring(0, 5);
          const { data: existing } = await supabase.from("laporan")
            .select("id").eq("teknisi", teknisi).eq("tanggal", tanggal)
            .ilike("waktu", waktu + "%").limit(1);
          if (existing && existing.length > 0)
            await supabase.from("laporan").update(updatePayload).eq("id", existing[0].id);
        }
      } catch (e) { console.warn("Supabase sync skip:", e.message); }

      return res.status(200).json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: hapus di Sheets + Supabase ───────────────────────────
  if (req.method === "DELETE") {
    try {
      const { rowIndex, teknisi, tanggal, waktu } = req.body || {};
      if (!rowIndex) return res.status(400).json({ error: "rowIndex wajib diisi" });

      // Hapus di Google Sheets
      const result = await sendToAppsScript("delete", { rowIndex });

      // Hapus di Supabase by teknisi+tanggal+waktu
      try {
        if (teknisi && tanggal) {
          const w = (waktu || "").substring(0, 5);
          const { data: existing } = await supabase.from("laporan")
            .select("id").eq("teknisi", teknisi).eq("tanggal", tanggal)
            .ilike("waktu", w + "%").limit(1);
          if (existing && existing.length > 0)
            await supabase.from("laporan").delete().eq("id", existing[0].id);
        }
      } catch (e) { console.warn("Supabase delete skip:", e.message); }

      return res.status(200).json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
