const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  try {
    const { username, phone, password } = req.body || {};

    if (!username || !phone || !password) {
      return res.status(400).json({ error: "Semua field wajib diisi" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const { error } = await supabase
      .from("users")
      .insert([{ username, phone, password: hashed }]);

    if (error) {
      if (error.code === "23505") {
        return res.status(400).json({ error: "Username sudah digunakan" });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
};
