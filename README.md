# Telegram Multi-Account Web Client

Web app buat login multi-akun Telegram (pake MTProto, bukan Bot API) dan nampilin chat.

## Cara pakai

1. Ambil `API_ID` & `API_HASH` di https://my.telegram.org → API Development Tools
2. Install dependency:
   ```
   npm install
   ```
3. Jalankan server (set API_ID/API_HASH sebagai env var):
   ```
   TG_API_ID=123456 TG_API_HASH=abcdef123456... npm start
   ```
4. Buka `http://localhost:3000`
5. Klik **+ Tambah Akun**, isi label bebas (mis: `akun1`) + no HP format internasional (`+62...`)
6. Klik **Kirim OTP** → cek Telegram/SMS → masukin kode → verifikasi
7. Kalau akun ada 2FA, akan diminta password tambahan
8. Setelah login, klik akun di sidebar buat jadi akun aktif → chat list otomatis muncul
9. Buat lihat chat dengan user lain: ketik username di kolom atas → klik **Buka**

## Catatan penting

- Session tersimpan di `accounts.json` (plaintext) — **jangan di-commit ke git / jangan di-share**, karena isinya setara akses penuh ke akun Telegram itu.
- Ini pakai koneksi MTProto asli, bukan clone/scrape — semua request lewat API resmi Telegram via library GramJS.
- Deploy ini di server/VPS (bukan Termux), karena butuh koneksi TCP persisten yang GramJS pakai.
- Rate limit dari Telegram tetap berlaku per akun (terutama buat SendCode berkali-kali dalam waktu singkat — bisa kena `FLOOD_WAIT`).
