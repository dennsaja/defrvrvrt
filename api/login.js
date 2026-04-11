const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// ── Rate limiter sederhana in-memory ─────────────────────────────────
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 menit

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const rec = loginAttempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + WINDOW_MS; }
  rec.count++;
  loginAttempts.set(key, rec);
  if (loginAttempts.size > 5000) {
    // Bersihkan entry lama agar tidak memory leak
    for (const [k, v] of loginAttempts)
      if (Date.now() > v.resetAt) loginAttempts.delete(k);
  }
  return rec.count > MAX_ATTEMPTS;
}

// Konstanta admin — password di-hash di env, BUKAN plaintext di kode
const ADMIN_USERNAME = "admin";

// Helper: timing-safe string compare untuk cegah timing attack
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method tidak diizinkan" });

  // Rate limit per IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;
  if (checkRateLimit(ip)) {
    return res.status(429).json({ message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit." });
  }

  try {
    const { username, password } = req.body || {};

    if (!username || !password)
      return res.status(400).json({ message: "Username dan password wajib diisi" });

    // Sanitasi input dasar
    if (typeof username !== "string" || typeof password !== "string")
      return res.status(400).json({ message: "Input tidak valid" });

    if (username.length > 50 || password.length > 200)
      return res.status(400).json({ message: "Input terlalu panjang" });

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET || JWT_SECRET === "dev-secret")
      console.warn("⚠️  JWT_SECRET tidak dikonfigurasi atau masih default!");

    // ── ADMIN LOGIN ────────────────────────────────────────────────
    if (username === ADMIN_USERNAME) {
      const adminPass = process.env.ADMIN_PASSWORD;
      if (!adminPass) return res.status(500).json({ message: "Admin belum dikonfigurasi" });

      // Gunakan bcrypt jika ADMIN_PASSWORD di-hash, atau timingSafeEqual jika plaintext
      const valid = adminPass.startsWith("$2")
        ? await bcrypt.compare(password, adminPass)
        : safeEqual(password, adminPass);

      if (!valid) return res.status(401).json({ message: "Password admin salah" });

      const token = jwt.sign(
        { id: "admin", username: "admin", role: "admin" },
        JWT_SECRET || "dev-secret",
        { expiresIn: "8h" } // lebih pendek untuk admin
      );
      return res.status(200).json({
        token,
        user: { id: "admin", username: "admin", role: "admin", created_at: new Date().toISOString() },
      });
    }

    // ── TEKNISI LOGIN ──────────────────────────────────────────────
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data, error } = await supabase
      .from("users")
      .select("id,username,password,phone,email,role,is_verified,nama_lengkap,foto_profil,foto_cover,created_at")
      .eq("username", username)
      .single();

    // Respons generik untuk cegah user enumeration
    if (error || !data) {
      await bcrypt.compare(password, "$2a$10$dummyhashtopreventtimingattack00000000000000000000000000");
      return res.status(401).json({ message: "Username atau password salah" });
    }

    const passwordValid = await bcrypt.compare(password, data.password);
    if (!passwordValid)
      return res.status(401).json({ message: "Username atau password salah" });

    if (!data.is_verified) {
      return res.status(403).json({
        message: "Akun belum terverifikasi. Cek email kamu dan klik link verifikasi.",
        not_verified: true,
        email: data.email,
      });
    }

    const token = jwt.sign(
      { id: data.id, username: data.username, role: data.role || "teknisi" },
      JWT_SECRET || "dev-secret",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      token,
      user: {
        id: data.id,
        username: data.username,
        phone: data.phone,
        email: data.email,
        role: data.role || "teknisi",
        nama_lengkap: data.nama_lengkap || null,
        foto_profil: data.foto_profil || null,
        foto_cover: data.foto_cover || null,
        created_at: data.created_at,
      },
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    return res.status(500).json({ message: "Internal error" }); // jangan expose err.message ke client
  }
};
