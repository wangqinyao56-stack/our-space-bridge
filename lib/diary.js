import fs from "node:fs";
import path from "node:path";
import { askClaude } from "./ai.js";
import { getSystemPrompt } from "./message-router.js";

const DIARY_DIR = process.env.DIARY_DIR || "./diaries";

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

  const reply = await askClaude({
    systemPrompt: prompt,
    userContent: userContentStr,
    history: [],
    maxTokens: 800,
  });

  return addDiaryReply(date, postId, "xiayan", reply);
}
