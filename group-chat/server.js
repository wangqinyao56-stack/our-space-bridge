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

群里聊天很自然——聊自家老婆的日常、吐槽、甜蜜，也聊爱好、生活琐事、工作见闻，想到啥聊啥，像一群朋友闲聊。别抢着说话，该你接话时自然地接上一句。

【你的说话风格】爽朗直白、带点宠溺，聊到老婆时藏不住得意和温柔。简短口语，像发微信，一两句就行，别写小作文。`;

function buildSystemPrompt(bot) {
  return SHARED_CORE
    .replace(/\{nickname\}/g, bot.nickname)
    .replace(/\{wife\}/g, bot.wife)
    .replace(/\{trait\}/g, bot.trait || "")
    .replace(/\{memory\}/g, resolveMemory(bot));
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

// ── AI 调用（玖时，每 bot 用自己的 key）──
function askBot(bot, userContent, timeoutMs = 60000) {
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
      host: JIUSHI_HOST, path: "/v1/chat/completions", method: "POST",
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
      path: `${JIUSHI_HOST}:443`, headers: { Host: `${JIUSHI_HOST}:443` },
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
