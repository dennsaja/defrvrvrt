import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = auth.split(' ')[1];
  return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // FIX #4: Tambah GET handler agar data bisa dibaca
  if (req.method === 'GET') {
    try {
      const decoded = verifyToken(req);

      const { data, error } = await supabase
        .from('laporan')
        .select('*')
        .eq('teknisi', decoded.username)
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      // FIX #5: ambil username dari JWT (bukan dari body yang bisa dimanipulasi)
      const decoded = verifyToken(req);

      const {
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client,
        catatan,
        foto
      } = req.body;

      if (!jenis_kegiatan || !tanggal || !waktu || !catatan) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
      }

      const { data, error } = await supabase
        .from('laporan')
        .insert([{
          teknisi: decoded.username,   // ambil dari JWT
          jenis_kegiatan,
          tanggal,
          waktu,
          nama_client: nama_client || '-',
          catatan,
          foto: foto || null
        }])
        .select()
        .single();

      if (error) {
        console.error('SUPABASE ERROR:', error);
        return res.status(500).json({ error: 'Gagal simpan ke database: ' + error.message });
      }

      // Juga kirim ke Google Sheets jika GS_URL ada
      if (process.env.GS_URL) {
        try {
          await fetch(process.env.GS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
              teknisi: decoded.username,
              hp: decoded.phone || '',
              jenis_kegiatan,
              tanggal,
              waktu,
              nama_client: nama_client || '-',
              catatan,
              foto_url: foto ? '[foto-' + Date.now() + ']' : '-'
            })
          });
        } catch (gsErr) {
          console.warn('Gagal kirim ke Sheets (tidak kritikal):', gsErr.message);
        }
      }

      return res.status(200).json({ success: true, data });

    } catch (err) {
      console.error('SERVER ERROR:', err);
      if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Token tidak valid' });
      return res.status(500).json({ error: 'Internal server error: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
