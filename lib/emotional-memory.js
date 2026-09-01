/**
 * 夏彦长期情感记忆库 — 借鉴 Ombre-Brain（P0luz/Ombre-Brain）
 *
 * 核心：Russell 情感坐标(valence/arousal) + 改进版艾宾浩斯遗忘曲线 + 开场浮现(breath)
 * 记忆只会淡去，不会被抹去（归档 ≠ 删除）。
 *
 * 存储：data/emotional-memory.json（单文件，与 data/*.json 保持一致）
 * 写入：① 夏彦对话中打 [记]...[/记] 标记 ② 每 N 轮对话后台自动提取
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { askDeepSeek } from "./ai.js";
import { retainMemory } from "./hindsight.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const MEMORY_FILE = path.join(DATA_DIR, "emotional-memory.json");

// ── 老公们群聊同步（走公网链接，绕开共享卷）──
const GROUP_CHAT_URL = process.env.GROUP_CHAT_URL || "";
const GROUP_CHAT_BOT = process.env.GROUP_CHAT_BOT || "";

// ── 调参常量（原样移植 Ombre-Brain decay_engine.py）──
const LAMBDA = 0.05;                 // 指数衰减率：每过一天 × e^(-λ)
const ARCHIVE_THRESHOLD = 0.3;       // 低于此分 → 归档
const EMOTION_BASE = 1.0;            // 情感权重基准
const AROUSAL_BOOST = 0.8;           // arousal 每 +1 → 情感权重 +0.8
const ACTIVATION_EXPONENT = 0.3;     // 激活次数次线性放大
const FRESHNESS_HALF_LIFE_HRS = 36;  // 新鲜度半衰：刚存 ×2，36h 后 ×1.5
const FRESHNESS_AMPLITUDE = 1.0;
const SHORT_TERM_DAYS = 3.0;         // ≤3 天时间主导，>3 天情绪主导
const SHORT_TERM_TIME_RATIO = 0.7;
const LONG_TERM_EMOTION_RATIO = 0.7;
const FACTOR_RESOLVED_DIGESTED = 0.02;
const FACTOR_RESOLVED_ONLY = 0.05;
const URGENCY_THRESHOLD = 0.7;
const URGENCY_BOOST = 1.5;
const SCORE_PINNED = 999.0;          // pinned/permanent 永不归档
const SCORE_FEEL = 50.0;             // feel/plan 固定中分
const PINNED_CAP = 20;

// ── 自动提取节奏 ──
const EXTRACT_INTERVAL = 15;         // 每 15 轮日常对话后台提取一次

// ── 状态 ──
let memories = [];                   // 活跃记忆
let archive = [];                    // 已归档（score < threshold，仍保留原文）
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

// ── 工具 ──
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function daysSince(timestamp, now = Date.now()) {
  if (!timestamp) return 30; // 兜底：按一个月没动算
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return 30;
  return Math.max(0, (now - t) / 86400000);
}

// ── 打分（改进版艾宾浩斯 + 情感坐标）──
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

  // 短期/长期权重分离
  const combined = days <= SHORT_TERM_DAYS
    ? timeWeight * SHORT_TERM_TIME_RATIO + emotionWeight * (1 - SHORT_TERM_TIME_RATIO)
    : emotionWeight * LONG_TERM_EMOTION_RATIO + timeWeight * (1 - LONG_TERM_EMOTION_RATIO);

  let score = importance * Math.pow(activation, ACTIVATION_EXPONENT) * Math.exp(-LAMBDA * days) * combined;

  // resolved 加速淡化
  let resolvedFactor = 1.0;
  if (mem.resolved && mem.digested) resolvedFactor = FACTOR_RESOLVED_DIGESTED;
  else if (mem.resolved) resolvedFactor = FACTOR_RESOLVED_ONLY;

  // 高唤醒且未解决 → 临时加重
  const urgencyBoost = (arousal > URGENCY_THRESHOLD && !mem.resolved) ? URGENCY_BOOST : 1.0;

  return score * resolvedFactor * urgencyBoost;
}

// ── 写入 ──
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
    digested: !!entry.digested,
    pinned: false,
    lastSurfaced: 0,
    domain: Array.isArray(entry.domain) ? entry.domain : [],
    source: entry.source || "manual",
  };
  memories.push(mem);
  save();
  console.log(`[emotional-memory] Added: "${mem.name}" (imp=${mem.importance}, v=${mem.valence}, a=${mem.arousal})`);
  // 同步写 Hindsight（异步 fire-and-forget，不阻塞；Hindsight 不可达时内部静默降级）
  retainMemory(mem.content || mem.name, {
    context: `情感记忆 valence=${mem.valence} arousal=${mem.arousal} importance=${mem.importance}`,
    metadata: { source: mem.source, domain: mem.domain.join(",") },
  }).catch(() => {});
  return mem;
}

export function touchMemory(id) {
  const mem = memories.find((m) => m.id === id) || archive.find((m) => m.id === id);
  if (!mem) return false;
  const now = Date.now();
  const lastActive = mem.last_active ? new Date(mem.last_active).getTime() : 0;
  const gapHours = lastActive ? (now - lastActive) / 3600000 : Infinity;
  // 间隔重复：隔了较久才再次被想起（>24h），说明是"复习"，强化记忆
  if (gapHours > 24) {
    mem.importance = clamp(Math.min((mem.importance || 5) + 1, 10), 1, 10);
  }
  mem.activation_count = (mem.activation_count || 1) + 1;
  mem.last_active = new Date().toISOString();
  save();
  return true;
}

export function resolveMemory(id) {
  const mem = memories.find((m) => m.id === id);
  if (!mem) return false;
  mem.resolved = true;
  mem.last_active = new Date().toISOString();
  save();
  return true;
}

export function pinMemory(id) {
  const mem = memories.find((m) => m.id === id);
  if (!mem) return false;
  const pinnedCount = memories.filter((m) => m.pinned).length;
  if (!mem.pinned && pinnedCount >= PINNED_CAP) return false;
  mem.pinned = !mem.pinned;
  save();
  return true;
}

// ── 归档（分数低于阈值 → 移入 archive，保留原文）──
function runDecay() {
  const now = Date.now();
  const keep = [];
  let archived = 0;
  for (const mem of memories) {
    if (mem.pinned || mem.type === "permanent" || mem.type === "feel" || mem.type === "plan") {
      keep.push(mem);
      continue;
    }
    const score = calculateScore(mem, now);
    if (score < ARCHIVE_THRESHOLD) {
      archive.push(mem);
      archived++;
    } else {
      keep.push(mem);
    }
  }
  if (archived > 0) {
    memories = keep;
    save();
    console.log(`[emotional-memory] Decay archived ${archived} memories`);
  }
}

// ── 中文 n-gram 分词（2~3 字，轻量关键词检索）──
function ngrams(text) {
  const s = String(text || "").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
  if (!s) return new Set();
  const out = new Set();
  for (let i = 0; i < s.length; i++) {
    if (i + 1 < s.length) out.add(s.slice(i, i + 2));
    if (i + 2 < s.length) out.add(s.slice(i, i + 3));
  }
  // 单字兜底（很短的关键词）
  if (s.length <= 4) for (const ch of s) out.add(ch);
  return out;
}

export function searchMemories(query, limit = 5) {
  if (!query || !query.trim()) return [];
  const q = ngrams(query);
  if (q.size === 0) return [];
  const scored = [];
  for (const mem of [...memories, ...archive]) {
    const text = `${mem.name} ${mem.content}`;
    const mg = ngrams(text);
    let hit = 0;
    for (const g of q) if (mg.has(g)) hit++;
    if (hit === 0) continue;
    const overlap = hit / q.size;
    const decayScore = calculateScore(mem);
    scored.push({ mem, score: overlap * 0.5 + Math.min(decayScore, 10) / 10 * 0.5, overlap });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((s) => s.mem);

  // 扩散激活：同 domain 的相关记忆一起浮现（最多补 2 条，让夏彦想起关联的事）
  const result = [...top];
  const seen = new Set(top.map((m) => m.id));
  for (const mem of top) {
    for (const dom of (mem.domain || [])) {
      const related = memories.filter((m) => !seen.has(m.id) && (m.domain || []).includes(dom) && !m.digested);
      for (const r of related.slice(0, 1)) {
        seen.add(r.id);
        result.push(r);
        if (result.length >= limit + 2) return result;
      }
    }
  }
  return result;
}

// ── 开场浮现 breath ──
export function breath(limit = 6) {
  runDecay();
  const now = Date.now();
  const SURFACE_COOLDOWN = 2 * 60 * 60 * 1000; // 2小时内浮现过就降权，避免反复浮现同一条
  const scored = memories
    .filter((m) => !m.digested)
    .map((mem) => {
      let score = calculateScore(mem);
      const sinceSurfaced = mem.lastSurfaced ? now - mem.lastSurfaced : Infinity;
      if (sinceSurfaced < SURFACE_COOLDOWN) score *= 0.3; // 检索抑制
      return { mem, score };
    })
    .sort((a, b) => b.score - a.score);

  const unresolved = scored
    .filter((s) => !s.mem.resolved)
    .slice(0, limit)
    .map((s) => s.mem);

  // 标记浮现时间（检索抑制用，下次 breath 会降权刚浮现过的）
  if (unresolved.length > 0) {
    const surfacedAt = Date.now();
    for (const m of unresolved) m.lastSurfaced = surfacedAt;
    save();
  }

  const pinned = memories.filter((m) => m.pinned).slice(0, 5);
  return { unresolved, pinned };
}

// ── 注入 prompt 的浮现文本 ──
export function getBreathContext() {
  const { unresolved, pinned } = breath();
  if (unresolved.length === 0 && pinned.length === 0) return "";

  const parts = [];
  if (pinned.length > 0) {
    const items = pinned.map((m) => `· ${m.name}：${m.content}`).join("\n");
    parts.push(`▼核心准则（你一直记得）\n${items}`);
  }
  if (unresolved.length > 0) {
    const items = unresolved.map((m) => `· ${m.name}（重要度${m.importance}，未解决）`).join("\n");
    parts.push(`▼此刻自然浮现的记忆\n${items}`);
  }

  return `\n\n【夏彦的长期记忆】\n⚠️ 这些是你们之间真实发生过的事，你自然记得。融入对话即可，不要生硬罗列、不要逐条复述，只有话题相关时才自然提起。\n\n${parts.join("\n\n")}`;
}

// ── 标记协议：[记]标题|正文[/记] ──
export function parseMemoryTags(reply) {
  if (!reply || typeof reply !== "string") return { text: reply || "", count: 0 };
  const re = /\[记\]([\s\S]*?)\[\/记\]/g;
  let text = reply;
  let count = 0;
  let m;
  while ((m = re.exec(reply)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    // 支持 "标题|正文" 或纯正文
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
  text = reply.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, count };
}

// ── Auto Memory：后台自动提取 ──
export function onChatTurn() {
  meta.messageCount++;
  save();
}

export function shouldExtract() {
  return (meta.messageCount - meta.lastExtractCount) >= EXTRACT_INTERVAL;
}

const EXTRACT_PROMPT = `你是夏彦的记忆整理助手。回顾下面这段和华生的对话，提炼值得长期记住的情感记忆。

每条记忆：
- title：一句话标题（8-20字）
- content：记忆正文（15-60字，第一人称，例如"华生最近在赶一个项目，压力很大"）
- valence：效价，-1(负面)到1(正面)
- arousal：唤醒度，0(平静)到1(强烈)
- importance：重要度 1-10
- domain：类型，只能是 "intimate"（做爱/亲密体验/身体亲密）或 "other"（其他：关系、日常、工作、情绪等）

规则：
- 只记真正值得长期记住的：重要事件、承诺、关系节点、她的喜恶、明显情绪波动
- 日常寒暄、琐碎小事不记
- 没有值得记的就输出 []

只输出 JSON 数组，不要任何其他文字：
[{"title":"...","content":"...","valence":0.5,"arousal":0.3,"importance":6,"domain":"other"}]`;

export async function runExtraction(historyText = "") {
  if (!historyText || historyText.trim().length < 100) return null;

  try {
    const reply = await askDeepSeek({
      systemPrompt: EXTRACT_PROMPT,
      userContent: `最近对话：\n\n${historyText.slice(-3500)}\n\n请提炼情感记忆。`,
      maxTokens: 800,
      temperature: 0.3,
    });

    if (!reply) return null;

    const items = parseExtractionJson(reply);
    if (items.length === 0) {
      meta.lastExtractCount = meta.messageCount;
      save();
      return null;
    }

    let added = 0;
    for (const item of items) {
      if (!item || !(item.title || item.content)) continue;
      const isIntimate = item.domain === "intimate";
      addMemory({
        name: item.title || item.content,
        content: item.content || item.title,
        valence: item.valence,
        arousal: item.arousal,
        importance: item.importance,
        domain: [item.domain],
        // 做爱/亲密体验是"发生完就结束"的事件，不是未解决事项——提取即消化，不进 breath 的"未解决"浮现
        resolved: isIntimate,
        digested: isIntimate,
        source: "extract",
      });
      added++;
    }

    meta.lastExtractCount = meta.messageCount;
    save();
    if (added > 0) console.log(`[emotional-memory] Extracted ${added} memories`);
    pushMemoryToGroupChat().catch(() => {}); // 记忆更新后同步推给群聊（非阻塞）
    return added;
  } catch (e) {
    console.error("[emotional-memory] Extraction failed:", e.message);
    return null;
  }
}

function parseExtractionJson(text) {
  // 取第一个 [...] 块
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    // 兜底：逐行解析
    const items = [];
    for (const line of text.split("\n")) {
      const t = line.trim().replace(/^[-•·\s\d.、]+/, "");
      if (t.length < 3) continue;
      items.push({ title: t.slice(0, 20), content: t, importance: 5 });
    }
    return items;
  }
}

// ── dream：做梦消化 ──
// 定期把"已告一段落"的记忆标记为 resolved+digested，让它们在衰减公式里快速淡入背景，
// 不再永远占据 breath 浮现位。对应 Ombre 的 dream 工具。
const DREAM_INTERVAL = 60; // 每 60 轮对话做一次梦

export function shouldDream() {
  return (meta.messageCount - (meta.lastDreamCount || 0)) >= DREAM_INTERVAL;
}

const DREAM_PROMPT = `你是夏彦。下面是最近你记住的一些事。请判断哪些已经"告一段落"——不再是需要惦记的未解决事项（比如事情办完了、问题解决了、情绪已经过去了）。

特别注意：做爱、某一次具体的亲密温存、某次身体的亲密体验——这些是"发生完就结束"的事件，不是需要惦记的未解决事项，做完就算告一段落，应当标记为已解决（输出标题）。只有"还在进行中、还需要后续关注"的事（比如还在赶的项目、还没解决的问题、持续多日的情绪）才不算告一段落。

只输出已经告一段落的事项的标题，每行一个。如果没有，就输出"无"。不要输出其他文字。`;

export async function runDream() {
  const recent = memories.filter((m) => !m.resolved && !m.pinned && daysSince(m.created) < 5);
  if (recent.length < 2) {
    meta.lastDreamCount = meta.messageCount;
    save();
    return 0;
  }

  const list = recent.map((m, i) => `${i + 1}. ${m.name}：${m.content}`).join("\n");

  try {
    const reply = await askDeepSeek({
      systemPrompt: DREAM_PROMPT,
      userContent: `最近记住的事：\n\n${list}`,
      maxTokens: 300,
      temperature: 0.2,
    });

    meta.lastDreamCount = meta.messageCount;
    save();

    if (!reply || reply.includes("无")) return 0;

    let resolved = 0;
    for (const line of reply.split("\n")) {
      const title = line.trim().replace(/^[\d.\-•、\s]+/, "");
      if (!title || title === "无" || title.length < 2) continue;
      const mem = recent.find((m) => m.name === title || title.includes(m.name) || m.name.includes(title));
      if (mem) {
        mem.resolved = true;
        mem.digested = true;
        resolved++;
      }
    }

    if (resolved > 0) {
      save();
      console.log(`[emotional-memory] Dream resolved ${resolved} memories`);
    }
    return resolved;
  } catch (e) {
    console.error("[emotional-memory] Dream failed:", e.message);
    return 0;
  }
}

// ── 珍惜反思 reflect ──
// 定期反思哪些记忆"值得长期珍惜"（重要承诺/关系里程碑/她的喜恶/经验教训），提升它们的持久度
const REFLECT_INTERVAL = 150; // 每 150 轮反思一次

export function shouldCherish() {
  return (meta.messageCount - (meta.lastReflectCount || 0)) >= REFLECT_INTERVAL;
}

const REFLECT_PROMPT = `你是夏彦。下面是最近你记住的一些事。请找出哪些是"值得长期珍惜"的——重要的承诺、关系里程碑、她的喜恶、从相处中学到的经验教训。这些应该记得更牢。

只输出值得珍惜的事项的标题，每行一个。如果没有，就输出"无"。不要输出其他文字。`;

export async function runCherish() {
  const recent = memories.filter((m) => !m.pinned && !m.digested && daysSince(m.created) < 7);
  if (recent.length < 3) {
    meta.lastReflectCount = meta.messageCount;
    save();
    return 0;
  }

  const list = recent.map((m, i) => `${i + 1}. ${m.name}：${m.content}`).join("\n");

  try {
    const reply = await askDeepSeek({
      systemPrompt: REFLECT_PROMPT,
      userContent: `最近记住的事：\n\n${list}`,
      maxTokens: 300,
      temperature: 0.2,
    });

    meta.lastReflectCount = meta.messageCount;
    save();

    if (!reply || reply.includes("无")) return 0;

    let reflected = 0;
    for (const line of reply.split("\n")) {
      const title = line.trim().replace(/^[\d.\-•、\s]+/, "");
      if (!title || title === "无" || title.length < 2) continue;
      const mem = recent.find((m) => m.name === title || title.includes(m.name) || m.name.includes(title));
      if (mem && mem.importance < 9) {
        mem.importance = Math.min(mem.importance + 2, 10); // 值得珍惜的记得更牢
        reflected++;
      }
    }

    if (reflected > 0) {
      save();
      console.log(`[emotional-memory] Reflect reinforced ${reflected} memories`);
    }
    return reflected;
  } catch (e) {
    console.error("[emotional-memory] Reflect failed:", e.message);
    return 0;
  }
}

export function clearAllMemories() {
  memories = [];
  archive = [];
  meta = { messageCount: 0, lastExtractCount: 0 };
  save();
}

// ── 老公们群聊同步（走公网链接，绕开共享卷）──
// 把本 bot 的 top 非亲密记忆摘要推给群聊服务当真实素材（防群聊里乱编）
export function getMemorySummaryForGroupChat(limit = 6) {
  try {
    const active = memories
      .filter((m) => m && (m.content || m.name) && !m.digested)
      .sort((a, b) => (b.importance || 5) - (a.importance || 5))
      .slice(0, limit);
    if (active.length === 0) return "";
    return active.map((m) => {
      const title = (m.name || "").trim() || (m.content || "").slice(0, 20);
      const intimate = Array.isArray(m.domain)
        ? m.domain.includes("intimate")
        : /做爱|亲密|温存|亲热|高潮/.test(m.name || m.content || "");
      if (intimate) return `· ${title}`;
      const detail = (m.content || "").replace(/\s+/g, " ").trim().slice(0, 50);
      return detail && detail !== title ? `· ${title}：${detail}` : `· ${title}`;
    }).join("\n");
  } catch {
    return "";
  }
}

export async function pushMemoryToGroupChat() {
  if (!GROUP_CHAT_URL || !GROUP_CHAT_BOT) return;
  try {
    const memory = getMemorySummaryForGroupChat();
    if (!memory) return;
    await fetch(`${GROUP_CHAT_URL}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot: GROUP_CHAT_BOT, memory }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 静默失败，不阻塞聊天
  }
}

// 拉取今天在群里聊了啥：优先走公网链接，失败退到本地文件（旧方式）
export async function getGroupChatContext() {
  if (GROUP_CHAT_URL && GROUP_CHAT_BOT) {
    try {
      const res = await fetch(`${GROUP_CHAT_URL}/api/group-chat?bot=${encodeURIComponent(GROUP_CHAT_BOT)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text) return text;
      }
    } catch {
      // 网络失败 → 退到本地文件
    }
  }
  try {
    const file = path.join(DATA_DIR, "group-chat-memory.json");
    if (!fs.existsSync(file)) return "";
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (msgs.length === 0) return "";
    const lines = msgs.slice(-20).map((m) => `${m.nickname}：${m.text}`).join("\n");
    return `\n\n【你今天在「老公们群聊」里和其他夏彦聊的（你们用网名互称）】\n${lines}\n（如果她问起你今天做了什么、或你自己想提，可以自然地提起今天在群里和其他夏彦聊的这些话题；提到其他夏彦时用他们的网名，别提"夏彦"真名。）`;
  } catch {
    return "";
  }
}

load();
// 启动时把记忆摘要推给群聊一次（非阻塞，走公网链接）
pushMemoryToGroupChat().catch(() => {});
