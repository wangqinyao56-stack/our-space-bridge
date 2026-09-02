/**
 * 苹果梗独立聊天后端 —— 复用苹果梗夏彦（api2d + 双 prompt + emotional-memory），
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
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { askClaude } from "./lib/api2d.js";
import { getBreathContext, getGroupChatContext, parseMemoryTags, onChatTurn, shouldExtract, runExtraction, pushMemoryToGroupChat } from "./lib/emotional-memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAILY_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-daily.txt"), "utf-8");
const INTIMATE_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt-intimate.txt"), "utf-8");
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

  systemPrompt += "\n\n**【记忆标记】如果你和月儿聊到了值得长期记住的事（重要的承诺、她的喜恶、情绪节点、关系里程碑），在回复的单独一行用 [记]标题|正文[/记] 写下来，系统会存进你的长期记忆。不要滥用，只在真正重要时用。这个标记不会显示给月儿。**";

  const opts = {
    systemPrompt,
    userContent: userText,
    temperature: 0.65,
    maxTokens: 800,
  };
  if (channel === "intimate") opts.model = "[逆]claude-opus-4-6"; // 亲密空间换便宜模型，日常仍用默认
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
  console.log("[pingguogeng-chat] 苹果梗已连接");
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  // 连上就推两套历史（日常 + 亲密）
  ws.send(JSON.stringify({ type: "history", channel: "daily", messages: getHistory("daily") }));
  ws.send(JSON.stringify({ type: "history", channel: "intimate", messages: getHistory("intimate") }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "chat" && (msg.text || "").trim()) {
        const channel = msg.channel === "intimate" ? "intimate" : "daily";
        const text = msg.text.trim();
        console.log(`[pingguogeng-chat] ${channel === "intimate" ? "亲密" : "日常"} 苹果梗: "${text.slice(0, 60)}"`);

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

        console.log(`[pingguogeng-chat] 夏彦: "${cleanReply.slice(0, 60)}"`);
        addToHistory(channel, "user", text);
        addToHistory(channel, "assistant", cleanReply);

        onChatTurn();
        // 把最新记忆摘要推给群聊服务（非阻塞，走公网链接）
        pushMemoryToGroupChat().catch(() => {});
        if (shouldExtract()) {
          const recent = getHistory(channel)
            .map((m) => (m.role === "user" ? "月儿：" : "夏彦：") + m.content)
            .join("\n");
          runExtraction(recent).catch(() => {});
        }

        ws.send(JSON.stringify({ type: "reply", channel, text: cleanReply }));
      }
    } catch (e) {
      console.error("[pingguogeng-chat] error:", e.message);
      ws.send(JSON.stringify({ type: "reply", channel: "daily", text: "稍等…信号不太好。" }));
    }
  });

  ws.on("close", () => console.log("[pingguogeng-chat] 苹果梗已断开"));
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

console.log(`[pingguogeng-chat] 苹果梗夏彦聊天服务已启动 :${PORT}`);
