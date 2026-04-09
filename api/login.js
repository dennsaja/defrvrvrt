import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method tidak diizinkan" });
  }

  try {
    const body = req.body || {};
    const { username, password } = body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username dan password wajib diisi" });
    }

    // FIX #1: pakai SUPABASE_SERVICE_KEY (bukan SUPABASE_KEY yang tidak ada di .env)
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

    // FIX #2: compare bcrypt (register pakai bcrypt hash)
    const passwordValid = await bcrypt.compare(password, data.password);
    if (!passwordValid) {
      return res.status(401).json({ message: "Password salah" });
    }

    const token = jwt.sign(
      { id: data.id, username: data.username },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "7d" }
    );

    // FIX #3: kembalikan user data agar frontend bisa simpan ke localStorage
    return res.status(200).json({
      token,
      user: {
        id: data.id,
        username: data.username,
        phone: data.phone,
        created_at: data.created_at
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: "Internal error", error: err.message });
  }
}
