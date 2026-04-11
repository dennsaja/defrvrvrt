const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Rate limit: maks 3 resend per email per jam
const resendCooldown = new Map();
function checkResendLimit(email) {
  const now = Date.now();
  const rec = resendCooldown.get(email) || { count: 0, resetAt: now + 60 * 60 * 1000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60 * 60 * 1000; }
  rec.count++;
  resendCooldown.set(email, rec);
  return rec.count > 3;
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
        <h2 style="color:#0A1628;">Halo, ${username}! 👋</h2>
        <p>Klik tombol di bawah untuk mengaktifkan akun Anda:</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${verifyUrl}" style="background:#f72e2e;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;">✅ Verifikasi Akun Saya</a>
        </div>
        <p style="color:#8896A6;font-size:12px;text-align:center;">Link berlaku <strong>24 jam</strong>.</p>
      </div>
    `,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string")
      return res.status(400).json({ error: "Email wajib diisi" });

    const cleanEmail = email.trim().toLowerCase().substring(0, 100);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return res.status(400).json({ error: "Format email tidak valid" });

    // Rate limit
    if (checkResendLimit(cleanEmail))
      return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi dalam 1 jam." });

    // ✅ Selalu kembalikan respons sukses yang sama untuk cegah email enumeration
    // (jangan beri tahu apakah email ada atau tidak)
    const { data: user } = await supabase
      .from("users").select("id,username,is_verified").eq("email", cleanEmail).single();

    if (user && !user.is_verified) {
      const verifyToken = crypto.randomBytes(32).toString("hex");
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await supabase.from("users")
        .update({ verify_token: verifyToken, verify_token_expiry: tokenExpiry })
        .eq("id", user.id);

      await sendVerificationEmail(cleanEmail, user.username, verifyToken).catch(e => {
        console.error("RESEND EMAIL ERROR:", e.message);
      });
    }

    // Selalu respons 200 agar tidak leak info akun
    return res.status(200).json({ success: true, message: "Jika email terdaftar dan belum terverifikasi, link verifikasi telah dikirim." });

  } catch (err) {
    console.error("RESEND ERROR:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
