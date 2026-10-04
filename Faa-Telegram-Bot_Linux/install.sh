#!/usr/bin/env bash
# Installer Faa-Telegram-Bot (Debian/Ubuntu/Linux Mint/chroot/Termux).
# - deteksi apt vs pkg
# - install nodejs + python + ffmpeg
# - install modul python (yt-dlp, rembg)
# - npm install
set -e

has_cmd() { command -v "$1" >/dev/null 2>&1; }

if has_cmd apt-get; then
    PM="apt"
elif has_cmd pkg; then
    PM="pkg"
else
    echo "Manajer paket tidak dikenal (bukan apt/pkg)."
    echo "Install manual: nodejs 20+, python3, ffmpeg. Lihat requirement.md"
    exit 1
fi

echo "==> Paket: $PM"

if [ "$PM" = "apt" ]; then
    sudo apt-get update
    sudo apt-get install -y nodejs npm python3 python3-pip ffmpeg
else
    pkg update -y
    pkg install -y nodejs python ffmpeg
fi

echo "==> Versi:"
node -v || true
python3 --version || python --version || true
ffmpeg -version 2>/dev/null | head -n 1 || true

echo "==> Modul Python: yt-dlp, rembg"
if has_cmd pip3; then
    PIP=pip3
elif has_cmd pip; then
    PIP=pip
else
    echo "pip tidak ditemukan, lewati modul python."
    PIP=""
fi

if [ -n "${PIP:-}" ]; then
    "$PIP" install -U yt-dlp rembg || echo "pip install gagal, lanjut..."
fi

echo "==> npm install"
npm install

echo ""
echo "Selesai. Ambil token dari @BotFather, lalu:"
echo "  export BOT_TOKEN=tempel_token_disini"
echo "  npm start"
