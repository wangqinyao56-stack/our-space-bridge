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

export function proposeDate({ text, proposedBy, scheduledDate = null, scheduledTime = null, sceneId = null }) {
  const id = `date_${Date.now()}`;
  const now = new Date().toISOString();
  const today = dateKey();

  // If scheduled for today, activate immediately
  const isToday = scheduledDate === today || !scheduledDate;
  const status = isToday ? "active" : "pending";

  const plan = {
    id,
    text,
    proposedBy,
    proposedAt: now,
    scheduledDate: scheduledDate || today,
    scheduledTime: scheduledTime || null,
    status,
    sceneId,
    completedAt: null,
  };

  plans.push(plan);
  save();

  if (isToday) {
    console.log(`[date-plans] ${proposedBy} proposed date TODAY: "${text}" → active (scene: ${sceneId || "none"})`);
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

// ── Scene detection for dating_invite ──

const SCENE_PATTERNS = [
  { sceneId: "cafe",    keywords: /咖啡|茶|奶茶|饮料|甜点|蛋糕|果汁|饮品|星巴克|瑞幸|喜茶|奈雪|蜜雪|冰美式|拿铁|抹茶|咖啡馆/ },
  { sceneId: "park",    keywords: /公园|散步|遛弯|走走|逛逛|跑步|晨练|草坪|长椅|花园|植物|花|樱花|银杏|树林/ },
  { sceneId: "cinema",  keywords: /电影|影院|电影院|放映|看片|大片|上映|IMAX|巨幕|恐怖片|爱情片|喜剧片|动作片|动画片/ },
  { sceneId: "beach",   keywords: /海边|沙滩|看海|海风|浪花|贝壳|捡贝|日落|夕阳|潮水|海鸥|海岸/ },
  { sceneId: "garden",  keywords: /花园|花海|赏花|花展|植物园/ },
  { sceneId: "snow_mountain", keywords: /雪山|滑雪|雪景|赏雪|雪地/ },
  { sceneId: "aquarium", keywords: /水族馆|海洋馆|看鱼|海豚|鲨鱼|水母|鲸鱼/ },
  { sceneId: "cemetery", keywords: /墓园|扫墓|祭拜|上坟|清明/ },
  { sceneId: "night_festival", keywords: /庙会|灯会|夜市|灯笼|烟花|小吃街|逛庙会/ },
  { sceneId: "shopping_day", keywords: /逛街|购物|商场|买衣服|逛gai|逛商场|买东西/ },
  { sceneId: "subway",  keywords: /地铁|坐车|乘车|去.*地方|下一站/ },
  { sceneId: "cafe",    keywords: /便利店|超市|买菜|菜市场|小吃|吃饭/ },
];

export function detectSceneId(text) {
  if (!text || typeof text !== "string") return null;
  for (const { sceneId, keywords } of SCENE_PATTERNS) {
    if (keywords.test(text)) {
      console.log(`[date-plans] Detected scene: ${sceneId} from "${text.slice(0, 60)}..."`);
      return sceneId;
    }
  }
  return null; // no specific scene → app shows scene selection
}

export function detectDateProposal(reply, from = "xiayan") {
  if (!reply || typeof reply !== "string") return null;

  for (const { pattern, confidence, from: restrictFrom } of DATE_PROPOSAL_PATTERNS) {
    if (restrictFrom && restrictFrom !== from) continue;
    if (pattern.test(reply)) {
      const scheduledDate = parseDateFromText(reply);
      const sceneId = detectSceneId(reply);
      console.log(`[date-plans] Detected proposal (confidence: ${confidence}, scene: ${sceneId || "none"}): "${reply.slice(0, 80)}..."`);
      return {
        text: reply.slice(0, 100).replace(/\n/g, " ").trim(),
        proposedBy: from,
        scheduledDate,
        confidence,
        sceneId,
      };
    }
  }
  return null;
}
