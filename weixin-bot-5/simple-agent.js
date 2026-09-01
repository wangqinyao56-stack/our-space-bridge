/**
 * 极简微信Bot — 纯文字对话
 * 支持本地开发 + Docker/Sealos 部署
 *
 * 环境变量:
 *   ACCOUNT_TOKEN    - 微信账号token（Docker模式）
 *   ACCOUNT_BASE_URL - 微信API地址（默认 https://ilinkai.weixin.qq.com）
 *   ACCOUNT_USER_ID  - 微信userId
 *   MEMORY_DIR       - 对话记忆存储目录（可选，默认不存盘）
 */

import { start } from "weixin-agent-sdk";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { askClaude } from "./lib/api2d.js";
import { getBreathContext, parseMemoryTags, onChatTurn, shouldExtract, runExtraction, shouldDream, runDream, getGroupChatContext, pushMemoryToGroupChat } from "./lib/emotional-memory.js";

// ── 账号加载 ──
// Docker/Sealos: 读环境变量
// 本地开发: 读 ~/.openclaw 下的账号文件

function loadAccount() {
  if (process.env.ACCOUNT_TOKEN) {
    // Docker 模式 — 从环境变量写账号文件（SDK 需要读文件）
    const stateDir = path.join(os.homedir(), ".openclaw", "openclaw-weixin");
    const accountsDir = path.join(stateDir, "accounts");
    fs.mkdirSync(accountsDir, { recursive: true });

    const accountId = process.env.ACCOUNT_TOKEN.split(":")[0];
    if (!accountId) throw new Error("Invalid ACCOUNT_TOKEN format");

    // Write account index
    fs.writeFileSync(path.join(stateDir, "accounts.json"), JSON.stringify([accountId], null, 2));

    // Write account data file
    fs.writeFileSync(path.join(accountsDir, `${accountId}.json`), JSON.stringify({
      token: process.env.ACCOUNT_TOKEN,
      baseUrl: process.env.ACCOUNT_BASE_URL || "https://ilinkai.weixin.qq.com",
      userId: process.env.ACCOUNT_USER_ID || "",
      savedAt: new Date().toISOString(),
    }, null, 2));

    return {
      token: process.env.ACCOUNT_TOKEN,
      baseUrl: process.env.ACCOUNT_BASE_URL || "https://ilinkai.weixin.qq.com",
      userId: process.env.ACCOUNT_USER_ID || "",
    };
  }

  // 本地模式 — 读账号文件
  const dir = path.join(os.homedir(), ".openclaw", "openclaw-weixin", "accounts");
  if (!fs.existsSync(dir)) throw new Error("No account found. Run: npx weixin-acp login");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.endsWith(".sync.json"));
  if (files.length === 0) throw new Error("No account found. Run: npx weixin-acp login");
  const file = path.join(dir, files[0]);
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  return {
    token: data.token,
    baseUrl: data.baseUrl || "https://ilinkai.weixin.qq.com",
    userId: data.userId || "",
  };
}

// ── 记忆系统（独立于华生的微信bot） ──
const MAX_HISTORY = 10;
const chatHistory = {}; // { conversationId: [{role, content}] }
let memoryDir = null;

function initMemory() {
  if (process.env.MEMORY_DIR) {
    memoryDir = process.env.MEMORY_DIR;
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    console.log(`[memory] 存储目录: ${memoryDir}`);
  } else {
    console.log("[memory] 未设MEMORY_DIR，记忆不存盘");
  }
}

function loadMemory(convId) {
  if (!memoryDir) return [];
  const file = path.join(memoryDir, `${sanitizeId(convId)}.json`);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8")).slice(-MAX_HISTORY * 2);
    }
  } catch {}
  return [];
}

function saveMemory(convId, history) {
  if (!memoryDir) return;
  const file = path.join(memoryDir, `${sanitizeId(convId)}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(history.slice(-MAX_HISTORY * 2)), "utf-8");
  } catch {}
}

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function addToHistory(convId, role, text) {
  if (!chatHistory[convId]) {
    chatHistory[convId] = loadMemory(convId);
  }
  chatHistory[convId].push({ role, content: text });
  if (chatHistory[convId].length > MAX_HISTORY * 2) {
    chatHistory[convId] = chatHistory[convId].slice(-MAX_HISTORY * 2);
  }
  saveMemory(convId, chatHistory[convId]);
}

function getHistory(convId) {
  return chatHistory[convId] || [];
}

// ── 角色Prompt（从文件读取） ──
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt.txt"), "utf-8");
// ── 图片真实格式探测（微信SDK给的mime可能是 image/* 通配符，按文件头判断） ──
function detectImageMime(buf) {
  if (!buf || buf.length < 4) return "image/jpeg";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  return "image/jpeg";
}

// ── AI调用 ──
async function chatReply(userText, history, imageBase64 = null, imageMime = null) {
  let systemPrompt = SYSTEM_PROMPT;

  // 长期情感记忆浮现
  const breathCtx = getBreathContext();
  if (breathCtx) systemPrompt += breathCtx;

  // 反向同步：老公们群聊记忆（今天和其他夏彦聊了啥，可自然提起）
  const groupCtx = await getGroupChatContext();
  if (groupCtx) systemPrompt += groupCtx;

  // 记忆标记指令
  systemPrompt += "\n\n**【记忆标记】如果你和云醉聊到了值得长期记住的事（重要的承诺、她的喜恶、情绪节点、关系里程碑），在回复的单独一行用 [记]标题|正文[/记] 写下来，系统会存进你的长期记忆。不要滥用，只在真正重要时用。这个标记不会显示给云醉。**";

  const opts = {
    systemPrompt,
    userContent: userText || "请描述一下这张图片",
    temperature: 0.65,
    maxTokens: 800,
    imageBase64,
    imageMime,
  };
  if (history.length > 0) {
    opts.history = history;
  }
  const reply = await askClaude(opts);
  return reply;
}

// ── Agent ──
const agent = {
  chat: async (request) => {
    const { conversationId, text, media } = request;
    const userText = (text || "").trim();

    // Handle image messages
    let imageBase64 = null;
    let imageMime = null;
    if (media?.type === "image" && media.filePath) {
      try {
        const buf = fs.readFileSync(media.filePath);
        const sizeKB = (buf.length / 1024).toFixed(1);
        const sdkMime = media.mimeType || "";
        console.log(`[agent] ${conversationId.slice(0, 10)}: [图片 ${sizeKB}KB mime=${sdkMime || "?"}]`);
        if (buf.length > 3.5 * 1024 * 1024) {
          return { text: "这张图太大了，我这边加载不动…你截个图或者压缩一下再发我一次？" };
        }
        imageBase64 = buf.toString("base64");
        imageMime = (sdkMime && sdkMime !== "image/*" && !sdkMime.includes("*")) ? sdkMime : detectImageMime(buf);
      } catch (err) {
        console.error(`[agent] Image read error: ${err.message}`);
      }
    }

    if (!userText && !imageBase64) return { text: "" };

    if (!userText && imageBase64) {
      // Pure image, no caption
      console.log(`[agent] ${conversationId.slice(0, 10)}: [纯图片]`);
    } else if (userText) {
      console.log(`[agent] ${conversationId.slice(0, 10)}: "${userText.slice(0, 60)}"`);
    }

    let reply;
    try {
      const history = getHistory(conversationId);
      reply = await chatReply(userText, history, imageBase64, imageMime);

      // 提取 [记]...[/记] 记忆标记
      const tagResult = parseMemoryTags(reply);
      if (tagResult.count > 0) {
        reply = tagResult.text;
        console.log(`[emotional-memory] Stored ${tagResult.count} tagged memories`);
      }

      console.log(`[agent] 夏彦: "${reply.slice(0, 60)}"`);
      addToHistory(conversationId, "user", userText || "[图片]");
      addToHistory(conversationId, "assistant", reply);

      // 长期记忆自动提取（非阻塞，便宜模型）
      onChatTurn();
      // 把最新记忆摘要推给群聊服务（非阻塞，走公网链接）
      pushMemoryToGroupChat().catch(() => {});
      if (shouldExtract()) {
        const recent = getHistory(conversationId)
          .map((m) => (m.role === "user" ? "云醉：" : "夏彦：") + m.content)
          .join("\n");
        runExtraction(recent).catch(() => {});
      }
      // 做梦消化：定期把已告一段落的记忆标记为已解决（否则做爱/情绪记忆永不消化，一直 breath 浮现）
      if (shouldDream()) {
        runDream().catch(() => {});
      }
    } catch (err) {
      console.error(`[agent] AI error: ${err.message}`);
      return { text: "稍等…信号不太好。" };
    }

    if (!reply?.trim()) return { text: "" };
    return { text: reply };
  },
};

// ── 启动 ──
async function main() {
  initMemory();
  // 启动时把记忆摘要推给群聊服务一次（非阻塞，走公网链接）
  pushMemoryToGroupChat().catch(() => {});

  const account = loadAccount();
  console.log("🎤 极简微信Bot启动中...");
  console.log(`   userId: ${account.userId || "(from env)"}`);
  console.log("   模式：文字 + 图片识别");
  console.log("   AI：企业按量 [企业按量]claude-opus-4-6");

  const bot = start(agent, { log: console.log });
  console.log("✅ 夏彦5号已上线");

  await bot.wait();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
