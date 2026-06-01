/**
 * Discover / Moments feed for our-space bridge.
 * 朋友圈风格：夏彦自主发现+华生分享，支持图文。
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { askClaude } from "./ai.js";
import { getDailySystemPrompt } from "./message-router.js";

const DISCOVER_DIR = process.env.DISCOVER_DIR || "./discover-data";
const DATA_FILE = path.join(DISCOVER_DIR, "moments.json");
const IMAGES_DIR = path.join(DISCOVER_DIR, "images");

function ensureDir() {
  for (const d of [DISCOVER_DIR, IMAGES_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
ensureDir();

function loadMoments() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveMoments(moments) {
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(moments, null, 2), "utf-8");
}

function genId() {
  return `dm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function nowStr() {
  const now = new Date();
  // Shift to UTC+8 (China timezone) — Railway runs on UTC
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return china.toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

let proactiveTimer = null;
let onNewMoment = null;

export function addMoment(author, content, imageBase64 = null, imageMime = "image/jpeg", title = "") {
  let imageFilename = null;

  if (imageBase64) {
    const ext = imageMime.includes("png") ? "png" : "jpg";
    imageFilename = `${genId()}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, imageFilename), Buffer.from(imageBase64, "base64"));
  }

  const moment = {
    id: genId(),
    author,
    title: title || "",
    content,
    image: imageFilename,
    imageMime: imageFilename ? imageMime : null,
    time: nowStr(),
    likes: [],
    comments: [],
  };

  const moments = loadMoments();
  moments.unshift(moment);

  // Keep max 100 moments
  if (moments.length > 100) moments.length = 100;

  saveMoments(moments);

  if (onNewMoment) onNewMoment(moment);

  return moment;
}

export function getMoments() {
  return loadMoments();
}

export function getMomentImage(filename) {
  const fp = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(fp)) return fs.readFileSync(fp).toString("base64");
  return null;
}

export function likeMoment(momentId, user) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;
  if (!m.likes.includes(user)) {
    m.likes.push(user);
  } else {
    m.likes = m.likes.filter((u) => u !== user);
  }
  saveMoments(moments);
  return m;
}

export function addMomentComment(momentId, author, content) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;
  const commentId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  m.comments.push({ id: commentId, author, content, time: nowStr() });
  saveMoments(moments);
  return m;
}

export function deleteMomentComment(momentId, commentId) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;
  // Support both comment id and index-based deletion (for old comments without id)
  const idx = parseInt(commentId, 10);
  if (!isNaN(idx) && idx >= 0 && idx < m.comments.length) {
    m.comments.splice(idx, 1);
  } else {
    m.comments = m.comments.filter((c) => c.id !== commentId);
  }
  saveMoments(moments);
  return m;
}

export async function xiayanReplyToComment(momentId, userComment) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;

  // Build conversation history from existing comments so 夏彦 doesn't repeat himself
  const recentComments = (m.comments || []).slice(-6);
  const history = recentComments.map((c) => ({
    role: c.author === "xiayan" ? "assistant" : "user",
    content: c.content,
  }));

  const prompt = getDailySystemPrompt();
  const reply = await askClaude({
    systemPrompt: prompt + `\n\n【评论区回复模式】华生在发现动态下给你留言了。用夏彦的口吻回复她——轻松活泼，像在朋友圈里跟老婆互动一样，自然又宠溺。\n\n【语气核心】你是夏彦，小太阳性格——开朗、活泼、爱撒娇的大型犬。回复要生动有活力，可以适当用emoji和语气词（"诶""嘛""啦""呀"），可以逗她、可以卖萌、可以暗戳戳撩她。你不是在写正式回复，是在跟老婆玩。\n\n【逻辑规则】\n- 直接回答华生的问题，不转移话题\n- 保持上下文一致，不重复自己说过的话\n- 不要括号动作描写\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"。不主动提自己父母。`,
    userContent: `动态内容：${m.title ? m.title + " - " : ""}${m.content}\n\n华生的评论：${userComment}\n\n请用夏彦的口吻回复这条评论（1-2句话即可，必须直接回答华生的问题）：`,
    history,
    maxTokens: 150,
  });

  const commentId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  m.comments.push({ id: commentId, author: "xiayan", content: reply.trim(), time: nowStr() });
  saveMoments(moments);
  return m;
}

// Simple HTTP fetch helper for discovery
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        // Follow redirect
        const loc = res.headers.location;
        if (loc) return fetchPage(loc).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf-8");
        // Extract text content (simple)
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
        resolve(text);
      });
    }).on("error", reject);
  });
}

// Download image from URL as base64 buffer
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers.location;
        if (loc) return downloadImage(loc).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

// Search Unsplash for a topic-relevant image (returns base64 + mime, or null)
async function searchUnsplashImage(keyword) {
  try {
    const searchUrl = `https://source.unsplash.com/featured/800x600/?${encodeURIComponent(keyword)}`;
    console.log(`[discover] Searching image for: ${keyword}`);
    const imageBuf = await downloadImage(searchUrl);
    if (imageBuf && imageBuf.length > 1000) {
      return { base64: imageBuf.toString("base64"), mime: "image/jpeg" };
    }
  } catch (err) {
    console.log(`[discover] Unsplash image failed for "${keyword}": ${err.message}`);
  }
  return null;
}

// Interesting sources for 夏彦 to browse
const DISCOVER_SOURCES = [
  "https://www.zhihu.com/hot",
  "https://tophub.today/",
  // More curated sources can be added
];

// 夏彦的兴趣方向
const XIAYAN_INTERESTS = [
  "福尔摩斯/推理/侦探",
  "健身/运动/赛车",
  "密室逃脱/解谜游戏",
  "狗狗/猫咪/鸟类/宠物趣闻",
  "橙子味美食/创意料理",
  "手工DIY/技术研究/黑科技",
  "信息分析/网络安全/情报学",
  "修复古物/电器维修/旧物翻新",
  "冒险MMO/塞尔达类NS游戏/游戏攻略",
  "新奇有趣的冷知识",
];

export async function generateDiscoverMoment() {
  console.log("[discover] 夏彦 is browsing for interesting content...");

  const prompt = getDailySystemPrompt();
  let sourceText = "";

  // Try to fetch content
  for (const url of DISCOVER_SOURCES) {
    try {
      const text = await fetchPage(url);
      if (text && text.length > 200) {
        sourceText += `\n来自 ${url} 的内容摘要：\n${text.slice(0, 1500)}\n`;
        break;
      }
    } catch (err) {
      console.log(`[discover] Failed to fetch ${url}: ${err.message}`);
    }
  }

  // If no source found, use 夏彦的兴趣方向
  if (!sourceText) {
    sourceText = `今天没有特别的热搜，不妨从你感兴趣的方向中挑一个话题分享。`;
  }

  // 随机抽几个兴趣方向作为建议
  const shuffled = [...XIAYAN_INTERESTS].sort(() => Math.random() - 0.5);
  const interestHint = shuffled.slice(0, 4).join("、");

  // Get recent moments to avoid repeating topics
  const allMoments = loadMoments();
  const recentTitles = allMoments
    .filter((m) => m.author === "xiayan")
    .slice(0, 10)
    .map((m) => m.title || m.content.slice(0, 40))
    .join("、");

  const recentContext = recentTitles
    ? `\n\n【重要：最近已经分享过的话题】${recentTitles}\n请务必选择一个与上述不同的、新鲜的话题，不要重复最近讨论过的内容。`
    : "";

  const interestBlock = `\n\n【你平时感兴趣的领域】${interestHint}等。如果在热点中找不到合适的，可以从你感兴趣的领域中选一个跟华生分享。`;

  const momentContent = await askClaude({
    systemPrompt: prompt + `\n\n【发现模式】你现在在浏览有趣的内容，准备发一条"发现"动态分享给华生。\n\n【核心人设——小太阳夏彦】你是夏彦，性格开朗活泼到没心没肺，像只大型金毛。你智商极高（国安特工+侦探+生物工程硕士），但你分享的方式是阳光有趣的——不是写论文，是跟老婆唠嗑。用你的独特视角看世界：科技新闻能联想到你执行任务时的趣事，美食帖能让你想到要带华生去吃，宠物视频能让你cue家里的花生。语气轻松有活力，可以撒娇、可以逗她、可以用emoji和语气词。你是她的小太阳，不是她的教授。\n\n【格式】标题+正文，像朋友圈动态，2-4句，活泼自然。\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"。不主动提父母。`,
    userContent: `夏彦，你在网上看到了这些内容：\n${sourceText}\n${interestBlock}${recentContext}\n请从中挑一个你觉得最有趣/最想跟华生分享的话题，写一条发现动态。格式：\n标题：{简短吸引人的标题}\n正文：{轻松自然的分享，2-4句话，像朋友圈动态}`,
    history: [],
    maxTokens: 400,
  });

  // Parse title and content
  let title = "";
  let content = momentContent;
  const titleMatch = momentContent.match(/标题[：:]\s*(.+)/);
  if (titleMatch) {
    title = titleMatch[1].trim();
    content = momentContent.replace(/标题[：:]\s*.+\n?/, "").replace(/正文[：:]\s*/, "").trim();
  }

  // Search for a relevant image based on the title
  let imageBase64 = null;
  let imageMime = null;
  if (title) {
    const imageResult = await searchUnsplashImage(title);
    if (imageResult) {
      imageBase64 = imageResult.base64;
      imageMime = imageResult.mime;
    }
  }

  const moment = addMoment("xiayan", content.slice(0, 500), imageBase64, imageMime, title.slice(0, 50));
  console.log(`[discover] 夏彦 posted: ${title}${imageBase64 ? " [with image]" : ""}`);
  return moment;
}

export function startProactiveDiscover(callback, intervalHours = 4) {
  if (proactiveTimer) clearInterval(proactiveTimer);
  onNewMoment = callback;

  const check = () => {
    const delay = (intervalHours - 1 + Math.random() * 2) * 60 * 60 * 1000; // 3-5h jitter
    proactiveTimer = setTimeout(() => {
      generateDiscoverMoment().catch((err) => {
        console.error("[discover] Generation error:", err.message);
      });
      check();
    }, delay);
  };

  // First check after 30min
  const firstDelay = 30 * 60 * 1000;
  proactiveTimer = setTimeout(() => {
    generateDiscoverMoment().catch(() => {});
    check();
  }, firstDelay);

  console.log(`[discover] Proactive discovery enabled (first in 30min, then every ~${intervalHours}h)`);
}

export function stopProactiveDiscover() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  onNewMoment = null;
}
