const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const TEMP_DIR = path.join(ROOT_DIR, "temp");
const DOWNLOAD_DIR = path.join(ROOT_DIR, "downloads");
const PYTHON_SCRIPT = path.join(ROOT_DIR, "remove-bg.py");
const YTDL_SCRIPT = path.join(ROOT_DIR, "ytdl.py");
const STATE_FILE = path.join(ROOT_DIR, "bot-state.json");

const CONFIG = {
    botName: "Faa Ramadhan Bot Telegram",
    stickerAuthor: "Faa Ramadhan Bot",
    defaultStickerPack: "Sticker Bot",
    prefix: "!",
    allowSelfMessage: true,
    ownerOnly: false,
    owners: [],
    seenGroups: [],
    seenUsers: {},
    maxMediaSizeMB: 16,
    whiteBgThreshold: 240,

    jobs: {
        enabled: true,
        maxPerUser: 1
    },

    security: {
        allowedDownloadProtocols: ["http:", "https:"],
        blockLocalUrls: true
    },

    visualWatermark: {
        enabled: false,
        text: "Faa Bot",
        opacity: 0.55
    },

    nsfwFilter: {
        enabled: true,
        blockLinks: true,
        blockKeywords: true,
        strictMode: false
    },

    ai: {
        apiKey: "",
        keys: { openrouter: "", google: "", openai: "" },
        provider: "openrouter",
        models: {
            openrouter: "qwen/qwen3.8-27b:free",
            google: "gemini-2.0-flash",
            openai: "gpt-4o-mini"
        },
        model: "qwen/qwen3.8-27b:free",
        systemPrompt: "Jawablah dalam Bahasa Indonesia yang santai kecuali diminta bahasa lain. Jawaban ringkas, maksimal 800 karakter kecuali diminta panjang.",
        maxTokens: 1024
    },

    emojiSticker: {
        maxEmoji: 4
    },

    twemoji: {
        baseUrl: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg",
        maxEmoji: 4
    },

    commands: {
        sticker: ["s", "sticker", "stiker"],
        stickerNoBgSimple: ["snobg", "nobg"],
        stickerNoBgAI: ["aibg", "stikeraibg", "bgai"],
        removeBgImage: ["rmbg", "removebg", "hapusbg"],
        stickerMeme: ["smeme", "stickermeme", "meme"],
        bratSticker: ["brat", "bratsticker"],
        bratVideo: ["bratvid", "bratvideo", "bratgif"],
        quoteSticker: ["qc", "quote", "quotesticker"],
        emojiSticker: ["emote", "emoji", "emo"],
        emojiToImage: ["e-img", "eimg", "emojiimg", "emimg"],
        toImage: ["toimg", "img"],
        resize: ["resize"],
        crop: ["crop"],
        watermark: ["wm", "watermark"],
        stext: ["stext"],
        ttp: ["ttp"],
        circle: ["circle"],
        rotate: ["rotate"],
        flip: ["flip"],
        compress: ["compress"],
        border: ["border"],
        round: ["round"],
        background: ["bg"],
        caption: ["caption"],
        menu: ["menu", "help", "start"],
        menuCommand: ["menucommand", "allmenu", "allcmd", "commands"],
        ping: ["ping"],
        id: ["id", "chatid"],
        yta: ["yta", "mp3", "audio"],
        ytv: ["ytv", "mp4", "video"],
        tiktokDl: ["tiktok", "ttdl", "tt"],
        igDl: ["igdl", "instagram", "ig"],
        fbDl: ["fbdl", "facebook", "fb"],
        qrGen: ["qr", "qrcode", "qrgen"],
        tts: ["tts", "say", "ngomong"],
        trivia: ["trivia", "kuis", "quiz"],
        weather: ["cuaca", "weather", "bmkg"],
        lyrics: ["lirik", "lyrics", "lyric"],
        shortlink: ["short", "pendek", "shortlink"],
        calc: ["calc", "kalkulator", "hitung", "kali"],
        quotes: ["quotes", "quoteacak", "katabijak"],
        randomMeme: ["rmeme", "randommeme", "memerandom"],
        ytdlInfo: ["ytdl", "ytinfo", "dlinfo"],
        helpCommand: ["helpcmd", "cmd", "usage"],
        pixel: ["pixel", "pixelate"],
        imageInfo: ["infoimg", "imginfo", "imageinfo"],
        quoteModern: ["quote2", "qc2", "modernquote"],
        restart: ["restart", "reboot"],

        menuGames: ["menugames", "gamesmenu"],
        menuGroup: ["menugroup", "groupmenu"],
        menuGoogle: ["menugoogle", "googlemenu"],
        menuAnime: ["menuanime", "animemenu"],
        menuSearch: ["menusearch", "searchmenu"],
        menuTextMaker: ["menutextmaker", "textmakermenu"],
        menuTranslate: ["menutranslate", "translatemenu"],
        menuSticker: ["menusticker", "stickermenu"],

        coin: ["coin", "flipcoin"],
        dice: ["dice", "dadu"],
        suit: ["suit", "rps"],
        mathGame: ["math", "matematika"],
        slot: ["slot", "slots"],
        tebakAngka: ["tebakangka", "guessnumber", "tebaknomor"],
        gameHelp: ["gamehelp", "helpgame"],

        groupInfo: ["groupinfo", "infogrup"],
        tagAll: ["tagall"],
        hideTag: ["hidetag", "ht"],
        kick: ["kick", "tendang", "kickout"],
        promote: ["promote", "promot", "jadikanadmin"],
        demote: ["demote", "demot", "turunkanadmin"],
        muteGroup: ["mute", "tutupgrup", "bukagrup"],
        leaveGroup: ["leave", "left", "keluargrup"],
        broadcast: ["broadcast", "bc", "siaran"],

        googleSearch: ["google", "g"],
        wikiSearch: ["wiki", "wikipedia"],

        animeSearch: ["anime", "animesearch"],
        mangaSearch: ["manga", "mangasearch"],

        fancyText: ["fancy", "fancytext"],
        reverseText: ["reverse", "balik"],
        upperText: ["uppercase", "upper"],
        lowerText: ["lowercase", "lower"],
        mockText: ["mock", "mocking"],
        spaceText: ["space", "spasi"],

        translate: ["tr", "translate", "terjemah"],
        aiChat: ["ai", "tanya", "ask", "gpt"],
        apiKey: ["apikey", "api-key", "apikeys"],
        aiModel: ["aimodel", "model"],
        status: ["status", "botstatus", "runtime"],
        clean: ["clean", "cleanup", "cleartemp"],
        prefix: ["prefix", "setprefix"],
        setWatermark: ["setwm", "wmconfig"],
        ownerManage: ["owner", "owners", "own", "owner."],
        stickerPack: ["stickerpack", "pack", "setpack"],
        blur: ["blur"],
        profilePicture: ["pp", "profile", "profilepic"],
        nsfwFilter: ["nsfwfilter", "safeonly", "safemode"],
        safeCheck: ["safecheck", "checksafe"],
        debugQuote: ["dbgquote", "dbgsend"]}
};

function ensureDirSync(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

ensureDirSync(TEMP_DIR);
ensureDirSync(DOWNLOAD_DIR);

function getDefaultState() {
    return {
        owners: CONFIG.owners,
        seenGroups: CONFIG.seenGroups,
        seenUsers: CONFIG.seenUsers,
        ai: CONFIG.ai,
        nsfwFilter: CONFIG.nsfwFilter,
        ownerOnly: CONFIG.ownerOnly,
        prefix: CONFIG.prefix,
        stickerAuthor: CONFIG.stickerAuthor,
        defaultStickerPack: CONFIG.defaultStickerPack,
        visualWatermark: {
            enabled: CONFIG.visualWatermark.enabled,
            text: CONFIG.visualWatermark.text,
            opacity: CONFIG.visualWatermark.opacity
        }
    };
}

function loadBotState() {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            saveBotState();
            return;
        }

        const raw = fs.readFileSync(STATE_FILE, "utf8");
        const state = JSON.parse(raw);

        if (Array.isArray(state.owners)) CONFIG.owners = state.owners.map(String);
        if (Array.isArray(state.seenGroups)) CONFIG.seenGroups = state.seenGroups;
        if (state.seenUsers && typeof state.seenUsers === "object") CONFIG.seenUsers = state.seenUsers;
        if (state.ai && typeof state.ai === "object") {
            // Migrasi format lama: apiKey tunggal -> keys.openrouter.
            if (typeof state.ai.apiKey === "string" && state.ai.apiKey && !(state.ai.keys && state.ai.keys.openrouter)) {
                CONFIG.ai.keys.openrouter = state.ai.apiKey;
                CONFIG.ai.provider = "openrouter";
            }
            if (state.ai.keys && typeof state.ai.keys === "object") {
                for (const p of ["openrouter", "google", "openai"]) {
                    if (typeof state.ai.keys[p] === "string") CONFIG.ai.keys[p] = state.ai.keys[p];
                }
            }
            if (typeof state.ai.provider === "string" && ["openrouter", "google", "openai"].includes(state.ai.provider)) {
                CONFIG.ai.provider = state.ai.provider;
            }
            if (state.ai.models && typeof state.ai.models === "object") {
                for (const p of ["openrouter", "google", "openai"]) {
                    if (typeof state.ai.models[p] === "string" && state.ai.models[p]) CONFIG.ai.models[p] = state.ai.models[p];
                }
            }
            if (typeof state.ai.model === "string" && state.ai.model) CONFIG.ai.model = state.ai.model;
            if (typeof state.ai.systemPrompt === "string" && state.ai.systemPrompt) CONFIG.ai.systemPrompt = state.ai.systemPrompt;
            if (Number.isFinite(state.ai.maxTokens)) CONFIG.ai.maxTokens = Math.min(Math.max(state.ai.maxTokens, 64), 4000);
        }
        if (typeof state.ownerOnly === "boolean") CONFIG.ownerOnly = state.ownerOnly;

        if (state.nsfwFilter && typeof state.nsfwFilter === "object") {
            CONFIG.nsfwFilter = { ...CONFIG.nsfwFilter, ...state.nsfwFilter };
        }
        if (typeof state.prefix === "string" && state.prefix.length > 0) CONFIG.prefix = state.prefix;
        if (typeof state.stickerAuthor === "string") CONFIG.stickerAuthor = state.stickerAuthor;
        if (typeof state.defaultStickerPack === "string") CONFIG.defaultStickerPack = state.defaultStickerPack;

        if (state.visualWatermark && typeof state.visualWatermark === "object") {
            if (typeof state.visualWatermark.enabled === "boolean") {
                CONFIG.visualWatermark.enabled = state.visualWatermark.enabled;
            }
            if (typeof state.visualWatermark.text === "string") {
                CONFIG.visualWatermark.text = state.visualWatermark.text;
            }
            if (typeof state.visualWatermark.opacity === "number") {
                CONFIG.visualWatermark.opacity = Math.min(Math.max(state.visualWatermark.opacity, 0.1), 1);
            }
        }

        console.log("Bot state loaded:", STATE_FILE);
    } catch (error) {
        console.error("Failed to load bot state:", error.message);
    }
}

function saveBotState() {
    try {
        const state = getDefaultState();
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
        return true;
    } catch (error) {
        console.error("Failed to save bot state:", error.message);
        return false;
    }
}

function rememberGroup(chatId) {
    const id = String(chatId);
    if (!CONFIG.seenGroups.includes(id)) {
        CONFIG.seenGroups.push(id);
        saveBotState();
    }
}

function rememberUser(chatId, userId, name) {
    const gid = String(chatId);
    const uid = String(userId);
    if (!uid) return;

    if (!CONFIG.seenUsers[gid]) CONFIG.seenUsers[gid] = [];

    const list = CONFIG.seenUsers[gid];
    const existing = list.find((u) => u.id === uid);

    if (existing) {
        if (name && existing.name !== name) {
            existing.name = name;
            saveBotState();
        }
        return;
    }

    list.push({ id: uid, name: name || uid });

    while (list.length > 200) list.shift();

    saveBotState();
}

module.exports = {
    ROOT_DIR,
    TEMP_DIR,
    DOWNLOAD_DIR,
    PYTHON_SCRIPT,
    YTDL_SCRIPT,
    STATE_FILE,
    CONFIG,
    loadBotState,
    saveBotState,
    rememberGroup,
    rememberUser
};
