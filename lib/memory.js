/**
 * Chat history with date-based file persistence.
 * Each day stored in data/chat/YYYY-MM-DD.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTraveling } from "./scenery.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const CHAT_DIR = path.join(DATA_DIR, "chat");
const NOTES_FILE = path.join(DATA_DIR, "chat-notes.json");

try { fs.mkdirSync(CHAT_DIR, { recursive: true }); } catch {}

let exchanges = [];
const RECENT_DAYS = 30;
const MAX_IN_MEMORY = 2000;

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

export function recordUserMessage(text, opts = {}) {
  const now = Date.now();
  const travel = isTraveling();
  const entry = { role: "user", content: text.slice(0, 2000), time: now, travel };
  if (opts.channel) entry.channel = opts.channel;
  exchanges.push(entry);
  const date = bjDateStr(now);
  const msgs = loadDay(date);
  const dayEntry = { role: "user", content: text.slice(0, 2000), time: now, travel };
  if (opts.channel) dayEntry.channel = opts.channel;
  msgs.push(dayEntry);
  saveDay(date, msgs);
}

export function recordBotReply(text, type = "text", opts = {}) {
  const now = Date.now();
  const travel = isTraveling();
  const entry = { role: "assistant", content: text.slice(0, 2000), time: now, travel, type };
  if (opts.proactive) entry.proactive = true;
  if (opts.channel) entry.channel = opts.channel;
  exchanges.push(entry);
  const date = bjDateStr(now);
  const msgs = loadDay(date);
  const dayEntry = { role: "assistant", content: text.slice(0, 2000), time: now, travel, type };
  if (opts.proactive) dayEntry.proactive = true;
  if (opts.channel) dayEntry.channel = opts.channel;
  msgs.push(dayEntry);
  saveDay(date, msgs);
}

// 把最近一条 assistant 回复标记为语音，供 get_history 区分（不拆分、按转写文本对齐）
export function markLastBotReplyVoice() {
  for (let i = exchanges.length - 1; i >= 0; i--) {
    if (exchanges[i].role !== "assistant") continue;
    exchanges[i].type = "voice";
    const t = exchanges[i].time;
    const c = exchanges[i].content;
    if (t) {
      const date = bjDateStr(t);
      const msgs = loadDay(date);
      for (let j = msgs.length - 1; j >= 0; j--) {
        if (msgs[j].role === "assistant" && msgs[j].time === t && msgs[j].content === c) {
          msgs[j].type = "voice";
          saveDay(date, msgs);
          break;
        }
      }
    }
    return;
  }
}

export async function getRecentHistory() {
  const lines = [];
  for (const e of exchanges.slice(-60)) {
    if (e.role === "user") lines.push(`华生：${e.content}`);
    else lines.push(`夏彦：${e.content}`);
  }
  return lines.join("\n") + "\n";
}

export async function getRecentHistoryMessages(travelFilter = null) {
  let msgs = exchanges;
  if (travelFilter !== null) {
    msgs = msgs.filter(m => m.travel === travelFilter);
  }
  return msgs.slice(-200);
}

// 按 channel 过滤历史（像素小屋等独立频道），先过滤再截断，避免被其他频道挤掉
// todayOnly=true 时只返回北京时间的"当天"消息，跨天显示清空（记录仍完整保留在文件里）
export function getChannelHistoryMessages(channel, travelFilter = null, todayOnly = false) {
  let msgs = exchanges.filter(m => m.channel === channel);
  if (travelFilter !== null) msgs = msgs.filter(m => m.travel === travelFilter);
  if (todayOnly) {
    const today = bjDateStr(Date.now());
    msgs = msgs.filter(m => bjDateStr(m.time || Date.now()) === today);
  }
  return msgs.slice(-200);
}

export function getChatHistoryByDate(date) {
  return loadDay(date);
}

export function clearMemory() {
  exchanges = [];
  const today = bjDateStr(Date.now());
  try { fs.unlinkSync(dayFile(today)); } catch {}
}

export function deleteMessage(content, role) {
  const target = content.trim();
  let idx = -1;
  for (let i = exchanges.length - 1; i >= 0; i--) {
    if (exchanges[i].role === role && exchanges[i].content.trim() === target) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return false;

  const removed = exchanges.splice(idx, 1)[0];
  if (removed.time) {
    const date = bjDateStr(removed.time);
    const msgs = loadDay(date);
    const dayIdx = msgs.findIndex(m => m.role === role && m.content.trim() === target);
    if (dayIdx !== -1) {
      msgs.splice(dayIdx, 1);
      saveDay(date, msgs);
    }
  }
  console.log("[memory] Deleted message:", role, target.slice(0, 50));
  return true;
}

export function deleteMessages(items) {
  let count = 0;
  for (const { content, role } of items) {
    if (deleteMessage(content, role)) count++;
  }
  return count;
}

// ── Long-term memory notes: survive forever, injected into daily chat prompt ──
export function addChatNote(note) {
  let notes = [];
  try { if (fs.existsSync(NOTES_FILE)) notes = JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")); } catch {}
  notes.push({ note, ts: Date.now() });
  if (notes.length > 200) notes = notes.slice(-200);
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes), "utf-8");
}

export function getChatNotes() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      return JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")).slice(-30);
    }
  } catch {}
  return [];
}

// Get archived chat context from older date files (beyond recent 30 days in memory)
export function getArchivedChatContext() {
  try {
    const files = fs.readdirSync(CHAT_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .slice(-37, -7); // days 8-37 ago (beyond current memory window)
    const msgs = [];
    for (const f of files) {
      try {
        const day = JSON.parse(fs.readFileSync(path.join(CHAT_DIR, f), "utf-8"));
        msgs.push(...day.slice(-10));
      } catch {}
    }
    return msgs.slice(-40);
  } catch {}
  return [];
}
