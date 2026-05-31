/**
 * Intimate space chat memory with file persistence.
 * SEPARATE from main chat memory — intimate conversations are private.
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const MEMORY_FILE = path.join(DATA_DIR, "intimate-memory.json");

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
  exchanges.push({ role, content: text.slice(0, 2000) });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
  save();
}

export async function getIntimateHistory() {
  return exchanges.slice(-16);
}
