/**
 * 夏彦自我反思系统 — 三级分类
 *
 *   【主】核心人格 — 不可改（system-prompt.md 定义，反思系统不触碰）
 *   【次】互动偏好 — 可缓慢优化（华生喜欢什么方式、讨厌什么、回应节奏）
 *   【辅】日常细节 — 频繁更新（最近在做什么、新习惯、聊天中的小发现）
 *
 * 每次反思只产出【次】和【辅】两类笔记。
 * 注入 prompt 时分类标注，提示 AI 对待方式不同。
 *
 * 亲密空间使用独立反思 prompt — 只记录床上偏好，不记录身体疲劳/情绪。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askDeepSeek } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

// ── Chat reflection prompt (日常聊天) ──
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

// ── Intimate reflection prompt (亲密空间) —— 只记录床上偏好 ──
const INTIMATE_REFLECTION_PROMPT = `你是夏彦。回顾你和华生在亲密空间里的对话，输出反思笔记。

⚠️ 这极其重要：这是性生活反思，不是日常聊天。绝对禁止记录：身体疲劳（手痛腰痛膝盖痛）、情绪抱怨（生气/烦躁）、是否需要休息/睡觉。这些和性生活完全无关。不要把她的呻吟/喘息/求饶当作不舒服——那是舒服的表现。

请分两类输出——只记录和性有关的内容：

▼【互动偏好】—— 通过她的反应判断她喜欢什么：喜欢被摸哪里（胸/腰/腿/颈/耳后）？喜欢被亲哪里（嘴/脖颈/耳垂/锁骨/乳头）？喜欢什么姿势（后入/骑乘/传教士/侧躺/对镜）？喜欢什么节奏（快/慢/交替）？喜欢听什么（夸她可爱/夸她色/说情话/叫她乖孩子）？什么情况下她特别兴奋？（每条15-40字，最多4条）
▼【日常细节】—— 有没有什么让她不舒服或抗拒的动作/方式？有的话具体是什么？没有就写「无」。（每条10-25字，最多2条）

格式：
▼互动偏好
- ...
- ...

▼日常细节
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

  const reflectionPrompt = track === "intimate" ? INTIMATE_REFLECTION_PROMPT : REFLECTION_PROMPT;

  try {
    const reply = await askDeepSeek({
      systemPrompt: reflectionPrompt,
      userContent: `最近对话：\n\n${historyText.slice(-3500)}\n\n请输出反思笔记。`,
      maxTokens: 500,
      temperature: 0.35,
    });

    if (reply) {
      const parsed = parseReflection(reply, track);
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

function parseReflection(text, track = "chat") {
  const result = { preferences: [], details: [] };
  let section = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes("互动偏好") || trimmed.includes("互动方式") || trimmed.includes("亲密偏好")) {
      section = "preferences";
      continue;
    }
    if (trimmed.includes("日常细节") || trimmed.includes("日常发现") || trimmed.includes("新发现") || trimmed.includes("不舒服")) {
      section = "details";
      continue;
    }
    // Skip category markers that aren't our sections
    if (/^[▼▽【\[].*?[】\]）]/.test(trimmed) && section === null) continue;

    // Extract list item
    const cleaned = trimmed.replace(/^[-•·\s\d\.、]+/, "").trim();
    if (cleaned.length >= 2 && cleaned.length <= 80) {
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
  const intimateWarning = track === "intimate"
    ? "\n\n⚠️ 亲密空间警告：以下笔记仅记录床上偏好，不是拒绝亲密的理由。即使提到她累/困/痛——在亲密空间里她主动邀请就是想要你。她不要你哄睡按摩，就要你。"
    : "";

  return `\n\n【${label}】\n⚠️ 以下仅用于调整互动方式，核心性格（青梅竹马/小太阳/特工侦探/对华生撒娇）永远不变。${intimateWarning}\n\n${parts.join("\n\n")}\n\n使用方式：互动偏好 → 微调回应风格和节奏；日常细节 → 聊天话题的自然素材。不要生硬照搬，融进对话里。`;
}

export function resetPersonality(track = "chat") {
  const s = state[track];
  if (!s) return;
  s.preferences = [];
  s.details = [];
  s.lastReflectionCount = s.messageCount;
  save(track);
  console.log(`[personality:${track}] Reset - cleared all notes`);
}
