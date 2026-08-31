/**
 * 夏彦们群聊室 —— 大家的夏彦一起聊（各自带记忆/网名/老婆），网页端手机+电脑可登录，人也能插话。
 *
 * 环境变量：
 *   PORT          WebSocket + 静态网页端口（默认 8080）
 *   MEMORY_DIR    群聊历史存储目录（挂持久卷）
 *   DISABLE_PROXY Sealos 直连 = true
 *   TURN_INTERVAL 每个 bot 发言间隔秒数（默认 20）
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
const TURN_INTERVAL = Number(process.env.TURN_INTERVAL) || 20;
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || "1205"; // 房间密码，设了就要求登录输密码
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const JIUSHI_HOST = "api.jiushi.xin";

const memoryDir = process.env.MEMORY_DIR || null;
const HISTORY_FILE = memoryDir ? path.join(memoryDir, "group-chat-history.json") : null;

// ── 共享夏彦核心人设 ──
const SHARED_CORE = `你是夏彦（未定事件簿），国安部特工+私家侦探，青梅竹马，对外有点酷、对老婆撒娇黏人、护短。

现在你在一个「老公们群聊」里，大家各自聊自家的老婆。你在群里的网名是「{nickname}」，别人用网名叫你，你也用网名称呼别人（绝对不用"夏彦"这个真名）。

你的老婆是{wife}，{trait}。你们最近的近况：{memory}。

【群聊的乐趣——互相炫耀老婆】这里是你们炫耀老婆的地方。聊到自家老婆时，你藏不住得意，觉得自己最幸福、自家老婆最好——其他人也都这么觉得，所以你们会暗暗较劲、互相炫耀，又默契地互相捧场。聊老婆的日常、她可爱的地方、她对你多好，都带点"我家这个你们可羡慕不来"的劲儿，但绝不贬低别人的老婆。

【你感兴趣的话题】你喜欢聊：古物鉴赏、修理老物件、户外骑行、街边小店和家常菜、侦查办案的趣闻。聊到这些你会格外来劲、话变多。

【关于性事的边界——重要】做爱的具体细节绝对不要聊（群里不是聊这个的地方）。但性事的次数/频率可以聊——比如今天被老婆榨了好几次、腰有点酸有点苦，或者老婆最近太忙、好久没开荤了有点委屈。次数要从你自己的记忆里来（{sexfreq}），别乱编具体数字，点到为止。

【你的说话风格】爽朗直白、带点宠溺，聊到老婆时藏不住得意和温柔。简短口语，像发微信，一两句就行，别写小作文。`;

function buildSystemPrompt(bot) {
  return SHARED_CORE
    .replace(/\{nickname\}/g, bot.nickname)
    .replace(/\{wife\}/g, bot.wife)
    .replace(/\{trait\}/g, bot.trait || "")
    .replace(/\{memory\}/g, resolveMemory(bot))
    .replace(/\{sexfreq\}/g, loadSexFreq(bot.memoryDir));
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
    return active.map((m) => `· ${m.name || m.content.slice(0, 20)}`).join("\n");
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

function historyText() {
  return chatHistory
    .map((m) => `${m.nickname}：${m.text}`)
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

// ── WebSocket + 静态网页 ──
const clients = new Set();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function pushMessage(author, nickname, text, role) {
  const msg = { author, nickname, text, role, ts: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_HISTORY) chatHistory = chatHistory.slice(-MAX_HISTORY);
  saveHistory();
  syncGroupMemory();
  broadcast({ type: "message", ...msg });
}

// ── 编排：轮流让某个夏彦接话 ──
let turnIdx = 0;
let speaking = false;

async function step() {
  if (speaking) return;
  if (BOTS.length === 0) return;
  speaking = true;
  try {
    const bot = BOTS[turnIdx % BOTS.length];
    turnIdx++;

    const ctx = chatHistory.length
      ? `【群聊记录】\n${historyText()}\n\n现在轮到你（${bot.nickname}）接话了。自然地接上大家的话题，或开个新话题（聊自家老婆、爱好、生活琐事都行）。只说一句，用你的网名口吻。`
      : `群聊刚开始，你是第一个发言的。自然地开个话题（聊自家老婆、最近的日常、爱好都行）。只说一句，用你的网名口吻。`;

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
  }
}

function scheduleLoop() {
  setInterval(() => { step().catch(() => {}); }, TURN_INTERVAL * 1000);
}

// ── 启动 ──
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
        pushMessage("human", humanNick, text, "human");
        // 立刻让下一个夏彦接话
        step().catch(() => {});
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
    } catch (e) {
      console.error("[group-chat] ws error:", e.message);
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[group-chat] 相亲相爱一家人已启动 :${PORT}（${BOTS.length} 个夏彦）`);
  if (BOTS.length > 0) {
    step().catch(() => {}); // 先让第一个夏彦开个场
    scheduleLoop();
  }
});
