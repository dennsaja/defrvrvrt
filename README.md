# TechConnect v4 — Sistem Manajemen Teknisi

## ✨ Fitur Baru v4
- **Verifikasi Email** — Teknisi baru harus verifikasi email sebelum bisa login
- **Kirim Ulang Email** — Tombol resend verifikasi jika email belum diterima
- **Admin Panel** — Login sebagai admin untuk lihat seluruh laporan dari Google Sheets
- **Bug Fix** — Detail laporan di riwayat sudah diperbaiki

---

## 🚀 Setup & Deploy

### 1. Supabase — Jalankan SQL ini di SQL Editor

```sql
-- Jika tabel users BELUM ADA, buat baru:
create table if not exists users (
  id uuid default gen_random_uuid() primary key,
  username text unique not null,
  phone text not null,
  email text unique not null,
  password text not null,
  is_verified boolean default false,
  verify_token text,
  verify_token_expiry timestamptz,
  created_at timestamptz default now()
);

-- Jika tabel users SUDAH ADA (tambah kolom baru):
alter table users add column if not exists email text unique;
alter table users add column if not exists is_verified boolean default false;
alter table users add column if not exists verify_token text;
alter table users add column if not exists verify_token_expiry timestamptz;

-- Index
create index if not exists idx_users_email on users(email);
create index if not exists idx_users_verify_token on users(verify_token);
```

### 2. Gmail App Password (untuk kirim email verifikasi)

1. Buka https://myaccount.google.com/security
2. Aktifkan **2-Step Verification**
3. Buka https://myaccount.google.com/apppasswords
4. Buat App Password baru → pilih "Mail" & "Other (Custom name)" → tulis "TechConnect"
5. Copy password 16 karakter yang muncul

### 3. Environment Variables di Vercel

Tambahkan di Vercel Dashboard → Project → Settings → Environment Variables:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | https://xxxx.supabase.co |
| `SUPABASE_SERVICE_KEY` | eyJhbGci... |
| `JWT_SECRET` | random string panjang |
| `GS_URL` | URL CSV Google Sheets (untuk admin baca data) |
| `GS_SCRIPT_URL` | URL Apps Script /exec (untuk tulis laporan) |
| `EMAIL_USER` | emailkamu@gmail.com |
| `EMAIL_PASS` | App Password 16 karakter |
| `APP_URL` | https://nama-app.vercel.app |

### 4. Deploy ke Vercel

```bash
npm install -g vercel
vercel --prod
```

---

## 🔑 Akun Admin

Login dengan kredensial berikut (hardcoded, tidak perlu di database):

- **Username:** `admin`
- **Password:** `d3n1s`

Admin akan diarahkan ke halaman **Admin Panel** yang menampilkan seluruh laporan dari Google Sheets.

---

## 📊 Alur Kerja

### Teknisi Baru:
1. Buka app → klik **Daftar**
2. Isi username, HP, **email**, password
3. Klik **Daftar Sekarang**
4. Cek email → klik link **Verifikasi Akun**
5. Setelah terverifikasi → bisa login

### Jika Belum Verifikasi:
- Saat login → muncul alert **"Akun belum terverifikasi"**
- Klik tombol **"Kirim Ulang Email Verifikasi"**
- Cek email lagi

---

## 📁 Struktur File

```
techconnect-v4/
├── index.html              ← Frontend (teknisi + admin panel)
├── api/
│   ├── login.js            ← Auth (teknisi + admin)
│   ├── register.js         ← Daftar + kirim email verifikasi
│   ├── verify.js           ← Endpoint klik link dari email
│   ├── resend-verify.js    ← Kirim ulang email verifikasi
│   ├── laporan.js          ← GET/POST laporan teknisi
│   ├── admin.js            ← GET semua laporan (admin only)
│   ├── upload.js           ← Upload foto ke Supabase Storage
│   └── submit.js           ← Submit ke Google Sheets
├── supabase_setup.sql      ← SQL untuk setup database
├── vercel.json             ← Konfigurasi routing Vercel
├── package.json            ← Dependencies
└── .env                    ← Environment variables (jangan di-commit!)
```
