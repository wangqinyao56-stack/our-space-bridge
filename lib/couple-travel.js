/**
 * Couple Travel State Machine — 情侣一起旅行的状态管理
 *
 * Phases: idle → traveling → completed
 * - 旅馆是基地（始终可用）
 * - 白天(6-18点)可去目的地探索，夜晚(18-6点)回旅馆
 * - 古风小镇(ancient_town)和雪山(snow_mountain)互斥
 * - 旅行持续2-3天，跨午夜自动推进天数
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const STATE_FILE = path.join(DATA_DIR, "couple-travel-state.json");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── 可用的旅行目的地（互斥组）──
const DESTINATION_GROUPS = [
  ["ancient_town", "snow_mountain"], // 古风小镇 vs 雪山 → 二选一
];
const ALL_DESTINATIONS = ["ancient_town", "snow_mountain", "camping", "beach", "garden"];

const DEFAULT_STATE = {
  tripId: "",
  phase: "idle",           // idle | traveling | completed
  destinations: [],
  checkInTime: null,
  currentDay: 1,
  createdAt: null,
};

let state = { ...DEFAULT_STATE };

// ── 启动加载 ──
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) };
      console.log(`[couple-travel] Loaded: phase=${state.phase} day=${state.currentDay} dests=${state.destinations.join(",") || "—"}`);
    }
  } catch (e) {
    console.warn("[couple-travel] Load error:", e.message);
  }
}

function save() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

load();

// ── 北京时间 ──
function getBeijingHour() {
  return new Date(new Date().getTime() + 8 * 3600000).getUTCHours();
}

function getBeijingDate() {
  const bj = new Date(new Date().getTime() + 8 * 3600000);
  return `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`;
}

// ── 时段计算 ──
export type TimeOfDay = "morning" | "afternoon" | "night";

export function getTimeOfDay(): TimeOfDay {
  const h = getBeijingHour();
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 18) return "afternoon";
  return "night";
}

// ── 互斥检查 ──
function validateDestinations(dests) {
  for (const group of DESTINATION_GROUPS) {
    const picked = dests.filter((d) => group.includes(d));
    if (picked.length > 1) {
      throw new Error(`互斥目的地不能同时选择：${picked.join(" + ")}，只能选一个（${group.join(" / ")}）`);
    }
  }
  // Filter to known destinations
  return dests.filter((d) => ALL_DESTINATIONS.includes(d));
}

// ── 导出 ──

export function isCoupleTraveling() {
  return state.phase === "traveling";
}

export function getCoupleTravelState() {
  return { ...state };
}

export function getDayContext() {
  if (!isCoupleTraveling()) return null;
  const tod = getTimeOfDay();
  const labels = { morning: "上午", afternoon: "下午", night: "夜晚" };
  return `第${state.currentDay}天 · ${labels[tod]}`;
}

/** Create a new trip. Enforces ancient_town/snow_mountain mutual exclusion. */
export function createTrip(opts = {}) {
  const destinations = validateDestinations(opts.destinations || []);
  if (destinations.length === 0) {
    // Default: just hotel — no extra destination
  }

  state = {
    tripId: `trip_${Date.now()}`,
    phase: "traveling",      // 直接开始（未来可加 planned 阶段）
    destinations,
    checkInTime: new Date().toISOString(),
    currentDay: 1,
    createdAt: new Date().toISOString(),
  };
  save();
  console.log(`[couple-travel] Trip created: dests=${destinations.join(",") || "hotel-only"} day=${state.currentDay}`);
  return state;
}

export function checkIn() {
  if (state.phase !== "traveling") {
    const result = createTrip({ destinations: state.destinations });
    return result;
  }
  return state;
}

export function checkOut() {
  state.phase = "completed";
  save();
  console.log("[couple-travel] Checked out");
  return state;
}

/** Auto-advance day if Beijing date has changed since last check. */
export function maybeAutoAdvanceDay() {
  if (!isCoupleTraveling() || !state.checkInTime) return false;

  const checkInDate = new Date(state.checkInTime);
  const now = new Date();
  // Days since check-in (based on Beijing date)
  const checkInBJ = new Date(checkInDate.getTime() + 8 * 3600000);
  const nowBJ = new Date(now.getTime() + 8 * 3600000);

  // Calculate day difference based on actual date change in Beijing
  const checkInDayStart = new Date(Date.UTC(checkInBJ.getUTCFullYear(), checkInBJ.getUTCMonth(), checkInBJ.getUTCDate()));
  const nowDayStart = new Date(Date.UTC(nowBJ.getUTCFullYear(), nowBJ.getUTCMonth(), nowBJ.getUTCDate()));
  const dayDiff = Math.floor((nowDayStart.getTime() - checkInDayStart.getTime()) / 86400000);
  const newDay = dayDiff + 1;

  if (newDay > state.currentDay && newDay <= 3) {
    state.currentDay = newDay;
    save();
    console.log(`[couple-travel] Day advanced: ${state.currentDay - 1} → ${state.currentDay}`);
    return true;
  }
  // Auto-complete after day 3
  if (newDay > 3 && state.currentDay >= 3) {
    console.log("[couple-travel] Trip exceeded 3 days, auto-completing");
    checkOut();
    return true;
  }
  return false;
}

/** Get available scene IDs for the current time of day and destinations. */
export function getAvailableScenes(timeOfDay = getTimeOfDay(), destinations = state.destinations) {
  const scenes = new Set();

  // Hotel is always available during travel
  scenes.add("hotel");

  switch (timeOfDay) {
    case "morning":
      // Morning: hotel + light destination stroll
      if (destinations.length > 0) {
        destinations.forEach((d) => scenes.add(d));
      }
      break;
    case "afternoon":
      // Afternoon: main exploration time for destinations
      if (destinations.length > 0) {
        destinations.forEach((d) => scenes.add(d));
      }
      // Additional afternoon scenes
      scenes.add("cafe");
      scenes.add("park");
      break;
    case "night":
      // Night: hotel intimacy + night-specific destinations
      if (destinations.includes("ancient_town")) scenes.add("night_festival");
      break;
  }

  return Array.from(scenes);
}

/** Generate context string for injecting into AI system prompt. */
export function getCoupleTravelContext() {
  if (!isCoupleTraveling()) return "";

  const tod = getTimeOfDay();
  const timeLabels = { morning: "上午", afternoon: "下午", night: "夜晚" };
  const day = state.currentDay;
  const dests = state.destinations;

  let ctx = `\n【情侣旅行中】你们正在一起旅行。今天是第${day}天，现在是${timeLabels[tod]}。你们住在旅馆，旅馆是你们的基地。`;

  if (tod === "morning") {
    ctx += `\n现在是上午时光。旅馆的早餐、晨间散步、轻松的活动比较合适。如果要去${dests.length > 0 ? "目的地" : "其他地方"}，也是悠闲的节奏。`;
  } else if (tod === "afternoon") {
    ctx += `\n现在是下午，一天中最好的探索时间。${dests.length > 0 ? `你们可以去${dests.map(d => destinationLabel(d)).join("、")}好好玩。` : "可以出去走走逛逛。"}`;
  } else {
    ctx += `\n夜色已深，你们回到了旅馆。这是属于两个人的私密时光。`;
  }

  if (dests.length > 0 && dests.includes("ancient_town")) {
    ctx += `\n你们这次旅行去了古风小镇——青石板路、石桥流水、老房子和旧店铺。`;
  } else if (dests.length > 0 && dests.includes("snow_mountain")) {
    ctx += `\n你们这次旅行去了雪山——缆车、白雪、山顶的热可可和冷冽的空气。`;
  }

  if (day === 1) {
    ctx += `\n今天是旅行的第一天，刚安顿下来，一切都新鲜。`;
  } else if (day === 2) {
    ctx += `\n今天是旅行的第二天，已经熟悉了这里的节奏。`;
  } else if (day >= 3) {
    ctx += `\n今天是旅行的最后一天，快要退房回去了。珍惜最后的时光。`;
  }

  return ctx;
}

function destinationLabel(dest) {
  const map = {
    ancient_town: "古风小镇",
    snow_mountain: "雪山",
    camping: "露营地",
    beach: "海边",
    garden: "花园",
  };
  return map[dest] || dest;
}

/** Check if two destinations are mutually exclusive. */
export function areDestinationsExclusive(a, b) {
  for (const group of DESTINATION_GROUPS) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}
