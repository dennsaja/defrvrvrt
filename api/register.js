const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Rate limit pendaftaran per IP
const registerAttempts = new Map();
function checkRegisterLimit(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const rec = registerAttempts.get(key) || { count: 0, resetAt: now + 60 * 60 * 1000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60 * 60 * 1000; }
  rec.count++;
  registerAttempts.set(key, rec);
  return rec.count > 10; // maks 10 daftar per IP per jam
}

async function sendVerificationEmail(email, username, token) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  const baseUrl = process.env.APP_URL || "https://your-app.vercel.app";
  const verifyUrl = `${baseUrl}/api/verify?token=${token}`;

  await transporter.sendMail({
    from: `"TechConnect" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "✅ Verifikasi Akun TechConnect Anda",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#f9f9f9;border-radius:12px;">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="background:#f72e2e;display:inline-block;padding:12px 20px;border-radius:10px;color:#fff;font-size:22px;font-weight:700;">📡 TechConnect</div>
        </div>
        <h2 style="color:#0A1628;margin-bottom:8px;">Halo, ${username}! 👋</h2>
        <p style="color:#4A5568;margin-bottom:20px;">Terima kasih telah mendaftar. Klik tombol di bawah untuk mengaktifkan akun Anda:</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${verifyUrl}" style="background:#f72e2e;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
            ✅ Verifikasi Akun Saya
          </a>
        </div>
        <p style="color:#8896A6;font-size:12px;text-align:center;">Link ini berlaku selama <strong>24 jam</strong>. Jika kamu tidak mendaftar, abaikan email ini.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="color:#8896A6;font-size:11px;text-align:center;">© TechConnect – Sistem Manajemen Teknisi</p>
      </div>
    `,
  });
}

// Sanitasi string — hapus karakter berbahaya
function sanitize(str, maxLen = 100) {
  if (typeof str !== "string") return "";
  return str.trim().substring(0, maxLen);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;
  if (checkRegisterLimit(ip))
    return res.status(429).json({ error: "Terlalu banyak pendaftaran. Coba lagi nanti." });

  try {
    const { username, phone, email, password } = req.body || {};

    // Tipe dan keberadaan
    if (!username || !phone || !email || !password)
      return res.status(400).json({ error: "Semua field wajib diisi" });
    if ([username, phone, email, password].some(v => typeof v !== "string"))
      return res.status(400).json({ error: "Input tidak valid" });

    // Sanitasi
    const cleanUsername = sanitize(username, 20);
    const cleanPhone    = sanitize(phone, 15);
    const cleanEmail    = sanitize(email, 100).toLowerCase();

    // Validasi format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername))
      return res.status(400).json({ error: "Username hanya boleh huruf, angka, underscore (3-20 karakter)" });

    if (!/^08\d{8,11}$/.test(cleanPhone))
      return res.status(400).json({ error: "Format HP: 08xxxxxxxxxx" });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return res.status(400).json({ error: "Format email tidak valid" });

    if (password.length < 6 || password.length > 200)
      return res.status(400).json({ error: "Password harus 6-200 karakter" });

    // Cek duplikat
    const { data: existUser } = await supabase
      .from("users").select("id").eq("username", cleanUsername).single();
    if (existUser) return res.status(400).json({ error: "Username sudah digunakan" });

    const { data: existEmail } = await supabase
      .from("users").select("id").eq("email", cleanEmail).single();
    if (existEmail) return res.status(400).json({ error: "Email sudah terdaftar" });

    const hashed = await bcrypt.hash(password, 12); // cost 12, lebih aman dari 10
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from("users").insert([{
      username: cleanUsername, phone: cleanPhone, email: cleanEmail,
      password: hashed, is_verified: false,
      verify_token: verifyToken, verify_token_expiry: tokenExpiry,
    }]);

    if (insertError) {
      if (insertError.code === "23505")
        return res.status(400).json({ error: "Username atau email sudah digunakan" });
      return res.status(500).json({ error: "Gagal membuat akun" }); // jangan expose detail DB
    }

    try {
      await sendVerificationEmail(cleanEmail, cleanUsername, verifyToken);
    } catch (emailErr) {
      console.error("EMAIL ERROR:", emailErr.message);
      return res.status(200).json({ success: true, warning: "Akun dibuat tapi email gagal terkirim. Hubungi admin." });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("REGISTER ERROR:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
