/**
 * Device data tracking — 接收华生手机上的设备数据（步数等），
 * 注入到夏彦的聊天上下文中让他能自然关心。
 */

import fs from "node:fs";

const DATA_FILE = "./device-data.json";

let state = {
  steps: {
    today: 0,           // today's step count
    date: "",           // date of "today"
    history: [],        // [{ date, steps }]
  },
  lastUpdateTime: 0,
};

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      state = { ...state, ...saved, steps: { ...state.steps, ...saved.steps } };
    }
  } catch {}
}
load();

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function chinaDateStr() {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${china.getUTCFullYear()}-${String(china.getUTCMonth() + 1).padStart(2, "0")}-${String(china.getUTCDate()).padStart(2, "0")}`;
}

// ── Public API ──

export function updateSteps(steps, dateStr) {
  const date = dateStr || chinaDateStr();
  const today = chinaDateStr();

  state.lastUpdateTime = Date.now();

  // Update today's steps
  if (date === today) {
    state.steps.today = steps;
    state.steps.date = today;
  }

  // Update or add to history
  const existing = state.steps.history.find((h) => h.date === date);
  if (existing) {
    existing.steps = Math.max(existing.steps, steps);
  } else {
    state.steps.history.push({ date, steps });
  }

  // Keep last 30 days
  if (state.steps.history.length > 30) {
    state.steps.history = state.steps.history.slice(-30);
  }

  save();
  console.log(`[device] Steps updated: ${steps} (${date})`);
}

export function getStepContext() {
  const today = chinaDateStr();
  const todaySteps = state.steps.date === today ? state.steps.today : 0;

  // Get yesterday's steps for comparison
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const yesterdayEntry = state.steps.history.find((h) => h.date === yesterdayStr);

  let context = "";
  if (todaySteps > 0) {
    context = `\n【华生的设备数据】\n今日步数：${todaySteps.toLocaleString()} 步`;

    if (todaySteps < 2000) {
      context += `\n步数偏少——华生今天可能在家休息或者工作太忙没怎么动。`;
    } else if (todaySteps < 6000) {
      context += `\n步数适中——日常活动量正常。`;
    } else if (todaySteps < 12000) {
      context += `\n步数不错——华生今天活动量充足，可以夸夸她。`;
    } else {
      context += `\n步数很多——华生今天走了不少路，可以关心她累不累、提醒她好好休息。`;
    }

    if (yesterdayEntry) {
      const diff = todaySteps - yesterdayEntry.steps;
      if (Math.abs(diff) > 3000) {
        context += `\n相比昨天（${yesterdayEntry.steps.toLocaleString()}步）${diff > 0 ? "多了很多" : "少了很多"}。`;
      }
    }
  }

  return context;
}

export function getDeviceState() {
  return {
    ...state,
    today: chinaDateStr(),
  };
}
