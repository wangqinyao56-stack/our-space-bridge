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
const MAX = 40;

try {
  if (fs.existsSync(MEMORY_FILE)) {
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    exchanges = JSON.parse(raw);
    console.log(`[intimate-memory] Loaded ${exchanges.length} messages from disk`);
  }
} catch {}

function save() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(exchanges), "utf-8");
  } catch {}
}

export function recordIntimateMessage(role, text) {
  const travel = isTraveling();
  exchanges.push({ role, content: text.slice(0, 2000), travel });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
  save();
}

export async function getIntimateHistory(travelFilter = null) {
  let msgs = exchanges;
  if (travelFilter !== null) {
    msgs = msgs.filter(m => m.travel === travelFilter);
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
