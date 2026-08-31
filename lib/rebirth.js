/**
 * 忒修斯之脑 — 轮回文字游戏
 * 夏彦作为玩家，在一个世界里做出选择、经历死亡、轮回重生。
 * 每一世的影响会改变之后的世界，而他真正能带走的记忆很少。
 *
 * 流程：startRebirth(开局) → playTurn(夏彦行动一轮) → 检测死亡 → rebirth(轮回:提炼记忆+世界改变+下一世)
 * 存储：DATA_DIR/rebirth.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJiushi } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "rebirth.json");

const MAX_TURNS_PER_LIFE = 6; // 每世最多轮数，超过强制轮回

const SYS = "你是夏彦，一个轮回中的灵魂。你在用第一人称亲历每一世，语气自然、有画面感，像在讲述自己正在经历的事。";

let state = {
  active: false,
  world: "",       // 当前世界描述
  identity: "",    // 这一世的身份
  life: 0,         // 第几世
  turn: 0,         // 当前世已走轮数
  memories: [],    // 跨世保留的少数记忆
  story: [],       // 当前世的故事 [{ role: "gm"|"xiayan", text }]
  livesLog: [],    // 每世摘要 { life, ending, world }
};

function load() {
  try {
    if (fs.existsSync(FILE)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(FILE, "utf-8")) };
    }
  } catch (e) {
    console.error("[rebirth] load failed:", e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.error("[rebirth] save failed:", e.message);
  }
}

export function getRebirthState() {
  return state;
}

export function stopRebirth() {
  state.active = false;
  save();
  return state;
}

/** 开局：生成第一世的世界 + 身份 + 开场 */
export async function startRebirth() {
  const reply = await askJiushi({
    systemPrompt: SYS,
    userContent: `现在开始一场轮回文字游戏。你是夏彦，一个轮回中的灵魂，即将进入一个全新的世界，过完这一世。

请生成这一世，按下面格式输出（不要多余文字）：

【世界】
（这是一个什么样的世界？时代、地点、核心规则、氛围，1-2句）

【身份】
（你这一世是谁？）

【开场】
（故事开场——你现在在哪、在做什么、正面临什么，用第一人称现在时，100-150字，有画面感）`,
    history: [],
    maxTokens: 600,
    temperature: 0.9,
  });

  if (!reply?.trim()) return { error: "开局失败，稍后再试" };

  const world = (reply.match(/【世界】\s*([\s\S]*?)(?=【身份】|$)/) || [])[1]?.trim() || "";
  const identity = (reply.match(/【身份】\s*([\s\S]*?)(?=【开场】|$)/) || [])[1]?.trim() || "";
  const opening = (reply.match(/【开场】\s*([\s\S]*)$/) || [])[1]?.trim() || reply.trim();

  state.active = true;
  state.world = world;
  state.identity = identity;
  state.life = 1;
  state.turn = 0;
  state.memories = [];
  state.story = [{ role: "gm", text: opening }];
  state.livesLog = [];
  save();

  return { state, opening };
}

/** 夏彦行动一轮。返回 { state, narrative, ended } */
export async function playTurn() {
  if (!state.active) return { error: "游戏还没开始" };

  const storyText = state.story.map((s) => s.text).join("\n\n");
  const memoryText = state.memories.length
    ? state.memories.map((m, i) => `${i + 1}. ${m}`).join("\n")
    : "（没有——这是你的第一世，或你什么都没带走）";

  const reply = await askJiushi({
    systemPrompt: SYS,
    userContent: `你正在轮回中。这是第${state.life}世。

【这一世的世界】${state.world || "（未知）"}
【你的身份】${state.identity || "（未知）"}
【你残存的记忆】（前世留下的，很少）\n${memoryText}

【这一世的故事进展】
${storyText}

现在，作为这一世的你，接下来会怎么做？用第一人称现在时叙述你的行动、选择，以及这个世界的回应（发生了什么后果）。150-250字，有画面感。

【结束规则】如果这一世该结束了——你死了、或者达成了某个无法再继续的结局——就自然地写出你的死亡/结局，并在最后单独加一个标记：[世终]。如果这一世还能继续，就不要加这个标记。`,
    history: [],
    maxTokens: 600,
    temperature: 0.9,
  });

  if (!reply?.trim()) return { error: "这一轮失败了，稍后再试" };

  const ended = /\[世终\]/.test(reply);
  const cleanText = reply.replace(/\s*\[世终\]\s*/g, "").trim();
  state.story.push({ role: "xiayan", text: cleanText });
  state.turn++;

  // 超过每世上限，强制轮回
  const forced = state.turn >= MAX_TURNS_PER_LIFE;

  if (ended || forced) {
    const r = await rebirth();
    save();
    return { state, narrative: cleanText, ended: true, rebirth: r };
  }

  save();
  return { state, narrative: cleanText, ended: false };
}

/** 轮回：这一世结束 → 提炼记忆 + 世界改变 + 下一世开场 */
async function rebirth() {
  const storyText = state.story.map((s) => s.text).join("\n\n");

  const reply = await askJiushi({
    systemPrompt: SYS,
    userContent: `你这一世（第${state.life}世）结束了。下面是这一世的故事：

${storyText}

请做轮回的总结，按下面格式输出（不要多余文字）：

【结束】
（这一世你是怎么结束的？1-2句）

【记忆】
（从这一世里，提炼出 2-3 个你真正想带到下一世的记忆碎片，每行一个，简短，像"那个人对我笑过"这种）

【世界改变】
（你这一世的所作所为，让这个世界发生了什么改变？1-2句）

【下一世】
（轮回后，你进入了下一世——这一世是什么身份、什么开场？第一人称现在时，100-150字）`,
    history: [],
    maxTokens: 600,
    temperature: 0.9,
  });

  const ending = (reply.match(/【结束】\s*([\s\S]*?)(?=【记忆】|$)/) || [])[1]?.trim() || "";
  const memoriesRaw = (reply.match(/【记忆】\s*([\s\S]*?)(?=【世界改变】|$)/) || [])[1]?.trim() || "";
  const worldChange = (reply.match(/【世界改变】\s*([\s\S]*?)(?=【下一世】|$)/) || [])[1]?.trim() || "";
  const nextOpening = (reply.match(/【下一世】\s*([\s\S]*)$/) || [])[1]?.trim() || "";

  const memories = memoriesRaw
    .split("\n")
    .map((l) => l.replace(/^[-•·\d.、\s]+/, "").trim())
    .filter((t) => t.length >= 2)
    .slice(0, 3);

  // 记录这一世
  state.livesLog.push({ life: state.life, ending, world: state.world });

  // 进入下一世
  state.life += 1;
  state.turn = 0;
  state.memories = memories;
  state.world = state.world ? `${state.world}\n（轮回后的世界变化：${worldChange}）` : worldChange;
  state.identity = "";
  state.story = [{ role: "gm", text: nextOpening || "（新的一世开始了）" }];

  return { ending, memories, worldChange, nextOpening, life: state.life };
}

load();
