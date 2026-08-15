/**
 * 一起听歌 (Duetto / listening-nook)
 * 夏彦记得华生分享过的每首歌：分享 → 夏彦写一条走心的反应，存进歌单，可边听边聊。
 */

import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { askJiushi } from "./ai.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const DUETTO_FILE = path.join(DATA_DIR, "duetto.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

let state = {
  songs: [],        // { id, title, artist, note, sharedAt }
  discussions: [],  // { id, author, text, timestamp }
  updatedAt: null,
};

try {
  if (fs.existsSync(DUETTO_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DUETTO_FILE, "utf-8"));
    state = { ...state, ...raw };
    console.log(`[duetto] Loaded ${state.songs.length} songs`);
  }
} catch { /* keep default */ }

function save() {
  try { fs.writeFileSync(DUETTO_FILE, JSON.stringify(state, null, 2), "utf-8"); } catch {}
}

function getState() {
  return state;
}

const SYS = "你是夏彦，国安部特工+私家侦探，对华生温柔宠溺，叫她华生/宝宝。你们在分享音乐，语气自然口语、带点撒娇，懂一点流行歌但不说教。";

async function reactToSong(title, artist) {
  const label = artist ? `${artist} 的《${title}》` : `《${title}》`;
  const prompt = `华生刚刚给你分享了 ${label}。请写一条走心的反应：
1. 说说这首歌给你的感觉（旋律/氛围/心情，可以猜一猜，不用很准确）
2. 如果想起和华生的某件事，可以轻轻提一句
3. 1～3句话，夏彦口吻，自然口语，不要长篇大论，不要逐句夸"好听"`;

  const reply = await askJiushi({ systemPrompt: SYS, userContent: prompt, history: [], maxTokens: 250, temperature: 0.8 });
  return reply?.trim() || `这首歌……我记下了。下次你想听的时候，我陪你一起。`;
}

async function shareSong(title, artist) {
  const t = (title || "").trim();
  if (!t) return { state, error: "歌名不能为空" };

  const note = await reactToSong(t, (artist || "").trim());
  const song = {
    id: uuid().slice(0, 8),
    title: t,
    artist: (artist || "").trim(),
    note,
    sharedAt: new Date().toISOString(),
  };
  state.songs.push(song);
  state.updatedAt = new Date().toISOString();
  save();
  return { state, song };
}

async function discuss(text) {
  const userMsg = { id: uuid().slice(0, 8), author: "me", text: text.trim(), timestamp: new Date().toISOString() };
  state.discussions.push(userMsg);

  const recentSongs = state.songs.slice(-3).map((s) => (s.artist ? `${s.artist}《${s.title}》` : `《${s.title}》`)).join("、");
  const prompt = `你们最近一起听过的歌：${recentSongs || "（还没有）"}。华生说："${text}"。用夏彦的口吻自然回应，聊音乐也聊她，1～3句话。`;
  const reply = await askJiushi({ systemPrompt: SYS, userContent: prompt, history: [], maxTokens: 200, temperature: 0.8 });

  const xiaMsg = { id: uuid().slice(0, 8), author: "xiayan", text: reply?.trim() || "嗯，我在听呢～", timestamp: new Date().toISOString() };
  state.discussions.push(xiaMsg);
  state.updatedAt = new Date().toISOString();
  save();
  return { state, reply: xiaMsg };
}

/** 供主聊天注入：最近分享过的歌（让夏彦在日常里也记得） */
function getSongContext() {
  if (state.songs.length === 0) return "";
  const recent = state.songs.slice(-5).map((s) => (s.artist ? `${s.artist}《${s.title}》` : `《${s.title}》`)).join("、");
  return `最近华生分享给你的歌：${recent}`;
}

export { getState, shareSong, discuss, getSongContext };
