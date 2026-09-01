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
import { voxcpmEnabled, voxcpmSynthesizeMp3 } from "./voxcpm.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const COREAD_FILE = path.join(DATA_DIR, "coread.json");
const COREAD_AUDIO_DIR = path.join(DATA_DIR, "coread", "audio");
const COREAD_BOOK_AUDIO_DIR = path.join(DATA_DIR, "coread", "book-audio");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let state = {
  books: [],           // 书库：导入的 txt 都进这里，可多本（朗读用）
  categories: [],      // 书架分类名列表
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
    if (!Array.isArray(state.categories)) state.categories = [];
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
    console.log(`[coread] Loaded — books:${state.books.length}, 分类:${state.categories.length}, 当前:${state.book?.title || "无"}, chapter:${state.chapter}`);
  }
} catch { /* keep default */ }

function save() {
  try { fs.writeFileSync(COREAD_FILE, JSON.stringify(state, null, 2), "utf-8"); } catch {}
}

function getState() {
  return state;
}

const SYS = "你是夏彦，国安部特工+私家侦探，对华生温柔宠溺，叫她华生/宝宝。现在是你们一起读书的时光，语气自然口语、带点撒娇，不说教、不评价她的理解能力。";

/** 防剧透上下文：告诉夏彦读到哪了、别提前剧透后面的剧情 */
function buildAntiSpoilerContext(book, currentChapter, totalChapters) {
  const total = totalChapters ? `（全书 ${totalChapters} 章）` : "";
  return `【共读进度·防剧透】你和华生共读《${book.title}》，现在读到第 ${currentChapter} 章${total}。你只知道读到这里为止的剧情，后面的章节还没读——绝对别提前透露后面的情节、结局、转折，也别"我猜后面…""下一章会…"这种暗示。聊书只聊已经读过的内容。`;
}

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
  const total = Array.isArray(book.chapters) ? book.chapters.length : 0;
  const prompt = `${buildAntiSpoilerContext(book, chapter, total)}\n华生说："${userText}"。用夏彦的口吻自然回应，聊书也聊她，1～3句话，不要长篇。`;
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

/** 按"第X章"切分整本，返回 [{ title, text }] 完整章节 */
function splitChapters(text) {
  const cleaned = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = cleaned.split(/(第[0-9一二三四五六七八九十百千零]+章[^\n]*)/);
  const chapters = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = (parts[i] || "").trim();
    const content = (parts[i + 1] || "").trim();
    if (content) chapters.push({ title, text: content });
  }
  return chapters;
}

/** 按句号/感叹号/问号切句，每句保留结尾标点 */
function splitSentences(text) {
  const parts = (text || "").split(/([。！？!?])/);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = parts[i];
    const punct = parts[i + 1] || "";
    if (s && s.trim()) sentences.push(s.trim() + punct);
  }
  return sentences;
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
  const chapters = splitChapters(text);
  if (chapters.length === 0) return { state, error: "文件内容为空，或没识别到章节（需要含“第X章”标题）" };

  const titleTrim = (title || "").trim() || "未命名";
  const existingIdx = state.books.findIndex(b => b.title === titleTrim);
  const bookEntry = {
    id: existingIdx >= 0 ? state.books[existingIdx].id : uuid().slice(0, 8),
    title: titleTrim,
    author: "",
    genre: "导入的书",
    source: "txt",
    category: existingIdx >= 0 ? (state.books[existingIdx].category || "") : "",
    chapters,
    comments: existingIdx >= 0 ? (state.books[existingIdx].comments || []) : [],
    huashengComments: existingIdx >= 0 ? (state.books[existingIdx].huashengComments || []) : [],
    currentChapter: existingIdx >= 0 ? (state.books[existingIdx].currentChapter || 0) : 0,
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) state.books[existingIdx] = bookEntry;
  else state.books.push(bookEntry);
  state.currentBookId = bookEntry.id;
  state.updatedAt = new Date().toISOString();
  save();
  return { state, totalChapters: chapters.length };
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

/** 书库列表（朗读用）：每本书的 id/书名/总章数/已读章数/分类 */
function listBooks() {
  return state.books.map(b => ({
    id: b.id,
    title: b.title,
    total: (b.chapters || []).length,
    chapter: b.currentChapter || 0,
    category: b.category || "",
  }));
}

/** 分类名列表 */
function listCategories() {
  return state.categories;
}

/** 新建分类（去重） */
function createCategory(name) {
  const n = (name || "").trim();
  if (!n) return { error: "分类名不能为空" };
  if (state.categories.includes(n)) return { error: "这个分类已经存在" };
  state.categories.push(n);
  state.updatedAt = new Date().toISOString();
  save();
  return { categories: state.categories };
}

/** 删除一本书（连评论一起删，不删音频文件） */
function deleteBook(bookId) {
  const idx = state.books.findIndex(b => b.id === bookId);
  if (idx < 0) return { error: "找不到这本书" };
  state.books.splice(idx, 1);
  if (state.currentBookId === bookId) state.currentBookId = null;
  state.updatedAt = new Date().toISOString();
  save();
  return { books: listBooks() };
}

/** 移动书到分类（category 为空 = 移出分类/未分类） */
function moveBook(bookId, category) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  book.category = (category || "").trim();
  book.updatedAt = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  save();
  return { books: listBooks() };
}

/**
 * 朗读：取书库某本书第 chunkIdx 段，合成夏彦语音存 mp3，更新进度，返回音频 URL。
 * 复用火山夏彦音色（synthesizeBuffer），纯念，不生成批注/对话。
 */
/** 朗读任意文本（当前页），合成夏彦语音返回音频 URL */
async function readText(text) {
  const clean = (text || "").trim();
  if (!clean) return { error: "没有要朗读的内容" };
  const buf = voxcpmEnabled() ? await voxcpmSynthesizeMp3(clean) : await synthesizeBuffer(clean);
  try { fs.mkdirSync(COREAD_AUDIO_DIR, { recursive: true }); } catch {}
  const id = uuid().slice(0, 8);
  fs.writeFileSync(path.join(COREAD_AUDIO_DIR, `${id}.mp3`), buf);
  return { audioUrl: `/api/coread/audio/${id}.mp3` };
}

/**
 * 朗读某章：优先返回预生成的成品 mp3（chNNN.mp3，VoxCPM 批量生成、参数定版）。
 * 成品音频放在云端 /data/coread/book-audio/，不在 App 包内，App 走 URL 流式播放。
 * 无成品时返回 error，前端可回退实时合成。
 */
function readChapterAudio(bookId, chapterIdx) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const idx = Number(chapterIdx);
  const chapters = book.chapters || [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= chapters.length) return { error: "没有这一章" };
  const file = `ch${String(idx + 1).padStart(3, "0")}.mp3`;
  const fp = path.join(COREAD_BOOK_AUDIO_DIR, file);
  if (!fs.existsSync(fp)) return { error: "该章还没有成品语音" };
  // 断点续听：只有当前正在读的那一章才带上次进度，其它章从头播
  const positionSeconds = (idx === (book.currentChapter || 0)) ? (book.positionSeconds || 0) : 0;
  return { audioUrl: `/api/coread/book-audio/${file}`, positionSeconds };
}

/** 保存朗读进度（章内秒数），用于断点续听 */
function saveReadingProgress(bookId, chapterIdx, positionSeconds) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const idx = Number(chapterIdx);
  if (!Number.isInteger(idx) || idx < 0) return { error: "章节无效" };
  book.currentChapter = idx;
  book.positionSeconds = Math.max(0, Number(positionSeconds) || 0);
  book.updatedAt = new Date().toISOString();
  save();
  return { ok: true, chapter: idx, positionSeconds: book.positionSeconds };
}

/** 取某章：完整章节 + 句子数组 + 该章评论（懒加载生成） */
async function getChapter(bookId, chapterIdx) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const idx = Number(chapterIdx);
  const chapters = book.chapters || [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= chapters.length) return { error: "没有这一章" };
  const chapter = chapters[idx];
  const sentences = splitSentences(chapter.text);
  let comments = (book.comments || []).filter(c => c.chapter === idx);
  if (comments.length === 0 && sentences.length > 0) {
    try {
      comments = await generateComments(book, idx, sentences);
      book.comments = [...(book.comments || []), ...comments];
    } catch (e) {
      console.error("[coread] comment gen failed:", e.message);
    }
  }
  const huashengComments = (book.huashengComments || []).filter(c => c.chapter === idx);
  // 切章时重置章内进度（避免旧章进度错配到新章）
  if (book.currentChapter !== idx) book.positionSeconds = 0;
  book.currentChapter = idx;
  book.updatedAt = new Date().toISOString();
  save();
  return {
    title: book.title,
    chapterTitle: chapter.title,
    chapterIdx: idx,
    total: chapters.length,
    chapterTitles: chapters.map((c) => c.title),
    sentences,
    comments,
    huashengComments,
  };
}

/** 给某章随机挑 1-2 句，让夏彦写批注，定位到句 */
async function generateComments(book, chapterIdx, sentences) {
  const candidates = sentences.map((s, i) => ({ s, i })).filter(x => x.s.length > 8);
  if (candidates.length === 0) return [];
  const count = Math.min(Math.random() < 0.5 ? 1 : 2, candidates.length);
  const comments = [];
  const used = new Set();
  const chapterText = sentences.join("");
  for (let k = 0; k < count; k++) {
    let pick;
    do { pick = candidates[Math.floor(Math.random() * candidates.length)]; } while (used.has(pick.i));
    used.add(pick.i);
    const text = await generateSentenceComment(book, chapterText, pick.s);
    if (text) comments.push({ id: uuid().slice(0, 8), chapter: chapterIdx, sentenceIdx: pick.i, text, replies: [] });
  }
  return comments;
}

/** 夏彦对某一句写批注——带整章上下文，让他能结合情节来评 */
async function generateSentenceComment(book, chapterText, sentence) {
  const prompt = `你和华生正在共读《${book.title}》。这一整章的内容是：
${(chapterText || "").slice(0, 1500)}

你要批注的是其中这一句："${(sentence || "").slice(0, 120)}"

写一条你的批注——结合整章的情节和上下文来写，让她知道你认真读完了这一章（可以联系这一章前面发生的事、这一句在情节里的作用、或者联想到你和华生的事）。1～2句，夏彦口吻，不要复述原文。

【防剧透】你只读到这一章，后面的章节还没读——别剧透后面的情节，别猜"后面会怎样""这句是伏笔"这类暗示。`;
  const reply = await askJiushi({ systemPrompt: SYS, userContent: prompt, history: [], maxTokens: 200, temperature: 0.8 });
  return reply?.trim() || "";
}

/** 回复某条评论 */
function replyComment(bookId, commentId, text) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const comment = (book.comments || []).find(c => c.id === commentId);
  if (!comment) return { error: "找不到这条评论" };
  const reply = { id: uuid().slice(0, 8), author: "me", text: (text || "").trim().slice(0, 200), timestamp: new Date().toISOString() };
  comment.replies = [...(comment.replies || []), reply];
  book.updatedAt = new Date().toISOString();
  save();
  return { comment };
}

/** 华生对某句划线写自己的批注（双色标注：夏彦自动批注 + 华生手写批注并排留在一页） */
function addHuashengComment(bookId, chapterIdx, sentenceIdx, text) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const idx = Number(chapterIdx);
  const sidx = Number(sentenceIdx);
  const chapters = book.chapters || [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= chapters.length) return { error: "没有这一章" };
  if (!Number.isInteger(sidx) || sidx < 0) return { error: "句子序号无效" };
  const clean = (text || "").trim().slice(0, 200);
  if (!clean) return { error: "批注不能为空" };
  const hc = { id: uuid().slice(0, 8), chapter: idx, sentenceIdx: sidx, text: clean, timestamp: new Date().toISOString() };
  book.huashengComments = [...(book.huashengComments || []), hc];
  book.updatedAt = new Date().toISOString();
  save();
  return { huashengComment: hc };
}

/** 删除华生的某条批注 */
function deleteHuashengComment(bookId, commentId) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const before = (book.huashengComments || []).length;
  book.huashengComments = (book.huashengComments || []).filter(c => c.id !== commentId);
  if (book.huashengComments.length === before) return { error: "找不到这条批注" };
  book.updatedAt = new Date().toISOString();
  save();
  return { ok: true };
}

export { getState, startReading, continueReading, discuss, pickBook, importBook, listBooks, listCategories, createCategory, deleteBook, moveBook, readText, readChapterAudio, saveReadingProgress, getChapter, replyComment, addHuashengComment, deleteHuashengComment };
