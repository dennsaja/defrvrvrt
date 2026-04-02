import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method tidak diizinkan" });
    }

    const body = req.body || {};
    const { username, password } = body;

    if (!username || !password) {
      return res.status(400).json({ message: "Data tidak lengkap" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (error || !data) {
      return res.status(401).json({ message: "User tidak ditemukan" });
    }

    if (data.password !== password) {
      return res.status(401).json({ message: "Password salah" });
    }

    const token = jwt.sign(
      { id: data.id },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "1d" }
    );

    return res.status(200).json({ token });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      message: "Internal error",
      error: err.message
    });
  }
}
