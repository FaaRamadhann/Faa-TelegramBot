# Requirement — Faa-Telegram-Bot (Windows)

Yang dibutuhkan sebelum jalan:

| Kebutuhan | Versi minimal | Cara dapat |
|---|---|---|
| Node.js | v20+ (disarankan LTS) | https://nodejs.org (centang "Add to PATH") |
| Python | 3.10+ | `winget install Python.Python.3.12` atau python.org (centang "Add to PATH") |
| FFmpeg | bebas | `winget install Gyan.FFmpeg` lalu restart terminal |
| Token bot Telegram | - | Chat `@BotFather` > `/newbot` > copy token |
| API key (opsional) | - | `!ai` butuh OpenRouter/Google/OpenAI key |

Cek instalasi:

```bat
node -v
py -3 --version
ffmpeg -version
```

Python dipakai untuk: `yt-dlp` (downloader `!yta/!ytv/!tiktok/!igdl/!fbdl`) dan
`rembg` (AI hapus background `!aibg`). Install modul Python sekali:

```bat
py -3 -m pip install -U yt-dlp rembg
```

Verifikasi yt-dlp:

```bat
py -3 -m yt_dlp --version
```
