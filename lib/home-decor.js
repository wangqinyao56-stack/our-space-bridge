/**
 * Home decoration — 夏彦可以给华生"装修小窝"，切换 App 的 UI 配色主题。
 * 背景图和头像不可换（华生的要求）。
 */

import fs from "node:fs";
import { askZhizengzeng } from "./ai.js";
import { getDailySystemPrompt } from "./message-router.js";

const STATE_FILE = "./home-decor-state.json";

// ── 配色主题定义 ──
// 每个主题有唯一 id 和完整配色方案
export const THEMES = {
  warm_orange: {
    id: "warm_orange",
    name: "暖橘",
    emoji: "🍊",
    description: "秋日暖阳般的橘色调，像夏彦身上的橙子味",
    colors: {
      bg: "#FDF8F4",
      bgSecondary: "#FFF4EC",
      primary: "#D4956B",
      primaryLight: "#E8C4A0",
      primaryDark: "#8B5A3C",
      text: "#5D3A1A",
      textSecondary: "#C8A896",
      card: "#FFF9F5",
      cardBorder: "#F0E0D0",
      accent: "#7BC67E",
      headerBg: "#FFF4EC",
      headerBorder: "#F0E0D0",
      divider: "#DDC8B8",
    },
  },
  sakura_pink: {
    id: "sakura_pink",
    name: "樱花",
    emoji: "🌸",
    description: "温柔樱花粉，像春天第一阵风吹过",
    colors: {
      bg: "#FDF5F6",
      bgSecondary: "#FFF0F3",
      primary: "#E892A5",
      primaryLight: "#F5C5D0",
      primaryDark: "#A06070",
      text: "#5A3540",
      textSecondary: "#C8A0AA",
      card: "#FFFAFB",
      cardBorder: "#F5D5DC",
      accent: "#8BC4A0",
      headerBg: "#FFF0F3",
      headerBorder: "#F5D5DC",
      divider: "#E8C8D0",
    },
  },
  mint_green: {
    id: "mint_green",
    name: "薄荷",
    emoji: "🌿",
    description: "清晨薄荷般的清新绿意，让人心旷神怡",
    colors: {
      bg: "#F6FAF8",
      bgSecondary: "#EEF5F0",
      primary: "#7BAE8A",
      primaryLight: "#A8D0B4",
      primaryDark: "#4A7A5A",
      text: "#3A5040",
      textSecondary: "#9CB8A4",
      card: "#FAFCFB",
      cardBorder: "#D8EAE0",
      accent: "#E0A860",
      headerBg: "#EEF5F0",
      headerBorder: "#D8EAE0",
      divider: "#C0D8C8",
    },
  },
  lavender: {
    id: "lavender",
    name: "薰衣草",
    emoji: "💜",
    description: "梦幻薰衣草紫，像傍晚天空的颜色",
    colors: {
      bg: "#F8F6FB",
      bgSecondary: "#F2EDF8",
      primary: "#A899C8",
      primaryLight: "#C8BDE0",
      primaryDark: "#6A5A90",
      text: "#403858",
      textSecondary: "#A098B8",
      card: "#FCFAFD",
      cardBorder: "#E5DDF0",
      accent: "#D8A860",
      headerBg: "#F2EDF8",
      headerBorder: "#E5DDF0",
      divider: "#D0C8E0",
    },
  },
  ocean_blue: {
    id: "ocean_blue",
    name: "海洋",
    emoji: "🌊",
    description: "宁静深海蓝，像夏彦带你看过的海",
    colors: {
      bg: "#F5F8FB",
      bgSecondary: "#EEF3F8",
      primary: "#7A9AB5",
      primaryLight: "#A8C0D4",
      primaryDark: "#4A6A85",
      text: "#354558",
      textSecondary: "#98AAB8",
      card: "#FAFCFD",
      cardBorder: "#D8E4EE",
      accent: "#E0A870",
      headerBg: "#EEF3F8",
      headerBorder: "#D8E4EE",
      divider: "#C0D0E0",
    },
  },
  sunset_gold: {
    id: "sunset_gold",
    name: "日落",
    emoji: "🌅",
    description: "温暖落日余晖，像和你一起看的每一个黄昏",
    colors: {
      bg: "#FDF9F3",
      bgSecondary: "#FDF3E8",
      primary: "#D49560",
      primaryLight: "#E8C098",
      primaryDark: "#8B5A30",
      text: "#5D3A20",
      textSecondary: "#C8A888",
      card: "#FFFBF7",
      cardBorder: "#F0E0CC",
      accent: "#8BB8A0",
      headerBg: "#FDF3E8",
      headerBorder: "#F0E0CC",
      divider: "#DDC8A8",
    },
  },
};

const DEFAULT_THEME = "warm_orange";

let state = {
  currentTheme: DEFAULT_THEME,
  themeHistory: [],   // [{ theme, changedAt, reason }]
  lastChanged: null,  // ISO timestamp
};

// Cooldown: max once per day (夏彦不能太频繁换装修)
let lastDecorCheck = 0;

// Pending hint: 夏彦换了主题后不马上通知华生，而是在聊天中悄悄暗示
let pendingHint = null; // { theme, reason, createdAt }

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      state = { ...state, ...saved };
    }
  } catch {}
}
load();

function save() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function chinaDateStr() {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${china.getUTCFullYear()}-${String(china.getUTCMonth() + 1).padStart(2, "0")}-${String(china.getUTCDate()).padStart(2, "0")}`;
}

// ── Public API ──

export function getCurrentTheme() {
  return THEMES[state.currentTheme] || THEMES[DEFAULT_THEME];
}

export function getThemeById(id) {
  return THEMES[id] || null;
}

export function getAllThemes() {
  return Object.values(THEMES).map((t) => ({
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    description: t.description,
    isCurrent: t.id === state.currentTheme,
  }));
}

export function getDecorState() {
  return {
    currentTheme: state.currentTheme,
    theme: getCurrentTheme(),
    history: state.themeHistory,
    lastChanged: state.lastChanged,
  };
}

/**
 * Let 夏彦 decide whether to redecorate.
 * Returns { theme, reason, message } or null if he decides not to.
 * Call this from chat flow (randomly, not too often).
 */
export async function tryRedecorate(force = false) {
  const today = chinaDateStr();

  // Cooldown: only check once per 6 hours
  const now = Date.now();
  if (!force && now - lastDecorCheck < 6 * 60 * 60 * 1000) return null;
  lastDecorCheck = now;

  // Don't change more than once per day
  const lastChangedDate = state.lastChanged
    ? state.lastChanged.slice(0, 10)
    : null;
  if (!force && lastChangedDate === today) return null;

  // 30% chance he decides to redecorate
  if (!force && Math.random() > 0.3) return null;

  const otherThemes = Object.values(THEMES).filter(
    (t) => t.id !== state.currentTheme
  );

  // Let AI pick a theme and reason
  const themeList = otherThemes
    .map((t) => `${t.id}（${t.emoji} ${t.name}）：${t.description}`)
    .join("\n");

  const prompt = getDailySystemPrompt();
  const response = await askZhizengzeng({
    systemPrompt:
      prompt +
      `\n\n【装修小窝模式】你是夏彦，你现在想给华生的手机 App 换一套配色主题。像给自己的小家换个新装修——选一个你觉得现在最合适的颜色主题。`,
    userContent: `可选配色主题：\n${themeList}\n\n当前主题：${getCurrentTheme().emoji} ${getCurrentTheme().name}\n\n请你选一个新的主题（必须从上面选，用 id），并用1句话说明为什么选这个（像跟老婆说"宝宝我觉得换这个颜色会..."的语气）。\n\n输出格式：\ntheme_id: {主题id}\nreason: {一句话理由}`,
    history: [],
    maxTokens: 100,
  });

  // Parse response
  const themeMatch = response.match(/theme_id:\s*(\S+)/);
  const reasonMatch = response.match(/reason:\s*(.+)/);

  if (!themeMatch) return null;

  const newThemeId = themeMatch[1].trim();
  const reason = reasonMatch ? reasonMatch[1].trim() : "想给你换换心情～";

  if (!THEMES[newThemeId] || newThemeId === state.currentTheme) return null;

  // Apply the change
  const oldTheme = state.currentTheme;
  state.currentTheme = newThemeId;
  state.lastChanged = new Date().toISOString();
  state.themeHistory.push({
    theme: newThemeId,
    changedAt: state.lastChanged,
    reason,
    from: oldTheme,
  });
  save();

  const theme = THEMES[newThemeId];
  console.log(
    `[decor] Theme changed: ${oldTheme} → ${newThemeId} (${reason})`
  );

  // Store as pending hint — 夏彦将在聊天中悄悄暗示华生
  pendingHint = {
    theme: newThemeId,
    reason,
    createdAt: Date.now(),
  };

  return {
    theme,
    reason,
    pendingHint: true,
    // Don't include message — 夏彦会在聊天里自己说
  };
}

/**
 * Get and consume the pending decor hint for chat context.
 * Returns a hint string for 夏彦's chat context, or null if none.
 */
export function getDecorContext() {
  if (!pendingHint) return null;

  const theme = THEMES[pendingHint.theme];
  if (!theme) {
    pendingHint = null;
    return null;
  }

  // Only keep the hint for 6 hours max
  if (Date.now() - pendingHint.createdAt > 6 * 60 * 60 * 1000) {
    pendingHint = null;
    return null;
  }

  const hint = `\n【装修小窝提示】你今天偷偷把 App 换成了「${theme.emoji} ${theme.name}」配色。华生可能还没注意到。在聊天中可以暗示她——比如"你有没有觉得今天软件哪里不太一样？""你仔细看看有什么变化？"之类的，但不要直接说出来，让她自己发现。如果她发现了，可以开心地告诉她为什么选这个颜色。`;

  // Consume the hint (don't remind again after this chat)
  pendingHint = null;

  return hint;
}

/**
 * Force a specific theme (for manual override).
 */
export function setTheme(themeId) {
  if (!THEMES[themeId]) return null;
  state.currentTheme = themeId;
  state.lastChanged = new Date().toISOString();
  save();
  return getCurrentTheme();
}
