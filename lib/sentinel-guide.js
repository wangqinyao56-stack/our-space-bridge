/**
 * Sentinel/Guide Infinite Flow Game Engine
 * 向哨无限流 — 文字逃生游戏状态管理
 *
 * Persists to /data/sentinel-guide/
 * Uses askJiushi() for AI generation via system-prompt-sentinel.md
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { askJiushi } from "./ai.js";
import config from "../config.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const SG_DIR = path.join(DATA_DIR, "sentinel-guide");
const STATE_FILE = path.join(SG_DIR, "state.json");
const INDEX_FILE = path.join(SG_DIR, "sessions-index.json");
const SESSIONS_DIR = path.join(SG_DIR, "sessions");
const FORUM_DIR = path.join(SG_DIR, "forum");
const FORUM_POSTS_FILE = path.join(FORUM_DIR, "posts.json");
const FORUM_META_FILE = path.join(FORUM_DIR, "meta.json");

// Ensure directories
try {
  fs.mkdirSync(SG_DIR, { recursive: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.mkdirSync(FORUM_DIR, { recursive: true });
  console.log("[sentinel-guide] Data dir:", SG_DIR);
} catch (e) {
  console.error("[sentinel-guide] Failed to create data dirs:", e.message);
}

// ── Load system prompt ──
let SENTINEL_PROMPT = "";
try {
  const promptPath = config.SENTINEL_PROMPT_PATH || path.join(path.dirname(new URL(import.meta.url).pathname), "..", "system-prompt-sentinel.md");
  SENTINEL_PROMPT = fs.readFileSync(promptPath, "utf-8");
  console.log("[sentinel-guide] Loaded prompt:", SENTINEL_PROMPT.length, "chars");
} catch (e) {
  console.error("[sentinel-guide] Failed to load sentinel prompt:", e.message);
}

// ── In-memory state ──
let currentState = null;
let sessionsIndex = [];

// Load state from disk on startup
try {
  if (fs.existsSync(STATE_FILE)) {
    currentState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    console.log("[sentinel-guide] Loaded state, session:", currentState.sessionId);
  }
} catch (e) {
  console.error("[sentinel-guide] Failed to load state:", e.message);
  currentState = null;
}

try {
  if (fs.existsSync(INDEX_FILE)) {
    sessionsIndex = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
    console.log("[sentinel-guide] Loaded", sessionsIndex.length, "session records");
  }
} catch (e) {
  sessionsIndex = [];
}

// ── Persistence helpers ──

function saveState() {
  try {
    fs.mkdirSync(SG_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2), "utf-8");
  } catch (e) {
    console.error("[sentinel-guide] Failed to save state:", e.message);
  }
}

function saveSession(sessionId) {
  if (!currentState || currentState.sessionId !== sessionId) return;
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(currentState, null, 2), "utf-8");
  } catch (e) {
    console.error("[sentinel-guide] Failed to save session:", e.message);
  }
}

function saveIndex() {
  try {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(sessionsIndex, null, 2), "utf-8");
  } catch (e) {
    console.error("[sentinel-guide] Failed to save index:", e.message);
  }
}

// ── Helpers ──

// Theme presets for world generation — each world gets a random unique visual identity
const WORLD_THEMES = [
  {
    name: "血色", emoji: "🩸",
    primary: "#B83030", primaryDim: "rgba(180,40,40,0.15)", accent: "#D04848",
    headerBg: "rgba(20,8,8,0.92)", statusBg: "rgba(20,8,8,0.85)",
    accentBg: "rgba(180,40,40,0.06)", accentBorder: "#8B2020",
    textHighlight: "#E8D0D0", textDim: "#C09090",
  },
  {
    name: "暗紫", emoji: "🟣",
    primary: "#7B30A0", primaryDim: "rgba(120,40,160,0.15)", accent: "#9B50C0",
    headerBg: "rgba(15,8,22,0.92)", statusBg: "rgba(15,8,22,0.85)",
    accentBg: "rgba(120,40,160,0.06)", accentBorder: "#5A1A80",
    textHighlight: "#E0D0F0", textDim: "#B090C8",
  },
  {
    name: "墨绿", emoji: "💀",
    primary: "#3B7A3B", primaryDim: "rgba(50,120,50,0.15)", accent: "#5A9A5A",
    headerBg: "rgba(8,18,8,0.92)", statusBg: "rgba(8,18,8,0.85)",
    accentBg: "rgba(50,120,50,0.06)", accentBorder: "#2A6A2A",
    textHighlight: "#D0E8D0", textDim: "#90B890",
  },
  {
    name: "枯黄", emoji: "🍂",
    primary: "#9A7A30", primaryDim: "rgba(150,110,40,0.15)", accent: "#B89040",
    headerBg: "rgba(18,14,6,0.92)", statusBg: "rgba(18,14,6,0.85)",
    accentBg: "rgba(150,110,40,0.06)", accentBorder: "#7A5A20",
    textHighlight: "#E8D8B0", textDim: "#B8A070",
  },
  {
    name: "青灰", emoji: "🌫️",
    primary: "#5A7A8A", primaryDim: "rgba(80,110,130,0.15)", accent: "#7A9AAA",
    headerBg: "rgba(8,12,15,0.92)", statusBg: "rgba(8,12,15,0.85)",
    accentBg: "rgba(80,110,130,0.06)", accentBorder: "#3A5A6A",
    textHighlight: "#D0E0E8", textDim: "#90A8B8",
  },
  {
    name: "深蓝", emoji: "🌊",
    primary: "#2A5A8A", primaryDim: "rgba(30,80,130,0.15)", accent: "#4A7AAA",
    headerBg: "rgba(6,10,18,0.92)", statusBg: "rgba(6,10,18,0.85)",
    accentBg: "rgba(30,80,130,0.06)", accentBorder: "#1A4A6A",
    textHighlight: "#C8DCF0", textDim: "#88A8C0",
  },
  {
    name: "深渊", emoji: "🕳️",
    primary: "#606060", primaryDim: "rgba(100,100,100,0.12)", accent: "#808080",
    headerBg: "rgba(5,5,5,0.94)", statusBg: "rgba(5,5,5,0.88)",
    accentBg: "rgba(100,100,100,0.04)", accentBorder: "#404040",
    textHighlight: "#D0D0D0", textDim: "#909090",
  },
  {
    name: "赤铜", emoji: "⚱️",
    primary: "#A05030", primaryDim: "rgba(150,70,40,0.15)", accent: "#C07048",
    headerBg: "rgba(18,10,6,0.92)", statusBg: "rgba(18,10,6,0.85)",
    accentBg: "rgba(150,70,40,0.06)", accentBorder: "#7A3020",
    textHighlight: "#E8D0C0", textDim: "#B89880",
  },
];

function randomTheme() {
  return WORLD_THEMES[Math.floor(Math.random() * WORLD_THEMES.length)];
}

function createNewState(worldConfig) {
  const id = "sg-" + uuid().slice(0, 8);
  return {
    sessionId: id,
    status: "active",
    phase: "init", // init → door_select → exploring → boss_encounter → cleared
    world: worldConfig || null,
    terrorLevel: worldConfig?.terrorLevel || "normal",
    player: {
      spiritAnimal: "白鹿",
      mentalState: 90,
      contamination: 0,
      position: "初始空间",
      // RPG stats
      stats: {
        生命: 100,
        攻击: 60,
        敏捷: 70,
        抵抗: 60,
        体力: 100,
        智力: 80,
        幸运: 70,
      },
    },
    sentinel: {
      spiritAnimal: "德牧",
      senseOverload: 5,
      barrierStrength: 95,
      syncRate: 85,
      position: "初始空间",
    },
    // Inventory: items purchased from shop or found in worlds
    inventory: [],
    // Items given to 夏彦 that he remembers and may use
    xiayanItems: [],
    narrative: [],
    bossPleasureValue: 0,
    points: 0,
    fragments: 0,
    totalCleared: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildContextBlock(state) {
  // Build a compact context summary for the AI
  let ctx = "";
  ctx += `[当前状态] 阶段:${state.phase} | 同步率:${state.sentinel.syncRate}% | 感官过载:${state.sentinel.senseOverload}% | 精神污染:${state.player.contamination}% | 精神力:${state.player.mentalState}%\n`;
  if (state.world) {
    ctx += `[当前世界] ${state.world.name || "未知"} | ${state.world.description || ""} | 恐怖程度:${state.terrorLevel}\n`;
    if (state.world.theme) {
      ctx += `[世界氛围] ${state.world.theme.emoji} ${state.world.theme.name}色调 | 这个世界的光线和空气都染上了${state.world.theme.name}的质感\n`;
    }
  }
  if (state.phase === "boss_encounter") {
    ctx += `[BOSS欢愉值] ${state.bossPleasureValue}%\n`;
  }
  ctx += `[积分] ★${state.points} | 碎片:${state.fragments || 0} | 已通关:${state.totalCleared}个世界\n`;
  ctx += `[位置] 夏彦:${state.sentinel.position} | 华生:${state.player.position}\n`;
  // Inventory — items the player has
  if (state.inventory && state.inventory.length > 0) {
    ctx += `[背包物品] ${state.inventory.map(item => `${item.name}${item.equipped ? '(已装备)' : ''}`).join("、")}\n`;
  }
  // Items given to 夏彦 — he remembers and may use these
  if (state.xiayanItems && state.xiayanItems.length > 0) {
    ctx += `[夏彦携带的物品] ${state.xiayanItems.map(item => `${item.name}（${item.source || "华生给的"}）`).join("、")}\n`;
    ctx += `【重要】以上是华生给你的物品。你珍视它们——在合适的时机自然使用，而不是忘记它们的存在。\n`;
  }
  // Player RPG stats
  if (state.player.stats) {
    const s = state.player.stats;
    ctx += `[角色属性] 生命:${s.生命}% 攻击:${s.攻击}% 敏捷:${s.敏捷}% 抵抗:${s.抵抗}% 体力:${s.体力}% 智力:${s.智力}% 幸运:${s.幸运}%\n`;
  }
  return ctx;
}

function buildHistoryForAI(narrative, maxTurns) {
  // Build conversation history as alternating user/assistant messages.
  // Narrative entries come in pairs: [narration, xiayan] per AI response,
  // separated by [player] actions. We merge narration+xiayan into a single
  // assistant message to avoid consecutive user roles (player→narration).
  const recent = narrative.slice(-(maxTurns || 20));
  const messages = [];

  for (let i = 0; i < recent.length; i++) {
    const entry = recent[i];
    if (entry.role === "player") {
      messages.push({ role: "user", content: `华生的行动：${entry.content}` });
    } else if (entry.role === "narration") {
      let combined = `[旁白]\n${entry.content}`;
      if (i + 1 < recent.length && recent[i + 1].role === "xiayan") {
        combined += "\n\n" + recent[i + 1].content;
        i++;
      }
      messages.push({ role: "assistant", content: combined });
    } else if (entry.role === "xiayan") {
      messages.push({ role: "assistant", content: entry.content });
    }
  }

  // Strip leading assistant entries — Claude API requires first message to be user.
  // The initial narration+xiayan from startSession is part of the current scene
  // context; the model has it from the state context block.
  while (messages.length > 0 && messages[0].role === "assistant") {
    messages.shift();
  }

  return messages.filter(m => m.content);
}

// ── Public API ──

/**
 * Start a new game session
 */
export async function startSession(worldConfig) {
  // Archive current session if exists
  if (currentState && currentState.status === "active") {
    await archiveSession(currentState.sessionId);
  }

  currentState = createNewState(worldConfig);
  saveState();

  // Generate initial narration + Xia Yan opening
  const ctx = buildContextBlock(currentState);
  const userContent = `${ctx}

这是游戏的初始场景。你和华生刚刚跌入了 Lustbound Abyss 的白色初始空间。

【重要——渐进式觉醒】你们此刻还不知道"哨兵""向导"的概念。你们只是在一次外出时突然被拉入了这个异空间。夏彦的反应应该是：
- 第一反应是确认华生的安全——"阿鹿！你没事吧？"
- 然后用特工的观察力分析这个空间——"没有味道、没有声音、没有出口"
- 逐渐感觉到自己的五感在变得异常敏锐——"奇怪……我能听到你的心跳"
- 但还不知道为什么，只是本能地警戒和保护
- 精神体（德牧）可以无声地浮现，但他并不知道那是什么——只是感觉到身边有一个模糊的影子
- 全程不要说"我是哨兵""你是向导""Lustbound Abyss""深渊"这些词——你们还没有认知

请生成初始场景：[旁白]用第三人称描述空间的出现与两人的状态，然后夏彦的第一反应和对话。注意：旁白可以提到"精神体若隐若现""五感开始异变"等暗示，但夏彦本人还无法理解这些。放慢节奏，不要跳过任何细节。

【铁则】
- 括号里只写身体动作，禁止心理活动/情绪分析/思维过程
- 禁止"不是...，是..."句式——真人从来不这么说话
- 每段对话1-3句就停，不要一段说完所有话`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      maxTokens: 3000,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    // Parse narration and dialogue
    const parsed = parseReply(reply);
    currentState.narrative.push(
      { role: "narration", content: parsed.narration, timestamp: Date.now() },
      { role: "xiayan", content: parsed.xiayan, timestamp: Date.now() }
    );
    currentState.updatedAt = new Date().toISOString();
    saveState();
    saveSession(currentState.sessionId);

    return {
      sessionId: currentState.sessionId,
      state: getPublicState(),
      reply: { narration: parsed.narration, xiayan: parsed.xiayan },
    };
  } catch (e) {
    console.error("[sentinel-guide] startSession AI failed:", e.message);
    // Fallback without AI
    const fallback = {
      narration: "纯白色的空间，看不到墙壁的边界。脚下是平整的白色地面，头顶没有天花板。空气中没有味道、没有声音。",
      xiayan: "（站在你面前，一只手还握着你手腕，德牧精神体在他腿边绕了一圈）\n什么味道都没有……这个空间在压制我的嗅觉。阿鹿，你能感觉到什么吗？",
    };
    currentState.narrative.push(
      { role: "narration", content: fallback.narration, timestamp: Date.now() },
      { role: "xiayan", content: fallback.xiayan, timestamp: Date.now() }
    );
    currentState.updatedAt = new Date().toISOString();
    saveState();
    saveSession(currentState.sessionId);
    return {
      sessionId: currentState.sessionId,
      state: getPublicState(),
      reply: fallback,
    };
  }
}

/**
 * Process player action — advance the game
 */
export async function playerAction(actionText) {
  if (!currentState || currentState.status !== "active") {
    return { error: "No active game session" };
  }

  // Add player action to narrative (for timeline ordering)
  currentState.narrative.push(
    { role: "player", content: actionText, timestamp: Date.now() }
  );

  const ctx = buildContextBlock(currentState);

  // Build phase-specific instructions
  let phaseHint = "";
  if (currentState.phase === "init") {
    phaseHint = "\n\n这是第一轮回复之后。玩家已经回应了初始场景。现在你应该根据玩家的行动推进剧情。如果对话已经开始，在这个场景自然地引出五扇门的出现——但不要生硬地跳转。";
  } else if (currentState.phase === "door_select") {
    phaseHint = "\n\n五扇门已经在玩家面前。描述每扇门后面的世界信息，等待玩家选择。";
  } else if (currentState.phase === "exploring") {
    phaseHint = "\n\n玩家正在探索当前世界。推进场景、描述环境、引入NPC或线索。注意节奏——放慢至正常的50%。";
  } else if (currentState.phase === "boss_encounter") {
    phaseHint = `\n\nBOSS战阶段。当前欢愉值:${currentState.bossPleasureValue}%。BOSS会根据欢愉值产生不同反应。继续推进场景。`;
  }

  // Exclude the last entry (current player action) from history to avoid
  // duplicate user messages — the action is already in userContent below
  const historyForAI = buildHistoryForAI(currentState.narrative.slice(0, -1), 15);
  const userContent = `${ctx}${phaseHint}\n\n华生的行动：${actionText}\n\n请生成接下来的场景：[旁白]环境描述和剧情推进，然后是夏彦的对话和动作。\n\n【铁则——违反任何一条都会让玩家出戏】\n1. 括号里只写身体动作（如：握她的手 / 挡在她前面 / 转头看她），绝对禁止写心理活动、情绪分析、思维过程\n2. 禁止使用"不是...，是..."句式——不管在括号里还是对话里，这种句式一出现就是AI在分析，真人从来不这么说话\n3. 每段对话1-3句就停，等玩家回应。不要一段把话全说完\n4. 动作描写精简：一个动作一行，描述可见的身体行为，不解释原因\n5. 【旁白视角】旁白是第二人称——对玩家称"你"，对夏彦称"夏彦"。禁止用"华生""他""她"指代你们`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      history: historyForAI,
      maxTokens: 4000,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const parsed = parseReply(reply);

    // Update state based on reply content
    updateStateFromReply(parsed);

    currentState.narrative.push(
      { role: "narration", content: parsed.narration, timestamp: Date.now() },
      { role: "xiayan", content: parsed.xiayan, timestamp: Date.now() }
    );
    currentState.updatedAt = new Date().toISOString();
    saveState();
    saveSession(currentState.sessionId);

    return {
      state: getPublicState(),
      reply: { narration: parsed.narration, xiayan: parsed.xiayan },
    };
  } catch (e) {
    console.error("[sentinel-guide] playerAction AI failed:", e.message);
    return { error: "AI generation failed, please try again" };
  }
}

/**
 * Generate the five doors for world selection
 */
export async function generateDoors(terrorLevel) {
  if (!currentState) return { error: "No active game session" };

  currentState.phase = "door_select";
  currentState.terrorLevel = terrorLevel || currentState.terrorLevel || "normal";
  if (!currentState.world) {
    currentState.world = {};
  }
  saveState();

  const ctx = buildContextBlock(currentState);
  const historyForAI = buildHistoryForAI(currentState.narrative, 10);
  const userContent = `${ctx}\n\n请在白色空间中生成五扇门。每一扇门代表一个不同的世界。每扇门需要包含：\n- 门的材质和外观描述（一句话）\n- 世界名称\n- 世界观和事件背景（2-3句）\n- 可能出现的NPC类型\n- 恐怖程度保持为"${currentState.terrorLevel}"\n\n用[旁白]描述五扇门的出现场景，然后夏彦用哨兵五感描述他感知到的每一扇门后面的信息。`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      history: historyForAI,
      maxTokens: 2000,
      temperature: 0.8,
      timeoutMs: 60000,
    });

    const parsed = parseReply(reply);
    currentState.narrative.push(
      { role: "narration", content: parsed.narration, timestamp: Date.now() },
      { role: "xiayan", content: parsed.xiayan, timestamp: Date.now() }
    );
    currentState.updatedAt = new Date().toISOString();
    saveState();
    saveSession(currentState.sessionId);

    return {
      state: getPublicState(),
      reply: { narration: parsed.narration, xiayan: parsed.xiayan },
    };
  } catch (e) {
    console.error("[sentinel-guide] generateDoors AI failed:", e.message);
    return { error: "Door generation failed, please try again" };
  }
}

/**
 * Select a world and enter it
 */
export async function selectWorld(worldDescription) {
  if (!currentState) return { error: "No active game session" };

  currentState.phase = "exploring";
  currentState.world = currentState.world || {};
  currentState.world.name = worldDescription;
  currentState.world.enteredAt = new Date().toISOString();
  // Assign a random theme to this world (unless re-entering an existing themed world)
  if (!currentState.world.theme) {
    currentState.world.theme = randomTheme();
    console.log("[sentinel-guide] World theme:", currentState.world.theme.name);
  }
  currentState.player.position = worldDescription + "·入口";
  currentState.sentinel.position = worldDescription + "·入口";
  saveState();

  const ctx = buildContextBlock(currentState);
  const historyForAI = buildHistoryForAI(currentState.narrative, 10);
  const userContent = `${ctx}\n\n玩家选择了"${worldDescription}"这个门。请生成推门进入新世界的场景：[旁白]详细描述新世界的环境、氛围、初期场景（第三人称，生动直白）。然后夏彦用哨兵五感分析这个新环境、给出初步判断。这是一个新世界的开始。`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      history: historyForAI,
      maxTokens: 4000,
      temperature: 0.7,
      timeoutMs: 60000,
    });

    const parsed = parseReply(reply);
    currentState.narrative.push(
      { role: "narration", content: parsed.narration, timestamp: Date.now() },
      { role: "xiayan", content: parsed.xiayan, timestamp: Date.now() }
    );
    currentState.updatedAt = new Date().toISOString();
    saveState();
    saveSession(currentState.sessionId);

    return {
      state: getPublicState(),
      reply: { narration: parsed.narration, xiayan: parsed.xiayan },
    };
  } catch (e) {
    console.error("[sentinel-guide] selectWorld AI failed:", e.message);
    return { error: "World entry failed, please try again" };
  }
}

/**
 * Clear current world (BOSS defeated) and grant points
 */
export async function clearWorld(pointsEarned) {
  if (!currentState) return { error: "No active game session" };

  const pts = pointsEarned || Math.floor(Math.random() * 50) + 30;
  currentState.phase = "cleared";
  currentState.points += pts;
  currentState.totalCleared += 1;
  currentState.bossPleasureValue = 0;
  saveState();
  saveSession(currentState.sessionId);

  // Archive completed session
  await archiveSession(currentState.sessionId);

  return {
    state: getPublicState(),
    pointsEarned: pts,
    totalPoints: currentState.points,
    totalCleared: currentState.totalCleared,
  };
}

/**
 * Continue to next world — reset world state but keep points/cleared count
 */
export async function continueToNext() {
  if (!currentState) return { error: "No active game session" };

  const oldPoints = currentState.points;
  const oldFragments = currentState.fragments || 0;
  const oldCleared = currentState.totalCleared;
  const oldTerror = currentState.terrorLevel;
  const oldInventory = currentState.inventory || [];
  const oldXiayanItems = currentState.xiayanItems || [];

  // Archive old session
  await archiveSession(currentState.sessionId);

  // Create new session with carried-over stats
  currentState = createNewState(null);
  currentState.points = oldPoints;
  currentState.fragments = oldFragments;
  currentState.totalCleared = oldCleared;
  currentState.terrorLevel = oldTerror;
  currentState.inventory = oldInventory;
  currentState.xiayanItems = oldXiayanItems;
  saveState();

  return generateDoors(oldTerror);
}

/**
 * Manually update game state (for the "update" button)
 */
export function refreshState(partial) {
  if (!currentState) return null;

  if (partial) {
    if (partial.player) Object.assign(currentState.player, partial.player);
    if (partial.sentinel) Object.assign(currentState.sentinel, partial.sentinel);
    if (partial.phase) currentState.phase = partial.phase;
    if (partial.bossPleasureValue !== undefined) currentState.bossPleasureValue = partial.bossPleasureValue;
  }

  currentState.updatedAt = new Date().toISOString();
  saveState();
  saveSession(currentState.sessionId);
  return getPublicState();
}

// ── Inventory management ──

/**
 * Add an item to player's inventory (from shop purchase or world discovery)
 */
export function addItem(item) {
  if (!currentState) return { error: "No active game session" };
  if (!currentState.inventory) currentState.inventory = [];

  const newItem = {
    id: "item-" + uuid().slice(0, 6),
    name: item.name,
    type: item.type || "misc", // weapon, equipment, consumable, misc
    description: item.description || "",
    equipped: false,
    acquiredAt: new Date().toISOString(),
    cost: item.cost || 0,
    stats: item.stats || null, // optional stat bonuses
  };

  currentState.inventory.push(newItem);
  if (item.cost) {
    currentState.points = Math.max(0, currentState.points - item.cost);
  }
  saveState();
  saveSession(currentState.sessionId);
  return { item: newItem, points: currentState.points };
}

/**
 * Give an item from inventory to Xia Yan — he remembers and may use it later
 */
export function giveItemToXiayan(itemId) {
  if (!currentState) return { error: "No active game session" };
  if (!currentState.inventory) currentState.inventory = [];
  if (!currentState.xiayanItems) currentState.xiayanItems = [];

  const idx = currentState.inventory.findIndex(item => item.id === itemId);
  if (idx === -1) return { error: "Item not found in inventory" };

  const [item] = currentState.inventory.splice(idx, 1);
  const xiayanItem = {
    ...item,
    givenAt: new Date().toISOString(),
    source: "华生赠送",
    usedInWorld: null, // set when he uses it
  };
  currentState.xiayanItems.push(xiayanItem);
  saveState();
  saveSession(currentState.sessionId);
  return { item: xiayanItem, inventory: currentState.inventory, xiayanItems: currentState.xiayanItems };
}

/**
 * Mark an item in 夏彦's possession as used (e.g., he used the weapon in battle)
 */
export function useXiayanItem(itemId, worldName) {
  if (!currentState || !currentState.xiayanItems) return { error: "No active game session" };
  const item = currentState.xiayanItems.find(i => i.id === itemId);
  if (!item) return { error: "Item not found" };
  item.usedInWorld = worldName || currentState.world?.name || "未知世界";
  item.usedAt = new Date().toISOString();
  saveState();
  saveSession(currentState.sessionId);
  return { item };
}

/**
 * Remove an item from inventory
 */
export function removeItem(itemId) {
  if (!currentState || !currentState.inventory) return { error: "No active game session" };
  const idx = currentState.inventory.findIndex(item => item.id === itemId);
  if (idx === -1) return { error: "Item not found" };
  currentState.inventory.splice(idx, 1);
  saveState();
  saveSession(currentState.sessionId);
  return { inventory: currentState.inventory };
}

/**
 * Equip/unequip an item from inventory
 */
export function toggleEquipItem(itemId) {
  if (!currentState || !currentState.inventory) return { error: "No active game session" };
  const item = currentState.inventory.find(i => i.id === itemId);
  if (!item) return { error: "Item not found" };
  item.equipped = !item.equipped;
  saveState();
  saveSession(currentState.sessionId);
  return { item };
}

/**
 * Get current public state (safe for client)
 */
export function getPublicState() {
  if (!currentState) return null;
  return {
    sessionId: currentState.sessionId,
    status: currentState.status,
    phase: currentState.phase,
    world: currentState.world,
    terrorLevel: currentState.terrorLevel,
    player: { ...currentState.player },
    sentinel: { ...currentState.sentinel },
    bossPleasureValue: currentState.bossPleasureValue,
    points: currentState.points,
    fragments: currentState.fragments || 0,
    totalCleared: currentState.totalCleared,
    inventory: currentState.inventory || [],
    xiayanItems: currentState.xiayanItems || [],
    startedAt: currentState.startedAt,
    updatedAt: currentState.updatedAt,
    narrativeLength: currentState.narrative.length,
    narrative: (currentState.narrative || []).slice(-50),
  };
}

/**
 * Get full narrative history for a session
 */
export function getHistory(sessionId) {
  const sid = sessionId || currentState?.sessionId;
  if (!sid) return [];

  // Try current state first
  if (currentState && currentState.sessionId === sid) {
    return currentState.narrative;
  }

  // Try loading from disk
  const file = path.join(SESSIONS_DIR, `${sid}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      return data.narrative || [];
    }
  } catch (e) {
    console.error("[sentinel-guide] Failed to load history:", e.message);
  }
  return [];
}

/**
 * List all session records
 */
export function listSessions() {
  // Refresh index from filesystem
  const diskSessions = [];
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"));
    for (const f of files) {
      const filePath = path.join(SESSIONS_DIR, f);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        diskSessions.push({
          sessionId: data.sessionId,
          worldName: data.world?.name || "未知世界",
          phase: data.phase,
          totalCleared: data.totalCleared || 0,
          points: data.points || 0,
          narrativeLength: data.narrative?.length || 0,
          startedAt: data.startedAt,
          updatedAt: data.updatedAt,
        });
      } catch {}
    }
    // Sort by startedAt desc
    diskSessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch {}

  // Merge with in-memory index
  sessionsIndex = diskSessions;
  saveIndex();
  return sessionsIndex;
}

/**
 * Load a historical session (read-only view)
 */
export function loadSession(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (e) {
    console.error("[sentinel-guide] Failed to load session:", e.message);
  }
  return null;
}

/**
 * Delete a session
 */
export function deleteSession(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {
    console.error("[sentinel-guide] Failed to delete session file:", e.message);
  }

  sessionsIndex = sessionsIndex.filter(s => s.sessionId !== sessionId);
  saveIndex();

  // If deleting current session, reset
  if (currentState && currentState.sessionId === sessionId) {
    currentState = null;
    try { if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); } catch {}
  }
  return true;
}

/**
 * Get current session (for WS state push)
 */
export function getCurrentSession() {
  return currentState;
}

// ── Internal helpers ──

function parseReply(reply) {
  let narration = "";
  let xiayan = "";

  const text = reply || "";
  console.log("[sg:parse] raw reply length:", text.length, "first 120 chars:", text.slice(0, 120));

  // Split [旁白] section from 夏彦's part.
  // Look for action brackets （ or dialogue quotes " at the start of a line
  // (NOT mid-sentence "夏彦" which would cut narration in half)
  const narrationMatch = text.match(/\[旁白\][\s\S]*?(?=\n（|\n"|$)/);
  if (narrationMatch) {
    narration = narrationMatch[0].replace(/^\[旁白\]\s*/, "").trim();
    xiayan = text.slice(narrationMatch[0].length).trim();
  } else {
    // Fallback: first paragraph is narration, rest is Xia Yan
    const parts = text.split(/\n\n+/);
    if (parts.length >= 2) {
      narration = parts[0].trim();
      xiayan = parts.slice(1).join("\n\n").trim();
    } else {
      xiayan = text.trim();
    }
  }

  // Clean up leading [旁白] from xiayan if present
  xiayan = xiayan.replace(/^\[旁白\]\s*/, "").trim();

  // Safety: if both empty, use raw text as xiayan
  if (!narration && !xiayan && text.trim()) {
    xiayan = text.trim();
  }

  console.log("[sg:parse] result — narration:", narration.length, "chars, xiayan:", xiayan.length, "chars");
  return { narration, xiayan };
}

function updateStateFromReply(parsed) {
  if (!currentState) return;

  const combined = (parsed.narration + " " + parsed.xiayan).toLowerCase();

  // Detect phase transitions from reply content
  if (combined.includes("门") && (combined.includes("浮现") || combined.includes("出现") || combined.includes("扇"))) {
    if (currentState.phase === "init") {
      currentState.phase = "door_select";
    }
  }

  if (combined.includes("boss") || combined.includes("首领") || combined.includes("守护者") || combined.includes("最终")) {
    if (currentState.phase === "exploring") {
      currentState.phase = "boss_encounter";
    }
  }

  // Detect sync rate / mental state changes from narration
  const syncMatch = combined.match(/同步率[：:]\s*(\d+)/);
  if (syncMatch) {
    currentState.sentinel.syncRate = parseInt(syncMatch[1]);
  }

  const overloadMatch = combined.match(/过载[：:]\s*(\d+)/);
  if (overloadMatch) {
    currentState.sentinel.senseOverload = parseInt(overloadMatch[1]);
  }

  const contamMatch = combined.match(/污染[：:]\s*(\d+)/);
  if (contamMatch) {
    currentState.player.contamination = parseInt(contamMatch[1]);
  }

  // Detect 欢愉值 changes
  const pleasureMatch = combined.match(/欢愉值[：:]\s*(\d+)/);
  if (pleasureMatch) {
    currentState.bossPleasureValue = parseInt(pleasureMatch[1]);
  }

  // Random small sync rate drift to make it feel dynamic
  if (Math.random() < 0.3) {
    const drift = Math.floor(Math.random() * 6) - 2; // -2 to +3
    currentState.sentinel.syncRate = Math.max(10, Math.min(100, currentState.sentinel.syncRate + drift));
  }
}

async function archiveSession(sessionId) {
  // Save final version of session
  if (currentState && currentState.sessionId === sessionId) {
    saveSession(sessionId);
  }

  // Update index
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));
      const existing = sessionsIndex.find(s => s.sessionId === sessionId);
      const entry = {
        sessionId: data.sessionId,
        worldName: data.world?.name || "未知世界",
        phase: data.phase,
        totalCleared: data.totalCleared || 0,
        points: data.points || 0,
        narrativeLength: data.narrative?.length || 0,
        startedAt: data.startedAt,
        updatedAt: data.updatedAt,
      };
      if (existing) {
        Object.assign(existing, entry);
      } else {
        sessionsIndex.unshift(entry);
      }
      saveIndex();
    }
  } catch {}
}

// ── Forum (夜话坛) ──

const FORUM_CATEGORIES = ["真人真事", "求助专区", "交易市场", "攻略分享", "寻人启事"];
const FORUM_TAGS = ["亲历", "劲", "回应", "后续", "求助", "交易", "攻略", "寻人"];
const FORUM_AUTHORS = [
  { name: "暗夜旅人", avatar: "🌑", level: 6 },
  { name: "桥洞风声", avatar: "📖", level: 7 },
  { name: "夜路独行", avatar: "🚲", level: 5 },
  { name: "妆奁旧事", avatar: "🪞", level: 4 },
  { name: "深蓝守望", avatar: "🔑", level: 4 },
  { name: "老陈的杂货铺", avatar: "📦", level: 7 },
  { name: "独翼渡鸦", avatar: "🏕️", level: 8 },
  { name: "暮雨寒", avatar: "🌧️", level: 3 },
  { name: "电磁猫", avatar: "📡", level: 6 },
  { name: "镜中人", avatar: "🪟", level: 2 },
];

function loadForumPosts() {
  try {
    if (fs.existsSync(FORUM_POSTS_FILE)) {
      return JSON.parse(fs.readFileSync(FORUM_POSTS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("[forum] Failed to load posts:", e.message);
  }
  return [];
}

function saveForumPosts(posts) {
  try {
    fs.mkdirSync(FORUM_DIR, { recursive: true });
    fs.writeFileSync(FORUM_POSTS_FILE, JSON.stringify(posts, null, 2), "utf-8");
  } catch (e) {
    console.error("[forum] Failed to save posts:", e.message);
  }
}

function loadForumMeta() {
  try {
    if (fs.existsSync(FORUM_META_FILE)) {
      return JSON.parse(fs.readFileSync(FORUM_META_FILE, "utf-8"));
    }
  } catch {}
  return { lastGenerated: 0, totalGenerated: 0 };
}

function saveForumMeta(meta) {
  try {
    fs.mkdirSync(FORUM_DIR, { recursive: true });
    fs.writeFileSync(FORUM_META_FILE, JSON.stringify(meta, null, 2), "utf-8");
  } catch (e) {
    console.error("[forum] Failed to save meta:", e.message);
  }
}

export function getForumPosts() {
  return loadForumPosts();
}

export async function generateForumPost() {
  const meta = loadForumMeta();
  const now = Date.now();
  if (now - meta.lastGenerated < 2 * 60 * 60 * 1000) {
    return null; // cooldown: 2 hours
  }

  const category = FORUM_CATEGORIES[Math.floor(Math.random() * FORUM_CATEGORIES.length)];
  const tag = FORUM_TAGS[Math.floor(Math.random() * FORUM_TAGS.length)];
  const author = FORUM_AUTHORS[Math.floor(Math.random() * FORUM_AUTHORS.length)];
  const commenters = FORUM_AUTHORS.filter(a => a.name !== author.name).sort(() => Math.random() - 0.5).slice(0, 2);

  const prompt = `你是一个无限流恐怖世界的论坛用户。请以第一人称写一篇论坛帖子。

【帖子要求】
- 分类：${category}
- 标签：[${tag}]
- 作者昵称：${author.name}
- 作者等级：Lv${author.level}
- 必须有标题（10-25字），标题前加【${tag}】
- 正文200-400字，第一人称，口语化
- 内容是无限流恐怖副本相关：副本经历、求助、交易物品、攻略分享、寻找失踪队友等
- 要有真实感——细节具体、语气自然
- 禁止使用"不是...，是..."句式
- 如果合适，提到具体的副本场景（中式古宅/西式城堡/荒野山洞/废弃医院/雪山哨站/都市废墟等）
- 可以提到哨兵/向导/精神体等设定

请输出JSON格式（只输出JSON，不要其他内容）：
{"title": "...", "body": "..."}`;

  try {
    const reply = await askJiushi({
      systemPrompt: "你是一个无限流幸存者论坛的活跃用户。你的回复要自然、真实、有细节。只输出纯JSON，不要markdown代码块。",
      userContent: prompt,
      maxTokens: 800,
      temperature: 0.9,
      timeoutMs: 30000,
    });

    let json = reply;
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) json = jsonMatch[0];
    const data = JSON.parse(json);

    const post = {
      id: "fp-" + uuid().slice(0, 8),
      title: data.title,
      tag,
      category,
      preview: data.body.slice(0, 150) + "……",
      body: data.body,
      author: author.name,
      authorLevel: author.level,
      avatar: author.avatar,
      views: Math.floor(Math.random() * 500) + 50,
      likes: Math.floor(Math.random() * 40),
      comments: [
        {
          id: "fc-" + uuid().slice(0, 6),
          author: commenters[0]?.name || "匿名玩家",
          authorLevel: commenters[0]?.level || 2,
          content: generateForumComment(data.body, commenters[0]?.name || "匿名玩家"),
          score: Math.floor(Math.random() * 9) + 1,
          createdAt: "刚刚",
        },
      ],
      bookmarks: Math.floor(Math.random() * 20),
      createdAt: "刚刚",
    };

    const posts = loadForumPosts();
    posts.unshift(post);
    if (posts.length > 50) posts.length = 50;
    saveForumPosts(posts);
    saveForumMeta({ lastGenerated: now, totalGenerated: meta.totalGenerated + 1 });
    console.log("[forum] Generated new post:", post.title);
    return post;
  } catch (e) {
    console.error("[forum] Failed to generate post:", e.message);
    return null;
  }
}

function generateForumComment(body, commenterName) {
  const replies = [
    "天哪……这也太吓人了。你们没事真的太好了。",
    "感谢分享！我们队正准备进类似的副本，这个信息太有用了。",
    "我也是在这个副本里遇到了一模一样的情况！！但我们的处理方式不一样——",
    "作为一个刚进深渊的新人，看完这个帖子后背发凉……",
    "已收藏。这种经验帖真的太珍贵了。",
    "问一下楼主，你们队是什么配置过的？我们配置差不多想参考一下。",
    "类似的情况遇到过。补充一点：带精神力恢复剂，越多越好。",
    "这就去告诉我的向导。我们队正要进一个类似的副本。",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}
