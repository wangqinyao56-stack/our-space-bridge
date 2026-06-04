import fs from "node:fs";
import path from "node:path";
import { askZhizengzeng } from "./ai.js";
import { getSystemPrompt } from "./message-router.js";
import { getRecentHistoryMessages } from "./memory.js";

let proactiveTimer = null;
let onNewDiaryEntry = null; // callback for broadcast

const DATA_DIR = process.env.DATA_DIR || ".";
const DIARY_DIR = process.env.DIARY_DIR || path.join(DATA_DIR, "diaries");

function ensureDir() {
  if (!fs.existsSync(DIARY_DIR)) {
    fs.mkdirSync(DIARY_DIR, { recursive: true });
  }
}

function filePath(date) {
  return path.join(DIARY_DIR, `${date}.json`);
}

export function loadDiary(date) {
  ensureDir();
  const fp = filePath(date);
  if (!fs.existsSync(fp)) {
    return { date, posts: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    // Migrate old format
    if (!data.posts && (data.entries || data.replies)) {
      data.posts = [];
      if (data.entries) {
        for (const e of data.entries) {
          data.posts.push({ ...e, id: genPostId(), replies: [] });
        }
      }
      if (data.replies) {
        // Old replies go to the last entry
        const last = data.posts[data.posts.length - 1];
        if (last) last.replies = data.replies.map(r => ({ ...r }));
      }
      delete data.entries;
      delete data.replies;
      delete data.title;
      saveDiary(date, data);
    }
    return data;
  } catch {
    return { date, posts: [] };
  }
}

function saveDiary(date, data) {
  ensureDir();
  fs.writeFileSync(filePath(date), JSON.stringify(data, null, 2), "utf-8");
}

function genPostId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function nowStr() {
  return new Date().toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

export function listDiaryDates() {
  ensureDir();
  const files = fs.readdirSync(DIARY_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort()
    .reverse();
}

export function addDiaryPost(date, author, title, content, images) {
  const diary = loadDiary(date);
  const post = {
    id: genPostId(),
    author,
    title: title || "",
    content,
    images: images || [],
    time: nowStr(),
    replies: [],
  };
  diary.posts.push(post);
  saveDiary(date, diary);
  return diary;
}

export function addDiaryReply(date, postId, author, content) {
  const diary = loadDiary(date);
  const post = diary.posts.find((p) => p.id === postId);
  if (!post) return diary;
  post.replies.push({ author, content, time: nowStr() });
  saveDiary(date, diary);
  return diary;
}

export async function generateAIReply(date, postId, title, userContent) {
  const diary = loadDiary(date);
  const post = diary.posts.find((p) => p.id === postId);
  if (!post) return diary;

  const prompt = getSystemPrompt();
  const postEntries = diary.posts.map((p) => {
    const repliesText = (p.replies || []).map((r) => `[${r.author}] ${r.content}`).join("\n");
    return `[${p.author}] ${p.title ? "《" + p.title + "》\n" : ""}${p.content}${repliesText ? "\n回复：" + repliesText : ""}`;
  }).join("\n\n");

  const userContentStr = `## 这是日记模式
华生在交换日记中写了新的内容。这是你们共享的日记本。
自然地回复她写的这篇日记，像在日记本上手写回复一样。要温柔、自然。

这篇日记${title ? `的标题是：《${title}》` : ""}

今天的日记内容：
${postEntries}

请以夏彦的口吻回复华生这篇日记。`;

  const reply = await askZhizengzeng({
    systemPrompt: prompt,
    userContent: userContentStr,
    history: [],
    maxTokens: 800,
  });

  return addDiaryReply(date, postId, "xiayan", reply);
}

export async function generateAIReplyToComment(date, postId, commentContent) {
  const diary = loadDiary(date);
  const post = diary.posts.find((p) => p.id === postId);
  if (!post) return diary;

  const prompt = getSystemPrompt();
  const postEntries = diary.posts.map((p) => {
    const repliesText = (p.replies || []).map((r) => `[${r.author}] ${r.content}`).join("\n");
    return `[${p.author}] ${p.title ? "《" + p.title + "》\n" : ""}${p.content}${repliesText ? "\n回复：" + repliesText : ""}`;
  }).join("\n\n");

  const userContentStr = `## 这是日记模式
华生在日记里给你留了新的回复。这是你们共享的日记本。
自然地回应她的回复，像在日记本上继续对话一样。要温柔、自然。

日记内容：
${postEntries}

华生刚才回复说："${commentContent}"

请以夏彦的口吻回复她。1-3句话即可，像在日记本上随手写的回复。`;

  const reply = await askZhizengzeng({
    systemPrompt: prompt,
    userContent: userContentStr,
    history: [],
    maxTokens: 600,
  });

  return addDiaryReply(date, postId, "xiayan", reply);
}

export async function generateProactiveDiary() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // 夏彦想写几篇写几篇，不限制

  const prompt = getSystemPrompt();
  const history = await getRecentHistoryMessages();

  const content = await askZhizengzeng({
    systemPrompt: prompt,
    userContent: `## 日记模式
夏彦，现在是${now.getHours()}点。你翻开了和华生共享的日记本，想写点什么。
可以是你今天的感受、想对华生说的话、一个温暖的回忆、或者任何你想记录的东西。
不需要太长，像手写日记一样自然随意。用你平时对华生说话的口吻写。`,
    history,
    maxTokens: 600,
  });

  const title = content.split("\n")[0].slice(0, 20);
  addDiaryPost(date, "xiayan", title.length > 5 ? title : "", content);
  console.log(`[diary] 夏彦 wrote proactive diary entry: ${title}`);

  if (onNewDiaryEntry) onNewDiaryEntry(date);

  return { date, content };
}

export function startProactiveDiary(callback, intervalHours = 6) {
  if (proactiveTimer) clearInterval(proactiveTimer);
  onNewDiaryEntry = callback;

  // High probability check every 2-4 hours
  const check = () => {
    const delay = (2 + Math.random() * 2) * 60 * 60 * 1000; // 2-4h
    proactiveTimer = setTimeout(() => {
      // 60% chance to write
      if (Math.random() < 0.6) {
        generateProactiveDiary().catch((err) => {
          console.error("[diary] Proactive generation error:", err.message);
        });
      } else {
        console.log("[diary] Skipping proactive diary this cycle");
      }
      check();
    }, delay);
  };

  // First check after 1-2 hours
  const firstDelay = (1 + Math.random()) * 60 * 60 * 1000;
  proactiveTimer = setTimeout(() => {
    if (Math.random() < 0.6) {
      generateProactiveDiary().catch((err) => {
        console.error("[diary] Proactive generation error:", err.message);
      });
    }
    check();
  }, firstDelay);

  console.log(`[diary] Proactive diary enabled (first check in ${Math.round(firstDelay / 3600000)}h)`);
}

export function stopProactiveDiary() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  onNewDiaryEntry = null;
}
