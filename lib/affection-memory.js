/**
 * Affection chat memory — SEPARATE from main chat & intimate.
 * Channels: "affection_home" and "affection_date"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const HOME_FILE = path.join(DATA_DIR, "affection-home-memory.json");
const DATE_FILE = path.join(DATA_DIR, "affection-date-memory.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const stores = { affection_home: [], affection_date: [] };
const MAX = 60;

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
  if (stores[channel].length > MAX * 2) stores[channel] = stores[channel].slice(-MAX * 2);
  save(channel);
}

export function getAffectionHistory(channel) {
  return stores[channel] ? [...stores[channel]].slice(-MAX) : [];
}

export function getAffectionHistoryMessages(channel) {
  return getAffectionHistory(channel).map(m => ({ role: m.role, content: m.content }));
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
  stores[channel] = [];
  save(channel);
  console.log(`[affection-memory] Cleared ${channel}`);
}
