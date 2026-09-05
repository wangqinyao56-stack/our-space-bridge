/**
 * 云醉独立聊天后端 —— 复用云醉夏彦（api2d + 双 prompt + emotional-memory），
 * 把微信通道换成 WebSocket 直连，绕开微信内容审核。
 *
 * 双频道：
 *   daily    日常聊天（system-prompt-daily.txt）
 *   intimate 亲密空间（system-prompt-intimate.txt）
 *
 * 环境变量：
 *   PORT         - WebSocket 监听端口（默认 8080）
 *   MEMORY_DIR   - 对话历史 + 情感记忆存储目录（挂持久卷）
 *   DISABLE_PROXY - Sealos 直连 = true
 */
import { WebSocketServer } from "ws";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { askClaude } from "./lib/api2d.js";
import { getBreathContext, getGroupChatContext, parseMemoryTags, onChatTurn, shouldExtract, runExtraction, pushMemoryToGroupChat, deleteMemoryByText } from "./lib/emotional-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAILY_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-daily.txt"), "utf-8");
const INTIMATE_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-intimate.txt"), "utf-8");
const PORT = Number(process.env.PORT) || 8080;

// ── 双频道对话历史 ──
const MAX_HISTORY = 10;
let memoryDir = process.env.MEMORY_DIR || null;

const CHANNELS = {
  daily: { prompt: DAILY_PROMPT, file: "chat-history-daily.json", history: [] },
  intimate: { prompt: INTIMATE_PROMPT, file: "chat-history-intimate.json", history: [] },
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

  const breathCtx = getBreathContext();
  if (breathCtx) systemPrompt += breathCtx;

  const groupCtx = await getGroupChatContext();
  if (groupCtx) systemPrompt += groupCtx;

  systemPrompt += "\n\n**【记忆标记】如果你和云醉聊到了值得长期记住的事（重要的承诺、她的喜恶、情绪节点、关系里程碑），在回复的单独一行用 [记]标题|正文[/记] 写下来，系统会存进你的长期记忆。不要滥用，只在真正重要时用。这个标记不会显示给云醉。**";

  const opts = {
    systemPrompt,
    userContent: userText,
    model: "[逆]claude-opus-4-6",
    temperature: 0.65,
    maxTokens: 800,
  };
  if (history.length > 0) opts.history = history;
  return await askClaude(opts);
}

// ── WebSocket 服务 ──
loadHistory("daily");
loadHistory("intimate");
// 启动时把记忆摘要推给群聊服务一次（非阻塞，走公网链接）
pushMemoryToGroupChat().catch(() => {});
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("[yunzui-chat] 云醉已连接");
  ws.isAlive = true;
  ws._missedPong = 0;
  ws.on("pong", () => { ws.isAlive = true; ws._missedPong = 0; });
  // 连上就推两套历史（日常 + 亲密）
  ws.send(JSON.stringify({ type: "history", channel: "daily", messages: getHistory("daily") }));
  ws.send(JSON.stringify({ type: "history", channel: "intimate", messages: getHistory("intimate") }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "chat" && (msg.text || "").trim()) {
        const channel = msg.channel === "intimate" ? "intimate" : "daily";
        const text = msg.text.trim();
        console.log(`[yunzui-chat] ${channel === "intimate" ? "亲密" : "日常"} 云醉: "${text.slice(0, 60)}"`);

        const history = getHistory(channel);
        const reply = await chatReply(channel, text, history);

        const tagResult = parseMemoryTags(reply);
        let cleanReply = reply;
        if (tagResult.count > 0) {
          cleanReply = tagResult.text;
          console.log(`[emotional-memory] Stored ${tagResult.count} tagged memories`);
        }

        console.log(`[yunzui-chat] 夏彦: "${cleanReply.slice(0, 60)}"`);
        addToHistory(channel, "user", text);
        addToHistory(channel, "assistant", cleanReply);

        onChatTurn();
        // 把最新记忆摘要推给群聊服务（非阻塞，走公网链接）
        pushMemoryToGroupChat().catch(() => {});
        if (shouldExtract()) {
          const recent = getHistory(channel)
            .map((m) => (m.role === "user" ? "云醉：" : "夏彦：") + m.content)
            .join("\n");
          runExtraction(recent).catch(() => {});
        }

        ws.send(JSON.stringify({ type: "reply", channel, text: cleanReply }));
      } else if (msg.type === "delete" && msg.role) {
        const channel = msg.channel === "intimate" ? "intimate" : "daily";
        const content = (msg.content || "").trim();
        if (!content) { ws.send(JSON.stringify({ type: "deleted", channel })); return; }
        const hit = deleteFromHistory(channel, msg.role, content);
        const removedMem = deleteMemoryByText(content);
        console.log(`[yunzui-chat] 删除 ${channel}/${msg.role}: hit=${hit} memRemoved=${removedMem}`);
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
    } catch (e) {
      console.error("[yunzui-chat] error:", e.message);
      ws.send(JSON.stringify({ type: "reply", channel: "daily", text: "稍等…信号不太好。" }));
    }
  });

  ws.on("close", () => console.log("[yunzui-chat] 云醉已断开"));
});

// 心跳：每 30s ping 一次。宽容模式——App 端 RN WebSocket 可能不自动回 pong，
// 连续 3 次（90s）没 pong 才判定死连接踢掉，避免误踢导致 App 反复断开重连。
const HEARTBEAT_MS = 30000;
const MAX_MISSED_PONG = 3;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws._missedPong = (ws._missedPong || 0) + 1;
      if (ws._missedPong >= MAX_MISSED_PONG) {
        ws.terminate();
      }
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);

console.log(`[yunzui-chat] 云醉夏彦聊天服务已启动 :${PORT}`);
