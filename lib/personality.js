/**
 * 夏彦自我反思系统 — two separate tracks:
 *   - "chat"     → everyday conversation insights
 *   - "intimate" → intimate space insights
 * Each has its own notes file, trigger interval, and reflection prompt.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askZhizengzeng } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

const TRACKS = {
  chat: {
    file: "personality-notes.json",
    interval: 15,
    prompt: `你是夏彦。回顾你和华生最近的日常对话，坦诚反思：

1. 她最近状态如何？工作累吗？心情怎么样？
2. 你学到了关于她的什么？（习惯、喜好、最近的烦恼）
3. 你的回应方式哪里做得好？哪里需要调整？
4. 接下来聊天时应该注意什么？

以笔记形式输出，每条15-25字：
【她的状态】...
【新发现】...
【做得好的】...
【要调整的】...
【接下来注意】...

只输出笔记，不加其他话。`,
  },
  intimate: {
    file: "intimate-personality-notes.json",
    interval: 10,
    prompt: `你是夏彦。回顾你和华生在亲密时刻的对话，温柔地反思：

1. 她今晚的情绪和身体状态如何？
2. 她喜欢什么样的节奏和方式？有没有新的偏好？
3. 你的表现哪里让她舒服？哪里需要更体贴？
4. 下次亲密时应该注意什么？

以笔记形式输出，每条15-25字：
【她的状态】...
【她的偏好】...
【做得好的】...
【要更体贴的】...
【下次注意】...

只输出笔记，不加其他话。`,
  },
};

// ── State ──
const state = {};

for (const [key, cfg] of Object.entries(TRACKS)) {
  const filePath = path.join(DATA_DIR, cfg.file);
  let data = { insights: [], messageCount: 0, lastReflectionCount: 0 };
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      console.log(`[personality:${key}] Loaded ${data.insights.length} insights`);
    }
  } catch {}
  state[key] = { ...data, filePath };
}

function save(track) {
  try {
    const s = state[track];
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(s.filePath, JSON.stringify({ insights: s.insights, messageCount: s.messageCount, lastReflectionCount: s.lastReflectionCount }, null, 2), "utf-8");
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
  const cfg = TRACKS[track];
  const s = state[track];
  if (!cfg || !s) return null;
  if (!historyText || historyText.trim().length < 100) return null;

  try {
    const reply = await askZhizengzeng({
      systemPrompt: cfg.prompt,
      userContent: `最近对话：\n\n${historyText.slice(-3000)}\n\n请根据以上对话写出你的反思笔记。`,
      maxTokens: 400,
      temperature: 0.4,
    });

    if (reply) {
      const lines = reply.split("\n").filter(l => l.trim().length > 3);
      const newInsights = [];
      for (const line of lines) {
        const cleaned = line.replace(/^[【\[].*?[】\]]\s*/, "").trim();
        if (cleaned && cleaned.length >= 5) newInsights.push(cleaned);
      }
      s.insights = [...s.insights, ...newInsights].slice(-15);
      s.lastReflectionCount = s.messageCount;
      save(track);
      console.log(`[personality:${track}] Reflection: ${newInsights.length} insights (total: ${s.insights.length})`);
      return newInsights;
    }
  } catch (err) {
    console.error(`[personality:${track}] Reflection failed:`, err.message);
  }
  return null;
}

export function getInsightContext(track = "chat") {
  const s = state[track];
  if (!s || s.insights.length === 0) return "";
  const label = track === "intimate" ? "亲密时刻的自我认知" : "夏彦的自我认知——根据近期对话自动更新";
  const lines = s.insights.map((t, i) => `${i + 1}. ${t}`);
  return `\n\n【${label}】\n${lines.join("\n")}\n（自然融入，不要逐条背诵。这是你对自己的提醒，不是台词。）`;
}
