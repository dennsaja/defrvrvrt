const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_JENIS = ["Pemasangan Baru", "Perbaikan", "Pemeliharaan"];

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

function s(str, max = 500) {
  if (str === null || str === undefined) return null;
  return String(str).replace(/\0/g, "").trim().substring(0, max);
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
  const res = await fetch(csvUrl + "&t=" + Date.now(), {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("Gagal fetch Sheets: " + res.status);
  const text = await res.text();
  return parseCSV(text);
}

async function sendToAppsScript(action, payload) {
  const gsUrl = process.env.GS_SCRIPT_URL;
  if (!gsUrl || gsUrl.includes("GANTI")) throw new Error("GS_SCRIPT_URL belum dikonfigurasi");
  const res = await fetch(gsUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: true, raw: text }; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try { verifyAdmin(req); }
  catch (err) { return res.status(403).json({ error: "Akses ditolak. Hanya admin." }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const csvUrl = process.env.GS_URL;
      if (!csvUrl) return res.status(400).json({ error: "GS_URL belum dikonfigurasi" });
      const data = await fetchFromSheets(csvUrl);
      data.forEach((r, i) => { r._rowIndex = i + 2; });
      return res.status(200).json({ success: true, data, total: data.length });
    } catch (err) {
      return res.status(500).json({ error: "Gagal mengambil data: " + err.message });
    }
  }

  // ── PUT: edit di Sheets + Supabase ───────────────────────────────
  if (req.method === "PUT") {
    try {
      const { rowIndex, supabaseId, data: rowData } = req.body || {};

      if (!rowIndex || typeof rowIndex !== "number" || rowIndex < 2)
        return res.status(400).json({ error: "rowIndex tidak valid" });

      if (supabaseId && !UUID_RE.test(supabaseId))
        return res.status(400).json({ error: "supabaseId tidak valid" });

      // Whitelist field yang boleh diedit
      const jenis = rowData?.["Jenis Kegiatan"] || rowData?.jenis_kegiatan;
      if (jenis && !VALID_JENIS.includes(jenis))
        return res.status(400).json({ error: "Jenis kegiatan tidak valid" });

      const result = await sendToAppsScript("edit", { rowIndex, data: rowData });

      // Sync ke Supabase
      try {
        const updatePayload = {
          ...(jenis && { jenis_kegiatan: jenis }),
          nama_client: s(rowData?.["Nama Client"] || rowData?.nama_client, 100),
          tempat:      s(rowData?.["Tempat"]      || rowData?.tempat, 200),
          estimasi:    s(rowData?.["Estimasi"]    || rowData?.estimasi, 50),
          catatan:     s(rowData?.["Catatan"]     || rowData?.catatan, 2000),
        };

        if (supabaseId) {
          await supabase.from("laporan").update(updatePayload).eq("id", supabaseId);
        } else {
          const teknisi = s(rowData?.["Teknisi"] || rowData?.teknisi, 50);
          const tanggal = rowData?.["Tanggal"] || rowData?.tanggal;
          const waktu   = (rowData?.["Waktu"]   || rowData?.waktu || "").substring(0, 5);
          if (teknisi && tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
            const { data: existing } = await supabase.from("laporan")
              .select("id").eq("teknisi", teknisi).eq("tanggal", tanggal)
              .ilike("waktu", waktu + "%").limit(1);
            if (existing?.length > 0)
              await supabase.from("laporan").update(updatePayload).eq("id", existing[0].id);
          }
        }
      } catch (e) { console.warn("Supabase sync skip:", e.message); }

      return res.status(200).json({ success: true, result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    try {
      const { rowIndex, teknisi, tanggal, waktu } = req.body || {};

      if (!rowIndex || typeof rowIndex !== "number" || rowIndex < 2)
        return res.status(400).json({ error: "rowIndex tidak valid" });

      const result = await sendToAppsScript("delete", { rowIndex });

      try {
        if (teknisi && tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
          const w = (waktu || "").substring(0, 5);
          const { data: existing } = await supabase.from("laporan")
            .select("id").eq("teknisi", s(teknisi, 50)).eq("tanggal", tanggal)
            .ilike("waktu", w + "%").limit(1);
          if (existing?.length > 0)
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
