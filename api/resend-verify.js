const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
        <p style="color:#4A5568;margin-bottom:20px;">Klik tombol di bawah untuk mengaktifkan akun Anda:</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${verifyUrl}" style="background:#f72e2e;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
            ✅ Verifikasi Akun Saya
          </a>
        </div>
        <p style="color:#8896A6;font-size:12px;text-align:center;">Link berlaku <strong>24 jam</strong>.</p>
      </div>
    `,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email wajib diisi" });

    const { data: user, error } = await supabase
      .from("users").select("*").eq("email", email).single();

    if (error || !user) return res.status(404).json({ error: "Email tidak ditemukan" });
    if (user.is_verified) return res.status(400).json({ error: "Akun sudah terverifikasi" });

    const verifyToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase.from("users")
      .update({ verify_token: verifyToken, verify_token_expiry: tokenExpiry })
      .eq("id", user.id);

    await sendVerificationEmail(email, user.username, verifyToken);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("RESEND ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
};
