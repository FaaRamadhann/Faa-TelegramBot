# Release v1.0.0 — Faa-Telegram-Bot

Tanggal: 2026-10-04

Rilis perdana bot Telegram Faa Ramadhan (migrasi penuh dari stack WhatsApp).
Polling Bot API resmi — tanpa QR, tanpa pairing, tanpa browser.

## Isi rilis

| File | Untuk |
|---|---|
| `Faa-Telegram-Bot_win.zip` | Windows 10/11 |
| `Faa-Telegram-Bot_Linux.zip` | Debian/Ubuntu/Termux/chroot |

Masing-masing zip berisi: `index.js`, `src/`, `tests/`, `ytdl.py`,
`remove-bg.py`, `package.json`, `readme.md`, `requirement.md`
(+ `install.sh` di varian Linux). Tanpa `node_modules`
(jalankan `npm install`), tanpa `bot-state.json` (dibuat saat setup pertama).

## Fitur

* **Sticker tools:** `!s`, `!snobg` (flood-fill warna tepi + jujur-check),
  `!aibg` (rembg, model via `REMBG_MODEL`), `!rmbg`, `!smeme`,
  `!brat`, `!bratvid` (animasi ffmpeg), `!qc`, `!quote2`, `!emote`,
  `!e-img`, `!toimg`, pack/author custom + EXIF
* **Image tools:** resize, crop, circle, rotate, flip, compress, border,
  round, bg, wm, caption, blur, pixel, infoimg, stext, ttp
* **Downloader:** `!yta/!ytv` (+kualitas), `!tiktok/!igdl/!fbdl`,
  `!ytdl info/ver` (yt-dlp + timeout + cookies.txt support)
* **AI multi-provider:** OpenRouter/Google/OpenAI —
  `!ai` (+vision + reply-context), `!apikey set/status/reset/use`,
  `!aimodel list/status/set/reset`, cooldown + retry + pesan error jelas
* **Tools:** `!qr`, `!tts`, `!trivia`, `!cuaca`, `!lirik`, `!short`,
  `!calc`, `!quotes`, `!rmeme`, `!broadcast`
* **Game:** coin, dice, suit, math, slot (+owner mode), tebakangka
* **Grup:** groupinfo, tagall, hidetag, kick/promote/demote,
  mute, leave, broadcast (tag berbasis member tercatat)
* **Search:** google, wiki, anime, manga (+API Jikan & Wikipedia)
* **Text:** fancy, reverse, upper, lower, mock, space + translate
  (Google free + fallback kamus)
* **Admin:** prefix runtime, watermark config, owner manage,
  stickerpack, clean, restart, nsfwfilter + safecheck
* **Menu interaktif:** tombol inline per kategori + `!menucommand`
* **Setup pertama:** wizard owner permanen di terminal

## Cara pakai singkat

```bash
npm install
pip install -U yt-dlp rembg
# Windows: set BOT_TOKEN=... && npm start
# Linux:   BOT_TOKEN=... npm start   (atau ./install.sh dulu)
```

Detail per OS ada di `readme.md` masing-masing varian.

## Catatan

* Sticker dikirim via sticker-set Telegram (`faa_pack_by_<bot>`,
  auto-buat). Metadata pack/author custom tidak didukung Bot API
  untuk set statis — judul set mengikuti konfigurasi.
* `!tagall` menandai member yang pernah chat (limitasi Bot API:
  tidak bisa list semua member).
* Model AI default dapat berubah mengikuti ketersediaan tier gratis
  (`!aimodel list` untuk cek live).

Lisensi: GNU GPL v3 (`LICENSE`).
Repo: https://github.com/FaaRamadhann/Faa-TelegramBot
