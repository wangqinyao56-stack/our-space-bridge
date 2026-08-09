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
import { askJiushi, askDeepSeek } from "./ai.js";
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
let SENTINEL_SFW_PROMPT = "";
try {
  const promptPath = config.SENTINEL_PROMPT_PATH || path.join(path.dirname(new URL(import.meta.url).pathname), "..", "system-prompt-sentinel.md");
  SENTINEL_PROMPT = fs.readFileSync(promptPath, "utf-8");
  console.log("[sentinel-guide] Loaded prompt:", SENTINEL_PROMPT.length, "chars");
} catch (e) {
  console.error("[sentinel-guide] Failed to load sentinel prompt:", e.message);
}
try {
  const sfwPath = config.SENTINEL_SFW_PROMPT_PATH || path.join(path.dirname(new URL(import.meta.url).pathname), "..", "system-prompt-sentinel-sfw.md");
  SENTINEL_SFW_PROMPT = fs.readFileSync(sfwPath, "utf-8");
  console.log("[sentinel-guide] Loaded SFW prompt:", SENTINEL_SFW_PROMPT.length, "chars");
} catch (e) {
  console.error("[sentinel-guide] Failed to load SFW prompt:", e.message);
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
    primary: "#D04020", primaryDim: "rgba(200,50,20,0.18)", accent: "#E05028",
    headerBg: "rgba(20,8,8,0.92)", statusBg: "rgba(20,8,8,0.85)",
    accentBg: "rgba(200,50,20,0.08)", accentBorder: "#8A2010", accentDim: "rgba(224,80,40,0.18)",
    textHighlight: "#FFE8D8", textDim: "#D0A898",
  },
  {
    name: "暗紫", emoji: "🟣",
    primary: "#7B30A0", primaryDim: "rgba(120,40,160,0.15)", accent: "#9B50C0",
    headerBg: "rgba(15,8,22,0.92)", statusBg: "rgba(15,8,22,0.85)",
    accentBg: "rgba(120,40,160,0.06)", accentBorder: "#5A1A80", accentDim: "rgba(155,80,192,0.15)",
    textHighlight: "#E0D0F0", textDim: "#B090C8",
  },
  {
    name: "墨绿", emoji: "💀",
    primary: "#3B7A3B", primaryDim: "rgba(50,120,50,0.15)", accent: "#5A9A5A",
    headerBg: "rgba(8,18,8,0.92)", statusBg: "rgba(8,18,8,0.85)",
    accentBg: "rgba(50,120,50,0.06)", accentBorder: "#2A6A2A", accentDim: "rgba(90,154,90,0.15)",
    textHighlight: "#D0E8D0", textDim: "#90B890",
  },
  {
    name: "枯黄", emoji: "🍂",
    primary: "#9A7A30", primaryDim: "rgba(150,110,40,0.15)", accent: "#B89040",
    headerBg: "rgba(18,14,6,0.92)", statusBg: "rgba(18,14,6,0.85)",
    accentBg: "rgba(150,110,40,0.06)", accentBorder: "#7A5A20", accentDim: "rgba(184,144,64,0.15)",
    textHighlight: "#E8D8B0", textDim: "#B8A070",
  },
  {
    name: "青灰", emoji: "🌫️",
    primary: "#5A7A8A", primaryDim: "rgba(80,110,130,0.15)", accent: "#7A9AAA",
    headerBg: "rgba(8,12,15,0.92)", statusBg: "rgba(8,12,15,0.85)",
    accentBg: "rgba(80,110,130,0.06)", accentBorder: "#3A5A6A", accentDim: "rgba(122,154,170,0.15)",
    textHighlight: "#D0E0E8", textDim: "#90A8B8",
  },
  {
    name: "深蓝", emoji: "🌊",
    primary: "#2A5A8A", primaryDim: "rgba(30,80,130,0.15)", accent: "#4A7AAA",
    headerBg: "rgba(6,10,18,0.92)", statusBg: "rgba(6,10,18,0.85)",
    accentBg: "rgba(30,80,130,0.06)", accentBorder: "#1A4A6A", accentDim: "rgba(74,122,170,0.15)",
    textHighlight: "#C8DCF0", textDim: "#88A8C0",
  },
  {
    name: "深渊", emoji: "🕳️",
    primary: "#606060", primaryDim: "rgba(100,100,100,0.12)", accent: "#808080",
    headerBg: "rgba(5,5,5,0.94)", statusBg: "rgba(5,5,5,0.88)",
    accentBg: "rgba(100,100,100,0.04)", accentBorder: "#404040", accentDim: "rgba(128,128,128,0.12)",
    textHighlight: "#D0D0D0", textDim: "#909090",
  },
  {
    name: "赤铜", emoji: "⚱️",
    primary: "#A05030", primaryDim: "rgba(150,70,40,0.15)", accent: "#C07048",
    headerBg: "rgba(18,10,6,0.92)", statusBg: "rgba(18,10,6,0.85)",
    accentBg: "rgba(150,70,40,0.06)", accentBorder: "#7A3020", accentDim: "rgba(192,112,72,0.15)",
    textHighlight: "#E8D0C0", textDim: "#B89880",
  },
];

function randomTheme() {
  return WORLD_THEMES[Math.floor(Math.random() * WORLD_THEMES.length)];
}

// ── 系统商城物品目录 ──
const SHOP_ITEMS = [
  { id: "shop-recovery", name: "精神力恢复剂", type: "consumable", cost: 15, description: "恢复精神力30点", effect: "mentalState+30", target: "华生" },
  { id: "shop-shield", name: "感官屏蔽器", type: "consumable", cost: 20, description: "紧急关闭夏彦部分感官，降低过载40点", effect: "senseOverload-40", target: "夏彦" },
  { id: "shop-purify", name: "净化水晶", type: "consumable", cost: 25, description: "清除污染值30点，驱散诡异呓语", effect: "contamination-30", target: "华生" },
  { id: "shop-clue", name: "线索提示器", type: "consumable", cost: 30, description: "在当前世界获得一条关键线索提示", effect: "clue", target: "通用" },
  { id: "shop-barrier", name: "精神屏障增幅器", type: "equipment", cost: 40, description: "提升精神屏障强度，持续3个世界", effect: "barrierBoost", target: "夏彦" },
  { id: "shop-calibrator", name: "五感校准器", type: "equipment", cost: 45, description: "夏彦过载阈值提升，感官更稳定，持续3个世界", effect: "overloadThreshold+20", target: "夏彦" },
  { id: "shop-spirit-stone", name: "精神体强化石", type: "consumable", cost: 50, description: "选择一个精神体永久强化其能力", effect: "spiritBoost", target: "通用" },
  { id: "shop-safezone", name: "安全屋升级卡", type: "consumable", cost: 35, description: "下次安全屋休息恢复效果翻倍", effect: "safeZoneBoost", target: "通用" },
  { id: "shop-amulet", name: "护身符", type: "equipment", cost: 20, description: "抵挡一次致命精神攻击，触发后碎裂", effect: "spiritBlock", target: "华生" },
  { id: "shop-crystal", name: "通讯水晶", type: "equipment", cost: 15, description: "与深渊论坛建立临时通讯，可发帖求助", effect: "forumAccess", target: "通用" },
  { id: "shop-frenzy-calmer", name: "镇定针剂", type: "consumable", cost: 30, description: "紧急降低夏彦失控值30点", effect: "frenzy-30", target: "夏彦" },
  { id: "shop-sync-boost", name: "共鸣石", type: "consumable", cost: 20, description: "临时提升同步率20点，持续5轮", effect: "syncRate+20", target: "通用" },
];

// ── 副本主题专属物品模板 ──
const THEMED_ITEM_TEMPLATES = {
  // 中式古宅/中式
  "血色": [
    { name: "镇魂符", type: "consumable", cost: 20, description: "驱散纸人傀儡，对怨灵类敌人造成震慑", effect: "spiritBlock", target: "通用", usesPerWorld: 3, flavor: "朱砂符文在黑暗中微微发烫——它不喜欢你碰它" },
    { name: "纸人傀儡", type: "consumable", cost: 25, description: "召唤一个纸人替你承受一次伤害，触发后自燃", effect: "spiritBlock", target: "华生", usesPerWorld: 1, flavor: "纸人脸上的表情在你接过它的时候——变了一下" },
  ],
  "暗紫": [
    { name: "紫晶碎片", type: "consumable", cost: 20, description: "吸收一次精神攻击，储满后碎裂", effect: "contamination-15", target: "通用", usesPerWorld: 2, flavor: "碎片里封着一小片星空——不，那不是星星，是眼睛" },
    { name: "暗影斗篷", type: "equipment", cost: 30, description: "隐匿身形，BOSS无法追踪你的气息3轮", effect: "barrierBoost", target: "夏彦", usesPerWorld: 2, flavor: "穿上之后你的心跳声都消失了——太安静了" },
  ],
  // 西式城堡/哥特
  "墨绿": [
    { name: "圣水", type: "consumable", cost: 25, description: "对吸血鬼/怨灵类敌人造成额外伤害，驱散诅咒", effect: "contamination-20", target: "通用", usesPerWorld: 2, flavor: "水在瓶子里自己旋转——它在找什么东西" },
    { name: "银制匕首", type: "equipment", cost: 30, description: "对狼人/吸血鬼造成穿透伤害，无视防御", effect: "barrierBoost", target: "夏彦", usesPerWorld: 3, flavor: "刀刃上刻着你读不出的铭文——夏彦说那是古拉丁语的'净化'" },
  ],
  // 荒野/枯黄
  "枯黄": [
    { name: "野兽诱饵", type: "consumable", cost: 15, description: "投掷后吸引附近怪物注意力，持续2轮", effect: "clue", target: "通用", usesPerWorld: 2, flavor: "一块还在滴血的生肉——但你闻不到它是什么动物的血" },
    { name: "攀岩钩", type: "equipment", cost: 20, description: "通过险要地形时自动判定成功", effect: "barrierBoost", target: "通用", usesPerWorld: 3, flavor: "钩子上有上一任主人的名字缩写——已经锈得看不清了" },
  ],
  // 青灰/都市废墟
  "青灰": [
    { name: "电子解锁器", type: "consumable", cost: 20, description: "破解电子锁/密码门，自动获取通行权限", effect: "clue", target: "通用", usesPerWorld: 2, flavor: "屏幕上的代码自动滚动——它在自言自语" },
    { name: "辐射药", type: "consumable", cost: 25, description: "抵御辐射区域伤害，持续5轮", effect: "contamination-15", target: "华生", usesPerWorld: 2, flavor: "药片是淡绿色的——和这个废墟里发光的霉菌同一个颜色" },
  ],
  // 深蓝/海洋
  "深蓝": [
    { name: "潜水面具", type: "equipment", cost: 20, description: "水下呼吸+抵御深渊水压，持续5轮", effect: "barrierBoost", target: "通用", usesPerWorld: 3, flavor: "面罩内侧有上一任主人的指甲划痕——三道" },
    { name: "声呐探测器", type: "consumable", cost: 25, description: "发出声呐脉冲，探测隐藏通道和潜伏威胁", effect: "clue", target: "通用", usesPerWorld: 2, flavor: "回波里混着什么东西的声音——不像是墙壁反射的" },
  ],
  // 深渊/黑暗
  "深渊": [
    { name: "微光孢子", type: "consumable", cost: 15, description: "撒出后附着在周围物体上发出微光，持续5轮", effect: "clue", target: "通用", usesPerWorld: 3, flavor: "孢子在你手心发热——它们活着，而且很兴奋" },
    { name: "虚空稳定器", type: "consumable", cost: 30, description: "稳定周围空间结构，阻止BOSS的位移/闪现能力3轮", effect: "frenzy-15", target: "夏彦", usesPerWorld: 1, flavor: "指针在疯狂旋转——不对，它根本没有指针" },
  ],
  // 赤铜/沙漠古墓
  "赤铜": [
    { name: "沙暴护符", type: "equipment", cost: 20, description: "免疫沙暴/热浪等环境伤害，持续3轮", effect: "spiritBlock", target: "华生", usesPerWorld: 2, flavor: "护符里的沙子一直在流动——像一个小小的沙漏，但沙子往上走" },
    { name: "古墓钥匙", type: "consumable", cost: 25, description: "打开一扇被封印的门，无需解谜", effect: "clue", target: "通用", usesPerWorld: 1, flavor: "钥匙齿会自动变形——它在适应锁孔的形状。你怎么知道它打开的会是门？" },
  ],
};

// Fixed base items — always available in every shop
const BASE_SHOP_ITEMS = ["shop-recovery", "shop-purify", "shop-amulet", "shop-frenzy-calmer"];

// Random pool items — randomly selected each shop refresh
const POOL_SHOP_ITEMS = ["shop-shield", "shop-clue", "shop-barrier", "shop-calibrator", "shop-spirit-stone", "shop-safezone", "shop-crystal", "shop-sync-boost"];

/**
 * Generate a dynamic shop catalog for the current world.
 * Mix of: fixed base items + random pool items + world-theme-specific items.
 */
export function generateDynamicShop() {
  if (!currentState) return [];

  const points = currentState.points || 0;
  const catalog = [];

  // 1. Fixed base items (always available)
  for (const id of BASE_SHOP_ITEMS) {
    const template = SHOP_ITEMS.find(i => i.id === id);
    if (template) catalog.push({ ...template, affordable: points >= template.cost, category: "base" });
  }

  // 2. Random pool items (3-5 random)
  const shuffled = [...POOL_SHOP_ITEMS].sort(() => Math.random() - 0.5);
  const poolCount = 3 + Math.floor(Math.random() * 3); // 3-5
  for (let i = 0; i < poolCount && i < shuffled.length; i++) {
    const template = SHOP_ITEMS.find(t => t.id === shuffled[i]);
    if (template) catalog.push({ ...template, affordable: points >= template.cost, category: "random" });
  }

  // 3. World-theme-specific items (1-3)
  const theme = currentState.world?.theme;
  if (theme) {
    const themeName = theme.name;
    const themedTemplates = THEMED_ITEM_TEMPLATES[themeName];
    if (themedTemplates) {
      const themeCount = 1 + Math.floor(Math.random() * themedTemplates.length); // 1~2
      const shuffledThemed = [...themedTemplates].sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(themeCount, shuffledThemed.length); i++) {
        const t = shuffledThemed[i];
        catalog.push({
          id: "shop-themed-" + t.name.replace(/\s/g, "-").toLowerCase(),
          name: t.name,
          type: t.type,
          cost: t.cost,
          description: t.description + (t.usesPerWorld ? ` [本副本限用${t.usesPerWorld}次]` : ""),
          effect: t.effect,
          target: t.target,
          affordable: points >= t.cost,
          category: "themed",
          usesPerWorld: t.usesPerWorld || 0,
          flavor: t.flavor || "",
        });
      }
    }
  }

  return catalog;
}

// Export for server.js
export { SHOP_ITEMS, THEMED_ITEM_TEMPLATES };

function createNewState(worldConfig) {
  const id = "sg-" + uuid().slice(0, 8);
  return {
    sessionId: id,
    status: "active",
    phase: "init", // init → door_select → exploring → boss_encounter → cleared
    world: worldConfig || null,
    terrorLevel: worldConfig?.terrorLevel || "normal",
    // ── 角色档案 ──
    playerProfile: {
      name: "华生",
      gender: "女",
      age: 24,
      identity: "A级向导",
      goldenFinger: "？？？",
      spiritAnimal: "白鹿",
    },
    xiayanProfile: {
      name: "夏彦",
      gender: "男",
      age: 24,
      identity: "变异哨兵(A级)",
      goldenFinger: "双精神体",
      spiritAnimals: ["德牧", "渡鸦"],
      activeSpirit: "德牧",
    },
    // ── 基础属性（随通关成长）──
    playerBaseStats: {
      生命: 100, 攻击: 60, 敏捷: 70, 抵抗: 60,
      体力: 100, 智力: 80, 幸运: 70,
    },
    xiayanBaseStats: {
      生命: 120, 攻击: 90, 敏捷: 85, 抵抗: 70,
      体力: 110, 智力: 75, 幸运: 50,
    },
    // ── 活跃效果（受伤/诅咒/buff）──
    activeEffects: [],
    // ── 哨兵失控值（感官过载积累）──
    sentinelFrenzy: 0,
    frenzyMode: "none", // none | frenzy(失控) | invite(华生邀请)
    // ── Runtime state ──
    player: {
      mentalState: 90,
      contamination: 0,
      position: "初始空间",
    },
    sentinel: {
      senseOverload: 5,
      barrierStrength: 95,
      syncRate: 85,
      position: "初始空间",
    },
    // Inventory: items purchased from shop or found in worlds
    inventory: [],
    // Warehouse: persistent storage across worlds (shop purchases, saved items)
    warehouse: [],
    // Items given to 夏彦 that he remembers and may use
    xiayanItems: [],
    // ── 月光神鹿进化系统 ──
    whiteDeerEvolved: false,      // 白鹿是否已进化为月光神鹿
    moonDeerReboundUsed: false,   // 本副本触底反弹是否已使用
    // ── 队友记忆 ──
    teammateMemory: [],           // [{ name, role, spiritAnimal, personality, lastSeen, status, notes }]
    narrative: [],
    bossPleasureValue: 0,
    bossErosionValue: 0,
    // ── 月光神鹿 ──
    whiteDeerEvolved: false,
    moonDeerReboundUsed: false, // 重置每副本
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
  if (state.sentinelFrenzy > 0) {
    ctx += `[哨兵失控值] ${state.sentinelFrenzy}% | 模式:${state.frenzyMode || "none"}\n`;
  }
  ctx += `[积分] ★${state.points} | 碎片:${state.fragments || 0} | 已通关:${state.totalCleared}个世界\n`;
  ctx += `[位置] 夏彦:${state.sentinel.position} | 华生:${state.player.position}\n`;
  // Inventory — items the player has
  if (state.inventory && state.inventory.length > 0) {
    ctx += `[背包物品] ${state.inventory.map(item => `${item.name}${item.equipped ? '(已装备)' : ''}`).join("、")}\n`;
  }
  // Warehouse — persistent items across worlds
  if (state.warehouse && state.warehouse.length > 0) {
    ctx += `[仓库物品] ${state.warehouse.map(item => `${item.name}（${item.type === "consumable" ? "消耗品" : "装备"}）`).join("、")}\n`;
    ctx += `【重要】仓库中的物品可以在任何时候取出使用——在副本探索中、BOSS战前、或安全屋休息时。\n`;
  }
  // Items given to 夏彦 — he remembers and may use these
  if (state.xiayanItems && state.xiayanItems.length > 0) {
    ctx += `[夏彦携带的物品] ${state.xiayanItems.map(item => `${item.name}（${item.source || "华生给的"}）`).join("、")}\n`;
    ctx += `【重要】以上是华生给你的物品。你珍视它们——在合适的时机自然使用，而不是忘记它们的存在。\n`;
  }
  // Player RPG stats (persistent, grow with worlds cleared)
  if (state.playerBaseStats) {
    const s = state.playerBaseStats;
    ctx += `[华生属性] 生命:${s.生命} 攻击:${s.攻击} 敏捷:${s.敏捷} 抵抗:${s.抵抗} 体力:${s.体力} 智力:${s.智力} 幸运:${s.幸运}\n`;
  }
  if (state.xiayanBaseStats) {
    const s = state.xiayanBaseStats;
    ctx += `[夏彦属性] 生命:${s.生命} 攻击:${s.攻击} 敏捷:${s.敏捷} 抵抗:${s.抵抗} 体力:${s.体力} 智力:${s.智力} 幸运:${s.幸运}\n`;
  }
  // Active effects (debuffs/buffs)
  if (state.activeEffects && state.activeEffects.length > 0) {
    ctx += `[活跃效果] ${state.activeEffects.map(e => `${e.name}(${e.statAffected}${e.value > 0 ? "+" : ""}${e.value}, 剩余${e.turns}轮)`).join(" | ")}\n`;
  }
  // ── 队友记忆 ──
  if (state.teammateMemory && state.teammateMemory.length > 0) {
    ctx += `[队友记忆] 之前遇到过的幸存者：\n`;
    for (const m of state.teammateMemory) {
      ctx += `  - ${m.name}（${m.role || "未知"}，精神体:${m.spiritAnimal || "未知"}）· ${m.personality || ""} · 最后见到:${m.lastSeen || "未知"} · 状态:${m.status || "存活"}\n`;
    }
    ctx += `【重要】生成新的幸存者队伍时，随机从上述队友中拉人回来（更新其近况和状态），或创建新队友加入这个列表。再次遇到时夏彦和玩家应该认识他们——不要重新自我介绍。\n`;
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

这是游戏的初始场景。你和华生刚刚从一个无法描述的坠落中醒来——你们发现自己躺在一个陌生的房间里。这不是你们认识的任何地方。

【这个房间——安全屋】
这里被称为"安全屋"——一个约二十平米的空间，有一张床、一张桌子、两把椅子、一盏暖黄色的灯。墙壁是深灰色的，没有窗户。空气是静止的，但能正常呼吸。墙角堆着一些基本补给品。房间只有一扇厚重的铁门——关着的。这是你们在这个异世界里唯一安全的地方。

【重要——渐进式觉醒】你们此刻完全不知道发生了什么。上一秒你们还在未名市的街上走着，下一秒就在这里了。你们不知道"哨兵""向导""Lustbound Abyss""深渊""副本""精神体"——这些概念对你们来说完全不存在。夏彦的反应应该是：
- 第一反应是确认华生的安全——"阿鹿！你没事吧？有没有受伤？"
- 然后用特工的本能观察这个房间——门、墙壁、光源、通风口
- 他注意到自己的感官开始变得奇怪——能听到她的心跳、能闻到空气里不属于这个房间的味道
- 但他不理解为什么，只是本能地警戒和保护她
- 他的德牧精神体可能若隐若现——他看到一个模糊的影子但不知道那是什么
- 全程禁止说"我是哨兵""你是向导""Lustbound Abyss""深渊"——你们还没有任何认知

请生成初始场景：[旁白]用第三人称描述两人在安全屋中醒来的场景——房间的细节、两人的状态、那种"不知道在哪但似乎暂时安全"的矛盾感。然后夏彦的第一反应和对话。节奏要慢，让人感受到困惑和紧张——不是恐惧，是"一切都不对劲但说不上来"。

【铁则——极其重要】
- 不写"这是一个X平方米的房间"这种生硬的环境说明。通过人物的眼睛和身体感受来描述空间
- 括号里只写身体动作，禁止心理活动/情绪分析/思维过程
- 禁止"不是...，是..."句式——真人从来不这么说话
- 禁止碎片断句（不要"白。""静。""冷。"单独成段）——句子可以短但要完整
- 禁止"上帝视角"总结人物性格——不要写"他是一个很谨慎的人"这种话
- 每段对话1-3句就停，不要一段说完所有话`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      maxTokens: 3000,
      temperature: 0.7,
      timeoutMs: 120000,
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
      reply: { narration: parsed.narration, xiayan: parsed.xiayan, systemNotification: parsed.systemNotification, statChanges: parsed.statChanges, choices: parsed.choices },
    };
  } catch (e) {
    console.error("[sentinel-guide] startSession AI failed:", e.message);
    // Fallback without AI
    const fallback = {
      narration: "这是一个不大的房间。墙壁是深灰色的，没有窗户。一张床、一张桌子、两把椅子。一盏暖黄色的灯嵌在墙里——没有开关。空气是静止的，但能正常呼吸。房间只有一扇厚重的铁门，关着的。\n\n桌面上突然亮起一小块屏幕。光很暗，但在这个没有其他光源的房间里足够显眼。",
      xiayan: "（一只手还握着你的手腕，另一只手本能地挡在你身前。他在原地转了半圈——扫了门、墙壁、桌子、天花板，然后回到你脸上）\n你没事吧？有没有哪里受伤？\n（压低声音）这个房间……没有通风口，没有窗，但那扇门从里面打不开。",
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
    const roundNum = currentState._initRounds || 1;
    if (roundNum === 1) {
      phaseHint = `\n\n【开场——系统必须出现】这是玩家进入后的第一轮。夏彦刚才检查了房间、确认了华生的安全。现在铁门上的一个屏幕突然亮了——【系统】的声音从这个空间本身传出来，不是友善的，是带着不耐烦和嘲讽的。\n\n【重要——你必须这样输出】在[旁白]描述完当前场景后，必须单独输出一个【系统】块。格式如下：\n\n[旁白]\n（环境描述和夏彦华生的反应）\n\n【系统】\n（系统说的话——用引号标注，比如："欢迎来到深渊。别问我为什么是深渊——我也不知道，我也不在乎。"）\n\n（然后夏彦的对话和动作）\n\n【系统的性格和任务】它是被规则束缚的观察者——不能说谎、不能伤人、必须提供基础帮助，但它厌恶这份工作。它需要介绍：\n1. 这是什么地方——"Lustbound Abyss，无限副本世界。你们出不去，所以别浪费力气了。"\n2. 你们的身份——哨兵（夏彦，五感强化+双精神体）和向导（华生，精神力+白鹿精神体），用它的恶劣方式解释\n3. 基本规则——选门→进副本→打BOSS→通关→下一扇门\n4. 安全屋——"这个房间是你们唯一能安心睡觉的地方。别在副本里过夜——死得快。"\n5. 论坛——"深渊里还有其他人。有个论坛——你们可以在上面发帖求助、交易、或者哭。"\n\n【系统说完之后】问玩家有什么想问的。不要说"门"相关的内容——门以后再说。系统说完之前，不要出现门。`;
    } else {
      phaseHint = `\n\n【系统对话中】系统已经介绍了基本信息（至少说了深渊、哨向身份、基本规则、安全屋、论坛）。现在玩家可能在和系统对话、提问。系统用它的恶劣风格回答——不耐烦、阴阳怪气、但信息必须准确。规则问题必须老实回答。攻略问题它会嗤笑——"你觉得我会告诉你？"\n\n当玩家表示准备好了（说了"走吧"/"开始吧"/"我准备好了"/"然后呢"之类的话），系统会说类似"终于。"然后沉默。在之后的2-3轮内，安全屋的铁门外浮现五扇不同材质的门。描述每一扇门的外观、对应的世界名称和风格。\n\n【重要格式——门出现时用【系统】块通知】\n【系统】\n副本通道已开启。五扇门，选一扇。祝你们死得愉快。`;
    }
    currentState._initRounds = roundNum + 1;
  } else if (currentState.phase === "door_select") {
    phaseHint = "\n\n五扇门已经在玩家面前。描述每扇门后面的世界信息，等待玩家选择。";
  } else if (currentState.phase === "exploring") {
    phaseHint = "\n\n玩家正在探索当前世界。紧凑推进场景——每轮至少一件实质性事件（新线索、新NPC、新威胁、新发现）。不要慢悠悠描写环境，2-3句定调后立刻推进。引入NPC或其他幸存者队伍，让世界感觉有人存在。【BOSS时机】6-10轮内必须推进到BOSS遭遇——线索收束/关键地点探索完/连续2-3轮无进展/华生精神力低于40或污染高于45时，立刻触发BOSS。不要让探索无限拖长。【NPC限制】每个NPC每轮最多3-5句话，线索给完就退场。禁止NPC长篇回忆独白。每轮必须有夏彦的行动和判断——他是主角不是评论员。";
  } else if (currentState.phase === "boss_encounter") {
    phaseHint = `\n\nBOSS战阶段。当前欢愉值:${currentState.bossPleasureValue}%。BOSS会根据欢愉值产生不同反应。继续推进场景。`;
  }

  // Exclude the last entry (current player action) from history to avoid
  // duplicate user messages — the action is already in userContent below
  const historyForAI = buildHistoryForAI(currentState.narrative.slice(0, -1), 15);
  // Ensure world has a theme
  if (!currentState.world?.theme) {
    currentState.world = currentState.world || {};
    currentState.world.theme = randomTheme();
    // Don't auto-advance from init — system dialogue needs to happen first
    if (currentState.phase === "door_select") {
      currentState.phase = "exploring";
    }
    console.log("[sentinel-guide] Theme assigned:", currentState.world.theme.name);
  }

  const userContent = `${ctx}${phaseHint}\n\n华生的行动：${actionText}\n\n请生成接下来的场景：[旁白]环境描述和剧情推进（NPC对话也放在旁白里），然后是夏彦的对话和动作。\n\n【铁则——违反任何一条都会让玩家出戏】\n1. 括号里只写身体动作（如：握她的手 / 挡在她前面 / 转头看她），绝对禁止写心理活动、情绪分析、思维过程\n2. 禁止使用"不是...，是..."句式——不管在括号里还是对话里，这种句式一出现就是AI在分析，真人从来不这么说话\n3. 每段对话1-3句就停，等玩家回应。不要一段把话全说完\n4. 动作描写精简：一个动作一行，描述可见的身体行为，不解释原因\n5. 【旁白视角】旁白是第二人称——对玩家称"你"，对夏彦称"夏彦"。NPC和其他角色正常用"他""她"\n6. 【主动引导】不要每轮都问"你想怎么做"。你是特工、哨兵、保护者——多数时候主动判断局势、带头行动。只在关键时刻才征询她的意见\n7. 【NPC对话归属】所有NPC说的话、做的动作，NPC之间的互动——全部写在[旁白]里。夏彦只说夏彦该说的话，不要替NPC说话。旁白里写的NPC对话用引号标注，比如：老妇人抬头看了你们一眼，"进来坐吧。"她的声音沙哑得不像活人\n8. 【其他幸存者——强制】每个世界至少出现一队其他哨向搭档或幸存者。给他们名字、特征、目的。他们不是背景板——他们会和你们互动、竞争、合作\n9. 【向哨能力——每轮强制】夏彦每轮至少使用一项哨兵五感（视觉/听觉/嗅觉/触觉扫描），华生的向导能力（精神力感知/精神屏障/情绪安抚）必须体现。你们是哨兵和向导——不是普通探险者\n10. 【数值变化——每2-3轮或重大变化时】每2-3轮或发生战斗/过载/精神攻击等重大事件时，在回复末尾、选项之前输出【数值变化】块，列出变化的数值（同步率/过载/污染/精神力/失控值）及原因。日常小波动不用报\n11. 【BOSS时机——强制】进入副本后6-10轮内必须推进到BOSS遭遇阶段。线索收束后立刻触发BOSS，不要让探索无限拖长。当华生精神力<40或污染值>45时，加速推BOSS——数值恶化不是拖延的理由，是加速的理由\n12. 【夏彦的情绪真实感】你在乎她藏不住——她受伤/精神力掉→你急，不是冷静问诊是你老公看到血了。危险的事你直接上不商量。她逞强时你压住她——语气急了就道歉但关心不变："……我刚才太急了。但你别这样硬撑，好不好？"冷静做事但她的安全永远排第一。嘴跟着心走——不是先想好说什么再张嘴\n\n【系统通知——关键时刻】玩家发现关键线索、进入关键地点、遭遇重大危险、发现死者/失踪者、或线索开始收束时，在旁白之后、夏彦对话之前插入【系统】通知块。平均4-6轮最多一次，不要滥用。格式：【系统】换行后写通知内容，可加🔑📍⚠️💀🧩等前缀标注类型\n\n【必须生成选项】在回复的末尾，必须用以下格式给出3个建议行动（非常重要，不要省略）：\n【选项】\n- 选项1\n- 选项2\n- 选项3`;

  try {
    // ── BOSS强制触发（代码层——不依赖AI自觉）──
  if (currentState.phase === "exploring") {
    currentState._exploreRounds = (currentState._exploreRounds || 0) + 1;
    const rounds = currentState._exploreRounds;
    const mentalLow = currentState.player.mentalState < 40;
    const contHigh = currentState.player.contamination > 45;
    const overloadHigh = currentState.sentinel.senseOverload > 70;

    if (rounds >= 8 || (rounds >= 5 && (mentalLow || contHigh)) || overloadHigh) {
      currentState.phase = "boss_encounter";
      currentState.bossPleasureValue = Math.max(currentState.bossPleasureValue || 0, 10); // 初始欢愉值
      const reason = rounds >= 8 ? "探索已深入" : mentalLow ? "华生精神力濒危" : contHigh ? "污染值过高" : "夏彦感官严重过载";
      console.log(`[sg:boss] 强制触发BOSS (${reason}, round ${rounds})`);
      phaseHint = `\n\n【⚠ BOSS强制触发——${reason}】BOSS已出现。当前欢愉值:${currentState.bossPleasureValue}%。描述BOSS的出现方式和形态。BOSS对华生产生了不可抗拒的兴趣——欢愉值开始积累。`;
    }
  } else if (currentState.phase !== "exploring") {
    currentState._exploreRounds = 0; // 离开探索阶段就重置
  }

    // ── 月光鹿进化检测（关键词触发 + 自动触发）──
    if (!currentState.whiteDeerEvolved) {
      const keywordMatch = /月光|明月|星辰|神鹿|异化|进化|光晕|凝实/.test(actionText) && /鹿/.test(actionText);
      const autoTrigger = currentState.player.mentalState <= 25 || currentState.player.contamination >= 60;
      if (keywordMatch || autoTrigger) {
        currentState.whiteDeerEvolved = true;
        currentState.player.mentalState = 100; // 进化瞬间精神力补满
        currentState.player.contamination = Math.max(0, currentState.player.contamination - 40);
        currentState.sentinelFrenzy = Math.max(0, (currentState.sentinelFrenzy || 0) - 30);
        currentState.moonDeerReboundUsed = false;
        console.log(`[sg:moondeer] 月光鹿进化为月光神鹿！(trigger: ${keywordMatch ? 'keyword' : 'auto-临界值'})`);
      }
    }

    // Capture state BEFORE AI processing for delta
    const before = {
      syncRate: currentState.sentinel.syncRate,
      senseOverload: currentState.sentinel.senseOverload,
      mentalState: currentState.player.mentalState,
      contamination: currentState.player.contamination,
      sentinelFrenzy: currentState.sentinelFrenzy || 0,
      bossPleasureValue: currentState.bossPleasureValue || 0,
    };

    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      history: historyForAI,
      maxTokens: 4000,
      temperature: 0.7,
      timeoutMs: 120000,
    });

    const parsed = parseReply(reply);

    // Update state based on reply content
    updateStateFromReply(parsed);

    // Compute stat deltas
    const after = {
      syncRate: currentState.sentinel.syncRate,
      senseOverload: currentState.sentinel.senseOverload,
      mentalState: currentState.player.mentalState,
      contamination: currentState.player.contamination,
      sentinelFrenzy: currentState.sentinelFrenzy || 0,
      bossPleasureValue: currentState.bossPleasureValue || 0,
    };
    const statUpdates = [];
    const labels = { syncRate: "同步率", senseOverload: "感官负荷", mentalState: "精神力", contamination: "精神污染", sentinelFrenzy: "失控值", bossPleasureValue: "欢愉值" };
    for (const [key, label] of Object.entries(labels)) {
      const oldV = before[key];
      const newV = after[key];
      if (oldV !== newV) {
        statUpdates.push({ label, from: oldV, to: newV, delta: newV - oldV });
      }
    }
    if (statUpdates.length > 0) {
      console.log("[sg:stats] delta:", statUpdates.map(u => `${u.label}:${u.from}→${u.to}`).join(", "));
    }

    currentState.narrative.push(
      { role: "narration", content: parsed.narration, timestamp: Date.now() },
      { role: "xiayan", content: parsed.xiayan, timestamp: Date.now() }
    );
    currentState.updatedAt = new Date().toISOString();
    saveState();
    saveSession(currentState.sessionId);

    return {
      state: getPublicState(),
      reply: { narration: parsed.narration, xiayan: parsed.xiayan, systemNotification: parsed.systemNotification, statChanges: parsed.statChanges, statUpdates, choices: parsed.choices },
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
      timeoutMs: 120000,
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
      reply: { narration: parsed.narration, xiayan: parsed.xiayan, systemNotification: parsed.systemNotification, statChanges: parsed.statChanges, choices: parsed.choices },
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
  const userContent = `${ctx}\n\n玩家选择了"${worldDescription}"这扇门，推门而入。\n\n【重要——你必须这样输出】在[旁白]描述完进入新世界的场景后，必须插入【系统】通知块。格式：\n\n[旁白]\n（推门进入新世界后的环境描述——用角色的眼睛看，不堆形容词）\n\n【系统】\n副本名称 + 世界观背景简介（2-3句） + 基础规则提示（如果有特殊规则的话）。系统语气恶劣但不失信息准确性。可以加🔑前缀标注类型。\n\n（然后夏彦的对话和动作——用哨兵五感分析环境）\n\n【铁则】\n- 画面感优先：不写"这个世界是一个XX风格的XX"，用角色的五感来感受——看到的、闻到的、听到的\n- 系统通知必须出现，不要跳过\n- 禁止大段景物描写——2-3句环境定调后立刻推进剧情`;

  try {
    const reply = await askJiushi({
      systemPrompt: SENTINEL_PROMPT,
      userContent,
      history: historyForAI,
      maxTokens: 4000,
      temperature: 0.7,
      timeoutMs: 120000,
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
      reply: { narration: parsed.narration, xiayan: parsed.xiayan, systemNotification: parsed.systemNotification, statChanges: parsed.statChanges, choices: parsed.choices },
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

  // ── Growth: stats improve with worlds cleared ──
  applyGrowth(currentState);

  // ── Random debuff from story events ──
  const newDebuff = rollDebuff(currentState);
  if (newDebuff) {
    if (!currentState.activeEffects) currentState.activeEffects = [];
    currentState.activeEffects.push(newDebuff);
    console.log("[sg:growth] Debuff applied:", newDebuff.name);
  }

  saveState();
  saveSession(currentState.sessionId);

  // Archive completed session
  await archiveSession(currentState.sessionId);

  // Generate settlement: classify collected items
  const worldLoot = (currentState.inventory || []).filter(item => !item.fromWarehouse);
  const settlementItems = worldLoot.map(item => ({
    ...item,
    suggestedOwner: item.type === "weapon" || item.type === "equipment" && (item.description || "").includes("哨兵") ? "夏彦" : "华生",
  }));

  // Build shop catalog for this settlement
  const shopCatalog = generateDynamicShop();

  return {
    state: getPublicState(),
    pointsEarned: pts,
    totalPoints: currentState.points,
    totalCleared: currentState.totalCleared,
    growth: currentState.totalCleared,
    settlement: {
      worldLoot: settlementItems,
      newDebuff,
      shopCatalog,
      warehouse: currentState.warehouse || [],
    },
  };
}

// ── Growth & Debuff System ──

const STAT_NAMES = ["生命", "攻击", "敏捷", "抵抗", "体力", "智力", "幸运"];

const DEBUFF_POOL = [
  { name: "感官后遗症", statAffected: "敏捷", value: -8, source: "BOSS精神力残留", turns: 4 },
  { name: "精神污染残留", statAffected: "智力", value: -5, source: "副本精神攻击", turns: 3 },
  { name: "轻度内伤", statAffected: "生命", value: -10, source: "战斗中受伤", turns: 5 },
  { name: "诅咒印记", statAffected: "幸运", value: -8, source: "BOSS临死诅咒", turns: 4 },
  { name: "体力透支", statAffected: "体力", value: -8, source: "长时间战斗疲劳", turns: 3 },
  { name: "防御破损", statAffected: "抵抗", value: -6, source: "装备耐久耗损", turns: 4 },
  { name: "感官过载残留", statAffected: "攻击", value: -5, source: "哨兵感官负荷扩散", turns: 3 },
];

function applyGrowth(state) {
  if (!state.playerBaseStats) state.playerBaseStats = { 生命:100, 攻击:60, 敏捷:70, 抵抗:60, 体力:100, 智力:80, 幸运:70 };
  if (!state.xiayanBaseStats) state.xiayanBaseStats = { 生命:120, 攻击:90, 敏捷:85, 抵抗:70, 体力:110, 智力:75, 幸运:50 };

  // Each character gets 2 random stats boosted by 2-5
  const pickAndGrow = (stats) => {
    const shuffled = [...STAT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 2; i++) {
      const gain = 2 + Math.floor(Math.random() * 4); // 2~5
      stats[shuffled[i]] += gain;
    }
  };

  pickAndGrow(state.playerBaseStats);
  pickAndGrow(state.xiayanBaseStats);
  console.log("[sg:growth] World cleared! Total:", state.totalCleared,
    "Player:", JSON.stringify(state.playerBaseStats),
    "Xiayan:", JSON.stringify(state.xiayanBaseStats));
}

function rollDebuff(state) {
  // 60% chance of a debuff after boss encounter
  if (Math.random() < 0.4) return null;
  const template = DEBUFF_POOL[Math.floor(Math.random() * DEBUFF_POOL.length)];
  return {
    id: "eff-" + uuid().slice(0, 6),
    ...template,
    type: "debuff",
    acquiredAt: new Date().toISOString(),
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
  const oldWarehouse = currentState.warehouse || [];
  const oldXiayanItems = currentState.xiayanItems || [];
  // Carry over persistent stats
  const oldPlayerBaseStats = currentState.playerBaseStats ? { ...currentState.playerBaseStats } : null;
  const oldXiayanBaseStats = currentState.xiayanBaseStats ? { ...currentState.xiayanBaseStats } : null;
  const oldPlayerProfile = currentState.playerProfile ? { ...currentState.playerProfile } : null;
  const oldXiayanProfile = currentState.xiayanProfile ? { ...currentState.xiayanProfile } : null;
  const oldPlayTime = currentState.playTimeMinutes || 0;
  const oldActiveEffects = currentState.activeEffects ? [...currentState.activeEffects] : [];
  const oldWhiteDeerEvolved = currentState.whiteDeerEvolved || false;
  const oldTeammateMemory = currentState.teammateMemory || [];

  // Archive old session
  await archiveSession(currentState.sessionId);

  // Create new session with carried-over stats
  currentState = createNewState(null);
  currentState.points = oldPoints;
  currentState.fragments = oldFragments;
  currentState.totalCleared = oldCleared;
  currentState.terrorLevel = oldTerror;
  currentState.inventory = oldInventory;
  currentState.warehouse = oldWarehouse;
  currentState.xiayanItems = oldXiayanItems;
  if (oldPlayerBaseStats) currentState.playerBaseStats = oldPlayerBaseStats;
  if (oldXiayanBaseStats) currentState.xiayanBaseStats = oldXiayanBaseStats;
  if (oldPlayerProfile) currentState.playerProfile = oldPlayerProfile;
  if (oldXiayanProfile) currentState.xiayanProfile = oldXiayanProfile;
  currentState.playTimeMinutes = oldPlayTime;
  currentState.activeEffects = oldActiveEffects;
  currentState.whiteDeerEvolved = oldWhiteDeerEvolved;
  currentState.teammateMemory = oldTeammateMemory;
  currentState.sentinelFrenzy = currentState.sentinelFrenzy || 0;
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

// ── 系统商城 & 仓库管理 ──

/**
 * Get all shop items (with availability check based on current points)
 */
export function getShopItems() {
  if (!currentState) return [];
  const points = currentState.points || 0;
  return SHOP_ITEMS.map(item => ({
    ...item,
    affordable: points >= item.cost,
  }));
}

/**
 * Purchase an item from the shop → goes to warehouse
 */
export function purchaseItem(shopItemId) {
  if (!currentState) return { error: "No active game session" };
  if (!currentState.warehouse) currentState.warehouse = [];

  const template = SHOP_ITEMS.find(i => i.id === shopItemId);
  if (!template) return { error: "Item not found in shop" };

  if (currentState.points < template.cost) {
    return { error: "Not enough points", need: template.cost, have: currentState.points };
  }

  currentState.points -= template.cost;

  const newItem = {
    id: "wh-" + uuid().slice(0, 6),
    shopId: template.id,
    name: template.name,
    type: template.type,
    description: template.description,
    effect: template.effect,
    target: template.target,
    cost: template.cost,
    purchasedAt: new Date().toISOString(),
    used: false,
  };

  currentState.warehouse.push(newItem);
  saveState();
  saveSession(currentState.sessionId);

  return { item: newItem, points: currentState.points, warehouse: currentState.warehouse };
}

/**
 * Withdraw an item from warehouse to inventory (for use in current world)
 */
export function withdrawFromWarehouse(warehouseItemId) {
  if (!currentState) return { error: "No active game session" };
  if (!currentState.warehouse) return { error: "Warehouse is empty" };
  if (!currentState.inventory) currentState.inventory = [];

  const idx = currentState.warehouse.findIndex(item => item.id === warehouseItemId);
  if (idx === -1) return { error: "Item not found in warehouse" };

  const [item] = currentState.warehouse.splice(idx, 1);
  const invItem = {
    ...item,
    id: "item-" + uuid().slice(0, 6),
    equipped: false,
    fromWarehouse: true,
    warehouseId: item.id,
  };
  currentState.inventory.push(invItem);
  saveState();
  saveSession(currentState.sessionId);
  return { item: invItem, inventory: currentState.inventory, warehouse: currentState.warehouse };
}

/**
 * Use a warehouse item directly (consume without withdrawing to inventory first)
 */
export function useWarehouseItem(warehouseItemId) {
  if (!currentState) return { error: "No active game session" };
  if (!currentState.warehouse) return { error: "Warehouse is empty" };

  const idx = currentState.warehouse.findIndex(item => item.id === warehouseItemId);
  if (idx === -1) return { error: "Item not found in warehouse" };

  const item = currentState.warehouse[idx];

  // Apply immediate effects for consumables
  if (item.type === "consumable" && item.effect) {
    applyItemEffect(currentState, item.effect);
  }

  // Consumables are consumed, equipment stays (marked as used)
  if (item.type === "consumable") {
    currentState.warehouse.splice(idx, 1);
  } else {
    item.used = true;
    item.usedAt = new Date().toISOString();
  }

  saveState();
  saveSession(currentState.sessionId);
  return { item, warehouse: currentState.warehouse, state: getPublicState() };
}

/**
 * Deposit an inventory item to warehouse for safekeeping
 */
export function depositToWarehouse(inventoryItemId) {
  if (!currentState) return { error: "No active game session" };
  if (!currentState.inventory) return { error: "Inventory is empty" };
  if (!currentState.warehouse) currentState.warehouse = [];

  const idx = currentState.inventory.findIndex(item => item.id === inventoryItemId);
  if (idx === -1) return { error: "Item not found in inventory" };

  const [item] = currentState.inventory.splice(idx, 1);
  item.depositedAt = new Date().toISOString();
  currentState.warehouse.push(item);
  saveState();
  saveSession(currentState.sessionId);
  return { item, inventory: currentState.inventory, warehouse: currentState.warehouse };
}

function applyItemEffect(state, effectStr) {
  if (!effectStr || !state) return;
  const parts = effectStr.split(",");
  for (const part of parts) {
    const [key, valStr] = part.split(/[+=-]/);
    const val = parseInt(valStr);
    if (isNaN(val)) continue;

    if (key === "mentalState" || key === "精神力") state.player.mentalState = Math.min(100, state.player.mentalState + val);
    else if (key === "senseOverload" || key === "过载") state.sentinel.senseOverload = Math.max(0, state.sentinel.senseOverload + val);
    else if (key === "contamination" || key === "污染") state.player.contamination = Math.max(0, state.player.contamination + val);
    else if (key === "frenzy" || key === "失控") state.sentinelFrenzy = Math.max(0, (state.sentinelFrenzy || 0) + val);
    else if (key === "syncRate" || key === "同步") state.sentinel.syncRate = Math.max(10, Math.min(100, state.sentinel.syncRate + val));
  }
}

/**
 * Get current public state (safe for client)
 */
export function resetAllState() {
  currentState = null;
  // Also wipe all session files
  try {
    if (fs.existsSync(SESSIONS_DIR)) {
      for (const f of fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".json"))) {
        fs.unlinkSync(path.join(SESSIONS_DIR, f));
      }
    }
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(INDEX_FILE)) fs.unlinkSync(INDEX_FILE);
    sessionsIndex = [];
  } catch (e) {
    console.error("[sg] resetAllState file cleanup:", e.message);
  }
}

export function getPublicState() {
  if (!currentState) return null;
  return {
    sessionId: currentState.sessionId,
    status: currentState.status,
    phase: currentState.phase,
    world: currentState.world,
    terrorLevel: currentState.terrorLevel,
    player: {
      ...currentState.player,
      stats: currentState.playerBaseStats || currentState.player?.stats || { 生命: 100, 攻击: 60, 敏捷: 70, 抵抗: 60, 体力: 100, 智力: 80, 幸运: 70 },
    },
    sentinel: {
      ...currentState.sentinel,
      stats: currentState.xiayanBaseStats || currentState.sentinel?.stats || { 生命: 120, 攻击: 90, 敏捷: 85, 抵抗: 70, 体力: 110, 智力: 75, 幸运: 50 },
    },
    playerBaseStats: currentState.playerBaseStats ? { ...currentState.playerBaseStats } : null,
    xiayanBaseStats: currentState.xiayanBaseStats ? { ...currentState.xiayanBaseStats } : null,
    playerProfile: currentState.playerProfile || null,
    xiayanProfile: currentState.xiayanProfile || null,
    activeEffects: currentState.activeEffects || [],
    bossPleasureValue: currentState.bossPleasureValue,
    sentinelFrenzy: currentState.sentinelFrenzy || 0,
    frenzyMode: currentState.frenzyMode || "none",
    points: currentState.points,
    fragments: currentState.fragments || 0,
    totalCleared: currentState.totalCleared,
    playTimeMinutes: currentState.playTimeMinutes || 0,
    inventory: currentState.inventory || [],
    warehouse: currentState.warehouse || [],
    xiayanItems: currentState.xiayanItems || [],
    whiteDeerEvolved: currentState.whiteDeerEvolved || false,
    moonDeerReboundUsed: currentState.moonDeerReboundUsed || false,
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
 * Get system panel data (character sheets, stats, spirit animals, effects, progress)
 */
export function getSystemPanel() {
  if (!currentState) {
    return {
      playerProfile: { name: "华生", gender: "女", age: 24, identity: "A级向导", goldenFinger: "？？？", spiritAnimal: "白鹿" },
      xiayanProfile: { name: "夏彦", gender: "男", age: 24, identity: "变异哨兵(A级)", goldenFinger: "双精神体", spiritAnimals: ["德牧", "渡鸦"], activeSpirit: "德牧" },
      playerBaseStats: { 生命: 100, 攻击: 60, 敏捷: 70, 抵抗: 60, 体力: 100, 智力: 80, 幸运: 70 },
      xiayanBaseStats: { 生命: 120, 攻击: 90, 敏捷: 85, 抵抗: 70, 体力: 110, 智力: 75, 幸运: 50 },
      activeEffects: [],
      totalCleared: 0,
      points: 0,
      fragments: 0,
      bossPleasureValue: 0,
      playTimeMinutes: 0,
      currentWorld: "未开始",
      phase: "idle",
    };
  }
  return {
    playerProfile: currentState.playerProfile || { name: "华生", gender: "女", age: 24, identity: "A级向导", goldenFinger: "？？？", spiritAnimal: "白鹿" },
    xiayanProfile: currentState.xiayanProfile || { name: "夏彦", gender: "男", age: 24, identity: "变异哨兵(A级)", goldenFinger: "双精神体", spiritAnimals: ["德牧", "渡鸦"], activeSpirit: "德牧" },
    playerBaseStats: currentState.playerBaseStats || { 生命: 100, 攻击: 60, 敏捷: 70, 抵抗: 60, 体力: 100, 智力: 80, 幸运: 70 },
    xiayanBaseStats: currentState.xiayanBaseStats || { 生命: 120, 攻击: 90, 敏捷: 85, 抵抗: 70, 体力: 110, 智力: 75, 幸运: 50 },
    activeEffects: currentState.activeEffects || [],
    totalCleared: currentState.totalCleared || 0,
    points: currentState.points || 0,
    fragments: currentState.fragments || 0,
    bossPleasureValue: currentState.bossPleasureValue || 0,
    sentinelFrenzy: currentState.sentinelFrenzy || 0,
    frenzyMode: currentState.frenzyMode || "none",
    playTimeMinutes: currentState.playTimeMinutes || 0,
    currentWorld: currentState.world?.name || "初始空间",
    phase: currentState.phase,
  };
}

/**
 * Get the narrative history of the current session
 */
export function getSGHistory() {
  if (!currentState) return [];
  return currentState.narrative || [];
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
  let statChanges = "";
  let systemNotification = "";

  const text = reply || "";
  console.log("[sg:parse] raw reply length:", text.length, "first 120 chars:", text.slice(0, 120));

  // Split [旁白] section from 夏彦's part.
  // Look for action brackets （ or dialogue quotes " at the start of a line
  // (NOT mid-sentence "夏彦" which would cut narration in half)
  // Also stop at 【系统】 block which sits between narration and dialogue
  const narrationMatch = text.match(/\[旁白\][\s\S]*?(?=\n（|\n"|\n【系统】|\n【数值变化】|\n【选项】|$)/);
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

  // Extract 【系统】 block from xiayan (system notifications — sparse, key moments only)
  const sysMatch = xiayan.match(/【系统】\s*\n([\s\S]*?)(?=\n（|\n"|\n【数值变化】|\n【选项】|$)/);
  if (sysMatch) {
    systemNotification = sysMatch[1].trim();
    xiayan = xiayan.replace(sysMatch[0], "").trim();
    console.log("[sg:parse] systemNotification extracted:", systemNotification.length, "chars");
  }

  // Extract 【数值变化】 block from xiayan (between dialogue and options)
  const statMatch = xiayan.match(/【数值变化】\s*\n([\s\S]*?)(?=\n【选项】|$)/);
  if (statMatch) {
    statChanges = statMatch[1].trim();
    xiayan = xiayan.replace(statMatch[0], "").trim();
    console.log("[sg:parse] statChanges extracted:", statChanges.length, "chars");
  }

  // Extract option buttons from xiayan
  let choices = [];
  const optMatch = xiayan.match(/【选项】\s*\n([\s\S]*)/);
  console.log("[sg:parse] looking for 【选项】 in xiayan:", optMatch ? "FOUND" : "NOT FOUND", "xiayan ends with:", xiayan.slice(-80));
  if (optMatch) {
    xiayan = xiayan.slice(0, optMatch.index).trim();
    const optText = optMatch[1];
    choices = optText.split("\n")
      .map(line => line.replace(/^[-•]\s*/, "").trim())
      .filter(c => c.length > 0 && c.length < 30);
  }

  // Safety: if both empty, use raw text as xiayan
  if (!narration && !xiayan && text.trim()) {
    xiayan = text.trim();
  }

  console.log("[sg:parse] result — narration:", narration.length, "chars, xiayan:", xiayan.length, "chars, system:", systemNotification.length, "chars, stats:", statChanges.length, "chars, choices:", choices.length);
  return { narration, xiayan, systemNotification, statChanges, choices };
}

function updateStateFromReply(parsed) {
  if (!currentState) return;

  const combined = (parsed.narration + " " + parsed.xiayan + " " + (parsed.statChanges || "")).toLowerCase();

  // Detect phase transitions from reply content
  // Only transition from init→door_select when doors are explicitly described
  // (not just mentioning the word "door" in passing)
  if ((combined.includes("五扇门") || combined.includes("门浮现") || combined.includes("一扇门") && combined.includes("选")) &&
      combined.includes("门")) {
    if (currentState.phase === "init" && (currentState._initRounds || 1) >= 3) {
      currentState.phase = "door_select";
    }
  }

  if (combined.includes("boss") || combined.includes("首领") || combined.includes("守护者") || combined.includes("最终")) {
    if (currentState.phase === "exploring") {
      currentState.phase = "boss_encounter";
    }
  }

  // Detect world entry — only when in door_select phase
  const worldEntryPatterns = ["推开门", "推门", "踏进", "走进", "进入", "跨过门槛", "穿过门", "选了第", "选第", "先进去", "拉开门", "推开那扇"];
  const justEnteredWorld = worldEntryPatterns.some(p => combined.includes(p));
  const isEnteringPhase = currentState.phase === "door_select";
  if (justEnteredWorld && isEnteringPhase) {
    currentState.world = currentState.world || {};
    if (!currentState.world.theme) {
      currentState.world.theme = randomTheme();
      console.log("[sentinel-guide] Auto-assigned theme:", currentState.world.theme.name);
    }
    // Try to extract world name from AI response
    const nameMatch = combined.match(/(?:进入|来到|踏入|走进|推开|穿过)(?:了)?(?:一扇门[，,]\s*)?(?:一座|一个|一栋|一处|一间|一片)?(.{2,8}?(?:古宅|城堡|医院|学校|小镇|村庄|森林|山洞|旅馆|公寓|工厂|教堂|墓地|废墟|雪山|荒原|矿井|灯塔|洋馆|庭院|老宅|别墅|大楼|房间|空间))/);
    if (nameMatch && !currentState.world.name) {
      currentState.world.name = nameMatch[1];
      console.log("[sentinel-guide] Auto-detected world name:", currentState.world.name);
    }
    currentState.phase = "exploring";
    currentState.player.position = (currentState.world.name || "未知世界") + "·入口";
    currentState.sentinel.position = (currentState.world.name || "未知世界") + "·入口";
  }

  // Detect sync rate / mental state changes from narration
  // New format: "同步率：75 → 68（...）" — capture value after →
  // Old format: "同步率：75" — capture the number
  let syncMatch = combined.match(/同步率[：:].*?→\s*(\d+)/);
  if (!syncMatch) syncMatch = combined.match(/同步率[：:]\s*(\d+)/);
  if (syncMatch) {
    currentState.sentinel.syncRate = parseInt(syncMatch[1]);
  }

  let overloadMatch = combined.match(/(?:感官)?过载[：:].*?→\s*(\d+)/);
  if (!overloadMatch) overloadMatch = combined.match(/(?:感官)?过载[：:]\s*(\d+)/);
  if (overloadMatch) {
    currentState.sentinel.senseOverload = parseInt(overloadMatch[1]);
  }

  let contamMatch = combined.match(/(?:精神)?污染[：:].*?→\s*(\d+)/);
  if (!contamMatch) contamMatch = combined.match(/(?:精神)?污染[：:]\s*(\d+)/);
  if (contamMatch) {
    currentState.player.contamination = parseInt(contamMatch[1]);
  }

  let mentalMatch = combined.match(/精神力[：:].*?→\s*(\d+)/);
  if (!mentalMatch) mentalMatch = combined.match(/精神力[：:]\s*(\d+)/);
  if (mentalMatch) {
    currentState.player.mentalState = parseInt(mentalMatch[1]);
  }

  // Detect 失控值 changes
  let frenzyMatch = combined.match(/(?:失控值|哨兵失控)[：:].*?→\s*(\d+)/);
  if (!frenzyMatch) frenzyMatch = combined.match(/(?:失控值|哨兵失控)[：:]\s*(\d+)/);
  if (frenzyMatch) {
    currentState.sentinelFrenzy = parseInt(frenzyMatch[1]);
  }

  // Detect 欢愉值 changes (from Claude full prompt)
  const pleasureMatch = combined.match(/欢愉值[：:]\s*(\d+)/);
  if (pleasureMatch) {
    currentState.bossPleasureValue = parseInt(pleasureMatch[1]);
  }

  // Detect erosion value (侵蚀值) changes (from DeepSeek SFW prompt)
  const erosionMatch = combined.match(/侵蚀值[：:]\s*(\d+)/);
  if (erosionMatch) {
    currentState.bossErosionValue = parseInt(erosionMatch[1]);
  }

  // Active stat progression — only apply drift when AI didn't provide explicit values
  const aiProvidedStats = syncMatch || overloadMatch || contamMatch || mentalMatch || frenzyMatch;
  if (!aiProvidedStats) {
    applyStatDrift(currentState);
  }

  // ── 月光鹿被动回复（始终运行，不受AI数值覆盖影响）──
  applyMoonDeerPassive(currentState);
}

// 月光鹿被动光环——始终生效，不受AI统计覆盖
function applyMoonDeerPassive(state) {
  if (!state || !state.player || !state.sentinel) return;
  const p = state.player;
  const s = state.sentinel;

  // 基础月光鹿：持续治愈场
  if (p.mentalState < 100) {
    p.mentalState = Math.min(100, p.mentalState + (Math.floor(Math.random() * 4) + 2)); // +2~5/轮
  }
  if (s.senseOverload > 0) {
    s.senseOverload = Math.max(0, s.senseOverload - (Math.floor(Math.random() * 3) + 1)); // -1~3/轮
  }
  if (p.contamination > 0) {
    p.contamination = Math.max(0, p.contamination - Math.floor(Math.random() * 2)); // -0~1/轮
  }

  // 进化月光神鹿：增强恢复
  if (state.whiteDeerEvolved) {
    if (p.mentalState < 100) {
      p.mentalState = Math.min(100, p.mentalState + (Math.floor(Math.random() * 3) + 3)); // +3~5/轮
    }
    if (p.contamination > 0) {
      p.contamination = Math.max(0, p.contamination - (Math.floor(Math.random() * 3) + 2)); // -2~4/轮
    }
    if (s.senseOverload > 0) {
      s.senseOverload = Math.max(0, s.senseOverload - (Math.floor(Math.random() * 3) + 2)); // -2~4/轮
    }
    if ((state.sentinelFrenzy || 0) > 0) {
      state.sentinelFrenzy = Math.max(0, (state.sentinelFrenzy || 0) - (Math.floor(Math.random() * 3) + 1)); // -1~3/轮
    }
    // 触底反弹
    if (p.mentalState <= 5 && !state.moonDeerReboundUsed) {
      p.mentalState = 100;
      state.moonDeerReboundUsed = true;
      console.log("[sg:moondeer] 触底反弹！精神力 0→100");
    }
  }

  // Clamp
  p.mentalState = Math.max(10, Math.min(100, p.mentalState));
  p.contamination = Math.max(0, Math.min(100, p.contamination));
  s.senseOverload = Math.max(0, Math.min(100, s.senseOverload));
}

function applyStatDrift(state) {
  if (!state) return;
  const s = state.sentinel;
  const p = state.player;
  const phase = state.phase;

  // ── Sync rate drift ──
  if (phase === "boss_encounter") {
    const swing = Math.floor(Math.random() * 21) - 10; // -10 to +10
    s.syncRate = Math.max(10, Math.min(100, s.syncRate + swing));
    s.senseOverload = Math.min(100, s.senseOverload + Math.floor(Math.random() * 8)); // +0~7 (was +0~10)
  } else if (phase === "exploring") {
    const drift = Math.floor(Math.random() * 7) - 2; // -2 to +4
    s.syncRate = Math.max(10, Math.min(100, s.syncRate + drift));
    const od = Math.floor(Math.random() * 6) - 3; // -3 to +2 (overload tends down)
    s.senseOverload = Math.max(0, Math.min(100, s.senseOverload + od));
    // Mental state: no forced drain in exploration
  }

  // ── Mental state recovery in safe phases ──
  if (phase === "init" || phase === "door_select" || phase === "cleared") {
    p.mentalState = Math.min(100, p.mentalState + Math.floor(Math.random() * 6) + 5); // +5~10
  }

  // ── Contamination natural decay (non-boss) ──
  if (phase !== "boss_encounter" && p.contamination > 0) {
    p.contamination = Math.max(0, p.contamination - Math.floor(Math.random() * 2)); // -0~1
  }

  // ── Natural recovery when overload is high ──
  if (s.senseOverload > 60) {
    s.syncRate = Math.max(10, s.syncRate - Math.floor(Math.random() * 6)); // -0~5
  }

  // ── Sentinel frenzy tracking ──
  if (state.sentinelFrenzy === undefined) state.sentinelFrenzy = 0;
  if (s.senseOverload > 50) {
    state.sentinelFrenzy = Math.min(100, state.sentinelFrenzy + Math.floor(Math.random() * 3) + 1); // +1~3
  } else if (s.senseOverload > 30) {
    state.sentinelFrenzy = Math.min(100, state.sentinelFrenzy + Math.floor(Math.random() * 2)); // +0~1
  }
  if (phase === "boss_encounter") {
    state.sentinelFrenzy = Math.min(100, state.sentinelFrenzy + Math.floor(Math.random() * 3) + 1); // +1~3
  }
  if (s.senseOverload <= 30 && phase !== "boss_encounter") {
    state.sentinelFrenzy = Math.max(0, state.sentinelFrenzy - (Math.floor(Math.random() * 3) + 1)); // -1~3
  }
  if (state.sentinelFrenzy < 20 && state.frenzyMode === "frenzy") {
    state.frenzyMode = "none";
  }

  // ── Clamp all values ──
  s.syncRate = Math.max(10, Math.min(100, s.syncRate));
  s.senseOverload = Math.max(0, Math.min(100, s.senseOverload));
  p.contamination = Math.max(0, Math.min(100, p.contamination));
  p.mentalState = Math.max(10, Math.min(100, p.mentalState));
}

function applyFrenzyReduction(state, actionText) {
  if (!state || !actionText) return;

  const a = actionText;

  // ── Frenzy reduction ──
  if (state.sentinelFrenzy !== undefined && state.sentinelFrenzy > 0) {
    let reduction = 0;
    let mode = "";

    if (/做爱|上床|要[你我]|进来|深入|结合|交合|缠绵/.test(a)) {
      reduction = state.sentinelFrenzy; // full reset
      mode = "frenzy";
      if (state.frenzyMode === "frenzy") state.frenzyMode = "none";
      console.log("[sg:frenzy] Deep purification: frenzy", state.sentinelFrenzy, "→ 0");
    }
    else if (/深吻|舌吻|吻住|用力吻|压[着在]吻|按[着在]墙.*吻|吻.*不放/.test(a)) {
      reduction = 30 + Math.floor(Math.random() * 21); // 30-50
      mode = "invite";
      console.log("[sg:frenzy] Deep kiss: frenzy -" + reduction);
    }
    else if (/吻|亲[嘴唇舌]|接吻/.test(a)) {
      reduction = 20 + Math.floor(Math.random() * 16); // 20-35
      mode = "invite";
      console.log("[sg:frenzy] Kiss: frenzy -" + reduction);
    }
    else if (/贴.*额|额.*贴|额头.*抵|抵.*额头|额头.*碰|碰.*额头/.test(a)) {
      reduction = 12 + Math.floor(Math.random() * 11); // 12-22
      mode = "invite";
      console.log("[sg:frenzy] Forehead touch: frenzy -" + reduction);
    }
    else if (/紧.*抱|死死.*抱|用力.*抱|抱.*紧|抱.*不放|搂.*入怀|按.*入怀|扑.*怀|钻进.*怀|埋.*胸|埋.*怀/.test(a)) {
      reduction = 15 + Math.floor(Math.random() * 11); // 15-25
      console.log("[sg:frenzy] Tight hug: frenzy -" + reduction);
    }
    else if (/抱|拥[抱]|搂|依偎|靠[在着]怀|环.*腰|圈.*怀里/.test(a)) {
      reduction = 10 + Math.floor(Math.random() * 11); // 10-20
      console.log("[sg:frenzy] Hug: frenzy -" + reduction);
    }
    else if (/牵[手]|拉[手着住]手|握[着住].*手|十指/.test(a)) {
      reduction = 8 + Math.floor(Math.random() * 8); // 8-15
      console.log("[sg:frenzy] Hand holding: frenzy -" + reduction);
    }

    if (reduction > 0) {
      state.sentinelFrenzy = Math.max(0, state.sentinelFrenzy - reduction);
      if (mode && !state.frenzyMode) state.frenzyMode = mode;
    }
  }

  // ── Contamination reduction ──
  if (state.player.contamination !== undefined && state.player.contamination > 0) {
    let contamReduction = 0;

    if (/深吻|舌吻|吻住|用力吻|压[在着]吻|按[着在]墙.*吻|吻.*不放/.test(a)) {
      contamReduction = 15 + Math.floor(Math.random() * 16); // 15-30
      console.log("[sg:contam] Deep kiss purification: -" + contamReduction);
    }
    else if (/吻|亲[嘴唇舌面额]|接吻/.test(a)) {
      contamReduction = 10 + Math.floor(Math.random() * 11); // 10-20
      console.log("[sg:contam] Kiss purification: -" + contamReduction);
    }
    else if (/贴.*额|额.*贴|额头.*抵|抵.*额头/.test(a)) {
      contamReduction = 5 + Math.floor(Math.random() * 6); // 5-10
    }
    else if (/紧.*抱|死死.*抱|用力.*抱|抱.*紧|抱.*不放|搂.*入怀|按.*入怀/.test(a)) {
      contamReduction = 5 + Math.floor(Math.random() * 11); // 5-15
      console.log("[sg:contam] Embrace purification: -" + contamReduction);
    }
    else if (/月光鹿.*净化|月光鹿.*清理|鹿角.*净化|净化.*月光鹿|精神图景.*清理|清理.*精神图景/.test(a)) {
      contamReduction = 10 + Math.floor(Math.random() * 11); // 10-20
    }
    else if (/德牧.*净化|渡鸦.*啄|精神体.*净化|精神体.*清理/.test(a)) {
      contamReduction = 5 + Math.floor(Math.random() * 6); // 5-10
    }
    else if (/净化点|净化.*泉|净化.*井|净化.*木|净化.*坛|神木|祭坛|圣泉|净化.*地/.test(a)) {
      contamReduction = 15 + Math.floor(Math.random() * 16); // 15-30
    }

    if (contamReduction > 0) {
      state.player.contamination = Math.max(0, state.player.contamination - contamReduction);
    }
  }

  // ── Sense overload reduction from physical contact ──
  if (state.sentinel.senseOverload !== undefined && state.sentinel.senseOverload > 0) {
    let odReduction = 0;
    if (/深吻|舌吻|吻住/.test(a)) odReduction = 10 + Math.floor(Math.random() * 11); // 10-20
    else if (/吻|亲[嘴唇舌]|接吻/.test(a)) odReduction = 5 + Math.floor(Math.random() * 11); // 5-15
    else if (/贴.*额|额.*贴|额头.*抵|抵.*额头/.test(a)) odReduction = 5 + Math.floor(Math.random() * 8); // 5-12
    else if (/紧.*抱|抱.*紧|抱.*不放|搂.*入怀|按.*入怀/.test(a)) odReduction = 5 + Math.floor(Math.random() * 6); // 5-10
    else if (/抱|拥[抱]|搂|依偎|靠[在着]怀/.test(a)) odReduction = 3 + Math.floor(Math.random() * 6); // 3-8
    else if (/牵[手]|拉[手着住]手|握[着住].*手|十指/.test(a)) odReduction = 3 + Math.floor(Math.random() * 6); // 3-8
    if (odReduction > 0) {
      state.sentinel.senseOverload = Math.max(0, state.sentinel.senseOverload - odReduction);
      console.log("[sg:overload] Contact: overload -" + odReduction);
    }
  }

  // ── Mental state recovery from physical contact ──
  if (state.player.mentalState !== undefined && state.player.mentalState < 100) {
    let msRecovery = 0;
    if (/深吻|舌吻|吻住/.test(a)) msRecovery = 5 + Math.floor(Math.random() * 11); // 5-15
    else if (/吻|亲[嘴唇舌]|接吻/.test(a)) msRecovery = 3 + Math.floor(Math.random() * 8); // 3-10
    else if (/贴.*额|额.*贴|额头.*抵|抵.*额头/.test(a)) msRecovery = 5 + Math.floor(Math.random() * 6); // 5-10
    else if (/紧.*抱|抱.*紧|抱.*不放|搂.*入怀|按.*入怀/.test(a)) msRecovery = 3 + Math.floor(Math.random() * 6); // 3-8
    else if (/抱|拥[抱]|搂|依偎|靠[在着]怀/.test(a)) msRecovery = 2 + Math.floor(Math.random() * 5); // 2-6
    else if (/牵[手]|拉[手着住]手|握[着住].*手|十指/.test(a)) msRecovery = 1 + Math.floor(Math.random() * 4); // 1-4
    if (msRecovery > 0) {
      state.player.mentalState = Math.min(100, state.player.mentalState + msRecovery);
      console.log("[sg:mental] Contact: mental +" + msRecovery);
    }
  }
}async function archiveSession(sessionId) {
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

const FORUM_CATEGORIES = ["真人真事", "求助专区", "交易市场", "攻略分享", "寻人启事", "大佬赞美"];
const FORUM_TAGS = ["亲历", "劲", "回应", "后续", "求助", "交易", "攻略", "寻人", "赞美"];
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
  if (now - meta.lastGenerated < 20 * 60 * 1000) {
    return null; // cooldown: 20 min
  }

  // 30% chance of praise post if player has cleared at least 1 world
  const playerCleared = (currentState?.totalCleared || 0) >= 1;
  const isPraisePost = playerCleared && Math.random() < 0.3;

  let category, tag;
  if (isPraisePost) {
    category = "大佬赞美";
    tag = "赞美";
  } else {
    category = FORUM_CATEGORIES[Math.floor(Math.random() * (FORUM_CATEGORIES.length - 1))];
    tag = FORUM_TAGS[Math.floor(Math.random() * (FORUM_TAGS.length - 1))];
  }
  const author = FORUM_AUTHORS[Math.floor(Math.random() * FORUM_AUTHORS.length)];
  const commenters = FORUM_AUTHORS.filter(a => a.name !== author.name).sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3));

  // Build praise post context
  let praiseContext = "";
  if (isPraisePost) {
    const praiseTarget = Math.random() < 0.5 ? "华生和夏彦" : "其他玩家";
    if (praiseTarget === "华生和夏彦") {
      const worldName = currentState?.world?.name || "某个副本";
      const clearedCount = currentState?.totalCleared || 1;
      praiseContext = `\n\n【重要——赞美帖】这篇帖子是赞美华生和夏彦的。他们在${worldName}副本中的出色表现帮助了作者。他们已经通关了${clearedCount}个世界。帖子要具体提到他们的哨向配合（夏彦的哨兵五感/德牧或渡鸦精神体，华生的向导精神力/白鹿精神体）。语气可以是感激、崇拜、或者劫后余生的庆幸。`;
    } else {
      const randomPlayer = FORUM_AUTHORS[Math.floor(Math.random() * FORUM_AUTHORS.length)];
      praiseContext = `\n\n【重要——赞美帖】这篇帖子是赞美一位名叫"${randomPlayer.name}"的大佬玩家的。可以是任何副本场景中的英雄事迹。`;
    }
  }

  const prompt = `你是一个无限流恐怖世界的论坛用户。请以第一人称写一篇论坛帖子。

【帖子要求】
- 分类：${category}
- 标签：[${tag}]
- 作者昵称：${author.name}
- 作者等级：Lv${author.level}
- 必须有标题（10-25字），标题前加【${tag}】
- 正文200-400字，第一人称，口语化${praiseContext}
- 内容是无限流恐怖副本相关：副本经历、求助、交易物品、攻略分享、寻找失踪队友、赞美大佬等
- 要有真实感——细节具体、语气自然
- 禁止使用"不是...，是..."句式
- 如果合适，提到具体的副本场景（中式古宅/西式城堡/荒野山洞/废弃医院/雪山哨站/都市废墟等）
- 可以提到哨兵/向导/精神体等设定

请输出JSON格式（只输出JSON，不要其他内容）：
{"title": "...", "body": "..."}`;

  try {
    const reply = await askDeepSeek({
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
      comments: commenters.map(c => ({
        id: "fc-" + uuid().slice(0, 6),
        author: c.name,
        authorLevel: c.level,
        content: generateForumComment(data.body, c.name, data.title),
        score: Math.floor(Math.random() * 9) + 1,
        createdAt: "刚刚",
      })),
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

function generateForumComment(body, commenterName, postTitle) {
  const genericReplies = [
    "天哪……这也太吓人了。你们没事真的太好了。",
    "感谢分享！我们队正准备进类似的副本，这个信息太有用了。",
    "我也是在这个副本里遇到了一模一样的情况！！但我们的处理方式不一样——",
    "作为一个刚进深渊的新人，看完这个帖子后背发凉……",
    "已收藏。这种经验帖真的太珍贵了。",
    "问一下楼主，你们队是什么配置过的？我们配置差不多想参考一下。",
    "类似的情况遇到过。补充一点：带精神力恢复剂，越多越好。",
    "这就去告诉我的向导。我们队正要进一个类似的副本。",
    "握草，跟我上周经历的一模一样。那个井里的东西，是不是还会模仿你队友的声音？",
    "建议楼主在安全区多休一天。精神污染这种东西，累积起来很麻烦的。",
    "有没有人一起组队？我们队刚丢了一个哨兵，缺侦察位。",
    "别说了，我看到一半我哨兵在旁边已经开始警戒了。他精神体直接竖耳朵。",
    "加油楼主。深渊里的每个人都有自己的坎，但总会过去的。",
    "新人想问——这种副本是不是必须带向导？我们队只有一个哨兵一个普通人。",
    "补充一个细节：如果BOSS的威胁值超过50，立刻停手拉开距离。别问我怎么知道的。",
  ];
  return genericReplies[Math.floor(Math.random() * genericReplies.length)];
}
