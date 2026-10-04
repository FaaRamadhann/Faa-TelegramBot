# Faa-Telegram-Bot (Linux) — Panduan Lengkap

Bot Telegram serba-bisa: sticker tools, downloader, AI, game, grup tools.
Tanpa QR, tanpa pairing, tanpa browser — cukup token dari `@BotFather`.

## 1. Install otomatis

```bash
cd Faa-Telegram-Bot_Linux
chmod +x install.sh
./install.sh
```

Installer mendeteksi `apt` (Debian/Ubuntu) atau `pkg` (Termux),
menginstall Node.js + Python + FFmpeg, modul Python (`yt-dlp`, `rembg`),
lalu `npm install`.

Install manual (kalau installer gagal di distromu):

```bash
npm install
pip install -U yt-dlp rembg
```

## 2. Ambil token

1. Chat `@BotFather` di Telegram.
2. `/newbot` > ikuti langkahnya.
3. Copy token `123456:ABCDEF...`.

## 3. Jalankan

```bash
export BOT_TOKEN=tempel_token_disini
npm start
```

atau sekali jalan:

```bash
BOT_TOKEN=tempel_token_disini npm start
```

Jalankan pertama kali muncul **setup owner permanen**:

```
=== Setup pertama: owner permanen ===
Telegram user ID owner (Enter untuk lewati):
```

Lihat ID via `@userinfobot`, masukkan, Enter. Bot jalan (polling).

Jalan 24 jam (contoh):

```bash
npm install -g pm2
BOT_TOKEN=... pm2 start index.js --name faa-tgbot
pm2 save
```

Termux: pakai `tmux new -s bot` lalu jalankan di dalamnya, atau
`termux-wake-lock` agar proses tidak dibunuh sistem.

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
| `BOT_TOKEN kosong` | export dulu (langkah 3) |
| `409 Conflict` | ada 2 bot jalan — matikan salah satu |
| `!yta` gagal | update yt-dlp: `pip install -U yt-dlp` |
| `!aibg` jelek | `REMBG_MODEL=isnet-general-use npm start` |
| `ffmpeg: command not found` | install ffmpeg sesuai distro (lihat requirement.md) |
| Termux bot mati sendiri | pakai `tmux` + `termux-wake-lock` |

## 8. Update

Matikan bot, timpa file dengan rilis baru (jangan timpa `bot-state.json`
kalau mau setting lama dipertahankan), `npm install` lagi bila ada dep baru.

Lisensi: GNU GPL v3 (lihat `LICENSE` di root rilis).
