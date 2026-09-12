/**
 * 阅读 (reading) —— 纯文字阅读器书库
 * 独立于共读 (coread)：只做翻页阅读，书架、分类、章节、进度。
 * 不生成夏彦批注、不做朗读、不调 AI。
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";

const DATA_DIR = process.env.DATA_DIR || ".";
const READING_FILE = path.join(DATA_DIR, "reading.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let state = { books: [], categories: [] };

try {
  if (fs.existsSync(READING_FILE)) {
    const raw = JSON.parse(fs.readFileSync(READING_FILE, "utf-8"));
    state = { ...state, ...raw };
    if (!Array.isArray(state.books)) state.books = [];
    if (!Array.isArray(state.categories)) state.categories = [];
  }
} catch { /* keep default */ }

function save() {
  try { fs.writeFileSync(READING_FILE, JSON.stringify(state, null, 2), "utf-8"); } catch {}
}

// ── 切分：兼容三种章节标题格式 ──
const CHAPTER_TITLE_RE = /^第[0-9一二三四五六七八九十百千零]+[章回卷节话夜场局关篇]/; // 第一章 / 第01章
const NUM_PIPE_RE = /^[0-9]{2,4}\s*[｜|]\s*\S/;  // 013｜标题
const NUM_SPACE_RE = /^[0-9]{3,4}\s+\S/;          // 0007 标题

function isTitle(line) {
  const t = line.trim();
  if (!t) return false;
  return CHAPTER_TITLE_RE.test(t) || NUM_PIPE_RE.test(t) || NUM_SPACE_RE.test(t);
}

function splitChapters(text) {
  const cleaned = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n");
  const chapters = [];
  let curTitle = "";
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) chapters.push({ title: curTitle || `第 ${chapters.length + 1} 章`, text: body });
    buf = [];
  };
  for (const line of lines) {
    if (isTitle(line)) {
      flush();
      curTitle = line.trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return chapters;
}

// 按段落约 size 字切段（兜底：无章节标题的文件）
function splitBySize(text, size = 500) {
  const cleaned = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const p of paragraphs) {
    if (p.length > size) {
      if (buf) { chunks.push(buf); buf = ""; }
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
    } else if (buf && buf.length + p.length > size) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n" + p : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.map((t, i) => ({ title: `第 ${i + 1} 节`, text: t }));
}

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

// ── 书库操作 ──
function listBooks() {
  return state.books.map((b) => ({
    id: b.id,
    title: b.title,
    total: (b.chapters || []).length,
    chapter: b.currentChapter || 0,
    category: b.category || "",
  }));
}

function listCategories() { return state.categories; }

function createCategory(name) {
  const n = (name || "").trim();
  if (!n) return { error: "分类名不能为空" };
  if (state.categories.includes(n)) return { error: "这个分类已经存在" };
  state.categories.push(n);
  save();
  return { categories: state.categories };
}

function moveBook(bookId, category) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  book.category = (category || "").trim();
  save();
  return { books: listBooks() };
}

function deleteBook(bookId) {
  const idx = state.books.findIndex((b) => b.id === bookId);
  if (idx < 0) return { error: "找不到这本书" };
  state.books.splice(idx, 1);
  save();
  return { books: listBooks() };
}

function importBook(title, text) {
  let chapters = splitChapters(text);
  if (chapters.length === 0) chapters = splitBySize(text);
  if (chapters.length === 0) return { error: "文件内容为空" };

  const titleTrim = (title || "").trim() || "未命名";
  const existingIdx = state.books.findIndex((b) => b.title === titleTrim);
  const bookEntry = {
    id: existingIdx >= 0 ? state.books[existingIdx].id : uuid().slice(0, 8),
    title: titleTrim,
    category: existingIdx >= 0 ? (state.books[existingIdx].category || "") : "",
    chapters,
    currentChapter: existingIdx >= 0 ? (state.books[existingIdx].currentChapter || 0) : 0,
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) state.books[existingIdx] = bookEntry;
  else state.books.push(bookEntry);
  save();
  return { totalChapters: chapters.length };
}

function getChapter(bookId, chapterIdx) {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) return { error: "找不到这本书" };
  const idx = Number(chapterIdx);
  const chapters = book.chapters || [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= chapters.length) return { error: "没有这一章" };
  const chapter = chapters[idx];
  book.currentChapter = idx;
  save();
  return {
    title: book.title,
    chapterTitle: chapter.title,
    chapterIdx: idx,
    total: chapters.length,
    chapterTitles: chapters.map((c) => c.title),
    sentences: splitSentences(chapter.text),
  };
}

export { listBooks, listCategories, createCategory, moveBook, deleteBook, importBook, getChapter };
