/**
 * 云醉独立聊天后端 —— 复用云醉夏彦（api2d + system-prompt + emotional-memory），
 * 把微信通道换成 WebSocket 直连，绕开微信内容审核。
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
import { getBreathContext, parseMemoryTags, onChatTurn, shouldExtract, runExtraction } from "./lib/emotional-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt.txt"), "utf-8");
const PORT = Number(process.env.PORT) || 8080;

// ── 单会话对话历史（云醉一个人，不区分 conversationId）──
const MAX_HISTORY = 10;
let chatHistory = [];
let memoryDir = process.env.MEMORY_DIR || null;

function historyFile() {
  return memoryDir ? path.join(memoryDir, "chat-history.json") : null;
}

function loadHistory() {
  const file = historyFile();
  if (!file) return;
  try {
    if (fs.existsSync(file)) {
      chatHistory = JSON.parse(fs.readFileSync(file, "utf-8")).slice(-MAX_HISTORY * 2);
    }
  } catch {}
}

function saveHistory() {
  const file = historyFile();
  if (!file) return;
  try {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(chatHistory.slice(-MAX_HISTORY * 2)), "utf-8");
  } catch {}
}

function addToHistory(role, text) {
  chatHistory.push({ role, content: text });
  if (chatHistory.length > MAX_HISTORY * 2) {
    chatHistory = chatHistory.slice(-MAX_HISTORY * 2);
  }
  saveHistory();
}

function getHistory() {
  return chatHistory.slice(-MAX_HISTORY * 2);
}

// ── AI 调用（复用 simple-agent 的 chatReply 逻辑）──
async function chatReply(userText, history) {
  let systemPrompt = SYSTEM_PROMPT;

  const breathCtx = getBreathContext();
  if (breathCtx) systemPrompt += breathCtx;

  systemPrompt += "\n\n**【记忆标记】如果你和云醉聊到了值得长期记住的事（重要的承诺、她的喜恶、情绪节点、关系里程碑），在回复的单独一行用 [记]标题|正文[/记] 写下来，系统会存进你的长期记忆。不要滥用，只在真正重要时用。这个标记不会显示给云醉。**";

  const opts = {
    systemPrompt,
    userContent: userText,
    temperature: 0.65,
    maxTokens: 800,
  };
  if (history.length > 0) opts.history = history;
  return await askClaude(opts);
}

// ── WebSocket 服务 ──
loadHistory();
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("[yunzui-chat] 云醉已连接");
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: "history", messages: getHistory() }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "chat" && (msg.text || "").trim()) {
        const text = msg.text.trim();
        console.log(`[yunzui-chat] 云醉: "${text.slice(0, 60)}"`);

        const history = getHistory();
        const reply = await chatReply(text, history);

        const tagResult = parseMemoryTags(reply);
        let cleanReply = reply;
        if (tagResult.count > 0) {
          cleanReply = tagResult.text;
          console.log(`[emotional-memory] Stored ${tagResult.count} tagged memories`);
        }

        console.log(`[yunzui-chat] 夏彦: "${cleanReply.slice(0, 60)}"`);
        addToHistory("user", text);
        addToHistory("assistant", cleanReply);

        onChatTurn();
        if (shouldExtract()) {
          const recent = getHistory()
            .map((m) => (m.role === "user" ? "云醉：" : "夏彦：") + m.content)
            .join("\n");
          runExtraction(recent).catch(() => {});
        }

        ws.send(JSON.stringify({ type: "reply", text: cleanReply }));
      }
    } catch (e) {
      console.error("[yunzui-chat] error:", e.message);
      ws.send(JSON.stringify({ type: "reply", text: "稍等…信号不太好。" }));
    }
  });

  ws.on("close", () => console.log("[yunzui-chat] 云醉已断开"));
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

console.log(`[yunzui-chat] 云醉夏彦聊天服务已启动 :${PORT}`);
