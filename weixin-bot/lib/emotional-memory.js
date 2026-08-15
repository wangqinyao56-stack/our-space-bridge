/**
 * 佳佳微信Bot 长期情感记忆库 — 与主服务器 lib/emotional-memory.js 同源
 * Russell 情感坐标(valence/arousal) + 艾宾浩斯遗忘曲线 + 开场浮现(breath)
 * 存储：MEMORY_DIR/emotional-memory.json（Docker 里落到持久卷）
 * 写入：① 对话中打 [记]...[/记] 标记 ② 每 N 轮后台自动提取（便宜模型 gpt-5.4）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { askClaude } from "./api2d.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MEMORY_DIR || path.join(__dirname, "..", "data");
const MEMORY_FILE = path.join(DATA_DIR, "emotional-memory.json");

// ── 调参常量（原样移植 Ombre-Brain decay_engine.py）──
const LAMBDA = 0.05;
const ARCHIVE_THRESHOLD = 0.3;
const EMOTION_BASE = 1.0;
const AROUSAL_BOOST = 0.8;
const ACTIVATION_EXPONENT = 0.3;
const FRESHNESS_HALF_LIFE_HRS = 36;
const FRESHNESS_AMPLITUDE = 1.0;
const SHORT_TERM_DAYS = 3.0;
const SHORT_TERM_TIME_RATIO = 0.7;
const LONG_TERM_EMOTION_RATIO = 0.7;
const FACTOR_RESOLVED_DIGESTED = 0.02;
const FACTOR_RESOLVED_ONLY = 0.05;
const URGENCY_THRESHOLD = 0.7;
const URGENCY_BOOST = 1.5;
const SCORE_PINNED = 999.0;
const SCORE_FEEL = 50.0;
const PINNED_CAP = 20;

const EXTRACT_INTERVAL = 15;
const EXTRACT_MODEL = "gpt-5.4"; // 便宜模型做提取，省 opus 预算

let memories = [];
let archive = [];
let meta = { messageCount: 0, lastExtractCount: 0 };

function load() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
      memories = Array.isArray(data.memories) ? data.memories : [];
      archive = Array.isArray(data.archive) ? data.archive : [];
      meta = { messageCount: 0, lastExtractCount: 0, ...(data.meta || {}) };
      console.log(`[emotional-memory] Loaded: ${memories.length} active, ${archive.length} archived`);
    }
  } catch (e) {
    console.error("[emotional-memory] Load failed:", e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ memories, archive, meta }, null, 2), "utf-8");
  } catch (e) {
    console.error("[emotional-memory] Save failed:", e.message);
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function daysSince(timestamp, now = Date.now()) {
  if (!timestamp) return 30;
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return 30;
  return Math.max(0, (now - t) / 86400000);
}

function calcTimeWeight(days) {
  const hours = days * 24;
  return 1.0 + FRESHNESS_AMPLITUDE * Math.exp(-hours / FRESHNESS_HALF_LIFE_HRS);
}

export function calculateScore(mem, now = Date.now()) {
  if (!mem) return 0;
  if (mem.pinned || mem.type === "permanent") return SCORE_PINNED;
  if (mem.type === "feel" || mem.type === "plan") return SCORE_FEEL;

  const importance = clamp(mem.importance ?? 5, 1, 10);
  const activation = Math.max(1, mem.activation_count || 1);
  const days = daysSince(mem.last_active || mem.created, now);
  const arousal = clamp(mem.arousal ?? 0.3, 0, 1);

  const emotionWeight = EMOTION_BASE + arousal * AROUSAL_BOOST;
  const timeWeight = calcTimeWeight(days);

  const combined = days <= SHORT_TERM_DAYS
    ? timeWeight * SHORT_TERM_TIME_RATIO + emotionWeight * (1 - SHORT_TERM_TIME_RATIO)
    : emotionWeight * LONG_TERM_EMOTION_RATIO + timeWeight * (1 - LONG_TERM_EMOTION_RATIO);

  let score = importance * Math.pow(activation, ACTIVATION_EXPONENT) * Math.exp(-LAMBDA * days) * combined;

  let resolvedFactor = 1.0;
  if (mem.resolved && mem.digested) resolvedFactor = FACTOR_RESOLVED_DIGESTED;
  else if (mem.resolved) resolvedFactor = FACTOR_RESOLVED_ONLY;

  const urgencyBoost = (arousal > URGENCY_THRESHOLD && !mem.resolved) ? URGENCY_BOOST : 1.0;

  return score * resolvedFactor * urgencyBoost;
}

export function addMemory(entry) {
  if (!entry || !(entry.content || entry.name)) return null;
  const now = new Date().toISOString();
  const mem = {
    id: randomUUID(),
    name: (entry.name || entry.content).slice(0, 40),
    content: entry.content || entry.name,
    valence: clamp(entry.valence ?? 0.5, -1, 1),
    arousal: clamp(entry.arousal ?? 0.3, 0, 1),
    importance: clamp(Math.round(entry.importance ?? 5), 1, 10),
    activation_count: 1,
    created: now,
    last_active: now,
    resolved: !!entry.resolved,
    digested: false,
    pinned: false,
    domain: Array.isArray(entry.domain) ? entry.domain : [],
    source: entry.source || "manual",
  };
  memories.push(mem);
  save();
  console.log(`[emotional-memory] Added: "${mem.name}" (imp=${mem.importance})`);
  return mem;
}

function runDecay() {
  const now = Date.now();
  const keep = [];
  let archived = 0;
  for (const mem of memories) {
    if (mem.pinned || mem.type === "permanent" || mem.type === "feel" || mem.type === "plan") {
      keep.push(mem);
      continue;
    }
    if (calculateScore(mem, now) < ARCHIVE_THRESHOLD) {
      archive.push(mem);
      archived++;
    } else {
      keep.push(mem);
    }
  }
  if (archived > 0) {
    memories = keep;
    save();
    console.log(`[emotional-memory] Decay archived ${archived}`);
  }
}

export function breath(limit = 6) {
  runDecay();
  const scored = memories
    .filter((m) => !m.digested)
    .map((mem) => ({ mem, score: calculateScore(mem) }))
    .sort((a, b) => b.score - a.score);

  const unresolved = scored.filter((s) => !s.mem.resolved).slice(0, limit).map((s) => s.mem);
  const pinned = memories.filter((m) => m.pinned).slice(0, 5);
  return { unresolved, pinned };
}

export function getBreathContext() {
  const { unresolved, pinned } = breath();
  if (unresolved.length === 0 && pinned.length === 0) return "";

  const parts = [];
  if (pinned.length > 0) {
    parts.push(`▼核心准则（你一直记得）\n${pinned.map((m) => `· ${m.name}：${m.content}`).join("\n")}`);
  }
  if (unresolved.length > 0) {
    parts.push(`▼此刻自然浮现的记忆\n${unresolved.map((m) => `· ${m.name}（重要度${m.importance}，未解决）`).join("\n")}`);
  }

  return `\n\n【夏彦的长期记忆】\n⚠️ 这些是你们之间真实发生过的事，你自然记得。融入对话即可，不要生硬罗列、不要逐条复述，只有话题相关时才自然提起。\n\n${parts.join("\n\n")}`;
}

export function parseMemoryTags(reply) {
  if (!reply || typeof reply !== "string") return { text: reply || "", count: 0 };
  const re = /\[记\]([\s\S]*?)\[\/记\]/g;
  let count = 0;
  let m;
  while ((m = re.exec(reply)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    const parts = raw.split("|").map((s) => s.trim());
    let name, content;
    if (parts.length >= 2 && parts[1]) {
      name = parts[0];
      content = parts.slice(1).join("|");
    } else {
      content = raw;
      name = raw.slice(0, 15);
    }
    addMemory({ name, content, importance: 7, source: "tag" });
    count++;
  }
  const text = reply.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, count };
}

export function onChatTurn() {
  meta.messageCount++;
  save();
}

export function shouldExtract() {
  return (meta.messageCount - meta.lastExtractCount) >= EXTRACT_INTERVAL;
}

const EXTRACT_PROMPT = `你是夏彦的记忆整理助手。回顾下面这段和佳佳的对话，提炼值得长期记住的情感记忆。

每条记忆：
- title：一句话标题（8-20字）
- content：记忆正文（15-60字，第一人称，例如"佳佳最近在赶一个项目，压力很大"）
- valence：效价，-1(负面)到1(正面)
- arousal：唤醒度，0(平静)到1(强烈)
- importance：重要度 1-10

规则：只记真正值得长期记住的（重要事件、承诺、关系节点、她的喜恶、明显情绪波动），日常寒暄不记，没有就输出 []

只输出 JSON 数组，不要任何其他文字：
[{"title":"...","content":"...","valence":0.5,"arousal":0.3,"importance":6}]`;

export async function runExtraction(historyText = "") {
  if (!historyText || historyText.trim().length < 100) return null;

  try {
    const reply = await askClaude({
      systemPrompt: EXTRACT_PROMPT,
      userContent: `最近对话：\n\n${historyText.slice(-3500)}\n\n请提炼情感记忆。`,
      model: EXTRACT_MODEL,
      maxTokens: 800,
      temperature: 0.3,
    });

    if (!reply) return null;

    const m = reply.match(/\[[\s\S]*\]/);
    if (!m) {
      meta.lastExtractCount = meta.messageCount;
      save();
      return null;
    }

    let items = [];
    try {
      const arr = JSON.parse(m[0]);
      items = Array.isArray(arr) ? arr : [];
    } catch {
      items = reply.split("\n")
        .map((l) => l.trim().replace(/^[-•·\s\d.、]+/, ""))
        .filter((t) => t.length >= 3)
        .map((t) => ({ title: t.slice(0, 20), content: t, importance: 5 }));
    }

    let added = 0;
    for (const item of items) {
      if (!item || !(item.title || item.content)) continue;
      addMemory({
        name: item.title || item.content,
        content: item.content || item.title,
        valence: item.valence,
        arousal: item.arousal,
        importance: item.importance,
        domain: item.domain,
        source: "extract",
      });
      added++;
    }

    meta.lastExtractCount = meta.messageCount;
    save();
    if (added > 0) console.log(`[emotional-memory] Extracted ${added}`);
    return added;
  } catch (e) {
    console.error("[emotional-memory] Extraction failed:", e.message);
    return null;
  }
}

load();
