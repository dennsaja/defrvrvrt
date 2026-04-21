-- ============================================================
-- TeknisiApp — Tabel Laporan Barang
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- Tabel khusus laporan barang (terpisah dari laporan kegiatan)
CREATE TABLE IF NOT EXISTS barang_laporan (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  barang_id   text UNIQUE NOT NULL,        -- BRG-YYYYMMDD-XXXX
  teknisi     text NOT NULL,
  nama_barang text NOT NULL,
  tanggal     date NOT NULL,
  keperluan   text NOT NULL,
  foto        text,                        -- URL foto 1
  foto_2      text,                        -- URL foto 2 (opsional)
  created_at  timestamptz DEFAULT now()
);

-- Kolom foto_2 di tabel laporan (untuk foto dokumentasi ke-2)
ALTER TABLE laporan ADD COLUMN IF NOT EXISTS foto_2 text;

-- Index
CREATE INDEX IF NOT EXISTS idx_barang_teknisi   ON barang_laporan(teknisi);
CREATE INDEX IF NOT EXISTS idx_barang_tanggal   ON barang_laporan(tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_barang_barang_id ON barang_laporan(barang_id);
CREATE INDEX IF NOT EXISTS idx_laporan_foto_2   ON laporan(foto_2) WHERE foto_2 IS NOT NULL;

-- Disable RLS (konsisten dengan tabel lainnya)
ALTER TABLE barang_laporan DISABLE ROW LEVEL SECURITY;
