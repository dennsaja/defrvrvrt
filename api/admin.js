const jwt = require("jsonwebtoken");

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

// Ambil seluruh data dari Google Sheets CSV publik
async function fetchFromSheets(csvUrl) {
  if (!csvUrl) return [];
  
  const res = await fetch(csvUrl + "&t=" + Date.now()); // cache busting
  const text = await res.text();
  
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  
  return lines.slice(1).map(line => {
    // Handle CSV dengan koma di dalam quotes
    const cols = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || "").replace(/^"|"$/g, ""); });
    return row;
  }).filter(r => Object.values(r).some(v => v)); // buang baris kosong
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method tidak diizinkan" });

  try {
    verifyAdmin(req);

    const csvUrl = process.env.GS_URL;
    if (!csvUrl) return res.status(400).json({ error: "GS_URL belum dikonfigurasi di environment" });

    const data = await fetchFromSheets(csvUrl);
    return res.status(200).json({ success: true, data, total: data.length });

  } catch (err) {
    if (err.message === "Bukan admin" || err.message === "Unauthorized") {
      return res.status(403).json({ error: "Akses ditolak. Hanya admin." });
    }
    console.error("ADMIN ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
};
