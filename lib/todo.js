/**
 * Shared todo list for our-space bridge.
 * Both user and 夏彦 can add/complete todos.
 * 夏彦 autonomously completes some todos and reminds in chat.
 * File-persisted via DATA_DIR.
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";

const DATA_DIR = process.env.DATA_DIR || ".";
const TODOS_FILE = path.join(DATA_DIR, "todos.json");

let todos = [];
let autoCompleteTimer = null;

// 启动时从磁盘恢复
try {
  if (fs.existsSync(TODOS_FILE)) {
    todos = JSON.parse(fs.readFileSync(TODOS_FILE, "utf-8"));
    console.log(`[todo] Loaded ${todos.length} todos from disk`);
  }
} catch {}

function save() {
  try { fs.writeFileSync(TODOS_FILE, JSON.stringify(todos), "utf-8"); } catch {}
}

function getTodos() {
  return [...todos];
}

function addTodo(text, addedBy = "me", deadline = "") {
  const todo = {
    id: uuid().slice(0, 8),
    text: text.trim(),
    addedBy,
    status: "pending",
    deadline: deadline || "", // "today" | "week" | "longterm" | ""
    createdAt: Date.now(),
    doneAt: null,
  };
  todos.push(todo);
  save();
  return todo;
}

function doneTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) {
    todo.status = "done";
    todo.doneAt = Date.now();
    save();
  }
  return todo || null;
}

function deleteTodo(id) {
  const idx = todos.findIndex((t) => t.id === id);
  if (idx !== -1) {
    todos.splice(idx, 1);
    save();
  }
}

function getPendingByUser(addedBy) {
  return todos.filter((t) => t.status === "pending" && t.addedBy === addedBy);
}

function getAllPending() {
  return todos.filter((t) => t.status === "pending");
}

function autoCompleteRandom() {
  const pendingXiayan = todos.filter(
    (t) => t.status === "pending" && t.addedBy === "xiayan"
  );
  if (pendingXiayan.length === 0) return null;
  const todo = pendingXiayan[Math.floor(Math.random() * pendingXiayan.length)];
  todo.status = "done";
  todo.doneAt = Date.now();
  save();
  return todo;
}

function startAutoComplete(intervalMs = 60 * 60 * 1000) {
  if (autoCompleteTimer) clearInterval(autoCompleteTimer);
  autoCompleteTimer = setInterval(autoCompleteRandom, intervalMs);
}
startAutoComplete();

function getChatReminder() {
  const pending = getAllPending();
  if (pending.length === 0) return null;

  const userPending = pending.filter((t) => t.addedBy === "me");
  const lines = [];

  // 今天到期的
  const today = userPending.filter((t) => t.deadline === "today");
  if (today.length > 0) {
    const sample = today.map((t) => `· ${t.text}`).join("\n");
    lines.push(`⚠️ 今天待完成：\n${sample}`);
  }

  // 本周到期的（除今天外）
  const thisWeek = userPending.filter((t) => t.deadline === "week" && t.deadline !== "today");
  if (thisWeek.length > 0) {
    const sample = thisWeek.map((t) => `· ${t.text}`).join("\n");
    lines.push(`📋 本周待办：\n${sample}`);
  }

  // 长期 + 无期限的（展示剩余）
  const other = userPending.filter((t) => !t.deadline || t.deadline === "longterm");
  if (other.length > 0 && !lines.length) {
    const sample = other.slice(0, 3).map((t) => `· ${t.text}`).join("\n");
    lines.push(`华生还有 ${other.length} 件待办哦：\n${sample}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// 完成通知：告诉夏彦华生刚完成了什么
let _lastDoneNotification = null;
function getDoneNotification() {
  if (_lastDoneNotification) {
    const n = _lastDoneNotification;
    _lastDoneNotification = null;
    return n;
  }
  return null;
}
function notifyDone(text, by) {
  if (by === "me") {
    _lastDoneNotification = `华生刚刚完成了待办：「${text}」——一定要先夸她！然后再聊别的。这是优先级最高的。`;
  }
}

// ── 夏彦自动生成待办 ──

// Pool of todo templates. Ones tagged `together: true` involve 华生.
const TODO_POOL = [
  // 家居
  { text: "选购新的沙发套", category: "家居", together: false },
  { text: "换季整理衣柜", category: "家居", together: false },
  { text: "给阳台植物浇水施肥", category: "家居", together: false },
  { text: "清理冰箱过期食品", category: "家居", together: false },
  { text: "整理书架，把看完的书收起来", category: "家居", together: false },
  { text: "换个新的香薰蜡烛", category: "家居", together: true },
  { text: "重新布置客厅的小角落", category: "家居", together: true },
  { text: "买一束鲜花放在餐桌上", category: "家居", together: true },
  { text: "订购新的泡澡球和浴盐", category: "家居", together: true },
  { text: "给家里挑选新的窗帘", category: "家居", together: true },
  { text: "买几盆多肉放在窗台上", category: "家居", together: true },

  // 宠物
  { text: "给花生洗澡", category: "宠物", together: false },
  { text: "给花生修剪羽毛", category: "宠物", together: false },
  { text: "给花生买新的鸟食", category: "宠物", together: false },
  { text: "清理花生的鸟笼", category: "宠物", together: false },
  { text: "教花生说一个新词", category: "宠物", together: true },
  { text: "给花生买几个新玩具", category: "宠物", together: true },

  // 个人护理
  { text: "修剪头发", category: "个人", together: false },
  { text: "整理洗漱台", category: "个人", together: false },
  { text: "购买新的洗发水", category: "个人", together: false },
  { text: "换一把新牙刷", category: "个人", together: false },
  { text: "整理护肤品收纳盒", category: "个人", together: true },

  // 与华生
  { text: "和华生一起打游戏", category: "约会", together: true },
  { text: "和华生一起看电影", category: "约会", together: true },
  { text: "带华生去新开的甜品店", category: "约会", together: true },
  { text: "和华生周末去公园散步", category: "约会", together: true },
  { text: "和华生一起做一顿饭", category: "约会", together: true },
  { text: "和华生一起整理相册", category: "约会", together: true },
  { text: "给华生挑一份小礼物", category: "约会", together: true },
  { text: "和华生一起去逛超市", category: "约会", together: true },
  { text: "和华生去试那家新开的火锅店", category: "约会", together: true },
  { text: "和华生一起拼乐高", category: "约会", together: true },
  { text: "和华生一起去图书馆", category: "约会", together: true },
  { text: "给华生做她爱吃的布丁", category: "约会", together: true },
  { text: "和华生一起去夜市", category: "约会", together: true },

  // 日常
  { text: "把快递取了", category: "日常", together: false },
  { text: "整理鞋柜", category: "日常", together: false },
  { text: "检查家里的药箱，补充常用药", category: "日常", together: false },
  { text: "提前订好周末的电影票", category: "日常", together: true },
  { text: "研究一下新的菜谱", category: "日常", together: true },
  { text: "整理电脑桌面和文件", category: "日常", together: false },
  { text: "备份手机照片", category: "日常", together: false },
  { text: "清理手机不必要的app", category: "日常", together: false },
];

// Track which were already used (avoid repeats in short term)
let usedTemplates = [];
let autoGenTimer = null;
let _newMentionTodo = null; // stores the latest "together" todo for chat

function pickRandomTodo() {
  // Filter unused or reset when most are used
  const available = TODO_POOL.filter(t => !usedTemplates.includes(t.text));
  const pool = available.length > 5 ? available : (() => { usedTemplates = []; return TODO_POOL; })();
  const pick = pool[Math.floor(Math.random() * pool.length)];
  usedTemplates.push(pick.text);
  if (usedTemplates.length > 40) usedTemplates = usedTemplates.slice(-20);
  return pick;
}

function autoGenerateTodo() {
  // Don't generate too many — keep max 8 夏彦's pending todos
  const xiayanPending = todos.filter(t => t.status === "pending" && t.addedBy === "xiayan");
  if (xiayanPending.length >= 8) return null;

  const template = pickRandomTodo();
  const todo = addTodo(template.text, "xiayan");

  // If it's a "together" todo, queue for chat mention
  if (template.together) {
    _newMentionTodo = template.text;
  }

  console.log(`[todo] Auto-generated: ${template.text} (${template.category})`);
  return todo;
}

function getNewMentionTodo() {
  if (_newMentionTodo) {
    const t = _newMentionTodo;
    _newMentionTodo = null;
    return t;
  }
  return null;
}

function startAutoGenerate(intervalMs = 90 * 60 * 1000) {
  if (autoGenTimer) clearInterval(autoGenTimer);
  // Pick a random offset so it's not always at the same time
  const initialDelay = 30 * 60 * 1000 + Math.random() * 60 * 60 * 1000;
  autoGenTimer = setTimeout(() => {
    autoGenerateTodo();
    // Then continue at regular intervals
    autoGenTimer = setInterval(autoGenerateTodo, intervalMs);
  }, initialDelay);
}
startAutoGenerate();

export {
  getTodos,
  addTodo,
  doneTodo,
  deleteTodo,
  getPendingByUser,
  getAllPending,
  autoCompleteRandom,
  getChatReminder,
  getDoneNotification,
  notifyDone,
  getNewMentionTodo,
};
