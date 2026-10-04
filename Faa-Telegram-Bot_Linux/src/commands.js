const fs = require("fs");
const sharp = require("sharp");
const { CONFIG, TEMP_DIR, DOWNLOAD_DIR, YTDL_SCRIPT, saveBotState, rememberGroup } = require("./state");
const {
    normalizeText,
    commandIn,
    getCommandRegistry,
    isKnownCommand,
    suggestCommand,
    getCommandUsage,
    runWithUserJobLock,
    activeJobs,
    parseResizeDimensions,
    validatePublicUrl,
    getMediaSizeMB,
    isImageMime,
    isVideoMime,
    isWebpMime,
    isStickerSourceMime,
    parseNumber,
    parseColor,
    hexToRgba,
    escapeXml,
    sanitizeCaptionText,
    formatUptime,
    countFilesInDir,
    cleanFilesInDir,
    safeUnlinkMany,
    encodeQuery,
    randomItem,
    httpGetBuffer,
    httpGetJson,
    getDependencyVersions,
    normalizeOwnerId,
    isOwnerIdMatch,
    normalizeLangCode,
    parseTranslateArgs,
    normalizeTranslateResult,
    isBadTranslateResult,
    localDictionaryTranslate,
    translateWithGoogleFree,
    httpPostJson,
    checkNsfwText,
    randomGameText
} = require("./util");
const {
    getBot,
    safeReply,
    sendPresence,
    sendImage,
    sendVideo,
    sendAudio,
    sendDocument,
    sendTextTo,
    sendStickerReply: tgSendStickerReply,
    parseStickerRequestMeta,
    getSourceMessage,
    safeDownloadMedia,
    replyNoSourceMessage,
    extractUrlFromMessage,
    getPossibleSenderIds,
    isOwner,
    canUseDangerCommand,
    getSenderName,
    getGroupMetadata,
    mentionTag
} = require("./tg");
const {
    legacyMedia,
    imageToStickerCanvas,
    removeWhiteBackground,
    removeBackgroundAI,
    removeBackgroundAIAsImage,
    createMemeSticker,
    parseQuoteOptions,
    createQuoteSvgWithOptions,
    createBratBuffer,
    createBratVideoBuffer,
    createEmojiRenderBuffer,
    createTextSvg,
    createRoundedAvatarBuffer,
    createModernQuoteBaseSvg
} = require("./media");
const { spawn } = require("child_process");

const YTDL_TIMEOUT_MS = 6 * 60 * 1000;
const YTDL_AUDIO_QUALITIES = ["64", "128", "192", "256", "320"];
const YTDL_VIDEO_HEIGHTS = ["360", "480", "720", "1080"];

function parseYtdlQuality(rawArgs, allowed, fallback) {
    const parts = normalizeText(rawArgs).split(/\s+/).filter(Boolean);

    if (parts.length > 1 && allowed.includes(parts[0])) {
        return { quality: parts[0], rest: parts.slice(1).join(" ") };
    }

    return { quality: fallback, rest: rawArgs };
}

// ---------- sticker send ----------

async function sendStickerReplyWithMeta(ctx, media, customMeta = null) {
    await tgSendStickerReply(ctx, media, customMeta);
}

async function sendStickerReply(ctx, media) {
    await tgSendStickerReply(ctx, media, null);
}

// ---------- image send ----------

async function sendImageResult(ctx, buffer, filename = "result.png", caption = "✅ Done") {
    await sendImage(ctx, buffer, caption);
}

async function sendStickerResult(ctx, buffer) {
    await sendStickerReply(ctx, legacyMedia(buffer, "image/png", "result.png"));
}

// ---------- sticker makers ----------

async function downloadImageFromCommand(ctx, commandName) {
    const sourceMessage = await getSourceMessage(ctx);

    if (!sourceMessage || !sourceMessage.hasMedia) {
        await replyNoSourceMessage(ctx, `Kirim/reply gambar/sticker dengan command \`!${commandName}\`.`);
        return null;
    }

    const media = await safeDownloadMedia(sourceMessage);

    if (!media) {
        await safeReply(ctx, "Gagal download media.");
        return null;
    }

    if (!isImageMime(media.mimetype) && !isWebpMime(media.mimetype)) {
        await safeReply(ctx, `Format tidak support: ${media.mimetype}`);
        return null;
    }

    return media;
}

async function makeSticker(ctx, options = { mode: "normal" }, rawArgs = "") {
    const customStickerMeta = parseStickerRequestMeta(rawArgs);
    const sourceMessage = await getSourceMessage(ctx);

    if (!sourceMessage) {
        await replyNoSourceMessage(ctx, "Kirim/reply media dengan command:\n`!s`\n`!snobg`\n`!aibg`");
        return;
    }

    if (!sourceMessage.hasMedia) {
        await safeReply(ctx, "Pesan yang direply tidak punya media.");
        return;
    }

    let media = await safeDownloadMedia(sourceMessage);

    if (!media) {
        await safeReply(ctx, "Gagal download media. Coba kirim ulang.");
        return;
    }

    if (!isStickerSourceMime(media.mimetype)) {
        await safeReply(ctx, `Format tidak support: ${media.mimetype}`);
        return;
    }

    const sizeMB = getMediaSizeMB(media);

    if (sizeMB > CONFIG.maxMediaSizeMB) {
        await safeReply(ctx, `Media terlalu besar: ${sizeMB.toFixed(2)} MB. Maksimal ${CONFIG.maxMediaSizeMB} MB.`);
        return;
    }

    if (options.mode === "normal") {
        if (isImageMime(media.mimetype)) {
            media = await imageToStickerCanvas(media, false);
        }

        await sendStickerReplyWithMeta(ctx, media, customStickerMeta);
        return;
    }

    if (options.mode === "white") {
        if (!isImageMime(media.mimetype)) {
            await safeReply(ctx, "`!snobg` hanya support gambar, bukan video.");
            return;
        }

        media = await removeWhiteBackground(media);

        if ((media.removedRatio || 0) < 0.02) {
            await safeReply(ctx, "Background solid tidak terdeteksi (yang terhapus <2%).\n`!snobg` hanya untuk background 1 warna merata.\nUntuk foto/complex, pakai `!aibg`.");
            return;
        }

        await sendStickerReplyWithMeta(ctx, media, customStickerMeta);
        return;
    }

    if (options.mode === "ai") {
        if (!isImageMime(media.mimetype)) {
            await safeReply(ctx, "`!aibg` hanya support gambar, bukan video.");
            return;
        }

        await safeReply(ctx, "⏳ Sedang hapus background pakai AI lokal...");
        media = await removeBackgroundAI(media);
        await sendStickerReplyWithMeta(ctx, media, customStickerMeta);
    }
}

async function removeBgAsImage(ctx) {
    const sourceMessage = await getSourceMessage(ctx);

    if (!sourceMessage) {
        await replyNoSourceMessage(ctx, "Kirim/reply gambar dengan command `!rmbg`.");
        return;
    }

    if (!sourceMessage.hasMedia) {
        await safeReply(ctx, "Pesan yang direply tidak punya media.");
        return;
    }

    const media = await safeDownloadMedia(sourceMessage);

    if (!media) {
        await safeReply(ctx, "Gagal download media. Coba kirim ulang.");
        return;
    }

    if (!isImageMime(media.mimetype)) {
        await safeReply(ctx, "`!rmbg` hanya support gambar, bukan video.");
        return;
    }

    const sizeMB = getMediaSizeMB(media);

    if (sizeMB > CONFIG.maxMediaSizeMB) {
        await safeReply(ctx, `Media terlalu besar: ${sizeMB.toFixed(2)} MB. Maksimal ${CONFIG.maxMediaSizeMB} MB.`);
        return;
    }

    await safeReply(ctx, "⏳ Sedang hapus background...");

    try {
        const resultMedia = await removeBackgroundAIAsImage(media);
        const buffer = Buffer.from(resultMedia.data, "base64");
        await sendImage(ctx, buffer, "✅ Background removed");
    } catch (error) {
        console.error("removeBgAsImage error:", error);
        await safeReply(ctx, "Gagal hapus background. Cek terminal.");
    }
}

async function makeMemeSticker(ctx, rawArgs) {
    const sourceMessage = await getSourceMessage(ctx);

    if (!sourceMessage || !sourceMessage.hasMedia) {
        await safeReply(ctx, "Format:\nReply gambar dengan:\n`!smeme teks atas | teks bawah`");
        return;
    }

    const parts = normalizeText(rawArgs).split("|");
    const topText = normalizeText(parts[0] || "");
    const bottomText = normalizeText(parts.slice(1).join("|") || "");

    if (!topText && !bottomText) {
        await safeReply(ctx, "Teks kosong.\nContoh:\n`!smeme BENTAR | MIKIR DULU`");
        return;
    }

    const media = await safeDownloadMedia(sourceMessage);

    if (!media) {
        await safeReply(ctx, "Gagal download gambar.");
        return;
    }

    if (!isImageMime(media.mimetype)) {
        await safeReply(ctx, "`!smeme` hanya support gambar.");
        return;
    }

    const sticker = await createMemeSticker(media, topText, bottomText);
    await sendStickerReply(ctx, sticker);
}

async function bratSticker(ctx, rawArgs) {
    const text = normalizeText(rawArgs);

    if (!text) {
        await safeReply(ctx, "Format:\n`!brat teks brat`");
        return;
    }

    try {
        const buffer = await createBratBuffer(text);
        await sendStickerReply(ctx, legacyMedia(buffer, "image/png", "brat.png"));
    } catch (error) {
        console.error("brat error:", error);
        await safeReply(ctx, "Gagal bikin brat:\n" + error.message);
    }
}

async function bratVideoSticker(ctx, rawArgs) {
    const text = normalizeText(rawArgs);

    if (!text) {
        await safeReply(ctx, "Format:\n`!bratvid teks brat jalan`");
        return;
    }

    await safeReply(ctx, "⏳ Bikin brat animasi...");

    try {
        const buffer = await createBratVideoBuffer(text);
        await sendStickerReply(ctx, legacyMedia(buffer, "image/webp", "bratvid.webp"));
    } catch (error) {
        console.error("bratvid error:", error);
        await safeReply(ctx, "Gagal bikin bratvid:\n" + error.message);
    }
}

async function createQuoteSticker(ctx, rawText) {
    const parsed = parseQuoteOptions(rawText);
    let quoteText = normalizeText(parsed.text);

    if (!quoteText && ctx.hasQuotedMsg && ctx.quoted) {
        quoteText = normalizeText(ctx.quoted.body);
    }

    if (!quoteText) {
        await safeReply(ctx, "Format:\n`!qc teks`\n`!qc 512x512 --bg #000000 --color #ffffff teks`\natau reply pesan dengan `!qc --bg #000000 --color #ffffff`.");
        return null;
    }

    const svg = createQuoteSvgWithOptions(quoteText, parsed.options);
    const outputBuffer = await sharp(svg).png().toBuffer();

    return legacyMedia(outputBuffer, "image/png", "quote-sticker.png");
}

async function makeQuoteSticker(ctx, rawArgs) {
    const sticker = await createQuoteSticker(ctx, rawArgs);
    if (!sticker) return;

    await sendStickerReply(ctx, sticker);
}

async function makeEmojiSticker(ctx, rawArgs) {
    let emojiText = normalizeText(rawArgs);

    if (!emojiText && ctx.hasQuotedMsg && ctx.quoted) {
        emojiText = normalizeText(ctx.quoted.body);
    }

    if (!emojiText) {
        await safeReply(ctx, "Format:\n`!emote 😭`\n`!emoji 😂`\n`!emo 🗿`\n`!emoji 🫰🏻💛`");
        return;
    }

    try {
        const buffer = await createEmojiRenderBuffer(emojiText);
        await sendStickerReply(ctx, legacyMedia(buffer, "image/png", "emoji-render.png"));
    } catch (error) {
        console.error("Emoji sticker error:", error);
        await safeReply(ctx, "Gagal membuat emoji sticker. Pastikan internet aktif / emoji tersedia di Twemoji.");
    }
}

async function makeEmojiImage(ctx, rawArgs) {
    let emojiText = normalizeText(rawArgs);

    if (!emojiText && ctx.hasQuotedMsg && ctx.quoted) {
        emojiText = normalizeText(ctx.quoted.body);
    }

    if (!emojiText) {
        await safeReply(ctx, "Format:\n`!e-img 😭`\n`!eimg 😂`\n`!e-img 🫰🏻💛`");
        return;
    }

    try {
        const buffer = await createEmojiRenderBuffer(emojiText);
        await sendImage(ctx, buffer, "✅ Emoji image");
    } catch (error) {
        console.error("Emoji image error:", error);
        await safeReply(ctx, "Gagal membuat emoji image. Pastikan internet aktif / emoji tersedia di Twemoji.");
    }
}

async function stickerToImage(ctx) {
    const sourceMessage = await getSourceMessage(ctx);

    if (!sourceMessage) {
        await replyNoSourceMessage(ctx, "Reply sticker dengan command `!toimg`.");
        return;
    }

    if (!sourceMessage.hasMedia) {
        await safeReply(ctx, "Pesan yang direply tidak punya media.");
        return;
    }

    const media = await safeDownloadMedia(sourceMessage);

    if (!media) {
        await safeReply(ctx, "Gagal download sticker.");
        return;
    }

    if (!isWebpMime(media.mimetype)) {
        await safeReply(ctx, `Media bukan sticker WEBP. Terdeteksi: ${media.mimetype}`);
        return;
    }

    const inputBuffer = Buffer.from(media.data, "base64");
    const pngBuffer = await sharp(inputBuffer).png().toBuffer();

    await sendImage(ctx, pngBuffer, "Converted sticker -> PNG");
}

// ---------- image tools ----------

async function resizeMedia(ctx, rawArgs) {
    const { parseResizeDimensions } = require("./util");
    const media = await downloadImageFromCommand(ctx, "resize");
    if (!media) return;

    const { width, height } = parseResizeDimensions(rawArgs);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(width, height, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "resized.png", "✅ Resized " + width + "x" + height);
}

async function cropMedia(ctx) {
    const media = await downloadImageFromCommand(ctx, "crop");
    if (!media) return;

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 512, {
            fit: "cover",
            position: "center"
        })
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "crop.png", "✅ Cropped square");
}

async function watermarkMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "wm");
    if (!media) return;

    const text = normalizeText(rawArgs) || "Faa";
    const safeText = escapeXml(text.slice(0, 40));

    const svg = Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <text x="486" y="488"
                text-anchor="end"
                font-family="Arial, sans-serif"
                font-size="28"
                font-weight="800"
                fill="white"
                stroke="black"
                stroke-width="4"
                paint-order="stroke">${safeText}</text>
        </svg>
    `);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .composite([{ input: svg, top: 0, left: 0 }])
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "watermark.png", "✅ Watermark added");
}

async function textSticker(ctx, rawArgs) {
    if (!normalizeText(rawArgs)) {
        await safeReply(
            ctx,
            "Format:\n`!stext teks`\n`!stext Iyaa | Bang`\n`!stext -b Iyaa | Bang`\n`!stext -bi Iyaa | Bang`"
        );
        return;
    }

    const svg = createTextSvg(rawArgs);
    const buffer = await sharp(svg).png().toBuffer();

    await sendStickerResult(ctx, buffer);
}

async function textToPng(ctx, rawArgs) {
    if (!normalizeText(rawArgs)) {
        await safeReply(
            ctx,
            "Format:\n`!ttp teks`\n`!ttp Iyaa | Bang`\n`!ttp -b Iyaa | Bang`\n`!ttp -bi Iyaa | Bang`"
        );
        return;
    }

    const svg = createTextSvg(rawArgs, {
        background: "white",
        fill: "black",
        stroke: "transparent",
        strokeWidth: 0
    });

    const buffer = await sharp(svg).png().toBuffer();

    await sendImageResult(ctx, buffer, "text.png", "✅ Text PNG");
}

async function circleMedia(ctx) {
    const media = await downloadImageFromCommand(ctx, "circle");
    if (!media) return;

    const circleMask = Buffer.from(`
        <svg width="512" height="512">
            <circle cx="256" cy="256" r="250" fill="white"/>
        </svg>
    `);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 512, { fit: "cover" })
        .composite([{ input: circleMask, blend: "dest-in" }])
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "circle.png", "✅ Circle crop");
}

async function rotateMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "rotate");
    if (!media) return;

    const degree = parseNumber(rawArgs.split(/\s+/)[0], 90);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate(degree)
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "rotate.png", `✅ Rotated ${degree}°`);
}

async function flipMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "flip");
    if (!media) return;

    const mode = normalizeText(rawArgs).toLowerCase();
    let img = sharp(Buffer.from(media.data, "base64")).rotate();

    if (mode === "v" || mode === "vertical") {
        img = img.flip();
    } else {
        img = img.flop();
    }

    const buffer = await img.png().toBuffer();

    await sendImageResult(ctx, buffer, "flip.png", "✅ Flipped");
}

async function compressMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "compress");
    if (!media) return;

    const quality = Math.min(Math.max(parseNumber(rawArgs.split(/\s+/)[0], 65), 10), 95);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .jpeg({ quality })
        .toBuffer();

    await sendImage(ctx, buffer, `✅ Compressed quality ${quality}`);
}

async function borderMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "border");
    if (!media) return;

    const args = rawArgs.split(/\s+/).filter(Boolean);
    const size = parseNumber(args[0], 20);
    const color = parseColor(args[1], "#ffffff");

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512 - size * 2, 512 - size * 2, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .extend({
            top: size,
            bottom: size,
            left: size,
            right: size,
            background: hexToRgba(color, 1)
        })
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "border.png", "✅ Border added");
}

async function roundMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "round");
    if (!media) return;

    const radius = Math.min(Math.max(parseNumber(rawArgs.split(/\s+/)[0], 45), 5), 220);

    const mask = Buffer.from(`
        <svg width="512" height="512">
            <rect x="0" y="0" width="512" height="512" rx="${radius}" ry="${radius}" fill="white"/>
        </svg>
    `);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 512, { fit: "cover" })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "round.png", "✅ Rounded");
}

async function backgroundMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "bg");
    if (!media) return;

    const color = parseColor(rawArgs.split(/\s+/)[0], "#ffffff");

    const imageBuffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

    const buffer = await sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: hexToRgba(color, 1)
        }
    })
        .composite([{ input: imageBuffer, top: 0, left: 0 }])
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "background.png", "✅ Background added");
}

async function captionMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "caption");
    if (!media) return;

    const text = normalizeText(rawArgs);

    if (!text) {
        await safeReply(ctx, "Format:\nReply gambar dengan `!caption teks`");
        return;
    }

    const baseBuffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 430, {
            fit: "contain",
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toBuffer();

    const captionSvg = createTextSvg(text, {
        background: "white",
        fill: "black",
        stroke: "transparent",
        strokeWidth: 0
    });

    const captionBuffer = await sharp(captionSvg)
        .resize(512, 82, { fit: "contain" })
        .png()
        .toBuffer();

    const buffer = await sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    })
        .composite([
            { input: baseBuffer, top: 0, left: 0 },
            { input: captionBuffer, top: 430, left: 0 }
        ])
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "caption.png", "✅ Caption added");
}

async function pixelMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "pixel");
    if (!media) return;

    const pixelSize = Math.min(Math.max(parseNumber(rawArgs.split(/\s+/)[0], 16), 4), 128);
    const baseSize = Math.max(4, Math.floor(512 / pixelSize));

    const inputBuffer = Buffer.from(media.data, "base64");

    const buffer = await sharp(inputBuffer)
        .rotate()
        .resize(baseSize, baseSize, {
            fit: "cover",
            position: "center"
        })
        .resize(512, 512, {
            kernel: sharp.kernel.nearest
        })
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "pixel.png", `✅ Pixelated ${pixelSize}`);
}

async function imageInfoMedia(ctx) {
    const sourceMessage = await getSourceMessage(ctx);

    if (!sourceMessage || !sourceMessage.hasMedia) {
        await safeReply(ctx, "Reply gambar/sticker dengan command `!infoimg`.");
        return;
    }

    const media = await safeDownloadMedia(sourceMessage);

    if (!media) {
        await safeReply(ctx, "Gagal download media.");
        return;
    }

    if (!isImageMime(media.mimetype) && !isWebpMime(media.mimetype)) {
        await safeReply(ctx, `Format tidak support: ${media.mimetype}`);
        return;
    }

    const inputBuffer = Buffer.from(media.data, "base64");
    const meta = await sharp(inputBuffer).metadata();
    const sizeMB = inputBuffer.length / (1024 * 1024);

    const info = [
        "*Image Info*",
        "",
        `Mime: ${media.mimetype}`,
        `Size: ${sizeMB.toFixed(2)} MB`,
        `Format: ${meta.format || "-"}`,
        `Width: ${meta.width || "-"}`,
        `Height: ${meta.height || "-"}`,
        `Channels: ${meta.channels || "-"}`,
        `Has Alpha: ${meta.hasAlpha ? "YES" : "NO"}`,
        `Animated: ${meta.pages && meta.pages > 1 ? "YES" : "NO"}`,
        `Pages: ${meta.pages || 1}`
    ].join("\n");

    await safeReply(ctx, info);
}

async function blurMedia(ctx, rawArgs) {
    const media = await downloadImageFromCommand(ctx, "blur");
    if (!media) return;

    const amount = Math.min(Math.max(parseNumber(rawArgs.split(/\s+/)[0], 8), 1), 50);

    const buffer = await sharp(Buffer.from(media.data, "base64"))
        .rotate()
        .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .blur(amount)
        .png()
        .toBuffer();

    await sendImageResult(ctx, buffer, "blur.png", `✅ Blurred ${amount}`);
}

async function makeModernQuoteSticker(ctx, rawArgs) {
    try {
        const name = getSenderName(ctx) || "Unknown";
        const cleanName = String(name).replace(/\s+/g, " ").trim().slice(0, 48) || "Unknown";

        let quoteText = normalizeText(rawArgs);

        if (!quoteText && ctx.hasQuotedMsg && ctx.quoted) {
            quoteText = normalizeText(ctx.quoted.body);
        }

        if (!quoteText) {
            await safeReply(ctx, "Format:\n`!quote2 teks`\natau reply pesan dengan `!quote2`.");
            return;
        }

        quoteText = quoteText.slice(0, 260);

        let avatarRaw = null;
        try {
            const jid = (ctx.quoted && ctx.quoted.senderId) || ctx.senderId;
            const photos = jid ? await getBot().getUserProfilePhotos(Number(jid), { limit: 1 }) : null;
            const fileId = photos?.photos?.[0]?.[0]?.file_id || photos?.photos?.[0]?.slice(-1)?.[0]?.file_id;
            if (fileId) {
                const link = await getBot().getFileLink(fileId);
                avatarRaw = await httpGetBuffer(link);
            }
        } catch (_) {}

        const avatar = await createRoundedAvatarBuffer(avatarRaw, cleanName);
        const baseSvg = createModernQuoteBaseSvg(cleanName, quoteText);

        const outputBuffer = await sharp(baseSvg)
            .composite([{ input: avatar, top: 58, left: 48 }])
            .png()
            .toBuffer();

        await sendStickerReply(ctx, legacyMedia(outputBuffer, "image/png", "quote2.png"));
    } catch (error) {
        console.error("quote2 error:", error);
        await safeReply(ctx, "Gagal membuat quote2. Cek terminal.");
    }
}

// ---------- system / admin ----------

async function sendPing(ctx) {
    const start = Date.now();
    try {
        await getBot()?.sendChatAction(ctx.chatId, "typing");
    } catch (_) {}
    const latency = Date.now() - start;
    await safeReply(ctx, `pong ✅\nLatency: ${latency} ms`);
}

async function sendChatId(ctx) {
    const info = [
        "*Chat Info*",
        "",
        `Chat ID: \`${ctx.chatId}\``,
        `Is Group: ${ctx.isGroup}`,
        `Sender ID: \`${ctx.senderId}\``,
        `PushName: ${ctx.pushName || "-"}`
    ].join("\n");

    await safeReply(ctx, info);
}

async function sendStatus(ctx) {
    const memory = process.memoryUsage();
    const tempCount = await countFilesInDir(TEMP_DIR);
    const downloadCount = await countFilesInDir(DOWNLOAD_DIR);
    const versions = getDependencyVersions();
    const totalCommands = new Set(getCommandRegistry().map((item) => item.alias)).size;

    let username = "-";
    try {
        username = (await getBot().getMe()).username || "-";
    } catch (_) {}

    const info = [
        "*Bot Status (Telegram)*",
        "",
        `Uptime: ${formatUptime(process.uptime())}`,
        `Heap Used: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        `RSS Memory: ${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
        `Temp Files: ${tempCount}`,
        `Downloads Files: ${downloadCount}`,
        `Active Jobs: ${activeJobs.size}`,
        `Total Commands: ${totalCommands}`,
        `node-telegram-bot-api: ${versions.tgapi}`,
        `sharp: ${versions.sharp}`,
        `Node: ${process.version}`,
        `Bot: @${username}`,
        `Prefix: ${CONFIG.prefix}`,
        `Owner Only: ${CONFIG.ownerOnly ? "ON" : "OFF"}`,
        `Self Command: ${CONFIG.allowSelfMessage ? "ON" : "OFF"}`,
        `Watermark: ${CONFIG.visualWatermark.enabled ? "ON" : "OFF"}`,
        `Watermark Text: ${CONFIG.visualWatermark.text}`,
        `Sticker Author: ${CONFIG.stickerAuthor}`,
        `Sticker Pack: ${CONFIG.defaultStickerPack}`
    ].join("\n");

    await safeReply(ctx, info);
}

async function cleanBotFiles(ctx) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner/self.");
        return;
    }

    const temp = await cleanFilesInDir(TEMP_DIR);
    const downloads = await cleanFilesInDir(DOWNLOAD_DIR);

    const info = [
        "*Cleanup Done*",
        "",
        `Temp deleted: ${temp.deleted}`,
        `Downloads deleted: ${downloads.deleted}`,
        `Failed: ${temp.failed + downloads.failed}`
    ].join("\n");

    await safeReply(ctx, info);
}

async function changePrefix(ctx, rawArgs) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner/self.");
        return;
    }

    const newPrefix = normalizeText(rawArgs);

    if (!newPrefix) {
        await safeReply(ctx, `Prefix sekarang: ${CONFIG.prefix}\nFormat: ${CONFIG.prefix}prefix .`);
        return;
    }

    if (newPrefix.length > 3) {
        await safeReply(ctx, "Prefix maksimal 3 karakter.");
        return;
    }

    if (/\s/.test(newPrefix)) {
        await safeReply(ctx, "Prefix tidak boleh mengandung spasi.");
        return;
    }

    CONFIG.prefix = newPrefix;
    saveBotState();

    await safeReply(ctx, `Prefix updated: ${CONFIG.prefix}\nContoh: ${CONFIG.prefix}ping`);
}

async function setWatermarkConfig(ctx, rawArgs) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner/self.");
        return;
    }

    const args = normalizeText(rawArgs);
    const lower = args.toLowerCase();

    if (!args) {
        await safeReply(
            ctx,
            [
                "*Watermark Config*",
                "",
                `Status: ${CONFIG.visualWatermark.enabled ? "ON" : "OFF"}`,
                `Text: ${CONFIG.visualWatermark.text}`,
                `Opacity: ${CONFIG.visualWatermark.opacity}`,
                "",
                "Format:",
                `${CONFIG.prefix}setwm on`,
                `${CONFIG.prefix}setwm off`,
                `${CONFIG.prefix}setwm text Faa Bot`,
                `${CONFIG.prefix}setwm opacity 0.7`
            ].join("\n")
        );
        return;
    }

    if (lower === "on") {
        CONFIG.visualWatermark.enabled = true;
        saveBotState();
        await safeReply(ctx, "Watermark: ON");
        return;
    }

    if (lower === "off") {
        CONFIG.visualWatermark.enabled = false;
        saveBotState();
        await safeReply(ctx, "Watermark: OFF");
        return;
    }

    if (lower.startsWith("text ")) {
        const text = args.slice(5).trim();

        if (!text) {
            await safeReply(ctx, "Text watermark kosong.");
            return;
        }

        CONFIG.visualWatermark.text = text.slice(0, 40);
        saveBotState();
        await safeReply(ctx, `Watermark text updated: ${CONFIG.visualWatermark.text}`);
        return;
    }

    if (lower.startsWith("opacity ")) {
        const value = Number(args.slice(8).trim());

        if (!Number.isFinite(value)) {
            await safeReply(ctx, "Opacity harus angka. Contoh: 0.7");
            return;
        }

        CONFIG.visualWatermark.opacity = Math.min(Math.max(value, 0.1), 1);
        saveBotState();
        await safeReply(ctx, `Watermark opacity updated: ${CONFIG.visualWatermark.opacity}`);
        return;
    }

    await safeReply(ctx, "Format salah. Pakai `!setwm` untuk bantuan.");
}

async function ownerDebug(ctx) {
    const senderIds = getPossibleSenderIds(ctx);

    const info = [
        "*Owner Debug*",
        "",
        "Sender IDs:",
        senderIds.length ? senderIds.map((id, i) => `${i + 1}. ${id}`).join("\n") : "- kosong -",
        "",
        "Owners:",
        CONFIG.owners.length ? CONFIG.owners.map((id, i) => `${i + 1}. ${id}`).join("\n") : "- kosong -",
        "",
        `Matched: ${isOwnerIdMatch(senderIds) ? "YES" : "NO"}`
    ].join("\n");

    await safeReply(ctx, info);
}

async function manageOwner(ctx, rawArgs) {
    const args = normalizeText(rawArgs);
    const parts = args.split(/\s+/).filter(Boolean);
    const action = (parts[0] || "").toLowerCase();

    if (action === "debug") {
        await ownerDebug(ctx);
        return;
    }

    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner/self.");
        return;
    }

    if (!action || action === "help") {
        await safeReply(
            ctx,
            [
                "*Owner Command*",
                "",
                `${CONFIG.prefix}owner list`,
                `${CONFIG.prefix}owner add <telegram_user_id>`,
                `${CONFIG.prefix}owner del <telegram_user_id>`,
                `${CONFIG.prefix}owner only on`,
                `${CONFIG.prefix}owner only off`,
                "",
                "Lihat ID kamu: kirim pesan apa saja, lalu `!id`."
            ].join("\n")
        );
        return;
    }

    if (action === "list") {
        const owners = CONFIG.owners.length
            ? CONFIG.owners.map((item, index) => `${index + 1}. ${item}`).join("\n")
            : "- kosong (semua danger-command terbuka!) -";

        await safeReply(ctx, ["*Owner List*", "", owners, "", `Owner Only: ${CONFIG.ownerOnly ? "ON" : "OFF"}`].join("\n"));
        return;
    }

    if (action === "add") {
        const id = (parts[1] || "").replace(/\D/g, "");

        if (!id) {
            await safeReply(ctx, "Format: `!owner add <telegram_user_id>`");
            return;
        }

        if (!CONFIG.owners.includes(id)) {
            CONFIG.owners.push(id);
            saveBotState();
        }

        await safeReply(ctx, `Owner added: ${id}`);
        return;
    }

    if (action === "del" || action === "remove") {
        const id = (parts[1] || "").replace(/\D/g, "");

        if (!id) {
            await safeReply(ctx, "Format: `!owner del <telegram_user_id>`");
            return;
        }

        CONFIG.owners = CONFIG.owners.filter((item) => item !== id);
        saveBotState();

        await safeReply(ctx, `Owner removed: ${id}`);
        return;
    }

    if (action === "only") {
        const mode = (parts[1] || "").toLowerCase();

        if (mode === "on") {
            CONFIG.ownerOnly = true;
            saveBotState();
            await safeReply(ctx, "Owner only: ON");
            return;
        }

        if (mode === "off") {
            CONFIG.ownerOnly = false;
            saveBotState();
            await safeReply(ctx, "Owner only: OFF");
            return;
        }

        await safeReply(ctx, "Format: `!owner only on` / `!owner only off`");
        return;
    }

    await safeReply(ctx, "Action owner tidak dikenal. Pakai `!owner help`.");
}

async function setStickerPack(ctx, rawArgs) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner/self.");
        return;
    }

    const args = normalizeText(rawArgs);

    if (!args) {
        await safeReply(
            ctx,
            [
                "*Sticker Pack*",
                "",
                `Pack: ${CONFIG.defaultStickerPack}`,
                `Author: ${CONFIG.stickerAuthor}`,
                "",
                `Format: ${CONFIG.prefix}stickerpack Pack Name | Author Name`
            ].join("\n")
        );
        return;
    }

    const parts = args.split("|");
    const pack = normalizeText(parts[0]).slice(0, 60);
    const author = normalizeText(parts.slice(1).join("|")).slice(0, 60);

    if (!pack) {
        await safeReply(ctx, "Pack name kosong.");
        return;
    }

    CONFIG.defaultStickerPack = pack;

    if (author) {
        CONFIG.stickerAuthor = author;
    }

    saveBotState();

    await safeReply(
        ctx,
        [
            "Sticker pack updated:",
            `Pack: ${CONFIG.defaultStickerPack}`,
            `Author: ${CONFIG.stickerAuthor}`
        ].join("\n")
    );
}

async function restartBot(ctx) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner/self.");
        return;
    }

    await safeReply(ctx, "Restarting bot...");

    setTimeout(() => {
        process.exit(0);
    }, 1200);
}

// ---------- profile ----------

async function sendProfilePicture(ctx) {
    let userId = ctx.senderId;
    let name = ctx.pushName || "profile";

    if (ctx.quoted) {
        if (ctx.quoted.senderId) userId = ctx.quoted.senderId;
        if (ctx.quoted.pushName) name = ctx.quoted.pushName;
    }

    try {
        const photos = await getBot().getUserProfilePhotos(Number(userId), { limit: 1 });
        const fileId = photos?.photos?.[0]?.slice(-1)?.[0]?.file_id;

        if (!fileId) {
            await safeReply(ctx, "Profile picture tidak tersedia / privacy dibatasi.");
            return;
        }

        const link = await getBot().getFileLink(fileId);
        const buffer = await httpGetBuffer(link);
        await sendImage(ctx, buffer, "✅ Profile picture");
    } catch (error) {
        console.error("profile picture error:", error);
        await safeReply(ctx, "Gagal mengambil profile picture.");
    }
}

// ---------- ytdl ----------

async function runPythonYtdl(mode, url, extraArgs = []) {
    const candidates = [
        process.env.PYTHON_BIN
            ? { cmd: process.env.PYTHON_BIN, args: [YTDL_SCRIPT] }
            : null,
        { cmd: "py", args: ["-3", YTDL_SCRIPT] },
        { cmd: "python", args: [YTDL_SCRIPT] },
        { cmd: "python3", args: [YTDL_SCRIPT] }
    ].filter(Boolean);

    const errors = [];

    for (const candidate of candidates) {
        try {
            return await new Promise((resolve, reject) => {
                const child = spawn(
                    candidate.cmd,
                    [
                        ...candidate.args,
                        "--mode",
                        mode,
                        "--url",
                        url,
                        "--dir",
                        DOWNLOAD_DIR,
                        ...extraArgs
                    ],
                    {
                        cwd: require("./state").ROOT_DIR,
                        windowsHide: true,
                        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
                    }
                );

                let stdout = "";
                let stderr = "";
                let finished = false;

                const timer = setTimeout(() => {
                    if (finished) return;
                    finished = true;
                    try {
                        child.kill("SIGKILL");
                    } catch (_) {}
                    reject(new Error(`yt-dlp timeout ${Math.round(YTDL_TIMEOUT_MS / 1000)}s. Coba lagi / turunkan kualitas.`));
                }, YTDL_TIMEOUT_MS);

                child.stdout.on("data", (data) => {
                    stdout += data.toString();
                });

                child.stderr.on("data", (data) => {
                    stderr += data.toString();
                });

                child.on("error", (err) => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    reject(err);
                });

                child.on("close", (code) => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    const output = `${stdout}\n${stderr}`;
                    const lines = output
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);

                    let payload = null;

                    for (let i = lines.length - 1; i >= 0; i--) {
                        if (!lines[i].startsWith("{") || !lines[i].endsWith("}")) continue;

                        try {
                            payload = JSON.parse(lines[i]);
                            break;
                        } catch (_) {}
                    }

                    if (payload && payload.ok) {
                        resolve(payload.result);
                        return;
                    }

                    if (payload && !payload.ok) {
                        reject(new Error(payload.error || `yt-dlp exit code ${code}`));
                        return;
                    }

                    reject(new Error(stderr.trim() || stdout.trim() || `yt-dlp exit code ${code}`));
                });
            });
        } catch (error) {
            errors.push(`${candidate.cmd}: ${error.message}`);
        }
    }

    throw new Error(errors.join("\n"));
}

async function handleYtdlInfo(ctx, rawArgs) {
    if (/^(ver|version)$/i.test(normalizeText(rawArgs))) {
        await safeReply(ctx, "⏳ Cek versi yt-dlp...");

        try {
            const ver = await runPythonYtdl("version", "");

            await safeReply(
                ctx,
                [
                    "*YTDL Version*",
                    "",
                    `yt-dlp: ${ver.ytdlp}`,
                    `FFmpeg: ${ver.ffmpeg ? "OK" : "TIDAK ADA"}`,
                    `cookies.txt: ${ver.cookies ? "OK" : "-"}`
                ].join("\n")
            );
        } catch (error) {
            console.error("YTDL version error:", error);
            await safeReply(ctx, "Gagal cek versi:\n" + error.message);
        }

        return;
    }

    const rawUrl = await extractUrlFromMessage(ctx, rawArgs);
    const validated = validatePublicUrl(rawUrl);

    if (!validated.ok) {
        await safeReply(ctx, "Format:\n!ytdl <url>\natau reply pesan berisi URL dengan !ytdl\n\nError: " + validated.reason);
        return;
    }

    const url = validated.url;

    await safeReply(ctx, "⏳ Mengambil info media...");

    try {
        const info = await runPythonYtdl("info", url);

        const durationMin = Math.floor((info.duration || 0) / 60);
        const durationSec = Math.floor((info.duration || 0) % 60);
        const views = Number(info.view_count || 0).toLocaleString("id-ID");

        await safeReply(
            ctx,
            [
                "*YTDL Info*",
                "",
                "Title: " + info.title,
                "Uploader: " + info.uploader,
                "Source: " + (info.extractor || "-"),
                "Views: " + views,
                "Duration: " + durationMin + ":" + String(durationSec).padStart(2, "0"),
                "",
                "Download:",
                "!yta <url> -> MP3",
                "!ytv <url> -> MP4"
            ].join("\n")
        );
    } catch (error) {
        console.error("YTDL info error:", error);
        await safeReply(ctx, "Gagal ambil info:\n" + error.message);
    }
}

async function handleYtdlAudio(ctx, rawArgs) {
    const { quality, rest } = parseYtdlQuality(rawArgs, YTDL_AUDIO_QUALITIES, "192");
    const rawUrl = await extractUrlFromMessage(ctx, rest);
    const validated = validatePublicUrl(rawUrl);

    if (!validated.ok) {
        await safeReply(ctx, "Format:\n!yta <url>\n!yta 128 <url> (64/128/192/256/320)\natau reply pesan berisi URL dengan !yta\n\nError: " + validated.reason);
        return;
    }

    const url = validated.url;

    await safeReply(ctx, `⏳ Download audio MP3 ${quality}kbps...`);

    let outputPath = "";

    try {
        const result = await runPythonYtdl("audio", url, ["--quality", quality]);
        outputPath = result.path;

        const title = sanitizeCaptionText(result.title || "audio");
        const buffer = fs.readFileSync(outputPath);

        await sendAudio(ctx, buffer, "audio/mpeg", `${title}.mp3`);
        await safeReply(ctx, `✅ MP3 ${quality}kbps\n${title}\n${Number(result.size_mb || 0).toFixed(2)} MB`);
    } catch (error) {
        console.error("YTDL audio error:", error);
        await safeReply(ctx, "Gagal download audio:\n" + error.message);
    } finally {
        if (outputPath) await safeUnlinkMany([outputPath]);
    }
}

async function handleYtdlVideo(ctx, rawArgs) {
    const { quality, rest } = parseYtdlQuality(rawArgs, YTDL_VIDEO_HEIGHTS, "720");
    const rawUrl = await extractUrlFromMessage(ctx, rest);
    const validated = validatePublicUrl(rawUrl);

    if (!validated.ok) {
        await safeReply(ctx, "Format:\n!ytv <url>\n!ytv 480 <url> (360/480/720/1080)\natau reply pesan berisi URL dengan !ytv\n\nError: " + validated.reason);
        return;
    }

    const url = validated.url;

    await safeReply(ctx, `⏳ Download video MP4 ${quality}p...`);

    let outputPath = "";

    try {
        const result = await runPythonYtdl("video", url, ["--quality", quality]);
        outputPath = result.path;

        const title = sanitizeCaptionText(result.title || "video");
        const buffer = fs.readFileSync(outputPath);

        await sendVideo(ctx, buffer, `✅ MP4 ${result.height || quality}p\n${title}\n${Number(result.size_mb || 0).toFixed(2)} MB`, `${title}.mp4`);
    } catch (error) {
        console.error("YTDL video error:", error);
        await safeReply(ctx, "Gagal download video:\n" + error.message);
    } finally {
        if (outputPath) await safeUnlinkMany([outputPath]);
    }
}

// ---------- menus (sama, label Telegram) ----------

// ---------- menus interaktif ----------

const MENU_DEFS = [
    { key: "main", label: "🏠 Menu", title: "*Main Menu*" },
    { key: "command", label: "📜 All", title: "*ALL COMMAND MENU*" },
    { key: "sticker", label: "🎨 Sticker", title: "*Sticker Menu*" },
    { key: "textmaker", label: "✏️ Text", title: "*Text Maker Menu*" },
    { key: "translate", label: "🌐 Translate", title: "*Translate Menu*" },
    { key: "games", label: "🎮 Games", title: "*🎮 Games Menu*" },
    { key: "group", label: "👥 Group", title: "*Group Menu*" },
    { key: "search", label: "🔎 Search", title: "*Search Menu*" },
    { key: "anime", label: "🎌 Anime", title: "*Anime Menu*" }
];

function menuTexts() {
    const total = new Set(getCommandRegistry().map((item) => item.alias)).size;
    const head = (title) => [`*${CONFIG.botName}*`, "", title, "", `Prefix: \`${CONFIG.prefix}\` | Total: ${total} command`, ""];

    return {
        main: head("*Main Menu*").concat([
            "`!menusticker` -> sticker tools",
            "`!menutextmaker` -> text maker",
            "`!menutranslate` -> translate + AI",
            "`!menugames` -> games ringan",
            "`!menugroup` -> group tools",
            "`!menusearch` -> wiki/search tools",
            "`!menuanime` -> anime/manga search",
            "",
            "*Quick Commands*",
            "`!s` / `!sticker` -> sticker",
            "`!quote2 teks` -> quote sticker modern",
            "`!tr en > id hello` -> translate",
            "`!yta <url>` -> MP3",
            "`!ytv <url>` -> MP4",
            "`!usage <command>` -> format command",
            "`!menucommand` -> semua command lengkap",
            "`!status` -> bot status",
            "`!ping` -> cek bot",
            "",
            "👇 Pilih kategori di bawah:"
        ]).join("\n"),

        command: head("*ALL COMMAND MENU*").concat([
            "*Sticker:*",
            "`!s` / `!sticker` / `!stiker`",
            "`!s Pack Name | Author Name`",
            "`!snobg` / `!nobg`",
            "`!aibg` / `!stikeraibg` / `!bgai`",
            "`!rmbg` / `!removebg` / `!hapusbg`",
            "`!toimg` / `!img`",
            "`!brat` / `!bratvid`",
            "",
            "*Creative:*",
            "`!smeme teks atas | teks bawah`",
            "`!qc teks` (`--bold --italic --big --center --serif --mono`)",
            "`!quote2 teks` / reply pesan `!quote2`",
            "`!emote 😭` / `!emoji 😂` / `!emo 🗿`",
            "`!e-img 😭`",
            "",
            "*Image Tools:*",
            "`!resize 512` / `!resize 800 450`",
            "`!crop` / `!circle` / `!rotate 90`",
            "`!flip h` / `!flip v` / `!compress 65`",
            "`!border 20 #ffffff` / `!round 45`",
            "`!bg #ffffff` / `!wm teks` / `!caption teks`",
            "`!blur 8` / `!pixel 16` / `!infoimg`",
            "",
            "*Text Tools:*",
            "`!stext teks` / `!ttp teks`",
            "`!fancy` / `!reverse` / `!uppercase` / `!lowercase`",
            "`!mock` / `!space`",
            "",
            "*Translate:*",
            "`!tr en > id hello world`",
            "`!tr auto > id hello friend`",
            "`!tr inggris > indonesia halo`",
            "",
            "*Downloader:*",
            "`!ytdl <url>` / `!ytdl ver`",
            "`!yta <url>` / `!yta 128 <url>`",
            "`!ytv <url>` / `!ytv 480 <url>`",
            "`!tiktok <url>` / `!igdl <url>` / `!fbdl <url>`",
            "",
            "*Tools:*",
            "`!qr teks` / `!tts teks` / `!trivia`",
            "`!cuaca jakarta` / `!lirik artis - judul`",
            "`!short <url>` / `!calc 12*8+5`",
            "`!quotes` / `!rmeme`",
            "`!broadcast teks` (owner)",
            "",
            "*Games:*",
            "`!coin` / `!dice` / `!suit batu`",
            "`!math` / `!slot` / `!tebakangka 7`",
            "",
            "*Group:*",
            "`!groupinfo` / `!tagall` / `!hidetag teks`",
            "`!kick` / `!promote` / `!demote` (reply/tag)",
            "`!mute on/off` / `!leave` / `!join info`",
            "",
            "*Search:*",
            "`!google query` / `!g query` / `!wiki query`",
            "`!anime naruto` / `!manga one piece`",
            "",
            "*Profile:*",
            "`!pp` / `!profile` (reply pesan + `!pp`)",
            "",
            "*System/Admin:*",
            "`!status` / `!clean` / `!prefix .`",
            "`!setwm on/off/text/opacity`",
            "`!stickerpack Pack | Author`",
            "`!owner list/add/del/only` / `!restart`",
            "",
            "*Utility:*",
            "`!menu` / `!menucommand` / `!usage <command>`",
            "`!ping` / `!id`"
        ]).join("\n"),

        sticker: head("*Sticker Menu*").concat([
            "`!s` -> sticker normal",
            "`!s Pack Name | Author Name` -> + metadata custom",
            "`!snobg` -> hapus background putih",
            "`!aibg` -> AI remove bg",
            "`!smeme atas | bawah` -> meme sticker",
            "`!brat teks` -> brat sticker",
            "`!bratvid teks` -> brat animasi",
            "`!quote2 teks` -> quote sticker modern",
            "`!stickerpack Pack | Author` -> ubah pack global"
        ]).join("\n"),

        textmaker: head("*Text Maker Menu*").concat([
            "`!fancy teks` -> unicode fancy text",
            "`!reverse teks` -> balik teks",
            "`!uppercase teks` -> huruf besar",
            "`!lowercase teks` -> huruf kecil",
            "`!mock teks` -> sPoNgEbOb style",
            "`!space teks` -> kasih spasi antar huruf",
            "`!stext teks` -> sticker teks",
            "`!ttp teks` -> gambar teks"
        ]).join("\n"),

        translate: head("*Translate Menu*").concat([
            "`!tr en > id hello world`",
            "`!tr id > en aku makan nasi`",
            "`!tr auto > id hello friend`",
            "`!tr inggris > indonesia hello friend`",
            "`!tr indonesia > inggris selamat pagi`",
            "`!ai halo, siapa kamu?` -> tanya AI",
            "`!apikey status` / `!aimodel status` (owner)",
            "",
            "API: Google free + fallback kamus lokal."
        ]).join("\n"),

        games: head("*🎮 Games Menu*").concat([
            "`!coin` -> lempar koin",
            "`!dice` -> dadu 1-6",
            "`!suit batu/kertas/gunting` -> suit vs bot",
            "`!slot` -> slot machine",
            "`!slot own` -> easy win owner-only",
            "`!tebakangka 7` -> tebak angka 1-10",
            "`!math` -> soal matematika random",
            "`!gamehelp` -> detail command game"
        ]).join("\n"),

        group: head("*Group Menu*").concat([
            "`!groupinfo` -> info grup",
            "`!tagall` -> tag member tercatat",
            "`!hidetag teks` -> mention tersembunyi",
            "`!kick` / `!promote` / `!demote` (reply/tag)",
            "`!mute on/off` -> kunci grup",
            "`!leave` -> bot keluar grup"
        ]).join("\n"),

        search: head("*Search Menu*").concat([
            "`!wiki query` -> ringkasan Wikipedia",
            "`!google query` -> link Google Search",
            "`!anime query` -> cari anime",
            "`!manga query` -> cari manga",
            "",
            "Google/anime/manga via `!menugoogle` / `!menuanime`."
        ]).join("\n"),

        anime: head("*Anime Menu*").concat([
            "`!anime naruto` -> cari anime via Jikan API",
            "`!manga one piece` -> cari manga via Jikan API",
            "",
            "API: free/no-key, SFW only."
        ]).join("\n")
    };
}

function menuKeyboard() {
    const rows = [];
    for (let i = 0; i < MENU_DEFS.length; i += 3) {
        rows.push(MENU_DEFS.slice(i, i + 3).map((d) => ({ text: d.label, callback_data: `menu:${d.key}` })));
    }
    return { inline_keyboard: rows };
}

async function showMenu(ctx, key) {
    const texts = menuTexts();
    const text = require("./tg").formatReplyText(texts[key] || texts.main);

    try {
        await getBot().sendMessage(ctx.chatId, text, {
            ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {}),
            parse_mode: "Markdown",
            reply_markup: menuKeyboard()
        });
    } catch (error) {
        if (/parse|markdown|entities/i.test(error.message || "")) {
            await getBot().sendMessage(ctx.chatId, text, {
                ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {}),
                reply_markup: menuKeyboard()
            });
            return;
        }
        throw error;
    }
}

async function sendMenu(ctx) {
    await showMenu(ctx, "main");
}



async function gameHelp(ctx) {
    await safeReply(ctx, [
        "*🎮 Game Help*",
        "",
        "`!coin` - Lempar koin: Kepala/Ekor.",
        "",
        "`!dice` - Dadu 1-6.",
        "",
        "`!suit batu` / `!suit kertas` / `!suit gunting` - Suit lawan bot.",
        "",
        "`!slot` - Slot machine 3 reel emoji.",
        "",
        "`!tebakangka 7` - Tebak angka random 1-10.",
        "",
        "`!math` - Soal matematika random."
    ].join("\n"));
}


async function sendMenuGoogle(ctx) {
    await safeReply(ctx, [
        "*Google Menu*",
        "",
        "`!google query` -> generate link Google Search",
        "`!g query` -> alias cepat"
    ].join("\n"));
}






// ---------- games ----------

async function coinFlip(ctx) {
    await safeReply(ctx, "Coin: " + randomItem(["HEAD / Kepala", "TAIL / Ekor"]));
}

async function diceRoll(ctx) {
    await safeReply(ctx, "Dice: " + (Math.floor(Math.random() * 6) + 1));
}

async function suitGame(ctx, rawArgs) {
    const user = normalizeText(rawArgs).toLowerCase();
    const valid = ["batu", "kertas", "gunting"];

    if (!valid.includes(user)) {
        await safeReply(ctx, "Format: `!suit batu` / `!suit kertas` / `!suit gunting`");
        return;
    }

    const bot = randomItem(valid);

    let result = "Seri";
    if (
        (user === "batu" && bot === "gunting") ||
        (user === "kertas" && bot === "batu") ||
        (user === "gunting" && bot === "kertas")
    ) {
        result = "Lu menang";
    } else if (user !== bot) {
        result = "Bot menang";
    }

    await safeReply(ctx, ["*Suit*", "", "Lu: " + user, "Bot: " + bot, "Result: " + result].join("\n"));
}

async function mathGame(ctx) {
    const a = Math.floor(Math.random() * 30) + 1;
    const b = Math.floor(Math.random() * 30) + 1;
    const ops = ["+", "-", "*"];
    const op = randomItem(ops);
    const answer = op === "+" ? a + b : op === "-" ? a - b : a * b;

    await safeReply(ctx, ["*Math Game*", "", a + " " + op + " " + b + " = ?", "Jawaban: || " + answer + " ||"].join("\n"));
}

async function slotGame(ctx, rawArgs = "") {
    const mode = normalizeText(rawArgs).toLowerCase();
    const ownerModes = ["own", "owner", "admin"];
    const isOwnerMode = ownerModes.includes(mode);

    if (isOwnerMode && !canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Mode `!slot " + mode + "` hanya untuk owner/self.");
        return;
    }

    const reels = ["🍒", "🍋", "🍇", "🍉", "⭐", "💎", "🔔", "7️⃣"];
    const roll = Math.random();

    let result = [];
    let status = "KALAH";
    let textKey = "slotLose";
    let modeLabel = "Normal Mode";

    if (isOwnerMode) {
        modeLabel = "Owner Fun Mode";

        if (roll < 0.45) {
            const symbol = randomItem(reels);
            result = [symbol, symbol, symbol];
            status = "JACKPOT";
            textKey = "slotJackpot";
        } else if (roll < 0.85) {
            const symbol = randomItem(reels);
            const other = randomItem(reels.filter((item) => item !== symbol));
            result = [symbol, symbol, other].sort(() => Math.random() - 0.5);
            status = "NYARIS";
            textKey = "slotNear";
        } else {
            result = [...reels].sort(() => Math.random() - 0.5).slice(0, 3);
            status = "KALAH";
            textKey = "slotLose";
        }
    } else {
        modeLabel = "Normal Mode";

        if (roll < 0.08) {
            const symbol = randomItem(reels);
            result = [symbol, symbol, symbol];
            status = "JACKPOT";
            textKey = "slotJackpot";
        } else if (roll < 0.35) {
            const symbol = randomItem(reels);
            const other = randomItem(reels.filter((item) => item !== symbol));
            result = [symbol, symbol, other].sort(() => Math.random() - 0.5);
            status = "NYARIS";
            textKey = "slotNear";
        } else {
            result = [...reels].sort(() => Math.random() - 0.5).slice(0, 3);
            status = "KALAH";
            textKey = "slotLose";
        }
    }

    await safeReply(ctx, [
        "*🎰 Slot Machine*",
        "",
        "Mode: *" + modeLabel + "*",
        "",
        "┌─────────────┐",
        "│  " + result.join("  │  ") + "  │",
        "└─────────────┘",
        "",
        "*Result:* " + status,
        randomGameText(textKey),
        "",
        "_No betting. Just random fun._"
    ].join("\n"));
}

async function tebakAngkaGame(ctx, rawArgs) {
    const guess = parseNumber(rawArgs.split(/\s+/)[0], NaN);
    const answer = Math.floor(Math.random() * 10) + 1;

    if (!Number.isFinite(guess) || guess < 1 || guess > 10) {
        await safeReply(ctx, "Format: `!tebakangka 1-10`\nContoh: `!tebakangka 7`");
        return;
    }

    const diff = Math.abs(answer - guess);
    const correct = guess === answer;
    const textKey = correct ? "guessCorrect" : diff <= 2 ? "guessNear" : "guessFar";

    await safeReply(ctx, [
        "*🔢 Tebak Angka*",
        "",
        "Tebakan lu: " + guess,
        "Angka bot : " + answer,
        "",
        "*Result:* " + (correct ? "BENAR" : "SALAH"),
        randomGameText(textKey)
    ].join("\n"));
}

// ---------- group ----------

async function groupInfo(ctx) {
    if (!ctx.isGroup) {
        await safeReply(ctx, "Command ini hanya untuk group.");
        return;
    }

    try {
        const bot = getBot();
        const info = await bot.getChat(ctx.chatId);
        const admins = await bot.getChatAdministrators(ctx.chatId).catch(() => []);
        let memberCount = "-";
        try {
            memberCount = await bot.getChatMemberCount(ctx.chatId);
        } catch (_) {}

        await safeReply(ctx, [
            "*Group Info*",
            "",
            "Name: " + (info.title || "-"),
            "ID: " + ctx.chatId,
            "Type: " + (info.type || "-"),
            "Members: " + memberCount,
            "Admins: " + admins.length
        ].join("\n"));
    } catch (error) {
        console.error("groupInfo error:", error);
        await safeReply(ctx, "Gagal baca info grup.");
    }
}

async function getKnownUsers(ctx) {
    return (CONFIG.seenUsers && CONFIG.seenUsers[String(ctx.chatId)]) || [];
}

async function tagAll(ctx) {
    if (!ctx.isGroup) {
        await safeReply(ctx, "Command ini hanya untuk group.");
        return;
    }

    const users = await getKnownUsers(ctx);

    if (users.length === 0) {
        await safeReply(ctx, "Belum ada member tercatat di grup ini (bot menandai user yang pernah chat).");
        return;
    }

    const text = users.map((u) => `<a href="tg://user?id=${u.id}">${escapeXml(u.name)}</a>`).join(" ");

    try {
        await getBot().sendMessage(ctx.chatId, text || "Tidak ada member.", {
            parse_mode: "HTML",
            ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {})
        });
    } catch (error) {
        console.error("tagAll error:", error);
        await safeReply(ctx, "Gagal tag all.");
    }
}

async function hideTag(ctx, rawArgs) {
    if (!ctx.isGroup) {
        await safeReply(ctx, "Command ini hanya untuk group.");
        return;
    }

    const users = await getKnownUsers(ctx);
    const text = normalizeText(rawArgs) || "Hidetag";
    const tags = users.map((u) => `<a href="tg://user?id=${u.id}">\u2063</a>`).join("");

    try {
        await getBot().sendMessage(ctx.chatId, text + tags, {
            parse_mode: "HTML",
            ...(ctx.raw?.message_id ? { reply_to_message_id: ctx.raw.message_id } : {})
        });
    } catch (error) {
        console.error("hideTag error:", error);
        await safeReply(ctx, "Gagal hidetag.");
    }
}

async function resolveTargetId(ctx, rawArgs) {
    if (ctx.quoted?.senderId) return String(ctx.quoted.senderId);

    const raw = normalizeText(rawArgs).split(/\s+/)[0] || "";
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 5) return digits;

    if (ctx.mentioned && ctx.mentioned.length > 0) return String(ctx.mentioned[0]);

    return "";
}

async function requireGroupAdmin(ctx) {
    if (!ctx.isGroup) {
        await safeReply(ctx, "Command ini hanya untuk group.");
        return null;
    }

    let admins = [];
    try {
        admins = await getBot().getChatAdministrators(ctx.chatId);
    } catch (error) {
        console.error("getChatAdministrators error:", error);
        await safeReply(ctx, "Gagal baca admin grup.");
        return null;
    }

    const adminIds = admins.map((a) => String(a.user.id));
    const senderAdmin = adminIds.includes(String(ctx.senderId));
    const allowed = canUseDangerCommand(ctx) || senderAdmin;

    let iAmAdmin = false;
    try {
        const me = await getBot().getMe();
        iAmAdmin = adminIds.includes(String(me.id));
    } catch (_) {}

    return { allowed, iAmAdmin };
}

async function kickUser(ctx, rawArgs) {
    const g = await requireGroupAdmin(ctx);
    if (!g) return;

    if (!g.allowed) {
        await safeReply(ctx, "Khusus owner atau admin grup.");
        return;
    }

    if (!g.iAmAdmin) {
        await safeReply(ctx, "Bot harus jadi admin grup dulu.");
        return;
    }

    const target = await resolveTargetId(ctx, rawArgs);

    if (!target) {
        await safeReply(ctx, "Reply/tag target:\n`!kick` (reply pesan target)");
        return;
    }

    try {
        await getBot().banChatMember(ctx.chatId, Number(target));
        await safeReply(ctx, "OK, kick: " + target);
    } catch (error) {
        console.error("kick error:", error);
        await safeReply(ctx, "Gagal kick:\n" + (error.message || error));
    }
}

async function promoteUser(ctx, rawArgs) {
    const g = await requireGroupAdmin(ctx);
    if (!g) return;

    if (!g.allowed) {
        await safeReply(ctx, "Khusus owner atau admin grup.");
        return;
    }

    if (!g.iAmAdmin) {
        await safeReply(ctx, "Bot harus jadi admin grup dulu.");
        return;
    }

    const target = await resolveTargetId(ctx, rawArgs);

    if (!target) {
        await safeReply(ctx, "Reply/tag target:\n`!promote` (reply pesan target)");
        return;
    }

    try {
        await getBot().promoteChatMember(ctx.chatId, Number(target), {
            can_manage_chat: true,
            can_delete_messages: true,
            can_manage_video_chats: true,
            can_restrict_members: true,
            can_promote_members: false,
            can_change_info: true,
            can_invite_users: true,
            can_pin_messages: true
        });
        await safeReply(ctx, "OK, promote: " + target);
    } catch (error) {
        console.error("promote error:", error);
        await safeReply(ctx, "Gagal promote:\n" + (error.message || error));
    }
}

async function demoteUser(ctx, rawArgs) {
    const g = await requireGroupAdmin(ctx);
    if (!g) return;

    if (!g.allowed) {
        await safeReply(ctx, "Khusus owner atau admin grup.");
        return;
    }

    if (!g.iAmAdmin) {
        await safeReply(ctx, "Bot harus jadi admin grup dulu.");
        return;
    }

    const target = await resolveTargetId(ctx, rawArgs);

    if (!target) {
        await safeReply(ctx, "Reply/tag target:\n`!demote` (reply pesan target)");
        return;
    }

    try {
        await getBot().promoteChatMember(ctx.chatId, Number(target), {
            can_manage_chat: false,
            can_delete_messages: false,
            can_manage_video_chats: false,
            can_restrict_members: false,
            can_promote_members: false,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false
        });
        await safeReply(ctx, "OK, demote: " + target);
    } catch (error) {
        console.error("demote error:", error);
        await safeReply(ctx, "Gagal demote:\n" + (error.message || error));
    }
}

async function muteGroup(ctx, rawArgs) {
    const g = await requireGroupAdmin(ctx);
    if (!g) return;

    if (!g.allowed) {
        await safeReply(ctx, "Khusus owner atau admin grup.");
        return;
    }

    if (!g.iAmAdmin) {
        await safeReply(ctx, "Bot harus jadi admin grup dulu.");
        return;
    }

    const mode = normalizeText(rawArgs).toLowerCase();
    const close = ["on", "tutup", "close", "1", "true"].includes(mode);
    const open = ["off", "buka", "open", "0", "false"].includes(mode);

    if (!close && !open) {
        await safeReply(ctx, "Format:\n`!mute on` (cuma admin bisa chat)\n`!mute off` (semua bisa chat)");
        return;
    }

    try {
        await getBot().setChatPermissions(ctx.chatId, close
            ? { can_send_messages: false }
            : { can_send_messages: true, can_send_media_messages: true, can_send_other_messages: true, can_add_web_page_previews: true });
        await safeReply(ctx, close ? "Grup ditutup (cuma admin bisa chat)." : "Grup dibuka.");
    } catch (error) {
        console.error("mute error:", error);
        await safeReply(ctx, "Gagal ubah setting grup:\n" + (error.message || error));
    }
}

async function leaveGroup(ctx) {
    if (!ctx.isGroup) {
        await safeReply(ctx, "Command ini hanya untuk group.");
        return;
    }

    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner.");
        return;
    }

    try {
        await safeReply(ctx, "Bot keluar dari grup. Bye!");
        await getBot().leaveChat(ctx.chatId);
    } catch (error) {
        console.error("leave error:", error);
        await safeReply(ctx, "Gagal keluar grup:\n" + (error.message || error));
    }
}

async function joinGroup(ctx) {
    await safeReply(ctx, "Bot Telegram tidak bisa gabung via link.\nInvite bot manual ke grup: buka grup > tambah anggota > cari username bot.");
}

async function broadcastMessage(ctx, rawArgs) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner.");
        return;
    }

    const text = normalizeText(rawArgs);

    if (!text) {
        await safeReply(ctx, "Format:\n`!broadcast teks pengumuman`");
        return;
    }

    const ids = CONFIG.seenGroups || [];
    let sent = 0;

    await safeReply(ctx, `⏳ Broadcast ke ${ids.length} grup...`);

    for (const gid of ids) {
        try {
            await sendTextTo(Number(gid), `📢 *Broadcast*\n\n${text}`);
            sent++;
            await new Promise((r) => setTimeout(r, 1200));
        } catch (error) {
            console.error("broadcast fail", gid, error.message);
        }
    }

    await safeReply(ctx, `Broadcast selesai: ${sent}/${ids.length} grup.`);
}

// ---------- search ----------

async function googleSearch(ctx, rawArgs) {
    const query = normalizeText(rawArgs);

    if (!query) {
        await safeReply(ctx, "Format: `!google query`");
        return;
    }

    await safeReply(ctx, "Google Search:\nhttps://www.google.com/search?q=" + encodeQuery(query));
}

async function wikiSearch(ctx, rawArgs) {
    const query = normalizeText(rawArgs);

    if (!query) {
        await safeReply(ctx, "Format: `!wiki query`");
        return;
    }

    try {
        const searchUrl = "https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + encodeQuery(query) + "&format=json&utf8=1";
        const data = await httpGetJson(searchUrl);
        const first = data?.query?.search?.[0];

        if (!first) {
            await safeReply(ctx, "Wikipedia result tidak ditemukan.");
            return;
        }

        const title = first.title;
        const summaryUrl = "https://id.wikipedia.org/api/rest_v1/page/summary/" + encodeQuery(title);
        const summary = await httpGetJson(summaryUrl);

        await safeReply(ctx, [
            "*Wikipedia*",
            "",
            "Title: " + (summary.title || title),
            "",
            String(summary.extract || "Tidak ada summary.").slice(0, 1200),
            "",
            summary.content_urls?.desktop?.page || ("https://id.wikipedia.org/wiki/" + encodeQuery(title))
        ].join("\n"));
    } catch (error) {
        console.error("wiki error:", error);
        await safeReply(ctx, "Gagal mengambil data Wikipedia.");
    }
}

async function animeSearch(ctx, rawArgs) {
    const query = normalizeText(rawArgs);

    if (!query) {
        await safeReply(ctx, "Format: `!anime naruto`");
        return;
    }

    try {
        const url = "https://api.jikan.moe/v4/anime?q=" + encodeQuery(query) + "&sfw=true&limit=1";
        const data = await httpGetJson(url);
        const item = data?.data?.[0];

        if (!item) {
            await safeReply(ctx, "Anime tidak ditemukan.");
            return;
        }

        await safeReply(ctx, [
            "*Anime Result*",
            "",
            "Title: " + (item.title || "-"),
            "Score: " + (item.score || "-"),
            "Episodes: " + (item.episodes || "-"),
            "Status: " + (item.status || "-"),
            "Year: " + (item.year || "-"),
            "",
            String(item.synopsis || "Tidak ada synopsis.").slice(0, 900),
            "",
            item.url || "-"
        ].join("\n"));
    } catch (error) {
        console.error("anime error:", error);
        await safeReply(ctx, "Gagal mengambil data anime.");
    }
}

async function mangaSearch(ctx, rawArgs) {
    const query = normalizeText(rawArgs);

    if (!query) {
        await safeReply(ctx, "Format: `!manga one piece`");
        return;
    }

    try {
        const url = "https://api.jikan.moe/v4/manga?q=" + encodeQuery(query) + "&sfw=true&limit=1";
        const data = await httpGetJson(url);
        const item = data?.data?.[0];

        if (!item) {
            await safeReply(ctx, "Manga tidak ditemukan.");
            return;
        }

        await safeReply(ctx, [
            "*Manga Result*",
            "",
            "Title: " + (item.title || "-"),
            "Score: " + (item.score || "-"),
            "Chapters: " + (item.chapters || "-"),
            "Volumes: " + (item.volumes || "-"),
            "Status: " + (item.status || "-"),
            "",
            String(item.synopsis || "Tidak ada synopsis.").slice(0, 900),
            "",
            item.url || "-"
        ].join("\n"));
    } catch (error) {
        console.error("manga error:", error);
        await safeReply(ctx, "Gagal mengambil data manga.");
    }
}

// ---------- text tools ----------

const FANCY_MAP = {
    a: "𝒶", b: "𝒷", c: "𝒸", d: "𝒹", e: "𝑒", f: "𝒻", g: "𝑔", h: "𝒽", i: "𝒾", j: "𝒿",
    k: "𝓀", l: "𝓁", m: "𝓂", n: "𝓃", o: "𝑜", p: "𝓅", q: "𝓆", r: "𝓇", s: "𝓈", t: "𝓉",
    u: "𝓊", v: "𝓋", w: "𝓌", x: "𝓍", y: "𝓎", z: "𝓏",
    A: "𝒜", B: "𝐵", C: "𝒞", D: "𝒟", E: "𝐸", F: "𝐹", G: "𝒢", H: "𝐻", I: "𝐼", J: "𝒥",
    K: "𝒦", L: "𝐿", M: "𝑀", N: "𝒩", O: "𝒪", P: "𝒫", Q: "𝒬", R: "𝑅", S: "𝒮", T: "𝒯",
    U: "𝒰", V: "𝒱", W: "𝒲", X: "𝒳", Y: "𝒴", Z: "𝒵"
};

async function requireTextArg(ctx, rawArgs, format) {
    const text = normalizeText(rawArgs);
    if (!text) {
        await safeReply(ctx, "Format: `" + format + "`");
        return "";
    }
    return text;
}

async function fancyText(ctx, rawArgs) {
    const text = await requireTextArg(ctx, rawArgs, "!fancy teks");
    if (!text) return;
    await safeReply(ctx, text.split("").map((ch) => FANCY_MAP[ch] || ch).join(""));
}

async function reverseText(ctx, rawArgs) {
    const text = await requireTextArg(ctx, rawArgs, "!reverse teks");
    if (!text) return;
    await safeReply(ctx, Array.from(text).reverse().join(""));
}

async function upperText(ctx, rawArgs) {
    const text = await requireTextArg(ctx, rawArgs, "!uppercase teks");
    if (!text) return;
    await safeReply(ctx, text.toUpperCase());
}

async function lowerText(ctx, rawArgs) {
    const text = await requireTextArg(ctx, rawArgs, "!lowercase teks");
    if (!text) return;
    await safeReply(ctx, text.toLowerCase());
}

async function mockText(ctx, rawArgs) {
    const text = await requireTextArg(ctx, rawArgs, "!mock teks");
    if (!text) return;
    await safeReply(ctx, Array.from(text).map((ch, i) => i % 2 ? ch.toUpperCase() : ch.toLowerCase()).join(""));
}

async function spaceText(ctx, rawArgs) {
    const text = await requireTextArg(ctx, rawArgs, "!space teks");
    if (!text) return;
    await safeReply(ctx, Array.from(text).join(" "));
}

async function translateText(ctx, rawArgs) {
    const parsed = parseTranslateArgs(rawArgs);

    if (!parsed) {
        await safeReply(ctx, "Format:\n`!tr en > id hello`\n`!tr auto > id hello`\n`!tr inggris > indonesia hello`");
        return;
    }

    if (parsed.source === parsed.target) {
        await safeReply(ctx, [
            "*Translate*",
            "",
            parsed.source + " > " + parsed.target,
            "Engine: same-language",
            "",
            parsed.text
        ].join("\n"));
        return;
    }

    let result = "";
    let engine = "google-free";
    let googleError = "";

    try {
        result = await translateWithGoogleFree(parsed.text, parsed.source, parsed.target);
    } catch (error) {
        googleError = error.message;
    }

    if (isBadTranslateResult(parsed.text, result, parsed.source, parsed.target)) {
        const local = localDictionaryTranslate(parsed.text, parsed.source, parsed.target);

        if (local) {
            result = local;
            engine = "local-dict-fallback";
        }
    }

    if (isBadTranslateResult(parsed.text, result, parsed.source, parsed.target)) {
        await safeReply(ctx, [
            "*Translate Failed*",
            "",
            parsed.source + " > " + parsed.target,
            "",
            "Google free gagal / return sama dengan input.",
            googleError ? "Error: " + googleError : ""
        ].filter(Boolean).join("\n"));
        return;
    }

    await safeReply(ctx, [
        "*Translate*",
        "",
        parsed.source + " > " + parsed.target,
        "Engine: " + engine,
        "",
        result
    ].join("\n"));
}

// ---------- tools (qr/tts/trivia) ----------

async function qrGenerate(ctx, rawArgs) {
    const text = normalizeText(rawArgs);

    if (!text) {
        await safeReply(ctx, "Format:\n`!qr teks/link`");
        return;
    }

    if (text.length > 500) {
        await safeReply(ctx, "Teks terlalu panjang (maks 500 karakter).");
        return;
    }

    try {
        const url = "https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=10&qzone=1&data=" + encodeQuery(text);
        const buffer = await httpGetBuffer(url);
        await sendImage(ctx, buffer, "✅ QR Code");
    } catch (error) {
        console.error("qr error:", error);
        await safeReply(ctx, "Gagal bikin QR code.");
    }
}

const TTS_LANGS = ["id", "en", "ja", "ko", "ar", "zh", "ms", "fr", "de", "es", "it", "ru", "th"];

async function ttsSay(ctx, rawArgs) {
    const parts = normalizeText(rawArgs).split(/\s+/).filter(Boolean);
    let lang = "id";
    let text = normalizeText(rawArgs);

    if (parts.length > 1 && TTS_LANGS.includes(normalizeLangCode(parts[0]))) {
        lang = normalizeLangCode(parts[0]);
        text = normalizeText(parts.slice(1).join(" "));
    }

    if (!text) {
        await safeReply(ctx, "Format:\n`!tts teks`\n`!tts en hello world`\n`!tts jepang ohayou`");
        return;
    }

    if (text.length > 200) {
        await safeReply(ctx, "Teks terlalu panjang (maks 200 karakter).");
        return;
    }

    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeQuery(text)}`;
        const buffer = await httpGetBuffer(url);

        if (!buffer || buffer.length < 1000) {
            throw new Error("TTS kosong (Google menolak request).");
        }

        await sendAudio(ctx, buffer, "audio/mpeg");
    } catch (error) {
        console.error("tts error:", error);
        await safeReply(ctx, "Gagal TTS:\n" + error.message);
    }
}

function htmlUnescape(value) {
    return String(value || "")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

async function triviaQuiz(ctx) {
    try {
        const data = await httpGetJson("https://opentdb.com/api.php?amount=1&type=multiple");
        const q = data?.results?.[0];

        if (!q) throw new Error("empty");

        const correct = htmlUnescape(q.correct_answer);
        const answers = [...(q.incorrect_answers || []), q.correct_answer]
            .map(htmlUnescape)
            .sort(() => Math.random() - 0.5);

        await safeReply(ctx, [
            "*🎯 Trivia*",
            "",
            `Kategori: ${htmlUnescape(q.category)}`,
            `Level: ${q.difficulty || "-"}`,
            "",
            htmlUnescape(q.question),
            "",
            ...answers.map((a, i) => `${i + 1}. ${a}`),
            "",
            `Jawaban: || ${correct} ||`
        ].join("\n"));
    } catch (error) {
        console.error("trivia error:", error);
        await safeReply(ctx, "Gagal ambil kuis. Coba lagi.");
    }
}

// ---------- social downloaders ----------

async function handleSocialDl(ctx, rawArgs, label, cmdName) {
    const rawUrl = await extractUrlFromMessage(ctx, rawArgs);
    const validated = validatePublicUrl(rawUrl);

    if (!validated.ok) {
        await safeReply(ctx, `Format:\n!${cmdName} <url>\n\nError: ` + validated.reason);
        return;
    }

    const url = validated.url;

    await safeReply(ctx, `⏳ Download ${label}...`);

    let outputPath = "";

    try {
        const result = await runPythonYtdl("video", url, ["--quality", "720"]);
        outputPath = result.path;

        const title = sanitizeCaptionText(result.title || label);
        const buffer = fs.readFileSync(outputPath);

        await sendVideo(ctx, buffer, `✅ ${label}\n${title}\n${Number(result.size_mb || 0).toFixed(2)} MB`);
    } catch (error) {
        console.error(`${label} dl error:`, error);
        await safeReply(ctx, `Gagal download ${label}:\n` + error.message);
    } finally {
        if (outputPath) await safeUnlinkMany([outputPath]);
    }
}

// ---------- nsfw ----------

function isNsfwBypassCommand(parsed) {
    if (!parsed || !parsed.command) return false;
    if (commandIn(parsed.command, CONFIG.commands.nsfwFilter)) return true;
    if (commandIn(parsed.command, CONFIG.commands.safeCheck)) return true;
    return false;
}

function shouldBlockByNsfwFilter(ctx, parsed) {
    if (!CONFIG.nsfwFilter || !CONFIG.nsfwFilter.enabled) return { blocked: false };
    if (isNsfwBypassCommand(parsed)) return { blocked: false };
    return checkNsfwText(ctx.body);
}

async function handleNsfwFilter(ctx, rawArgs) {
    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner.");
        return;
    }

    const args = normalizeText(rawArgs);
    const parts = args.split(/\s+/).filter(Boolean);
    const action = (parts[0] || "").toLowerCase();
    const value = (parts[1] || "").toLowerCase();

    if (!action || action === "status") {
        await safeReply(ctx, [
            "*NSFW Filter*",
            "",
            "Status: " + (CONFIG.nsfwFilter.enabled ? "ON" : "OFF"),
            "Block Links: " + (CONFIG.nsfwFilter.blockLinks ? "ON" : "OFF"),
            "Block Keywords: " + (CONFIG.nsfwFilter.blockKeywords ? "ON" : "OFF"),
            "Strict Mode: " + (CONFIG.nsfwFilter.strictMode ? "ON" : "OFF"),
            "",
            "Commands:",
            CONFIG.prefix + "nsfwfilter on",
            CONFIG.prefix + "nsfwfilter off",
            CONFIG.prefix + "nsfwfilter strict on",
            CONFIG.prefix + "nsfwfilter strict off",
            CONFIG.prefix + "nsfwfilter links on/off",
            CONFIG.prefix + "nsfwfilter keywords on/off"
        ].join("\n"));
        return;
    }

    if (action === "on") {
        CONFIG.nsfwFilter.enabled = true;
        saveBotState();
        await safeReply(ctx, "NSFW filter: ON");
        return;
    }

    if (action === "off") {
        CONFIG.nsfwFilter.enabled = false;
        saveBotState();
        await safeReply(ctx, "NSFW filter: OFF");
        return;
    }

    if (action === "strict") {
        if (value === "on") CONFIG.nsfwFilter.strictMode = true;
        else if (value === "off") CONFIG.nsfwFilter.strictMode = false;
        else {
            await safeReply(ctx, "Format: `!nsfwfilter strict on/off`");
            return;
        }

        saveBotState();
        await safeReply(ctx, "NSFW strict mode: " + (CONFIG.nsfwFilter.strictMode ? "ON" : "OFF"));
        return;
    }

    if (action === "links") {
        if (value === "on") CONFIG.nsfwFilter.blockLinks = true;
        else if (value === "off") CONFIG.nsfwFilter.blockLinks = false;
        else {
            await safeReply(ctx, "Format: `!nsfwfilter links on/off`");
            return;
        }

        saveBotState();
        await safeReply(ctx, "NSFW link blocker: " + (CONFIG.nsfwFilter.blockLinks ? "ON" : "OFF"));
        return;
    }

    if (action === "keywords") {
        if (value === "on") CONFIG.nsfwFilter.blockKeywords = true;
        else if (value === "off") CONFIG.nsfwFilter.blockKeywords = false;
        else {
            await safeReply(ctx, "Format: `!nsfwfilter keywords on/off`");
            return;
        }

        saveBotState();
        await safeReply(ctx, "NSFW keyword blocker: " + (CONFIG.nsfwFilter.blockKeywords ? "ON" : "OFF"));
        return;
    }

    await safeReply(ctx, "Format salah. Pakai `!nsfwfilter status`.");
}

async function safeCheck(ctx, rawArgs) {
    const text = normalizeText(rawArgs);

    if (!text) {
        await safeReply(ctx, "Format: `!safecheck teks/link`");
        return;
    }

    const check = checkNsfwText(text);

    await safeReply(ctx, [
        "*Safe Check*",
        "",
        "Blocked: " + (check.blocked ? "YES" : "NO"),
        "Reason: " + (check.reason || "-"),
        "Matched: " + (check.matched && check.matched.length ? check.matched.join(", ") : "-")
    ].join("\n"));
}

// ---------- debug ----------

async function debugQuote(ctx) {
    const lines = ["*DBG quote (Telegram)*", ""];
    lines.push("hasQuotedMsg: " + ctx.hasQuotedMsg);

    if (ctx.quoted) {
        lines.push("body: " + (ctx.quoted.body || "-").slice(0, 80));
        lines.push(`hasMedia=${ctx.quoted.hasMedia} mimetype=${ctx.quoted.mimetype || "-"}`);
        lines.push("sender: " + (ctx.quoted.senderId || "-"));

        try {
            const got = await ctx.quoted.buffer();
            lines.push("download: " + (got && got.buffer && got.buffer.length ? `OK ${(got.buffer.length / 1024).toFixed(1)}KB ${got.mimetype}` : "null (tak bisa diunduh)"));
        } catch (error) {
            lines.push("download throw: " + (error.message || error));
        }
    } else {
        lines.push("quoted: kosong");
    }

    await safeReply(ctx, lines.join("\n"));
}

async function debugSend(ctx) {
    const px = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const lines = ["*DBG send (Telegram)*", ""];

    const variants = [
        ["image", async () => { await sendImage(ctx, px, "t"); }],
        ["document", async () => { await sendDocument(ctx, px, "image/png", "px.png", "t"); }],
        ["audio", async () => { await sendAudio(ctx, px, "audio/mpeg", "px.mp3"); }]
    ];

    for (const [name, fn] of variants) {
        try {
            await fn();
            lines.push(name + ": OK");
        } catch (error) {
            lines.push(name + ": FAIL " + String(error.message || error).split("\n")[0].slice(0, 150));
        }
    }

    await safeReply(ctx, lines.join("\n"));
}

// ---------- AI (OpenRouter) ----------

const AI_COOLDOWN_MS = 20000;
const aiCooldowns = new Map();

function maskApiKey(key) {
    const clean = String(key || "");
    if (clean.length <= 12) return clean ? "****" : "-";
    return `${clean.slice(0, 7)}...${clean.slice(-4)}`;
}

const AI_PROVIDERS = {
    openrouter: { label: "OpenRouter", keyHint: "sk-or-..." },
    google: { label: "Google Gemini", keyHint: "AIza..." },
    openai: { label: "OpenAI (ChatGPT)", keyHint: "sk-..." }
};

function normalizeProviderName(raw) {
    const clean = normalizeText(raw).toLowerCase();
    if (["openrouter", "or", "open-router"].includes(clean)) return "openrouter";
    if (["google", "gemini", "bard"].includes(clean)) return "google";
    if (["openai", "chatgpt", "gpt", "oai"].includes(clean)) return "openai";
    return "";
}

function aiActiveKey(provider) {
    const p = provider || CONFIG.ai.provider;
    if (p === "openrouter") return CONFIG.ai.keys.openrouter || CONFIG.ai.apiKey || "";
    return (CONFIG.ai.keys && CONFIG.ai.keys[p]) || "";
}

function aiActiveModel(provider) {
    const p = provider || CONFIG.ai.provider;
    if (CONFIG.ai.models && CONFIG.ai.models[p]) return CONFIG.ai.models[p];
    if (p === "openrouter") return CONFIG.ai.model || "qwen/qwen3.8-27b:free";
    if (p === "google") return "gemini-2.0-flash";
    return "gpt-4o-mini";
}

async function manageApiKey(ctx, rawArgs) {
    const args = normalizeText(rawArgs);
    const parts = args.split(/\s+/).filter(Boolean);
    const action = (parts[0] || "").toLowerCase();

    if (!action || action === "status") {
        const rows = ["*API Keys*", ""];
        for (const [id, meta] of Object.entries(AI_PROVIDERS)) {
            const mark = id === CONFIG.ai.provider ? "▶ " : "   ";
            rows.push(`${mark}${meta.label}: ${maskApiKey(aiActiveKey(id))}`);
        }
        rows.push("", `Aktif: ${CONFIG.ai.provider} (${aiActiveModel()})`, "", "Commands (owner):");
        rows.push(`${CONFIG.prefix}apikey set openrouter sk-or-...`);
        rows.push(`${CONFIG.prefix}apikey set google AIza...`);
        rows.push(`${CONFIG.prefix}apikey set chatgpt sk-...`);
        rows.push(`${CONFIG.prefix}apikey reset [provider]`);
        await safeReply(ctx, rows.join("\n"));
        return;
    }

    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner.");
        return;
    }

    if (action === "set") {
        const provider = normalizeProviderName(parts[1]);
        const value = parts.slice(2).join(" ").trim();

        if (!provider || !value || value.length < 8) {
            await safeReply(ctx, "Format:\n`!apikey set openrouter sk-or-...`\n`!apikey set google AIza...`\n`!apikey set chatgpt sk-...`");
            return;
        }

        if (!CONFIG.ai.keys) CONFIG.ai.keys = { openrouter: "", google: "", openai: "" };
        CONFIG.ai.keys[provider] = value;
        if (provider === "openrouter") CONFIG.ai.apiKey = value;
        CONFIG.ai.provider = provider;
        saveBotState();
        await safeReply(ctx, `API key ${AI_PROVIDERS[provider].label} disimpan: ${maskApiKey(value)}\nProvider aktif: ${provider}`);
        return;
    }

    if (action === "reset" || action === "del" || action === "delete" || action === "clear") {
        const provider = normalizeProviderName(parts[1]);

        if (provider) {
            if (CONFIG.ai.keys) CONFIG.ai.keys[provider] = "";
            if (provider === "openrouter") CONFIG.ai.apiKey = "";
            saveBotState();
            await safeReply(ctx, `API key ${AI_PROVIDERS[provider].label} dihapus.`);
            return;
        }

        if (CONFIG.ai.keys) CONFIG.ai.keys = { openrouter: "", google: "", openai: "" };
        CONFIG.ai.apiKey = "";
        saveBotState();
        await safeReply(ctx, "Semua API key dihapus.");
        return;
    }

    if (action === "use" || action === "provider") {
        const provider = normalizeProviderName(parts[1]);

        if (!provider) {
            await safeReply(ctx, "Format:\n`!apikey use openrouter`\n`!apikey use google`\n`!apikey use chatgpt`");
            return;
        }

        CONFIG.ai.provider = provider;
        saveBotState();
        await safeReply(ctx, `Provider aktif: ${provider} (${aiActiveModel()})`);
        return;
    }

    await safeReply(ctx, "Format:\n`!apikey status`\n`!apikey set <provider> <key>`\n`!apikey reset [provider]`\n`!apikey use <provider>`");
}

let cachedModels = { at: 0, data: null };

async function fetchOpenRouterModels() {
    const now = Date.now();
    if (cachedModels.data && now - cachedModels.at < 10 * 60 * 1000) {
        return cachedModels.data;
    }

    const { httpGetJson } = require("./util");
    const data = await httpGetJson("https://openrouter.ai/api/v1/models");
    const list = Array.isArray(data?.data) ? data.data : [];
    cachedModels = { at: now, data: list };
    return list;
}

function formatModelPrice(model) {
    const pricing = model.pricing || {};
    const prompt = Number(pricing.prompt || 0);
    const completion = Number(pricing.completion || 0);

    if (!prompt && !completion) return "FREE";

    const fmt = (v) => (v === 0 ? "0" : `$${(v * 1e6).toFixed(v * 1e6 < 0.1 ? 3 : 2)}/M`);
    return `${fmt(prompt)} in / ${fmt(completion)} out`;
}

async function manageAiModel(ctx, rawArgs) {
    const args = normalizeText(rawArgs);
    const parts = args.split(/\s+/).filter(Boolean);
    const action = (parts[0] || "").toLowerCase();
    const value = parts.slice(1).join(" ").trim();

    if (action === "list") {
        const filter = value.toLowerCase();

        try {
            await safeReply(ctx, "⏳ Ambil daftar model...");
            const list = await fetchOpenRouterModels();

            let items = list;
            if (filter) {
                items = list.filter((m) => String(m.id || "").toLowerCase().includes(filter));
            } else {
                items = list.filter((m) => String(m.id || "").endsWith(":free"));
            }

            if (items.length === 0) {
                await safeReply(ctx, "Tidak ada model cocok filter itu.");
                return;
            }

            const shown = items.slice(0, 25);
            const lines = [
                filter ? `*AI Models (${items.length} cocok)*` : `*AI Models FREE (${items.length})*`,
                "",
                ...shown.map((m) => `\`${m.id}\`\n${formatModelPrice(m)}`),
                ...(items.length > shown.length ? ["", `... +${items.length - shown.length} lagi, persempit filter.`] : []),
                "",
                `Pakai: ${CONFIG.prefix}aimodel set <model-id>`
            ];

            await safeReply(ctx, lines.join("\n").slice(0, 3500));
        } catch (error) {
            console.error("aimodel list error:", error);
            await safeReply(ctx, "Gagal ambil daftar model:\n" + error.message);
        }

        return;
    }

    if (!action || action === "status") {
        await safeReply(ctx, [
            "*AI Model*",
            "",
            `Provider aktif: ${CONFIG.ai.provider}`,
            `Model: ${aiActiveModel()}`,
            "",
            "Per provider:",
            ...Object.keys(AI_PROVIDERS).map((p) => `- ${p}: ${aiActiveModel(p)}`),
            "",
            "Contoh gratis OpenRouter:",
            "`qwen/qwen3.8-27b:free`",
            "`google/gemma-4-26b-a4b-it:free`",
            "`nvidia/nemotron-3.5-lightning:free`",
            "",
            "Commands (owner):",
            `${CONFIG.prefix}aimodel list`,
            `${CONFIG.prefix}aimodel list llama`,
            `${CONFIG.prefix}aimodel set <model-id>`,
            `${CONFIG.prefix}aimodel set google <model-id>`,
            `${CONFIG.prefix}aimodel reset`
        ].join("\n"));
        return;
    }

    if (!canUseDangerCommand(ctx)) {
        await safeReply(ctx, "Command ini hanya untuk owner.");
        return;
    }

    if (action === "set") {
        let provider = CONFIG.ai.provider;
        let model = value;

        const maybeProvider = normalizeProviderName(parts[1]);
        if (maybeProvider && parts.length > 2) {
            provider = maybeProvider;
            model = parts.slice(2).join(" ").trim();
        }

        if (!model || model.length < 2) {
            await safeReply(ctx, "Format:\n`!aimodel set <model-id>`\n`!aimodel set google gemini-2.0-flash`");
            return;
        }

        if (!CONFIG.ai.models) CONFIG.ai.models = {};
        CONFIG.ai.models[provider] = model.slice(0, 120);
        if (provider === "openrouter") CONFIG.ai.model = CONFIG.ai.models[provider];
        saveBotState();
        await safeReply(ctx, `AI model [${provider}]: ${CONFIG.ai.models[provider]}`);
        return;
    }

    if (action === "reset") {
        const defaults = { openrouter: "qwen/qwen3.8-27b:free", google: "gemini-2.0-flash", openai: "gpt-4o-mini" };
        CONFIG.ai.models = { ...defaults };
        CONFIG.ai.model = defaults.openrouter;
        saveBotState();
        await safeReply(ctx, "AI models reset ke default.");
        return;
    }

    await safeReply(ctx, "Format:\n`!aimodel status`\n`!aimodel list [filter]`\n`!aimodel set <model-id>`\n`!aimodel reset`");
}

async function aiChat(ctx, rawArgs) {
    let text = normalizeText(rawArgs);

    if (ctx.hasQuotedMsg && ctx.quoted) {
        const quotedBody = normalizeText(ctx.quoted.body);
        if (quotedBody) {
            text = text ? `Konteks:\n${quotedBody}\n\nPertanyaan:\n${text}` : quotedBody;
        }
    }

    if (!text) {
        await safeReply(ctx, "Format:\n`!ai halo, siapa kamu?`\nBisa juga reply pesan + `!ai rangkum ini`.");
        return;
    }

    if (!aiActiveKey()) {
        await safeReply(ctx, `AI belum dikonfigurasi (provider: ${CONFIG.ai.provider}).\nOwner: \`!apikey set ${CONFIG.ai.provider} <key>\` dulu.`);
        return;
    }

    if (text.length > 2000) {
        await safeReply(ctx, "Teks terlalu panjang (maks 2000 karakter).");
        return;
    }

    // Cooldown per user: model gratis rate-limit-nya ketat.
    const now = Date.now();
    const lastAt = aiCooldowns.get(String(ctx.senderId)) || 0;
    const waitMs = AI_COOLDOWN_MS - (now - lastAt);

    if (waitMs > 0) {
        await safeReply(ctx, `Sabar, AI cooldown ${Math.ceil(waitMs / 1000)} detik lagi.`);
        return;
    }

    aiCooldowns.set(String(ctx.senderId), now);

    // Kalau pesan ada gambar (kirim/reply), sertakan ke model vision.
    // OpenRouter/OpenAI: data URL. Google: buffer jpeg (inline_data).
    let imageDataUrl = "";
    let imageJpegBuffer = null;
    try {
        const { getSourceMessage, safeDownloadMedia } = require("./tg");
        const source = await getSourceMessage(ctx);
        if (source && source.hasMedia) {
            const dl = await safeDownloadMedia(source);
            if (dl && (dl.mimetype || "").startsWith("image/")) {
                const inputBuffer = Buffer.from(dl.data, "base64");
                imageJpegBuffer = await sharp(inputBuffer).rotate().resize(768, 768, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
                imageDataUrl = `data:image/jpeg;base64,${imageJpegBuffer.toString("base64")}`;
            }
        }
    } catch (error) {
        console.error("ai image attach failed:", error.message);
    }

    await safeReply(ctx, `⏳ AI mikir... (${CONFIG.ai.provider})`);

    const provider = CONFIG.ai.provider;

    const completeOnce = async (withImage) => {
        if (provider === "google") {
            return await aiCompleteGoogle(text, withImage ? imageJpegBuffer : null);
        }
        if (provider === "openai") {
            return await aiCompleteOpenAI(text, withImage ? imageDataUrl : "");
        }
        return await aiCompleteOpenRouter(text, withImage ? imageDataUrl : "");
    };

    try {
        let answer = "";
        let lastRaw = "";
        let lastError = "";

        // Attempt 1: dengan gambar (kalau ada). Attempt 2: teks saja.
        const attempts = imageDataUrl ? [true, false] : [false, false];

        for (const withImage of attempts) {
            if (answer) break;

            try {
                answer = await completeOnce(withImage);
                lastRaw = answer.slice(0, 200);
            } catch (error) {
                lastError = error.message || String(error);

                // Model tidak support gambar -> ulang tanpa gambar, jangan vonis gagal.
                if (withImage && /image|vision|picture|media|multimodal|content|inline/i.test(lastError)) {
                    continue;
                }
                break;
            }
        }

        if (!answer) {
            throw new Error(`Respons AI kosong. Raw: ${lastRaw || lastError}`.slice(0, 500));
        }

        await safeReply(ctx, answer.slice(0, 3500));
    } catch (error) {
        const msg = String(error.message || error);

        if (/429|rate.limit|too many requests|quota|resource_exhausted/i.test(msg)) {
            console.error("ai error:", error);
            await safeReply(ctx, "⏳ AI lagi rate-limit/kuota habis. Tunggu 1-2 menit lalu coba lagi,\natau ganti provider/model via `!apikey use` / `!aimodel list`.");
            return;
        }

        if (/401|unauthorized|api key|api_key|key/i.test(msg)) {
            console.error("ai error:", error);
            await safeReply(ctx, "🔑 API key ditolak. Cek via `!apikey status`, set ulang yang benar.");
            return;
        }

        console.error("ai error:", error);
        await safeReply(ctx, "Gagal AI:\n" + msg.slice(0, 500));
    }
}

async function aiCompleteOpenRouter(text, imageDataUrl) {
    const userContent = imageDataUrl
        ? [
            { type: "text", text },
            { type: "image_url", image_url: { url: imageDataUrl } }
        ]
        : text;

    const data = await httpPostJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
            model: aiActiveModel("openrouter"),
            max_tokens: CONFIG.ai.maxTokens,
            messages: [
                { role: "system", content: CONFIG.ai.systemPrompt },
                { role: "user", content: userContent }
            ]
        },
        {
            Authorization: `Bearer ${aiActiveKey("openrouter")}`,
            "HTTP-Referer": "https://github.com/faa-telegram-bot",
            "X-Title": CONFIG.botName
        }
    );

    if (data?.error) {
        throw new Error(`OpenRouter: ${data.error.message || data.error.code || "unknown"}`);
    }

    const choice = data?.choices?.[0];
    return normalizeText(choice?.message?.content || choice?.text || "") ||
        normalizeText(choice?.message?.reasoning || "").slice(0, 3500);
}

async function aiCompleteOpenAI(text, imageDataUrl) {
    const userContent = imageDataUrl
        ? [
            { type: "text", text },
            { type: "image_url", image_url: { url: imageDataUrl } }
        ]
        : text;

    const data = await httpPostJson(
        "https://api.openai.com/v1/chat/completions",
        {
            model: aiActiveModel("openai"),
            max_tokens: CONFIG.ai.maxTokens,
            messages: [
                { role: "system", content: CONFIG.ai.systemPrompt },
                { role: "user", content: userContent }
            ]
        },
        { Authorization: `Bearer ${aiActiveKey("openai")}` }
    );

    if (data?.error) {
        throw new Error(`OpenAI: ${data.error.message || data.error.code || "unknown"}`);
    }

    const choice = data?.choices?.[0];
    return normalizeText(choice?.message?.content || choice?.text || "");
}

async function aiCompleteGoogle(text, imageBuffer) {
    const parts = [{ text }];

    if (imageBuffer && imageBuffer.length > 0) {
        parts.push({
            inline_data: {
                mime_type: "image/jpeg",
                data: imageBuffer.toString("base64")
            }
        });
    }

    const data = await httpPostJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiActiveModel("google"))}:generateContent?key=${encodeURIComponent(aiActiveKey("google"))}`,
        {
            system_instruction: { parts: [{ text: CONFIG.ai.systemPrompt }] },
            contents: [{ parts }],
            generationConfig: { maxOutputTokens: CONFIG.ai.maxTokens }
        },
        {}
    );

    if (data?.error) {
        throw new Error(`Google: ${data.error.message || data.error.code || "unknown"}`);
    }

    const texts = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("")
        .trim();

    return normalizeText(texts);
}

// ---------- info / fun (gratis, tanpa API key) ----------

const WMO_ID = {
    0: "Cerah",
    1: "Cerah berawan",
    2: "Berawan",
    3: "Mendung",
    45: "Berkabut",
    48: "Kabut tebal",
    51: "Gerimis ringan",
    53: "Gerimis",
    55: "Gerimis lebat",
    61: "Hujan ringan",
    63: "Hujan",
    65: "Hujan lebat",
    71: "Salju ringan",
    73: "Salju",
    75: "Salju lebat",
    80: "Hujan rintik",
    81: "Hujan sedang",
    82: "Hujan deras",
    95: "Badai petir",
    96: "Badai petir + hujan es",
    99: "Badai petir besar"
};

async function weatherInfo(ctx, rawArgs) {
    const city = normalizeText(rawArgs);

    if (!city) {
        await safeReply(ctx, "Format:\n`!cuaca jakarta`\n`!cuaca bandung`");
        return;
    }

    try {
        const geo = await httpGetJson("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeQuery(city) + "&count=1&language=id&format=json");
        const place = geo?.results?.[0];

        if (!place) {
            await safeReply(ctx, "Kota tidak ditemukan: " + city);
            return;
        }

        const fc = await httpGetJson(
            `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
            "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto"
        );
        const cur = fc?.current;

        if (!cur) throw new Error("empty");

        await safeReply(ctx, [
            "*🌤 Cuaca*",
            "",
            `${place.name}, ${place.country || "-"}`,
            `Kondisi: ${WMO_ID[cur.weather_code] || ("kode " + cur.weather_code)}`,
            `Suhu: ${cur.temperature_2m}°C`,
            `Lembap: ${cur.relative_humidity_2m}%`,
            `Angin: ${cur.wind_speed_10m} km/jam`
        ].join("\n"));
    } catch (error) {
        console.error("cuaca error:", error);
        await safeReply(ctx, "Gagal ambil cuaca. Coba lagi.");
    }
}

async function lyricsSearch(ctx, rawArgs) {
    const raw = normalizeText(rawArgs);
    const parts = raw.split(/\s*[|\-/–—]\s*/).filter(Boolean);

    if (parts.length < 2) {
        await safeReply(ctx, "Format:\n`!lirik coldplay - yellow`\n`!lirik coldplay / yellow`");
        return;
    }

    const artist = parts[0];
    const title = parts.slice(1).join(" ");

    try {
        const data = await httpGetJson(`https://api.lyrics.ovh/v1/${encodeQuery(artist)}/${encodeQuery(title)}`);
        const lyrics = normalizeText(data?.lyrics);

        if (!lyrics) {
            await safeReply(ctx, "Lirik tidak ditemukan.");
            return;
        }

        await safeReply(ctx, [`*🎵 ${artist} - ${title}*`, "", lyrics.slice(0, 3000)].join("\n"));
    } catch (error) {
        console.error("lirik error:", error);
        await safeReply(ctx, "Gagal ambil lirik. Coba lagi / cek penulisan artis-judul.");
    }
}

async function shortLink(ctx, rawArgs) {
    const rawUrl = normalizeText(rawArgs).split(/\s+/)[0] || "";
    const validated = validatePublicUrl(rawUrl);

    if (!validated.ok) {
        await safeReply(ctx, "Format:\n`!short https://url-panjang...`\n\nError: " + validated.reason);
        return;
    }

    try {
        const buf = await httpGetBuffer("https://tinyurl.com/api-create.php?url=" + encodeQuery(validated.url));
        const short = normalizeText(buf.toString("utf8"));

        if (!short.startsWith("http")) throw new Error("invalid response");

        await safeReply(ctx, `🔗 Shortlink:\n${short}`);
    } catch (error) {
        console.error("short error:", error);
        await safeReply(ctx, "Gagal memendekkan URL.");
    }
}

async function calcExpr(ctx, rawArgs) {
    const expr = normalizeText(rawArgs);

    if (!expr) {
        await safeReply(ctx, "Format:\n`!calc 12*8+5`\nOperator: + - * / % ( )");
        return;
    }

    if (expr.length > 60 || !/^[0-9+\-*/().\s%^]+$/.test(expr)) {
        await safeReply(ctx, "Ekspresi tidak valid. Hanya angka + operator + - * / % ( ).");
        return;
    }

    try {
        const result = Function(`"use strict"; return (${expr});`)();

        if (typeof result !== "number" || !Number.isFinite(result)) {
            throw new Error("not finite");
        }

        const pretty = Math.round(result * 1e10) / 1e10;
        await safeReply(ctx, `🧮 \`${expr}\` = *${pretty}*`);
    } catch (error) {
        await safeReply(ctx, "Gagal hitung. Cek ekspresinya.");
    }
}

async function randomQuotes(ctx) {
    try {
        const data = await httpGetJson("https://dummyjson.com/quotes/random");
        if (!data?.quote) throw new Error("empty");

        await safeReply(ctx, [`*💬 Quotes*`, "", `"${data.quote}"`, "", `— ${data.author || "anonim"}`].join("\n"));
    } catch (error) {
        console.error("quotes error:", error);
        await safeReply(ctx, "Gagal ambil quotes. Coba lagi.");
    }
}

async function randomMeme(ctx) {
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            const data = await httpGetJson("https://meme-api.com/gimme");
            if (!data?.url) continue;

            if (data.nsfw && CONFIG.nsfwFilter && CONFIG.nsfwFilter.enabled) continue;

            const buffer = await httpGetBuffer(data.url);
            await sendImage(ctx, buffer, `✅ ${data.title || "Meme"}`);
            return;
        }

        await safeReply(ctx, "Meme yang keluar NSFW semua, coba lagi.");
    } catch (error) {
        console.error("rmeme error:", error);
        await safeReply(ctx, "Gagal ambil meme. Coba lagi.");
    }
}

// ---------- dispatch ----------

async function executeParsedCommand(ctx, parsed) {
    if (commandIn(parsed.command, CONFIG.commands.menu)) return await showMenu(ctx, "main");
    if (commandIn(parsed.command, CONFIG.commands.menuCommand)) return await showMenu(ctx, "command");
    if (commandIn(parsed.command, CONFIG.commands.nsfwFilter)) return await handleNsfwFilter(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.safeCheck)) return await safeCheck(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.debugQuote)) {
        if (parsed.command === "dbgsend") return await debugSend(ctx);
        return await debugQuote(ctx);
    }

    if (commandIn(parsed.command, CONFIG.commands.helpCommand)) {
        const target = normalizeText(parsed.args[0]);
        if (!target) return await safeReply(ctx, "Format:\n!usage <command>\nContoh: !usage resize");
        return await safeReply(ctx, getCommandUsage(target));
    }

    if (commandIn(parsed.command, CONFIG.commands.ping)) return await sendPing(ctx);
    if (commandIn(parsed.command, CONFIG.commands.id)) return await sendChatId(ctx);
    if (commandIn(parsed.command, CONFIG.commands.sticker)) return await makeSticker(ctx, { mode: "normal" }, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.stickerNoBgSimple)) return await makeSticker(ctx, { mode: "white" }, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.stickerNoBgAI)) return await makeSticker(ctx, { mode: "ai" }, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.removeBgImage)) return await removeBgAsImage(ctx);
    if (commandIn(parsed.command, CONFIG.commands.stickerMeme)) return await makeMemeSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.bratSticker)) return await bratSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.bratVideo)) return await bratVideoSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.quoteSticker)) return await makeQuoteSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.emojiSticker)) return await makeEmojiSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.emojiToImage)) return await makeEmojiImage(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.resize)) return await resizeMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.crop)) return await cropMedia(ctx);
    if (commandIn(parsed.command, CONFIG.commands.watermark)) return await watermarkMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.stext)) return await textSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.ttp)) return await textToPng(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.circle)) return await circleMedia(ctx);
    if (commandIn(parsed.command, CONFIG.commands.rotate)) return await rotateMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.flip)) return await flipMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.compress)) return await compressMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.border)) return await borderMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.round)) return await roundMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.background)) return await backgroundMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.caption)) return await captionMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.pixel)) return await pixelMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.imageInfo)) return await imageInfoMedia(ctx);
    if (commandIn(parsed.command, CONFIG.commands.quoteModern)) return await makeModernQuoteSticker(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.restart)) return await restartBot(ctx);

    if (commandIn(parsed.command, CONFIG.commands.status)) return await sendStatus(ctx);
    if (commandIn(parsed.command, CONFIG.commands.clean)) return await cleanBotFiles(ctx);
    if (commandIn(parsed.command, CONFIG.commands.prefix)) return await changePrefix(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.setWatermark)) return await setWatermarkConfig(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.ownerManage)) return await manageOwner(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.stickerPack)) return await setStickerPack(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.blur)) return await blurMedia(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.profilePicture)) return await sendProfilePicture(ctx);

    if (commandIn(parsed.command, CONFIG.commands.menuGames)) return await showMenu(ctx, "games");
    if (commandIn(parsed.command, CONFIG.commands.menuGroup)) return await showMenu(ctx, "group");
    if (commandIn(parsed.command, CONFIG.commands.menuGoogle)) return await sendMenuGoogle(ctx);
    if (commandIn(parsed.command, CONFIG.commands.menuAnime)) return await showMenu(ctx, "anime");
    if (commandIn(parsed.command, CONFIG.commands.menuSearch)) return await showMenu(ctx, "search");
    if (commandIn(parsed.command, CONFIG.commands.menuTextMaker)) return await showMenu(ctx, "textmaker");
    if (commandIn(parsed.command, CONFIG.commands.menuTranslate)) return await showMenu(ctx, "translate");
    if (commandIn(parsed.command, CONFIG.commands.menuSticker)) return await showMenu(ctx, "sticker");

    if (commandIn(parsed.command, CONFIG.commands.coin)) return await coinFlip(ctx);
    if (commandIn(parsed.command, CONFIG.commands.dice)) return await diceRoll(ctx);
    if (commandIn(parsed.command, CONFIG.commands.suit)) return await suitGame(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.mathGame)) return await mathGame(ctx);
    if (commandIn(parsed.command, CONFIG.commands.slot)) return await slotGame(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.tebakAngka)) return await tebakAngkaGame(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.gameHelp)) return await gameHelp(ctx);

    if (commandIn(parsed.command, CONFIG.commands.groupInfo)) return await groupInfo(ctx);
    if (commandIn(parsed.command, CONFIG.commands.tagAll)) return await tagAll(ctx);
    if (commandIn(parsed.command, CONFIG.commands.hideTag)) return await hideTag(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.kick)) return await kickUser(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.promote)) return await promoteUser(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.demote)) return await demoteUser(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.muteGroup)) return await muteGroup(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.leaveGroup)) return await leaveGroup(ctx);
    if (commandIn(parsed.command, CONFIG.commands.broadcast)) return await broadcastMessage(ctx, parsed.rawArgs);

    if (commandIn(parsed.command, CONFIG.commands.googleSearch)) return await googleSearch(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.wikiSearch)) return await wikiSearch(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.animeSearch)) return await animeSearch(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.mangaSearch)) return await mangaSearch(ctx, parsed.rawArgs);

    if (commandIn(parsed.command, CONFIG.commands.fancyText)) return await fancyText(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.reverseText)) return await reverseText(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.upperText)) return await upperText(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.lowerText)) return await lowerText(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.mockText)) return await mockText(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.spaceText)) return await spaceText(ctx, parsed.rawArgs);

    if (commandIn(parsed.command, CONFIG.commands.translate)) return await translateText(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.aiChat)) return await aiChat(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.apiKey)) return await manageApiKey(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.aiModel)) return await manageAiModel(ctx, parsed.rawArgs);

    if (commandIn(parsed.command, CONFIG.commands.ytdlInfo)) return await handleYtdlInfo(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.yta)) return await handleYtdlAudio(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.ytv)) return await handleYtdlVideo(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.tiktokDl)) return await handleSocialDl(ctx, parsed.rawArgs, "TikTok", "tiktok");
    if (commandIn(parsed.command, CONFIG.commands.igDl)) return await handleSocialDl(ctx, parsed.rawArgs, "Instagram", "igdl");
    if (commandIn(parsed.command, CONFIG.commands.fbDl)) return await handleSocialDl(ctx, parsed.rawArgs, "Facebook", "fbdl");
    if (commandIn(parsed.command, CONFIG.commands.qrGen)) return await qrGenerate(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.tts)) return await ttsSay(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.trivia)) return await triviaQuiz(ctx);
    if (commandIn(parsed.command, CONFIG.commands.weather)) return await weatherInfo(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.lyrics)) return await lyricsSearch(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.shortlink)) return await shortLink(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.calc)) return await calcExpr(ctx, parsed.rawArgs);
    if (commandIn(parsed.command, CONFIG.commands.quotes)) return await randomQuotes(ctx);
    if (commandIn(parsed.command, CONFIG.commands.randomMeme)) return await randomMeme(ctx);
    if (commandIn(parsed.command, CONFIG.commands.toImage)) return await stickerToImage(ctx);
}

async function handleCommand(ctx, sourceLabel) {
    const { parseCommand } = require("./util");
    const { logMessage } = require("./tg");
    const parsed = parseCommand(ctx.body);
    if (!parsed.isCommand) return;

    logMessage(sourceLabel, ctx, parsed.command);

    if (!isOwner(ctx)) {
        await safeReply(ctx, "Bot ini owner-only.");
        return;
    }

    const { checkNsfwText } = require("./util");
    if (!isNsfwBypassCommand(parsed)) {
        const check = checkNsfwText(ctx.body);
        if (check.blocked) {
            await safeReply(ctx, `⛔ Diblokir NSFW filter (${check.reason}).`);
            return;
        }
    }

    if (!isKnownCommand(parsed.command)) {
        const suggestion = suggestCommand(parsed.command);
        let text = "Command tidak dikenal: " + CONFIG.prefix + parsed.command + "\nGunakan " + CONFIG.prefix + "menu.";
        if (suggestion) text += `\nMungkin maksudmu: ${CONFIG.prefix}${suggestion}`;
        await safeReply(ctx, text);
        return;
    }

    try {
        await sendPresence(ctx, "composing");
    } catch (_) {}

    try {
        await runWithUserJobLock(ctx, async () => {
            try {
                await executeParsedCommand(ctx, parsed);
            } catch (error) {
                console.error("[command] ERROR:", parsed.command, error);
                await safeReply(ctx, `❌ Error saat menjalankan ${CONFIG.prefix}${parsed.command}: ${error.message || error}`);
            }
        });
    } finally {
        try {
            await sendPresence(ctx, "paused");
        } catch (_) {}
    }
}

async function handleMenuCallback(chatId, messageId, key) {
    const texts = menuTexts();

    if (!texts[key]) return;

    const { formatReplyText } = require("./tg");
    const text = formatReplyText(texts[key]);

    try {
        await getBot().editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "Markdown",
            reply_markup: menuKeyboard()
        });
    } catch (error) {
        if (/parse|markdown|entities/i.test(error.message || "")) {
            try {
                await getBot().editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: menuKeyboard()
                });
            } catch (_) {}
            return;
        }

        if (/message is not modified/i.test(error.message || "")) return;

        console.error("menu callback error:", error.message);
    }
}

module.exports = {
    executeParsedCommand,
    handleCommand,
    handleMenuCallback,
    menuTexts,
    menuKeyboard,
    showMenu,
    debugQuote,
    debugSend
};
