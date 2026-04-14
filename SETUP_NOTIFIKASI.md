# 🔔 Setup Push Notification

## Langkah 1: Tambah Environment Variables di Vercel

Buka **Vercel Dashboard → Project → Settings → Environment Variables**, lalu tambahkan:

| Key | Value |
|-----|-------|
| `VAPID_PUBLIC_KEY` | `BBjnzZugiO4AXCcqMPS9tkRop_TEa66VoOv6DWEvq0Wgglg98IWOXRqkh6BXo6du_pgr-NvZapnBBTXGs43eT48` |
| `VAPID_PRIVATE_KEY` | `pDcP_elgUNTEXO47b-Akv8ozIkz1ri4k6DAEUl5EzD8` |
| `VAPID_EMAIL` | `admin@teknisiapp.com` |

> ⚠️ **JANGAN** generate ulang VAPID keys setelah ada user yang sudah subscribe.
> Kalau di-generate ulang, semua subscription lama tidak valid dan notif tidak akan masuk.

## Langkah 2: Jalankan SQL di Supabase

Buka **Supabase → SQL Editor**, jalankan isi file `MIGRATION.sql` (ada bagian push_subscriptions di bawah).

## Langkah 3: Redeploy

Setelah tambah env vars, klik **Redeploy** di Vercel.

## Langkah 4: Aktifkan di Browser/HP

### Android (Chrome):
1. Buka app di Chrome
2. Di dashboard muncul banner **"Aktifkan Notifikasi"** → tap
3. Pilih **"Izinkan"**
4. Selesai — notif akan masuk meski app ditutup

### Windows (Chrome/Edge):
1. Buka app di browser
2. Tap banner **"Aktifkan Notifikasi"**  
3. Klik **"Allow"** di popup browser
4. Selesai

### iOS (Safari) — butuh langkah extra:
1. Buka app di Safari
2. Tap tombol **Share** → **"Add to Home Screen"**
3. Buka app dari Home Screen (bukan dari browser langsung)
4. Aktifkan notifikasi dari dalam app

## Troubleshooting

**Notif tidak muncul padahal sudah Allow:**
- Pastikan VAPID keys sudah di env Vercel dan sudah redeploy
- Cek console browser untuk error
- Coba logout → login ulang → allow notifikasi lagi

**Permission sudah Denied:**
- Android: Settings → Apps → Chrome → Notifikasi → Aktifkan
- Windows: Settings browser → Privacy → Notifications → cari URL app → Allow
