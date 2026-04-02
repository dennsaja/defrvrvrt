import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { username, phone, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  const { error } = await supabase
    .from('users')
    .insert([{ username, phone, password: hashed }]);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
}
