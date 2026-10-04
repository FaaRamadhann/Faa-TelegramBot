const TelegramBot = require("node-telegram-bot-api");
const sharp = require("sharp");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { randomUUID } = require("crypto");
const { CONFIG, saveBotState } = require("./state");
const {
    normalizeText,
    isOwnerIdMatch,
    getMediaSizeMB,
    httpGetBuffer
} = require("./util");

let bot = null;
let botUsername = "";
let stickerSetName = "";
let stickerSetReady = false;

function getBot() {
    return bot;
}

function setBot(b) {
    bot = b;
}

// ---------- message normalization ----------

function mediaOf(msg) {
    if (!msg || typeof msg !== "object") return null;

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
        const best = msg.photo[msg.photo.length - 1];
        return { kind: "photo", fileId: best.file_id, mimetype: "image/jpeg" };
    }
    if (msg.sticker) {
        return {
            kind: "sticker",
            fileId: msg.sticker.file_id,
            mimetype: "image/webp",
            isAnimated: Boolean(msg.sticker.is_animated),
            isVideo: Boolean(msg.sticker.is_video)
        };
    }
    if (msg.document) {
        return { kind: "document", fileId: msg.document.file_id, mimetype: msg.document.mime_type || "" };
    }
    if (msg.video) {
        return { kind: "video", fileId: msg.video.file_id, mimetype: msg.video.mime_type || "video/mp4" };
    }
    if (msg.audio) {
        return { kind: "audio", fileId: msg.audio.file_id, mimetype: msg.audio.mime_type || "audio/mpeg" };
    }
    if (msg.voice) {
        return { kind: "voice", fileId: msg.voice.file_id, mimetype: msg.voice.mime_type || "audio/ogg" };
    }
    if (msg.animation) {
        return { kind: "animation", fileId: msg.animation.file_id, mimetype: msg.animation.mime_type || "video/mp4" };
    }
    if (msg.video_note) {
        return { kind: "video_note", fileId: msg.video_note.file_id, mimetype: "video/mp4" };
    }

    return null;
}

function textOf(msg) {
    if (!msg || typeof msg !== "object") return "";
    if (typeof msg.text === "string" && msg.text) return msg.text;
    if (typeof msg.caption === "string" && msg.caption) return msg.caption;
    return "";
}

function senderNameOf(msg) {
    const from = msg?.from || {};
    return [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "";
}

async function downloadFileId(fileId) {
    if (!bot) throw new Error("Bot belum siap.");
    if (!fileId) return null;

    try {
        const link = await bot.getFileLink(fileId);
        const buffer = await httpGetBuffer(link);
        if (!buffer || buffer.length === 0) return null;
        return buffer;
    } catch (error) {
        console.error("Download TG file failed:", error.message);
        return null;
    }
}

function makeQuoted(msg) {
    const q = msg?.reply_to_message;
    if (!q) return null;

    const media = mediaOf(q);

    return {
        messageId: q.message_id,
        senderId: q.from ? String(q.from.id) : "",
        pushName: senderNameOf(q),
        body: normalizeText(textOf(q)),
        hasMedia: Boolean(media),
        mimetype: media ? media.mimetype : "",
        buffer: async () => {
            if (!media) return null;
            const buffer = await downloadFileId(media.fileId);
            if (!buffer) return null;
            return { buffer, mimetype: media.mimetype };
        }
    };
}

function makeCtx(msg) {
    if (!msg || !msg.chat) return null;

    const chatId = msg.chat.id;
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const fromId = msg.from ? String(msg.from.id) : "";
    let body = normalizeText(textOf(msg));

    // Terima juga prefix "/" ala Telegram: "/ping" == "!ping".
    if (body.startsWith("/")) {
        const withoutSlash = body.slice(1);
        const spaceIdx = withoutSlash.search(/\s/);
        const first = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
        const atIdx = first.indexOf("@");
        const cmd = atIdx === -1 ? first : first.slice(0, atIdx);
        const rest = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1);
        body = CONFIG.prefix + cmd + (rest ? " " + rest : "");
    }

    const media = mediaOf(msg);
    const quoted = makeQuoted(msg);

    const ctx = {
        bot,
        chatId,
        senderJid: fromId,
        senderId: fromId,
        pushName: senderNameOf(msg),
        isGroup,
        fromMe: false,
        body,
        hasMedia: Boolean(media),
        mimetype: media ? media.mimetype : "",
        hasQuotedMsg: Boolean(quoted),
        quoted,
        mentioned: [],
        raw: msg,
        author: fromId,
        from: String(chatId),
        id: String(msg.message_id || ""),
        replyText: async (text) => {
            await safeReply(ctx, text);
        }
    };

    return ctx;
}

// ---------- media source (legacy-compatible shape) ----------

function legacyFromBuffer(buffer, mimetype) {
    return { data: buffer.toString("base64"), mimetype };
}

async function getSourceMessage(ctx) {
    if (ctx.hasMedia) {
        const media = mediaOf(ctx.raw);

        if (!media) return null;

        const mimetype = media.mimetype || "";

        return {
            hasMedia: true,
            mimetype,
            downloadMedia: async () => {
                const buffer = await downloadFileId(media.fileId);
                if (!buffer) return null;
                return legacyFromBuffer(buffer, mimetype);
            }
        };
    }

    if (ctx.quoted && ctx.quoted.hasMedia) {
        const mimetype = ctx.quoted.mimetype || "";

        return {
            hasMedia: true,
            mimetype,
            downloadMedia: async () => {
                try {
                    const got = await ctx.quoted.buffer();
                    if (!got || !got.buffer || got.buffer.length === 0) return null;
                    return legacyFromBuffer(got.buffer, got.mimetype || mimetype);
                } catch (error) {
                    console.error("Download quoted media failed:", error.message);
                    return null;
                }
            }
        };
    }

    return null;
}

async function safeDownloadMedia(sourceMessage) {
    try {
        if (!sourceMessage || typeof sourceMessage.downloadMedia !== "function") return null;
        return (await sourceMessage.downloadMedia()) || null;
    } catch (error) {
        console.error("Download media failed:", error.message);
        return null;
    }
}

async function replyNoSourceMessage(ctx, usageText) {
    if (ctx.hasQuotedMsg) {
        await safeReply(
            ctx,
            "Pesan yang di-reply tidak terbaca/tidak ada medianya.\nKirim ulang medianya dengan caption " + usageText + "."
        );
        return;
    }

    await safeReply(ctx, usageText);
}

async function extractUrlFromMessage(ctx, rawArgs) {
    const { extractFirstUrl } = require("./util");
    const direct = extractFirstUrl(rawArgs);
    if (direct) return direct;

    if (ctx.quoted && ctx.quoted.body) {
        return extractFirstUrl(ctx.quoted.body);
    }

    return "";
}

// ---------- sender / owner ----------

function getPossibleSenderIds(ctx) {
    return [String(ctx.senderId || "")].filter(Boolean);
}

function isOwner(ctx) {
    if (!CONFIG.ownerOnly) return true;
    return isOwnerIdMatch(getPossibleSenderIds(ctx));
}

function canUseDangerCommand(ctx) {
    // Bootstrap: kalau owners masih kosong, izinkan (mode setup awal).
    if (!CONFIG.owners || CONFIG.owners.length === 0) return true;
    return isOwnerIdMatch(getPossibleSenderIds(ctx));
}

function getSenderName(ctx) {
    if (ctx.quoted && ctx.quoted.pushName) return ctx.quoted.pushName;
    return ctx.pushName || "";
}

// ---------- send primitives ----------

async function sendTextTo(chatId, text, replyTo) {
    if (!bot) throw new Error("Bot belum siap.");

    try {
        return await bot.sendMessage(chatId, text, {
            ...(replyTo ? { reply_to_message_id: replyTo } : {}),
            parse_mode: "Markdown"
        });
    } catch (error) {
        if (/parse|markdown|entities/i.test(error.message || "")) {
            return await bot.sendMessage(chatId, text, replyTo ? { reply_to_message_id: replyTo } : {});
        }
        throw error;
    }
}

function formatReplyText(text) {
    let out = typeof text === "string" ? text : String(text ?? "");
    if (CONFIG.prefix !== "!") {
        out = out.split("`!").join("`" + CONFIG.prefix);
    }
    return out;
}

async function safeReply(ctx, text) {
    try {
        const out = formatReplyText(text);
        await sendTextTo(ctx.chatId, out, ctx.raw?.message_id);
    } catch (error) {
        console.error("Reply failed:", error.message);
    }
}

async function sendPresence(ctx, state) {
    try {
        if (!bot) return;
        const action = state === "composing" ? "typing" : "typing";
        await bot.sendChatAction(ctx.chatId, action);
    } catch (_) {}
}

async function sendImage(ctx, buffer, caption = "") {
    if (!bot) throw new Error("Bot belum siap.");
    await bot.sendPhoto(ctx.chatId, buffer, {
        caption,
        ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {})
    }, { filename: "photo.png", contentType: "image/png" });
}

async function sendVideo(ctx, buffer, caption = "", filename) {
    if (!bot) throw new Error("Bot belum siap.");
    const options = {
        caption,
        ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {})
    };
    const fileOptions = { filename: filename || "video.mp4", contentType: "video/mp4" };
    await bot.sendVideo(ctx.chatId, buffer, options, fileOptions);
}

async function sendAudio(ctx, buffer, mimetype = "audio/mpeg", fileName) {
    if (!bot) throw new Error("Bot belum siap.");
    const options = {
        ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {})
    };
    const fileOptions = {
        ...(fileName ? { filename: fileName } : {}),
        ...(mimetype ? { contentType: mimetype } : {})
    };
    await bot.sendAudio(ctx.chatId, buffer, options, fileOptions);
}

async function sendDocument(ctx, buffer, mimetype, fileName, caption = "") {
    if (!bot) throw new Error("Bot belum siap.");
    await bot.sendDocument(ctx.chatId, buffer, {
        caption,
        ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {}),
        ...(fileName ? { filename: fileName } : {})
    }, {
        filename: fileName || "file",
        contentType: mimetype || "application/octet-stream"
    });
}

function ffmpegAvailable() {
    try {
        const r = spawnSync("ffmpeg", ["-version"], { windowsHide: true, timeout: 10000 });
        return r.status === 0;
    } catch {
        return false;
    }
}

async function videoFrameToPng(videoBuffer, mimetype) {
    const { TEMP_DIR } = require("./state");
    const ext = (mimetype || "").includes("3gpp") ? ".3gp" : ".mp4";
    const inPath = path.join(TEMP_DIR, `tgvid-${randomUUID()}${ext}`);
    const outPath = path.join(TEMP_DIR, `tgvidframe-${randomUUID()}.png`);

    try {
        await fsp.writeFile(inPath, videoBuffer);
        await new Promise((resolve, reject) => {
            const child = spawn("ffmpeg", ["-y", "-i", inPath, "-vframes", "1", "-f", "image2", outPath], { windowsHide: true });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0 && fs.existsSync(outPath)) resolve();
                else reject(new Error("ffmpeg frame extract exit " + code));
            });
        });
        return await fsp.readFile(outPath);
    } finally {
        try { await fsp.unlink(inPath); } catch (_) {}
        try { await fsp.unlink(outPath); } catch (_) {}
    }
}

async function pngToWebpSticker(pngBuffer) {
    return await sharp(pngBuffer).webp({ quality: 90 }).toBuffer();
}

async function ensureStickerSet(ownerId) {
    if (!bot) throw new Error("Bot belum siap.");

    if (stickerSetReady && stickerSetName) {
        return { name: stickerSetName, ownerId };
    }

    const me = await bot.getMe();
    botUsername = me.username || "bot";
    const safeUser = String(botUsername).toLowerCase().replace(/[^a-z0-9]/g, "") || "bot";
    // Aturan Telegram: nama set harus diakhiri _by_<username_bot>.
    stickerSetName = `faa_pack_by_${safeUser}`.slice(0, 60);

    const setOwner = String(ownerId || (CONFIG.owners[0] || ""));
    if (!setOwner) {
        throw new Error("Set owner kosong (isi !owner add <telegram_user_id> dulu).");
    }

    try {
        await bot.getStickerSet(stickerSetName);
        stickerSetReady = true;
        return { name: stickerSetName, ownerId: setOwner };
    } catch (_) {}

    const placeholder = await sharp({
        create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).png().toBuffer();

    // API lama v0.66: png_sticker + emoji string + fileOptions eksplisit.
    await bot.createNewStickerSet(
        setOwner,
        stickerSetName,
        CONFIG.defaultStickerPack || "Faa Sticker Pack",
        placeholder,
        "🔥",
        {},
        { filename: "sticker.png", contentType: "image/png" }
    );

    stickerSetReady = true;
    return { name: stickerSetName, ownerId: setOwner };
}

async function sendStickerReply(ctx, legacyMedia, customMeta = null) {
    if (!bot) throw new Error("Bot belum siap.");

    let pngBuffer = Buffer.from(legacyMedia.data, "base64");

    if ((legacyMedia.mimetype || "").startsWith("video/")) {
        if (!ffmpegAvailable()) {
            throw new Error("Video sticker butuh FFmpeg. Install FFmpeg dulu.");
        }
        pngBuffer = await videoFrameToPng(pngBuffer, legacyMedia.mimetype);
    }

    const name = getSenderName(ctx);
    const cleanName = String(name).replace(/\s+/g, " ").trim().slice(0, 60);
    const pack = (customMeta && customMeta.stickerName) || `${cleanName || CONFIG.defaultStickerPack}`;
    const author = (customMeta && customMeta.stickerAuthor) || CONFIG.stickerAuthor;
    void pack;
    void author;

    const webpOpts = { filename: "sticker.webp", contentType: "image/webp" };
    const pngOpts = { filename: "sticker.png", contentType: "image/png" };

    try {
        const ownerId = ctx.senderId || (CONFIG.owners[0] || "");
        const set = await ensureStickerSet(ownerId);
        await bot.addStickerToSet(set.ownerId, set.name, pngBuffer, "🔥", "png_sticker", {}, pngOpts);
        const info = await bot.getStickerSet(set.name);
        const last = info.stickers[info.stickers.length - 1];
        await bot.sendSticker(ctx.chatId, last.file_id, ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {});
        return;
    } catch (error) {
        console.error("Sticker set flow failed, fallback kirim webp langsung:", error.message);
    }

    try {
        const webp = await pngToWebpSticker(pngBuffer);
        await bot.sendSticker(ctx.chatId, webp, {
            ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {})
        }, webpOpts);
        return;
    } catch (error) {
        console.error("Sticker direct failed, fallback foto:", error.message);
    }

    const webp = await pngToWebpSticker(pngBuffer);
    await sendImage(ctx, webp, "✅ Sticker (fallback gambar)");
}

function parseStickerRequestMeta(rawArgs) {
    const { normalizeText } = require("./util");
    const raw = normalizeText(rawArgs);
    if (!raw || !raw.includes("|")) return null;

    const parts = raw.split("|");
    const pack = normalizeText(parts[0]).slice(0, 60);
    const author = normalizeText(parts.slice(1).join("|")).slice(0, 60);

    if (!pack && !author) return null;

    return {
        stickerName: pack || CONFIG.defaultStickerPack,
        stickerAuthor: author || CONFIG.stickerAuthor,
        stickerCategories: ["🔥"]
    };
}

// ---------- group ----------

async function getGroupMetadata(ctx) {
    try {
        if (!ctx.isGroup || !bot) return null;
        const [info, admins] = await Promise.all([
            bot.getChat(ctx.chatId),
            bot.getChatAdministrators(ctx.chatId).catch(() => [])
        ]);
        return {
            id: ctx.chatId,
            subject: info.title || "-",
            participants: [],
            adminIds: admins.map((a) => String(a.user.id)),
            announce: false
        };
    } catch (error) {
        console.error("groupMetadata failed:", error.message);
        return null;
    }
}

function mentionTag(jid) {
    return "@" + String(jid || "").split("@")[0];
}

const processedIds = new Set();

function rememberId(id) {
    if (!id) return false;
    const key = String(id);
    if (processedIds.has(key)) return true;
    processedIds.add(key);
    if (processedIds.size > 800) {
        const first = processedIds.values().next().value;
        processedIds.delete(first);
    }
    return false;
}

function logMessage(sourceLabel, ctx, command = "") {
    console.log(
        `[${sourceLabel}] chat=${ctx.chatId} sender=${ctx.senderId} cmd=${command || "-"} hasMedia=${ctx.hasMedia} hasQuoted=${ctx.hasQuotedMsg} body="${ctx.body.slice(0, 120)}"`
    );
}

module.exports = {
    getBot,
    setBot,
    makeCtx,
    legacyFromBuffer,
    getSourceMessage,
    safeDownloadMedia,
    replyNoSourceMessage,
    extractUrlFromMessage,
    getPossibleSenderIds,
    isOwner,
    canUseDangerCommand,
    getSenderName,
    sendTextTo,
    safeReply,
    formatReplyText,
    sendPresence,
    sendImage,
    sendVideo,
    sendAudio,
    sendDocument,
    ffmpegAvailable,
    videoFrameToPng,
    pngToWebpSticker,
    sendStickerReply,
    parseStickerRequestMeta,
    getGroupMetadata,
    mentionTag,
    rememberId,
    logMessage
};
