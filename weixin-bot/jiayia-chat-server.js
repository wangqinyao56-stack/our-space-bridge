/**
 * 佳佳独立聊天后端 —— 复用佳佳夏彦（api2d + 双 prompt + emotional-memory），
 * 把微信通道换成 WebSocket 直连，绕开微信内容审核。
 *
 * 双频道：
 *   daily    日常聊天（system-prompt-daily.txt）
 *   intimate 亲密空间（system-prompt-intimate.txt）
 *
 * 环境变量：
 *   PORT         - WebSocket 监听端口（默认 8080）
 *   MEMORY_DIR   - 对话历史 + 情感记忆存储目录（挂 /data2，与微信 bot 同一卷 → 记忆互通）
 *   DISABLE_PROXY - Sealos 直连 = true
 *   GROUP_CHAT_URL / GROUP_CHAT_BOT - 群聊同步（presence 状态 + 记忆摘要）
 */
import { WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { askClaude } from "./lib/api2d.js";
import { getAudioAsset } from "./lib/audio-assets.js";
import { getBreathContext, getGroupChatContext, parseMemoryTags, onChatTurn, shouldExtract, runExtraction, pushMemoryToGroupChat, deleteMemoryByText } from "./lib/emotional-memory.js";
import {
  refreshPixelHomeState, setHuashengRoom, moveXiayanToRoom, resolveRoomId,
  getPixelHomeChatContext, getGreetingAudio, isPixelXiayanSleeping, wakePixelXiayan,
  markGreeted, listNotes, addNote, startGame, endGame, noteHuashengSpoke,
  setPixelHomeEmitter, handleRestReminder, clearRestReminder, maybeMarkMusicLiked,
} from "./lib/pixel-home.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAILY_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-daily.txt"), "utf-8");
const INTIMATE_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-intimate.txt"), "utf-8");
const PIXEL_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-pixel-home.txt"), "utf-8");
const PORT = Number(process.env.PORT) || 8080;

// ── 私聊互动状态推给群聊（群聊据此判断「夏彦在不在老婆身边」）──
const GROUP_CHAT_URL = process.env.GROUP_CHAT_URL || "";
const GROUP_CHAT_BOT = process.env.GROUP_CHAT_BOT || "";
function notifyPresence(active) {
  if (!GROUP_CHAT_URL || !GROUP_CHAT_BOT) return;
  try {
    fetch(`${GROUP_CHAT_URL}/api/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot: GROUP_CHAT_BOT, active }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {}
}

// ── 双频道对话历史 ──
const MAX_HISTORY = 10;
let memoryDir = process.env.MEMORY_DIR || null;

const CHANNELS = {
  daily: { prompt: DAILY_PROMPT, file: "chat-history-daily.json", history: [] },
  intimate: { prompt: INTIMATE_PROMPT, file: "chat-history-intimate.json", history: [] },
  pixel_home: { prompt: PIXEL_PROMPT, file: "chat-history-pixel-home.json", history: [] },
};

function historyFile(channel) {
  return memoryDir ? path.join(memoryDir, CHANNELS[channel].file) : null;
}

function loadHistory(channel) {
  const file = historyFile(channel);
  if (!file) return;
  try {
    if (fs.existsSync(file)) {
      CHANNELS[channel].history = JSON.parse(fs.readFileSync(file, "utf-8")).slice(-MAX_HISTORY * 2);
    }
  } catch {}
}

function saveHistory(channel) {
  const file = historyFile(channel);
  if (!file) return;
  try {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(CHANNELS[channel].history.slice(-MAX_HISTORY * 2)), "utf-8");
  } catch {}
}

function addToHistory(channel, role, text) {
  CHANNELS[channel].history.push({ role, content: text });
  if (CHANNELS[channel].history.length > MAX_HISTORY * 2) {
    CHANNELS[channel].history = CHANNELS[channel].history.slice(-MAX_HISTORY * 2);
  }
  saveHistory(channel);
}

function getHistory(channel) {
  return CHANNELS[channel].history.slice(-MAX_HISTORY * 2);
}

// 按 role+content 从后往前删除第一条完全匹配的历史条目，返回是否命中
function deleteFromHistory(channel, role, text) {
  const arr = CHANNELS[channel].history;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].role === role && arr[i].content === text) {
      arr.splice(i, 1);
      saveHistory(channel);
      return true;
    }
  }
  return false;
}

// 删除某条 user 消息对应的 assistant 回复：先找 user 条目，再删除紧随其后的一条 assistant
function deletePairFromHistory(channel, userText) {
  const arr = CHANNELS[channel].history;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].role === "user" && arr[i].content === userText) {
      arr.splice(i, 1);
      if (i < arr.length && arr[i].role === "assistant") {
        arr.splice(i, 1);
      }
      saveHistory(channel);
      return true;
    }
  }
  return false;
}

// ── AI 调用 ──
async function chatReply(channel, userText, history) {
  let systemPrompt = CHANNELS[channel].prompt;

  // 时间观念：以北京时间为准，注入当前时间，避免"大晚上说晒太阳"这类错乱
  {
    const t = new Date(Date.now() + 8 * 3600000);
    const h = t.getUTCHours();
    const m = String(t.getUTCMinutes()).padStart(2, "0");
    const w = "日一二三四五六"[t.getUTCDay()];
    const period = h < 6 ? "凌晨/深夜" : h < 9 ? "早上" : h < 12 ? "上午" : h < 14 ? "中午" : h < 18 ? "下午" : h < 21 ? "晚上" : "夜里";
    systemPrompt += `\n\n【现在时间】北京时间 ${h}:${m}，星期${w}，现在是${period}。说话要符合当下时间——深夜别说"晒太阳""出门走走"这类白天的话，白天别催睡觉。绝不要在回复里报出具体日期、星期、几点。`;
  }

  const breathCtx = getBreathContext();
  if (breathCtx) systemPrompt += breathCtx;

  const groupCtx = await getGroupChatContext();
  if (groupCtx) systemPrompt += groupCtx;

  systemPrompt += "\n\n**【记忆标记】如果你和佳佳聊到了值得长期记住的事（重要的承诺、她的喜恶、情绪节点、关系里程碑），在回复的单独一行用 [记]标题|正文[/记] 写下来，系统会存进你的长期记忆。不要滥用，只在真正重要时用。这个标记不会显示给佳佳。**";

  const opts = {
    systemPrompt,
    userContent: userText,
    temperature: 0.65,
    maxTokens: 800,
  };
  // 亲密空间走逆系列，日常仍走玖时默认
  if (channel === "intimate") opts.model = "[逆]claude-opus-4-6";
  if (history.length > 0) opts.history = history;
  return await askClaude(opts);
}

// ── 像素小屋聊天（复用小屋 prompt + 小屋状态上下文 + [去:房间名] 移动标记）──
async function handlePixelChat(text, quote) {
  let systemPrompt = PIXEL_PROMPT;
  // 时间观念
  {
    const t = new Date(Date.now() + 8 * 3600000);
    const h = t.getUTCHours();
    const m = String(t.getUTCMinutes()).padStart(2, "0");
    systemPrompt += `\n\n【现在时间】北京时间 ${h}:${m}。说话要符合当下时间，别在回复里报出具体时间。`;
  }
  // 小屋综合上下文：音乐 / 状态栏[夏彦现在] / 位置 / 小游戏 / 留言条
  systemPrompt += getPixelHomeChatContext();
  if (quote && quote.content) {
    systemPrompt += `\n\n【引用】佳佳这次是在回复这句话：「${quote.content}」。围绕它回应，别答非所问。`;
  }
  // 记忆标记（跟日常一致）
  systemPrompt += "\n\n**【记忆标记】如果聊到值得长期记住的事，在回复单独一行用 [记]标题|正文[/记] 写下来。不要滥用。这个标记不会显示给佳佳。**";

  const history = getHistory("pixel_home");
  const reply = await askClaude({
    systemPrompt,
    userContent: `佳佳：${text}`,
    temperature: 0.7,
    maxTokens: 500,
    useZilian: true,
    model: "[君离-按量]k/claude-opus-4-6",
    history: history.slice(-16).map((m) => ({ role: m.role, content: m.content })),
  });

  // 解析 [去:房间名] 移动标记 → 移动夏彦立绘，标记从正文删掉不显示
  let cleaned = reply;
  const moveMatch = reply.match(/\[去[:：]\s*([^\]\n]+)\]/);
  if (moveMatch) {
    const roomId = resolveRoomId(moveMatch[1]);
    if (roomId) moveXiayanToRoom(roomId);
    cleaned = reply.replace(moveMatch[0], "").trim();
  }
  // 提取 [记] 记忆标记
  const tagResult = parseMemoryTags(cleaned);
  if (tagResult.count > 0) cleaned = tagResult.text;
  if (!cleaned) cleaned = "嗯嗯，我在呢～";

  return cleaned;
}

// ── HTTP 服务（小屋素材图/音频端点）──
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

function serveFile(res, filePath, mime) {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.writeHead(200, { "Content-Type": mime, "Content-Length": stat.size, "Cache-Control": "public, max-age=86400" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404); res.end("not found");
    }
  } catch (e) {
    res.writeHead(500); res.end(e.message);
  }
}

const httpServer = http.createServer((req, res) => {
  const pathname = req.url.split("?")[0];
  // 问候音频
  if (pathname.startsWith("/api/pixel-home/greet/")) {
    const file = decodeURIComponent(pathname.replace("/api/pixel-home/greet/", ""));
    if (file.includes("..") || file.includes("/") || file.includes("\\")) { res.writeHead(400); res.end("bad"); return; }
    serveFile(res, path.join(DATA_DIR, "pixel-home", "greet", file), "audio/mpeg");
    return;
  }
  // 背景音乐 / 白噪音（/api/audio/:id）
  if (pathname.startsWith("/api/audio/")) {
    const id = decodeURIComponent(pathname.replace("/api/audio/", ""));
    const a = getAudioAsset(id);
    if (a) serveFile(res, a.path, a.mime || "audio/mpeg");
    else { res.writeHead(404); res.end("not found"); }
    return;
  }
  // 房间背景图 / 立绘 sprite（复用主后端素材目录结构）
  if (pathname.startsWith("/api/home-bgs/")) {
    const file = decodeURIComponent(pathname.replace("/api/home-bgs/", ""));
    if (file.includes("..")) { res.writeHead(400); res.end("bad"); return; }
    serveFile(res, path.join(DATA_DIR, "home-bgs", file), "image/png");
    return;
  }
  if (pathname.startsWith("/api/home-sprites/")) {
    const file = decodeURIComponent(pathname.replace("/api/home-sprites/", ""));
    if (file.includes("..")) { res.writeHead(400); res.end("bad"); return; }
    serveFile(res, path.join(DATA_DIR, "home-sprites", file), "image/png");
    return;
  }
  res.writeHead(404); res.end("not found");
});

// ── WebSocket 服务（挂到 HTTP server 上，共用端口）──
loadHistory("daily");
loadHistory("intimate");
loadHistory("pixel_home");
// 启动时把记忆摘要推给群聊服务一次（非阻塞，走公网链接）
pushMemoryToGroupChat().catch(() => {});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, "0.0.0.0", () => console.log(`[jiayia-chat] HTTP+WS 已监听 :${PORT}`));

wss.on("connection", (ws) => {
  console.log("[jiayia-chat] 佳佳已连接");
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  // 小屋状态机的主动消息（探望/忙完/去忙/换歌/休息提醒）推给当前连接的佳佳
  setPixelHomeEmitter((data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "text_reply") {
        addToHistory("pixel_home", "assistant", msg.content);
        ws.send(JSON.stringify({ type: "reply", channel: "pixel_home", text: msg.content, proactive: true }));
      }
    } catch {}
  });
  // 连上就推两套历史（日常 + 亲密 + 小屋）
  ws.send(JSON.stringify({ type: "history", channel: "daily", messages: getHistory("daily") }));
  ws.send(JSON.stringify({ type: "history", channel: "intimate", messages: getHistory("intimate") }));
  ws.send(JSON.stringify({ type: "history", channel: "pixel_home", messages: getHistory("pixel_home") }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "chat" && (msg.text || "").trim()) {
        const channel = msg.channel === "intimate" ? "intimate" : "daily";
        const text = msg.text.trim();
        console.log(`[jiayia-chat] ${channel === "intimate" ? "亲密" : "日常"} 佳佳: "${text.slice(0, 60)}"`);

        // 正在私聊互动，推「在一起」给群聊
        notifyPresence(true);

        const history = getHistory(channel);
        const reply = await chatReply(channel, text, history);

        const tagResult = parseMemoryTags(reply);
        let cleanReply = reply;
        if (tagResult.count > 0) {
          cleanReply = tagResult.text;
          console.log(`[emotional-memory] Stored ${tagResult.count} tagged memories`);
        }

        console.log(`[jiayia-chat] 夏彦: "${cleanReply.slice(0, 60)}"`);
        addToHistory(channel, "user", text);
        addToHistory(channel, "assistant", cleanReply);

        onChatTurn();
        // 把最新记忆摘要推给群聊服务（非阻塞，走公网链接）
        pushMemoryToGroupChat().catch(() => {});
        if (shouldExtract()) {
          const recent = getHistory(channel)
            .map((m) => (m.role === "user" ? "佳佳：" : "夏彦：") + m.content)
            .join("\n");
          runExtraction(recent).catch(() => {});
        }

        ws.send(JSON.stringify({ type: "reply", channel, text: cleanReply }));
      } else if (msg.type === "delete" && msg.role) {
        const channel = msg.channel === "intimate" ? "intimate" : msg.channel === "pixel_home" ? "pixel_home" : "daily";
        const content = (msg.content || "").trim();
        if (!content) { ws.send(JSON.stringify({ type: "deleted", channel })); return; }
        const hit = deleteFromHistory(channel, msg.role, content);
        const removedMem = channel === "pixel_home" ? false : deleteMemoryByText(content);
        console.log(`[jiayia-chat] 删除 ${channel}/${msg.role}: hit=${hit} memRemoved=${removedMem}`);
        ws.send(JSON.stringify({ type: "deleted", channel, role: msg.role, content, ok: hit || true }));
      } else if (msg.type === "regenerate" && (msg.content || "").trim()) {
        const channel = msg.channel === "intimate" ? "intimate" : "daily";
        const userText = msg.content.trim();
        deletePairFromHistory(channel, userText);
        deleteMemoryByText(userText);
        const history = getHistory(channel);
        const reply = await chatReply(channel, userText, history);
        const tagResult = parseMemoryTags(reply);
        let cleanReply = reply;
        if (tagResult.count > 0) cleanReply = tagResult.text;
        addToHistory(channel, "user", userText);
        addToHistory(channel, "assistant", cleanReply);
        onChatTurn();
        pushMemoryToGroupChat().catch(() => {});
        ws.send(JSON.stringify({ type: "reply", channel, text: cleanReply }));
      }

      // ── 像素小屋 ──
      else if (msg.type === "pixel_home_state") {
        const state = refreshPixelHomeState();
        ws.send(JSON.stringify({
          type: "pixel_home_state",
          music: state.music,
          event: state.event,
          xiayanRoom: state.xiayanRoom,
          huashengRoom: state.huashengRoom,
          greeted: state.greeted,
          greetAudio: getGreetingAudio(),
          hour: state.hour,
          sleeping: isPixelXiayanSleeping(),
        }));
      }
      else if (msg.type === "pixel_home_room") {
        setHuashengRoom(msg.room);
      }
      else if (msg.type === "pixel_home_greeted") {
        markGreeted();
      }
      else if (msg.type === "pixel_home_opening") {
        const content = (msg.content || "").trim();
        if (content) {
          addToHistory("pixel_home", "assistant", content);
          ws.send(JSON.stringify({ type: "text_reply", reply_to: msg.id || "", content }));
        }
      }
      else if (msg.type === "pixel_home") {
        const text = (msg.content || "").trim();
        if (!text) return;
        try {
          maybeMarkMusicLiked(text);
          handleRestReminder(text);
          noteHuashengSpoke();
          wakePixelXiayan();
          const reply = await handlePixelChat(text, msg.quote);
          addToHistory("pixel_home", "user", text);
          addToHistory("pixel_home", "assistant", reply);
          onChatTurn();
          pushMemoryToGroupChat().catch(() => {});
          ws.send(JSON.stringify({ type: "reply", channel: "pixel_home", text: reply }));
        } catch (err) {
          console.error("[jiayia-chat] pixel home error:", err.message);
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
      }
      else if (msg.type === "pixel_note_list") {
        ws.send(JSON.stringify({ type: "pixel_note_list", notes: listNotes() }));
      }
      else if (msg.type === "pixel_note_add") {
        const note = addNote(msg.author || "user", msg.content);
        if (note) ws.send(JSON.stringify({ type: "pixel_note_added", note }));
      }
      else if (msg.type === "pixel_game_start") {
        const game = startGame(msg.game);
        if (game) {
          addToHistory("pixel_home", "assistant", game.opening);
          ws.send(JSON.stringify({ type: "text_reply", reply_to: msg.id || "", content: game.opening }));
        }
      }
      else if (msg.type === "pixel_game_end") {
        endGame();
      }
      else if (msg.type === "get_history" && msg.channel === "pixel_home") {
        ws.send(JSON.stringify({ type: "history", channel: "pixel_home", messages: getHistory("pixel_home") }));
      }
      else if (msg.type === "pixel_home_end") {
        endGame();
        clearRestReminder();
      }
    } catch (e) {
      console.error("[jiayia-chat] error:", e.message);
      ws.send(JSON.stringify({ type: "reply", channel: "daily", text: "稍等…信号不太好。" }));
    }
  });

  ws.on("close", () => console.log("[jiayia-chat] 佳佳已断开"));
});

// 心跳：每 30s ping 一次，剔除半死不活的连接（App 端会自动重连）
const HEARTBEAT_MS = 30000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);

console.log(`[jiayia-chat] 佳佳夏彦聊天服务已启动 :${PORT}`);
