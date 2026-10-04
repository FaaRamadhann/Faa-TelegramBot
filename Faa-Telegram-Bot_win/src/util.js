const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const https = require("https");
const { CONFIG } = require("./state");

function normalizeText(text) {
    return String(text || "").trim();
}

function escapeXml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function parseCommand(body) {
    const clean = normalizeText(body);

    if (!clean.startsWith(CONFIG.prefix)) {
        return { isCommand: false, command: "", args: [], rawArgs: "" };
    }

    const withoutPrefix = clean.slice(CONFIG.prefix.length).trim();
    const parts = withoutPrefix.split(/\s+/);
    const command = (parts.shift() || "").toLowerCase();
    const rawArgs = withoutPrefix.slice(command.length).trim();

    return { isCommand: command.length > 0, command, args: parts, rawArgs };
}

function commandIn(command, list) {
    return list.includes(command);
}

function getCommandRegistry() {
    return Object.entries(CONFIG.commands).flatMap(([group, aliases]) =>
        aliases.map((alias) => ({ group, alias }))
    );
}

function isKnownCommand(command) {
    return getCommandRegistry().some((item) => item.alias === command);
}

function levenshteinDistance(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prev = Array.from({ length: n + 1 }, (_, j) => j);

    for (let i = 1; i <= m; i++) {
        const curr = [i];
        for (let j = 1; j <= n; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = curr;
    }

    return prev[n];
}

function suggestCommand(command) {
    const aliases = [...new Set(getCommandRegistry().map((item) => item.alias))];
    let best = "";
    let bestDist = Infinity;

    for (const alias of aliases) {
        const dist = levenshteinDistance(command, alias);
        if (dist < bestDist) {
            bestDist = dist;
            best = alias;
        }
    }

    if (bestDist <= 2 && best) return best;
    return "";
}

function getCommandUsage(command) {
    const usages = {
        sticker: "Reply/kirim gambar/video: !s",
        stickerNoBgSimple: "Reply/kirim gambar: !snobg (background solid: putih/merah/hitam merata)",
        stickerNoBgAI: "Reply/kirim gambar: !aibg",
        removeBgImage: "Reply/kirim gambar: !rmbg",
        stickerMeme: "Reply gambar: !smeme teks atas | teks bawah",
        bratSticker: "!brat teks -> sticker hijau brat",
        bratVideo: "!bratvid teks -> sticker brat animasi",
        quoteSticker: "!qc teks atau reply pesan: !qc",
        emojiSticker: "!emoji 😭 / !emoji 🫰🏻💛",
        emojiToImage: "!e-img 😭",
        toImage: "Reply sticker: !toimg",
        resize: "Reply gambar: !resize 512 atau !resize 800 450",
        crop: "Reply gambar: !crop",
        watermark: "Reply gambar: !wm teks",
        stext: "!stext teks",
        ttp: "!ttp teks",
        circle: "Reply gambar: !circle",
        rotate: "Reply gambar: !rotate 90",
        flip: "Reply gambar: !flip h / !flip v",
        compress: "Reply gambar: !compress 65",
        border: "Reply gambar: !border 20 #ffffff",
        round: "Reply gambar: !round 45",
        background: "Reply gambar: !bg #ffffff",
        caption: "Reply gambar: !caption teks",
        menu: "!menu",
        menuCommand: "!menucommand -> tampilkan semua command lengkap",
        ping: "!ping",
        id: "!id",
        ytdlInfo: "!ytdl <url> | !ytdl ver | !yta 128 <url> | !ytv 480 <url>",
        yta: "!yta <url> atau reply URL: !yta",
        ytv: "!ytv <url> atau reply URL: !ytv",
        tiktokDl: "!tiktok <url tiktok>",
        igDl: "!igdl <url instagram>",
        fbDl: "!fbdl <url facebook>",
        qrGen: "!qr teks -> gambar QR code",
        tts: "!tts id halo dunia / !tts en hello",
        trivia: "!trivia -> kuis acak",
        weather: "!cuaca jakarta",
        lyrics: "!lirik coldplay - yellow",
        shortlink: "!short <url panjang>",
        calc: "!calc 12*8+5",
        quotes: "!quotes -> quote acak",
        randomMeme: "!rmeme -> meme random",
        pixel: "Reply gambar: !pixel 16",
        imageInfo: "Reply gambar/sticker: !infoimg",
        quoteModern: "!quote2 teks atau reply pesan: !quote2",
        restart: "!restart untuk restart bot. Khusus owner/self.",
        menuGames: "!menugames",
        menuGroup: "!menugroup",
        menuGoogle: "!menugoogle",
        menuAnime: "!menuanime",
        menuSearch: "!menusearch",
        menuTextMaker: "!menutextmaker",
        menuTranslate: "!menutranslate",
        menuSticker: "!menusticker",
        coin: "!coin",
        dice: "!dice",
        suit: "!suit batu/kertas/gunting",
        mathGame: "!math",
        slot: "!slot -> spin slot machine",
        tebakAngka: "!tebakangka 7 -> tebak angka 1-10",
        gameHelp: "!gamehelp -> detail command game",
        groupInfo: "!groupinfo",
        tagAll: "!tagall",
        hideTag: "!hidetag teks",
        kick: "!kick (reply/tag target)",
        promote: "!promote (reply/tag target)",
        demote: "!demote (reply/tag target)",
        muteGroup: "!mute on/off",
        leaveGroup: "!leave (di grup)",
        joinGroup: "!join <link invite>",
        broadcast: "!broadcast teks (owner, ke semua grup)",
        googleSearch: "!google query",
        wikiSearch: "!wiki query",
        animeSearch: "!anime naruto",
        mangaSearch: "!manga one piece",
        fancyText: "!fancy teks",
        reverseText: "!reverse teks",
        upperText: "!uppercase teks",
        lowerText: "!lowercase teks",
        mockText: "!mock teks",
        spaceText: "!space teks",
        translate: "!tr en > id hello / !tr auto > id hello",
        aiChat: "!ai teks / reply pesan + !ai",
        apiKey: "!apikey status/set/reset (owner)",
        aiModel: "!aimodel status/list/set/reset (owner)",
        status: "!status untuk cek kondisi bot",
        clean: "!clean untuk hapus file temp/downloads. Khusus owner/self.",
        prefix: "!prefix . untuk ganti prefix runtime",
        setWatermark: "!setwm on/off | !setwm text Faa Bot | !setwm opacity 0.7",
        ownerManage: "!owner list/add/del/only. Khusus owner/self.",
        stickerPack: "!stickerpack Pack Name | Author Name",
        blur: "Reply gambar: !blur 8",
        profilePicture: "!pp atau reply pesan: !pp",
        nsfwFilter: "!nsfwfilter on/off/status/strict on/off",
        safeCheck: "!safecheck teks/link -> cek apakah diblokir"};

    const item = getCommandRegistry().find((entry) => entry.alias === command);
    if (!item) return "Command tidak ditemukan. Gunakan !menu.";
    return usages[item.group] || "Gunakan !menu untuk melihat format command.";
}

const activeJobs = new Map();

function getActiveJobCount(sender) {
    return activeJobs.get(sender) || 0;
}

async function runWithUserJobLock(message, task) {
    if (!CONFIG.jobs || !CONFIG.jobs.enabled) return await task();

    const sender = getSenderId(message);
    const active = getActiveJobCount(sender);

    if (active >= CONFIG.jobs.maxPerUser) {
        await message.replyText("Masih ada proses command sebelumnya. Tunggu sampai selesai.");
        return;
    }

    activeJobs.set(sender, active + 1);

    try {
        return await task();
    } finally {
        const next = Math.max(0, getActiveJobCount(sender) - 1);
        if (next === 0) activeJobs.delete(sender);
        else activeJobs.set(sender, next);
    }
}

function getSenderId(message) {
    return String(message.senderJid || message.author || message.from || "unknown");
}

function parseResizeDimensions(rawArgs) {
    const args = normalizeText(rawArgs).split(/\s+/).filter(Boolean);
    const width = Math.min(Math.max(parseNumber(args[0], 512), 32), 2048);
    const height = Math.min(Math.max(parseNumber(args[1], width), 32), 2048);
    return { width, height };
}

function isPrivateOrLocalHost(hostname) {
    const clean = String(hostname || "").toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(clean)) return true;
    if (/^10\./.test(clean)) return true;
    if (/^192\.168\./.test(clean)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(clean)) return true;
    return false;
}

function validatePublicUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);

        if (!CONFIG.security.allowedDownloadProtocols.includes(url.protocol)) {
            return { ok: false, reason: "Protocol URL tidak diizinkan." };
        }

        if (CONFIG.security.blockLocalUrls && isPrivateOrLocalHost(url.hostname)) {
            return { ok: false, reason: "URL lokal/private diblokir demi keamanan." };
        }

        return { ok: true, url: url.toString() };
    } catch {
        return { ok: false, reason: "URL tidak valid." };
    }
}

function extractFirstUrl(text) {
    const match = String(text || "").match(/https?:\/\/[^\s]+/i);
    return match ? match[0] : "";
}

function getMediaSizeMB(media) {
    if (!media || !media.data) return 0;
    return Buffer.from(media.data, "base64").length / (1024 * 1024);
}

function isImageMime(mimetype) {
    return typeof mimetype === "string" && mimetype.startsWith("image/");
}

function isVideoMime(mimetype) {
    return typeof mimetype === "string" && mimetype.startsWith("video/");
}

function isWebpMime(mimetype) {
    return mimetype === "image/webp";
}

function isStickerSourceMime(mimetype) {
    return isImageMime(mimetype) || isVideoMime(mimetype);
}

function mimeToExtension(mimetype) {
    const map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/3gpp": ".3gp",
        "video/quicktime": ".mov"
    };

    return map[mimetype] || ".bin";
}

function parseNumber(value, fallback) {
    const num = Number.parseInt(value, 10);
    return Number.isFinite(num) ? num : fallback;
}

function parseColor(value, fallback = "#ffffff") {
    const clean = normalizeText(value);
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean;
    if (/^[0-9a-fA-F]{6}$/.test(clean)) return `#${clean}`;
    return fallback;
}

function hexToRgba(hex, alpha = 1) {
    const clean = hex.replace("#", "");
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
        alpha
    };
}

function sanitizeCaptionText(text, max = 120) {
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

    let clean = String(text || "")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/[\x00-\x1f\x80-\x9f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "")
        .slice(0, max);

    if (!clean || reserved.test(clean)) clean = "media";

    return clean;
}

function formatUptime(seconds) {
    const total = Math.floor(seconds);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    const parts = [];

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(" ");
}

async function countFilesInDir(dirPath) {
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).length;
    } catch {
        return 0;
    }
}

async function cleanFilesInDir(dirPath) {
    const result = { deleted: 0, failed: 0 };

    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile()) continue;

            const filePath = path.join(dirPath, entry.name);

            try {
                await fsp.unlink(filePath);
                result.deleted++;
            } catch {
                result.failed++;
            }
        }
    } catch {
        result.failed++;
    }

    return result;
}

async function safeUnlink(filePath) {
    try {
        await fsp.unlink(filePath);
    } catch (_) {}
}

async function safeUnlinkMany(paths) {
    for (const filePath of paths) {
        await safeUnlink(filePath);
    }
}

function encodeQuery(value) {
    return encodeURIComponent(String(value || "").trim());
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function httpGetBuffer(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error("Too many redirects."));
            return;
        }

        const req = https.get(
            url,
            { headers: { "User-Agent": "Mozilla/5.0 faaramadhan_wa-bot" } },
            (res) => {
                const status = res.statusCode || 0;

                if ([301, 302, 303, 307, 308].includes(status)) {
                    const location = res.headers.location;
                    res.resume();

                    if (!location) {
                        reject(new Error("Redirect without location."));
                        return;
                    }

                    const nextUrl = new URL(location, url).toString();
                    httpGetBuffer(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                    return;
                }

                if (status < 200 || status >= 300) {
                    res.resume();
                    reject(new Error(`HTTP ${status}: ${url}`));
                    return;
                }

                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => resolve(Buffer.concat(chunks)));
            }
        );

        req.on("error", reject);
        req.setTimeout(15000, () => req.destroy(new Error("Request timeout.")));
    });
}

function httpPostJson(url, body, headers = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body || {});
        const parsed = new URL(url);

        const req = https.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname + (parsed.search || ""),
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                    "User-Agent": "Mozilla/5.0 faaramadhan_wa-bot",
                    ...headers
                }
            },
            (res) => {
                const status = res.statusCode || 0;
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");

                    if (status < 200 || status >= 300) {
                        reject(new Error(`HTTP ${status}: ${text.slice(0, 300)}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(text));
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        );

        req.on("error", reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error("Request timeout.")));
        req.write(payload);
        req.end();
    });
}

function httpGetJson(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error("Too many redirects."));
            return;
        }

        const req = https.get(
            url,
            { headers: { "User-Agent": "Mozilla/5.0 faaramadhan-wa-bot" } },
            (res) => {
                const status = res.statusCode || 0;

                if ([301, 302, 303, 307, 308].includes(status)) {
                    const location = res.headers.location;
                    res.resume();

                    if (!location) {
                        reject(new Error("Redirect without location."));
                        return;
                    }

                    const nextUrl = new URL(location, url).toString();
                    httpGetJson(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                    return;
                }

                if (status < 200 || status >= 300) {
                    res.resume();
                    reject(new Error("HTTP " + status));
                    return;
                }

                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        );

        req.on("error", reject);
        req.setTimeout(15000, () => req.destroy(new Error("Request timeout.")));
    });
}

function getDependencyVersions() {
    const readVersion = (pkgName) => {
        try {
            const raw = fs.readFileSync(
                path.join(__dirname, "..", "node_modules", pkgName, "package.json"),
                "utf8"
            );
            return JSON.parse(raw).version || "?";
        } catch {
            return "?";
        }
    };

    return {
        tgapi: readVersion("node-telegram-bot-api"),
        sharp: readVersion("sharp")
    };
}

// ---------- JID / owner helpers ----------

function bareJid(jid) {
    return String(jid || "").split("@")[0].split(":")[0];
}

function extractDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

function normalizeJidForOwner(value) {
    return extractDigits(value);
}

function normalizeOwnerId(raw) {
    const clean = normalizeText(raw);
    if (!clean) return "";
    return clean.replace(/\D/g, "");
}

function isOwnerIdMatch(senderIds) {
    const ownersRaw = CONFIG.owners.map((id) => String(id));
    const ownersNormalized = CONFIG.owners.map(normalizeJidForOwner);
    const ownerDigits = CONFIG.owners.map(extractDigits).filter(Boolean);

    for (const sender of senderIds) {
        const senderRaw = String(sender);
        const senderNormalized = normalizeJidForOwner(senderRaw);
        const senderDigits = extractDigits(senderRaw);

        if (ownersRaw.includes(senderRaw)) return true;
        if (ownersNormalized.includes(senderNormalized)) return true;
        if (senderDigits && ownerDigits.includes(senderDigits)) return true;
    }

    return false;
}

// ---------- translate ----------

const LANG_ALIASES = {
    auto: "auto", detect: "auto",
    id: "id", indonesia: "id", indonesian: "id", indo: "id",
    en: "en", english: "en", inggris: "en",
    ja: "ja", jp: "ja", jepang: "ja", japanese: "ja",
    ko: "ko", korea: "ko", korean: "ko",
    ar: "ar", arab: "ar", arabic: "ar",
    zh: "zh", cn: "zh", china: "zh", chinese: "zh", mandarin: "zh",
    ms: "ms", melayu: "ms", malay: "ms",
    fr: "fr", french: "fr", prancis: "fr",
    de: "de", german: "de", jerman: "de",
    es: "es", spanish: "es", spanyol: "es",
    it: "it", italian: "it", itali: "it",
    ru: "ru", russian: "ru", rusia: "ru",
    th: "th", thai: "th", thailand: "th"
};

const LOCAL_ID_EN_DICT = {
    makan: "eat",
    minum: "drink",
    tidur: "sleep",
    belajar: "study",
    sekolah: "school",
    rumah: "house",
    nasi: "rice",
    air: "water",
    aku: "I",
    saya: "I",
    kamu: "you",
    dia: "he/she",
    mereka: "they",
    kita: "we",
    pergi: "go",
    datang: "come",
    kerja: "work",
    suka: "like",
    cinta: "love",
    baik: "good",
    buruk: "bad",
    cepat: "fast",
    lambat: "slow",
    pagi: "morning",
    malam: "night",
    "terima kasih": "thank you",
    "selamat pagi": "good morning",
    "selamat malam": "good night",
    "aku makan nasi": "I eat rice",
    "saya makan nasi": "I eat rice"
};

const LOCAL_EN_ID_DICT = Object.fromEntries(
    Object.entries(LOCAL_ID_EN_DICT).map(([key, value]) => [String(value).toLowerCase(), key])
);

function normalizeLangCode(input) {
    const clean = normalizeText(input).toLowerCase();
    return LANG_ALIASES[clean] || clean;
}

function detectLanguageSimple(text) {
    const lower = String(text || "").toLowerCase();
    const idWords = ["aku", "kamu", "saya", "dia", "mereka", "yang", "dan", "atau", "tidak", "dengan", "ke", "dari", "makan", "belajar", "selamat", "pagi", "nasi"];
    const score = idWords.reduce((sum, word) => sum + (new RegExp("\\b" + word + "\\b").test(lower) ? 1 : 0), 0);
    return score >= 1 ? "id" : "en";
}

function parseTranslateArgs(rawArgs) {
    const raw = normalizeText(rawArgs);
    const match = raw.match(/^(.+?)\s*>\s*(\S+)\s+([\s\S]+)$/);

    if (!match) return null;

    let source = normalizeLangCode(match[1]);
    const target = normalizeLangCode(match[2]);
    const text = normalizeText(match[3]);

    if (!target || !text) return null;
    if (source === "auto") source = detectLanguageSimple(text);

    return { source, target, text };
}

function normalizeTranslateResult(value) {
    return String(value || "")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .trim();
}

function isBadTranslateResult(input, output, source, target) {
    const src = normalizeText(input).toLowerCase();
    const out = normalizeText(output).toLowerCase();

    if (!out) return true;
    if (source !== target && src === out) return true;
    if (out === "null" || out === "undefined") return true;

    return false;
}

function localDictionaryTranslate(text, source, target) {
    const clean = normalizeText(text).toLowerCase();

    if (source === "id" && target === "en") {
        if (LOCAL_ID_EN_DICT[clean]) return LOCAL_ID_EN_DICT[clean];
        const words = clean.split(/\s+/).filter(Boolean);
        const translated = words.map((word) => LOCAL_ID_EN_DICT[word] || word);
        if (translated.some((word, index) => word !== words[index])) return translated.join(" ");
    }

    if (source === "en" && target === "id") {
        if (LOCAL_EN_ID_DICT[clean]) return LOCAL_EN_ID_DICT[clean];
        const words = clean.split(/\s+/).filter(Boolean);
        const translated = words.map((word) => LOCAL_EN_ID_DICT[word] || word);
        if (translated.some((word, index) => word !== words[index])) return translated.join(" ");
    }

    return "";
}

async function translateWithGoogleFree(text, source, target) {
    const sl = source === "auto" ? "auto" : source;
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + encodeQuery(sl) + "&tl=" + encodeQuery(target) + "&dt=t&q=" + encodeQuery(text);
    const data = await httpGetJson(url);

    if (!Array.isArray(data) || !Array.isArray(data[0])) return "";

    return normalizeTranslateResult(
        data[0]
            .map((part) => Array.isArray(part) ? part[0] : "")
            .join("")
    );
}

// ---------- NSFW ----------

const NSFW_KEYWORDS = [
    "nsfw",
    "18+",
    "adult",
    "porn",
    "xxx",
    "bokep",
    "hentai",
    "doujin",
    "jav",
    "nude",
    "nudity",
    "onlyfans",
    "rule34",
    "sex",
    "lewd"
];

const NSFW_STRICT_KEYWORDS = [
    "ecchi",
    "suggestive",
    "fanservice",
    "bikini",
    "lingerie"
];

const NSFW_DOMAIN_PARTS = [
    "porn",
    "xxx",
    "adult",
    "hentai",
    "rule34",
    "onlyfans",
    "xvideos",
    "xnxx"
];

function normalizeSafetyText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[._\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractUrlsFromText(text) {
    return String(text || "").match(/https?:\/\/[^\s]+/gi) || [];
}

function isNsfwDomain(urlText) {
    try {
        const url = new URL(urlText);
        const host = normalizeSafetyText(url.hostname);
        return NSFW_DOMAIN_PARTS.some((part) => host.includes(part));
    } catch {
        return false;
    }
}

function checkNsfwText(text) {
    const normalized = normalizeSafetyText(text);
    const matched = [];

    if (!CONFIG.nsfwFilter || !CONFIG.nsfwFilter.enabled) {
        return { blocked: false, reason: "", matched: [] };
    }

    if (CONFIG.nsfwFilter.blockKeywords) {
        for (const keyword of NSFW_KEYWORDS) {
            const cleanKeyword = normalizeSafetyText(keyword);

            if (normalized.includes(cleanKeyword)) {
                matched.push(keyword);
            }
        }

        if (CONFIG.nsfwFilter.strictMode) {
            for (const keyword of NSFW_STRICT_KEYWORDS) {
                const cleanKeyword = normalizeSafetyText(keyword);

                if (normalized.includes(cleanKeyword)) {
                    matched.push(keyword);
                }
            }
        }
    }

    if (matched.length > 0) {
        return { blocked: true, reason: "keyword", matched: [...new Set(matched)] };
    }

    if (CONFIG.nsfwFilter.blockLinks) {
        const urls = extractUrlsFromText(text);
        const badUrl = urls.find(isNsfwDomain);

        if (badUrl) {
            return { blocked: true, reason: "link", matched: [badUrl] };
        }
    }

    return { blocked: false, reason: "", matched: [] };
}

// ---------- games text ----------

const GAME_RESPONSES = {
    coinIntro: [
        "Koin dilempar ke udara...",
        "Koin muter dulu bentar...",
        "Lempar koin mode random...",
        "Koin naik, nasib turun...",
        "Koin sedang menentukan takdir..."
    ],
    coinHead: [
        "Koin jatuh di sisi kepala.",
        "Hasilnya kepala. Lumayan hoki.",
        "Kepala muncul. Bot menyaksikan.",
        "Kepala. Keputusan sudah mutlak.",
        "Sisi kepala menang kali ini."
    ],
    coinTail: [
        "Koin jatuh di sisi ekor.",
        "Hasilnya ekor. Masih valid.",
        "Ekor muncul. Nasib berkata begitu.",
        "Ekor. Tidak bisa diganggu gugat.",
        "Sisi ekor menang kali ini."
    ],
    diceNormal: [
        "Roll selesai.",
        "Dadu berhenti muter.",
        "Angka sudah keluar.",
        "Hasil dadu valid.",
        "Dadu sudah menentukan."
    ],
    diceHigh: [
        "Angka tinggi. Lumayan gacor.",
        "Roll bagus. Hampir maksimal.",
        "Dadu lagi berpihak ke lu.",
        "Hasilnya kuat.",
        "Nice roll."
    ],
    diceSix: [
        "Angka tertinggi. Jackpot kecil.",
        "Enam. Dadu lagi nurut.",
        "Max roll. Gacor.",
        "Angka 6 keluar. Solid.",
        "Perfect roll."
    ],
    suitWin: [
        "Pilihan lu counter pilihan bot.",
        "Lu baca gerakan bot dengan benar.",
        "Bot kena counter bersih.",
        "Lu menang fair.",
        "Strategi lu masuk."
    ],
    suitLose: [
        "Bot berhasil counter pilihan lu.",
        "Bot lebih hoki ronde ini.",
        "Lu kena counter.",
        "Ronde ini bot menang.",
        "Bot membaca pilihan lu."
    ],
    suitDraw: [
        "Kekuatan sama. Seri.",
        "Pilihan sama. Tidak ada pemenang.",
        "Seri bersih.",
        "Dua-duanya mikir hal yang sama.",
        "Draw. Ulang kalau mau."
    ],
    slotLose: [
        "Belum hoki. Coba lagi.",
        "Mesin slot dingin.",
        "Kalah tipis atau jauh, tetap kalah.",
        "Belum tembus.",
        "Spin gagal gacor."
    ],
    slotNear: [
        "Dua simbol sama. Hampir jackpot.",
        "Nyarisss. Mesin mulai panas.",
        "Kurang satu simbol lagi.",
        "Dekat banget.",
        "Hampir tembus."
    ],
    slotJackpot: [
        "Tiga simbol sama. Gacor.",
        "Jackpot bersih.",
        "Mesin slot meledak.",
        "Full match. Hoki aktif.",
        "Tembus jackpot."
    ],
    guessCorrect: [
        "Tebakan tepat.",
        "Lu nebak dengan akurat.",
        "Benar. Insting lu jalan.",
        "Pas banget.",
        "Jawaban lu kena."
    ],
    guessNear: [
        "Dekat banget.",
        "Selisih tipis.",
        "Hampir benar.",
        "Nyarisss.",
        "Kurang dikit."
    ],
    guessFar: [
        "Masih jauh.",
        "Belum dekat.",
        "Tebakan meleset.",
        "Jauh dari angka bot.",
        "Coba feeling lain."
    ],
    mathIntro: [
        "Kerjakan tanpa kalkulator kalau berani.",
        "Soal random masuk.",
        "Tes otak ringan.",
        "Math challenge aktif.",
        "Hitung cepat."
    ]
};

function randomGameText(type) {
    const pool = GAME_RESPONSES[type] || ["Done."];
    return randomItem(pool);
}

function requireTextArgSync(rawArgs) {
    return normalizeText(rawArgs);
}

function normalizeTextStyleColor(value, fallback = "white") {
    const clean = normalizeText(value);

    if (!clean) return fallback;

    const lower = clean.toLowerCase();

    if (lower === "transparent" || lower === "none") return "transparent";

    return parseColor(clean, fallback);
}

module.exports = {
    normalizeText,
    escapeXml,
    parseCommand,
    commandIn,
    getCommandRegistry,
    isKnownCommand,
    levenshteinDistance,
    suggestCommand,
    getCommandUsage,
    activeJobs,
    getActiveJobCount,
    runWithUserJobLock,
    getSenderId,
    parseResizeDimensions,
    isPrivateOrLocalHost,
    validatePublicUrl,
    extractFirstUrl,
    getMediaSizeMB,
    isImageMime,
    isVideoMime,
    isWebpMime,
    isStickerSourceMime,
    mimeToExtension,
    parseNumber,
    parseColor,
    hexToRgba,
    normalizeTextStyleColor,
    sanitizeCaptionText,
    formatUptime,
    countFilesInDir,
    cleanFilesInDir,
    safeUnlink,
    safeUnlinkMany,
    encodeQuery,
    randomItem,
    httpGetBuffer,
    httpGetJson,
    httpPostJson,
    getDependencyVersions,
    bareJid,
    extractDigits,
    normalizeJidForOwner,
    normalizeOwnerId,
    isOwnerIdMatch,
    normalizeLangCode,
    detectLanguageSimple,
    parseTranslateArgs,
    normalizeTranslateResult,
    isBadTranslateResult,
    localDictionaryTranslate,
    translateWithGoogleFree,
    NSFW_KEYWORDS,
    NSFW_STRICT_KEYWORDS,
    NSFW_DOMAIN_PARTS,
    normalizeSafetyText,
    extractUrlsFromText,
    isNsfwDomain,
    checkNsfwText,
    GAME_RESPONSES,
    randomGameText,
    requireTextArgSync
};
