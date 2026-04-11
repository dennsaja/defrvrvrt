const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try { verifyAdmin(req); }
  catch (err) { return res.status(403).json({ error: "Akses ditolak. Hanya admin." }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET: ambil semua user ─────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
         .from("users")
         .select("id, username, nama_lengkap, email, phone, role, foto_profil, created_at")
         .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── DELETE: hapus akun + semua laporannya ────────────────────────
  if (req.method === "DELETE") {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });

      // Jangan hapus akun admin
      const { data: target } = await supabase
        .from("users").select("role, username").eq("id", id).single();
      if (!target) return res.status(404).json({ error: "Akun tidak ditemukan" });
      if (target.role === "admin") return res.status(403).json({ error: "Tidak bisa hapus akun admin" });

      // Hapus laporan milik user ini
      await supabase.from("laporan").delete().eq("teknisi", target.username);

      // Hapus tugas milik user ini
      await supabase.from("tugas").delete().eq("teknisi", target.username);

      // Hapus akun
      const { error } = await supabase.from("users").delete().eq("id", id);
      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
