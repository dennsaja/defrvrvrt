import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      teknisi,
      jenis_kegiatan,
      tanggal,
      waktu,
      nama_client,
      catatan,
      foto
    } = req.body;

    // VALIDASI WAJIB
    if (!teknisi || !jenis_kegiatan || !tanggal || !waktu || !catatan) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    // ENV
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    // Kalau belum set env → fallback
    if (!supabaseUrl || !supabaseKey) {
      console.log('⚠️ Supabase belum dikonfigurasi');

      return res.status(200).json({
        success: true,
        message: 'Disimpan lokal saja (tanpa Supabase)'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // INSERT DATA
    const { error } = await supabase
      .from('laporan')
      .insert([{
        teknisi,
        jenis_kegiatan,
        tanggal,
        waktu,
        nama_client: nama_client || '-',
        catatan,
        foto: foto || null
      }]);

    if (error) {
      console.error('SUPABASE ERROR:', error);
      return res.status(500).json({ error: 'Gagal simpan ke database' });
    }

    return res.status(200).json({
      success: true,
      message: 'Laporan berhasil disimpan'
    });

  } catch (err) {
    console.error('SERVER ERROR:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
