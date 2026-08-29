/**
 * 夏彦陪伴监督模式：华生开始画稿/工作后，夏彦在后台自己计时（25 分钟专注 + 5 分钟休息），
 * 到点主动提醒她起来休息、催她、休息完提醒继续并问进度。华生没回应就多催几次。
 * 陪伴模式下自动把她说的工作/画稿内容记进小纸条（todo）。
 * 状态持久化到 DATA_DIR/companion-state.json。
 */

import fs from "node:fs";
import path from "node:path";
import { askJiushi } from "./ai.js";
import { getDailySystemPrompt } from "./message-router.js";
import { addTodo, getTodos } from "./todo.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const STATE_FILE = path.join(DATA_DIR, "companion-state.json");

const FOCUS_MIN = 25;
const BREAK_MIN = 5;
const FOLLOW_UP_DELAY_MS = 5 * 60 * 1000; // 提醒后 5 分钟没回就催
const FOLLOW_UP_MAX = 2; // 最多多催 2 次
const TICK_MS = 30 * 1000;

let state = {
  active: false,
  phase: "focus", // "focus" | "break"
  phaseEndsAt: 0,
  lastRemindAt: 0,
  followUpCount: 0,
  lastUserReplyTime: 0,
};

let onRemind = null; // callback(message)

try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    state = { ...state, ...saved };
    console.log(`[companion] Loaded state (active=${state.active}, phase=${state.phase})`);
  }
} catch {}

function save() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8"); } catch {}
}

export function setCompanionCallback(cb) {
  onRemind = cb;
}

export function startCompanion() {
  if (state.active) return;
  state.active = true;
  state.phase = "focus";
  state.phaseEndsAt = Date.now() + FOCUS_MIN * 60 * 1000;
  state.lastRemindAt = 0;
  state.followUpCount = 0;
  state.lastUserReplyTime = Date.now();
  save();
  console.log(`[companion] 陪伴开始，专注 ${FOCUS_MIN} 分钟`);
}

export function stopCompanion() {
  if (!state.active) return;
  state.active = false;
  save();
  console.log("[companion] 陪伴结束");
}

export function noteUserReply() {
  state.lastUserReplyTime = Date.now();
  state.followUpCount = 0;
  save();
}

export function getCompanionState() {
  return {
    active: state.active,
    phase: state.phase,
    remainingSeconds: state.active ? Math.max(0, Math.round((state.phaseEndsAt - Date.now()) / 1000)) : 0,
  };
}

async function generateReminder(kind) {
  const instruction = kind === "break"
    ? "专注时间到了，温柔地提醒华生起来动一动、休息一下——喝口水、伸个懒腰、别一直坐着。像平时催她休息一样自然，就一两句话。"
    : "休息时间到了，温柔地提醒华生该继续做事了，顺便问问她刚才做得/画得怎么样、进度如何。就一两句话，别啰嗦。";
  try {
    const reply = await askJiushi({
      systemPrompt: getDailySystemPrompt(),
      userContent: instruction,
      history: [],
      maxTokens: 120,
    });
    if (reply && reply.trim()) return reply.trim();
  } catch (e) {
    console.error("[companion] remind error:", e.message);
  }
  return kind === "break" ? "宝宝，起来动一动，喝口水，别一直坐着～" : "休息好啦，该继续了哦，进度怎么样啦？";
}

async function generateFollowUp() {
  try {
    const reply = await askJiushi({
      systemPrompt: getDailySystemPrompt(),
      userContent: "华生还没回你，再轻轻催她一下，让她别一直坐着不动。就一句话，带点撒娇，别凶。",
      history: [],
      maxTokens: 80,
    });
    if (reply && reply.trim()) return reply.trim();
  } catch (e) {
    console.error("[companion] follow-up error:", e.message);
  }
  return "宝宝，还坐着呢？起来动一动嘛～";
}

async function tick() {
  if (!state.active) return;
  const now = Date.now();

  // follow-up：提醒发出后华生一直没回，多催几次
  if (state.lastRemindAt && now - state.lastRemindAt > FOLLOW_UP_DELAY_MS) {
    if (now - state.lastUserReplyTime > FOLLOW_UP_DELAY_MS && state.followUpCount < FOLLOW_UP_MAX) {
      state.followUpCount++;
      state.lastRemindAt = now;
      save();
      console.log(`[companion] 催第 ${state.followUpCount} 次`);
      const msg = await generateFollowUp();
      if (onRemind) onRemind(msg);
      return;
    }
  }

  // 阶段到期
  if (now >= state.phaseEndsAt) {
    if (state.phase === "focus") {
      state.phase = "break";
      state.phaseEndsAt = now + BREAK_MIN * 60 * 1000;
      state.followUpCount = 0;
      state.lastRemindAt = now;
      save();
      console.log(`[companion] 专注结束 → 休息 ${BREAK_MIN} 分钟`);
      const msg = await generateReminder("break");
      if (onRemind) onRemind(msg);
    } else {
      state.phase = "focus";
      state.phaseEndsAt = now + FOCUS_MIN * 60 * 1000;
      state.followUpCount = 0;
      state.lastRemindAt = now;
      save();
      console.log(`[companion] 休息结束 → 专注 ${FOCUS_MIN} 分钟`);
      const msg = await generateReminder("resume");
      if (onRemind) onRemind(msg);
    }
  }
}

setInterval(tick, TICK_MS);

// ── 画稿自动记进小纸条 ──
const TASK_KEYWORDS = /画稿|商稿|立绘|线稿|草稿|赶稿|交稿|成图|上色|勾线|画图|画画|写稿|稿子/;

export async function maybeRecordTask(text) {
  if (!state.active) return null;
  if (!TASK_KEYWORDS.test(text)) return null;
  try {
    const reply = await askJiushi({
      systemPrompt: "你是待办提取器。从华生的话里提取她正在做的工作/画稿内容，输出成一句简洁的待办（例如「画古风立绘」）。如果她没在说具体的工作内容，只输出「无」。",
      userContent: `华生说：「${text}」。请提取一句待办，或输出「无」。`,
      history: [],
      maxTokens: 20,
    });
    const task = (reply || "").trim();
    if (!task || task.includes("无")) return null;
    const todos = getTodos();
    if (todos.some((t) => t.status === "pending" && t.text === task)) return null;
    const todo = addTodo(task, "me", "today");
    console.log(`[companion] 记录待办: ${task}`);
    return todo;
  } catch (e) {
    console.error("[companion] record task error:", e.message);
    return null;
  }
}
