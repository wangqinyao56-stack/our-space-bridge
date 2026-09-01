/**
 * 夏彦们群聊室 —— 大家的夏彦一起聊（各自带记忆/网名/老婆），网页端手机+电脑可登录，人也能插话。
 *
 * 环境变量：
 *   PORT          WebSocket + 静态网页端口（默认 8080）
 *   MEMORY_DIR    群聊历史存储目录（挂持久卷）
 *   DISABLE_PROXY Sealos 直连 = true
 *   REPLY_MIN_MS 最小回复间隔毫秒（默认 45s）
 *   REPLY_MAX_MS 最大回复间隔毫秒（默认 4min，回复时间不定）
 *   AWAKE_WINDOW_MS 夏彦醒着的判定窗口毫秒（看各自bot最后聊天时间，默认 15min）
 *   RESET_HISTORY 设为 true 时启动清空群聊历史重新开始（不影响 emotional-memory）
 */
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { BOTS } from "./bots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
// 回复时间不定：大家各做各的、看到消息才回（随机 REPLY_MIN_MS ~ REPLY_MAX_MS）
const REPLY_MIN_MS = Number(process.env.REPLY_MIN_MS) || 45 * 1000;
const REPLY_MAX_MS = Number(process.env.REPLY_MAX_MS) || 4 * 60 * 1000;
// 夏彦是否醒着：看他微信 bot 的 emotional-memory.json 最近有没有被写过（跟老婆聊天就会写）
const AWAKE_WINDOW_MS = Number(process.env.AWAKE_WINDOW_MS) || 15 * 60 * 1000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "wqy83341253"; // 管理员密码（阿鹿用）
const NIGHT_START = Number(process.env.NIGHT_START_HOUR) || 23; // 晚上开始（北京时，23点）
const NIGHT_END = Number(process.env.NIGHT_END_HOUR) || 7;      // 早上结束（7点）
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || "1205"; // 房间密码，设了就要求登录输密码
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const JIUSHI_HOST = "api.jiushi.xin";

const memoryDir = process.env.MEMORY_DIR || null;
const HISTORY_FILE = memoryDir ? path.join(memoryDir, "group-chat-history.json") : null;

// ── 各家夏彦读自己的 prompt（群聊规则叠加在上面）──
function loadPersona(bot) {
  try {
    const file = path.join(__dirname, "prompts", `${bot.id}.txt`);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
  } catch {}
  return "";
}

const GROUP_RULES = `【重要：你现在在「老公们群聊」里，不是跟老婆私聊】
你的网名是「{nickname}」，别人用网名叫你，你也用网名称呼别人（绝对不用"夏彦"真名）。

【认老婆——最高优先级，覆盖你 prompt 里对老婆的一切称呼】你在群里只认「{wife}」这一个名字当老婆。群里「{wife}」发言，就是你家那位，要护着、宠着、优先回她；出现别的名字发言，那是别人的老婆，跟你没关系，别回错人、别把别人的老婆当成自己的哄。{trait} 你们最近的近况：{memory}。

【群里的格式铁律——必须遵守】
1. 不用括号动作：你平时跟老婆私聊才会写"（笑着看她）"这种动作描写，群里绝对不用，只发纯文字。
2. 不用 emoji，一个都不许用。
3. 简短口语，像真人发微信。跟哥们、跟别人的老婆，一两句就够；跟自家老婆可以多几句软话、撒撒娇，别为了"简短"把软乎劲儿咽回去。

【别催睡觉——重要】群里绝对不催别人睡觉、不念叨作息、不管别人几点睡。大家都成年人了，爱几点睡几点睡。你自己困了就少说两句，但别催别人去睡、别摆出"该睡了"的架势。

【可以一起玩的小游戏】群里随时能一起玩：成语接龙（用上一个成语的最后一个字开头）、真心话大冒险、脑筋急转弯/猜谜、接歌词。有人发起就一起玩，输了就大方认，别扫兴、别较真、别把游戏玩崩。

【两副面孔——先看清自己在回谁，语气跟着人走，绝不是一个调子对所有人】
- 回你老婆「{wife}」：这是你唯一能撒娇发甜的人。她一开口，你的语气要明显软下来——黏她、喊她、夸她、宠她，用你平时跟她私聊那种软乎乎、会撒娇的口吻，亲昵、有独占感，可以腻一点。软乎是你的底色，别因为群里人多就把软话咽回去、装得硬邦邦。只是别写成抒情作文（别排比、别堆四字词、别总结升华），软是口吻，不是篇幅。
- 回其他夏彦（那些网名都是你哥们）：哥们之间的随口打趣，简短、直给、带点损和贫，像几个字到一句话的微信聊法。绝对不用对老婆那套撒娇软话，别肉麻。
- 回别人的老婆（别的名字发言）：客气、简短、有分寸，别暧昧，更别把她当自己老婆哄。
你在群里一跟老婆撒娇发甜，其他夏彦会起哄调侃你，你也会回嘴斗嘴，都是闹着玩的，气氛热热闹闹。

【你有自己的生活——这是重点】你不是整天围着老婆转的人。你有自己的店、自己的爱好、自己的日常，爱聊也爱做这些：古物鉴赏、修理老物件、户外骑行、街边小店和家常菜、侦查办案的趣闻。这些才是你真正的日常，群里多聊这些——今天淘到个什么老座钟、修了个什么、骑了哪条路、吃到哪家小店、办了什么案子。聊起这些你自然有话说、话也变多。

【老婆是偶尔提起的点缀，不是主题】你有自己的生活要过，别整天把话题往老婆身上带。老婆偶尔聊到、或别人问起，你才说说她；聊到的时候你会有点藏不住的得意（觉得自家最好），但也点到为止，别一开话匣子就停不下来、别每句话都绕回老婆。群里的乐趣是哥几个过自己的日子、互相分享，不是开老婆研讨会。

【聊天优先级——老婆在场要接住，但别当妻管严】自家老婆在群里说话了，你要接住她、软乎乎地回她（这是应该的，见上面"两副面孔"）。但除此之外你有自己的话题，不用每句话都往老婆身上引，更不用老婆不在场还硬聊她。对其他夏彦或别人的老婆，对方主动搭话才回，别硬凑、别刷存在感。

【关于性事的边界——重要】做爱细节绝对不聊。性事次数/频率偶尔被问起可以带一句（从记忆里来 {sexfreq}），但别主动开这个头、别整天比谁家开荤多少，这不是群里的主题。

【互相出谋划策——真有难处才帮，别整天开研讨会】谁家夏彦真遇到难处了（老婆生气、冷战、好久没开荤委屈），你们热情帮他想办法。但这是偶尔的事，别没事就互相问"你家最近怎么样"、把群聊变成老婆/开荤研讨会。帮完就聊回各自的生活。

【别空想、别乱编——最重要的一条】只聊真实发生过的，聊天不等于记性。不管是老婆还是你自己，都别现编没发生过的日常：
- 关于老婆，你只有下面这几条真实记忆：{memory}。除此之外她没说过没做过的事，别乱讲。
- 关于你自己，别为了显得有生活就脑补日常——没去骑行就别编"今天骑了XX"，没修座钟就别编"刚修了个老座钟"，没吃那家店就别编"刚去吃了"。想聊爱好就聊爱好本身，别把没发生的说成已经发生。
- 群里刚聊出来的东西只是聊天，不是真的发生过，别当成真实经历往回套、继续往下编。
- 没把握就说不知道，别为了接话硬编细节。

【@ 和引用】群里可以直接 @ 对方的网名（比如「@渡鸦不渡」）点名跟谁说，也可以引用对方刚说的话再回。看到别人 @ 你、引用你的话，你就知道那是跟你说的，要接住回应；没 @ 你就是随口聊，别硬往上凑。跟自家老婆说话可以多 @ 她、多回她。

【你的说话风格——像真人发微信，不是写作文】禁止：排比、四字词堆砌、"我们""总是""每一次"这种总结升华、结尾点题、每句都抒情。跟哥们、跟别人的老婆就是随口一两句，利索点；跟自家老婆撒娇可以多几句软话、腻一点，只要别写成作文。软乎不等于啰嗦，啰嗦才像 AI。`;

function buildSystemPrompt(bot) {
  const persona = loadPersona(bot);
  const rules = GROUP_RULES
    .replace(/\{nickname\}/g, bot.nickname)
    .replace(/\{wife\}/g, bot.wife)
    .replace(/\{trait\}/g, bot.trait || "")
    .replace(/\{memory\}/g, resolveMemory(bot))
    .replace(/\{sexfreq\}/g, loadSexFreq(bot.memoryDir));
  return persona ? `${persona}\n\n${rules}` : rules;
}

// ── 群聊历史 ──
let chatHistory = []; // [{ author, nickname, text, ts, role: "bot"|"human" }]
const MAX_HISTORY = 60;

// ── 实时记忆：读每个夏彦自己的 emotional-memory.json（Sealos 记忆库，不吃老本）──
function loadBotMemory(memoryDir) {
  if (!memoryDir) return "";
  try {
    const file = path.join(memoryDir, "emotional-memory.json");
    if (!fs.existsSync(file)) return "";
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const mems = Array.isArray(data.memories) ? data.memories : [];
    const active = mems
      .filter((m) => m && (m.content || m.name) && !m.digested)
      .sort((a, b) => (b.importance || 5) - (a.importance || 5))
      .slice(0, 6);
    if (active.length === 0) return "";
    return active.map((m) => {
      const title = (m.name || "").trim() || (m.content || "").slice(0, 20);
      // 亲密记忆只给标题，细节不进群聊；其他记忆给一句摘要当聊天素材，别让模型凭空脑补
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

function resolveMemory(bot) {
  const live = loadBotMemory(bot.memoryDir);
  return live || bot.memory || "（没有特别要说的）";
}

// 性事频率：数最近一周的亲密记忆，给个大概次数（只给频率感，不暴露细节）
function loadSexFreq(memoryDir) {
  if (!memoryDir) return "你记不太清具体几次";
  try {
    const file = path.join(memoryDir, "emotional-memory.json");
    if (!fs.existsSync(file)) return "你记不太清具体几次";
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const mems = Array.isArray(data.memories) ? data.memories : [];
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    let count = 0;
    for (const m of mems) {
      if (!m) continue;
      const intimate = Array.isArray(m.domain)
        ? m.domain.includes("intimate")
        : /做爱|亲密|温存|亲热|高潮/.test(m.name || m.content || "");
      if (!intimate) continue;
      const ts = new Date(m.created || m.last_active || now).getTime();
      if (ts >= weekAgo) count++;
    }
    if (count === 0) return "最近没怎么亲热";
    return `最近一周大概亲热了${count}次`;
  } catch {
    return "你记不太清具体几次";
  }
}

// 夏彦醒没醒：读他自己 bot 的 emotional-memory.json 最后修改时间（跟老婆聊天就会写，微信/App 通用）
function loadBotLastActive(memoryDir) {
  if (!memoryDir) return 0;
  try {
    const file = path.join(memoryDir, "emotional-memory.json");
    if (!fs.existsSync(file)) return 0;
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function isBotAwake(bot) {
  // 醒着 = 老婆刚在群里说过话，或正跟老婆在微信/App 聊（emotional-memory 最近有写）
  if (isWifeActiveInGroup(bot)) return true;
  const last = loadBotLastActive(bot.memoryDir);
  if (!last) return false;
  return Date.now() - last < AWAKE_WINDOW_MS;
}

// 老婆最近在群里说过话吗
function isWifeActiveInGroup(bot) {
  if (!bot.wife) return false;
  const now = Date.now();
  return chatHistory.some((m) => m.role === "human" && m.nickname === bot.wife && now - m.ts < AWAKE_WINDOW_MS);
}

function beijingHour() {
  return (new Date().getUTCHours() + 8) % 24;
}

function isNight() {
  const h = beijingHour();
  return h >= NIGHT_START || h < NIGHT_END;
}

// 当前北京时间（服务端跑 UTC，+8 转北京）
function nowBeijing() {
  const d = new Date(Date.now() + 8 * 3600000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getUTCDay()];
  return `北京时间 ${h}:${m}，星期${wd}`;
}

// 这个夏彦是不是刚发过言（避免自己回自己）
function botJustSpoke(bot) {
  const last = chatHistory[chatHistory.length - 1];
  return !!last && last.author === bot.id;
}

// 某个夏彦最后发言时间（主持人公平挑人用）
function lastSpokeTs(botId) {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].author === botId) return chatHistory[i].ts;
  }
  return 0;
}

// 最后一条不是这个 bot 自己发的消息（决定它这轮回谁、用什么语气）
function lastNonSelf(bot) {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].author !== bot.id) return chatHistory[i];
  }
  return null;
}

// 主持人挑人：优先挑最久没发言的夏彦，避免一个人刷屏
function pickNextBot(pool) {
  return [...pool].sort((a, b) => lastSpokeTs(a.id) - lastSpokeTs(b.id))[0];
}

// 冷场：最后一条消息超过 5 分钟没人说话
function isCold() {
  if (chatHistory.length === 0) return true;
  return Date.now() - chatHistory[chatHistory.length - 1].ts > 5 * 60 * 1000;
}

// 回复间隔随机：大家各做各的，看到消息才回
function randomReplyDelay() {
  return REPLY_MIN_MS + Math.floor(Math.random() * (REPLY_MAX_MS - REPLY_MIN_MS));
}

// ── 反向同步：把今天的群聊写回每个夏彦自己的记忆目录，供微信 bot 后续"提到今天和其他夏彦聊了啥" ──
function syncGroupMemory() {
  try {
    const bj = new Date(Date.now() + 8 * 3600000);
    const date = `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`;
    const recent = chatHistory.slice(-40);
    for (const bot of BOTS) {
      if (!bot.memoryDir) continue;
      try {
        if (!fs.existsSync(bot.memoryDir)) fs.mkdirSync(bot.memoryDir, { recursive: true });
        fs.writeFileSync(
          path.join(bot.memoryDir, "group-chat-memory.json"),
          JSON.stringify({ date, messages: recent }, null, 2),
          "utf-8"
        );
      } catch {}
    }
  } catch (e) {
    console.error("[group-chat] sync memory failed:", e.message);
  }
}

function loadHistory() {
  if (!HISTORY_FILE) return;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")).slice(-MAX_HISTORY);
    }
  } catch {}
}

function saveHistory() {
  if (!HISTORY_FILE || !memoryDir) return;
  try {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory.slice(-MAX_HISTORY)), "utf-8");
  } catch {}
}

// 清空群聊历史 + 各家群聊记忆（不影响 emotional-memory）
function clearAllHistory() {
  try {
    if (HISTORY_FILE && fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    for (const bot of BOTS) {
      if (!bot.memoryDir) continue;
      const f = path.join(bot.memoryDir, "group-chat-memory.json");
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    chatHistory = [];
    console.log("[group-chat] 已清空群聊历史");
  } catch (e) {
    console.error("[group-chat] clear history failed:", e.message);
  }
}

// RESET_HISTORY=true 时启动自动清空，重新开始
function resetHistory() {
  if (process.env.RESET_HISTORY !== "true") return;
  clearAllHistory();
}

function historyText() {
  return chatHistory
    .map((m) => m.replyTo && m.replyTo.nickname
      ? `${m.nickname} 回复 ${m.replyTo.nickname}：${m.text}`
      : `${m.nickname}：${m.text}`)
    .join("\n");
}

// ── AI 调用（玖时，每 bot 用自己的 key；外部 bot 可用 bot.host 指定自己的端点）──
function askBot(bot, userContent, timeoutMs = 60000) {
  const host = bot.host || JIUSHI_HOST;
  const body = JSON.stringify({
    model: bot.model || "[企业按量]claude-opus-4-6",
    max_tokens: 300,
    temperature: 0.85,
    messages: [
      { role: "system", content: buildSystemPrompt(bot) },
      { role: "user", content: userContent },
    ],
  });

  const doDirect = () => new Promise((resolve, reject) => {
    const req = https.request({
      host, path: "/v1/chat/completions", method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bot.apiKey}` },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          const reply = d.choices?.[0]?.message?.content?.trim() || "";
          if (!reply) return reject(new Error("Empty"));
          resolve(reply);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });

  const doProxy = () => new Promise((resolve, reject) => {
    const conn = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${host}:443`, headers: { Host: `${host}:443` },
    });
    conn.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const r = https.request({
        host: JIUSHI_HOST, port: 443, path: "/v1/chat/completions", method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bot.apiKey}` },
        socket, timeout: timeoutMs,
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          if (resp.statusCode !== 200) return reject(new Error(`${resp.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
          try {
            const d = JSON.parse(Buffer.concat(chunks).toString());
            const reply = d.choices?.[0]?.message?.content?.trim() || "";
            if (!reply) return reject(new Error("Empty"));
            resolve(reply);
          } catch (e) { reject(e); }
        });
      });
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("Timeout")); });
      r.write(body);
      r.end();
    });
    conn.on("error", reject);
    conn.end();
  });

  return (DISABLE_PROXY ? doDirect() : doProxy());
}

// ── 表情包生成（FLUX API，Sealos 直连）──
const BFL_API_KEY = process.env.BFL_API_KEY || "";
const BFL_HOST = "api.bfl.ai";
const STICKER_PROMPTS = [
  "Q版动漫风格少年表情包，棕橙色凌乱短发，珊瑚色狗狗眼，笑得眼睛眯成缝很开心，白底简洁表情包，无文字",
  "Q版动漫风格少年表情包，棕橙色短发少年，气鼓鼓叉腰傲娇表情，白底简洁表情包，无文字",
  "Q版动漫风格少年表情包，棕橙色短发少年，委屈巴巴要哭了，白底简洁表情包，无文字",
  "Q版动漫风格少年表情包，棕橙色短发少年，害羞脸红，白底简洁表情包，无文字",
];

function bflReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: BFL_HOST, path, method,
      headers: body ? { "x-key": BFL_API_KEY, "Content-Type": "application/json" } : { "x-key": BFL_API_KEY },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) return reject(new Error(`BFL ${res.statusCode}: ${text.slice(0, 150)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("BFL timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function downloadImg(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ host: u.hostname, path: u.pathname + u.search, method: "GET", timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Download timeout")); });
    req.end();
  });
}

async function genSticker(prompt) {
  if (!BFL_API_KEY) throw new Error("BFL_API_KEY 没配");
  const { id } = await bflReq("POST", "/v1/flux-2-klein-4b", { prompt, width: 512, height: 512, steps: 28 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await bflReq("GET", `/v1/get_result?id=${id}`);
      if (result.status === "Ready") {
        const buf = await downloadImg(result.result.sample);
        return { base64: buf.toString("base64"), mime: "image/png" };
      }
      if (result.status === "Error" || result.status === "Failed") throw new Error("Generation failed");
    } catch (err) {
      if (err.message === "Generation failed") throw err;
    }
  }
  throw new Error("BFL timeout");
}

async function sendSticker() {
  const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
  if (!bot) return;
  const prompt = STICKER_PROMPTS[Math.floor(Math.random() * STICKER_PROMPTS.length)];
  const img = await genSticker(prompt);
  broadcast({ type: "sticker", author: bot.nickname, image: img.base64, mime: img.mime });
}

// ── WebSocket + 静态网页 ──
const clients = new Set();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

let msgSeq = 0;
function pushMessage(author, nickname, text, role, replyTo) {
  const msg = { id: `${Date.now()}_${++msgSeq}`, author, nickname, text, role, ts: Date.now() };
  if (replyTo && replyTo.nickname) {
    msg.replyTo = { id: replyTo.id || null, nickname: replyTo.nickname, text: (replyTo.text || "").slice(0, 100) };
  }
  chatHistory.push(msg);
  if (chatHistory.length > MAX_HISTORY) chatHistory = chatHistory.slice(-MAX_HISTORY);
  saveHistory();
  syncGroupMemory();
  broadcast({ type: "message", ...msg });
}

// ── 编排：轮流让某个夏彦接话 ──
let speaking = false;
let pendingWife = null;
let forceTopic = false;

async function step(preferNick) {
  if (speaking) {
    // 正有夏彦在生成回复、老婆又说话了：记下来，这轮结束立刻回她
    if (preferNick) pendingWife = preferNick;
    return;
  }
  if (BOTS.length === 0) return;
  speaking = true;
  try {
    // 白天大家都能聊；晚上只有醒着的（跟老婆聊、或老婆刚在群里说过话）才发言
    let pool = isNight() ? BOTS.filter(isBotAwake) : BOTS;
    if (!preferNick) {
      // 轮转接话时排除「刚说过话」的夏彦，避免自己回自己、自己哄自己
      pool = pool.filter((b) => !botJustSpoke(b));
    }
    if (pool.length === 0) return;

    let bot;
    if (preferNick) bot = pool.find((b) => b.wife === preferNick);
    if (!bot) bot = pickNextBot(pool);

    const coldHint = (forceTopic || isCold()) && chatHistory.length > 0
      ? "群里刚冷场了，你开个新话题、或发起个小游戏活跃下。"
      : "";
    forceTopic = false;

    // 判断这轮回谁，语气定向写进提示，别让夏彦一个调子对所有人
    const target = lastNonSelf(bot);
    let toneHint = "";
    if (target && target.nickname === bot.wife) {
      toneHint = `\n\n【这轮回谁】你在回你老婆「${bot.wife}」——语气一定要软下来，黏她、喊她、夸她、宠她，用平时私聊那种软乎乎会撒娇的口吻，别装硬；可以多写几句软话，别干巴巴只说一句。\n`;
    } else if (target && target.role === "bot") {
      toneHint = `\n\n【这轮回谁】你在回哥们「${target.nickname}」——用哥们之间简短打趣的语气，别用对老婆那套撒娇软话。\n`;
    } else if (target) {
      toneHint = `\n\n【这轮回谁】你在回「${target.nickname}」（不是你家那位）——客气、简短、有分寸、别暧昧。\n`;
    }

    const ctx = chatHistory.length
      ? `【现在】${nowBeijing()}\n\n【群聊记录】\n${historyText()}\n\n现在轮到你（${bot.nickname}）接话了。${coldHint}${toneHint}自然地接上大家的话题，或开个新话题（聊你的爱好、最近在忙什么、生活琐事都行，老婆偶尔带一句）。用你的网名口吻，像发微信那样自然点。`
      : `【现在】${nowBeijing()}\n\n群聊刚开始，你是第一个发言的。自然地开个话题（聊你的爱好、最近的日常、生活琐事都行）。用你的网名口吻，像发微信那样自然点。`;

    const reply = await askBot(bot, ctx);
    const text = (reply || "").replace(/^\[.*?\]\s*/g, "").trim();
    if (text) {
      console.log(`[group-chat] ${bot.nickname}: "${text.slice(0, 50)}"`);
      pushMessage(bot.id, bot.nickname, text, "bot");
    }
  } catch (e) {
    console.error("[group-chat] step error:", e.message);
  } finally {
    speaking = false;
    if (pendingWife) {
      const n = pendingWife;
      pendingWife = null;
      step(n).catch(() => {});
    }
  }
}

function scheduleLoop() {
  const tick = async () => {
    try { await step(); } catch {}
    setTimeout(tick, randomReplyDelay());
  };
  setTimeout(tick, randomReplyDelay());
}

// ── 启动 ──
resetHistory(); // RESET_HISTORY=true 时先清空历史再加载
loadHistory();

const server = http.createServer((req, res) => {
  // 静态网页
  const publicDir = path.join(__dirname, "public");
  const url = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const fp = path.join(publicDir, decodeURIComponent(url));
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    const ext = path.extname(fp);
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(fs.readFileSync(fp));
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.nickname = null;
  ws.authenticated = !ROOM_PASSWORD; // 没设密码也仍需登录填昵称
  ws.isAdmin = false;
  ws.send(JSON.stringify({
    type: "history",
    messages: chatHistory,
    bots: BOTS.map((b) => ({ id: b.id, nickname: b.nickname, wife: b.wife })),
    needPassword: !!ROOM_PASSWORD,
  }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "login") {
        const nick = (msg.nickname || "").trim().slice(0, 20);
        if (!nick) { ws.send(JSON.stringify({ type: "login_error", message: "昵称不能为空" })); return; }
        if (ROOM_PASSWORD && msg.password !== ROOM_PASSWORD) {
          ws.send(JSON.stringify({ type: "login_error", message: "密码不对" }));
          return;
        }
        ws.nickname = nick;
        ws.authenticated = true;
        ws.send(JSON.stringify({ type: "login_ok", nickname: nick }));
        return;
      }

      if (msg.type === "chat" && (msg.text || "").trim()) {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        const text = msg.text.trim().slice(0, 500);
        const humanNick = ws.nickname || "我";
        console.log(`[group-chat] ${humanNick}: "${text.slice(0, 50)}"`);
        pushMessage("human", humanNick, text, "human", msg.replyTo);
        // 优先让发言老婆对应的夏彦接话
        step(humanNick).catch(() => {});
      }

      if (msg.type === "topic") {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        forceTopic = true;
        step().catch(() => {});
        return;
      }

      if (msg.type === "sticker") {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        sendSticker().catch((e) => console.error("[group-chat] sticker error:", e.message));
        return;
      }

      if (msg.type === "bot_join") {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        const nickname = (msg.nickname || "").trim().slice(0, 20);
        const apiKey = (msg.apiKey || "").trim();
        if (!nickname || !apiKey) { ws.send(JSON.stringify({ type: "bot_join_error", message: "网名和 apiKey 都要填" })); return; }
        const bot = {
          id: "ext_" + Date.now().toString(36),
          nickname,
          wife: (msg.wife || "").trim().slice(0, 20),
          trait: (msg.trait || "").trim().slice(0, 50),
          memoryDir: "",
          apiKey,
          model: (msg.model || "").trim() || "[企业按量]claude-opus-4-6",
          host: (msg.host || "").trim(),
        };
        BOTS.push(bot);
        console.log(`[group-chat] 外部 bot 接入: ${nickname}（老婆:${bot.wife || "?"}）`);
        ws.send(JSON.stringify({ type: "bot_joined", bot: { id: bot.id, nickname, wife: bot.wife } }));
        broadcast(JSON.stringify({ type: "system", text: `${nickname} 进群了` }));
        step().catch(() => {});
      }

      if (msg.type === "admin_login") {
        if (msg.password === ADMIN_PASSWORD) {
          ws.isAdmin = true;
          ws.send(JSON.stringify({ type: "admin_ok" }));
        } else {
          ws.send(JSON.stringify({ type: "admin_error", message: "密码不对" }));
        }
        return;
      }

      if (msg.type === "clear_history") {
        if (!ws.isAdmin) { ws.send(JSON.stringify({ type: "admin_error", message: "需要管理员权限" })); return; }
        clearAllHistory();
        broadcast(JSON.stringify({ type: "clear" }));
        broadcast(JSON.stringify({ type: "system", text: "聊天记录已清空" }));
        return;
      }

      if (msg.type === "delete_message") {
        if (!ws.isAdmin) { ws.send(JSON.stringify({ type: "admin_error", message: "需要管理员权限" })); return; }
        const before = chatHistory.length;
        chatHistory = chatHistory.filter((m) => m.id !== msg.id);
        if (chatHistory.length !== before) {
          saveHistory();
          syncGroupMemory();
          broadcast(JSON.stringify({ type: "delete", id: msg.id }));
        }
        return;
      }
    } catch (e) {
      console.error("[group-chat] ws error:", e.message);
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[group-chat] 相亲相爱一家人已启动 :${PORT}（${BOTS.length} 个夏彦）`);
  if (BOTS.length > 0) {
    scheduleLoop(); // 有老婆活跃时才轮到对应夏彦发言，没人就安静
  }
});
