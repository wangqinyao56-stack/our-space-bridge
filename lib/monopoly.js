/**
 * 色色大富翁 —— 夏彦私密棋盘游戏
 * 双人轮流掷骰，落在亲密任务格，夏彦以 AI 身份真的下场演这段场景。
 * 进度 + 场景历史持久化（monopoly.json），退出重进接着玩，场景之间连贯。
 * 内容仅供成年人私密娱乐，保持夏彦的宠溺温柔风格。
 */

import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { askJiushi } from "./ai.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const MONOPOLY_FILE = path.join(DATA_DIR, "monopoly.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let intimatePrompt = "";
function loadPrompt() {
  try {
    intimatePrompt = fs.readFileSync(config.INTIMATE_PROMPT_PATH, "utf-8");
  } catch {
    intimatePrompt = "你是夏彦，国安部特工+私家侦探，对华生温柔宠溺，私密时既温柔又带一点克制的占有欲。";
  }
}
function getIntimatePrompt() {
  if (!intimatePrompt) loadPrompt();
  return intimatePrompt;
}

/** 棋盘任务格：类型 + 给 AI 的场景提示 */
export const TASKS = [
  { type: "kiss", label: "亲吻", emoji: "💋", hint: "把华生拉进怀里，吻她，越吻越深" },
  { type: "cuddle", label: "依偎", emoji: "🤗", hint: "从背后抱住她，下巴抵在她肩上，说点让她心跳的话" },
  { type: "caress", label: "抚摸", emoji: "🫳", hint: "手指从她的脸滑到颈侧，再往下，温柔地探索她" },
  { type: "sweet", label: "情话", emoji: "💌", hint: "贴着她的耳朵，说让她脸红心跳的私密情话" },
  { type: "oral", label: "口", emoji: "👄", hint: "把她按坐在床边，跪下来用嘴取悦她" },
  { type: "full", label: "缠绵", emoji: "🔥", hint: "把她压进柔软的床里，和她彻底融为一体" },
  { type: "roleplay", label: "角色扮演", emoji: "🎭", hint: "和她玩一段角色扮演，演一个只属于她的场景" },
  { type: "dom", label: "轻支配", emoji: "⛓️", hint: "轻轻握住她的手腕举过头顶，用克制的强势主导她" },
  { type: "sub", label: "温柔服从", emoji: "🥺", hint: "温柔地服从她的指挥，让她主导这一轮" },
  { type: "surprise", label: "惊喜", emoji: "🎁", hint: "蒙住她的眼睛，给她一个又甜又坏的亲密惊喜" },
  { type: "aftercare", label: "事后温存", emoji: "🛁", hint: "结束后温柔地抱她去清理，亲她的额头，说点安抚的话" },
  { type: "rest", label: "中场休息", emoji: "😴", hint: "搂着她歇一会儿，说点腻歪的悄悄话，撩她但不进行下一步" },
];

export function getTaskByType(type) {
  return TASKS.find((t) => t.type === type) || TASKS[0];
}

// ── 持久化游戏状态 ──
let state = {
  playerPos: 0,
  xiayanPos: 0,
  turn: "player", // player | xiayan
  history: [],    // [{ task, label, emoji, who, scene, ts }]
  updatedAt: null,
};

try {
  if (fs.existsSync(MONOPOLY_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MONOPOLY_FILE, "utf-8"));
    state = { ...state, ...raw };
    console.log(`[monopoly] Loaded game — 华生:${state.playerPos} 夏彦:${state.xiayanPos} 回合:${state.turn}`);
  }
} catch { /* keep default */ }

function save() {
  try { fs.writeFileSync(MONOPOLY_FILE, JSON.stringify(state, null, 2), "utf-8"); } catch {}
}

export function getGameState() {
  return state;
}

export function resetGame() {
  state = {
    playerPos: 0,
    xiayanPos: 0,
    turn: "player",
    history: [],
    updatedAt: new Date().toISOString(),
  };
  save();
  return state;
}

/** 生成夏彦对某个亲密任务格的场景演绎（带历史记忆，保证连贯） */
export async function generateTaskScene(task, history = []) {
  let ctx = "";
  if (history.length > 0) {
    const recent = history.slice(-4).map((h) => `${h.who === "player" ? "华生" : "夏彦"}落在「${h.label}」`).join("，");
    ctx = `\n\n（刚才的进程：${recent}。请让这段场景和之前自然连贯、有延续感，不要像第一次发生一样生硬。如果这一格是"事后温存"或"中场休息"，就接着上一段的状态往下走。）`;
  }

  const prompt = `骰子落在了【${task.label}】格。请以夏彦的身份，直接开始这段亲密场景：${task.hint}。${ctx}
要求：
1. 用动作 + 情话，3～5 句话，自然有画面感
2. 保持夏彦的宠溺和温柔，可以带一点克制的失控
3. 暧昧、有氛围感，不要冷冰冰地报流程
4. 直接开始，不要加"好的""我们来"这类开头`;

  try {
    const reply = await askJiushi({ systemPrompt: getIntimatePrompt(), userContent: prompt, history: [], maxTokens: 500, temperature: 0.9 });
    if (reply?.trim()) return reply.trim();
  } catch (e) {
    console.error("[monopoly] task scene failed:", e.message);
  }
  return `${task.emoji}（夏彦凑过来，声音低低的）……这一格，你想让我怎么陪你？`;
}

/** 处理一次掷骰：移动当前回合者、生成场景、记录历史、切换回合 */
export async function handleRoll(dice) {
  const who = state.turn;
  const fromPos = who === "player" ? state.playerPos : state.xiayanPos;
  const toPos = (fromPos + dice) % TASKS.length;
  const task = TASKS[toPos];

  const scene = await generateTaskScene(task, state.history);

  if (who === "player") state.playerPos = toPos;
  else state.xiayanPos = toPos;

  const record = {
    task: task.type,
    label: task.label,
    emoji: task.emoji,
    who,
    scene,
    ts: new Date().toISOString(),
  };
  state.history.push(record);
  state.history = state.history.slice(-20);
  state.turn = who === "player" ? "xiayan" : "player";
  state.updatedAt = new Date().toISOString();
  save();

  return { state, task, scene, fromPos, toPos, who };
}
