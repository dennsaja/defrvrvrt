const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

// Kredensial admin hardcoded (tidak perlu di DB)
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "d3n1s";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method tidak diizinkan" });

  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: "Username dan password wajib diisi" });
    }

    // ── ADMIN LOGIN (hardcoded, bypass DB) ──────────────────────────
    if (username === ADMIN_USERNAME) {
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Password admin salah" });
      }
      const token = jwt.sign(
        { id: "admin", username: "admin", role: "admin" },
        process.env.JWT_SECRET || "dev-secret",
        { expiresIn: "7d" }
      );
      return res.status(200).json({
        token,
        user: { id: "admin", username: "admin", role: "admin", created_at: new Date().toISOString() },
      });
    }

    // ── TEKNISI LOGIN ────────────────────────────────────────────────
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (error || !data) {
      return res.status(401).json({ message: "Username tidak ditemukan" });
    }

    const passwordValid = await bcrypt.compare(password, data.password);
    if (!passwordValid) {
      return res.status(401).json({ message: "Password salah" });
    }

    // Cek verifikasi email
    if (!data.is_verified) {
      return res.status(403).json({
        message: "Akun belum terverifikasi. Cek email kamu dan klik link verifikasi.",
        not_verified: true,
        email: data.email,
      });
    }

    const token = jwt.sign(
      { id: data.id, username: data.username, role: "teknisi" },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      token,
      user: {
        id: data.id,
        username: data.username,
        phone: data.phone,
        email: data.email,
        role: "teknisi",
        created_at: data.created_at,
      },
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: "Internal error", error: err.message });
  }
};
