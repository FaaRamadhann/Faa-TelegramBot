# Faa-Telegram-Bot

Bot Telegram serba-bisa (polling, tanpa QR/pairing/browser):
sticker tools, downloader (YT/TikTok/IG/FB), AI multi-provider
(OpenRouter/Google/OpenAI), game, grup tools, translate, utilitas.

Lisensi: **GNU GPL v3** — lihat `LICENSE`.

## Struktur rilis

```
Telegram-Bots/
├── Faa-Telegram-Bot_win/        # Windows only
│   ├── requirement.md           # yang dibutuhkan
│   ├── readme.md                # panduan lengkap
│   ├── index.js, src/, *.py ...
├── Faa-Telegram-Bot_Linux/      # Debian/Ubuntu/Termux/chroot
│   ├── requirement.md
│   ├── readme.md
│   ├── install.sh               # installer otomatis
│   ├── index.js, src/, *.py ...
├── release/
│   ├── Faa-Telegram-Bot_win.zip
│   ├── Faa-Telegram-Bot_Linux.zip
│   └── RELEASE_NOTES.md
├── README.md
├── LICENSE
└── .gitignore
```

Kedua varian isinya sama (kode identik, Node.js + Python cross-platform);
bedanya hanya dokumen per-OS dan `install.sh` di varian Linux.

## Mulai cepat

* Windows: baca `Faa-Telegram-Bot_win/readme.md`.
* Linux: `./install.sh`, baca `Faa-Telegram-Bot_Linux/readme.md`.

Butuh: Node.js 20+, Python 3.10+, FFmpeg, token `@BotFather`.

## Dari source (repo ini)

```bash
npm install
pip install -U yt-dlp rembg
BOT_TOKEN=... npm start   # Windows: set BOT_TOKEN=... && npm start
```

Jalankan pertama kali muncul setup owner permanen
(minta Telegram user ID, lihat via `@userinfobot`).

## Repo

https://github.com/FaaRamadhann/Faa-TelegramBot
