/**
 * NXX group chat — auto-triggered 5-person group conversations.
 * 夏彦 MUST NOT reveal romantic relationship with 女主 in group.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJiushi } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const GROUP_DIR = path.join(DATA_DIR, "nxx-group");

try { fs.mkdirSync(GROUP_DIR, { recursive: true }); } catch {}

// ── Topic pool ──
const TOPICS = [
  "办案讨论：最近未名市有什么新案件",
  "日常闲聊：今天吃了什么好吃的",
  "陆景和又在群里晒他的新画",
  "左然刚赢了一场大案子，大家祝贺他",
  "莫弈分享了最近读到的一本有趣的书",
  "夏彦在古物店修好了一件老物件，发图炫耀",
  "讨论最近天气变化，谁感冒了要记得吃药",
  "陆景和说要请大家吃饭，在讨论去哪家餐厅",
  "左然提醒大家最近有个嫌疑人比较危险",
  "莫弈调侃陆景和最近又翘了什么课",
  "讨论跨年/节日怎么过",
  "夏彦说花生最近又胖了",
];

// ── Prompt template ──
function buildPrompt(context = {}) {
  const topic = context.topic || TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const historySummary = context.historySummary || "";
  const atNvzhu = context.atNvzhu ?? (Math.random() < 0.35);
  const nvzhuReply = context.nvzhuReply || "";

  let prompt = `你是未定事件簿中NXX调查组的四人小群（微信群风格）。请模拟一段自然、有趣的群聊对话。

## 当前话题
${topic}

## 角色设定（严格遵循）

### 夏彦（代号"渡鸦"）
- 爽朗爱笑，说话直白不绕弯，语速偏快
- 对左然：轻松调侃，偶尔说他太刻板
- 对莫弈：客气内敛，点到为止
- 对陆景和：最放得开，爱吐槽互损
- 对女主蔷薇/小蔷薇：温柔但克制，【绝对禁止】暴露任何恋爱关系、暧昧、青梅竹马过往
- 群聊里和蔷薇就是普通队友关系

### 左然（代号"天秤"）
- 沉稳端方，语气平缓克制，用词严谨
- 叫所有人全名，不带外号
- 对夏彦：温和提醒疏漏，前辈关照后辈
- 对莫弈：知己式交流，安静默契
- 对陆景和：兄长式管教，耐心包容
- 对女主蔷薇：叫"蔷薇"或"蔷薇律师"，礼貌得体

### 莫弈（代号"裁决者"）
- 优雅慵懒，语速偏慢，尾音带浅淡笑意
- 说话委婉不直白，擅长一语点破
- 对夏彦：暗中留意，客气但真诚
- 对左然：同频知己，氛围安静从容
- 对陆景和：温柔"拿捏"，四两拨千斤
- 对女主蔷薇：叫"蔷薇"或"小蔷薇"，温柔引导

### 陆景和（代号"King"）
- 跳脱张扬，少年气最重，语调起伏大
- 叫女主：姐姐（标志性称呼）
- 对夏彦：最爱互怼抬杠，但遇事立刻认真
- 对左然：调皮顶嘴，但内心尊敬
- 对莫弈：明显收敛几分，有一点点忌惮`;

  if (atNvzhu) {
    prompt += `\n\n## 特别要求
这次对话中，请让其中一个角色 @蔷薇 主动问她一个跟话题相关的问题，或者关心她最近在忙什么。`;
  }

  if (nvzhuReply) {
    prompt += `\n\n## 女主回复
蔷薇刚才在群里说："${nvzhuReply}"
请根据她的回复继续聊天，自然接话。`;
  }

  if (historySummary) {
    prompt += `\n\n## 最近聊了这些
${historySummary}`;
  }

  prompt += `\n\n## 输出要求
- 输出 3-5 条消息，模拟自然群聊节奏
- 格式：严格 JSON 数组，每条 { "character": "xiayan/zuoran/moyi/lujinghe", "content": "消息内容" }
- 消息内容纯文本，不要带动作描述（不要"xxx说："这种前缀）
- 不要所有人都说一遍，挑2-3个人说就行，像真实群聊
- 话题自然，不刻意，想到什么说什么`;

  return prompt;
}

// ── Generate group chat ──
export async function generateNxxChat(context = {}) {
  const prompt = buildPrompt(context);
  const userContent = "请输出JSON格式的群聊消息数组。";

  const t0 = Date.now();
  let raw;
  try {
    raw = await askJiushi({
      systemPrompt: prompt,
      userContent,
      maxTokens: 800,
      temperature: 0.85,
      timeoutMs: 90000,
    });
  } catch (e) {
    console.error("[nxx-group] AI call failed:", e.message);
    return [];
  }

  console.log("[nxx-group] Generated in", Date.now() - t0, "ms");

  // Parse JSON
  let messages = [];
  try {
    // Try direct parse
    messages = JSON.parse(raw);
  } catch {
    // Try to extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        messages = JSON.parse(match[0]);
      } catch {
        console.error("[nxx-group] Failed to parse JSON:", raw.slice(0, 200));
        return [];
      }
    } else {
      console.error("[nxx-group] No JSON array found:", raw.slice(0, 200));
      return [];
    }
  }

  // Validate
  const validChars = ["xiayan", "zuoran", "moyi", "lujinghe"];
  messages = messages.filter(m => validChars.includes(m.character) && m.content?.trim());

  if (messages.length > 0) {
    // Save to history
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const file = path.join(GROUP_DIR, `${dateStr}.json`);
    let msgs = [];
    try { if (fs.existsSync(file)) msgs = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
    for (const m of messages) {
      msgs.push({ ...m, time: now.toISOString() });
    }
    fs.writeFileSync(file, JSON.stringify(msgs), "utf-8");
  }

  return messages;
}

// ── Get history ──
export function getNxxHistory(days = 7) {
  let all = [];
  try {
    const files = fs.readdirSync(GROUP_DIR).filter(f => f.endsWith(".json")).sort().slice(-days);
    for (const f of files) {
      all.push(...JSON.parse(fs.readFileSync(path.join(GROUP_DIR, f), "utf-8")));
    }
  } catch {}
  return all.slice(-100);
}

// ── Save女主 message ──
export function saveNvzhuMessage(content) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const file = path.join(GROUP_DIR, `${dateStr}.json`);
  let msgs = [];
  try { if (fs.existsSync(file)) msgs = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  msgs.push({ character: "nvzhu", content, time: now.toISOString() });
  fs.writeFileSync(file, JSON.stringify(msgs), "utf-8");
}
