const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendVerificationEmail(email, username, token) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  try {
    const { username, phone, email, password } = req.body || {};

    if (!username || !phone || !email || !password) {
      return res.status(400).json({ error: "Semua field wajib diisi" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Format email tidak valid" });
    }

    const { data: existUser } = await supabase
      .from("users").select("id").eq("username", username).single();
    if (existUser) return res.status(400).json({ error: "Username sudah digunakan" });

    const { data: existEmail } = await supabase
      .from("users").select("id").eq("email", email).single();
    if (existEmail) return res.status(400).json({ error: "Email sudah terdaftar" });

    const hashed = await bcrypt.hash(password, 10);
    const verifyToken = require("crypto").randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase
      .from("users")
      .insert([{ username, phone, email, password: hashed, is_verified: false, verify_token: verifyToken, verify_token_expiry: tokenExpiry }]);

    if (insertError) {
      if (insertError.code === "23505") return res.status(400).json({ error: "Username atau email sudah digunakan" });
      return res.status(500).json({ error: insertError.message });
    }

    try {
      await sendVerificationEmail(email, username, verifyToken);
    } catch (emailErr) {
      console.error("EMAIL ERROR:", emailErr.message);
      return res.status(200).json({ success: true, warning: "Akun dibuat tapi email gagal terkirim. Hubungi admin." });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
};
