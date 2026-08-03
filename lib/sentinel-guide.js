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

// Ensure directories
try { fs.mkdirSync(SG_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch {}

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
    fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2), "utf-8");
  } catch (e) {
    console.error("[sentinel-guide] Failed to save state:", e.message);
  }
}

function saveSession(sessionId) {
  if (!currentState || currentState.sessionId !== sessionId) return;
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
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
  // Build conversation history for AI — last N turns of narrative
  const recent = narrative.slice(-(maxTurns || 20));
  return recent.map(entry => {
    if (entry.role === "narration") {
      return { role: "user", content: `[旁白]\n${entry.content}` };
    } else if (entry.role === "xiayan") {
      return { role: "assistant", content: entry.content };
    } else if (entry.role === "player") {
      return { role: "user", content: `华生的行动：${entry.content}` };
    }
    return { role: "user", content: entry.content || "" };
  }).filter(m => m.content);
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

请生成初始场景：[旁白]用第三人称描述空间的出现与两人的状态，然后夏彦的第一反应和对话。注意：旁白可以提到"精神体若隐若现""五感开始异变"等暗示，但夏彦本人还无法理解这些。放慢节奏，不要跳过任何细节。`;

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

  // Add player action to narrative
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

  const historyForAI = buildHistoryForAI(currentState.narrative, 15);
  const userContent = `${ctx}${phaseHint}\n\n华生的行动：${actionText}\n\n请生成接下来的场景：[旁白]环境描述和剧情推进，然后是夏彦的对话和动作。`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      history: historyForAI,
      maxTokens: 2500,
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
      maxTokens: 1200,
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
      maxTokens: 2500,
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
  // Parse [旁白] and 夏彦 dialogue from AI reply
  let narration = "";
  let xiayan = "";

  const text = reply || "";

  // Try [旁白] marker
  const narrationMatch = text.match(/\[旁白\][\s\S]*?(?=\（|夏彦|$)/);
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
