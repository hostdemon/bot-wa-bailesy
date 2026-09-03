import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pino from "pino";
import readline from "node:readline/promises";

const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./auth_info_baileys";
const prefix = process.env.BOT_PREFIX ?? "!";
const geminiModelName = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

let reconnectTimer;
let stopping = false;

const logger = pino({
  level: process.env.LOG_LEVEL ?? "silent",
});

function normalizePhoneNumber(value) {
  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 8 ? normalized : "";
}

async function askForPhoneNumber() {
  const configuredNumber = normalizePhoneNumber(
    process.env.WHATSAPP_PHONE_NUMBER ?? "",
  );

  if (!process.stdin.isTTY && configuredNumber) {
    return configuredNumber;
  }

  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await terminal.question(
      `Masukkan nomor HP WhatsApp dengan kode negara (contoh 6281234567890)${configuredNumber ? ` [Enter untuk ${configuredNumber}]` : ""}: `,
    );
    const phoneNumber = normalizePhoneNumber(answer) || configuredNumber;

    if (!phoneNumber) {
      throw new Error(
        "Nomor HP wajib diisi untuk membuat pairing code WhatsApp.",
      );
    }

    return phoneNumber;
  } finally {
    terminal.close();
  }
}

function getText(message) {
  const content = message.message;

  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    ""
  );
}

function getStatusCode(error) {
  if (!error) {
    return undefined;
  }

  if (error.output?.statusCode) {
    return error.output.statusCode;
  }

  return new Boom(error).output.statusCode;
}

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum dikonfigurasi di Secrets Replit.");
  }

  const gemini = new GoogleGenerativeAI(apiKey);
  return gemini.getGenerativeModel({
    model: geminiModelName,
    systemInstruction:
      "Kamu adalah asisten WhatsApp yang ramah. Jawab dalam bahasa yang dipakai pengguna, jelas dan ringkas.",
  });
}

async function askGemini(question) {
  const model = getGeminiModel();
  const result = await model.generateContent(question);
  const answer = result.response.text().trim();

  return answer || "Maaf, Gemini tidak memberikan jawaban.";
}

async function handleMessages(socket, messages) {
  for (const message of messages) {
    const remoteJid = message.key.remoteJid;
    const text = getText(message).trim();

    if (!remoteJid || message.key.fromMe || !text) {
      continue;
    }

    if (!text.startsWith(prefix)) {
      continue;
    }

    const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase();
    const question = args.join(" ").trim();

    if (command !== "ai") {
      continue;
    }

    if (!question) {
      await socket.sendMessage(remoteJid, {
        text: `Format: ${prefix}ai <pertanyaan>\nContoh: ${prefix}ai jelaskan black hole`,
      });
      continue;
    }

    try {
      await socket.sendMessage(remoteJid, {
        text: "Sedang berpikir...",
      });

      const answer = await askGemini(question);
      await socket.sendMessage(remoteJid, { text: answer });
    } catch (error) {
      console.error("Gagal memproses pertanyaan Gemini:", error);
      await socket.sendMessage(remoteJid, {
        text: "Maaf, terjadi kendala saat menghubungi Gemini. Coba lagi nanti.",
      });
    }
  }
}

async function startBot() {
  if (stopping) {
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    logger,
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("messages.upsert", ({ messages, type }) => {
    if (type === "notify") {
      void handleMessages(socket, messages).catch((error) => {
        console.error("Gagal memproses pesan:", error);
      });
    }
  });

  socket.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "connecting") {
      console.log("Menghubungkan ke WhatsApp...");
    }

    if (connection === "open") {
      console.log(`WhatsApp tersambung sebagai ${socket.user?.id ?? "unknown"}`);
    }

    if (connection !== "close") {
      return;
    }

    const statusCode = getStatusCode(lastDisconnect?.error);
    const shouldReconnect =
      statusCode !== DisconnectReason.loggedOut &&
      statusCode !== DisconnectReason.connectionReplaced &&
      !stopping;

    if (shouldReconnect) {
      console.log("Koneksi terputus. Reconnect dalam 5 detik...");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void startBot().catch((error) => {
          console.error("Gagal reconnect:", error);
        });
      }, 5000);
      return;
    }

    console.error(
      "Sesi WhatsApp berakhir atau digantikan. Hapus folder auth_info_baileys lalu pairing ulang.",
    );
  });

  if (!state.creds.registered) {
    const phoneNumber = await askForPhoneNumber();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const pairingCode = await socket.requestPairingCode(phoneNumber);

    console.log("");
    console.log("PAIRING CODE:", pairingCode);
    console.log(
      "Buka WhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon.",
    );
    console.log("Masukkan kode 8 karakter tersebut sebelum kedaluwarsa.");
    console.log("");
  }
}

function stopBot() {
  stopping = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

process.once("SIGINT", () => {
  stopBot();
  process.exit(0);
});

process.once("SIGTERM", () => {
  stopBot();
  process.exit(0);
});

startBot().catch((error) => {
  console.error("Bot gagal dimulai:", error);
  process.exitCode = 1;
});