# TechConnect — Bug Fix Summary

## Bug yang Ditemukan & Diperbaiki

### 1. `api/login.js` — Variable env salah
- **Bug**: Pakai `SUPABASE_KEY` yang tidak ada di `.env`
- **Fix**: Ganti ke `SUPABASE_SERVICE_KEY` (sesuai `.env`)

### 2. `api/login.js` — Token & user tidak dikembalikan ke frontend
- **Bug**: Response hanya kirim `{ token }`, tanpa data user
- **Fix**: Kirim `{ token, user: { id, username, phone, created_at } }`

### 3. `index.html` — Login tidak simpan token & user
- **Bug**: `doLogin()` dapat response tapi tidak simpan ke `localStorage`
- **Fix**: Tambah `localStorage.setItem('token', ...)` dan `localStorage.setItem('tc_user', ...)`

### 4. `api/laporan.js` — Tidak ada GET handler
- **Bug**: File hanya handle POST, tidak ada GET → data tidak bisa dibaca
- **Fix**: Tambah GET handler yang query Supabase dan return data laporan teknisi

### 5. `api/laporan.js` — Pakai `SUPABASE_KEY` (tidak ada) di POST
- **Bug**: POST handler juga pakai `SUPABASE_KEY` → semua insert gagal
- **Fix**: Ganti ke `SUPABASE_SERVICE_KEY`

### 6. `api/laporan.js` — Field `teknisi` tidak ada di body
- **Bug**: `submitLap()` tidak kirim field `teknisi`, tapi server mencari dari body
- **Fix**: Ambil `teknisi` dari JWT token yang di-decode di server (lebih aman)

### 7. `index.html` — Form laporan tanpa UI yang benar
- **Bug**: Form pakai raw `<input>` tanpa class, tidak ada preview foto, tombol tidak ada id
- **Fix**: Gunakan UI komponen yang sudah ada (`.kr`, `.kl`, `.fi`, `.upl`, dll)

### 8. `handleUpl()` — Upload foto tidak update UI
- **Bug**: Setelah pilih foto, preview tidak muncul karena element belum ada di DOM lama
- **Fix**: Cari element by id setelah render, update preview dan status text

### 9. Tidak ada `vercel.json`
- **Bug**: Vercel tidak tahu cara routing `/api/*` ke serverless functions
- **Fix**: Tambah `vercel.json` dengan konfigurasi routes yang benar

### 10. Tidak ada tabel `laporan` di Supabase
- **Bug**: Project hanya punya tabel `users`, tidak ada `laporan`
- **Fix**: Tambah file `supabase_setup.sql` dengan schema lengkap

---

## Cara Deploy

### Step 1 — Setup Supabase
1. Buka **Supabase Dashboard** → project kamu
2. Klik **SQL Editor** di sidebar
3. Paste isi file `supabase_setup.sql` → klik **Run**
4. Pastikan tabel `users` dan `laporan` muncul di **Table Editor**

### Step 2 — Set Environment Variables di Vercel
1. Buka **Vercel Dashboard** → project → **Settings** → **Environment Variables**
2. Tambahkan variabel berikut (salin dari file `.env`):

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `eyJ...` (service role key) |
| `GS_URL` | URL Google Apps Script (untuk Sheets) |
| `JWT_SECRET` | String rahasia panjang |

> ⚠️ Jangan pakai nama `SUPABASE_KEY` — variable itu tidak dipakai di project ini

### Step 3 — Deploy ulang
1. Push file-file yang sudah difix ke GitHub
2. Vercel otomatis redeploy, atau klik **Redeploy** manual

### Step 4 — Test
1. Buka URL Vercel → Register akun baru
2. Login → masuk dashboard
3. Buat laporan → cek di Supabase Table Editor apakah data masuk
4. Buka tab Riwayat → data harus muncul

---

## Struktur File

```
defrvrvrt-main/
├── api/
│   ├── login.js      ← FIXED (env key + return user)
│   ├── register.js   ← OK (tidak diubah)
│   ├── laporan.js    ← FIXED (tambah GET + fix env key)
│   ├── submit.js     ← OK (untuk Sheets)
│   └── upload.js     ← OK (untuk upload foto ke Storage)
├── index.html         ← FIXED (login, form, handleUpl)
├── package.json       ← FIXED (tambah "type": "module")
├── vercel.json        ← BARU (routing config)
├── supabase_setup.sql ← BARU (schema database)
└── .env               ← TIDAK DIUBAH
```
