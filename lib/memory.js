/**
 * Chat history with file persistence for our-space bridge.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const MEMORY_FILE = path.join(DATA_DIR, "chat-memory.json");

// Ensure data directory exists
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let exchanges = [];
const MAX = 30; // 保留最近15对对话

// 启动时从文件恢复
try {
  if (fs.existsSync(MEMORY_FILE)) {
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    exchanges = JSON.parse(raw);
    console.log(`[memory] Loaded ${exchanges.length} messages from disk`);
  }
} catch {}

function save() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(exchanges), "utf-8");
  } catch {}
}

export function recordUserMessage(text) {
  exchanges.push({ role: "user", content: text.slice(0, 2000) });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
  save();
}

export function recordBotReply(text) {
  exchanges.push({ role: "assistant", content: text.slice(0, 2000) });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
  save();
}

export async function getRecentHistory() {
  const lines = [];
  for (const e of exchanges) {
    if (e.role === "user") lines.push(`华生：${e.content}`);
    else lines.push(`夏彦：${e.content}`);
  }
  return lines.join("\n") + "\n";
}

export async function getRecentHistoryMessages() {
  return exchanges.slice(-16); // 最近8对对话
}

export function clearMemory() {
  exchanges = [];
  save();
}
