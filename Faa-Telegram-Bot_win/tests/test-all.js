const assert = require("assert");
const fs = require("fs");
const path = require("path");
const statePath = path.join(__dirname, "..", "bot-state.json");
const backupPath = path.join(__dirname, "..", "temp", "bot-state.test-backup.json");
try {
    if (fs.existsSync(statePath)) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(statePath, backupPath);
    }
} catch (_) {}
const tg = require("../src/tg");
const util = require("../src/util");
const media = require("../src/media");
const { handleCommand } = require("../src/commands");
const { CONFIG } = require("../src/state");

const sent = [];
tg.setBot({
    getMe: async () => ({ username: "faatbot", id: 999 }),
    sendMessage: async (chatId, text, opts) => {
        sent.push({ kind: "text", chatId, text, opts });
        return { message_id: sent.length };
    },
    sendPhoto: async (chatId, photo, opts) => {
        sent.push({ kind: "photo", chatId, bytes: photo.length, opts });
        return { message_id: sent.length };
    },
    sendDocument: async (chatId, doc, opts) => {
        sent.push({ kind: "document", chatId, bytes: doc.length, opts });
        return { message_id: sent.length };
    },
    sendAudio: async (chatId, audio, opts, fileOpts) => {
        sent.push({ kind: "audio", chatId, bytes: audio.length, opts, fileOpts });
        return { message_id: sent.length };
    },
    sendVideo: async (chatId, video, opts) => {
        sent.push({ kind: "video", chatId, bytes: video.length, opts });
        return { message_id: sent.length };
    },
    sendSticker: async (chatId, sticker, opts, fileOpts) => {
        sent.push({ kind: "sticker", chatId, sticker, opts, fileOpts });
        return { message_id: sent.length };
    },
    sendChatAction: async () => true,
    editMessageText: async (text, opts) => {
        sent.push({ kind: "edit", text, opts });
        return true;
    },    getStickerSet: async () => ({ stickers: [{ file_id: "STK1" }] }),
    createNewStickerSet: async () => true,
    addStickerToSet: async (userId, name, sticker, emojis, type, opts, fileOpts) => {
        sent.push({ kind: "sticker-add", fileOpts, stickerType: type });
        return true;
    },
    getFileLink: async () => { throw new Error("no file in test"); },
    getUserProfilePhotos: async () => ({ photos: [] }),
    getChat: async (id) => ({ id, title: "Grup Tes", type: "supergroup" }),
    getChatMemberCount: async () => 5,
    getChatAdministrators: async () => [{ user: { id: 1 } }]
});

let n = 0;
const tmsg = (body, extra = {}) => ({
    message_id: ++n,
    chat: { id: -100, type: "private" },
    from: { id: 111, first_name: "Tester" },
    text: body,
    ...extra
});

const lastText = () => {
    const texts = sent.filter((s) => s.kind === "text");
    assert(texts.length > 0, "no text sent");
    return texts[texts.length - 1].text;
};

(async () => {
    assert.strictEqual(util.parseCommand("!ping").command, "ping");
    assert.strictEqual(tg.makeCtx(tmsg("/ping")).body, "!ping", "slash prefix dinormalisasi");
    assert.strictEqual(util.suggestCommand("pingg"), "ping");

    const svg = media.createQuoteSvgWithOptions("halo", media.parseQuoteOptions("--bold halo").options);
    assert.ok(svg.length > 100);
    const brat = await media.createBratBuffer("halo brat");
    assert.ok(brat.length > 1000);

    // snobg flood-fill: background putih tepi hilang, putih terkepung utuh
    const testSvg = Buffer.from(`
        <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" fill="white"/>
            <rect x="20" y="20" width="60" height="60" fill="#ff0000"/>
            <rect x="35" y="35" width="30" height="30" fill="white"/>
        </svg>
    `);
    const testPng = await require("sharp")(testSvg).png().toBuffer();
    const noBg = await media.removeWhiteBackground({
        data: testPng.toString("base64"),
        mimetype: "image/png"
    });
    const noBgBuf = Buffer.from(noBg.data, "base64");
    const { data: raw, info } = await require("sharp")(noBgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => raw[(y * info.width + x) * 4 + 3];
    assert.strictEqual(alphaAt(2, 2), 0, "background tepi transparan");
    assert.strictEqual(alphaAt(256, 256), 255, "putih terkepung di dalam subjek tetap utuh");
    assert.ok(noBg.removedRatio > 0.2, "rasio terhapus masuk akal, dapat " + noBg.removedRatio);

    // Gambar 1 warna penuh -> ikut terhapus (benar: background solid)
    const redSvg = Buffer.from(`<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#ff0000"/></svg>`);
    const redPng = await require("sharp")(redSvg).png().toBuffer();
    const redNoBg = await media.removeWhiteBackground({ data: redPng.toString("base64"), mimetype: "image/png" });
    assert.ok((redNoBg.removedRatio || 0) > 0.9, "merah solid terhapus semua");

    // Background ramai (sudut beda-beda) -> ditolak rasio 0
    const noisySvg = Buffer.from(`<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50" fill="#ff0000"/><rect y="50" width="100" height="50" fill="#0000ff"/></svg>`);
    const noisyPng = await require("sharp")(noisySvg).png().toBuffer();
    const noisyNoBg = await media.removeWhiteBackground({ data: noisyPng.toString("base64"), mimetype: "image/png" });
    assert.ok((noisyNoBg.removedRatio || 0) < 0.02, "bg tidak solid -> rasio ~0");

    // Background MERAH solid + outline putih terkepung (kasus stiker anime):
    // merah hilang, putih outline + isi utuh.
    const dieCutSvg = Buffer.from(`
        <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="200" fill="#ff0000"/>
            <circle cx="100" cy="100" r="70" fill="white"/>
            <circle cx="100" cy="100" r="55" fill="#0000ff"/>
        </svg>
    `);
    const dieCutPng = await require("sharp")(dieCutSvg).png().toBuffer();
    const dieCut = await media.removeWhiteBackground({
        data: dieCutPng.toString("base64"),
        mimetype: "image/png"
    });
    assert.ok(dieCut.removedRatio > 0.15, "bg merah terhapus, rasio=" + dieCut.removedRatio);
    const dcBuf = Buffer.from(dieCut.data, "base64");
    const dcRaw = await require("sharp")(dcBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const dcAt = (x, y) => dcRaw.data[(y * dcRaw.info.width + x) * 4 + 3];
    assert.strictEqual(dcAt(2, 2), 0, "merah tepi transparan");
    assert.strictEqual(dcAt(256, 256), 255, "isi biru tengah utuh");
    // Ring putih terkepung: ambil titik di tengah ring (radius ~62/200*512=159 dari tengah 256)
    assert.strictEqual(dcAt(256, 256 - 159), 255, "outline putih terkepung utuh");

    // Fringe JPEG: kompresi artifak di batas merah/putih harus ikut bersih
    const dieCutJpeg = await require("sharp")(dieCutSvg).jpeg({ quality: 50 }).toBuffer();
    const dieCutJ = await media.removeWhiteBackground({
        data: dieCutJpeg.toString("base64"),
        mimetype: "image/jpeg"
    });
    const dcJBuf = Buffer.from(dieCutJ.data, "base64");
    const dcJRaw = await require("sharp")(dcJBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let redLeft = 0;
    for (let i = 0; i < dcJRaw.data.length; i += 4) {
        if (dcJRaw.data[i + 3] === 0) continue;
        const r = dcJRaw.data[i], g = dcJRaw.data[i + 1], b = dcJRaw.data[i + 2];
        if (r > 150 && r > g + 80 && r > b + 80) redLeft++;
    }
    assert.strictEqual(redLeft, 0, "nol sisa merah pasca-JPEG, dapat " + redLeft);

    await handleCommand(tg.makeCtx(tmsg("!ping")), "t");
    assert.ok(lastText().startsWith("pong"), "ping");

    await handleCommand(tg.makeCtx(tmsg("/menu")), "t");
    assert.ok(lastText().includes("Main Menu"), "slash prefix + menu");

    const { menuTexts, menuKeyboard, showMenu, handleMenuCallback } = require("../src/commands");
    const texts = menuTexts();
    for (const k of ["main", "command", "sticker", "textmaker", "translate", "games", "group", "search", "anime"]) {
        assert.ok(texts[k] && texts[k].includes("Prefix:"), "menuTexts." + k);
    }
    const kb = menuKeyboard();
    assert.strictEqual(kb.inline_keyboard.flat().length, 9, "9 tombol menu");
    assert.ok(kb.inline_keyboard.flat().every((b) => b.callback_data.startsWith("menu:")), "callback menu:*");

    await showMenu(tg.makeCtx(tmsg("!menusticker")), "sticker");
    const menuSent = sent.filter((s) => s.kind === "text").pop();
    assert.ok(menuSent.text.includes("Sticker Menu"), "showMenu sticker");

    await handleMenuCallback(-999, 42, "games");
    const edited = sent.filter((s) => s.kind === "edit").pop();
    assert.ok(edited && edited.text.includes("Games Menu"), "callback edit games");
    assert.strictEqual(edited.opts.chat_id, -999);
    assert.strictEqual(edited.opts.message_id, 42);

    await handleCommand(tg.makeCtx(tmsg("!fancy halo")), "t");
    assert.ok(lastText().includes("𝒽"), "fancy");

    await handleCommand(tg.makeCtx(tmsg("!pingg")), "t");
    assert.ok(lastText().includes("Mungkin maksudmu"), "suggest");

    await handleCommand(tg.makeCtx(tmsg("!s")), "t");
    assert.ok(lastText().includes("!s"), "s usage");

    await handleCommand(tg.makeCtx(tmsg("!fancy xxxbokep")), "t");
    assert.ok(lastText().includes("NSFW"), "nsfw");

    await handleCommand(tg.makeCtx(tmsg("!status")), "t");
    assert.ok(lastText().includes("Telegram"), "status");

    await handleCommand(tg.makeCtx(tmsg("!ytdl ver")), "t");
    assert.ok(lastText().includes("yt-dlp"), "ytdl ver");

    await handleCommand(tg.makeCtx(tmsg("!qr halo qr")), "t");
    assert.ok(sent.some((s) => s.kind === "photo"), "qr photo");

    await handleCommand(tg.makeCtx(tmsg("!tts halo dunia")), "t");
    assert.ok(sent.some((s) => s.kind === "audio"), "tts audio");

    await tg.sendAudio(
        { chatId: -100, raw: { message_id: 1 } },
        Buffer.from("fake-mp3-bytes"),
        "audio/mpeg",
        "judul lagu.mp3"
    );
    const namedAudio = sent.filter((s) => s.kind === "audio").pop();
    assert.strictEqual(namedAudio.fileOpts && namedAudio.fileOpts.filename, "judul lagu.mp3", "audio filename via fileOptions");

    await handleCommand(tg.makeCtx(tmsg("!trivia")), "t");
    assert.ok(lastText().includes("Trivia"), "trivia");

    const omsg = (body, extra = {}) => tmsg(body, { from: { id: 123456, first_name: "Owner" }, ...extra });

    await handleCommand(tg.makeCtx(tmsg("!ai halo")), "t");
    assert.ok(lastText().includes("belum dikonfigurasi") && lastText().includes("openrouter"), "ai tanpa key: " + lastText());

    await handleCommand(tg.makeCtx(tmsg("!owner add 123456")), "t");
    assert.ok(CONFIG.owners.includes("123456"), "owner add (bootstrap)");

    await handleCommand(tg.makeCtx(tmsg("!apikey status")), "t");
    assert.ok(lastText().includes("OpenRouter") && lastText().includes("-"), "apikey status kosong");

    await handleCommand(tg.makeCtx(omsg("!apikey set openrouter sk-or-test1234567890")), "t");
    assert.ok(lastText().includes("disimpan") && lastText().includes("openrouter"), "apikey set or: " + lastText());

    await handleCommand(tg.makeCtx(omsg("!apikey set google AIzaTestKey123456")), "t");
    assert.ok(lastText().includes("disimpan") && lastText().includes("google"), "apikey set google");

    await handleCommand(tg.makeCtx(tmsg("!apikey status")), "t");
    assert.ok(lastText().includes("sk-or-t") && lastText().includes("7890") && !lastText().includes("t1234567"), "apikey masked");
    assert.ok(lastText().includes("AIzaTes") && !lastText().includes("TestKey123"), "google key masked");
    assert.ok(lastText().includes("Aktif: google"), "provider ikut key terakhir");

    await handleCommand(tg.makeCtx(omsg("!apikey use openai")), "t");
    assert.ok(lastText().includes("openai"), "apikey use");

    await handleCommand(tg.makeCtx(tmsg("!ai halo")), "t");
    assert.ok(lastText().includes("belum dikonfigurasi") && lastText().includes("openai"), "ai tanpa key openai");

    await handleCommand(tg.makeCtx(omsg("!apikey set chatgpt sk-test-openai-key-123")), "t");
    assert.ok(lastText().includes("disimpan"), "apikey set chatgpt");

    await handleCommand(tg.makeCtx(omsg("!aimodel set google gemini-test-model")), "t");
    assert.ok(lastText().includes("gemini-test-model") && lastText().includes("google"), "aimodel set per provider");

    await handleCommand(tg.makeCtx(omsg("!aimodel status")), "t");
    assert.ok(lastText().includes("gemini-test-model"), "aimodel status per provider");

    await handleCommand(tg.makeCtx(omsg("!apikey reset google")), "t");
    assert.ok(lastText().includes("dihapus"), "apikey reset per provider");

    await handleCommand(tg.makeCtx(tmsg("!apikey set x")), "t");
    assert.ok(lastText().includes("hanya untuk owner"), "apikey non-owner ditolak");

    await handleCommand(tg.makeCtx(tmsg("!aimodel list")), "t");
    assert.ok(lastText().includes(":free"), "aimodel list free");

    await handleCommand(tg.makeCtx(tmsg("!aimodel list qwen")), "t");
    assert.ok(lastText().toLowerCase().includes("qwen"), "aimodel list filter");

    await handleCommand(tg.makeCtx(tmsg("!cuaca jakarta")), "t");
    assert.ok(lastText().includes("Cuaca") && lastText().includes("°C"), "cuaca: " + lastText().slice(0, 80));

    await handleCommand(tg.makeCtx(tmsg("!lirik coldplay - yellow")), "t");
    const lirikText = lastText().toLowerCase();
    assert.ok(lirikText.includes("coldplay") || lirikText.includes("yellow") || lirikText.includes("tidak ditemukan"), "lirik");

    await handleCommand(tg.makeCtx(tmsg("!short https://www.google.com")), "t");
    assert.ok(lastText().includes("tinyurl.com"), "short: " + lastText());

    await handleCommand(tg.makeCtx(tmsg("!calc 12*8+5")), "t");
    assert.ok(lastText().includes("101"), "calc 12*8+5=101");

    await handleCommand(tg.makeCtx(tmsg("!calc abc")), "t");
    assert.ok(lastText().includes("tidak valid"), "calc invalid");

    await handleCommand(tg.makeCtx(tmsg("!quotes")), "t");
    assert.ok(lastText().includes("Quotes"), "quotes");

    await handleCommand(tg.makeCtx(tmsg("!rmeme")), "t");
    assert.ok(sent.some((s) => s.kind === "photo"), "rmeme photo");

    const { CONFIG: liveConfig } = require("../src/state");
    liveConfig.ai.keys.openrouter = "sk-or-testkey";
    liveConfig.ai.provider = "openrouter";
    await handleCommand(tg.makeCtx(tmsg("!ai cooldown probe")), "t");
    await handleCommand(tg.makeCtx(tmsg("!ai cooldown probe 2")), "t");
    assert.ok(lastText().includes("cooldown"), "ai cooldown: " + lastText());
    liveConfig.ai.keys.openrouter = "";
    liveConfig.ai.provider = "openrouter";

    await handleCommand(tg.makeCtx(tmsg("!brat halo brat")), "t");
    const stickerSends = sent.filter((s) => s.kind === "sticker");
    assert.ok(stickerSends.length > 0, "brat sticker sent");
    assert.strictEqual(stickerSends[stickerSends.length - 1].sticker, "STK1", "sticker via set file_id");
    const adds = sent.filter((s) => s.kind === "sticker-add");
    assert.ok(adds.length > 0 && adds[0].stickerType === "png_sticker", "addStickerToSet old API");
    assert.strictEqual(adds[0].fileOpts && adds[0].fileOpts.filename, "sticker.png", "png filename eksplisit");

    const qmsg = tmsg("!qc", {
        reply_to_message: {
            message_id: 5,
            from: { id: 222, first_name: "Quoted" },
            text: "kutipan asli"
        }
    });
    const qctx = tg.makeCtx(qmsg);
    assert.strictEqual(qctx.hasQuotedMsg, true);
    assert.strictEqual(qctx.quoted.body, "kutipan asli");
    await handleCommand(qctx, "t");
    assert.ok(sent.filter((s) => s.kind === "sticker").length >= 2, "qc sticker");

    CONFIG.seenGroups.push("-999");
    CONFIG.seenUsers["-999"] = [{ id: "111", name: "Tester" }, { id: "222", name: "Quoted" }];
    const gmsg = (body, extra = {}) => tmsg(body, { chat: { id: -999, type: "supergroup" }, ...extra });

    await handleCommand(tg.makeCtx(gmsg("!tagall")), "t");
    assert.ok(lastText().includes("tg://user"), "tagall mention links");

    await handleCommand(tg.makeCtx(gmsg("!groupinfo")), "t");
    assert.ok(lastText().includes("Grup Tes"), "groupinfo");

    await handleCommand(tg.makeCtx(tmsg("!broadcast halo semua", { from: { id: 123456, first_name: "Owner" } })), "t");
    assert.ok(lastText().includes("Broadcast selesai"), "broadcast: " + lastText());

    console.log("ALL TESTS PASSED. sent=" + sent.length);
    const path = require("path");
    const fs = require("fs");
    const statePath = path.join(__dirname, "..", "bot-state.json");
    const backupPath = path.join(__dirname, "..", "temp", "bot-state.test-backup.json");
    try {
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, statePath);
            fs.unlinkSync(backupPath);
            console.log("state user dipulihkan");
        } else {
            fs.unlinkSync(statePath);
            console.log("state tes dibuang");
        }
    } catch (_) {}
    process.exit(0);
})().catch((e) => {
    console.error("TEST FAILED:", e);
    process.exit(1);
});
