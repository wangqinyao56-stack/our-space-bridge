/**
 * Period tracking for our-space bridge.
 * 夏彦 tracks 华生's period cycle and provides care.
 */

import fs from "node:fs";
import path from "node:path";

const DATA_FILE = "./period-data.json";
const AVG_CYCLE = 28; // default cycle length
const AVG_DURATION = 5; // default period duration

let state = {
  cycleHistory: [],     // [{ start: "2026-05-01", end: "2026-05-05", duration: 5 }]
  currentStart: null,   // "2026-05-28" or null
  avgCycle: AVG_CYCLE,
  avgDuration: AVG_DURATION,
};

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) };
    }
  } catch {}
}
load();

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateDiff(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export function startPeriod(dateStr) {
  const date = dateStr || today();
  if (state.currentStart) {
    // Already in period, ignore
    return { ...state, day: dateDiff(state.currentStart, today()) + 1 };
  }
  state.currentStart = date;
  save();
  return { ...state, day: 1 };
}

export function endPeriod(dateStr) {
  const date = dateStr || today();
  if (!state.currentStart) return state;
  const duration = dateDiff(state.currentStart, today()) + 1;
  state.cycleHistory.push({
    start: state.currentStart,
    end: date,
    duration: Math.max(1, duration),
  });
  // Update averages
  if (state.cycleHistory.length >= 2) {
    const durations = state.cycleHistory.map((c) => c.duration);
    state.avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    // Calculate avg cycle from gaps between starts
    const starts = [...state.cycleHistory.map((c) => c.start), state.currentStart].sort();
    if (starts.length >= 2) {
      let totalGap = 0;
      for (let i = 1; i < starts.length; i++) {
        totalGap += dateDiff(starts[i - 1], starts[i]);
      }
      state.avgCycle = Math.round(totalGap / (starts.length - 1));
    }
  }
  state.currentStart = null;
  save();
  return state;
}

export function getPeriodState() {
  return { ...state, today: today() };
}

export function getPeriodContext() {
  if (!state.currentStart) return null;

  const day = dateDiff(state.currentStart, today()) + 1;
  const predictedEnd = new Date(state.currentStart);
  predictedEnd.setDate(predictedEnd.getDate() + state.avgDuration);

  const now = new Date();
  const isOverdue = now > predictedEnd;

  let context = `\n【生理期状态】\n华生正在生理期第 ${day} 天。`;
  context += `\n平均持续 ${state.avgDuration} 天，预测结束日期：${predictedEnd.toISOString().slice(0, 10)}。`;

  if (isOverdue) {
    context += `\n⚠ 已超过预测结束日期。可以温柔地问她生理期是否结束了。`;
  }

  context += `\n💊 照顾提醒：`;
  if (day <= 2) {
    context += `经期前两天是最不舒服的时候——多关心她的身体感受，提醒保暖（肚子和脚），可以主动提出帮她揉揉肚子。避免让她碰冷水、喝冰的。`;
  } else if (day <= 4) {
    context += `经期中间几天——量多注意提醒勤换，多休息。可以聊些轻松的话题转移注意力。提醒喝红糖姜茶、用暖宝宝。`;
  } else {
    context += `经期末尾——身体逐渐恢复但可能还会有点累。可以聊聊经期结束后想一起做什么。提醒她补充营养（红枣、红糖、热牛奶）。${isOverdue ? "记得问她生理期是不是结束了~" : ""}`;
  }

  return context;
}

export function getNextPredicted() {
  if (state.cycleHistory.length === 0) return null;
  const lastStart = state.currentStart || state.cycleHistory[state.cycleHistory.length - 1].start;
  const next = new Date(lastStart);
  next.setDate(next.getDate() + state.avgCycle);
  return next.toISOString().slice(0, 10);
}
