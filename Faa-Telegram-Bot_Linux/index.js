const TelegramBot = require("node-telegram-bot-api");
const readline = require("readline");
const { CONFIG, loadBotState, saveBotState, rememberGroup, rememberUser } = require("./src/state");
const { setBot, makeCtx, rememberId } = require("./src/tg");
const { handleCommand, handleMenuCallback } = require("./src/commands");

loadBotState();

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function firstInstallSetup() {
    // Owners kosong = install pertama: minta ID owner permanen sekarang,
    // biar tidak hilang-hilang dan tidak perlu !owner add manual.
    if (CONFIG.owners && CONFIG.owners.length > 0) return;

    console.log("");
    console.log("=== Setup pertama: owner permanen ===");
    console.log("Lihat Telegram user ID via @userinfobot di Telegram.");

    const raw = await ask("Telegram user ID owner (Enter untuk lewati): ");
    const id = String(raw || "").replace(/\D/g, "");

    if (id.length >= 5) {
        CONFIG.owners.push(id);
        saveBotState();
        console.log(`Owner permanen tersimpan: ${id}`);
    } else {
        console.log("Dilewati. Bisa tambah nanti via: !owner add <telegram_user_id>");
    }

    console.log("");
}

const TOKEN = (process.env.BOT_TOKEN || "").trim();

if (!TOKEN) {
    console.error("BOT_TOKEN kosong.");
    console.error("Cara pakai: set BOT_TOKEN=123456:ABCDEF && node index.js");
    console.error("Ambil token dari @BotFather di Telegram.");
    process.exit(1);
}

let bot = null;

async function main() {
    await firstInstallSetup();

    bot = new TelegramBot(TOKEN, { polling: true });
    setBot(bot);

    bot.on("polling_error", (error) => {
        console.error("Polling error:", error.message);
    });

    bot.on("message", async (msg) => {
        try {
            if (!msg || !msg.chat) return;

            if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
                rememberGroup(msg.chat.id);
                if (msg.from) {
                    const nm = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");
                    rememberUser(msg.chat.id, msg.from.id, nm || String(msg.from.id));
                }
            }

            const dedupKey = `${msg.chat.id}:${msg.message_id}`;
            if (rememberId(dedupKey)) return;

            const ctx = makeCtx(msg);
            if (!ctx) return;
            if (!ctx.body) return;

            await handleCommand(ctx, "message");
        } catch (error) {
            console.error("[message] ERROR:", error);
        }
    });

    bot.on("callback_query", async (query) => {
        try {
            const data = String(query.data || "");

            if (data.startsWith("menu:")) {
                await bot.answerCallbackQuery(query.id).catch(() => {});
                await handleMenuCallback(query.message.chat.id, query.message.message_id, data.slice(5));
            }
        } catch (error) {
            console.error("[callback] ERROR:", error);
        }
    });

    console.log("Faa Ramadhan Bot Telegram jalan (polling).");
}

main().catch((error) => {
    console.error("Fatal start error:", error);
    process.exit(1);
});

let shuttingDown = false;

async function shutdownBot() {
    if (shuttingDown) {
        process.exit(1);
        return;
    }
    shuttingDown = true;

    console.log("Closing bot...");

    try {
        await bot?.stopPolling();
    } catch (error) {
        console.error("Stop polling failed:", error.message);
    }

    process.exit(0);
}

process.on("SIGINT", () => shutdownBot());
process.on("SIGTERM", () => shutdownBot());
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
});
