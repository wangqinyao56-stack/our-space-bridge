/**
 * Chat history with date-based file persistence.
 * Each day stored in data/chat/YYYY-MM-DD.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const CHAT_DIR = path.join(DATA_DIR, "chat");

try { fs.mkdirSync(CHAT_DIR, { recursive: true }); } catch {}

let exchanges = [];
const RECENT_DAYS = 7;
const MAX_IN_MEMORY = 400;

function bjDateStr(ts) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function dayFile(date) {
  return path.join(CHAT_DIR, `${date}.json`);
}

function loadDay(date) {
  try {
    if (fs.existsSync(dayFile(date))) {
      return JSON.parse(fs.readFileSync(dayFile(date), "utf-8"));
    }
  } catch {}
  return [];
}

function saveDay(date, msgs) {
  try {
    fs.writeFileSync(dayFile(date), JSON.stringify(msgs), "utf-8");
  } catch {}
}

// Load recent days into memory on startup
function loadRecentDays() {
  try {
    const files = fs.readdirSync(CHAT_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .slice(-RECENT_DAYS);
    exchanges = [];
    for (const f of files) {
      exchanges.push(...loadDay(f.replace(".json", "")));
    }
    if (exchanges.length > MAX_IN_MEMORY) {
      exchanges = exchanges.slice(-MAX_IN_MEMORY);
    }
    console.log(`[memory] Loaded ${exchanges.length} messages from ${files.length} days`);
  } catch (e) {
    console.error("[memory] Failed to load history:", e.message);
  }
}
loadRecentDays();

export function recordUserMessage(text) {
  const now = Date.now();
  exchanges.push({ role: "user", content: text.slice(0, 2000), time: now });
  const date = bjDateStr(now);
  const msgs = loadDay(date);
  msgs.push({ role: "user", content: text.slice(0, 2000), time: now });
  saveDay(date, msgs);
}

export function recordBotReply(text) {
  const now = Date.now();
  exchanges.push({ role: "assistant", content: text.slice(0, 2000), time: now });
  const date = bjDateStr(now);
  const msgs = loadDay(date);
  msgs.push({ role: "assistant", content: text.slice(0, 2000), time: now });
  saveDay(date, msgs);
}

export async function getRecentHistory() {
  const lines = [];
  for (const e of exchanges.slice(-40)) {
    if (e.role === "user") lines.push(`华生：${e.content}`);
    else lines.push(`夏彦：${e.content}`);
  }
  return lines.join("\n") + "\n";
}

export async function getRecentHistoryMessages() {
  return exchanges.slice(-40);
}

export function getChatHistoryByDate(date) {
  return loadDay(date);
}

export function clearMemory() {
  exchanges = [];
  const today = bjDateStr(Date.now());
  try { fs.unlinkSync(dayFile(today)); } catch {}
}
