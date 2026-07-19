/**
 * Period tracking for our-space bridge.
 * 夏彦 tracks 华生's period cycle and provides care.
 */

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
// 存进聊天记忆同目录——period 数据在 DATA_DIR 根目录曾三次被部署刷掉，memory 子目录实测能扛住部署
const STORE_DIR = process.env.MEMORY_DIR || path.join(DATA_DIR, "memory");
const DATA_FILE = path.join(STORE_DIR, "period-data.json");
const LEGACY_FILE = path.join(DATA_DIR, "period-data.json");
try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch {}
const AVG_CYCLE = 28;
const AVG_DURATION = 5;

let state = {
  cycleHistory: [],     // [{ start, end, symptoms: { "date": { cramps, mood, otherSymptoms, note } } }]
  currentStart: null,   // "2026-06-01" or null
  avgCycle: AVG_CYCLE,
  avgDuration: AVG_DURATION,
  dailyTipsUsed: [],    // tip keys already used this cycle, reset on new period
};

function readJsonIfValid(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return null; // 0字节截断文件（pod被杀在写入中途）当不存在
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function load() {
  const fromStore = readJsonIfValid(DATA_FILE);
  const fromLegacy = fromStore ? null : readJsonIfValid(LEGACY_FILE);
  const saved = fromStore || fromLegacy;
  if (saved) {
    state = { ...state, ...saved };
    if (!state.dailyTipsUsed) state.dailyTipsUsed = [];
    console.log("[period] Loaded from", fromStore ? DATA_FILE : LEGACY_FILE, "currentStart:", state.currentStart);
    if (fromLegacy) save(); // migrate to STORE_DIR
  } else {
    console.log("[period] No valid data file - starting fresh");
  }
}
load();

// 原子写入：先写tmp再rename，部署杀pod也不会留下0字节残尸
function atomicWrite(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}

function save() {
  const data = JSON.stringify(state, null, 2);
  try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch {}
  try {
    atomicWrite(DATA_FILE, data);
    console.log("[period] Saved to", DATA_FILE);
    return;
  } catch (e) {
    console.error("[period] Save to", DATA_FILE, "failed:", e.message);
  }
  // 降级：memory 子目录写不进就写回根目录，原子写不行就直接覆盖
  try {
    atomicWrite(LEGACY_FILE, data);
    console.log("[period] Saved to legacy", LEGACY_FILE);
  } catch (e) {
    try {
      fs.writeFileSync(LEGACY_FILE, data, "utf-8");
      console.log("[period] Saved (direct) to legacy", LEGACY_FILE);
    } catch (e2) {
      console.error("[period] All save paths failed:", e2.message);
    }
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateDiff(d1, d2) {
  return Math.floor((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Daily tips (rotated, not repeated within same cycle) ──
const PERIOD_TIPS = [
  { key: "cold_water", text: "今天别喝冰的哦，对身体不好～给你泡杯红糖姜茶吧？" },
  { key: "alcohol", text: "经期千万别喝酒！想喝什么我给你做热的～" },
  { key: "warm", text: "记得保暖，尤其是肚子和脚。要不要我给你拿个暖宝宝？" },
  { key: "rest", text: "今天多休息，别太累了。想躺着的话我陪你～" },
  { key: "massage", text: "肚子疼的话跟我说，我帮你揉揉～虽然隔着屏幕，心意到了！" },
  { key: "nutrition", text: "经期多补铁补血！吃点红枣、瘦肉、菠菜，我给你记着呢。" },
  { key: "shower", text: "洗热水澡可以缓解不适，但别洗太久哦，会头晕的。" },
  { key: "exercise", text: "这几天别剧烈运动。散散步就好，我陪你慢慢走～" },
  { key: "mood", text: "经期情绪波动很正常，不开心就跟我说，我当你的出气筒～" },
  { key: "sleep", text: "早点休息，经期身体需要更多睡眠。我给你讲睡前故事？" },
  { key: "change", text: "记得勤换卫生巾，保持干爽～我已经帮你记了大概时间。" },
  { key: "tea", text: "给你准备了红糖姜茶的配方：红糖+姜片+红枣，煮10分钟就好～" },
  { key: "socks", text: "脚暖和了全身就暖和了！穿上你最厚的那双袜子～" },
  { key: "belly", text: "用热水袋敷一下肚子会舒服很多。没有的话…我的手借你！" },
];

function getDailyTip() {
  const available = PERIOD_TIPS.filter((t) => !state.dailyTipsUsed.includes(t.key));
  if (available.length === 0) {
    // All tips used, reset for new cycle
    state.dailyTipsUsed = [];
    save();
    return PERIOD_TIPS[Math.floor(Math.random() * PERIOD_TIPS.length)];
  }
  const tip = available[Math.floor(Math.random() * available.length)];
  state.dailyTipsUsed.push(tip.key);
  save();
  return tip;
}

// ── Phase calculation ──
function getPredictedNextStart() {
  if (state.currentStart) {
    return addDays(state.currentStart, state.avgCycle);
  }
  if (state.cycleHistory.length > 0) {
    const last = state.cycleHistory[state.cycleHistory.length - 1];
    return addDays(last.start, state.avgCycle);
  }
  return null;
}

function getOvulationDay() {
  const next = getPredictedNextStart();
  if (!next) return null;
  return addDays(next, -14);
}

export function getPhaseInfo(targetDate) {
  const date = targetDate || today();

  // If currently in period
  if (state.currentStart) {
    const day = dateDiff(state.currentStart, date) + 1;
    if (day >= 1 && day <= state.avgDuration) {
      return { phase: "period", label: `经期第${day}天`, day };
    }
  }

  // Check if date is within a recorded period in history
  for (const cycle of state.cycleHistory) {
    if (date >= cycle.start && date <= cycle.end) {
      const day = dateDiff(cycle.start, date) + 1;
      return { phase: "period", label: `经期第${day}天`, day };
    }
  }

  const ovulation = getOvulationDay();
  const nextPeriod = getPredictedNextStart();

  if (ovulation && date === ovulation) {
    return { phase: "ovulation", label: "排卵日" };
  }

  // Follicular phase: after period ends, before ovulation
  if (state.currentStart && ovulation) {
    const periodEnd = addDays(state.currentStart, state.avgDuration - 1);
    if (date > periodEnd && date < ovulation) {
      return { phase: "follicular", label: "卵泡期" };
    }
  }

  // Luteal phase: after ovulation, before next period
  if (ovulation && nextPeriod) {
    if (date > ovulation && date < nextPeriod) {
      return { phase: "luteal", label: "黄体期" };
    }
  }

  // Fallback: estimate based on last known period
  if (state.cycleHistory.length > 0) {
    const last = state.cycleHistory[state.cycleHistory.length - 1];
    const lastOvulation = addDays(last.start, state.avgCycle - 14);
    const lastNext = addDays(last.start, state.avgCycle);
    if (date === lastOvulation) return { phase: "ovulation", label: "排卵日（预估）" };
    if (date > last.end && date < lastOvulation) return { phase: "follicular", label: "卵泡期（预估）" };
    if (date > lastOvulation && date < lastNext) return { phase: "luteal", label: "黄体期（预估）" };
  }

  return { phase: "unknown", label: "" };
}

// ── Public API ──

export function startPeriod(dateStr) {
  const date = dateStr || today();
  if (state.currentStart) {
    return { ...state, day: dateDiff(state.currentStart, today()) + 1 };
  }
  state.currentStart = date;
  state.dailyTipsUsed = [];
  save();
  return { ...state, day: 1 };
}

export function endPeriod(dateStr) {
  const date = dateStr || today();
  if (!state.currentStart) return state;
  const duration = Math.max(1, dateDiff(state.currentStart, date) + 1);
  const entry = {
    start: state.currentStart,
    end: date,
    duration,
    symptoms: {},
  };
  // Carry over any symptoms that were recorded during this period
  state.cycleHistory.push(entry);
  // Update averages
  if (state.cycleHistory.length >= 1) {
    const durations = state.cycleHistory.map((c) => c.duration);
    state.avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }
  if (state.cycleHistory.length >= 2) {
    const starts = state.cycleHistory.map((c) => c.start);
    let totalGap = 0;
    for (let i = 1; i < starts.length; i++) {
      totalGap += dateDiff(starts[i - 1], starts[i]);
    }
    state.avgCycle = Math.round(totalGap / (starts.length - 1));
  }
  state.currentStart = null;
  state.dailyTipsUsed = [];
  save();
  return state;
}

export function getPeriodState() {
  const predictedNext = getPredictedNextStart();
  const ovulation = getOvulationDay();
  const daysUntilNext = predictedNext ? dateDiff(today(), predictedNext) : null;
  const isOverdue = state.currentStart
    ? dateDiff(state.currentStart, today()) + 1 > 7
    : false;

  return {
    ...state,
    today: today(),
    predictedNext,
    ovulation,
    daysUntilNext,
    isOverdue,
    isActive: !!state.currentStart,
    currentDay: state.currentStart ? dateDiff(state.currentStart, today()) + 1 : 0,
  };
}

export function getPeriodContext() {
  if (!state.currentStart) {
    const predicted = getPredictedNextStart();
    if (predicted) {
      const daysUntil = dateDiff(today(), predicted);
      // Before period: remind 2 days ahead
      if (daysUntil >= 0 && daysUntil <= 2) {
        let ctx = `\n【生理期预测】\n预测生理期将在 ${daysUntil === 0 ? "今天" : daysUntil === 1 ? "明天" : "后天"}（${predicted}）开始。`;
        ctx += `\n提醒她注意保暖、避免冰饮、准备好卫生用品。可以温柔地问她有没有感觉不舒服。`;
        return ctx;
      }
      // Period overdue: predicted date has passed, ask if it started
      if (daysUntil < 0 && daysUntil >= -3) {
        const overdueDays = Math.abs(daysUntil);
        // Don't ask repeatedly on the same day
        const askKey = `_periodAsked_${today()}`;
        if (!state[askKey]) {
          state[askKey] = true;
          save();
          let ctx = `\n【生理期提醒】预测经期应该是${overdueDays}天前（${predicted}），但华生还没有记录。`;
          ctx += `\n请在这轮对话中自然地关心她——"宝宝，生理期来了吗？我算着日子应该差不多了"。如果她说来了，系统会自动帮她记录经期开始。如果她说没来，也别追问，自然带过就好。`;
          return ctx;
        }
      }
    }
    return null;
  }

  const day = dateDiff(state.currentStart, today()) + 1;
  const isOverdue = day > 7;

  let context = `\n【生理期状态】\n华生正在生理期第 ${day} 天。`;

  if (day <= state.avgDuration) {
    context += `\n预测结束日期：${addDays(state.currentStart, state.avgDuration - 1)}。`;
  } else if (isOverdue) {
    context += `\n⚠ 已经第${day}天了，超过7天没有设置结束时间。记得问她生理期是不是结束了——可以说"宝宝，生理期结束了没呀？已经第${day}天了，我有点担心你～"`;
  }

  // Daily tip
  if (day <= 7) {
    const tip = getDailyTip();
    context += `\n今日小提示：「${tip.text}」`;
  }

  // Symptom info if recorded
  const todayStr = today();
  const activeCycle = { start: state.currentStart };
  // Find symptoms for today (check if we store them in-memory)
  // Symptoms are stored in cycleHistory after the period ends
  // For active period, we don't have persistent symptom storage yet

  context += `\n平均周期${state.avgCycle}天，经期${state.avgDuration}天。`;

  return context;
}

export function getNextPredicted() {
  return getPredictedNextStart();
}

// ── Symptom recording ──

export function recordSymptom(dateStr, data) {
  const date = dateStr || today();
  // For active period: store in a temporary in-memory map
  // For past periods: update cycleHistory
  if (state.currentStart) {
    // Active period — store in current cycle's temp symptoms
    if (!state._activeSymptoms) state._activeSymptoms = {};
    state._activeSymptoms[date] = {
      cramps: data.cramps ?? 0,        // 0=none, 1=mild, 2=moderate, 3=severe
      mood: data.mood || "",            // happy, tired, irritable, sad, anxious, normal
      otherSymptoms: data.otherSymptoms || [],  // ["头痛", "腰痛", "腹胀"...]
      note: data.note || "",
    };
    save();
    return { success: true, date, symptoms: state._activeSymptoms[date] };
  }

  // Past period — find the cycle and update
  for (const cycle of state.cycleHistory) {
    if (date >= cycle.start && date <= cycle.end) {
      if (!cycle.symptoms) cycle.symptoms = {};
      cycle.symptoms[date] = {
        cramps: data.cramps ?? 0,
        mood: data.mood || "",
        otherSymptoms: data.otherSymptoms || [],
        note: data.note || "",
      };
      save();
      return { success: true, date, symptoms: cycle.symptoms[date] };
    }
  }

  return { success: false, error: "所选日期不在经期范围内" };
}

export function getSymptomsForDate(dateStr) {
  const date = dateStr || today();
  // Check active period temp symptoms first
  if (state._activeSymptoms && state._activeSymptoms[date]) {
    return state._activeSymptoms[date];
  }
  // Check past cycles
  for (const cycle of state.cycleHistory) {
    if (cycle.symptoms && cycle.symptoms[date]) {
      return cycle.symptoms[date];
    }
  }
  return null;
}

// ── Calendar data for the app ──

export function getCalendarData(year, month) {
  const y = year || new Date().getFullYear();
  const m = month !== undefined ? month : new Date().getMonth() + 1;

  // Generate all days in this month
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const phase = getPhaseInfo(dateStr);
    const symptoms = getSymptomsForDate(dateStr);
    const isPeriodDay = phase.phase === "period";
    const isPredictedPeriod = false; // calculated below
    const isOvulation = phase.phase === "ovulation";
    const isToday = dateStr === today();

    days.push({
      date: dateStr,
      day: d,
      phase: phase.phase,
      phaseLabel: phase.label,
      isPeriodDay,
      isPredictedPeriod,
      isOvulation,
      isToday,
      hasSymptoms: !!symptoms,
      symptoms,
    });
  }

  // Mark predicted next period days
  const predicted = getPredictedNextStart();
  if (predicted) {
    const [py, pm, pd] = predicted.split("-").map(Number);
    if (py === y && pm === m) {
      for (let i = 0; i < state.avgDuration; i++) {
        const predDay = pd + i;
        const idx = days.findIndex((d) => d.day === predDay);
        if (idx >= 0) {
          days[idx].isPredictedPeriod = true;
          if (!days[idx].phaseLabel) days[idx].phaseLabel = "预测经期";
        }
      }
    }
  }

  // Mark first day of week (0=Sun) for calendar grid alignment
  const firstDay = new Date(y, m - 1, 1).getDay();

  return {
    year: y,
    month: m,
    days,
    firstDay,
    ovulation: getOvulationDay(),
    predictedNext: predicted,
    isActive: !!state.currentStart,
    currentDay: state.currentStart ? dateDiff(state.currentStart, today()) + 1 : 0,
  };
}

// ── Period history for the app ──

export function getPeriodHistory() {
  return state.cycleHistory.map((c) => ({
    ...c,
    symptoms: c.symptoms || {},
  }));
}

export function getActivePeriodSymptoms() {
  return state._activeSymptoms || {};
}

// ── Auto-detect period start from user chat ──

export function tryAutoRecordPeriod(userMessage) {
  if (!userMessage || state.currentStart) return false;

  const predicted = getPredictedNextStart();
  if (!predicted) return false;

  const daysUntil = dateDiff(today(), predicted);
  // Only auto-record if predicted date is within [-3, 0] days
  if (daysUntil > 0 || daysUntil < -3) return false;

  // Check for period affirmation keywords
  const msg = userMessage.toLowerCase();
  const affirmPatterns = [
    /来了/, /开始了/, /已经.*来/, /嗯.*来/, /是的.*来/,
    /生理期.*来/, /大姨妈.*来/, /例假.*来/, /月经.*来/,
    /来.*大姨妈/, /来.*例假/, /来.*月经/,
  ];

  const matched = affirmPatterns.some((p) => p.test(msg));
  if (matched) {
    startPeriod(today());
    console.log("[period] Auto-recorded period start via chat affirmation:", userMessage.slice(0, 50));
    return true;
  }
  return false;
}
