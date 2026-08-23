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
// ── AI调用 ──
async function chatReply(userText, history, imageBase64 = null, imageMime = null) {
  const opts = {
    systemPrompt: SYSTEM_PROMPT,
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
        console.log(`[agent] ${conversationId.slice(0, 10)}: [图片 ${sizeKB}KB mime=${media.mimeType || "?"}]`);
        if (buf.length > 3.5 * 1024 * 1024) {
          return { text: "这张图太大了，我这边加载不动…你截个图或者压缩一下再发我一次？" };
        }
        imageBase64 = buf.toString("base64");
        imageMime = media.mimeType || "image/jpeg";
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
      console.log(`[agent] 夏彦: "${reply.slice(0, 60)}"`);
      addToHistory(conversationId, "user", userText || "[图片]");
      addToHistory(conversationId, "assistant", reply);
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

  const account = loadAccount();
  console.log("🎤 极简微信Bot启动中...");
  console.log(`   userId: ${account.userId || "(from env)"}`);
  console.log("   模式：文字 + 图片识别");
  console.log("   AI：企业按量 [企业按量]claude-opus-4-6");

  const bot = start(agent, { log: console.log });
  console.log("✅ 夏彦4号已上线（林游专用）");

  await bot.wait();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
