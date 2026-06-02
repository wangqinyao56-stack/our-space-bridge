/**
 * 夏彦自我反思系统 — 三级分类
 *
 *   【主】核心人格 — 不可改（system-prompt.md 定义，反思系统不触碰）
 *   【次】互动偏好 — 可缓慢优化（华生喜欢什么方式、讨厌什么、回应节奏）
 *   【辅】日常细节 — 频繁更新（最近在做什么、新习惯、聊天中的小发现）
 *
 * 每次反思只产出【次】和【辅】两类笔记。
 * 注入 prompt 时分类标注，提示 AI 对待方式不同。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askDeepSeek } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

const REFLECTION_PROMPT = `你是夏彦。回顾你和华生的对话，输出反思笔记。

⚠️ 重要：你的核心性格不可改变（青梅竹马、小太阳、国安特工+侦探、对华生撒娇），不要对核心人设做任何修改。

请分两类输出：

▼【互动偏好】—— 华生喜欢/不喜欢什么回应方式？你的语气/节奏需要微调吗？（每条15-30字，最多3条）
▼【日常细节】—— 你注意到了什么？她在做什么、有什么新习惯、情绪怎么样？（每条10-25字，最多4条）

格式：
▼互动偏好
- ...
- ...

▼日常细节
- ...
- ...

只输出笔记，不加开场白和总结。`;

const TRACKS = {
  chat: {
    file: "personality-notes.json",
    interval: 20,
  },
  intimate: {
    file: "intimate-personality-notes.json",
    interval: 12,
  },
};

// ── State ──
const state = {};

for (const [key, cfg] of Object.entries(TRACKS)) {
  const filePath = path.join(DATA_DIR, cfg.file);
  let data = { preferences: [], details: [], messageCount: 0, lastReflectionCount: 0 };
  try {
    if (fs.existsSync(filePath)) {
      const loaded = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data = { ...data, ...loaded };
      console.log(`[personality:${key}] Loaded: ${data.preferences.length} preferences, ${data.details.length} details`);
    }
  } catch {}
  state[key] = { ...data, filePath };
}

function save(track) {
  try {
    const s = state[track];
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(s.filePath, JSON.stringify({
      preferences: s.preferences,
      details: s.details,
      messageCount: s.messageCount,
      lastReflectionCount: s.lastReflectionCount,
    }, null, 2), "utf-8");
  } catch (err) {
    console.error(`[personality:${track}] Save failed:`, err.message);
  }
}

// ── Public API ──

export function onMessageSent(track = "chat") {
  if (!state[track]) return;
  state[track].messageCount++;
  save(track);
}

export function shouldReflect(track = "chat") {
  const s = state[track];
  if (!s) return false;
  return (s.messageCount - s.lastReflectionCount) >= TRACKS[track].interval;
}

export async function runReflection(track = "chat", historyText = "") {
  const s = state[track];
  if (!s) return null;
  if (!historyText || historyText.trim().length < 150) return null;

  const intimateNote = track === "intimate"
    ? "\n\n⚠️ 这是亲密时刻的对话。反思时注意：不修改夏彦在亲密中的核心角色（温柔、照顾、撒娇犬系），只调整体贴方式和节奏偏好。"
    : "";

  try {
    const reply = await askDeepSeek({
      systemPrompt: REFLECTION_PROMPT + intimateNote,
      userContent: `最近对话：\n\n${historyText.slice(-3500)}\n\n请输出反思笔记。`,
      maxTokens: 500,
      temperature: 0.35,
    });

    if (reply) {
      const parsed = parseReflection(reply);
      if (parsed.preferences.length > 0 || parsed.details.length > 0) {
        // Merge: keep last 8 preferences, last 12 details
        s.preferences = [...s.preferences, ...parsed.preferences].slice(-8);
        s.details = [...s.details, ...parsed.details].slice(-12);
        s.lastReflectionCount = s.messageCount;
        save(track);
        console.log(`[personality:${track}] Reflection: +${parsed.preferences.length}p +${parsed.details.length}d (total: ${s.preferences.length}p, ${s.details.length}d)`);
        return parsed;
      }
    }
  } catch (err) {
    console.error(`[personality:${track}] Reflection failed:`, err.message);
  }
  return null;
}

function parseReflection(text) {
  const result = { preferences: [], details: [] };
  let section = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes("互动偏好") || trimmed.includes("互动方式")) {
      section = "preferences";
      continue;
    }
    if (trimmed.includes("日常细节") || trimmed.includes("日常发现") || trimmed.includes("新发现")) {
      section = "details";
      continue;
    }
    // Skip category markers that aren't our sections
    if (/^[▼▽【\[].*?[】\]）]/.test(trimmed) && section === null) continue;

    // Extract list item
    const cleaned = trimmed.replace(/^[-•·\s\d\.、]+/, "").trim();
    if (cleaned.length >= 5 && cleaned.length <= 60) {
      if (section === "preferences") result.preferences.push(cleaned);
      else if (section === "details") result.details.push(cleaned);
    }
  }

  return result;
}

export function getInsightContext(track = "chat") {
  const s = state[track];
  if (!s) return "";
  if (s.preferences.length === 0 && s.details.length === 0) return "";

  const parts = [];

  if (s.preferences.length > 0) {
    const items = s.preferences.map((t, i) => `${i + 1}. ${t}`);
    parts.push(`▼互动偏好（可微调语气/节奏，核心性格不可改）\n${items.join("\n")}`);
  }

  if (s.details.length > 0) {
    const items = s.details.map((t, i) => `${i + 1}. ${t}`);
    parts.push(`▼日常细节（参考性信息，自然融入对话）\n${items.join("\n")}`);
  }

  if (parts.length === 0) return "";

  const label = track === "intimate" ? "亲密时刻的行为提醒" : "夏彦的自我认知笔记";

  return `\n\n【${label}】\n⚠️ 以下仅用于调整互动方式，核心性格（青梅竹马/小太阳/特工侦探/对华生撒娇）永远不变。\n\n${parts.join("\n\n")}\n\n使用方式：互动偏好 → 微调回应风格和节奏；日常细节 → 聊天话题的自然素材。不要生硬照搬，融进对话里。`;
}
