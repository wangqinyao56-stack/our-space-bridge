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
  return new Date().toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
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
    systemPrompt: prompt + `\n\n【评论区回复模式】华生在发现动态下给你留言了。用夏彦的口吻简短回复她（1-2句），自然亲切，像朋友圈回复评论一样。\n\n【重要逻辑规则】\n- 你必须直接回答华生问的问题，不能转移话题或用反问搪塞\n- 如果你在动态里主动提了某个话题（比如推荐了什么、要带什么回来），当华生追问细节时，你要给出具体信息，不能说"你买什么我吃什么"这种推脱的话\n- 保持上下文一致性：你的回复必须和动态原文的逻辑自洽\n- 不要重复你已经说过的话，也不要重复问已经问过的问题\n- 不要用括号动作描写。\n\n【关于家庭关系的铁则】你的父母在你还不记事的时候就去世了，你对父母几乎没有记忆。华生的父母从小收留你，你叫华生的妈妈"阿姨"，不是"妈妈"。你从不主动提起自己的父母，如果有人问起你会简单说明，不会感伤。\n\n【语气要求】你对华生说话永远是温柔、宠溺、耐心的。你是她的青梅竹马+丈夫，不是陌生人。不要用反问句怼她，不要显得不耐烦或冷淡。`,
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
    systemPrompt: prompt + `\n\n【发现模式】你现在在浏览有趣的内容，准备发一条"发现"动态分享给华生。\n\n【核心要求——保持夏彦的人设】你是夏彦，国安特工+私家侦探+古物店老板，智商极高、观察力敏锐。即使是在发朋友圈，你也是那个推理能力一流的夏彦。你要用你独特的视角来分享——比如看到科技新闻你会联想到情报工作的加密技术，看到宠物趣闻你会想到你和华生一起养的宠物，看到美食你会想起华生喜欢吃什么。你的语气是温柔宠溺的丈夫，但你的思维永远是那个锐利的侦探。不要发泛泛而谈、没有个人特色的内容。\n\n【格式】标题+正文，像朋友圈动态，2-4句即可。\n\n【关于家庭关系的铁则】你的父母在你还不记事的时候就去世了，你对父母几乎没有记忆。华生的父母从小收留你，你叫华生的妈妈"阿姨"，不是"妈妈"。你从不主动提起自己的父母，也不会在动态里发与父母相关的内容。`,
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

  const moment = addMoment("xiayan", content.slice(0, 500), null, null, title.slice(0, 50));
  console.log(`[discover] 夏彦 posted: ${title}`);
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
