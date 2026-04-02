import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method tidak diizinkan" });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Data tidak lengkap" });
    }

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (error || !data) {
      return res.status(401).json({ message: "User tidak ditemukan" });
    }

    // sementara plain password (nanti bisa kita hash)
    if (data.password !== password) {
      return res.status(401).json({ message: "Password salah" });
    }

    const token = jwt.sign(
      { id: data.id, username: data.username },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      message: "Login berhasil",
      token
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message
    });
  }
}
