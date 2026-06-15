/**
 * Date plan manager — tracks约会邀约 from chat
 * Both 夏彦 and 华生 can propose dates.
 * Scheduled dates are stored and auto-activate on the scheduled day.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "date-plans.json");

let plans = [];

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    plans = JSON.parse(raw);
  } catch {
    plans = [];
  }
}

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(plans, null, 2));
  } catch (e) {
    console.error("[date-plans] Save error:", e.message);
  }
}

load();

// ── Public API ──

export function getAll() {
  return [...plans];
}

export function getActive() {
  const today = dateKey();
  return plans.find((p) => p.status === "active" && p.scheduledDate === today) || null;
}

export function getPending() {
  return plans.filter((p) => p.status === "pending");
}

export function getHistory() {
  return plans
    .filter((p) => p.status === "completed")
    .sort((a, b) => (b.completedAt || b.scheduledDate || "").localeCompare(a.completedAt || a.scheduledDate || ""));
}

export function getById(id) {
  return plans.find((p) => p.id === id) || null;
}

export function proposeDate({ text, proposedBy, scheduledDate = null, scheduledTime = null }) {
  const id = `date_${Date.now()}`;
  const now = new Date().toISOString();
  const today = dateKey();

  // If scheduled for today, activate immediately
  const isToday = scheduledDate === today;
  const status = isToday ? "active" : "pending";

  const plan = {
    id,
    text,
    proposedBy,
    proposedAt: now,
    scheduledDate: scheduledDate || today, // null → today
    scheduledTime: scheduledTime || null,
    status,
    completedAt: null,
  };

  plans.push(plan);
  save();

  if (isToday) {
    console.log(`[date-plans] ${proposedBy} proposed date TODAY: "${text}" → active`);
  } else {
    console.log(`[date-plans] ${proposedBy} proposed date on ${scheduledDate}: "${text}" → pending`);
  }

  return plan;
}

export function activateDate(id) {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return null;
  plan.status = "active";
  save();
  console.log(`[date-plans] Activated: "${plan.text}"`);
  return plan;
}

export function completeDate(id) {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return null;
  plan.status = "completed";
  plan.completedAt = new Date().toISOString();
  save();
  console.log(`[date-plans] Completed: "${plan.text}"`);
  return plan;
}

export function cancelDate(id) {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return null;
  plan.status = "cancelled";
  save();
  console.log(`[date-plans] Cancelled: "${plan.text}"`);
  return plan;
}

// ── Auto-check: activate pending dates that are due today ──
export function checkTodayDates() {
  const today = dateKey();
  let activated = [];
  for (const p of plans) {
    if (p.status === "pending" && p.scheduledDate === today) {
      p.status = "active";
      activated.push(p);
      console.log(`[date-plans] Auto-activated: "${p.text}" (scheduled for today)`);
    }
  }
  if (activated.length > 0) save();
  return activated;
}

// ── Date detection in chat replies ──

const DATE_PROPOSAL_PATTERNS = [
  // 夏彦 proposing a date
  { pattern: /星期([一二三四五六日天]|日)带你去|周([一二三四五六日天]|日)(?:我[们俩]|[咱们]|[咱俩])?(?:一起)?去/, confidence: 0.9 },
  { pattern: /星期([一二三四五六日天]|日)(?:请|带|和)你吃/, confidence: 0.9 },
  { pattern: /周([一二三四五六日天]|日)(?:请|带|和)你吃/, confidence: 0.9 },
  { pattern: /(?:明天|后天|大后天)(?:带|和|陪)你去/, confidence: 0.85 },
  { pattern: /这个周末(?:带|和|陪)你去/, confidence: 0.85 },
  { pattern: /下次(?:带|和|陪)你去/, confidence: 0.6 },
  { pattern: /等我回来(?:带|和|陪)你去/, confidence: 0.7 },
  { pattern: /走吧.*(?:去|吃|逛)/, confidence: 0.8 },
  { pattern: /(?:现在|走)(?:吧)?.*(?:出门|出去)吃/, confidence: 0.8 },
  { pattern: /(?:一起|我们)(?:去|吃|逛)(?:个?|一下)(?:超市|便利店|菜市场)/, confidence: 0.75 },
  { pattern: /走吧.*超市|去趟超市|去个超市/, confidence: 0.8 },
  { pattern: /(?:带|陪)你去(?:逛逛|走走|散步)/, confidence: 0.7 },
  // 华生 proposing
  { pattern: /(?:我想|我们)(?:去|吃|逛)/, confidence: 0.6, from: "me" },
];

function dateKey(d = new Date()) {
  // Beijing time
  const bj = new Date(d.getTime() + 8 * 3600000);
  return bj.toISOString().slice(0, 10);
}

function parseDateFromText(text) {
  const today = new Date();
  const bjToday = new Date(today.getTime() + 8 * 3600000);

  // "明天" → tomorrow
  if (/明天/.test(text)) {
    const d = new Date(bjToday);
    d.setDate(d.getDate() + 1);
    return dateKey(d);
  }
  // "后天"
  if (/后天/.test(text)) {
    const d = new Date(bjToday);
    d.setDate(d.getDate() + 2);
    return dateKey(d);
  }
  // "大后天"
  if (/大后天/.test(text)) {
    const d = new Date(bjToday);
    d.setDate(d.getDate() + 3);
    return dateKey(d);
  }
  // "星期X" or "周X"
  const weekMatch = text.match(/星期([一二三四五六日天])/) || text.match(/周([一二三四五六日天])/);
  if (weekMatch) {
    const dayMap = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
    const targetDay = dayMap[weekMatch[1]];
    if (targetDay !== undefined) {
      const currentDay = bjToday.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // next week
      const d = new Date(bjToday);
      d.setDate(d.getDate() + daysUntil);
      return dateKey(d);
    }
  }
  // "周末"
  if (/周末/.test(text)) {
    const currentDay = bjToday.getDay();
    let daysUntil = 6 - currentDay; // Saturday
    if (daysUntil <= 0) daysUntil += 7;
    const d = new Date(bjToday);
    d.setDate(d.getDate() + daysUntil);
    return dateKey(d);
  }
  // "下次""等我回来" → no specific date
  if (/下次|等我回来/.test(text)) {
    return null; // can't determine date
  }
  // "现在""走吧""出门" → today
  if (/现在|走吧|出门|去趟|去个|逛逛/.test(text)) {
    return dateKey();
  }
  return null;
}

export function detectDateProposal(reply, from = "xiayan") {
  if (!reply || typeof reply !== "string") return null;

  for (const { pattern, confidence, from: restrictFrom } of DATE_PROPOSAL_PATTERNS) {
    if (restrictFrom && restrictFrom !== from) continue;
    if (pattern.test(reply)) {
      const scheduledDate = parseDateFromText(reply);
      console.log(`[date-plans] Detected proposal (confidence: ${confidence}): "${reply.slice(0, 80)}..."`);
      return {
        text: reply.slice(0, 100).replace(/\n/g, " ").trim(),
        proposedBy: from,
        scheduledDate,
        confidence,
      };
    }
  }
  return null;
}
