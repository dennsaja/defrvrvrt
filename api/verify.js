const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).end();

  const { token } = req.query;
  if (!token) {
    return res.status(400).send(renderPage("error", "Token tidak ditemukan", "Link verifikasi tidak valid."));
  }

  try {
    // Cari user berdasarkan token
    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, is_verified, verify_token_expiry")
      .eq("verify_token", token)
      .single();

    if (error || !user) {
      return res.status(400).send(renderPage("error", "Link Tidak Valid", "Token verifikasi tidak ditemukan atau sudah digunakan."));
    }

    if (user.is_verified) {
      return res.status(200).send(renderPage("already", "Sudah Terverifikasi", `Akun <strong>${user.username}</strong> sudah aktif. Silakan login.`));
    }

    // Cek expired
    if (new Date() > new Date(user.verify_token_expiry)) {
      return res.status(400).send(renderPage("error", "Link Kedaluwarsa", "Link verifikasi sudah expired (24 jam). Daftar ulang atau hubungi admin."));
    }

    // Update is_verified = true, hapus token
    const { error: updateError } = await supabase
      .from("users")
      .update({ is_verified: true, verify_token: null, verify_token_expiry: null })
      .eq("id", user.id);

    if (updateError) {
      return res.status(500).send(renderPage("error", "Gagal Verifikasi", "Terjadi kesalahan server. Coba lagi nanti."));
    }

    return res.status(200).send(renderPage("success", "Akun Berhasil Diverifikasi! 🎉", `Selamat <strong>${user.username}</strong>! Akun kamu sudah aktif. Silakan login ke aplikasi.`));

  } catch (err) {
    console.error("VERIFY ERROR:", err);
    return res.status(500).send(renderPage("error", "Server Error", err.message));
  }
};

function renderPage(type, title, message) {
  const colors = {
    success: { bg: "#E6FAF5", border: "#00C48C", icon: "✅", btn: "#00C48C" },
    error:   { bg: "#FFF0F0", border: "#FF3B30", icon: "❌", btn: "#FF3B30" },
    already: { bg: "#E8F0FF", border: "#0066FF", icon: "ℹ️", btn: "#0066FF" },
  };
  const c = colors[type] || colors.error;
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifikasi Akun - TechConnect</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:sans-serif;background:linear-gradient(135deg,#0A1628,#5a1a1a 50%,#ff0000);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:#fff;border-radius:20px;padding:40px 32px;max-width:440px;width:100%;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.3)}
  .icon{font-size:56px;margin-bottom:16px}
  .title{font-size:22px;font-weight:700;color:#0A1628;margin-bottom:10px}
  .msg{font-size:14px;color:#4A5568;line-height:1.6;margin-bottom:24px}
  .btn{display:inline-block;padding:12px 28px;background:${c.btn};color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px}
  .badge{display:inline-block;padding:4px 14px;border-radius:50px;background:${c.bg};color:${c.border};border:1px solid ${c.border};font-size:12px;font-weight:600;margin-bottom:20px}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${c.icon}</div>
  <div class="badge">TechConnect</div>
  <div class="title">${title}</div>
  <div class="msg">${message}</div>
  <a href="/" class="btn">🚀 Buka Aplikasi</a>
</div>
</body>
</html>`;
}
