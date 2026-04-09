const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Unauthorized");
  return jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "dev-secret");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    verifyToken(req);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: "base64 diperlukan" });

    const fileName = "laporan_" + Date.now() + ".jpg";
    const buffer = Buffer.from(base64.split(",")[1], "base64");

    const { error } = await supabase.storage
      .from("laporan")
      .upload(fileName, buffer, { contentType: "image/jpeg" });

    if (error) return res.status(500).json({ error: error.message });

    const url = process.env.SUPABASE_URL + "/storage/v1/object/public/laporan/" + fileName;
    return res.status(200).json({ url });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
