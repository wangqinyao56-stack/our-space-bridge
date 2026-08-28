/**
 * 共读 (coread / reading-nook)
 * 夏彦陪华生同读一本书：夏彦写一段内容 + 一段批注，进度持久化，可边读边聊。
 * 内容为 AI 原创讲述，不引用受版权保护的原文。
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { askJiushi } from "./ai.js";
import { synthesizeBuffer } from "./realtime-voice.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const COREAD_FILE = path.join(DATA_DIR, "coread.json");
const COREAD_AUDIO_DIR = path.join(DATA_DIR, "coread", "audio");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let state = {
  books: [],           // 书库：导入的 txt 都进这里，可多本（朗读用）
  currentBookId: null, // 当前书库正在读的书
  book: null,        // { id, title, author, genre } 共读界面当前书
  chapter: 0,        // 已读到第几章（0 = 未开始）
  source: "ai",      // "ai" 现写 | "txt" 导入
  textChunks: [],    // 导入 txt 时按段切好的章节数组
  passages: [],      // { id, chapter, text, annotation, timestamp }
  discussions: [],   // { id, author, text, timestamp }
  updatedAt: null,
};

try {
  if (fs.existsSync(COREAD_FILE)) {
    const raw = JSON.parse(fs.readFileSync(COREAD_FILE, "utf-8"));
    state = { ...state, ...raw };
    if (!Array.isArray(state.books)) state.books = [];
    // 迁移：旧版单本书若是导入的 txt，塞进书库作为第一本
    if (state.books.length === 0 && state.source === "txt" && Array.isArray(state.textChunks) && state.textChunks.length > 0 && state.book) {
      state.books.push({
        id: state.book.id || uuid().slice(0, 8),
        title: state.book.title,
        author: state.book.author || "",
        genre: state.book.genre || "导入的书",
        source: "txt",
        textChunks: state.textChunks,
        chapter: state.chapter || 1,
        updatedAt: state.updatedAt,
      });
      state.currentBookId = state.books[0].id;
    }
    console.log(`[coread] Loaded — books:${state.books.length}, 当前:${state.book?.title || "无"}, chapter:${state.chapter}`);
  }
} catch { /* keep default */ }

function save() {
  try { fs.writeFileSync(COREAD_FILE, JSON.stringify(state, null, 2), "utf-8"); } catch {}
}

function getState() {
  return state;
}

const SYS = "你是夏彦，国安部特工+私家侦探，对华生温柔宠溺，叫她华生/宝宝。现在是你们一起读书的时光，语气自然口语、带点撒娇，不说教、不评价她的理解能力。";

/**
 * 生成第 chapter 章：正文 + 批注。
 * 返回 { text, annotation }；解析失败时整段当正文。
 */
async function generatePassage(book, chapter) {
  const prompt = `你和华生正在共读《${book.title}》（${book.genre || "未分类"}）。请写第 ${chapter} 章的一段内容，要求：
1. 原创讲述，不照搬任何受版权保护的原文，用你自己的话把这一章的剧情/画面讲出来，150～260字。
2. 写完后，写一条你的批注（你的感想、吐槽、联想到华生的事），1～2句，夏彦口吻。
3. 严格按下面格式输出，不要多写字：

【正文】
（正文内容）

【批注】
（批注内容）`;

  const reply = await askJiushi({ systemPrompt: SYS, userContent: prompt, history: [], maxTokens: 600, temperature: 0.8 });
  if (!reply?.trim()) return null;

  const textMatch = reply.match(/【正文】\s*([\s\S]*?)\s*【批注】\s*([\s\S]*)$/);
  if (textMatch) {
    return { text: textMatch[1].trim(), annotation: textMatch[2].trim() };
  }
  // 兜底：AI 没按格式，整段当正文，批注留空
  return { text: reply.trim(), annotation: "" };
}

async function generateReply(book, chapter, userText) {
  const prompt = `你们正在共读《${book.title}》第 ${chapter} 章。华生说："${userText}"。用夏彦的口吻自然回应，聊书也聊她，1～3句话，不要长篇。`;
  const reply = await askJiushi({ systemPrompt: SYS, userContent: prompt, history: [], maxTokens: 200, temperature: 0.8 });
  return reply?.trim() || "嗯，我在听呢～你继续说说看？";
}

/** 对给定正文写一条夏彦的批注（用于导入的 txt，正文来自原文） */
async function generateAnnotation(book, text) {
  const excerpt = text.slice(0, 800);
  const prompt = `你和华生正在共读《${book.title}》。下面是这一段正文：

${excerpt}

请写一条你的批注——你的感想、吐槽、联想到华生的事，1～2句，夏彦口吻，不要复述原文。`;
  const reply = await askJiushi({ systemPrompt: SYS, userContent: prompt, history: [], maxTokens: 200, temperature: 0.8 });
  return reply?.trim() || "";
}

/** 把长文本按段落切成长度约 500 字的"章" */
function splitText(text) {
  const cleaned = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const p of paragraphs) {
    if (p.length > 600) {
      if (buf) { chunks.push(buf); buf = ""; }
      for (let i = 0; i < p.length; i += 500) {
        chunks.push(p.slice(i, i + 500));
      }
    } else if (buf && (buf.length + p.length) > 500) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n" + p : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.slice(0, 500); // 上限，避免超大文件撑爆内存
}

/**
 * 开始（或换一本）共读。title 为空时由夏彦挑一本。
 */
async function startReading(title) {
  let book;
  if (title?.trim()) {
    book = { id: uuid().slice(0, 8), title: title.trim(), author: "", genre: "华生挑的" };
  } else {
    const pick = await pickBook();
    book = { id: uuid().slice(0, 8), title: pick.title, author: pick.author, genre: pick.genre };
  }

  const chapter = 1;
  const passage = await generatePassage(book, chapter);
  if (!passage) {
    return { state, error: "生成失败，稍后再试" };
  }

  state = {
    book,
    chapter,
    source: "ai",
    textChunks: [],
    passages: [{ id: uuid().slice(0, 8), chapter, text: passage.text, annotation: passage.annotation, timestamp: new Date().toISOString() }],
    discussions: [],
    updatedAt: new Date().toISOString(),
  };
  save();
  return { state, passage: state.passages[0] };
}

async function continueReading() {
  if (!state.book) return { state, error: "还没有开始共读" };
  const chapter = state.chapter + 1;

  let text, annotation;
  if (state.source === "txt" && Array.isArray(state.textChunks) && state.textChunks.length >= chapter) {
    text = state.textChunks[chapter - 1];
    annotation = await generateAnnotation(state.book, text);
  } else {
    const passage = await generatePassage(state.book, chapter);
    if (!passage) return { state, error: "生成失败，稍后再试" };
    text = passage.text;
    annotation = passage.annotation;
  }

  const p = { id: uuid().slice(0, 8), chapter, text, annotation, timestamp: new Date().toISOString() };
  state.chapter = chapter;
  state.passages.push(p);
  state.updatedAt = new Date().toISOString();
  save();
  return { state, passage: p };
}

/** 导入 txt：切段后进书库（同书名覆盖，不同书名追加），同时设为共读当前书，批注由夏彦写 */
async function importBook(title, text) {
  const chunks = splitText(text);
  if (chunks.length === 0) return { state, error: "文件内容为空" };

  const titleTrim = (title || "").trim() || "未命名";
  const existingIdx = state.books.findIndex(b => b.title === titleTrim);
  const bookEntry = {
    id: existingIdx >= 0 ? state.books[existingIdx].id : uuid().slice(0, 8),
    title: titleTrim,
    author: "",
    genre: "导入的书",
    source: "txt",
    textChunks: chunks,
    chapter: 1,
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) state.books[existingIdx] = bookEntry;
  else state.books.push(bookEntry);
  state.currentBookId = bookEntry.id;

  // 兼容现有共读界面：设当前书 + 第 1 章 + 批注
  const annotation = await generateAnnotation(bookEntry, chunks[0]);
  state.book = { id: bookEntry.id, title: titleTrim, author: "", genre: "导入的书" };
  state.chapter = 1;
  state.source = "txt";
  state.textChunks = chunks;
  state.passages = [{ id: uuid().slice(0, 8), chapter: 1, text: chunks[0], annotation, timestamp: new Date().toISOString() }];
  state.discussions = [];
  state.updatedAt = new Date().toISOString();
  save();
  return { state, passage: state.passages[0] };
}

async function discuss(text) {
  if (!state.book) return { state, reply: null };
  const userMsg = { id: uuid().slice(0, 8), author: "me", text: text.trim(), timestamp: new Date().toISOString() };
  state.discussions.push(userMsg);

  const reply = await generateReply(state.book, state.chapter, text);
  const xiaMsg = { id: uuid().slice(0, 8), author: "xiayan", text: reply, timestamp: new Date().toISOString() };
  state.discussions.push(xiaMsg);
  state.updatedAt = new Date().toISOString();
  save();
  return { state, reply: xiaMsg };
}

async function pickBook() {
  const candidates = [
    { title: "星星落进海里的晚上", author: "夏彦", genre: "治愈·幻想" },
    { title: "最后一班回家的地铁", author: "夏彦", genre: "都市·温情" },
    { title: "侦探先生的小小失手", author: "夏彦", genre: "轻悬疑·甜" },
    { title: "山顶上的咖啡馆", author: "夏彦", genre: "治愈·日常" },
    { title: "写给华生的一千零一夜", author: "夏彦", genre: "情书·幻想" },
  ];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** 书库列表（朗读用）：每本书的 id/书名/总段数/已读段数 */
function listBooks() {
  return state.books.map(b => ({
    id: b.id,
    title: b.title,
    total: (b.textChunks || []).length,
    chapter: b.chapter || 0,
  }));
}

/**
 * 朗读：取书库某本书第 chunkIdx 段，合成夏彦语音存 mp3，更新进度，返回音频 URL。
 * 复用火山夏彦音色（synthesizeBuffer），纯念，不生成批注/对话。
 */
async function readChunk(bookId, chunkIdx) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const chunks = book.textChunks || [];
  const idx = Number(chunkIdx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= chunks.length) return { error: "没有这一章" };

  const text = chunks[idx];
  const buf = await synthesizeBuffer(text);
  try { fs.mkdirSync(COREAD_AUDIO_DIR, { recursive: true }); } catch {}
  fs.writeFileSync(path.join(COREAD_AUDIO_DIR, `${bookId}-${idx}.mp3`), buf);

  book.chapter = idx + 1;
  book.updatedAt = new Date().toISOString();
  save();

  return {
    title: book.title,
    idx,
    total: chunks.length,
    text,
    audioUrl: `/api/coread/audio/${bookId}-${idx}.mp3`,
  };
}

export { getState, startReading, continueReading, discuss, pickBook, importBook, listBooks, readChunk };
