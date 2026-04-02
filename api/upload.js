import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verify(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  return jwt.verify(token, process.env.JWT_SECRET);
}

export default async function handler(req, res) {
  try {
    verify(req);

    const { base64 } = req.body;

    const fileName = `laporan_${Date.now()}.jpg`;
    const buffer = Buffer.from(base64.split(',')[1], 'base64');

    const { error } = await supabase.storage
      .from('laporan')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg'
      });

    if (error) throw error;

    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/laporan/${fileName}`;

    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
