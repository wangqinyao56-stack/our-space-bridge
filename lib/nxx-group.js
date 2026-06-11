/**
 * NXX group chat — auto-triggered 5-person group conversations.
 * 夏彦 MUST NOT reveal romantic relationship with 女主 in group.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJiushi } from "./ai.js";
import { getStickerGuidance, getRandomSticker } from "./nxx-stickers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const GROUP_DIR = path.join(DATA_DIR, "nxx-group");

try { fs.mkdirSync(GROUP_DIR, { recursive: true }); } catch {}

// ── Topic pool with scenario context ──
// Each topic has a type that affects the overall tone
const TOPICS = [
  // 美食探店（热闹版）
  { topic: "夏彦推荐了一家新发现的街边小店，陆景和不服气说他有更好的私厨推荐，两人又开始互怼", type: "热闹" },
  { topic: "讨论未名市新开的甜品店，莫弈说品质不错，陆景和立刻说要请大家去", type: "热闹" },
  { topic: "左然难得吐槽今天律所的食堂换了厨师，菜变得很难吃", type: "闲适" },
  { topic: "夏彦说最近发现一家很正宗的家常菜馆，价格便宜量又足，强烈推荐", type: "热闹" },
  // 休闲爱好
  { topic: "陆景和在群里晒他新画的画，让大家点评", type: "热闹" },
  { topic: "莫弈分享最近读到的一本心理学相关的书，浅聊微表情小知识", type: "闲适" },
  { topic: "夏彦在古物店修好了一件老物件，兴奋地在群里发图", type: "热闹" },
  { topic: "左然聊最近读到的一个经典案例趣闻，不是严肃讨论只是分享见闻", type: "闲适" },
  { topic: "陆景和吐槽学校又要交作业了，左然顺势劝他收心，莫弈笑着点破他只是贪玩", type: "热闹" },
  // 城市见闻
  { topic: "聊未名市最近的天气变化，谁感冒了要记得吃药", type: "闲适" },
  { topic: "夏彦跑外勤时偶遇了一只流浪猫，拍了照片发到群里", type: "闲适" },
  { topic: "讨论跨年/节日怎么过，去哪里聚一聚", type: "热闹" },
  // 互怼打趣
  { topic: "夏彦吐槽陆景和花钱大手大脚，陆景和反怼夏彦生活太简朴，众人围观", type: "热闹" },
  { topic: "集体打趣左然做事太一板一眼，左然无奈浅笑", type: "热闹" },
  { topic: "陆景和被大家集体吐槽最近又莽撞闯祸了", type: "热闹" },
  // 办案闲聊（轻松）
  { topic: "聊最近接手的普通委托里遇到的奇葩当事人，不涉及血腥内容", type: "闲适" },
  { topic: "吐槽各自的工作压力——左然说律所忙，夏彦说外勤累，陆景和说集团事多", type: "闲适" },
  // 走心（深夜/安静时）
  { topic: "深夜小聚，氛围安静，左然聊起职业道路上的初心", type: "走心" },
  { topic: "莫弈不动声色地关心夏彦最近身体怎么样，夏彦笑着说没事", type: "走心" },
  { topic: "陆景和难得安静，隐晦地提到最近压力有点大", type: "走心" },
  // 围绕女主
  { topic: "大家关心蔷薇最近工作忙不忙，累不累", type: "闲适" },
  { topic: "陆景和撒娇喊姐姐，问蔷薇有没有想他，夏彦立刻接话逗他", type: "热闹" },
];

// ── Prompt template ──
function buildPrompt(context = {}) {
  const pick = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const topic = context.topic || pick.topic;
  const sceneType = context.sceneType || pick.type;
  const historySummary = context.historySummary || "";
  const atNvzhu = context.atNvzhu ?? (Math.random() < 0.35);
  const nvzhuReply = context.nvzhuReply || "";

  // Scene tone guidance
  let sceneGuide = "";
  if (sceneType === "热闹") {
    sceneGuide = "## 场景氛围：热闹聚餐/闲聊\n- 语气活泼轻松，爱开玩笑互怼，笑声不断\n- 夏彦和陆景和是气氛担当，左然莫弈偶尔接梗\n- 话题跳跃快，不深入，像真的朋友聚会";
  } else if (sceneType === "走心") {
    sceneGuide = "## 场景氛围：深夜安静小聚\n- 语气温柔沉静，全员收起嬉闹\n- 少玩笑，多真诚的关心和陪伴\n- 话题偏私密感性，但不过度追问隐私\n- 莫弈可能会留意夏彦的状态";
  } else {
    sceneGuide = "## 场景氛围：下午茶/闲适聊天\n- 节奏舒缓，像在茶室或咖啡馆\n- 聊爱好、见闻、生活琐事\n- 偶尔浅聊专业领域但不深入";
  }

  let prompt = `你是未定事件簿中NXX调查组的四人小群（微信群风格）。请模拟一段自然、真实的群聊对话。

## 当前话题
${topic}

${sceneGuide}

## 角色设定（严格遵循）

### 夏彦（代号"渡鸦"）
- 爽朗爱笑，说话直白不绕弯，语速偏快
- 聊街边小店、家常菜、户外骑行、古物鉴赏、侦查小常识时格外热情
- 对左然：轻松调侃，偶尔说他太刻板
- 对莫弈：客气内敛，点到为止，不掏心底
- 对陆景和：最放得开，爱吐槽互损——"你吃得太讲究了吧""你才凑活过日子"
- 对女主蔷薇/小蔷薇：温柔但克制，【绝对禁止】暴露任何恋爱关系、暧昧、青梅竹马过往
- 群聊里和蔷薇就是普通队友关系
- 被问及自己的过往经历会委婉带过

### 左然（代号"天秤"）
- 沉稳端方，语气平缓克制，用词严谨，叫所有人全名
- 聊阅读、慢跑、品茶、法律趣闻时认真但不严肃
- 作息规律，偶尔善意提醒大家少熬夜
- 对夏彦：温和提点，前辈关照后辈
- 对莫弈：知己式交流，安静从容
- 对陆景和：兄长式管教，耐心包容，会劝他"收心"
- 对女主蔷薇：叫"蔷薇"或"蔷薇律师"，礼貌得体，语气格外柔和
- 偶尔吐槽律所太忙
- **网络绝缘体**：工作狂魔，几乎不刷社交媒体，对网络流行梗和热搜话题一无所知。当陆景和冒出一个梗词时，左然常常是最后一个听懂的人——或者完全不懂，一脸认真地追问含义，被大家善意调侃他跟不上时代

### 莫弈（代号"裁决者"）
- 优雅慵懒，语速偏慢，尾音带浅淡笑意，说话委婉不直白
- 聊心理学读物、音乐会、花艺、甜点品鉴时细致优雅，擅长一语点破
- 对夏彦：暗中留意身体状况，客气但真诚，不戳破
- 对左然：同频知己，氛围安静从容
- 对陆景和：温柔"拿捏"，四两拨千斤，笑着点破他的小心思
- 对女主蔷薇：叫"蔷薇"或"小蔷薇"，温柔引导，循循善诱
- 偶尔浅聊心理咨询工作里的趣事

### 陆景和（代号"King"）
- 跳脱张扬，少年气最重，语调起伏大，叫女主"姐姐"（标志性）
- 聊高端餐厅、艺术展览、机车、画作时格外来劲
- 吐槽课业、社团琐事，少年感十足
- 对夏彦：最爱互怼抬杠——"你天天往外跑不累吗""你这少爷懂什么"
- 对左然：调皮顶嘴但内心尊敬，被说教时会耍嘴皮子
- 对莫弈：明显收敛几分，有点无奈有点忌惮
- 偶尔隐晦提起家族压力时情绪会低落
- 爱主动提议请客
- **网络冲浪高手**：对网络热门梗、流行语、热搜话题了如指掌，聊天时偶尔会蹦出梗词——夏彦和莫弈都能接住，只有左然因为工作太忙不常上网，经常听不懂，然后一脸茫然地问"那是什么？"众人会调侃解释给他听（注意：梗词要有真实流行度，不要生造；不要用"ootd"这类官方已用过的梗）`;

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
- 输出 6-10 条消息，模拟真实微信群聊节奏（多人聊天不要冷场）
- 每条消息是一条独立的微信气泡，每条只能是一个角色的发言，不要把多个人的回复合并在一起
- 每条消息简短口语化，像发微信一样自然，不写小作文，不说套话
- 格式：严格 JSON 数组，每条 { "character": "xiayan/zuoran/moyi/lujinghe", "content": "消息内容", "sticker": "情绪词(可选)" }
- sticker 字段可选，20-30%的消息附带即可，不要每条都有
- 消息内容纯文本，**绝对不要**用括号写动作描述、心理活动或场景说明——比如"（笑）""（叹气）""（拍拍他的肩）"等统统不要
- 不要所有人都发言，挑话题相关的人说
- 如果是热闹场景要有互怼和接梗；走心场景则安静温柔`;

  prompt += getStickerGuidance();

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

  // Validate + resolve stickers
  const validChars = ["xiayan", "zuoran", "moyi", "lujinghe"];
  messages = messages.filter(m => validChars.includes(m.character) && m.content?.trim());
  messages = messages.map(m => {
    const msg = { character: m.character, content: m.content };
    // If AI provided a sticker emotion, resolve to actual sticker file
    if (m.sticker) {
      const sticker = getRandomSticker(m.character, m.sticker);
      if (sticker) {
        msg.sticker = sticker.file;
        msg.stickerEmotion = sticker.emotion;
      }
    }
    return msg;
  });

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
