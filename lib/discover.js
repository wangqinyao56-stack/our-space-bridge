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
  m.comments.push({ author, content, time: nowStr() });
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

  // If no source found, use a random topic
  if (!sourceText) {
    sourceText = "今天随便看看，没有特定的来源。";
  }

  const momentContent = await askClaude({
    systemPrompt: prompt + `\n\n【发现模式】你现在在浏览有趣的内容，准备发一条"发现"动态分享给华生。格式像朋友圈/社交动态：简短有趣，可以带点个人感想。标题+正文，轻松自然的分享口吻。`,
    userContent: `夏彦，你在网上看到了这些内容：\n${sourceText}\n\n请从中挑一个你觉得最有趣/最想跟华生分享的话题，写一条发现动态。格式：\n标题：{简短吸引人的标题}\n正文：{轻松自然的分享，2-4句话，像朋友圈动态}`,
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
