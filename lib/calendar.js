/**
 * 日历 —— 备注 + 闹钟 + 亲密爱心标记（做几次标几颗）
 * 数据持久化到 data/calendar.json（Sealos 持久卷）。
 * 亲密事件由各亲密/剧场/大富翁流程调用 recordIntimacyEvent() 累计。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const CALENDAR_FILE = path.join(DATA_DIR, "calendar.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function bjDateStr(ts = Date.now()) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

let data = {
  // date(YYYY-MM-DD) -> 当天做爱次数
  intimacy: {},
  lastIntimacyTs: 0,
  // date -> [{ id, text, ts }]
  notes: {},
  // [{ id, date, time(HH:mm), label, ts, done }]
  alarms: [],
};

try {
  if (fs.existsSync(CALENDAR_FILE)) {
    const raw = JSON.parse(fs.readFileSync(CALENDAR_FILE, "utf-8"));
    data = { intimacy: {}, notes: {}, alarms: [], ...raw };
  }
} catch (e) {
  console.error("[calendar] load failed:", e.message);
}

function save() {
  try { fs.writeFileSync(CALENDAR_FILE, JSON.stringify(data, null, 2), "utf-8"); } catch {}
}

const uuid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** 记录一次亲密（做爱），15分钟内连续消息算同一次。返回 { date, count, crossed, skipped } */
export function recordIntimacyEvent() {
  const now = Date.now();
  const COOLDOWN = 15 * 60 * 1000;
  const date = bjDateStr(now);
  if (data.lastIntimacyTs && now - data.lastIntimacyTs < COOLDOWN) {
    return { date, count: data.intimacy[date] || 0, crossed: false, skipped: true };
  }
  data.lastIntimacyTs = now;
  data.intimacy[date] = (data.intimacy[date] || 0) + 1;
  const count = data.intimacy[date];
  save();
  return { date, count, crossed: count === 3, skipped: false };
}

export function getIntimacyCount(date) {
  return data.intimacy[date] || 0;
}

export function getCalendar() {
  return data;
}

export function addNote(date, text) {
  const note = { id: uuid(), text: String(text || "").slice(0, 500), ts: Date.now() };
  if (!data.notes[date]) data.notes[date] = [];
  data.notes[date].push(note);
  save();
  return note;
}

export function deleteNote(date, id) {
  if (!data.notes[date]) return false;
  const before = data.notes[date].length;
  data.notes[date] = data.notes[date].filter((n) => n.id !== id);
  if (data.notes[date].length === 0) delete data.notes[date];
  save();
  return data.notes[date]?.length !== before;
}

export function addAlarm({ date, time, label }) {
  const alarm = { id: uuid(), date, time: String(time || "09:00"), label: String(label || "").slice(0, 100), ts: Date.now() };
  data.alarms.push(alarm);
  save();
  return alarm;
}

export function deleteAlarm(id) {
  const before = data.alarms.length;
  data.alarms = data.alarms.filter((a) => a.id !== id);
  save();
  return data.alarms.length !== before;
}
