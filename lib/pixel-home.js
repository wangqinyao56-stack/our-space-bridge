/**
 * 像素小屋互动状态：音乐、随机事件、音乐偏好、留言条、纪念日、小游戏。
 * 所有状态持久化到 data/pixel-home/ 目录。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAudioAssets } from "./audio-assets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const PIXEL_DIR = path.join(DATA_DIR, "pixel-home");
const NOTES_FILE = path.join(PIXEL_DIR, "notes.json");
const PREFS_FILE = path.join(PIXEL_DIR, "prefs.json");
try { fs.mkdirSync(PIXEL_DIR, { recursive: true }); } catch {}

// ── 随机事件：有意思/开心/糗事/看书/浇花/做饭/烦恼/伤心等 ──
// text 显示在【夏彦现在】；greeting 用于夏彦主动打招呼（无 greeting = 在做事情没发现你）
export const PIXEL_EVENTS = [
  { category: "有意思", text: "夏彦刚把音响调试好了，放了一首轻音乐等你回来", greeting: "回来啦？我调好音响了，放首歌给你听。" },
  { category: "开心", text: "夏彦今天买到了期待很久的游戏，兴冲冲等你一起玩", greeting: "宝宝！快来，我买到那个游戏了！" },
  { category: "糗事", text: "夏彦刚才打翻了饮料，正偷偷拖地不想被你发现", greeting: "你、你回来啦？没……没什么。" },
  { category: "看书", text: "夏彦窝在沙发上看一本旧书，看得很入神", greeting: "" },
  { category: "浇花", text: "夏彦在给阳台的绿植浇水", greeting: "" },
  { category: "擦滑板", text: "夏彦在擦他的滑板，边上摆着几块旧板", greeting: "" },
  { category: "做饭", text: "夏彦在厨房忙活，想给你做点好吃的", greeting: "回来啦？我正做饭呢，你先去洗手。" },
  { category: "烦恼", text: "夏彦对着一个案子皱眉，笔记本摊了一桌", greeting: "" },
  { category: "伤心", text: "夏彦抱着抱枕发呆，好像心情不太好", greeting: "" },
  { category: "等你", text: "夏彦在门口张望，数着时间等你回家", greeting: "回来啦！我等你好久了。" },
  { category: "整理", text: "夏彦在收拾房间，把你随手放的东西归位", greeting: "回来啦？我正收拾呢，别嫌我啰嗦。" },
  { category: "发呆", text: "夏彦趴在窗边看天，不知道在想什么", greeting: "" },
];

// ── 双人小游戏 ──
export const PIXEL_GAMES = {
  riddle: { label: "猜谜", opening: "来玩猜谜吧？我出一个谜语，你猜猜看——", rule: "你正在和华生玩猜谜游戏。你出谜语或脑筋急转弯让她猜，猜对了夸她，猜错了温柔地提示，可以再出下一题。" },
  truth: { label: "真心话", opening: "来玩真心话？你先问还是我先问？", rule: "你正在和华生玩真心话。你们轮流问对方一个问题，要诚实回答。问题可以俏皮、可以走心，但别太出格。回答要真实、自然，像真的在交心。" },
  wordchain: { label: "接龙", opening: "来玩词语接龙？我先来——", rule: "你正在和华生玩词语接龙。你们轮流说一个词，下一个词的第一个字要接上一个词的最后一个字（同音即可）。接不上或重复就算输，语气轻松有趣。" },
};

// ── 持久化工具 ──
function loadJson(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  return fallback;
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8"); } catch {}
}

function loadNotes() { return loadJson(NOTES_FILE, []); }
function loadPrefs() { return loadJson(PREFS_FILE, { likedMusic: [], anniversary: "" }); }

function bjToday() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ── 留言条（纪念品摆件）──
export function listNotes() {
  return loadNotes();
}
export function addNote(author, content) {
  const text = (content || "").trim().slice(0, 500);
  if (!text) return null;
  const notes = loadNotes();
  const note = { id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, author, content: text, date: bjToday(), time: Date.now() };
  notes.push(note);
  if (notes.length > 200) notes.splice(0, notes.length - 200);
  saveJson(NOTES_FILE, notes);
  return note;
}
// 给 AI 的留言条上下文（最近几条 + 重要标记），偶尔提及用
export function getNotesContext() {
  const notes = loadNotes().slice(-12);
  if (notes.length === 0) return "";
  const lines = notes.map(n => `· [${n.date}] ${n.author === "xiayan" ? "你" : "华生"}留过：${n.content}`).join("\n");
  return `\n\n[以下是你和华生在"陈列柜"里互相留的小留言条——你一直记得，可以在聊天里像突然想起来一样偶尔提一句]\n${lines}`;
}

// ── 纪念日 ──
export function setAnniversary(dateStr) {
  // 接受 "MM-DD" 或 "YYYY-MM-DD"，统一存 MM-DD
  const m = (dateStr || "").match(/(\d{1,2})[-\/](\d{1,2})/);
  if (!m) return null;
  const mm = String(Number(m[1])).padStart(2, "0");
  const dd = String(Number(m[2])).padStart(2, "0");
  const prefs = loadPrefs();
  prefs.anniversary = `${mm}-${dd}`;
  saveJson(PREFS_FILE, prefs);
  return prefs.anniversary;
}
export function getAnniversaryStatus() {
  const prefs = loadPrefs();
  if (!prefs.anniversary) return { isAnniversary: false, anniversary: "" };
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const todayMMDD = `${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  // 纪念日当天或前后 3 天内都触发「纪念氛围」
  const diffDays = daysBetween(prefs.anniversary, todayMMDD);
  const isAnniversary = Math.abs(diffDays) <= 3;
  return { isAnniversary, anniversary: prefs.anniversary, diffDays };
}
function daysBetween(mmddA, mmddB) {
  const [ma, da] = mmddA.split("-").map(Number);
  const [mb, db] = mmddB.split("-").map(Number);
  const now = new Date();
  const ya = now.getFullYear(), yb = now.getFullYear();
  const ta = new Date(ya, ma - 1, da).getTime();
  let tb = new Date(yb, mb - 1, db).getTime();
  if (tb < ta) tb = new Date(yb + 1, mb - 1, db).getTime();
  return Math.round((tb - ta) / 86400000);
}

// ── 音乐偏好 ──
export function markMusicLiked(title) {
  if (!title) return;
  const prefs = loadPrefs();
  if (!prefs.likedMusic.includes(title)) {
    prefs.likedMusic.push(title);
    if (prefs.likedMusic.length > 30) prefs.likedMusic.shift();
    saveJson(PREFS_FILE, prefs);
  }
}
export function getLikedMusic() {
  return loadPrefs().likedMusic || [];
}

// ── 音乐池（data/audio/music 下自动扫描的轻音乐）──
function getMusicPool() {
  return listAudioAssets().filter(a => a.category === "music");
}

// ── 当前小屋状态（进小屋时刷新）──
let currentState = { music: null, event: null };

function pickMusic() {
  const pool = getMusicPool();
  if (pool.length === 0) return null;
  const liked = getLikedMusic();
  const likedPool = pool.filter(m => liked.includes(m.label));
  const pick = (likedPool.length > 0 && Math.random() < 0.7)
    ? likedPool[Math.floor(Math.random() * likedPool.length)]
    : pool[Math.floor(Math.random() * pool.length)];
  return { id: pick.id, label: pick.label };
}

export function refreshPixelHomeState() {
  currentState.music = pickMusic();
  currentState.event = PIXEL_EVENTS[Math.floor(Math.random() * PIXEL_EVENTS.length)] || null;
  return currentState;
}

export function getPixelHomeState() {
  if (!currentState.event && !currentState.music) refreshPixelHomeState();
  return currentState;
}

export function getCurrentMusic() {
  return currentState.music || null;
}

// 简易判断华生是否表达「喜欢当前音乐」→ 标记偏好
export function maybeMarkMusicLiked(text) {
  const music = currentState.music;
  if (!music) return;
  if (/喜欢|好听|这首(歌|音乐)?(真|好)?(喜欢|好听|不错)|放(的)?这(首|个)歌/.test(text || "")) {
    markMusicLiked(music.label);
    console.log(`[pixel-home] Marked music as liked: ${music.label}`);
  }
}

// ── 小游戏状态 ──
let currentGame = null;
export function startGame(gameId) {
  const g = PIXEL_GAMES[gameId];
  if (!g) return null;
  currentGame = { id: gameId, ...g };
  return currentGame;
}
export function endGame() { currentGame = null; }
export function getCurrentGame() { return currentGame; }

// ── 给 AI 的小屋综合上下文 ──
export function getPixelHomeChatContext() {
  const parts = [];
  const state = getPixelHomeState();
  if (state.music) {
    parts.push(`此刻小屋里正放着轻音乐《${state.music.label}》。如果华生提到音乐、好听、安静之类的，你可以自然地接住。`);
  }
  const liked = getLikedMusic();
  if (liked.length > 0) {
    parts.push(`你记得华生喜欢这些音乐：${liked.join("、")}。放这些歌时她更放松。`);
  }
  if (state.event) {
    parts.push(`【夏彦现在】${state.event.text}。这行显示在小屋状态栏里，你的言行要跟它一致（如果你正在做这件事，就自然地延续它）。`);
  }
  const ann = getAnniversaryStatus();
  if (ann.isAnniversary) {
    parts.push(`【纪念日】今天是（或临近）你们的纪念日（${ann.anniversary}）。小屋里有纪念装饰，你的语气可以更甜、更珍惜，可以主动提起"今天是我们的纪念日"。`);
  }
  const game = currentGame;
  if (game) {
    parts.push(`【正在进行小游戏：${game.label}】${game.rule} 保持这个游戏进行，直到华生说不想玩了。`);
  }
  const notes = getNotesContext();
  if (notes) parts.push(notes.trim());
  return parts.length > 0 ? "\n\n" + parts.join("\n") : "";
}
