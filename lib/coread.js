/**
 * 共读 (coread / reading-nook)
 * 夏彦陪华生同读一本书：夏彦写一段内容 + 一段批注，进度持久化，可边读边聊。
 * 内容为 AI 原创讲述，不引用受版权保护的原文。
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { askJiushi } from "./ai.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const COREAD_FILE = path.join(DATA_DIR, "coread.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let state = {
  book: null,        // { id, title, author, genre }
  chapter: 0,        // 已读到第几章（0 = 未开始）
  passages: [],      // { id, chapter, text, annotation, timestamp }
  discussions: [],   // { id, author, text, timestamp }
  updatedAt: null,
};

try {
  if (fs.existsSync(COREAD_FILE)) {
    const raw = JSON.parse(fs.readFileSync(COREAD_FILE, "utf-8"));
    state = { ...state, ...raw };
    console.log(`[coread] Loaded — book:${state.book?.title || "无"}, chapter:${state.chapter}`);
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
  const passage = await generatePassage(state.book, chapter);
  if (!passage) return { state, error: "生成失败，稍后再试" };

  const p = { id: uuid().slice(0, 8), chapter, text: passage.text, annotation: passage.annotation, timestamp: new Date().toISOString() };
  state.chapter = chapter;
  state.passages.push(p);
  state.updatedAt = new Date().toISOString();
  save();
  return { state, passage: p };
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

export { getState, startReading, continueReading, discuss, pickBook };
