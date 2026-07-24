/**
 * Intimate space chat memory with file persistence + long-term archive.
 * SEPARATE from main chat memory — intimate conversations are private.
 *
 * Archive: old messages saved to data/intimate-archive/YYYY-MM-DD.json (never lost)
 * Notes: data/intimate-notes.json (key memories that survive forever)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTraveling } from "./scenery.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const MEMORY_FILE = path.join(DATA_DIR, "intimate-memory.json");
const ARCHIVE_DIR = path.join(DATA_DIR, "intimate-archive");
const NOTES_FILE = path.join(DATA_DIR, "intimate-notes.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(ARCHIVE_DIR, { recursive: true }); } catch {}

let exchanges = [];
const MAX = 100;

function bjDateStr(ts) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function archiveFile(dateStr) {
  return path.join(ARCHIVE_DIR, `${dateStr}.json`);
}

try {
  if (fs.existsSync(MEMORY_FILE)) {
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    exchanges = JSON.parse(raw);
    console.log(`[intimate-memory] Loaded ${exchanges.length} messages from disk`);
  }
} catch {}

function save() {
  try {
    if (exchanges.length > MAX * 2) {
      // Archive oldest before trimming
      const toArchive = exchanges.slice(0, exchanges.length - MAX * 2);
      const byDate = {};
      for (const m of toArchive) {
        const d = bjDateStr(m.ts || Date.now());
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(m);
      }
      for (const [date, msgs] of Object.entries(byDate)) {
        const file = archiveFile(date);
        let existing = [];
        try { if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
        fs.writeFileSync(file, JSON.stringify([...existing, ...msgs]), "utf-8");
      }
      exchanges = exchanges.slice(-MAX * 2);
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(exchanges), "utf-8");
  } catch {}
}

export function recordIntimateMessage(role, text) {
  const travel = isTraveling();
  exchanges.push({ role, content: text.slice(0, 2000), travel, ts: Date.now() });
  save();
}

// ── Blind box separate memory ──
const BLINDBOX_MEMORY_FILE = path.join(DATA_DIR, "blindbox-memory.json");
const BLINDBOX_ARCHIVE_DIR = path.join(DATA_DIR, "blindbox-archive");
try { fs.mkdirSync(BLINDBOX_ARCHIVE_DIR, { recursive: true }); } catch {}

let blindboxExchanges = [];
const BLINDBOX_MAX = 60;

try {
  if (fs.existsSync(BLINDBOX_MEMORY_FILE)) {
    blindboxExchanges = JSON.parse(fs.readFileSync(BLINDBOX_MEMORY_FILE, "utf-8"));
  }
} catch {}

function blindboxSave() {
  try {
    if (blindboxExchanges.length > BLINDBOX_MAX * 2) {
      blindboxExchanges = blindboxExchanges.slice(-BLINDBOX_MAX);
    }
    fs.writeFileSync(BLINDBOX_MEMORY_FILE, JSON.stringify(blindboxExchanges), "utf-8");
  } catch {}
}

export function recordBlindBoxMessage(role, text) {
  blindboxExchanges.push({ role, content: text.slice(0, 2000), ts: Date.now() });
  blindboxSave();
}

export async function getBlindBoxHistory() {
  return blindboxExchanges.slice(-24);
}

export function clearBlindBoxMemory() {
  blindboxExchanges = [];
  blindboxSave();
}

export async function getIntimateHistory(travelFilter = null) {
  let msgs = exchanges;
  if (travelFilter !== null) {
    msgs = msgs.filter(m => travelFilter ? m.travel === true : m.travel !== true);
  }
  return msgs.slice(-24);
}

// ── Long-term memory notes ──
export function addIntimateNote(note) {
  let notes = [];
  try { if (fs.existsSync(NOTES_FILE)) notes = JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")); } catch {}
  notes.push({ note, ts: Date.now() });
  if (notes.length > 200) notes = notes.slice(-200);
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes), "utf-8");
}

export function getIntimateNotes() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      return JSON.parse(fs.readFileSync(NOTES_FILE, "utf-8")).slice(-30);
    }
  } catch {}
  return [];
}

// ── Archived context ──
export function getIntimateArchivedContext() {
  try {
    const files = fs.readdirSync(ARCHIVE_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .slice(-7);
    const msgs = [];
    for (const f of files) {
      try {
        const day = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), "utf-8"));
        msgs.push(...day.slice(-20));
      } catch {}
    }
    return msgs.slice(-40);
  } catch {}
  return [];
}

export function clearIntimateMemory() {
  // Archive before clearing
  const byDate = {};
  for (const m of exchanges) {
    const d = bjDateStr(m.ts || Date.now());
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  }
  for (const [date, msgs] of Object.entries(byDate)) {
    const file = archiveFile(date);
    let existing = [];
    try { if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
    fs.writeFileSync(file, JSON.stringify([...existing, ...msgs]), "utf-8");
  }
  exchanges = [];
  save();
  console.log("[intimate-memory] Archived + cleared");
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
