const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sharp = require("sharp");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const { CONFIG, TEMP_DIR, PYTHON_SCRIPT } = require("./state");
const {
    normalizeText,
    escapeXml,
    parseNumber,
    parseColor,
    hexToRgba,
    normalizeTextStyleColor,
    httpGetBuffer,
    safeUnlink
} = require("./util");

function legacyMedia(buffer, mimetype, filename) {
    return { data: buffer.toString("base64"), mimetype, filename };
}

function splitTextIntoLines(text, maxCharsPerLine, maxLines) {
    const words = normalizeText(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    for (const word of words) {
        const test = current ? `${current} ${word}` : word;

        if (test.length <= maxCharsPerLine) {
            current = test;
        } else {
            if (current) lines.push(current);
            current = word;
        }

        if (lines.length >= maxLines) break;
    }

    if (current && lines.length < maxLines) lines.push(current);

    return lines.length ? lines : [""];
}

function createWatermarkSvg() {
    if (!CONFIG.visualWatermark.enabled) return null;

    const text = escapeXml(CONFIG.visualWatermark.text);
    const opacity = CONFIG.visualWatermark.opacity;

    return Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <text x="486" y="488"
                text-anchor="end"
                font-family="Arial, sans-serif"
                font-size="22"
                font-weight="700"
                fill="white"
                fill-opacity="${opacity}"
                stroke="black"
                stroke-opacity="${opacity}"
                stroke-width="3"
                paint-order="stroke">${text}</text>
        </svg>
    `);
}

async function imageToStickerCanvas(media, withWatermark = false) {
    const inputBuffer = Buffer.from(media.data, "base64");
    const overlays = [];

    if (withWatermark) {
        const watermark = createWatermarkSvg();
        if (watermark) overlays.push({ input: watermark, top: 0, left: 0 });
    }

    let img = sharp(inputBuffer)
        .rotate()
        .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png();

    if (overlays.length > 0) img = img.composite(overlays);

    const outputBuffer = await img.toBuffer();

    return legacyMedia(outputBuffer, "image/png", "sticker.png");
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

function sampleEdgeColor(data, width, height) {
    // Rata-rata warna sudut (area 5x5) sebagai kandidat background.
    const corners = [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1]
    ];

    const samples = corners.map(([cx, cy]) => {
        let r = 0, g = 0, b = 0, n = 0;

        for (let y = Math.max(0, cy - 2); y <= Math.min(height - 1, cy + 2); y++) {
            for (let x = Math.max(0, cx - 2); x <= Math.min(width - 1, cx + 2); x++) {
                const i = (y * width + x) * 4;
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                n++;
            }
        }

        return [r / n, g / n, b / n];
    });

    // Median per channel (tahan outlier).
    const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

    const bg = [
        median(samples.map((s) => s[0])),
        median(samples.map((s) => s[1])),
        median(samples.map((s) => s[2]))
    ];

    // Kalau sudut-sudut beda jauh = background tidak solid -> tolak.
    const spread = Math.max(...samples.map((s) => colorDistance(s[0], s[1], s[2], bg[0], bg[1], bg[2])));

    return { bg, spread };
}

async function removeWhiteBackground(media) {
    const inputBuffer = Buffer.from(media.data, "base64");

    // Proses SELALU di grid 512 (upscale dulu kalau input kecil) supaya tidak
    // ada resize setelah cut yang menumbuhkan fringe baru (halo resampling).
    const { data, info } = await sharp(inputBuffer)
        .rotate()
        .ensureAlpha()
        .resize(512, 512, { fit: "inside" })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const TOLERANCE = 48;
    const EDGE_SPREAD_MAX = 60;

    const { bg, spread } = sampleEdgeColor(data, width, height);

    // Background harus solid (semua sudut mirip). Kalau tidak, kembalikan
    // rasio 0 agar caller menyarankan !aibg.
    if (spread > EDGE_SPREAD_MAX) {
        const outputBuffer = await sharp(data, {
            raw: { width, height, channels: 4 }
        })
            .resize(512, 512, {
                fit: "contain",
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer();

        const result = legacyMedia(outputBuffer, "image/png", "sticker-nobg.png");
        result.removedRatio = 0;
        result.bgDetected = false;
        return result;
    }

    const isBg = (x, y) => {
        const i = (y * width + x) * 4;
        return colorDistance(data[i], data[i + 1], data[i + 2], bg[0], bg[1], bg[2]) <= TOLERANCE;
    };

    // Flood-fill dari semua piksel tepi: hanya warna background yang
    // TERHUBUNG ke tepi yang dibuat transparan. Outline/detail di dalam
    // subjek (meski putih) tidak tersentuh.
    const visited = new Uint8Array(width * height);
    const stack = [];

    for (let x = 0; x < width; x++) {
        if (isBg(x, 0)) { visited[x] = 1; stack.push([x, 0]); }
        if (isBg(x, height - 1)) { visited[(height - 1) * width + x] = 1; stack.push([x, height - 1]); }
    }
    for (let y = 0; y < height; y++) {
        if (isBg(0, y)) { visited[y * width] = 1; stack.push([0, y]); }
        if (isBg(width - 1, y)) { visited[y * width + width - 1] = 1; stack.push([width - 1, y]); }
    }

    while (stack.length > 0) {
        const [x, y] = stack.pop();
        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];

        for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

            const idx = ny * width + nx;

            if (!visited[idx] && isBg(nx, ny)) {
                visited[idx] = 1;
                stack.push([nx, ny]);
            }
        }
    }

    let removed = 0;
    for (let i = 0; i < visited.length; i++) {
        if (visited[i]) {
            data[i * 4 + 3] = 0;
            removed++;
        }
    }

    // Pass pembersih fringe ber-CASCADE (maks 8 iterasi): halo JPEG bisa
    // berlapis-lapis. Setiap iterasi hanya memakan piksel yang NEMPEL ke area
    // terhapus DAN (jarak dekat ATAU channel dominan sama dengan background).
    // Berhenti otomatis di warna subjek: putih (tanpa dominan), biru/hitam
    // (jarak jauh + dominan beda), kulit (R tidak cukup dominan).
    const LOOSE_TOLERANCE = TOLERANCE * 2.5;
    const dom = [0, 1, 2].find((c) => bg[c] > 100 && bg[(c + 1) % 3] + 60 <= bg[c] && bg[(c + 2) % 3] + 60 <= bg[c]);

    const fringeQualifies = (idx) => {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const touchesRemoved =
            (x + 1 < width && visited[y * width + x + 1] === 1) ||
            (x - 1 >= 0 && visited[y * width + x - 1] === 1) ||
            (y + 1 < height && visited[(y + 1) * width + x] === 1) ||
            (y - 1 >= 0 && visited[(y - 1) * width + x] === 1);
        if (!touchesRemoved) return false;

        const i = idx * 4;
        const px = [data[i], data[i + 1], data[i + 2]];

        if (colorDistance(px[0], px[1], px[2], bg[0], bg[1], bg[2]) <= LOOSE_TOLERANCE) return true;

        return dom !== undefined &&
            px[dom] > 100 &&
            px[(dom + 1) % 3] + 60 <= px[dom] &&
            px[(dom + 2) % 3] + 60 <= px[dom];
    };

    for (let iter = 0; iter < 8; iter++) {
        const fringe = [];

        for (let idx = 0; idx < visited.length; idx++) {
            if (!visited[idx] && fringeQualifies(idx)) {
                fringe.push(idx);
            }
        }

        if (fringe.length === 0) break;

        for (const idx of fringe) {
            visited[idx] = 1;
            data[idx * 4 + 3] = 0;
            removed++;
        }
    }

    const removedRatio = visited.length ? removed / visited.length : 0;

    const watermark = createWatermarkSvg();

    const outputBuffer = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: 4 }
    })
        .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .composite(watermark ? [{ input: watermark, top: 0, left: 0 }] : [])
        .png()
        .toBuffer();

    const result = legacyMedia(outputBuffer, "image/png", "sticker-nobg.png");
    result.removedRatio = removedRatio;
    return result;
}

async function writeTempMediaFile(media, prefix = "input") {
    const { mimeToExtension } = require("./util");
    const ext = mimeToExtension(media.mimetype);
    const fileName = `${prefix}-${randomUUID()}${ext}`;
    const filePath = path.join(TEMP_DIR, fileName);
    const buffer = Buffer.from(media.data, "base64");

    await fsp.writeFile(filePath, buffer);
    return filePath;
}

async function runPythonRemoveBg(inputPath, outputPath) {
    const candidates = [
        process.env.PYTHON_BIN ? { cmd: process.env.PYTHON_BIN, args: [PYTHON_SCRIPT, inputPath, outputPath] } : null,
        { cmd: "py", args: ["-3", PYTHON_SCRIPT, inputPath, outputPath] },
        { cmd: "python", args: [PYTHON_SCRIPT, inputPath, outputPath] },
        { cmd: "python3", args: [PYTHON_SCRIPT, inputPath, outputPath] }
    ].filter(Boolean);

    const errors = [];

    for (const candidate of candidates) {
        try {
            await new Promise((resolve, reject) => {
                const child = spawn(candidate.cmd, candidate.args, {
                    cwd: path.join(__dirname, ".."),
                    windowsHide: true,
                    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
                });

                let stderr = "";

                child.stdout.on("data", (data) => {
                    process.stdout.write(`[remove-bg.py] ${data}`);
                });

                child.stderr.on("data", (data) => {
                    const chunk = data.toString();
                    stderr += chunk;
                    process.stderr.write(`[remove-bg.py] ${chunk}`);
                });

                child.on("error", reject);

                child.on("close", (code) => {
                    if (code === 0 && fs.existsSync(outputPath)) {
                        resolve();
                        return;
                    }

                    reject(new Error(`exit code ${code}. ${stderr.trim() || "Output file not created."}`));
                });
            });

            return;
        } catch (error) {
            errors.push(`${candidate.cmd}: ${error.message}`);
        }
    }

    throw new Error("Gagal menjalankan Python AI background remover.\n" + errors.join("\n"));
}

async function removeBackgroundAI(media) {
    const inputPath = await writeTempMediaFile(media, "aibg-input");
    const outputPath = path.join(TEMP_DIR, `aibg-output-${randomUUID()}.png`);

    try {
        await runPythonRemoveBg(inputPath, outputPath);

        const watermark = createWatermarkSvg();

        const outputBuffer = await sharp(outputPath)
            .resize(512, 512, {
                fit: "contain",
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .composite(watermark ? [{ input: watermark, top: 0, left: 0 }] : [])
            .png()
            .toBuffer();

        return legacyMedia(outputBuffer, "image/png", "sticker-aibg.png");
    } finally {
        await safeUnlink(inputPath);
        await safeUnlink(outputPath);
    }
}

async function removeBackgroundAIAsImage(media) {
    const inputPath = await writeTempMediaFile(media, "rmbg-input");
    const outputPath = path.join(TEMP_DIR, `rmbg-output-${randomUUID()}.png`);

    try {
        await runPythonRemoveBg(inputPath, outputPath);

        const outputBuffer = await sharp(outputPath).png().toBuffer();

        return legacyMedia(outputBuffer, "image/png", "removed-bg.png");
    } finally {
        await safeUnlink(inputPath);
        await safeUnlink(outputPath);
    }
}

function createMemeTextSvg(topText, bottomText) {
    const topLines = splitTextIntoLines(topText, 18, 3);
    const bottomLines = splitTextIntoLines(bottomText, 18, 3);

    const createLines = (lines, startY, direction) => {
        return lines
            .map((line, index) => {
                const y = direction === "down"
                    ? startY + index * 46
                    : startY - (lines.length - 1 - index) * 46;

                return `
                    <text x="256" y="${y}"
                        text-anchor="middle"
                        font-family="Impact, Arial Black, Arial, sans-serif"
                        font-size="42"
                        font-weight="900"
                        fill="white"
                        stroke="black"
                        stroke-width="7"
                        paint-order="stroke"
                        letter-spacing="1">${escapeXml(line.toUpperCase())}</text>
                `;
            })
            .join("");
    };

    return Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            ${createLines(topLines, 58, "down")}
            ${createLines(bottomLines, 468, "up")}
        </svg>
    `);
}

async function createMemeSticker(media, topText, bottomText) {
    const inputBuffer = Buffer.from(media.data, "base64");
    const memeSvg = createMemeTextSvg(topText, bottomText);
    const watermark = createWatermarkSvg();

    const overlays = [{ input: memeSvg, top: 0, left: 0 }];
    if (watermark) overlays.push({ input: watermark, top: 0, left: 0 });

    const outputBuffer = await sharp(inputBuffer)
        .rotate()
        .resize(512, 512, { fit: "cover", position: "center" })
        .composite(overlays)
        .png()
        .toBuffer();

    return legacyMedia(outputBuffer, "image/png", "smeme.png");
}

function parseQuoteOptions(rawText) {
    let text = normalizeText(rawText);

    const options = {
        bold: false,
        italic: false,
        font: "sans",
        align: "left",
        size: "normal",
        canvasWidth: null,
        canvasHeight: null,
        fill: "#111111",
        stroke: "transparent",
        strokeWidth: 0,
        background: "white"
    };

    const sizeMatch = text.match(/^(\d{2,4})x(\d{2,4})\s+/i);

    if (sizeMatch) {
        options.canvasWidth = Math.min(Math.max(parseNumber(sizeMatch[1], 512), 64), 2048);
        options.canvasHeight = Math.min(Math.max(parseNumber(sizeMatch[2], 512), 64), 2048);
        text = text.slice(sizeMatch[0].length).trim();
    }

    const flagMap = [
        ["--bold", "bold"],
        ["-b", "bold"],
        ["--italic", "italic"],
        ["--miring", "italic"],
        ["-i", "italic"],
        ["--big", "big"],
        ["--besar", "big"],
        ["--small", "small"],
        ["--kecil", "small"],
        ["--center", "center"],
        ["--middle", "center"],
        ["--left", "left"],
        ["--right", "right"],
        ["--kanan", "right"],
        ["--kiri", "left"],
        ["--tengah", "center"],
        ["--serif", "serif"],
        ["--mono", "mono"],
        ["--sans", "sans"]
    ];

    const valueFlags = [
        ["--bg", "background"],
        ["--background", "background"],
        ["--color", "fill"],
        ["--fill", "fill"],
        ["--stroke", "stroke"],
        ["--outline", "stroke"],
        ["--sw", "strokeWidth"],
        ["--stroke-width", "strokeWidth"],
        ["--font", "font"]
    ];

    let changed = true;

    while (changed) {
        changed = false;

        if (text.toLowerCase().startsWith("-bi ")) {
            options.bold = true;
            options.italic = true;
            text = text.slice(3).trim();
            changed = true;
            continue;
        }

        for (const [flag, key] of valueFlags) {
            const lower = text.toLowerCase();

            if (lower.startsWith(flag + " ")) {
                const rest = text.slice(flag.length).trim();
                const parts = rest.split(/\s+/);
                const value = parts.shift() || "";

                if (key === "background") options.background = normalizeTextStyleColor(value, "white");
                if (key === "fill") options.fill = normalizeTextStyleColor(value, "#111111");
                if (key === "stroke") options.stroke = normalizeTextStyleColor(value, "transparent");

                if (key === "strokeWidth") {
                    const width = Number.parseFloat(value);
                    if (Number.isFinite(width)) options.strokeWidth = Math.min(Math.max(width, 0), 40);
                }

                if (key === "font") {
                    const font = value.toLowerCase();
                    if (["sans", "serif", "mono"].includes(font)) options.font = font;
                }

                text = parts.join(" ").trim();
                changed = true;
                break;
            }
        }

        if (changed) continue;

        for (const [flag, key] of flagMap) {
            if (text.toLowerCase().startsWith(flag + " ")) {
                if (key === "bold") options.bold = true;
                if (key === "italic") options.italic = true;
                if (key === "big") options.size = "big";
                if (key === "small") options.size = "small";
                if (key === "center") options.align = "center";
                if (key === "left") options.align = "left";
                if (key === "right") options.align = "right";
                if (key === "serif") options.font = "serif";
                if (key === "mono") options.font = "mono";
                if (key === "sans") options.font = "sans";

                text = text.slice(flag.length).trim();
                changed = true;
                break;
            }
        }
    }

    return { text, options };
}

function parseLineAlign(rawLine, defaultAlign = "center") {
    let line = normalizeText(rawLine);
    let align = defaultAlign;

    const patterns = [
        [/^(--left|--kiri|-l)\s+/i, "left"],
        [/^(--center|--middle|--tengah|-c)\s+/i, "center"],
        [/^(--right|--kanan|-r)\s+/i, "right"],
        [/^(L|LEFT|KIRI)\s*:?\s+/i, "left"],
        [/^(C|CENTER|MIDDLE|TENGAH)\s*:?\s+/i, "center"],
        [/^(R|RIGHT|KANAN)\s*:?\s+/i, "right"]
    ];

    let changed = true;

    while (changed) {
        changed = false;

        for (const [regex, value] of patterns) {
            const match = line.match(regex);

            if (match) {
                align = value;
                line = line.slice(match[0].length).trim();
                changed = true;
                break;
            }
        }
    }

    return { text: line, align };
}

function splitStyledTextLines(text, defaultAlign = "center") {
    const raw = normalizeText(text);

    if (!raw) return [{ text: "Text", align: defaultAlign }];

    if (raw.includes("|")) {
        return raw
            .split("|")
            .map((line) => parseLineAlign(line, defaultAlign))
            .filter((item) => item.text)
            .slice(0, 10);
    }

    return splitTextIntoLines(raw, 14, 10).map((line) => ({
        text: line,
        align: defaultAlign
    }));
}

function estimateTextWidth(text, fontSize, fontFamilyType) {
    const ratio =
        fontFamilyType === "mono" ? 0.62 :
        fontFamilyType === "serif" ? 0.56 :
        0.58;

    return String(text || "").length * fontSize * ratio;
}

function createQuoteSvgWithOptions(quoteText, options) {
    const text = normalizeText(quoteText) || "Quote";

    const lines = splitStyledTextLines(text, options.align);

    const fontFamily =
        options.font === "serif"
            ? "Georgia, Times New Roman, serif"
            : options.font === "mono"
                ? "Consolas, Courier New, monospace"
                : "Arial, Helvetica, sans-serif";

    const canvasWidth = options.canvasWidth || 512;
    const canvasHeight = options.canvasHeight || 512;
    const fixedCanvas = Boolean(options.canvasWidth && options.canvasHeight);

    const paddingX = fixedCanvas ? Math.max(6, Math.round(canvasWidth * 0.10)) : 34;
    const paddingY = fixedCanvas ? Math.max(6, Math.round(canvasHeight * 0.10)) : 48;

    let fontSize =
        options.size === "big" ? (fixedCanvas ? Math.round(canvasHeight * 0.34) : 78) :
        options.size === "small" ? (fixedCanvas ? Math.round(canvasHeight * 0.20) : 46) :
        (fixedCanvas ? Math.round(canvasHeight * 0.26) : 64);

    const minFontSize = fixedCanvas ? 6 : 24;
    const fontWeight = options.bold ? "900" : "700";
    const fontStyle = options.italic ? "italic" : "normal";

    while (fontSize > minFontSize) {
        const longestWidth = Math.max(
            ...lines.map((line) => estimateTextWidth(line.text, fontSize, options.font)),
            1
        );

        const lineGap = Math.round(fontSize * 1.15);
        const contentWidth = longestWidth + paddingX * 2;
        const contentHeight = lines.length * lineGap + paddingY * 2;

        if (contentWidth <= canvasWidth && contentHeight <= canvasHeight) break;

        fontSize -= fixedCanvas ? 1 : 2;
    }

    const lineGap = Math.round(fontSize * 1.15);
    const totalTextHeight = lines.length * lineGap;
    const startY = canvasHeight / 2 - totalTextHeight / 2 + fontSize * 0.82;

    const fill = options.fill ?? "#111111";
    const stroke = options.stroke ?? "transparent";
    const strokeWidth = options.strokeWidth ?? 0;
    const background = options.background ?? "white";

    const lineSvg = lines.map((line, index) => {
        const y = startY + index * lineGap;

        let textAnchor = "middle";
        let x = canvasWidth / 2;

        if (line.align === "left") {
            textAnchor = "start";
            x = paddingX;
        }

        if (line.align === "right") {
            textAnchor = "end";
            x = canvasWidth - paddingX;
        }

        return [
            '<text x="' + x + '" y="' + y + '"',
            ' text-anchor="' + textAnchor + '"',
            ' font-family="' + fontFamily + '"',
            ' font-size="' + fontSize + '"',
            ' font-weight="' + fontWeight + '"',
            ' font-style="' + fontStyle + '"',
            ' fill="' + fill + '"',
            ' stroke="' + stroke + '"',
            ' stroke-width="' + strokeWidth + '"',
            ' paint-order="stroke">',
            escapeXml(line.text),
            "</text>"
        ].join("");
    }).join("");

    return Buffer.from([
        '<svg width="' + canvasWidth + '" height="' + canvasHeight + '" viewBox="0 0 ' + canvasWidth + " " + canvasHeight + '" xmlns="http://www.w3.org/2000/svg">',
        '<rect width="' + canvasWidth + '" height="' + canvasHeight + '" fill="' + background + '"/>',
        lineSvg,
        "</svg>"
    ].join(""));
}

function parseTextOptions(rawText) {
    let text = normalizeText(rawText);

    const options = {
        bold: false,
        italic: false,
        font: "sans",
        align: "center",
        size: "normal",
        canvasWidth: null,
        canvasHeight: null,
        fill: "white",
        stroke: "black",
        strokeWidth: null,
        background: "transparent"
    };

    const sizeMatch = text.match(/^(\d{2,4})x(\d{2,4})\s+/i);

    if (sizeMatch) {
        options.canvasWidth = Math.min(Math.max(parseNumber(sizeMatch[1], 512), 64), 2048);
        options.canvasHeight = Math.min(Math.max(parseNumber(sizeMatch[2], 512), 64), 2048);
        text = text.slice(sizeMatch[0].length).trim();
    }

    const flagMap = [
        ["--bold", "bold"],
        ["-b", "bold"],
        ["--italic", "italic"],
        ["--miring", "italic"],
        ["-i", "italic"],
        ["--big", "big"],
        ["--besar", "big"],
        ["--small", "small"],
        ["--kecil", "small"],
        ["--center", "center"],
        ["--middle", "center"],
        ["--left", "left"],
        ["--right", "right"],
        ["--kanan", "right"],
        ["--kiri", "left"],
        ["--tengah", "center"],
        ["--serif", "serif"],
        ["--mono", "mono"],
        ["--sans", "sans"]
    ];

    const valueFlags = [
        ["--bg", "background"],
        ["--background", "background"],
        ["--color", "fill"],
        ["--fill", "fill"],
        ["--stroke", "stroke"],
        ["--outline", "stroke"],
        ["--sw", "strokeWidth"],
        ["--stroke-width", "strokeWidth"],
        ["--font", "font"]
    ];

    let changed = true;

    while (changed) {
        changed = false;

        if (text.toLowerCase().startsWith("-bi ")) {
            options.bold = true;
            options.italic = true;
            text = text.slice(3).trim();
            changed = true;
            continue;
        }

        for (const [flag, key] of valueFlags) {
            const lower = text.toLowerCase();

            if (lower.startsWith(flag + " ")) {
                const rest = text.slice(flag.length).trim();
                const parts = rest.split(/\s+/);
                const value = parts.shift() || "";

                if (key === "background") options.background = normalizeTextStyleColor(value, "transparent");
                if (key === "fill") options.fill = normalizeTextStyleColor(value, "white");
                if (key === "stroke") options.stroke = normalizeTextStyleColor(value, "black");

                if (key === "strokeWidth") {
                    const width = Number.parseFloat(value);
                    if (Number.isFinite(width)) options.strokeWidth = Math.min(Math.max(width, 0), 40);
                }

                if (key === "font") {
                    const font = value.toLowerCase();
                    if (["sans", "serif", "mono"].includes(font)) options.font = font;
                }

                text = parts.join(" ").trim();
                changed = true;
                break;
            }
        }

        if (changed) continue;

        for (const [flag, key] of flagMap) {
            if (text.toLowerCase().startsWith(flag + " ")) {
                if (key === "bold") options.bold = true;
                if (key === "italic") options.italic = true;
                if (key === "big") options.size = "big";
                if (key === "small") options.size = "small";
                if (key === "center") options.align = "center";
                if (key === "left") options.align = "left";
                if (key === "right") options.align = "right";
                if (key === "serif") options.font = "serif";
                if (key === "mono") options.font = "mono";
                if (key === "sans") options.font = "sans";

                text = text.slice(flag.length).trim();
                changed = true;
                break;
            }
        }
    }

    return { text, options };
}

function createTextSvg(rawText, userOptions = {}) {
    const parsed = parseTextOptions(rawText);
    const text = normalizeText(parsed.text) || "Text";

    const options = {
        ...parsed.options,
        ...userOptions
    };

    const lines = splitStyledTextLines(text, options.align);

    const fontFamily =
        options.font === "serif"
            ? "Georgia, Times New Roman, serif"
            : options.font === "mono"
                ? "Consolas, Courier New, monospace"
                : "Arial, Helvetica, sans-serif";

    const fixedWidth = options.canvasWidth || null;
    const fixedHeight = options.canvasHeight || null;
    const fixedCanvas = Boolean(fixedWidth && fixedHeight);

    const canvasLimitWidth = fixedCanvas ? fixedWidth : 512;
    const canvasLimitHeight = fixedCanvas ? fixedHeight : 512;
    const minWidth = fixedCanvas ? fixedWidth : 180;
    const minHeight = fixedCanvas ? fixedHeight : 180;

    const paddingX = fixedCanvas ? Math.max(4, Math.round(fixedWidth * 0.10)) : 38;
    const paddingY = fixedCanvas ? Math.max(4, Math.round(fixedHeight * 0.10)) : 34;

    let fontSize =
        options.size === "big" ? (fixedCanvas ? Math.round(fixedHeight * 0.42) : 92) :
        options.size === "small" ? (fixedCanvas ? Math.round(fixedHeight * 0.25) : 54) :
        (fixedCanvas ? Math.round(fixedHeight * 0.34) : 76);

    const minFontSize = fixedCanvas ? 5 : 28;
    const fontWeight = options.bold ? "900" : "800";
    const fontStyle = options.italic ? "italic" : "normal";

    while (fontSize > minFontSize) {
        const longestWidth = Math.max(
            ...lines.map((line) => estimateTextWidth(line.text, fontSize, options.font)),
            1
        );

        const lineGap = Math.round(fontSize * 1.12);
        const contentWidth = longestWidth + paddingX * 2;
        const contentHeight = lines.length * lineGap + paddingY * 2;

        if (contentWidth <= canvasLimitWidth && contentHeight <= canvasLimitHeight) break;

        fontSize -= fixedCanvas ? 1 : 2;
    }

    const lineGap = Math.round(fontSize * 1.12);
    const longestWidth = Math.max(
        ...lines.map((line) => estimateTextWidth(line.text, fontSize, options.font)),
        1
    );

    const canvasWidth = fixedCanvas
        ? fixedWidth
        : Math.min(canvasLimitWidth, Math.max(minWidth, Math.ceil(longestWidth + paddingX * 2)));

    const canvasHeight = fixedCanvas
        ? fixedHeight
        : Math.min(canvasLimitHeight, Math.max(minHeight, Math.ceil(lines.length * lineGap + paddingY * 2)));

    const totalTextHeight = lines.length * lineGap;
    const startY = canvasHeight / 2 - totalTextHeight / 2 + fontSize * 0.82;

    const fill = options.fill ?? "white";
    const stroke = options.stroke ?? "black";
    const strokeWidth = options.strokeWidth ?? Math.max(1, Math.round(fontSize * 0.08));
    const background = options.background ?? "transparent";

    const lineSvg = lines.map((line, index) => {
        const y = startY + index * lineGap;

        let textAnchor = "middle";
        let x = canvasWidth / 2;

        if (line.align === "left") {
            textAnchor = "start";
            x = paddingX;
        }

        if (line.align === "right") {
            textAnchor = "end";
            x = canvasWidth - paddingX;
        }

        return [
            '<text x="' + x + '" y="' + y + '"',
            ' text-anchor="' + textAnchor + '"',
            ' font-family="' + fontFamily + '"',
            ' font-size="' + fontSize + '"',
            ' font-weight="' + fontWeight + '"',
            ' font-style="' + fontStyle + '"',
            ' fill="' + fill + '"',
            ' stroke="' + stroke + '"',
            ' stroke-width="' + strokeWidth + '"',
            ' paint-order="stroke">',
            escapeXml(line.text),
            "</text>"
        ].join("");
    }).join("");

    return Buffer.from([
        '<svg width="' + canvasWidth + '" height="' + canvasHeight + '" viewBox="0 0 ' + canvasWidth + " " + canvasHeight + '" xmlns="http://www.w3.org/2000/svg">',
        '<rect width="' + canvasWidth + '" height="' + canvasHeight + '" fill="' + background + '"/>',
        lineSvg,
        "</svg>"
    ].join(""));
}

function extractEmojiGraphemes(text) {
    const clean = normalizeText(text);

    if (!clean) return [];

    const segments =
        typeof Intl !== "undefined" && Intl.Segmenter
            ? Array.from(
                new Intl.Segmenter("en", { granularity: "grapheme" }).segment(clean),
                (item) => item.segment
            )
            : Array.from(clean);

    return segments
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/u.test(item))
        .slice(0, CONFIG.twemoji.maxEmoji || CONFIG.emojiSticker.maxEmoji);
}

function isDecorationEmoji(emoji) {
    return /[❤️🧡💛💚💙💜🖤🤍🤎💔💕💞💓💗💖💘💝💟⭐🌟✨💫🔥]/u.test(emoji);
}

function reorderComboEmoji(emojis) {
    if (emojis.length !== 2) return emojis;

    const firstIsDecor = isDecorationEmoji(emojis[0]);
    const secondIsDecor = isDecorationEmoji(emojis[1]);

    if (!firstIsDecor && secondIsDecor) return [emojis[1], emojis[0]];

    return emojis;
}

function emojiToCodePoint(emoji) {
    const codePoints = [];
    let index = 0;

    while (index < emoji.length) {
        const code = emoji.charCodeAt(index++);

        if (code >= 0xd800 && code <= 0xdbff && index < emoji.length) {
            const next = emoji.charCodeAt(index++);

            if (next >= 0xdc00 && next <= 0xdfff) {
                const full = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                codePoints.push(full.toString(16));
            } else {
                codePoints.push(code.toString(16));
                index--;
            }
        } else {
            codePoints.push(code.toString(16));
        }
    }

    return codePoints.join("-");
}

function normalizeEmojiForTwemoji(emoji) {
    return emoji.replace(/\uFE0F/g, "").replace(/\uFE0E/g, "");
}

async function fetchTwemojiSvg(emoji) {
    const rawCodepoint = emojiToCodePoint(emoji);
    const normalizedCodepoint = emojiToCodePoint(normalizeEmojiForTwemoji(emoji));
    const candidates = [...new Set([normalizedCodepoint, rawCodepoint])];

    let lastError = null;

    for (const codepoint of candidates) {
        const url = `${CONFIG.twemoji.baseUrl}/${codepoint}.svg`;

        try {
            return await httpGetBuffer(url);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error(`Twemoji asset tidak ditemukan: ${emoji}`);
}

function getTwemojiLayout(emojis) {
    const orderedEmojis = reorderComboEmoji(emojis);
    const count = orderedEmojis.length;

    if (count <= 1) {
        return [{ emoji: orderedEmojis[0], size: 390, left: 61, top: 55 }];
    }

    if (count === 2) {
        return [
            { emoji: orderedEmojis[0], size: 190, left: 161, top: 28 },
            { emoji: orderedEmojis[1], size: 285, left: 113, top: 205 }
        ];
    }

    if (count === 3) {
        return [
            { emoji: orderedEmojis[0], size: 210, left: 151, top: 28 },
            { emoji: orderedEmojis[1], size: 210, left: 48, top: 255 },
            { emoji: orderedEmojis[2], size: 210, left: 254, top: 255 }
        ];
    }

    return [
        { emoji: orderedEmojis[0], size: 210, left: 42, top: 42 },
        { emoji: orderedEmojis[1], size: 210, left: 260, top: 42 },
        { emoji: orderedEmojis[2], size: 210, left: 42, top: 260 },
        { emoji: orderedEmojis[3], size: 210, left: 260, top: 260 }
    ];
}

async function createEmojiRenderBuffer(emojiText) {
    const emojis = extractEmojiGraphemes(emojiText);

    if (emojis.length === 0) {
        throw new Error("Tidak ada emoji valid.");
    }

    const layout = getTwemojiLayout(emojis);
    const composites = [];

    for (const item of layout) {
        const svgBuffer = await fetchTwemojiSvg(item.emoji);

        const pngBuffer = await sharp(svgBuffer, { density: 300 })
            .resize(item.size, item.size, {
                fit: "contain",
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toBuffer();

        composites.push({
            input: pngBuffer,
            left: item.left,
            top: item.top
        });
    }

    const outputBuffer = await sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
        .composite(composites)
        .png()
        .toBuffer();

    return outputBuffer;
}

function getInitials(name) {
    const clean = normalizeText(name).replace(/[^\p{L}\p{N}\s]/gu, "");
    const parts = clean.split(/\s+/).filter(Boolean);

    if (parts.length === 0) return "FR";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function createAvatarPlaceholderSvg(name) {
    const initials = escapeXml(getInitials(name));

    return Buffer.from(`
        <svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
            <rect width="128" height="128" rx="64" ry="64" fill="#111827"/>
            <text x="64" y="76"
                text-anchor="middle"
                font-family="Arial, sans-serif"
                font-size="42"
                font-weight="900"
                fill="white">${initials}</text>
        </svg>
    `);
}

async function createRoundedAvatarBuffer(inputBuffer, name) {
    const avatarMask = Buffer.from(`
        <svg width="96" height="96" xmlns="http://www.w3.org/2000/svg">
            <circle cx="48" cy="48" r="48" fill="white"/>
        </svg>
    `);

    const source = inputBuffer || createAvatarPlaceholderSvg(name);

    return await sharp(source)
        .resize(96, 96, {
            fit: "cover",
            position: "center"
        })
        .composite([{ input: avatarMask, blend: "dest-in" }])
        .png()
        .toBuffer();
}

function createModernQuoteBaseSvg(name, quoteText) {
    const safeName = escapeXml(name);
    const lines = splitTextIntoLines(quoteText, 24, 7);

    let fontSize = 42;

    if (quoteText.length > 80) fontSize = 36;
    if (quoteText.length > 130) fontSize = 30;
    if (quoteText.length > 190) fontSize = 26;

    const lineGap = Math.round(fontSize * 1.25);
    const startY = 190;

    const quoteLines = lines.map((line, index) => {
        const y = startY + index * lineGap;

        return `
            <text x="54" y="${y}"
                font-family="Arial, Helvetica, sans-serif"
                font-size="${fontSize}"
                font-weight="800"
                fill="#111827">${escapeXml(line)}</text>
        `;
    }).join("");

    return Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#f8fafc"/>
                    <stop offset="100%" stop-color="#dbeafe"/>
                </linearGradient>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#0f172a" flood-opacity="0.20"/>
                </filter>
            </defs>

            <rect width="512" height="512" fill="url(#bg)"/>

            <rect x="28" y="36" width="456" height="440"
                rx="34" ry="34"
                fill="white"
                filter="url(#shadow)"/>

            <text x="150" y="84"
                font-family="Arial, Helvetica, sans-serif"
                font-size="25"
                font-weight="900"
                fill="#0f172a">${safeName}</text>

            <text x="150" y="116"
                font-family="Arial, Helvetica, sans-serif"
                font-size="17"
                font-weight="700"
                fill="#64748b">Telegram Quote</text>

            <text x="54" y="160"
                font-family="Georgia, serif"
                font-size="54"
                font-weight="900"
                fill="#2563eb">“</text>

            ${quoteLines}

            <text x="458" y="444"
                text-anchor="end"
                font-family="Arial, Helvetica, sans-serif"
                font-size="18"
                font-weight="800"
                fill="#94a3b8">Faa Bot</text>
        </svg>
    `);
}

const BRAT_BG = "#FFFFFF";
const BRAT_FONT_WINDOWS = "C:\\Windows\\Fonts\\arial.ttf";

function escapeFfmpegDrawtext(text) {
    return String(text || "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:")
        .replace(/,/g, "\\,")
        .replace(/\n/g, " ");
}

async function createBratBuffer(rawText) {
    const text = normalizeText(rawText).slice(0, 120);

    if (!text) {
        throw new Error("Teks kosong.");
    }

    const lines = splitTextIntoLines(text.toLowerCase(), 12, 4);

    let fontSize = 108;
    const minFontSize = 30;

    while (fontSize > minFontSize) {
        const longest = Math.max(...lines.map((line) => line.length * fontSize * 0.52), 1);
        if (longest + 36 <= 512) break;
        fontSize -= 4;
    }

    const lineGap = Math.round(fontSize * 1.02);
    const totalHeight = lines.length * lineGap;
    const startY = Math.round(258 - totalHeight / 2 + fontSize * 0.36);

    const textSvg = lines.map((line, index) => {
        const y = startY + index * lineGap;
        return `<text x="256" y="${y}" text-anchor="middle" font-family="Arial Narrow, Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="400" fill="#111111">${escapeXml(line)}</text>`;
    }).join("");

    const svg = Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <rect width="512" height="512" fill="${BRAT_BG}"/>
            ${textSvg}
        </svg>
    `);

    // Sentuhan lo-fi khas brat: sedikit blur.
    const outputBuffer = await sharp(svg)
        .png()
        .blur(0.4)
        .toBuffer();

    return outputBuffer;
}

async function createBratVideoBuffer(rawText, ffmpegBin = "ffmpeg") {
    const text = normalizeText(rawText).replace(/\s+/g, " ").trim().slice(0, 60);

    if (!text) {
        throw new Error("Teks kosong.");
    }

    const { TEMP_DIR } = require("./state");
    const { escapeXml } = require("./util");
    const fontSize = 64;
    const stripWidth = Math.max(200, Math.ceil(text.length * fontSize * 0.58) + 40);
    const stripHeight = 110;

    const textSvg = Buffer.from(`
        <svg width="${stripWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
            <text x="20" y="78"
                font-family="Arial, Helvetica, sans-serif"
                font-size="${fontSize}"
                font-weight="400"
                fill="black">${escapeXml(text.toLowerCase())}</text>
        </svg>
    `);

    const stripPath = path.join(TEMP_DIR, `bratstrip-${randomUUID()}.png`);
    const outPath = path.join(TEMP_DIR, `bratvid-${randomUUID()}.webp`);
    const duration = 3;

    try {
        await sharp(textSvg).png().toFile(stripPath);

        const filter = `[0][1]overlay=x='W-(W+w)*t/${duration}':y='(H-h)/2':eof_action=pass,format=yuv420p`;

        await new Promise((resolve, reject) => {
            const child = spawn(ffmpegBin, [
                "-y",
                "-f", "lavfi",
                "-i", `color=c=${BRAT_BG}:s=512x512:r=15:d=${duration}`,
                "-loop", "1",
                "-i", stripPath,
                "-filter_complex", filter,
                "-frames:v", String(15 * duration),
                "-vcodec", "libwebp",
                "-lossless", "0",
                "-quality", "75",
                "-loop", "0",
                "-preset", "default",
                "-an",
                outPath
            ], { windowsHide: true });

            let stderr = "";
            child.stderr.on("data", (d) => { stderr += d.toString(); });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0 && fs.existsSync(outPath)) resolve();
                else reject(new Error("ffmpeg bratvid exit " + code + ". " + stderr.slice(-300)));
            });
        });

        return await fsp.readFile(outPath);
    } finally {
        await safeUnlink(stripPath);
        await safeUnlink(outPath);
    }
}

module.exports = {
    legacyMedia,
    splitTextIntoLines,
    createWatermarkSvg,
    imageToStickerCanvas,
    removeWhiteBackground,
    writeTempMediaFile,
    runPythonRemoveBg,
    removeBackgroundAI,
    removeBackgroundAIAsImage,
    createMemeTextSvg,
    createMemeSticker,
    parseQuoteOptions,
    parseLineAlign,
    splitStyledTextLines,
    estimateTextWidth,
    createQuoteSvgWithOptions,
    parseTextOptions,
    createTextSvg,
    extractEmojiGraphemes,
    isDecorationEmoji,
    reorderComboEmoji,
    emojiToCodePoint,
    normalizeEmojiForTwemoji,
    fetchTwemojiSvg,
    getTwemojiLayout,
    createEmojiRenderBuffer,
    getInitials,
    createAvatarPlaceholderSvg,
    createRoundedAvatarBuffer,
    createModernQuoteBaseSvg,
    createBratBuffer,
    createBratVideoBuffer,
    escapeFfmpegDrawtext
};
