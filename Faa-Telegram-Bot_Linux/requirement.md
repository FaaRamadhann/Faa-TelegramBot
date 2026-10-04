# Requirement — Faa-Telegram-Bot (Linux)

Didukung: Debian/Ubuntu/Linux Mint, chroot/proot, dan **Termux** (Android).
Shell: `bash`.

| Kebutuhan | Debian/Ubuntu | Termux |
|---|---|---|
| Node.js 20+ | `sudo apt install nodejs npm` | `pkg install nodejs` |
| Python 3.10+ | `sudo apt install python3 python3-pip` | `pkg install python` |
| FFmpeg | `sudo apt install ffmpeg` | `pkg install ffmpeg` |
| Token bot Telegram | `@BotFather` > `/newbot` | sama |
| API key (opsional) | untuk `!ai` | sama |

Atau cukup jalankan `./install.sh` (otomatis deteksi apt vs pkg).

Modul Python yang dibutuhkan (`yt-dlp` untuk downloader, `rembg`
untuk `!aibg`):

```bash
pip install -U yt-dlp rembg
```

Cek instalasi:

```bash
node -v
python3 --version
ffmpeg -version
python3 -m yt_dlp --version
```

Catatan Termux:
- Jalankan bot di sesi `tmux`/`termux-wake-lock` agar tidak mati saat layar mati.
- Penyimpanan: izinkan akses bila ingin unduh file manual (`termux-setup-storage`).
