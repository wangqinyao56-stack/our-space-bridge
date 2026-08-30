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
const STATE_FILE = path.join(PIXEL_DIR, "state.json");
try { fs.mkdirSync(PIXEL_DIR, { recursive: true }); } catch {}

// ── 房间 id 顺序（与客户端 ROOM_SCENES 索引一致）──
export const ROOM_IDS = ["bedroom", "living", "bath", "game", "studio", "artroom"];
export const ROOM_NAMES = { bedroom: "卧室", living: "客厅", bath: "浴室", game: "游戏厅", studio: "工作室", artroom: "绘画间" };

// ── 随机事件：按房间分组，busy 为忙碌时长（分钟区间），visits 为忙碌途中主动探望次数区间 ──
// text 显示在【夏彦现在】；greeting 用于夏彦主动打招呼（无 greeting = 在做事情没发现你）
export const PIXEL_EVENTS = {
  bedroom: [
    { text: "夏彦在整理衣柜，把换季的衣服翻出来", greeting: "", busy: [8, 15], visits: [1, 2] },
    { text: "夏彦在铺床叠被，把被角掖得整整齐齐", greeting: "回来啦？我正铺床呢，晚上睡得舒服点。", busy: [5, 8], visits: [1, 1] },
    { text: "夏彦窝在床上看一本旧书，看得很入神", greeting: "", busy: [10, 20], visits: [1, 2] },
  ],
  living: [
    { text: "夏彦在洗他的滑板，边上摆着几块旧板", greeting: "", busy: [20, 30], visits: [2, 3] },
    { text: "夏彦在厨房忙活，想给你做点好吃的", greeting: "回来啦？我正做饭呢，你先去洗手。", busy: [15, 25], visits: [1, 2] },
    { text: "夏彦在给阳台的绿植浇水", greeting: "", busy: [6, 10], visits: [1, 1] },
    { text: "夏彦在找一样东西，翻箱倒柜的", greeting: "", busy: [5, 6], visits: [1, 1] },
  ],
  bath: [
    { text: "夏彦在洗衣服，水声哗哗的", greeting: "", busy: [10, 15], visits: [1, 1] },
    { text: "夏彦在收拾洗漱用品，把毛巾叠好", greeting: "", busy: [5, 8], visits: [1, 1] },
  ],
  game: [
    { text: "夏彦在整理游戏卡带，一张张码整齐", greeting: "", busy: [8, 12], visits: [1, 1] },
    { text: "夏彦在调试游戏机，测试新手柄", greeting: "回来啦？我调好游戏机了，一会儿一起玩。", busy: [10, 20], visits: [1, 2] },
  ],
  studio: [
    { text: "夏彦对着一个案子皱眉，笔记本摊了一桌", greeting: "", busy: [30, 60], visits: [2, 4] },
    { text: "夏彦在手工台上做小手工，零件摆得整整齐齐", greeting: "", busy: [15, 30], visits: [1, 2] },
    { text: "夏彦在写案件笔记，写得很投入", greeting: "", busy: [20, 40], visits: [1, 3] },
  ],
  artroom: [
    { text: "夏彦在帮你整理颜料和画具", greeting: "", busy: [5, 8], visits: [1, 1] },
    { text: "夏彦站在画架前看你上次的画，看得很认真", greeting: "", busy: [10, 15], visits: [1, 2] },
  ],
};

// 忙碌途中主动探望华生时说的话（line=聊天话术，status=状态栏动作描述）
const VISIT_LINES = [
  { line: "（给你续了杯热茶，轻轻放在桌边，没说话）", status: "夏彦在你桌边放了杯热茶" },
  { line: "（把切好的水果放在你手边，又安静地回去忙）", status: "夏彦在你手边放了碗切好的水果" },
  { line: "（走过来亲了你一下，又回去忙了）", status: "夏彦走过来，亲了你一下" },
  { line: "（从背后轻轻抱了你一下，然后松开）", status: "夏彦走过来，抱了抱你" },
  { line: "（过来看了你一眼，没出声，接着忙去了）", status: "夏彦过来看了看你" },
];

// 忙完过来找华生时说的话（默默过来陪，别咋呼着打招呼）
const DONE_LINES = [
  { line: "（忙完了，走到你身边坐下）", status: "夏彦忙完了，走到你身边坐下" },
  { line: "（事儿弄完了，安静地坐到你旁边）", status: "夏彦忙完了，坐到你身边陪你" },
  { line: "（搞定了，凑过来挨着你）", status: "夏彦走过来，亲了你一下" },
];

// 忙完后留在华生身边陪伴时的状态栏（不再提刚才那件事——擦完就是擦完，别重复）
const DONE_EVENT = { text: "夏彦陪在你身边", greeting: "", busy: [0, 0], visits: [0, 0] };

// 夏彦决定自己去忙（去别的房间做新的事）时说的话
const GO_BUSY_LINES = [
  "我去忙点别的，有事就喊我。",
  "先去忙会儿，待会儿再过来陪你。",
  "去那边忙一下，你乖乖的。",
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

// ── 音乐池（只保留用户上传的新音乐 m4a，排除旧未定 OST mp3）──
function getMusicPool() {
  return listAudioAssets().filter(a => a.category === "music" && a.mime === "audio/mp4");
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

// ── 会话状态机（单用户小屋）：夏彦在哪个房间忙、华生在哪个房间、何时忙完、何时中途探望 ──
let session = null;
let emitter = null;

export function setPixelHomeEmitter(fn) { emitter = fn; }
function emit(obj) { if (emitter) emitter(JSON.stringify(obj)); }

function chinaHour() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
}
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function clearTimers(s) {
  if (!s) return;
  for (const k of ["done", "visit", "leave", "next"]) {
    if (s.timers[k]) clearTimeout(s.timers[k]);
  }
  s.timers = { done: null, visit: null, leave: null, next: null };
}

// 中途探望：夏彦过来看华生 → 状态栏同步探望动作 + 说句话 → 停留片刻 → 若还在忙则回去继续
function scheduleVisit(s) {
  if (!s.busy || s.visitCount <= 0) return;
  const totalMs = Math.max(1, s.busyDoneAt - Date.now());
  const intervalMs = Math.min(30 * 60 * 1000, Math.max(10 * 60 * 1000, totalMs / (s.visitCount + 1)));
  s.timers.visit = setTimeout(() => {
    if (session !== s) return;
    const busyEvent = currentState.event;
    const visit = pick(VISIT_LINES);
    s.visiting = true;
    // 状态栏同步为探望动作（倒茶/送水果/亲一口…）
    currentState.event = { text: visit.status, greeting: "", busy: [0, 0], visits: [0, 0] };
    emit({ type: "pixel_home_xiayan_move", room: s.huashengRoomIdx, event: currentState.event });
    emit({ type: "text_reply", reply_to: "", content: visit.line, proactive: true });
    s.timers.leave = setTimeout(() => {
      if (session !== s) return;
      s.visiting = false;
      s.visitCount -= 1;
      // 移回去继续忙，状态栏恢复为忙碌事件
      if (s.busy) {
        currentState.event = busyEvent;
        emit({ type: "pixel_home_xiayan_move", room: s.xiayanRoomIdx, event: busyEvent });
      }
      scheduleVisit(s);
    }, 25000);
  }, intervalMs);
}

// 华生主动说话：如果夏彦正好在探望（过来看一眼），就留下陪她，别说完就走
export function noteHuashengSpoke() {
  if (!session || !session.visiting) return;
  session.visiting = false;
  if (session.timers.leave) { clearTimeout(session.timers.leave); session.timers.leave = null; }
  if (session.timers.done) { clearTimeout(session.timers.done); session.timers.done = null; }
  session.busy = false;
  session.xiayanRoomIdx = session.huashengRoomIdx;
  currentState.event = DONE_EVENT;
  emit({ type: "pixel_home_xiayan_move", room: session.huashengRoomIdx, event: DONE_EVENT });
  saveState();
}

function scheduleDone(s) {
  s.timers.done = setTimeout(() => {
    if (session !== s) return;
    s.busy = false;
    // 忙完了：状态栏同步"走过来抱你/坐下陪你"之类的动作，不再提擦滑板之类的话
    const done = pick(DONE_LINES);
    currentState.event = { text: done.status, greeting: "", busy: [0, 0], visits: [0, 0] };
    s.xiayanRoomIdx = s.huashengRoomIdx;
    emit({ type: "pixel_home_xiayan_move", room: s.huashengRoomIdx, event: currentState.event });
    emit({ type: "text_reply", reply_to: "", content: done.line, proactive: true });
    saveState();
    scheduleNextMove(s);
  }, Math.max(0, s.busyDoneAt - Date.now()));
}

// 忙完过来陪了华生一会儿后，随机决定：继续留下，还是自己去忙（去别的房间做新的事）
function scheduleNextMove(s) {
  s.timers.next = setTimeout(() => {
    if (session !== s || s.busy) return;
    if (Math.random() < 0.5) {
      // 继续留下陪：状态栏从"走过来抱你"沉淀为"陪在你身边"
      currentState.event = DONE_EVENT;
      emit({ type: "pixel_home_xiayan_move", room: s.huashengRoomIdx, event: DONE_EVENT });
      scheduleNextMove(s);
      return;
    }
    startNewActivity(s);
  }, randInt(2, 5) * 60 * 1000);
}

// 夏彦自己去忙：挑一个跟华生当前房间不同的新事件，更新房间+状态栏+忙碌状态
function startNewActivity(s) {
  const candidates = [];
  ROOM_IDS.forEach((roomId, idx) => {
    if (idx === s.huashengRoomIdx) return;
    const events = PIXEL_EVENTS[roomId] || [];
    for (const ev of events) candidates.push({ idx, ev });
  });
  if (candidates.length === 0) return;
  const { idx, ev } = pick(candidates);
  currentState.event = ev;
  s.xiayanRoomIdx = idx;
  s.busy = true;
  const busyMin = randInt(ev.busy[0], ev.busy[1]);
  s.busyDoneAt = Date.now() + busyMin * 60 * 1000;
  s.visitCount = randInt(ev.visits[0], ev.visits[1]);
  emit({ type: "pixel_home_xiayan_move", room: idx, event: ev });
  emit({ type: "text_reply", reply_to: "", content: pick(GO_BUSY_LINES), proactive: true });
  saveState();
  scheduleVisit(s);
  scheduleDone(s);
}

// 睡觉状态（晚上夏彦睡了）
const SLEEP_EVENT = { text: "夏彦睡着了", greeting: "", busy: [0, 0], visits: [0, 0] };

function isSleepTime() {
  const h = chinaHour();
  return h >= 23 || h < 7; // 晚上23点到早上7点
}

function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch {}
  return null;
}
function saveState() {
  if (!session) return;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      xiayanRoomIdx: session.xiayanRoomIdx,
      huashengRoomIdx: session.huashengRoomIdx,
      busy: session.busy,
      busyDoneAt: session.busyDoneAt,
      visitCount: session.visitCount,
      greeted: session.greeted,
      event: currentState.event,
      music: currentState.music,
      savedAt: Date.now(),
    }, null, 2), "utf-8");
  } catch {}
}

export function refreshPixelHomeState() {
  // 睡觉时间（23点-7点）：无条件睡着，不忙、不主动
  if (isSleepTime()) {
    if (session) clearTimers(session);
    clearMusicSwitch();
    session = {
      xiayanRoomIdx: 0,
      huashengRoomIdx: 0,
      busy: false,
      busyDoneAt: 0,
      visitCount: 0,
      greeted: false,
      timers: { done: null, visit: null, leave: null, next: null },
    };
    currentState.event = SLEEP_EVENT;
    if (!currentState.music) currentState.music = pickMusic();
    saveState();
    return { ...currentState, xiayanRoom: 0, huashengRoom: 0, greeted: session.greeted, hour: chinaHour() };
  }

  // 已存在 session（中途退出再进来）：保持状态不重新随机，只返回当前快照 + 华生位置
  if (session) {
    return {
      ...currentState,
      xiayanRoom: session.xiayanRoomIdx,
      huashengRoom: session.huashengRoomIdx,
      greeted: session.greeted,
      hour: chinaHour(),
    };
  }

  // 从磁盘恢复（服务重启后状态不丢），12 小时内有效
  const saved = loadState();
  if (saved && saved.savedAt && Date.now() - saved.savedAt < 12 * 60 * 60 * 1000) {
    currentState.event = saved.event || null;
    currentState.music = saved.music || pickMusic();
    session = {
      xiayanRoomIdx: saved.xiayanRoomIdx ?? 0,
      huashengRoomIdx: saved.huashengRoomIdx ?? 0,
      busy: saved.busy ?? false,
      busyDoneAt: saved.busyDoneAt ?? 0,
      visitCount: saved.visitCount ?? 0,
      greeted: saved.greeted ?? false,
      timers: { done: null, visit: null, leave: null, next: null },
    };
    // 恢复时若仍在睡觉时间，夏彦继续睡；若睡过头了（超过12小时），走下面重新随机
    if (isSleepTime()) {
      currentState.event = SLEEP_EVENT;
      session.busy = false;
      session.xiayanRoomIdx = 0;
      session.huashengRoomIdx = 0;
      clearTimers(session);
    } else if (session.busy && session.busyDoneAt > Date.now()) {
      scheduleVisit(session);
      scheduleDone(session);
    }
    scheduleMusicSwitch();
    saveState();
    return { ...currentState, xiayanRoom: session.xiayanRoomIdx, huashengRoom: session.huashengRoomIdx, greeted: session.greeted, hour: chinaHour() };
  }

  // 睡觉时间：夏彦在卧室睡觉，不忙
  if (isSleepTime()) {
    currentState.event = SLEEP_EVENT;
    currentState.music = pickMusic();
    session = {
      xiayanRoomIdx: 0,
      huashengRoomIdx: 0,
      busy: false,
      busyDoneAt: 0,
      visitCount: 0,
      greeted: false,
      timers: { done: null, visit: null, leave: null, next: null },
    };
    saveState();
    scheduleMusicSwitch();
    return { ...currentState, xiayanRoom: 0, huashengRoom: 0, greeted: session.greeted, hour: chinaHour() };
  }

  const roomIdx = Math.floor(Math.random() * ROOM_IDS.length);
  const events = PIXEL_EVENTS[ROOM_IDS[roomIdx]] || [];
  const event = events.length ? pick(events) : null;
  currentState.music = pickMusic();
  currentState.event = event;
  const busyMin = event && event.busy ? randInt(event.busy[0], event.busy[1]) : 5;
  const visitRange = event && event.visits ? event.visits : [1, 1];
  const now = Date.now();
  session = {
    xiayanRoomIdx: roomIdx,
    huashengRoomIdx: 0,
    busy: true,
    busyDoneAt: now + busyMin * 60 * 1000,
    visitCount: randInt(visitRange[0], visitRange[1]),
    greeted: false,
    timers: { done: null, visit: null, leave: null, next: null },
  };
  saveState();
  scheduleVisit(session);
  scheduleDone(session);
  scheduleMusicSwitch();
  return { ...currentState, xiayanRoom: roomIdx, huashengRoom: 0, greeted: session.greeted, hour: chinaHour() };
}

export function setHuashengRoom(roomId) {
  if (!session) return;
  const idx = ROOM_IDS.indexOf(roomId);
  if (idx < 0) return;
  // 夏彦没在忙（正陪着华生）→ 跟着华生一起换房间
  const wasTogether = !session.busy && session.xiayanRoomIdx === session.huashengRoomIdx;
  session.huashengRoomIdx = idx;
  if (wasTogether && session.xiayanRoomIdx !== idx) {
    session.xiayanRoomIdx = idx;
    emit({ type: "pixel_home_xiayan_move", room: idx, event: DONE_EVENT });
  }
}

// 对话驱动移动：夏彦在聊天里说「我去客厅/去工作室」等，立绘 + 状态栏同步移动过去忙
export function moveXiayanToRoom(roomId) {
  if (!session) return false;
  const idx = ROOM_IDS.indexOf(roomId);
  if (idx < 0) return false;
  if (idx === session.huashengRoomIdx) return false; // 已经和她在同一个房间，不算"离开"
  const events = PIXEL_EVENTS[roomId] || [];
  const ev = events.length ? pick(events) : DONE_EVENT;
  currentState.event = ev;
  session.xiayanRoomIdx = idx;
  session.busy = true;
  const busyMin = ev.busy && ev.busy[1] > 0 ? randInt(ev.busy[0], ev.busy[1]) : randInt(5, 10);
  session.busyDoneAt = Date.now() + busyMin * 60 * 1000;
  session.visitCount = ev.visits ? randInt(ev.visits[0], ev.visits[1]) : 1;
  clearTimers(session);
  emit({ type: "pixel_home_xiayan_move", room: idx, event: ev });
  scheduleVisit(session);
  scheduleDone(session);
  return true;
}

// 把中文房间名解析成房间 id（用于解析对话里的 [去:房间名] 标记）
export function resolveRoomId(label) {
  const t = (label || "").trim();
  const map = {
    "卧室": "bedroom", "客厅": "living", "浴室": "bath", "洗手间": "bath", "卫生间": "bath",
    "游戏厅": "game", "游戏间": "game",
    "工作室": "studio",
    "绘画间": "artroom", "画室": "artroom",
  };
  return map[t] || null;
}

// 供服务端查询夏彦当前在哪、是否在忙（用于空闲主动搭话时判断立绘是否可见）
export function getPixelHomePresence() {
  if (!session) return null;
  return {
    xiayanRoomIdx: session.xiayanRoomIdx,
    huashengRoomIdx: session.huashengRoomIdx,
    busy: session.busy,
    sleeping: isSleepTime(),
  };
}

export function clearHomeTimers() {
  if (session) { clearTimers(session); session = null; }
}

// ── 休息提醒：华生说"在工作/画画"或"X分钟休息一下"，到时提醒休息 ──
let restTimer = null;
let restIntervalMs = null;

function parseRestMinutes(text) {
  if (/(半\s*个?\s*小时|半小时)/.test(text)) return 30;
  const hour = text.match(/(\d+)\s*(?:小时|个钟|个?钟头)/);
  if (hour) return parseInt(hour[1]) * 60;
  const min = text.match(/(\d+)\s*(?:分钟|分)/);
  if (min) return parseInt(min[1]);
  return null;
}

export function handleRestReminder(text) {
  if (!text) return;
  // 华生说"不用/不休息/别提醒/休息好了" → 停止提醒
  if (/(不用了|不休息|别提醒|不用提醒|不忙了|忙完了|休息好了)/.test(text)) {
    clearRestReminder();
    return;
  }
  const working = /(在工作|在画画|赶稿|做视频|剪视频|写稿|在忙|工作|画画)/.test(text);
  const restMention = /休息|歇|停一下|放松/.test(text);
  if (!working && !restMention) return;
  const minutes = parseRestMinutes(text) || 30;
  startRestReminder(minutes);
}

function startRestReminder(minutes) {
  if (restTimer) clearTimeout(restTimer);
  restIntervalMs = minutes * 60 * 1000;
  scheduleRestReminder();
}

function scheduleRestReminder() {
  restTimer = setTimeout(() => {
    if (!session) return;
    emit({
      type: "text_reply",
      reply_to: "",
      content: "宝宝，忙了这么久，要不要起来休息五分钟？",
      proactive: true,
    });
    scheduleRestReminder();
  }, restIntervalMs);
}

export function clearRestReminder() {
  if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  restIntervalMs = null;
}

// ── 音乐随机切换：夏彦隔一阵子随机换首歌，说两句 ──
let musicTimer = null;
const MUSIC_SWITCH_LINES = [
  "换首歌吧，这首听腻了。",
  "宝宝在忙吗？那换首安静的，好集中精力。",
  "这首适合现在，放给你听。",
];

export function scheduleMusicSwitch() {
  clearMusicSwitch();
  musicTimer = setTimeout(() => {
    if (!session) return;
    const music = pickMusic();
    if (music && music.id !== currentState.music?.id) {
      currentState.music = music;
      emit({ type: "pixel_home_music_change", music });
      emit({ type: "text_reply", reply_to: "", content: pick(MUSIC_SWITCH_LINES), proactive: true });
    }
    scheduleMusicSwitch();
  }, 10 * 60 * 1000 + Math.random() * 10 * 60 * 1000); // 10-20 分钟随机切一次
}

export function clearMusicSwitch() {
  if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
}

export function getPixelHomePositionContext() {
  if (!session) return "";
  const xiayanRoom = ROOM_NAMES[ROOM_IDS[session.xiayanRoomIdx]];
  const huashengRoom = ROOM_NAMES[ROOM_IDS[session.huashengRoomIdx]];
  const busy = session.busy
    ? `夏彦现在在「${xiayanRoom}」忙自己的事，还没忙完`
    : `夏彦已经忙完了，现在在「${huashengRoom}」陪着华生`;
  return `\n\n【位置】夏彦在「${xiayanRoom}」，华生在「${huashengRoom}」。${busy}。`;
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
  const posCtx = getPixelHomePositionContext().trim();
  if (posCtx) parts.push(posCtx);
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

// ── 共读状态：夏彦在给华生念书 ──
const READING_EVENT = { text: "夏彦正在给你念书", greeting: "", busy: [0, 0], visits: [0, 0] };
let readingContext = null; // { bookTitle, chapterTitle, chapterIdx, excerpt }

export function setReading(on, context = null) {
  if (on) {
    if (context) readingContext = context;
    if (session) clearTimers(session);
    currentState.event = READING_EVENT;
  } else {
    currentState.event = DONE_EVENT;
  }
  saveState();
  if (emitter) {
    emitter(JSON.stringify({ type: "pixel_home_xiayan_move", room: session?.huashengRoomIdx ?? 0, event: currentState.event }));
  }
  return currentState;
}

export function getReadingContext() {
  return readingContext;
}

export function clearReadingContext() {
  readingContext = null;
}

// 华生进屋后夏彦已经打过招呼 → 标记，退出再进不再重复说话
export function markGreeted() {
  if (!session) return;
  session.greeted = true;
  saveState();
}

// 进屋打招呼语音：夏彦空闲（不忙、没睡）时返回一句随机打招呼音频 URL，忙/睡就不播
const GREET_AUDIO_FILES = ["greet1", "greet2", "greet3", "greet4", "greet5", "greet6", "greet7"];

export function getGreetingAudio() {
  if (isSleepTime()) return null;
  if (session && session.busy) return null;
  const f = GREET_AUDIO_FILES[Math.floor(Math.random() * GREET_AUDIO_FILES.length)];
  return `/api/pixel-home/greet/${f}.mp3`;
}
