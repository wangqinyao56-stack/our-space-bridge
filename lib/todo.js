/**
 * Shared todo list for our-space bridge.
 * Both user and 夏彦 can add/complete todos.
 * 夏彦 autonomously completes some todos and reminds in chat.
 */

import { v4 as uuid } from "uuid";

let todos = [];
let autoCompleteTimer = null;

function getTodos() {
  return [...todos];
}

function addTodo(text, addedBy = "me") {
  const todo = {
    id: uuid().slice(0, 8),
    text: text.trim(),
    addedBy,
    status: "pending",
    createdAt: Date.now(),
    doneAt: null,
  };
  todos.push(todo);
  return todo;
}

function doneTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) {
    todo.status = "done";
    todo.doneAt = Date.now();
  }
  return todo || null;
}

function deleteTodo(id) {
  const idx = todos.findIndex((t) => t.id === id);
  if (idx !== -1) todos.splice(idx, 1);
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
  if (userPending.length > 0) {
    const sample = userPending.slice(0, 3).map((t) => `· ${t.text}`).join("\n");
    return `华生还有 ${userPending.length} 件待办没完成哦：\n${sample}`;
  }
  return null;
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
};
