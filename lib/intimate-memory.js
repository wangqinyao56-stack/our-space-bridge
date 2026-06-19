/**
 * Intimate space chat memory with file persistence.
 * SEPARATE from main chat memory — intimate conversations are private.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTraveling } from "./scenery.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const MEMORY_FILE = path.join(DATA_DIR, "intimate-memory.json");

// Ensure data directory exists
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let exchanges = [];
const MAX = 100; // 100 exchanges (200 entries), split across travel/non-travel

try {
  if (fs.existsSync(MEMORY_FILE)) {
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    exchanges = JSON.parse(raw);
    console.log(`[intimate-memory] Loaded ${exchanges.length} messages from disk`);
  }
} catch {}

function save() {
  try {
    // Trim: keep at most MAX entries total, but ensure both travel and non-travel have representation
    if (exchanges.length > MAX * 2) {
      const travelMsgs = exchanges.filter(m => m.travel === true);
      const nonTravelMsgs = exchanges.filter(m => m.travel !== true);
      // Keep up to MAX of each category, but total still capped at MAX*2
      const keepTravel = travelMsgs.slice(-Math.min(MAX, travelMsgs.length));
      const keepNonTravel = nonTravelMsgs.slice(-Math.min(MAX, nonTravelMsgs.length));
      // Interleave by timestamp to maintain chronological order
      const merged = [...keepNonTravel, ...keepTravel].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      exchanges = merged.slice(-MAX * 2);
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(exchanges), "utf-8");
  } catch {}
}

export function recordIntimateMessage(role, text) {
  const travel = isTraveling();
  exchanges.push({ role, content: text.slice(0, 2000), travel, ts: Date.now() });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
  save();
}

export async function getIntimateHistory(travelFilter = null) {
  let msgs = exchanges;
  if (travelFilter !== null) {
    // travelFilter=true: only travel messages
    // travelFilter=false: non-travel messages (including old msgs without the travel field)
    msgs = msgs.filter(m => travelFilter ? m.travel === true : m.travel !== true);
  }
  return msgs.slice(-16);
}

export function clearIntimateMemory() {
  exchanges = [];
  save();
}

export function deleteIntimateMessage(content, role) {
  const target = content.trim();
  let idx = -1;
  for (let i = exchanges.length - 1; i >= 0; i--) {
    if (exchanges[i].role === role && exchanges[i].content.trim() === target) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return false;
  exchanges.splice(idx, 1);
  save();
  console.log("[intimate-memory] Deleted message:", role, target.slice(0, 50));
  return true;
}

export function deleteIntimateMessages(items) {
  let count = 0;
  for (const { content, role } of items) {
    if (deleteIntimateMessage(content, role)) count++;
  }
  return count;
}
