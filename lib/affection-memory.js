/**
 * Affection chat memory — SEPARATE from main chat & intimate.
 * Channels: "affection_home" and "affection_date"
 *
 * Archive: old messages saved to data/affection-home/YYYY-MM-DD.json (never lost)
 * Active: latest MAX messages kept in the prompt context
 * Long-term notes: data/affection-home-notes.json (key memories that survive forever)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const HOME_FILE = path.join(DATA_DIR, "affection-home-memory.json");
const DATE_FILE = path.join(DATA_DIR, "affection-date-memory.json");
const HOME_ARCHIVE_DIR = path.join(DATA_DIR, "affection-home-archive");
const DATE_ARCHIVE_DIR = path.join(DATA_DIR, "affection-date-archive");
const HOME_NOTES_FILE = path.join(DATA_DIR, "affection-home-notes.json");
const DATE_NOTES_FILE = path.join(DATA_DIR, "affection-date-notes.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(HOME_ARCHIVE_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(DATE_ARCHIVE_DIR, { recursive: true }); } catch {}

const stores = { affection_home: [], affection_date: [] };
const MAX = 60;

function bjDateStr(ts) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function archiveFile(channel, dateStr) {
  const dir = channel === "affection_home" ? HOME_ARCHIVE_DIR : DATE_ARCHIVE_DIR;
  return path.join(dir, `${dateStr}.json`);
}

function loadNotes(channel) {
  const file = channel === "affection_home" ? HOME_NOTES_FILE : DATE_NOTES_FILE;
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  return [];
}

function saveNotes(channel, notes) {
  const file = channel === "affection_home" ? HOME_NOTES_FILE : DATE_NOTES_FILE;
  try { fs.writeFileSync(file, JSON.stringify(notes), "utf-8"); } catch {}
}

function load(channel) {
  const file = channel === "affection_home" ? HOME_FILE : DATE_FILE;
  try {
    if (fs.existsSync(file)) {
      stores[channel] = JSON.parse(fs.readFileSync(file, "utf-8"));
      console.log(`[affection-memory] Loaded ${stores[channel].length} messages for ${channel}`);
    }
  } catch {}
}

function save(channel) {
  const file = channel === "affection_home" ? HOME_FILE : DATE_FILE;
  try { fs.writeFileSync(file, JSON.stringify(stores[channel]), "utf-8"); } catch {}
}

load("affection_home");
load("affection_date");

export function recordAffectionMessage(channel, role, text) {
  if (!stores[channel]) return;
  stores[channel].push({ role, content: text.slice(0, 2000), ts: Date.now() });
  if (stores[channel].length > MAX * 2) {
    // Archive oldest batch before trimming — never lose conversations
    const toArchive = stores[channel].slice(0, stores[channel].length - MAX * 2);
    const byDate = {};
    for (const m of toArchive) {
      const d = bjDateStr(m.ts);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(m);
    }
    for (const [date, msgs] of Object.entries(byDate)) {
      const file = archiveFile(channel, date);
      let existing = [];
      try {
        if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, "utf-8"));
      } catch {}
      fs.writeFileSync(file, JSON.stringify([...existing, ...msgs]), "utf-8");
    }
    stores[channel] = stores[channel].slice(-MAX * 2);
  }
  save(channel);
}

export function getAffectionHistory(channel) {
  return stores[channel] ? [...stores[channel]].slice(-MAX) : [];
}

export function getAffectionHistoryMessages(channel) {
  return getAffectionHistory(channel).map(m => ({ role: m.role, content: m.content, ts: m.ts }));
}

// ── Long-term memory notes: survive forever, injected into prompt ──
export function addAffectionNote(channel, note) {
  const notes = loadNotes(channel);
  notes.push({ note, ts: Date.now() });
  // Keep last 200 notes max
  const trimmed = notes.length > 200 ? notes.slice(-200) : notes;
  saveNotes(channel, trimmed);
}

export function getAffectionNotes(channel) {
  return loadNotes(channel).slice(-30); // last 30 notes in context
}

// Get recent archived messages as context supplement
export function getArchivedContext(channel) {
  const dir = channel === "affection_home" ? HOME_ARCHIVE_DIR : DATE_ARCHIVE_DIR;
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .slice(-7); // last 7 days of archives
    const msgs = [];
    for (const f of files) {
      try {
        const day = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        msgs.push(...day.slice(-20)); // last 20 per day
      } catch {}
    }
    return msgs.slice(-40); // up to 40 archived messages as memory
  } catch {}
  return [];
}

export function deleteAffectionMessage(channel, content, role) {
  if (!stores[channel]) return false;
  const idx = [...stores[channel]].reverse().findIndex(
    m => m.role === role && m.content.slice(0, 100) === (content || "").slice(0, 100)
  );
  if (idx === -1) return false;
  stores[channel].splice(stores[channel].length - 1 - idx, 1);
  save(channel);
  return true;
}

export function clearAffectionMemory(channel) {
  if (!stores[channel]) return;
  // Archive everything before clearing
  const byDate = {};
  for (const m of stores[channel]) {
    const d = bjDateStr(m.ts);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  }
  for (const [date, msgs] of Object.entries(byDate)) {
    const file = archiveFile(channel, date);
    let existing = [];
    try {
      if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {}
    fs.writeFileSync(file, JSON.stringify([...existing, ...msgs]), "utf-8");
  }
  stores[channel] = [];
  save(channel);
  console.log(`[affection-memory] Archived + cleared ${channel}`);
}
