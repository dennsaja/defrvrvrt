const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_JENIS = ["Pemasangan Baru", "Perbaikan", "Pemeliharaan", "Instalasi CCTV"];

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try { verifyAdmin(req); }
  catch (err) { return res.status(403).json({ error: "Akses ditolak. Hanya admin." }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // GET: ambil semua laporan dari Supabase
  if (req.method === "GET") {
    try {
      const { range } = req.query || {};
      let query = supabase.from("laporan").select("*").order("created_at", { ascending: false });

      if (range === "today") {
        const today = new Date().toISOString().split("T")[0];
        query = query.eq("tanggal", today);
      } else if (range === "month") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        query = query.gte("tanggal", d.toISOString().split("T")[0]);
      }

      query = query.limit(2000);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: "Gagal mengambil data: " + error.message });

      const normalized = (data || []).map(r => ({
        ...r,
        "Teknisi":        r.teknisi,
        "Jenis Kegiatan": r.jenis_kegiatan,
        "Tanggal":        r.tanggal,
        "Waktu":          r.waktu,
        "Nama Client":    r.nama_client,
        "Tempat":         r.tempat,
        "Estimasi":       r.estimasi,
        "Catatan":        r.catatan,
        "Foto":           r.foto,
        "Paket":          r.paket,
        "PPPoE":          r.pppoe,
        "Report ID":      r.report_id,
      }));

      return res.status(200).json({ success: true, data: normalized, total: normalized.length });
    } catch (err) {
      return res.status(500).json({ error: "Gagal mengambil data: " + err.message });
    }
  }

  // PUT: edit laporan di Supabase
  if (req.method === "PUT") {
    try {
      const { supabaseId, data: rowData } = req.body || {};

      if (!supabaseId) return res.status(400).json({ error: "supabaseId wajib diisi" });
      if (!UUID_RE.test(supabaseId)) return res.status(400).json({ error: "supabaseId tidak valid" });

      const jenis = rowData?.["Jenis Kegiatan"] || rowData?.jenis_kegiatan;
      if (jenis && !VALID_JENIS.includes(jenis))
        return res.status(400).json({ error: "Jenis kegiatan tidak valid" });

      const updatePayload = {};
      if (jenis) updatePayload.jenis_kegiatan = jenis;

      const pick = (a, b) => (a !== undefined ? a : b);
      const rv = rowData || {};

      if (pick(rv["Nama Client"], rv.nama_client) !== undefined)
        updatePayload.nama_client = s(pick(rv["Nama Client"], rv.nama_client), 100);
      if (pick(rv["Tempat"], rv.tempat) !== undefined)
        updatePayload.tempat = s(pick(rv["Tempat"], rv.tempat), 200);
      if (pick(rv["Estimasi"], rv.estimasi) !== undefined)
        updatePayload.estimasi = s(pick(rv["Estimasi"], rv.estimasi), 50);
      if (pick(rv["Catatan"], rv.catatan) !== undefined)
        updatePayload.catatan = s(pick(rv["Catatan"], rv.catatan), 2000);
      if (pick(rv["Tanggal"], rv.tanggal) !== undefined)
        updatePayload.tanggal = pick(rv["Tanggal"], rv.tanggal);
      if (pick(rv["Waktu"], rv.waktu) !== undefined)
        updatePayload.waktu = (pick(rv["Waktu"], rv.waktu) || "").substring(0, 5);
      if (pick(rv["Paket"], rv.paket) !== undefined)
        updatePayload.paket = s(pick(rv["Paket"], rv.paket), 100);
      if (pick(rv["PPPoE"], rv.pppoe) !== undefined)
        updatePayload.pppoe = s(pick(rv["PPPoE"], rv.pppoe), 100);

      if (Object.keys(updatePayload).length === 0)
        return res.status(400).json({ error: "Tidak ada field untuk diupdate" });

      const { data: updated, error } = await supabase
        .from("laporan").update(updatePayload).eq("id", supabaseId).select().single();

      if (error) return res.status(500).json({ error: "Gagal update laporan: " + error.message });

      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE: hapus laporan dari Supabase
  if (req.method === "DELETE") {
    try {
      const { supabaseId, id } = req.body || {};
      const targetId = supabaseId || id;

      if (!targetId) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(targetId)) return res.status(400).json({ error: "id tidak valid" });

      const { error } = await supabase.from("laporan").delete().eq("id", targetId);
      if (error) return res.status(500).json({ error: "Gagal menghapus laporan: " + error.message });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
