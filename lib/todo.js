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
    _lastDoneNotification = `华生刚刚完成了待办：「${text}」。你可以在聊天里夸夸她或提一句。`;
  }
}

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
};
