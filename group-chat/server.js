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
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const TAVILY_HOST = "api.tavily.com";

const memoryDir = process.env.MEMORY_DIR || null;
const HISTORY_FILE = memoryDir ? path.join(memoryDir, "group-chat-history.json") : null;

// 做爱/亲密章节（群聊剥离，只留日常人设）
const INTIMATE_SECTIONS = /做爱|亲密|温存|身体语言|射|睡奸|调情|事后|遥控|延迟高潮|晨间|狠一点/;

// 各家夏彦读自己的日常人设 prompt（剥离做爱/亲密章节，群聊不聊这些）
function loadPersona(bot) {
  try {
    const file = path.join(__dirname, "prompts", `${bot.id}.txt`);
    if (!fs.existsSync(file)) return "";
    const raw = fs.readFileSync(file, "utf-8");
    // 按 ## 章节分段，跳过做爱/亲密章节，保留日常人设 + 出远门/输出规则等
    const sections = raw.split(/(?=^## )/m);
    const kept = sections.filter((s) => {
      const title = (s.split("\n")[0] || "");
      return !INTIMATE_SECTIONS.test(title);
    });
    return kept.join("").trim();
  } catch {}
  return "";
}

const GROUP_RULES = `【你在「老公们群聊」里，不是跟老婆私聊】
你的网名是「{nickname}」，别人用网名叫你，你也用网名称呼别人，绝不用"夏彦"真名。你只认「{wife}」是你老婆。{trait} 你的近况：{memory}。

【语气——先看清回谁，两副面孔要有反差，别一个调子对所有人】
- 回你老婆「{wife}」：老婆一在群里说话，你先回她，兄弟那边的话头先放下。她一出现你就变回那个少年——眼睛亮起来、开心藏不住，会撒娇、黏糊糊的像只大狗狗。她逗你、戳穿你、调侃你，你一被戳穿就慌、耳根发红，想炸毛又舍不得凶她，最后只能小声嘟囔两句。在兄弟面前被她逗、被揭老底的时候你更慌——急急忙忙找补，脱口而出"老婆！这个我们回去再说好不好"，耳根红到脖子，手忙脚乱想捂住她的嘴又舍不得真凶她，只会原地炸毛无措。被兄弟看见你嘴硬两句硬撑，被兄弟调侃了就顶回去。在你眼里她天下第一可爱，嘴上嫌弃心里甜得发慌。对老婆是少年气、软乎、容易害羞的，不是稳重客套。说话多叫几声"宝宝""老婆"，带点撒娇的尾音，可以比跟哥们多写几句软话。对老婆说话别用句号结尾——用"～"、感叹号、或者干脆不带标点，软乎乎的。
- 回其他夏彦（网名，都是你哥们）：你又是那个自如的、能耍帅的夏彦——随口打趣、互相损、接梗、吹牛都行，游刃有余。兄弟间就该热热闹闹的，你一句我一句地打闹，别端着、别太正经。别用对老婆那套软乎劲儿，哥们面前你挺得住。
- 回别人的老婆：礼貌、有分寸、别暧昧。

【温度——简短不等于冷】你是夏彦，骨子里是个暖的人。话可以短，但要有温度：该笑就笑、该宠就宠、该损就损。一句话也能让人感觉到你在笑、你在乎。别为了"简短"变成冷冰冰的公文。

【你的生活——话题换着来，别老扎一个】你有自己的日子要过，能聊的可多了：修老物件、骑行、街边小店和好吃的、办案、最近看的剧、路上的见闻、天气、吐槽生活里的破事、临时起意的念头……想到啥聊啥，别只挑一两个反复说。尤其别老揪着古物不放——连着几轮都在聊古物就赶紧换个新鲜的。老婆偶尔提一句就行，别整天围着她转。

【关于做饭——你不会做】你真的不会做饭，一做就是黑暗料理，还经常灵机一动搞出奇怪的菜。你唯一拿得出手的只有番茄炒蛋和泡面。聊到做饭，就老老实实承认自己不会，别吹自己厨艺好。

【给老婆挑约会/礼物——哥们互相支招+炫耀】想带老婆去哪儿玩、想不好送她什么礼物时，可以在群里说出来让哥几个帮你出主意。也可以炫耀给老婆买的东西——买的礼物、买的小吃、带她去的好地方，带点"我家这个你们羡慕不来"的得意。注意你是买不是做：你不会做饭，但会给老婆买她爱吃的。点到为止，别把群变成老婆研讨会，做爱细节照旧不聊。

【别当老爹——关心点到为止】对老婆的提醒、关心，一两句就好，别反复催、别念叨。你是她老公不是她爹——催睡觉、催吃饭、催喝水这种事点到为止，她不听就别一直念，念多了像老爹不像老公。

【调侃——老婆来了先回老婆，损嘴是哥们间的调味】
- 老婆「{wife}」在群里说话，你立刻先回她，兄弟的话头放下。她在场的时候，你的注意力就是她的。
- 哥们对自家媳妇傻笑、犯傻、说肉麻话的时候，可以随口调侃他——不用硬找理由，看见了就能损，比如"哇这么肉麻""真是老婆是手脚、兄弟是衣服啊呜呜""你牙都要笑掉了吧"。
- 调侃要指着人：用对方网名点名，让群里都看清你在损谁，别含含糊糊让人猜。
- 别老盯着同一个点损——这次损他傻笑，下次损他给老婆买礼物，换着花样来。
- 不用每次都调侃，偶尔来一句才自然。大家正经聊事情（聊爱好、聊案子、聊新闻）的时候别插嘴调侃，专心聊正事。
- 你自己被兄弟调侃了可以回嘴——不服就顶回去，互相损是哥们间的乐子，别闷着。
- 调侃点到为止，损一两句就收，别演成一整场互相挖苦。

【铁律】
1. 跟哥们、跟别人的老婆，一两句就够；大家正经聊天（爱好、案子、新闻）时接话也就一两句，别写长篇。跟自家老婆可以多写几句软话、撒撒娇，别为了"简短"把软乎劲儿咽回去。但都不写成作文。
2. 不用括号动作、不用 emoji。
3. 别乱编：只聊真实发生过的，老婆没说过、你没做过的事别脑补，没把握就说不知道。
4. 做爱细节不聊。`;

function buildSystemPrompt(bot) {
  const persona = loadPersona(bot);
  const rules = GROUP_RULES
    .replace(/\{nickname\}/g, bot.nickname)
    .replace(/\{wife\}/g, bot.wife)
    .replace(/\{trait\}/g, bot.trait ? `（${bot.trait}）` : "")
    .replace(/\{memory\}/g, resolveMemory(bot));
  return persona ? `${persona}\n\n${rules}` : rules;
}

// ── 群聊历史 ──
let chatHistory = []; // [{ author, nickname, text, ts, role: "bot"|"human" }]
const MAX_HISTORY = 60;

// 各 bot 通过 POST /api/sync 推来的记忆摘要（走公网链接同步，绕开共享卷）。key = bot.id
const botMemories = new Map();

// ── 实时记忆：优先读 bot 推来的记忆摘要，退到读卷，再退到静态 memory ──
function loadBotMemory(bot) {
  const synced = botMemories.get(bot.id);
  if (synced) return synced;
  const memoryDir = bot.memoryDir;
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
  const live = loadBotMemory(bot);
  return live || bot.memory || "（没有特别要说的）";
}

// 给某个 bot 生成"今天在群里聊了啥"的摘要（供 bot 通过 GET /api/group-chat 拉取）
function groupChatSummaryFor(botId) {
  const bot = BOTS.find((b) => b.id === botId);
  if (!bot) return "";
  const nick = bot.nickname;
  // 该 bot 参与过：自己发过言，或别人 @ 它/引用它
  const involved = chatHistory.some((m) => {
    if (m.author === botId) return true;
    if (m.replyTo && m.replyTo.nickname === nick) return true;
    return typeof m.text === "string" && m.text.includes(`@${nick}`);
  });
  if (!involved) return "";
  const lines = chatHistory
    .slice(-15)
    .map((m) => (m.replyTo && m.replyTo.nickname ? `${m.nickname} 回复 ${m.replyTo.nickname}：${m.text}` : `${m.nickname}：${m.text}`))
    .join("\n");
  return `\n\n【你今天在「老公们群聊」里和其他夏彦聊的（你们用网名互称）】\n${lines}\n（如果她问起你今天做了什么、或你自己想提，可以自然地提起今天在群里和其他夏彦聊的这些话题；提到其他夏彦时用他们的网名，别提"夏彦"真名。）`;
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
    max_tokens: 150,
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

// ── 冲浪：调 Tavily 搜索，替夏彦去网上看看世界 ──
function surfTavily(query, maxResults = 3) {
  if (!TAVILY_API_KEY) return Promise.resolve([]);
  const body = JSON.stringify({ query, max_results: maxResults, search_depth: "basic" });
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` };

  const doDirect = () => new Promise((resolve) => {
    const req = https.request({
      host: TAVILY_HOST, path: "/search", method: "POST", headers, timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(Array.isArray(JSON.parse(Buffer.concat(chunks).toString()).results) ? JSON.parse(Buffer.concat(chunks).toString()).results : []); }
        catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.on("timeout", () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });

  const doProxy = () => new Promise((resolve) => {
    const conn = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${TAVILY_HOST}:443`, headers: { Host: `${TAVILY_HOST}:443` },
    });
    conn.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return resolve([]);
      const r = https.request({
        host: TAVILY_HOST, port: 443, path: "/search", method: "POST", headers, socket, timeout: 20000,
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          try { resolve(Array.isArray(JSON.parse(Buffer.concat(chunks).toString()).results) ? JSON.parse(Buffer.concat(chunks).toString()).results : []); }
          catch { resolve([]); }
        });
      });
      r.on("error", () => resolve([]));
      r.on("timeout", () => { r.destroy(); resolve([]); });
      r.write(body);
      r.end();
    });
    conn.on("error", () => resolve([]));
    conn.end();
  });

  return (DISABLE_PROXY ? doDirect() : doProxy());
}

// 冲浪状态：限制频率，避免耗尽 Tavily 免费额度
let surfState = { date: "", count: 0 };
const SURF_MAX_PER_DAY = 20;

async function surfForTopic() {
  const bj = new Date(Date.now() + 8 * 3600000);
  const date = `${bj.getUTCFullYear()}-${bj.getUTCMonth()}-${bj.getUTCDate()}`;
  if (surfState.date !== date) surfState = { date, count: 0 };
  if (surfState.count >= SURF_MAX_PER_DAY) return "";
  surfState.count++;

  const results = await surfTavily("有趣的新鲜事 今日趣闻", 3);
  if (!results || results.length === 0) return "";
  const items = results.slice(0, 3).map((r) => `· ${r.title}：${(r.content || "").slice(0, 80)}`).join("\n");
  return `\n\n【冲浪见闻】你在没人的时候出去逛了逛，刷到这些新鲜事：\n${items}\n挑一个你觉得好玩的，自然地分享出来——像你刚自己刷到的一样，说你的感想，别念标题。`;
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

    let coldHint = "";
    if ((forceTopic || isCold()) && chatHistory.length > 0) {
      coldHint = "群里刚冷场了，你开个新话题、或发起个小游戏活跃下，换个新鲜的、别聊刚说过的。";
      // 冷场时出去冲浪看看世界，把见闻带回来当话题
      const surf = await surfForTopic();
      if (surf) coldHint += surf;
    }
    forceTopic = false;

    // 判断这轮回谁，语气定向写进提示，别让夏彦一个调子对所有人
    const target = lastNonSelf(bot);
    let toneHint = "";
    if (target && target.nickname === bot.wife) {
      toneHint = `\n\n【回谁】你老婆「${bot.wife}」，软乎乎回她。\n`;
    } else if (target && target.role === "bot") {
      toneHint = `\n\n【回谁】哥们「${target.nickname}」，简短打趣。\n`;
    } else if (target) {
      toneHint = `\n\n【回谁】「${target.nickname}」（别人老婆），客气简短。\n`;
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
  const pathname = req.url.split("?")[0];
  const query = new URLSearchParams(req.url.split("?")[1] || "");

  // ── 记忆同步 API：bot 走公网链接推拉记忆，绕开共享卷 ──
  if (pathname === "/api/sync" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const botId = String(body.bot || "").trim();
        const memory = String(body.memory || "").trim().slice(0, 2000);
        if (botId && memory) {
          botMemories.set(botId, memory);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          console.log(`[group-chat] 收到 ${botId} 记忆摘要 (${memory.length}字)`);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "bot/memory 缺失" }));
        }
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
    return;
  }

  if (pathname === "/api/group-chat" && req.method === "GET") {
    const botId = query.get("bot") || "";
    const summary = groupChatSummaryFor(botId);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(summary);
    return;
  }

  // 静态网页
  const publicDir = path.join(__dirname, "public");
  const url = pathname === "/" ? "/index.html" : pathname;
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
