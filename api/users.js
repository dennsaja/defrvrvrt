const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function verifyAdmin(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
  if (decoded.role !== "admin") throw new Error("Bukan admin");
  return decoded;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try { verifyAdmin(req); }
  catch (err) { return res.status(403).json({ error: "Akses ditolak. Hanya admin." }); }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET ─────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      // ✅ Tidak expose password hash, verify_token, dsb.
      const { data, error } = await supabase
        .from("users")
        .select("id,username,nama_lengkap,email,phone,role,is_verified,foto_profil,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return res.status(500).json({ error: "Gagal mengambil data users" });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(500).json({ error: "Internal error" });
    }
  }

  // ── DELETE: hapus akun teknisi ───────────────────────────────────
  if (req.method === "DELETE") {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id wajib diisi" });
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "id tidak valid" });

      const { data: target } = await supabase
        .from("users").select("role,username").eq("id", id).single();
      if (!target) return res.status(404).json({ error: "Akun tidak ditemukan" });
      if (target.role === "admin") return res.status(403).json({ error: "Tidak bisa hapus akun admin" });

      // Hapus data terkait dulu (cascade manual)
      await supabase.from("laporan").delete().eq("teknisi", target.username);
      await supabase.from("tugas").delete().eq("teknisi", target.username);

      const { error } = await supabase.from("users").delete().eq("id", id);
      if (error) return res.status(500).json({ error: "Gagal menghapus akun" });

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Internal error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
