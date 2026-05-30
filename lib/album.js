/**
 * Photo album for our-space bridge.
 * Chat images auto-saved, both can comment.
 */

import fs from "node:fs";
import path from "node:path";
import { askClaude } from "./ai.js";
import { getSystemPrompt } from "./message-router.js";

const ALBUM_DIR = process.env.ALBUM_DIR || "./album";
const DATA_FILE = path.join(ALBUM_DIR, "photos.json");

function ensureDir() {
  if (!fs.existsSync(ALBUM_DIR)) fs.mkdirSync(ALBUM_DIR, { recursive: true });
}

function loadPhotos() {
  ensureDir();
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {}
  return [];
}

function savePhotos(photos) {
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(photos, null, 2), "utf-8");
}

function genId() {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function nowStr() {
  return new Date().toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

export function addPhoto(base64, mime = "image/jpeg", addedBy = "me") {
  const id = genId();
  const ext = mime.includes("png") ? "png" : "jpg";
  const filename = `${id}.${ext}`;
  const filepath = path.join(ALBUM_DIR, filename);

  // Save base64 to file
  const buf = Buffer.from(base64, "base64");
  ensureDir();
  fs.writeFileSync(filepath, buf);

  const photo = {
    id,
    filename,
    mime,
    addedBy,
    addedAt: nowStr(),
    comments: [],
  };

  const photos = loadPhotos();
  photos.push(photo);
  savePhotos(photos);

  // Auto-generate 夏彦's comment asynchronously
  generateXiaYanComment(photo).catch(() => {});

  return photo;
}

async function generateXiaYanComment(photo) {
  const prompt = getSystemPrompt();
  const reply = await askClaude({
    systemPrompt: prompt,
    userContent: `华生发了一张图片。请以夏彦的口吻对这张图片说点什么——可以是你的感受、对图片内容的感想、或者记录下这一刻的心情。简短自然，一两句话就好。`,
    history: [],
    maxTokens: 150,
  });

  if (reply) {
    const photos = loadPhotos();
    const p = photos.find((p) => p.id === photo.id);
    if (p) {
      p.comments.push({ author: "xiayan", content: reply.trim(), time: nowStr() });
      savePhotos(photos);
    }
    return reply;
  }
  return null;
}

export function getPhotos() {
  return loadPhotos();
}

export function getPhoto(id) {
  return loadPhotos().find((p) => p.id === id) || null;
}

export function getPhotoFile(id) {
  const photo = getPhoto(id);
  if (!photo) return null;
  const fp = path.join(ALBUM_DIR, photo.filename);
  if (fs.existsSync(fp)) return { path: fp, mime: photo.mime };
  return null;
}

export function addComment(photoId, author, content) {
  const photos = loadPhotos();
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return null;

  // Read base64 from file for response
  const fp = path.join(ALBUM_DIR, photo.filename);
  let imageBase64 = "";
  if (fs.existsSync(fp)) {
    imageBase64 = fs.readFileSync(fp).toString("base64");
  }

  photo.comments.push({ author, content, time: nowStr() });
  savePhotos(photos);
  return { photo, imageBase64 };
}

export function deletePhoto(id) {
  const photos = loadPhotos();
  const idx = photos.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  const photo = photos[idx];
  try { fs.unlinkSync(path.join(ALBUM_DIR, photo.filename)); } catch {}
  photos.splice(idx, 1);
  savePhotos(photos);
  return true;
}
