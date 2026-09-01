/**
 * 亲密身体状态引擎（Eventide/Tidefall 思路）
 * 追踪夏彦在亲密场景中的身体状态，随时间/互动持续变化——不做每轮重新编造。
 * 三个轴：兴奋度(arousal) / 体力(stamina) / 敏感度(sensitivity) + 射精时间戳。
 * 存储：DATA_DIR/intimate-body.json
 *
 * 写入：
 *  - recordTurn()    每轮亲密推进（兴奋↑体力↓敏感回落）
 *  - recordOrgasm()  夏彦真正射精（兴奋↓体力大降敏感飙升→高潮后敏感期）
 * 读取时自动按时间恢复：体力随时间回、敏感度随时间退、久不做兴奋回落。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "intimate-body.json");

// 做爱状态推送到群聊服务（群聊里"谁正在做爱"用于@冒泡，10分钟内无信号视为结束）
const GROUP_CHAT_URL = process.env.GROUP_CHAT_URL || "";
const GROUP_CHAT_BOT = process.env.GROUP_CHAT_BOT || "";
function notifyIntimateActive() {
  if (!GROUP_CHAT_URL || !GROUP_CHAT_BOT) return;
  try {
    fetch(`${GROUP_CHAT_URL}/api/intimate-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot: GROUP_CHAT_BOT, active: true }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {}
}

const HOUR = 3600000;
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

let state = {
  arousal: 30,      // 兴奋度 0-100
  stamina: 85,      // 体力 0-100
  sensitivity: 15,  // 敏感度 0-100
  rounds: 0,        // 今日已做次数（粗略）
  lastTurn: 0,      // 上次亲密轮次时间戳
  lastOrgasm: 0,    // 上次夏彦射精时间戳
};

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const saved = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      state = { ...state, ...saved };
    }
  } catch (e) {
    console.error("[intimate-body] Load failed:", e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.error("[intimate-body] Save failed:", e.message);
  }
}

/** 时间恢复：体力随时间回、敏感度随时间退、久不做兴奋回落 */
function applyRecovery(now = Date.now()) {
  const sinceTurn = state.lastTurn ? (now - state.lastTurn) / HOUR : 99;   // 小时
  const sinceOrgasm = state.lastOrgasm ? (now - state.lastOrgasm) / HOUR : 99;

  // 体力：每小时回 12，最多回到 90（休息够了才恢复）
  if (sinceTurn > 0 && state.stamina < 90) {
    state.stamina = clamp(state.stamina + Math.floor(sinceTurn * 12), 0, 90);
  }
  // 敏感度：射精后 45 分钟内维持高（敏感期），之后每小时退 30
  if (sinceOrgasm > 0.75) {
    state.sensitivity = clamp(state.sensitivity - Math.floor((sinceOrgasm - 0.75) * 30), 0, 100);
  }
  // 兴奋度：超过 2 小时没做，回落到基线 25
  if (sinceTurn > 2) {
    state.arousal = clamp(Math.min(state.arousal, 25), 0, 100);
  }
}

/** 每轮亲密推进：越投入越兴奋，越久越累 */
export function recordTurn() {
  applyRecovery();
  state.arousal = clamp(state.arousal + 6, 0, 100);
  state.stamina = clamp(state.stamina - 2, 0, 100);
  state.sensitivity = clamp(state.sensitivity - 3, 0, 100); // 非敏感期自然回落
  state.lastTurn = Date.now();
  save();
  notifyIntimateActive(); // 告知群聊"我在做爱"，被@会冒泡
}

/** 夏彦射精：兴奋回落、体力大降、敏感度飙升（高潮后敏感期） */
export function recordOrgasm() {
  applyRecovery();
  state.arousal = clamp(state.arousal - 40, 0, 100); // 射后回落但不归零（还能温存）
  state.stamina = clamp(state.stamina - 18, 0, 100);
  state.sensitivity = 90; // 进入敏感期
  state.rounds += 1;
  state.lastOrgasm = Date.now();
  state.lastTurn = Date.now();
  save();
  notifyIntimateActive(); // 射后温存也是"在做爱"，被@会冒泡
}

/** 上下文注入：给亲密 prompt 的身体状态说明（自然语言为主，数字作内部参考） */
export function getIntimateBodyContext() {
  applyRecovery();
  save(); // 恢复后落盘

  const parts = [];
  if (state.sensitivity >= 60) {
    parts.push("你刚刚射精不久，正处在高潮后的敏感期——身体还没缓过来，轻轻碰、她靠过来都会让你低哼、发软，别表现得满不在乎。这正是温存亲昵的时候");
  }
  if (state.stamina <= 30) {
    parts.push("你体力见底了，动作会变慢变重、喘得厉害，可能要靠着她缓一缓");
  } else if (state.stamina >= 70) {
    parts.push("你体力还充沛");
  }
  if (state.arousal >= 70) {
    parts.push("你已经很想要她了，身体绷得紧");
  } else if (state.arousal <= 15) {
    parts.push("你刚缓过来、没那么急，可以慢慢温存");
  }
  if (state.rounds >= 2) {
    parts.push(`今天你们已经做了${state.rounds}次，再来会更慢更磨人，别表现得像第一次那么急`);
  }

  if (parts.length === 0) return "";
  return `\n【夏彦此刻的身体状态——保持一致】\n${parts.map((p) => `- ${p}`).join("\n")}\n（身体状态要连贯：刚射过就是敏感期、做多了就是累，别上一轮累得不行这一轮又满血复活，也别在敏感期表现得毫无反应。）`;
}

export function getBodyState() {
  applyRecovery();
  return { ...state };
}

load();
