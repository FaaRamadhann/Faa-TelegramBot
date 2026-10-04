# Faa-Telegram-Bot (Windows) — Panduan Lengkap

Bot Telegram all-in-one: sticker tools, downloader, AI, game, grup tools.
Tanpa QR, tanpa pairing, tanpa browser — cukup token dari `@BotFather`.

## 1. Install

```bat
cd Faa-Telegram-Bot_win
npm install
py -3 -m pip install -U yt-dlp rembg
```

Pastikan `ffmpeg` terinstall (`ffmpeg -version`). Kalau belum:
`winget install Gyan.FFmpeg`, lalu tutup-buka terminal lagi.

## 2. Ambil token

1. Chat `@BotFather` di Telegram.
2. `/newbot` > ikuti langkahnya (nama + username).
3. Copy token `123456:ABCDEF...`.

## 3. Jalankan

```bat
set BOT_TOKEN=tempel_token_disini && npm start
```

Jalankan pertama kali muncul **setup owner permanen**:

```
=== Setup pertama: owner permanen ===
Telegram user ID owner (Enter untuk lewati):
```

Lihat ID via `@userinfobot`, masukkan, Enter. Bot jalan (polling).

Agar token permanen per terminal, boleh set sekali:
`setx BOT_TOKEN "tempel_token_disini"` (terminal baru pakai `npm start` saja).

## 4. Tes cepat (chat ke bot)

```
/ping
/menu          -> panel tombol interaktif, tap kategorinya
!owner list    -> pastikan ID kamu terdaftar
```

## 5. Perintah penting

| Command | Fungsi |
|---|---|
| `!s` (reply/kirim gambar) | jadi sticker |
| `!snobg` / `!aibg` | hapus background (solid / AI) |
| `!brat teks` / `!bratvid teks` | sticker brat |
| `!yta <url>` / `!ytv <url>` | MP3 / MP4 (+ `128`, `480` dst) |
| `!tiktok` / `!igdl` / `!fbdl` | downloader sosmed |
| `!qr` / `!tts` / `!trivia` / `!cuaca` / `!lirik` | tools |
| `!ai teks` | tanya AI (butuh `/apikey`) |
| `!apikey set openrouter sk-or-...` | set AI key (owner) |
| `!aimodel list` | daftar model + harga |
| `!menucommand` | semua 150+ command |

Prefix default `!`, bisa `/` juga (`/ping` = `!ping`).
Ganti prefix: `!prefix .` | Owner: `!owner add <id>`.

## 6. AI (opsional)

Tanpa key, `!ai` ditolak ramah. Set key (owner):

```
!apikey set openrouter sk-or-...
!apikey set google AIza...
!apikey set chatgpt sk-...
!apikey use google
!aimodel set google gemini-2.0-flash
!aimodel list
```

## 7. Troubleshooting

| Gejala | Solusi |
|---|---|
| `BOT_TOKEN kosong` | set env dulu (langkah 3) |
| `409 Conflict` | ada 2 bot jalan — matikan salah satu (Ctrl+C) |
| `!yta` gagal | update yt-dlp: `py -3 -m pip install -U yt-dlp` |
| `!aibg` jelek | `set REMBG_MODEL=isnet-general-use && npm start` |
| Sticker `!s` gagal | pastikan owner sudah diset (`!owner list`) |

## 8. Update

Tutup bot (Ctrl+C), timpa file dengan rilis baru (jangan timpa `bot-state.json`
kalau mau setting lama dipertahankan), `npm install` lagi bila ada dep baru.

Lisensi: GNU GPL v3 (lihat `LICENSE` di root rilis).
