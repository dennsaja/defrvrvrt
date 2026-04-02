import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  try {
    console.log("BODY:", req.body);
     const { username, password } = req.body;

     const { data, error } = await supabase
       .from('users')
       .select('*')
       .eq('username', username)
       .single();

     if (error || !data)
       return res.status(401).json({ error: 'User tidak ditemukan' });

     const valid = await bcrypt.compare(password, data.password);
     if (!valid)
       return res.status(401).json({ error: 'Password salah' });

     const token = jwt.sign(
       { id: data.id, username: data.username },
       process.env.JWT_SECRET,
       { expiresIn: '7d' }
  );

  res.json({ token, user: data });
  res.status(200).json({ message: "OK" });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: err.message });
  }
}
