/**
 * Inspiration notes for our-space bridge.
 * User creates drawing inspiration notes with status tracking.
 * 夏彦 can comment on notes but CANNOT create new ones.
 * Three statuses: pending (未完成) → in_progress (正在进行中) → completed (已完成)
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";

const DATA_DIR = process.env.DATA_DIR || ".";
const INSPIRATION_FILE = path.join(DATA_DIR, "inspiration.json");

let notes = [];

try {
  if (fs.existsSync(INSPIRATION_FILE)) {
    notes = JSON.parse(fs.readFileSync(INSPIRATION_FILE, "utf-8"));
    if (!Array.isArray(notes)) notes = [];
    console.log(`[inspiration] Loaded ${notes.length} notes from disk`);
  }
} catch { notes = []; }

function save() {
  try { fs.writeFileSync(INSPIRATION_FILE, JSON.stringify(notes, null, 2), "utf-8"); } catch {}
}

function getAll() {
  return [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function create(text) {
  const note = {
    id: uuid().slice(0, 8),
    text: text.trim(),
    status: "pending",
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  notes.push(note);
  save();
  return note;
}

function updateStatus(id, status) {
  const valid = ["pending", "in_progress", "completed"];
  if (!valid.includes(status)) return null;

  const note = notes.find((n) => n.id === id);
  if (!note) return null;

  note.status = status;
  note.updatedAt = new Date().toISOString();
  save();
  return note;
}

function updateText(id, text) {
  const note = notes.find((n) => n.id === id);
  if (!note) return null;

  note.text = text.trim();
  note.updatedAt = new Date().toISOString();
  save();
  return note;
}

function remove(id) {
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notes.splice(idx, 1);
  save();
  return true;
}

function addComment(id, author, text) {
  const note = notes.find((n) => n.id === id);
  if (!note) return null;

  const comment = {
    id: uuid().slice(0, 8),
    author, // "me" | "xiayan"
    text: text.trim(),
    timestamp: new Date().toISOString(),
  };
  note.comments.push(comment);
  note.updatedAt = new Date().toISOString();
  save();
  return comment;
}

function get(id) {
  return notes.find((n) => n.id === id) || null;
}

export { getAll, create, updateStatus, updateText, remove, addComment, get };
