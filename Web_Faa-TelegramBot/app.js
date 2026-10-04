const COMMANDS = [
  { group: "Sticker", items: [
    ["!s", "gambar/video jadi sticker (+ Pack | Author)"],
    ["!snobg", "hapus background solid"],
    ["!aibg", "hapus background AI"],
    ["!rmbg", "hapus background jadi gambar"],
    ["!smeme", "meme sticker: atas | bawah"],
    ["!brat / !bratvid", "sticker brat + animasi"],
    ["!qc / !quote2", "quote sticker"],
    ["!emote / !e-img", "emoji jadi sticker/gambar"],
    ["!toimg", "sticker jadi gambar"]
  ]},
  { group: "Image Tools", items: [
    ["!resize / !crop / !circle", "ubah ukuran & bentuk"],
    ["!rotate / !flip", "putar & cerminkan"],
    ["!compress / !blur / !pixel", "kompres, blur, pixelate"],
    ["!border / !round / !bg", "bingkai, sudut, background"],
    ["!wm / !caption", "watermark & caption"],
    ["!stext / !ttp", "teks jadi sticker/gambar"],
    ["!infoimg", "info gambar"]
  ]},
  { group: "Downloader", items: [
    ["!yta / !ytv", "MP3/MP4 + kualitas (128/480)"],
    ["!ytdl", "info video / cek versi yt-dlp"],
    ["!tiktok / !igdl / !fbdl", "video sosmed"]
  ]},
  { group: "AI", items: [
    ["!ai", "tanya AI (+gambar vision)"],
    ["!apikey", "set/status/reset key per provider"],
    ["!aimodel", "list/status/set model + harga"]
  ]},
  { group: "Tools", items: [
    ["!qr", "bikin QR code"], ["!tts", "teks jadi suara"],
    ["!trivia", "kuis acak"], ["!cuaca", "cuaca kota"],
    ["!lirik", "lirik lagu"], ["!short", "shortlink"],
    ["!calc", "kalkulator"], ["!quotes", "quote acak"],
    ["!rmeme", "meme random"], ["!broadcast", "siaran owner"]
  ]},
  { group: "Game", items: [
    ["!coin / !dice", "koin & dadu"],
    ["!suit", "suit vs bot"], ["!math", "soal matematika"],
    ["!slot", "slot machine"], ["!tebakangka", "tebak 1-10"]
  ]},
  { group: "Grup", items: [
    ["!groupinfo / !tagall / !hidetag", "info & mention"],
    ["!kick / !promote / !demote", "admin tools"],
    ["!mute on/off / !leave", "kunci & keluar grup"]
  ]},
  { group: "Search & Text", items: [
    ["!google / !wiki", "search & wikipedia"],
    ["!anime / !manga", "Jikan API"],
    ["!tr", "translate multi-bahasa"],
    ["!fancy / !reverse / !mock / !space", "text maker"]
  ]},
  { group: "Admin", items: [
    ["!status / !ping / !id", "status bot"],
    ["!owner / !prefix / !setwm", "owner & config"],
    ["!stickerpack / !clean / !restart", "pack & maintenance"],
    ["!nsfwfilter / !safecheck", "filter NSFW"]
  ]}
];

const FEATURES = [
  ["🎨 Sticker Tools", "s, snobg, aibg, rmbg, meme, brat, quote, emoji — pack/author custom + EXIF."],
  ["⬇ Downloader", "YouTube MP3/MP4 + kualitas, TikTok, Instagram, Facebook via yt-dlp."],
  ["🧠 AI Multi-Provider", "OpenRouter, Google Gemini, OpenAI. Vision + mask key + cooldown."],
  ["🎮 Game & Fun", "Coin, dadu, suit, slot, tebak angka, math, trivia, meme, quotes."],
  ["👥 Grup Admin", "Tag, hidetag, kick, promote, demote, mute, broadcast."],
  ["🔧 Tools", "QR, TTS, cuaca, lirik, shortlink, kalkulator — gratis tanpa API-key."],
  ["🌐 Translate & Search", "Google free + kamus lokal, wiki, anime/manga."],
  ["🛡 Aman & Stabil", "NSFW filter, owner system, anti-spam job-lock, regression test."]
];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function renderFeatures() {
  document.getElementById("feature-grid").innerHTML = FEATURES.map(([t, d]) =>
    `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`
  ).join("");
}

function renderCommands(filter) {
  const q = (filter || "").toLowerCase();
  const html = COMMANDS.map((g) => {
    const items = g.items.filter(([c, d]) =>
      !q || c.toLowerCase().includes(q) || d.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)
    );
    if (!items.length) return "";
    return `<div class="cmd-group"><h3>${esc(g.group)}</h3>` +
      items.map(([c, d]) => `<div class="cmd"><code>${esc(c)}</code> <span>→ ${esc(d)}</span></div>`).join("") +
      `</div>`;
  }).join("");
  document.getElementById("cmd-list").innerHTML = html || "<p>Tidak ketemu. Coba kata lain.</p>";
}

document.getElementById("cmd-search").addEventListener("input", (e) => renderCommands(e.target.value));

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-body").forEach((b) => b.classList.add("hidden"));
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
  });
});

renderFeatures();
renderCommands("");
