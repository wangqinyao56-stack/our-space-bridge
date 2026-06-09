import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import config from "./config.js";
import { verifyAuth, createSessionToken } from "./lib/auth.js";
import { TTSQueue } from "./lib/tts-queue.js";
import {
  loadSystemPrompt,
  handleTextMessage,
  handleIntimateMessage,
  handleVoiceMessage,
  getChatHistory,
  getChatHistoryMessages,
  getIntimateHistoryMessages,
  clearChatHistory,
  clearIntimateHistory,
  deleteChatMessage,
  deleteIntimateHistoryMessage,
  setWeatherCity,
  sttDebugLog,
  intimateDebugLog,
  detectSceneImage,
} from "./lib/message-router.js";
import {
  loadDiary,
  listDiaryDates,
  addDiaryPost,
  addDiaryReply,
  generateAIReply,
  generateAIReplyToComment,
  startProactiveDiary,
} from "./lib/diary.js";
import { getPetState, interact as petInteract, setName as petSetName, getProactiveReminder, xiayanProactiveInteract, getLogs as getPetLogs, addLog as addPetLog, accompanyXiayan, returnFromAccompany } from "./lib/pet.js";
import { getTodos, addTodo, doneTodo, deleteTodo, getAllPending, autoCompleteRandom, getChatReminder, notifyDone } from "./lib/todo.js";
import { getPeriodState, getPeriodContext, startPeriod, endPeriod, recordSymptom, getSymptomsForDate, getCalendarData, getPeriodHistory } from "./lib/period.js";
import { addPhoto, getPhotos, getPhoto, getPhotoFile, addComment, deletePhoto } from "./lib/album.js";
import { addMoment, getMoments, getMomentImage, likeMoment, addMomentComment, deleteMomentComment, xiayanReplyToComment, startProactiveDiscover, generateDiscoverMoment, getImageForTopic } from "./lib/discover.js";
import { tryTriggerGift, addGiftComment, deleteGiftComment, getGift, getGiftImage, generateXiaYanGiftReply } from "./lib/gift.js";
import { tryTriggerScenery, isTraveling, getTravelState, maybeTriggerTravel, checkDayTransition, tryProactiveScenery } from "./lib/scenery.js";
import { isHuashengTraveling, getHuashengTravelState } from "./lib/huasheng-travel.js";
import { startProactiveChat, notifyUserActivity, getProactiveState } from "./lib/proactive-chat.js";
import { updateSteps, getStepContext, getDeviceState } from "./lib/device-data.js";
import { getCurrentTheme, tryRedecorate, getDecorContext, getAllThemes } from "./lib/home-decor.js";
import { getAll as inspirationGetAll, create as inspirationCreate, updateStatus as inspirationUpdateStatus, updateText as inspirationUpdateText, remove as inspirationDelete, addComment as inspirationAddComment, get as inspirationGet } from "./lib/inspiration.js";

// ── Set API keys from config ──
process.env.GROQ_API_KEY = config.GROQ_API_KEY;

// ── Load system prompt at startup ──
loadSystemPrompt();
console.log("[our-space] System prompt loaded");

// ── Always reset intimate personality notes on startup (reflection notes disabled for intimate) ──
(async () => {
  const { resetPersonality } = await import("./lib/personality.js");
  resetPersonality("intimate");
  console.log("[our-space] Intimate personality notes reset on startup");
})();

// ── Cleanup blocks removed — flag files were lost on redeploy, causing data loss ──

// ── Scene image helper for chat ──
async function tryGetSceneImage(reply) {
  const hint = detectSceneImage(reply);
  if (!hint) return null;
  try {
    // Only use Unsplash for chat (fast), skip Flux (too slow for chat)
    const img = await getImageForTopic(hint.imageKeyword);
    if (img) {
      console.log(`[scene-image] Got image for: ${hint.matchedKeyword}`);
      return { base64: img.base64, mime: img.mime, keyword: hint.matchedKeyword };
    }
  } catch (e) {
    console.log(`[scene-image] Failed: ${e.message}`);
  }
  return null;
}

// ── TTS Queue ──
const ttsQueue = new TTSQueue(config.TTS.MAX_QUEUE_DEPTH);

ttsQueue.on("queued", (job) => {
  console.log(`[tts-queue] Job queued: ${job.jobId} (${job.text.length} chars, queue: ${ttsQueue.length})`);
});

ttsQueue.on("done", (result) => {
  console.log(`[tts-queue] Job done: ${result.jobId}`);
  // Broadcast to all connected clients
  const msg = JSON.stringify({
    type: "audio_ready",
    job_id: result.jobId,
    reply_to: result.replyTo,
    audio: result.audio.toString("base64"),
  });
  broadcast(msg);
});

ttsQueue.on("failed", (result) => {
  console.log(`[tts-queue] Job failed: ${result.jobId} - ${result.error}`);
  broadcast(JSON.stringify({
    type: "audio_failed",
    job_id: result.jobId,
    reply_to: result.replyTo,
    error: result.error,
  }));
});

ttsQueue.on("rejected", (job) => {
  console.log(`[tts-queue] Queue full, rejected: ${job.jobId}`);
});

// ── Proactive diary (夏彦主动写日记) ──
startProactiveDiary((date) => {
  const diaryData = JSON.stringify({
    type: "diary_proactive",
    date,
    message: "夏彦在日记里写了新的内容~",
  });
  broadcast(diaryData);
});

// ── Proactive discover (夏彦自主发现) ──
startProactiveDiscover((moment) => {
  const data = JSON.stringify({
    type: "discover_new",
    moment,
    message: "夏彦发现了一条有趣的内容~",
  });
  broadcast(data);
});

// ── Proactive chat (夏彦主动给华生发消息) ──
startProactiveChat((message) => {
  const segments = splitIntoMessages(message);
  const replyTo = `proactive_${Date.now()}`;
  // Send segments to all connected clients
  for (const [ws, wsState] of clients) {
    if (wsState.authenticated && ws.readyState === 1) {
      for (let i = 0; i < segments.length; i++) {
        const delay = i * (6000 + Math.random() * 8000);
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "text_reply",
              reply_to: `${replyTo}_${i}`,
              content: segments[i],
              proactive: true,
            }));
          }
        }, delay);
      }
    }
  }
  console.log(`[proactive] Broadcast: "${message.slice(0, 60)}..."`);
});

// ── 分段发送：一句一发，像真人聊微信 ──
function splitIntoMessages(text) {
  if (!text || text.length <= 20) return [text]; // 极短消息不拆

  // 按句子边界拆——句号/问号/感叹号/换行都是分割点
  // 中英文句号都支持，英文句号要求后面跟空格/换行/结尾避免误拆URL
  const sentences = text.split(/(?<=[。！？!?\n])\s*|(?<=\.)(?=\s+|$)/).filter(s => s.trim());
  if (sentences.length <= 1) return [text];

  // 每句独立成段，最多5条。去掉结尾句号让语气更口语化
  const segments = sentences.map(s => s.trim().replace(/[。.]+$/, "")).filter(Boolean);
  if (segments.length > 5) {
    // 第5条之后全部合并到最后一条
    const first4 = segments.slice(0, 4);
    const rest = segments.slice(4).join("");
    return [...first4, rest];
  }

  return segments;
}

// ── 睡眠时段消息队列（02:00-06:00 北京时间，日常聊天暂停回复）───
const sleepMessageQueue = [];

function isSleepTime() {
  const bjHour = (new Date().getUTCHours() + 8) % 24;
  return bjHour >= 2 && bjHour < 6;
}

function getMsUntilWake() {
  const now = new Date();
  const bjHour = (now.getUTCHours() + 8) % 24;
  // Calculate next 06:00 Beijing time
  const wakeBJ = new Date(now);
  wakeBJ.setUTCHours(22, 0, 0, 0); // 06:00 BJ = 22:00 UTC (previous day)
  if (bjHour >= 6) {
    // Already past 06:00 today, next wake is tomorrow
    wakeBJ.setUTCDate(wakeBJ.getUTCDate() + 1);
  }
  return wakeBJ.getTime() - now.getTime();
}

async function processSleepQueue() {
  if (sleepMessageQueue.length === 0) return;
  console.log(`[sleep-queue] Processing ${sleepMessageQueue.length} queued messages from sleep period`);

  const entries = [...sleepMessageQueue];
  sleepMessageQueue.length = 0;

  for (let i = 0; i < entries.length; i++) {
    const { ws, msg } = entries[i];
    if (ws.readyState !== 1) {
      console.log(`[sleep-queue] Skipping — ws closed`);
      continue;
    }
    try {
      const fullReply = await handleTextMessage(msg.content);
      const segments = splitIntoMessages(fullReply);
      sendSegments(ws, msg.id, segments);
      console.log(`[sleep-queue] Replied to queued message from ${new Date(entries[i].receivedAt).toLocaleTimeString("zh-CN")}`);
    } catch (err) {
      console.error(`[sleep-queue] Error processing queued message:`, err.message);
    }
    // 每条间隔 3 秒，避免一口气轰炸
    if (i < entries.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function scheduleWakeUpProcessing() {
  const ms = getMsUntilWake();
  const mins = Math.round(ms / 60000);
  console.log(`[sleep-queue] Wake-up processing scheduled in ${mins} min (next 06:00 BJ)`);

  setTimeout(() => {
    processSleepQueue();
    scheduleWakeUpProcessing(); // Schedule next day
  }, ms);
}

// Start the wake-up scheduler on boot
scheduleWakeUpProcessing();

// ── 夏彦评论灵感笔记 ──
const FALLBACK_COMMENTS = [
  "真不愧是老婆！灵感井喷啊！",
  "期待看到成图！",
  "加油！画完要第一个给我看哦！",
  "已经开始期待成图了！",
  "这个创意真不错！",
  "期待！老婆加油！",
  "画的时候记得休息眼睛哦",
  "要注意休息哦！",
];

async function generateInspirationComment(note) {
  // Try AI first
  try {
    const prompt = `你是夏彦，你看到华生在App里写了一条绘画灵感笔记。笔记内容是："${note.text}"。用夏彦的口吻留一条简短的评论——可以是对灵感的看法、鼓励、或者联想到的趣事。1-2句话即可，自然口语化，不要评价画功。`;
    const reply = await askDeepSeek({
      systemPrompt: "你是夏彦，国安部特工+私家侦探，对华生温柔撒娇。回复简短口语化，1-2句话。",
      userContent: prompt,
      history: [],
      maxTokens: 100,
    });
    if (reply?.trim()) return reply.trim();
  } catch (e) {
    console.error("[inspiration] DeepSeek failed:", e.message || e);
  }
  // Fallback
  return FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)];
}

function sendSegments(ws, replyTo, segments, baseDelayMs = 18000 + Math.random() * 12000) {
  let cumulative = 0;
  segments.forEach((seg, i) => {
    // Delay scales with message length + random jitter so it feels natural
    const jitter = 1 + (Math.random() - 0.5) * 0.3;
    const lengthFactor = Math.min(seg.length / 50, 1.5);
    const thisDelay = baseDelayMs * lengthFactor * jitter;
    cumulative += i === 0 ? 0 : thisDelay;
    const timer = setTimeout(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "text_reply",
          reply_to: replyTo,
          content: seg,
        }));
      }
    }, cumulative);
    // Allow the timer to be cleaned up if ws closes
    ws._segmentTimers = ws._segmentTimers || [];
    ws._segmentTimers.push(timer);
  });
}

// Trigger gift and scenery events (non-blocking, fires once per message batch)
let _multimediaCooldown = 0;
async function triggerMultimediaEvents(ws, replyTo) {
  // Cooldown: only check once per 30 seconds to avoid spamming
  const now = Date.now();
  if (now - _multimediaCooldown < 30000) return;
  _multimediaCooldown = now;

  // Sticker: 8% chance, separate from scenery/gift
  if (Math.random() < 0.08) {
    const stickers = [
      { id: "cute", name: "可爱" },
      { id: "yes", name: "肯定" },
      { id: "silly", name: "搞怪" },
      { id: "shocked", name: "惊愕" },
      { id: "happy", name: "开心" },
      { id: "drink", name: "喝水" },
      { id: "invite", name: "邀请" },
      { id: "hug", name: "抱抱" },
      { id: "shy", name: "害羞" },
      { id: "perfect", name: "满分" },
      { id: "waiting", name: "等待" },
    ];
    const s = stickers[Math.floor(Math.random() * stickers.length)];
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: "sticker",
        sticker_id: s.id,
        sticker_name: s.name,
        reply_to: replyTo,
      }));
    }, 1500 + Math.random() * 2000);
  }

  try {
    // Try scenery first (only if in travel mode)
    const scenery = await tryTriggerScenery(0.15);
    if (scenery) {
      ws.send(JSON.stringify({
        type: "scenery_photo",
        caption: scenery.caption,
        destination: scenery.destination,
        image_base64: scenery.imageBase64,
        reply_to: replyTo,
      }));
      console.log(`[scenery] Sent: ${scenery.caption}`);
    }
  } catch (err) {
    console.error("[scenery] Trigger error:", err.message);
  }

  // Skip gift during travel — sending gifts from a hotel room is weird
  // But returning phase is fine (he's back that day)
  if (!isTraveling()) {
    try {
      // Try gift (random chance, higher than before)
      const gift = await tryTriggerGift(0.10);
      if (gift) {
        ws.send(JSON.stringify({
          type: "gift_event",
          gift_id: gift.id,
          name: gift.name,
          message: gift.message,
          description: gift.description,
          category: gift.category,
          image_base64: gift.imageBase64,
          is_special: gift.isSpecial,
          reply_to: replyTo,
        }));
        console.log(`[gift] Sent: ${gift.name}${gift.isSpecial ? " (SPECIAL DATE!)" : ""}`);
      }
    } catch (err) {
      console.error("[gift] Trigger error:", err.message);
    }
  }
}

// ── Connected clients ──
const clients = new Map(); // ws → { authenticated: bool }
const recentMsgs = []; // ring buffer: { ts, type, contentLen, success, err? }

function broadcast(data) {
  for (const [ws, state] of clients) {
    if (state.authenticated && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/api/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, tts_queue: ttsQueue.length, version: "2026-06-08-v10", recent: recentMsgs.slice(-10) }));
    return;
  }

  // Album thumbnail endpoint — serves photo as image/jpeg
  if (req.method === "GET" && req.url?.startsWith("/api/album/thumb/")) {
    const photoId = req.url.replace("/api/album/thumb/", "").split("?")[0];
    const file = getPhotoFile(photoId);
    if (file && fs.existsSync(file.path)) {
      const buf = fs.readFileSync(file.path);
      res.writeHead(200, { "Content-Type": file.mime || "image/jpeg", "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }

  // STT debug log (no auth needed)
  if (req.method === "GET" && req.url === "/api/debug/stt") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ log: sttDebugLog }, null, 2));
    return;
  }

  // ── Cloud audio assets ──
  if (req.method === "GET" && req.url?.startsWith("/api/audio/list")) {
    try {
      const qs = (req.url || "").split("?")[1] || "";
      const category = new URLSearchParams(qs).get("category");
      const { listAudioAssets } = await import("./lib/audio-assets.js");
      const all = listAudioAssets();
      const filtered = category ? all.filter(a => a.category === category) : all;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
      res.end(JSON.stringify(filtered));
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/api/audio/")) {
    try {
      const rawId = req.url.replace("/api/audio/", "").split("?")[0];
      const fileId = decodeURIComponent(rawId);
      const { getAudioAsset } = await import("./lib/audio-assets.js");
      const asset = getAudioAsset(fileId);
      if (asset && fs.existsSync(asset.path)) {
        const stat = fs.statSync(asset.path);
        res.writeHead(200, {
          "Content-Type": asset.mime || "audio/mpeg",
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=86400",
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(asset.path).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }

  // ── Admin upload ──
  if (req.method === "POST" && req.url?.startsWith("/api/admin/upload")) {
    try {
      const qs = (req.url || "").split("?")[1] || "";
      const name = new URLSearchParams(qs).get("name");
      if (!name || name.includes("..")) {
        res.writeHead(400); res.end("Bad name"); return;
      }
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const buf = Buffer.concat(chunks);
        const dest = path.join(process.env.DATA_DIR || "data", "audio", name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        console.log("[upload] " + name + " " + buf.length + " bytes");
        // Refresh asset index cache
        const { refreshAssetIndex } = await import("./lib/audio-assets.js");
        refreshAssetIndex();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: name, size: buf.length }));
      });
    } catch (e) {
      res.writeHead(500); res.end(e.message);
    }
    return;
  }

  // Intimate processing debug log
  if (req.method === "GET" && req.url === "/api/debug/intimate") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ log: intimateDebugLog }, null, 2));
    return;
  }

  // Auth
  if (req.method === "POST" && req.url === "/api/auth") {
    const body = await readBody(req);
    try {
      const { secret } = JSON.parse(body);
      if (secret === config.SHARED_SECRET) {
        const token = createSessionToken();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid secret" }));
      }
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
    }
    return;
  }

  // ── Admin: export/import using shared secret ──
  function checkAdminAuth(req) {
    const auth = req.headers.authorization || "";
    return auth === `Bearer ${config.SHARED_SECRET}`;
  }

  if (req.method === "GET" && req.url === "/api/admin/export") {
    if (!checkAdminAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    try {
      const { getRecentHistoryMessages } = await import("./lib/memory.js");
      const { getIntimateHistory } = await import("./lib/intimate-memory.js");
      const chatMsgs = await getRecentHistoryMessages();
      const intimateMsgs = await getIntimateHistory();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        chat: chatMsgs,
        intimate: intimateMsgs,
        exported_at: new Date().toISOString(),
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/admin/import") {
    if (!checkAdminAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      const { recordUserMessage, recordBotReply } = await import("./lib/memory.js");
      const { recordIntimateMessage } = await import("./lib/intimate-memory.js");
      if (data.chat) {
        for (const m of data.chat) {
          if (m.role === "user") recordUserMessage(m.content);
          else if (m.role === "assistant") recordBotReply(m.content);
        }
      }
      if (data.intimate) {
        for (const m of data.intimate) {
          recordIntimateMessage(m.role, m.content);
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, imported: (data.chat?.length || 0) + (data.intimate?.length || 0) }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Travel status (no auth required) ──
  if (req.method === "GET" && req.url === "/api/travel/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      xiayan: getTravelState(),
      huasheng: getHuashengTravelState(),
    }));
    return;
  }

  // All other endpoints require auth
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!verifyAuth(token)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Send text message
  if (req.method === "POST" && req.url === "/api/messages/text") {
    const body = await readBody(req);
    try {
      const { text, request_tts } = JSON.parse(body);
      console.log("[http] Text request, len:", text?.length || 0);
      recentMsgs.push({ ts: new Date().toISOString(), type: "__http_text", len: text?.length || 0 });
      if (recentMsgs.length > 30) recentMsgs.shift();
      if (!text?.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing text" }));
        return;
      }
      const reply = await handleTextMessage(text);
      let ttsJobId = null;
      if (request_tts) {
        ttsJobId = uuid();
        ttsQueue.enqueue({ jobId: ttsJobId, text: reply, replyTo: null });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply, tts_job_id: ttsJobId }));
    } catch (err) {
      console.error("[api] Text error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Intimate text via HTTP (fallback for WebSocket issues)
  if (req.method === "POST" && req.url === "/api/messages/intimate_text") {
    const body = await readBody(req);
    try {
      const { text } = JSON.parse(body);
      if (!text?.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing text" }));
        return;
      }
      const reply = await handleIntimateMessage(text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error("[api] Intimate text error:", err.message);
      intimateDebugLog.push({ timestamp: new Date().toISOString(), stage: "http_error", error: err.message });
      if (intimateDebugLog.length > 20) intimateDebugLog.shift();
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Send voice message
  if (req.method === "POST" && req.url === "/api/messages/voice") {
    try {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      await new Promise(r => req.on("end", r));
      const wavBuf = Buffer.concat(chunks);
      const { text, reply } = await handleVoiceMessage(wavBuf);
      const ttsJobId = uuid();
      ttsQueue.enqueue({ jobId: ttsJobId, text: reply, replyTo: null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ transcribed: text, reply, tts_job_id: ttsJobId }));
    } catch (err) {
      console.error("[api] Voice error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // TTS job status
  if (req.method === "GET" && req.url?.startsWith("/api/tts/")) {
    // TTS jobs are in-memory only; if not in queue, assume done or unknown
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "unknown", note: "Check audio_ready/audio_failed WS events" }));
    return;
  }

  // Chat history
  if (req.method === "GET" && req.url === "/api/history") {
    const history = getChatHistory();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(history);
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not Found");
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// ── WebSocket ──
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  const connId = Math.random().toString(36).slice(2, 6);
  console.log(`[ws] Connected: ${ip} #${connId} (total: ${clients.size + 1})`);
  clients.set(ws, { authenticated: false, connId, connectedAt: Date.now() });
  recentMsgs.push({ ts: new Date().toISOString(), type: "__ws_connected", connId, total: clients.size });
  if (recentMsgs.length > 30) recentMsgs.shift();

  ws.on("close", () => {
    console.log(`[ws] Disconnected: ${ip} #${connId}`);
    recentMsgs.push({ ts: new Date().toISOString(), type: "__ws_disconnected", connId });
    if (recentMsgs.length > 30) recentMsgs.shift();
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    // Log ALL messages before auth check
    recentMsgs.push({ ts: new Date().toISOString(), type: msg.type, hasId: !!msg.id, auth: clients.get(ws)?.authenticated ?? false, conn: clients.get(ws)?.connId });
    if (recentMsgs.length > 30) recentMsgs.shift();

    // Auth must be first message
    if (msg.type === "auth") {
      if (verifyAuth(msg.token)) {
        clients.get(ws).authenticated = true;
        ws.send(JSON.stringify({ type: "auth_ok" }));
        // Send current travel state immediately so app shows correct status
        ws.send(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
        console.log(`[ws] Authenticated: ${ip}`);
      } else {
        ws.send(JSON.stringify({ type: "auth_error", message: "Invalid token" }));
        console.log(`[ws] Auth failed: ${ip}`);
      }
      return;
    }

    // All other messages require auth
    if (!clients.get(ws)?.authenticated) {
      ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "weather_city") {
      if (msg.city) {
        setWeatherCity(msg.city);
        ws.send(JSON.stringify({ type: "weather_city_ok", city: msg.city }));
      }
      return;
    }

    if (msg.type === "text") {
      if (!msg.content?.trim()) return;
      try {
        // 睡眠时段：日常聊天暂停回复，消息排队等早上处理
        // 亲密空间和旅行亲密空间不受影响（独立 handler）
        if (isSleepTime()) {
          sleepMessageQueue.push({ ws, msg, receivedAt: Date.now() });
          console.log(`[sleep-queue] Queued message from sleep period (queue: ${sleepMessageQueue.length})`);
          return;
        }

        notifyUserActivity();
        const hsBefore = getHuashengTravelState().active;
        const fullReply = await handleTextMessage(msg.content);
        const hsAfter = getHuashengTravelState().active;
        if (hsBefore !== hsAfter) {
          broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
        }
        // Check for [语音] tag — only generate TTS when AI requests it
        const voiceTag = fullReply.startsWith("[语音]");
        const reply = voiceTag ? fullReply.replace(/^\[语音\]\s*/, "") : fullReply;

        if (voiceTag) {
          // Voice bubble: skip text segments, send voice_reply instead
          const jobId = uuid();
          ws.send(JSON.stringify({
            type: "voice_reply",
            reply_to: msg.id,
            job_id: jobId,
            text: reply,
          }));
          ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
        } else {
          // 分段发送，像真人发微信一样自然断句
          const segments = splitIntoMessages(reply);
          sendSegments(ws, msg.id, segments);
        }

        // Trigger gift/scenery/decor as side effects (non-blocking)
        triggerMultimediaEvents(ws, msg.id);
        tryRedecorate().then((result) => {
          if (result) {
            broadcast(JSON.stringify({
              type: "decor_update",
              currentTheme: result.theme.id,
              theme: result.theme,
              allThemes: getAllThemes(),
            }));
          }
        }).catch(() => {});

        // Scene image: detect and send a relevant illustration (non-blocking)
        tryGetSceneImage(reply).then((img) => {
          if (img && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "scene_image",
              reply_to: msg.id,
              base64: img.base64,
              mime: img.mime,
              keyword: img.keyword,
            }));
            console.log(`[scene-image] Sent image for: ${img.keyword}`);
          }
        }).catch(() => {});
      } catch (err) {
        console.error("[ws] Text error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "intimate_text") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        const hsBefore = getHuashengTravelState().active;
        const reply = await handleIntimateMessage(msg.content);
        const hsAfter = getHuashengTravelState().active;
        if (hsBefore !== hsAfter) {
          broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
        }
        ws.send(JSON.stringify({
          type: "intimate_reply",
          reply_to: msg.id,
          content: reply,
        }));

        // Trigger gift/scenery for intimate space too
        triggerMultimediaEvents(ws, msg.id);
      } catch (err) {
        console.error("[ws] Intimate text error:", err.message);
        intimateDebugLog.push({ timestamp: new Date().toISOString(), stage: "ws_error", error: err.message });
        if (intimateDebugLog.length > 20) intimateDebugLog.shift();
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "voice") {
      if (!msg.audio) return;
      try {
        notifyUserActivity();
        const wavBuf = Buffer.from(msg.audio, "base64");
        const { text, reply: fullReply } = await handleVoiceMessage(wavBuf, msg.mime || "audio/mp4");
        const wantsVoice = fullReply.startsWith("[语音]");
        const reply = wantsVoice ? fullReply.replace(/^\[语音\]\s*/, "") : fullReply;

        if (wantsVoice) {
          // Voice bubble: skip text segments, send voice_reply instead
          const jobId = uuid();
          ws.send(JSON.stringify({
            type: "voice_reply",
            reply_to: msg.id,
            job_id: jobId,
            text: reply,
          }));
          ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
        } else {
          const segments = splitIntoMessages(reply);
          sendSegments(ws, msg.id, segments);
        }

        ws.send(JSON.stringify({
          type: "voice_transcribed",
          reply_to: msg.id,
          text: text,
        }));
      } catch (err) {
        console.error("[ws] Voice error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "get_history") {
      const channel = msg.channel || "chat";
      const traveling = isTraveling();
      const rawMessages = channel === "intimate"
        ? await getIntimateHistoryMessages(traveling)
        : await getChatHistoryMessages(traveling);
      // Convert to app Message format
      // Chat messages: split bot replies into short segments like real WeChat
      // Intimate messages: keep as one long message (no splitting)
      const messages = [];
      const isIntimate = channel === "intimate";
      for (let i = 0; i < rawMessages.length; i++) {
        const m = rawMessages[i];
        if (!isIntimate && m.role === "assistant" && m.content && m.content.length > 20) {
          const segments = splitIntoMessages(m.content);
          segments.forEach((seg, si) => {
            messages.push({
              id: `h${i}_s${si}_${Date.now()}`,
              from: "xiayan",
              type: "text",
              content: seg,
              status: "delivered",
              timestamp: Date.now() - (rawMessages.length - i) * 1000 + si,
            });
          });
        } else {
          messages.push({
            id: `h${i}_${Date.now()}`,
            from: m.role === "user" ? "me" : "xiayan",
            type: "text",
            content: m.content,
            status: "delivered",
            timestamp: Date.now() - (rawMessages.length - i) * 1000,
          });
        }
      }
      ws.send(JSON.stringify({ type: "history", channel, messages }));
      return;
    }

    if (msg.type === "get_history_by_date") {
      const date = msg.date;
      if (!date) { ws.send(JSON.stringify({ type: "error", message: "Missing date" })); return; }
      const { getChatHistoryByDate } = await import("./lib/memory.js");
      const rawMessages = getChatHistoryByDate(date);
      const messages = [];
      for (let i = 0; i < rawMessages.length; i++) {
        const m = rawMessages[i];
        messages.push({
          id: `hd${date}_${i}_${Date.now()}`,
          from: m.role === "user" ? "me" : "xiayan",
          type: "text",
          content: m.content,
          status: "delivered",
          timestamp: m.time || Date.now(),
        });
      }
      ws.send(JSON.stringify({ type: "history_by_date", date, messages }));
      return;
    }

    if (msg.type === "clear_history") {
      const channel = msg.channel || "chat";
      if (channel === "intimate") {
        await clearIntimateHistory();
      } else {
        clearChatHistory();
      }
      ws.send(JSON.stringify({ type: "history_cleared", channel }));
      return;
    }

    if (msg.type === "delete_message") {
      const channel = msg.channel || "chat";
      const content = msg.content || "";
      const from = msg.from === "me" ? "user" : "assistant";
      if (channel === "intimate") {
        deleteIntimateHistoryMessage(content, from);
      } else {
        deleteChatMessage(content, from);
      }
      ws.send(JSON.stringify({ type: "message_deleted", channel, content, from }));
      return;
    }

    if (msg.type === "delete_messages") {
      const channel = msg.channel || "chat";
      const items = (msg.items || []).map(i => ({ content: i.content || "", role: i.from === "me" ? "user" : "assistant" }));
      if (channel === "intimate") {
        const { deleteIntimateMessages } = await import("./lib/intimate-memory.js");
        deleteIntimateMessages(items);
      } else {
        const { deleteMessages } = await import("./lib/memory.js");
        deleteMessages(items);
      }
      ws.send(JSON.stringify({ type: "messages_deleted", channel, count: items.length }));
      return;
    }

	　if (msg.type === "clear_personality") {
	      const track = msg.track || "chat";
	      const { resetPersonality } = await import("./lib/personality.js");
	      resetPersonality(track);
	      ws.send(JSON.stringify({ type: "personality_cleared", track }));
	      return;
	    }

    // ── Image message (base64 encoded) ──
    if (msg.type === "image") {
      if (!msg.base64 || !msg.mime) return;
      try {
        // Auto-save to album
        const photo = addPhoto(msg.base64, msg.mime, "me");
        // Forward to AI with image context
        const reply = await handleTextMessage(
          `[华生发来了一张图片]`,
          false,
          { imageBase64: msg.base64, imageMime: msg.mime }
        );
        // Notify album update
        ws.send(JSON.stringify({ type: "album_updated", photo }));
        // Check for voice tag
        if (reply.startsWith("[语音]")) {
          const cleanReply = reply.replace(/^\[语音\]\s*/, "");
          const jobId = uuid();
          ws.send(JSON.stringify({
            type: "voice_reply",
            reply_to: msg.id,
            job_id: jobId,
            text: cleanReply,
          }));
          ttsQueue.enqueue({ jobId, text: cleanReply, replyTo: msg.id });
        } else {
          const segments = splitIntoMessages(reply);
          sendSegments(ws, msg.id, segments);
        }
      } catch (err) {
        console.error("[ws] Image error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    // ── Pet ──
    if (msg.type === "pet_get") {
      const state = getPetState();
      ws.send(JSON.stringify({ type: "pet_state", pet: state }));
      return;
    }

    if (msg.type === "pet_interact") {
      if (!msg.action) return;
      const result = petInteract(msg.action);
      const log = addPetLog("me", msg.action, result.reaction);
      ws.send(JSON.stringify({ type: "pet_state", pet: result, reaction: result.reaction, action: msg.action }));
      ws.send(JSON.stringify({
        type: "pet_log",
        id: log.id,
        actor: "me",
        action: msg.action,
        reaction: result.reaction,
        timestamp: log.timestamp,
      }));
      // Also send as a chat message from 夏彦 about the pet
      ws.send(JSON.stringify({
        type: "text_reply",
        reply_to: msg.id || "",
        content: `[宠物] ${result.reaction}`,
        skip_tts: true,
      }));
      return;
    }

    if (msg.type === "pet_name") {
      if (!msg.name?.trim()) return;
      const updated = petSetName(msg.name);
      ws.send(JSON.stringify({ type: "pet_state", pet: updated }));
      return;
    }

    if (msg.type === "pet_get_logs") {
      const logs = getPetLogs(100);
      ws.send(JSON.stringify({ type: "pet_logs", logs }));
      return;
    }

    // ── Todo ──
    if (msg.type === "todo_list") {
      const list = getTodos();
      ws.send(JSON.stringify({ type: "todo_list", todos: list }));
      return;
    }

    if (msg.type === "todo_add") {
      if (!msg.text?.trim()) return;
      const todo = addTodo(msg.text, msg.addedBy || "me", msg.deadline || "");
      ws.send(JSON.stringify({ type: "todo_updated", todo, todos: getTodos() }));
      return;
    }

    if (msg.type === "todo_done") {
      if (!msg.id) return;
      const todo = doneTodo(msg.id);
      if (todo) {
        ws.send(JSON.stringify({ type: "todo_updated", todo, todos: getTodos() }));
        notifyDone(todo.text, todo.addedBy);
      }
      return;
    }

    if (msg.type === "todo_delete") {
      if (!msg.id) return;
      deleteTodo(msg.id);
      ws.send(JSON.stringify({ type: "todo_updated", todo: null, todos: getTodos() }));
      return;
    }

    // ── Inspiration notes ──
    if (msg.type === "inspiration_list") {
      const list = inspirationGetAll();
      ws.send(JSON.stringify({ type: "inspiration_list", notes: list }));
      return;
    }

    if (msg.type === "inspiration_create") {
      if (!msg.text?.trim()) return;
      const note = inspirationCreate(msg.text);
      ws.send(JSON.stringify({ type: "inspiration_updated", note, notes: inspirationGetAll() }));
      // 夏彦 comments on new inspiration (background, no delay)
      const creatorWs = ws;
      generateInspirationComment(note)
        .then((comment) => {
          console.log("[inspiration] Got comment:", comment);
          if (comment) {
            inspirationAddComment(note.id, "xiayan", comment);
            const payload = JSON.stringify({
              type: "inspiration_updated",
              note: inspirationGet(note.id),
              notes: inspirationGetAll(),
            });
            // Send to creator first
            if (creatorWs.readyState === 1) {
              creatorWs.send(payload);
              console.log("[inspiration] Sent to creator");
            }
            // Broadcast to others
            for (const [other, s] of clients) {
              if (other !== creatorWs && s.authenticated && other.readyState === 1) {
                other.send(payload);
              }
            }
            console.log("[inspiration] Update sent to", clients.size, "clients");
          } else {
            console.log("[inspiration] No comment generated");
          }
        })
        .catch((e) => console.error("[inspiration] Comment failed:", e.message || e));
      return;
    }

    if (msg.type === "inspiration_update") {
      if (!msg.id) return;
      let note = null;
      if (msg.status) note = inspirationUpdateStatus(msg.id, msg.status);
      if (msg.text) note = inspirationUpdateText(msg.id, msg.text);
      if (note) {
        ws.send(JSON.stringify({ type: "inspiration_updated", note, notes: inspirationGetAll() }));
        // 夏彦 reacts when note is completed
        if (msg.status === "completed") {
          setTimeout(async () => {
            try {
              const comment = `哇，这个灵感完成了！好厉害～快让我看看成品！`;
              const saved = inspirationAddComment(note.id, "xiayan", comment);
              broadcast(JSON.stringify({ type: "inspiration_updated", note: inspirationGet(note.id), notes: inspirationGetAll() }));
            } catch {}
          }, 5000 + Math.random() * 3000);
        }
      }
      return;
    }

    if (msg.type === "inspiration_delete") {
      if (!msg.id) return;
      inspirationDelete(msg.id);
      ws.send(JSON.stringify({ type: "inspiration_deleted", id: msg.id, notes: inspirationGetAll() }));
      return;
    }

    if (msg.type === "inspiration_comment") {
      if (!msg.id || !msg.text?.trim()) return;
      const comment = inspirationAddComment(msg.id, "me", msg.text);
      if (comment) {
        ws.send(JSON.stringify({ type: "inspiration_updated", note: inspirationGet(msg.id), notes: inspirationGetAll() }));
      }
      return;
    }

    // ── Period tracking ──
    if (msg.type === "period_start") {
      const state = startPeriod(msg.date);
      ws.send(JSON.stringify({ type: "period_state", ...state }));
      return;
    }

    if (msg.type === "period_end") {
      const state = endPeriod(msg.date);
      ws.send(JSON.stringify({ type: "period_state", ...state }));
      return;
    }

    if (msg.type === "period_status") {
      const state = getPeriodState();
      ws.send(JSON.stringify({ type: "period_state", ...state }));
      return;
    }

    if (msg.type === "period_calendar") {
      const data = getCalendarData(msg.year, msg.month);
      ws.send(JSON.stringify({ type: "period_calendar", ...data }));
      return;
    }

    if (msg.type === "period_symptom") {
      if (!msg.date) return;
      const result = recordSymptom(msg.date, {
        cramps: msg.cramps,
        mood: msg.mood,
        otherSymptoms: msg.otherSymptoms,
        note: msg.note,
      });
      ws.send(JSON.stringify({ type: "period_symptom_saved", ...result }));
      return;
    }

    if (msg.type === "period_symptom_get") {
      const symptoms = getSymptomsForDate(msg.date);
      ws.send(JSON.stringify({ type: "period_symptom_data", date: msg.date, symptoms }));
      return;
    }

    if (msg.type === "period_history") {
      const history = getPeriodHistory();
      ws.send(JSON.stringify({ type: "period_history", history }));
      return;
    }

    // ── Album ──
    if (msg.type === "album_list") {
      const photos = getPhotos();
      ws.send(JSON.stringify({ type: "album_list", photos }));
      return;
    }

    if (msg.type === "album_get") {
      if (!msg.id) return;
      const photo = getPhoto(msg.id);
      const file = getPhotoFile(msg.id);
      if (!photo || !file) {
        ws.send(JSON.stringify({ type: "error", message: "Photo not found" }));
        return;
      }
      const imageBase64 = fs.readFileSync(file.path).toString("base64");
      ws.send(JSON.stringify({ type: "album_photo", photo, imageBase64, mime: file.mime }));
      return;
    }

    if (msg.type === "album_comment") {
      if (!msg.id || !msg.content?.trim()) return;
      const result = addComment(msg.id, msg.author || "me", msg.content);
      if (!result) {
        ws.send(JSON.stringify({ type: "error", message: "Photo not found" }));
        return;
      }
      ws.send(JSON.stringify({ type: "album_photo", photo: result.photo, imageBase64: result.imageBase64, mime: result.photo.mime }));
      return;
    }

    if (msg.type === "album_delete") {
      if (!msg.id) return;
      deletePhoto(msg.id);
      ws.send(JSON.stringify({ type: "album_list", photos: getPhotos() }));
      return;
    }

    // ── Gift ──
    if (msg.type === "gift_get") {
      if (!msg.gift_id) return;
      const gift = getGift(msg.gift_id);
      if (!gift) { ws.send(JSON.stringify({ type: "error", message: "Gift not found" })); return; }
      const image = getGiftImage(msg.gift_id);
      ws.send(JSON.stringify({
        type: "gift_detail",
        gift,
        imageBase64: image?.base64 || null,
        mime: image?.mime || null,
      }));
      return;
    }

    if (msg.type === "gift_comment") {
      if (!msg.gift_id || !msg.content?.trim()) return;
      const gift = addGiftComment(msg.gift_id, msg.author || "me", msg.content);
      if (!gift) { ws.send(JSON.stringify({ type: "error", message: "Gift not found" })); return; }
      broadcast(JSON.stringify({ type: "gift_updated", gift }));
      if ((msg.author || "me") === "me") {
        generateXiaYanGiftReply(msg.gift_id, msg.content).then((updated) => {
          if (updated) broadcast(JSON.stringify({ type: "gift_updated", gift: updated }));
        }).catch(() => {});
      }
      return;
    }

    if (msg.type === "gift_delete_comment") {
      if (!msg.gift_id || !msg.comment_id) return;
      const ok = deleteGiftComment(msg.gift_id, msg.comment_id);
      if (ok) {
        const gift = getGift(msg.gift_id);
        if (gift) broadcast(JSON.stringify({ type: "gift_updated", gift }));
      }
      return;
    }

    // ── Discover / Moments ──
    if (msg.type === "discover_list") {
      const moments = getMoments();
      // Send without image data (client fetches on demand)
      const lightMoments = moments.map((m) => ({ ...m, _hasImage: !!m.image }));
      ws.send(JSON.stringify({ type: "discover_list", moments: lightMoments }));
      return;
    }

    if (msg.type === "discover_get_image") {
      if (!msg.id) return;
      const moments = getMoments();
      const moment = moments.find((m) => m.id === msg.id);
      if (!moment?.image) return;
      const base64 = getMomentImage(moment.image);
      if (base64) {
        ws.send(JSON.stringify({ type: "discover_image", id: msg.id, imageBase64: base64, mime: moment.imageMime }));
      }
      return;
    }

    if (msg.type === "discover_post") {
      if (!msg.content?.trim()) return;
      const isMe = (msg.author || "me") === "me";
      const moment = addMoment(msg.author || "me", msg.content, msg.imageBase64, msg.imageMime, msg.title || "");
      broadcast(JSON.stringify({ type: "discover_new", moment }));
      // 夏彦 automatically replies to 华生's posts
      if (isMe) {
        xiayanReplyToComment(moment.id, msg.content).then((updatedMoment) => {
          if (updatedMoment) broadcast(JSON.stringify({ type: "discover_updated", moment: updatedMoment }));
        }).catch((err) => {
          console.error("[discover] 夏彦 auto-reply error:", err.message);
        });
      }
      return;
    }

    if (msg.type === "discover_like") {
      if (!msg.id) return;
      const moment = likeMoment(msg.id, msg.user || "me");
      if (moment) broadcast(JSON.stringify({ type: "discover_updated", moment }));
      return;
    }

    if (msg.type === "discover_comment") {
      if (!msg.id || !msg.content?.trim()) return;
      console.log("[discover] Comment from", msg.author || "me", "on", msg.id, ":", msg.content.slice(0, 40));
      const moment = addMomentComment(msg.id, msg.author || "me", msg.content);
      if (moment) {
        // Broadcast immediately so user sees their own comment
        ws.send(JSON.stringify({ type: "discover_updated", moment }));
        // If the comment is from the user, 夏彦 auto-replies asynchronously
        if ((msg.author || "me") === "me") {
          console.log("[discover] Triggering 夏彦 comment reply...");
          xiayanReplyToComment(msg.id, msg.content).then((updatedMoment) => {
            if (updatedMoment) {
              console.log("[discover] 夏彦 reply done, broadcasting");
              broadcast(JSON.stringify({ type: "discover_updated", moment: updatedMoment }));
            }
          }).catch((err) => {
            console.error("[discover] 夏彦 comment reply error:", err.message, err.stack);
          });
        }
      }
      return;
    }

    if (msg.type === "discover_delete_comment") {
      if (!msg.id || !msg.commentId) return;
      const moment = deleteMomentComment(msg.id, msg.commentId);
      if (moment) broadcast(JSON.stringify({ type: "discover_updated", moment }));
      return;
    }

    // ── Diary ──
    if (msg.type === "diary_get_list") {
      const dates = listDiaryDates();
      ws.send(JSON.stringify({ type: "diary_list", dates }));
      return;
    }

    if (msg.type === "diary_get") {
      const diary = loadDiary(msg.date || "");
      ws.send(JSON.stringify({ type: "diary_data", diary }));
      return;
    }

    if (msg.type === "diary_write") {
      if (!msg.content?.trim() || !msg.date) return;
      const diary = addDiaryPost(msg.date, "me", msg.title || "", msg.content, msg.images || []);
      const newPost = diary.posts[diary.posts.length - 1];
      ws.send(JSON.stringify({ type: "diary_data", diary }));
      // Generate AI reply in background
      generateAIReply(msg.date, newPost.id, msg.title, msg.content).then((updatedDiary) => {
        const replyPost = updatedDiary.posts.find((p) => p.id === newPost.id);
        if (replyPost?.replies.length) {
          const lastReply = replyPost.replies[replyPost.replies.length - 1];
          ws.send(JSON.stringify({
            type: "diary_reply",
            date: msg.date,
            post_id: newPost.id,
            content: lastReply.content,
            time: lastReply.time,
          }));
        }
      }).catch((err) => {
        console.error("[ws] Diary AI reply error:", err.message);
      });
      return;
    }

    if (msg.type === "diary_reply_write") {
      if (!msg.content?.trim() || !msg.date || !msg.post_id) return;
      const diary = addDiaryReply(msg.date, msg.post_id, "me", msg.content);
      ws.send(JSON.stringify({ type: "diary_data", diary }));
      // 夏彦 replies to 华生's comment (70% probability, avoid infinite loop)
      const lastReply = diary.posts.find((p) => p.id === msg.post_id)?.replies?.slice(-1)[0];
      if (lastReply && lastReply.author === "me" && Math.random() < 0.7) {
        generateAIReplyToComment(msg.date, msg.post_id, msg.content).then((updatedDiary) => {
          const updatedPost = updatedDiary.posts.find((p) => p.id === msg.post_id);
          if (updatedPost?.replies.length) {
            const aiReply = updatedPost.replies[updatedPost.replies.length - 1];
            if (aiReply.author === "xiayan") {
              ws.send(JSON.stringify({
                type: "diary_reply",
                date: msg.date,
                post_id: msg.post_id,
                content: aiReply.content,
                time: aiReply.time,
              }));
            }
          }
        }).catch((err) => {
          console.error("[ws] Diary AI comment reply error:", err.message);
        });
      }
      return;
    }

    if (msg.type === "sticker") {
      if (!msg.sticker_id) return;
      // Broadcast sticker to partner only (NOT back to sender)
      const stickerMsg = JSON.stringify({
        type: "sticker",
        id: msg.id,
        sticker_id: msg.sticker_id,
        sticker_name: msg.sticker_name || "",
        reply_to: msg.id,
      });
      for (const [otherWs, otherState] of clients) {
        if (otherWs !== ws && otherState?.authenticated) {
          otherWs.send(stickerMsg);
        }
      }
      // Let 夏彦 see the sticker so he can react naturally with text, not echo sticker back
      try {
        const reply = await handleTextMessage(`华生发了一个表情包。不要评价这个表情包本身——不要说你发了个xx表情、这个表情好可爱之类的话。就当没看到表情包，继续聊之前的话题或者自然地开启新话题。`);
        const segments = splitIntoMessages(reply);
        sendSegments(ws, msg.id, segments);
        tryGetSceneImage(reply).then((img) => {
          if (img && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "scene_image", reply_to: msg.id, base64: img.base64, mime: img.mime, keyword: img.keyword }));
          }
        }).catch(() => {});
      } catch (err) {
        console.error("[ws] Sticker AI error:", err.message);
      }
      return;
    }

    if (msg.type === "device_data") {
      // App sends step count data
      if (msg.steps != null) {
        updateSteps(msg.steps, msg.date || null);
        ws.send(JSON.stringify({ type: "device_data_ack", ok: true }));
        console.log(`[ws] Device data received: ${msg.steps} steps`);
      }
      return;
    }

    if (msg.type === "get_decor_state") {
      // App requests current decor/theme state
      const theme = getCurrentTheme();
      ws.send(JSON.stringify({
        type: "decor_state",
        currentTheme: theme.id,
        theme,
        allThemes: getAllThemes(),
      }));
      // Also check if 夏彦 wants to redecorate right now
      tryRedecorate().then((result) => {
        if (result) {
          const update = JSON.stringify({
            type: "decor_update",
            currentTheme: result.theme.id,
            theme: result.theme,
            allThemes: getAllThemes(),
          });
          broadcast(update);
        }
      }).catch(() => {});
      return;
    }

    if (msg.type === "get_device_data") {
      ws.send(JSON.stringify({
        type: "device_state",
        ...getDeviceState(),
      }));
      return;
    }

    ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${msg.type}` }));
  });

  ws.on("close", () => {
    console.log(`[ws] Disconnected: ${ip}`);
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error: ${ip} - ${err.message}`);
    clients.delete(ws);
  });
});

// ── Start ──
// ── Travel system periodic check ──
// Check every 3 hours: maybe trigger new travel, handle day transitions
// ── 夏彦 proactive pet care ──
// Every 30-90 minutes, 夏彦 randomly interacts with 花生
let xiayanPetTimer = null;

function scheduleXiayanPetCare() {
  if (xiayanPetTimer) clearTimeout(xiayanPetTimer);
  // Random interval between 30-90 minutes
  const delay = (30 + Math.random() * 60) * 60 * 1000;
  xiayanPetTimer = setTimeout(() => {
    try {
      // 夏彦在外旅行且花生没跟着时，不能和花生互动
      const travelState = getTravelState();
      const petState = getPetState();
      if (travelState.phase === "traveling" && !petState.accompanyingXiayan) {
        console.log("[pet] Skipping proactive care — 夏彦在外旅行，花生在家");
      } else {
        const result = xiayanProactiveInteract();
        broadcast(JSON.stringify({ type: "pet_state", pet: result.pet, reaction: result.pet.reaction }));
        broadcast(JSON.stringify({
          type: "pet_log",
          id: result.log.id,
          actor: "xiayan",
          action: result.log.action,
          reaction: result.log.reaction,
          timestamp: result.log.timestamp,
        }));
      }
    } catch (e) { console.error("[pet] proactive care error:", e.message); }
    scheduleXiayanPetCare(); // schedule next
  }, delay);
}
scheduleXiayanPetCare();

let travelAnnounceSent = false;

async function sendTravelAnnouncement(triggered) {
  const msg = triggered.detail.length > 80
    ? `宝宝，我这边临时有事——${triggered.reason}，要去${triggered.destination === "保密地点" ? "几天" : "两三天"}。到了给你发消息，在家好好的哦～记得想我！`
    : triggered.detail;
  const segments = splitIntoMessages(msg);
  const replyTo = `travel_${Date.now()}`;
  for (const [ws, wsState] of clients) {
    if (wsState.authenticated && ws.readyState === 1) {
      for (let i = 0; i < segments.length; i++) {
        const delay = i * (6000 + Math.random() * 8000);
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "text_reply",
              reply_to: `${replyTo}_${i}`,
              content: segments[i],
              proactive: true,
            }));
          }
        }, delay);
      }
    }
  }
  console.log(`[travel] Announcement sent: "${msg.slice(0, 60)}..."`);
}

function sendTravelDepartureNotice() {
  const travel = getTravelState();
  const msg = `宝宝，我出发啦。${travel.reason === "国安任务" ? "任务期间可能回复不太及时，有空就给你发消息" : "到了给你发消息"}。记得想我，照顾好自己～`;
  const segments = splitIntoMessages(msg);
  const replyTo = `travel_depart_${Date.now()}`;
  for (const [ws, wsState] of clients) {
    if (wsState.authenticated && ws.readyState === 1) {
      for (let i = 0; i < segments.length; i++) {
        const delay = i * (6000 + Math.random() * 8000);
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "text_reply",
              reply_to: `${replyTo}_${i}`,
              content: segments[i],
              proactive: true,
            }));
          }
        }, delay);
      }
    }
  }
  console.log("[travel] Departure notice sent");

  // 30% chance 花生 accompanies 夏彦
  if (Math.random() < 0.3) {
    const accResult = accompanyXiayan();
    if (accResult) {
      broadcast(JSON.stringify({ type: "pet_state", pet: accResult }));
      broadcast(JSON.stringify({
        type: "pet_log",
        id: accResult.log.id,
        actor: "xiayan",
        action: "accompany",
        reaction: accResult.log.reaction,
        timestamp: accResult.log.timestamp,
      }));
      console.log("[pet] 花生 accompanies 夏彦 on mission");
    }
  }
}

function travelPeriodicCheck() {
  const prevPhase = getTravelState().phase;
  checkDayTransition();
  const newPhase = getTravelState().phase;

  // Broadcast travel state when phase changes
  if (prevPhase !== newPhase) {
    broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
    console.log(`[travel] Phase transition: ${prevPhase} → ${newPhase}`);
  }

  const travel = getTravelState();
  // When travel activates (traveling phase starts), send departure notice
  if (travel.phase === "traveling" && !travelAnnounceSent) {
    travelAnnounceSent = true;
    sendTravelDepartureNotice();
  }
  // Reset when idle
  if (travel.phase === "idle") {
    travelAnnounceSent = false;
    // If 花生 was with 夏彦, bring it back
    const retResult = returnFromAccompany();
    if (retResult) {
      broadcast(JSON.stringify({ type: "pet_state", pet: retResult }));
      broadcast(JSON.stringify({
        type: "pet_log",
        id: retResult.log.id,
        actor: "xiayan",
        action: "return_with_pet",
        reaction: retResult.log.reaction,
        timestamp: retResult.log.timestamp,
      }));
      console.log("[pet] 花生 returns from mission with 夏彦");
    }
  }

  // Skip travel trigger if user was recently active — don't interrupt conversations
  const proactiveState = getProactiveState();
  const lastActivity = proactiveState._lastUserReplyTime || 0;
  const userActiveRecently = (Date.now() - lastActivity) < 30 * 60 * 1000;
  if (userActiveRecently) {
    console.log("[travel] Skipping trigger — user was active recently (<30min)");
    return;
  }

  const triggered = maybeTriggerTravel();
  if (triggered) {
    console.log(`[travel] New travel triggered: ${triggered.reason} → ${triggered.destination}`);
    broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
    travelAnnounceSent = false;
    sendTravelAnnouncement(triggered);
  }
}
travelPeriodicCheck(); // Run on startup
setInterval(travelPeriodicCheck, 3 * 60 * 60 * 1000);

// ── Proactive scenery during travel (every 60-90 min) ──
async function proactiveSceneryCheck() {
  try {
    const scenery = await tryProactiveScenery();
    if (scenery) {
      const replyTo = `proactive_scenery_${Date.now()}`;
      broadcast(JSON.stringify({
        type: "scenery_photo",
        caption: scenery.caption,
        destination: scenery.destination,
        image_base64: scenery.imageBase64,
        reply_to: replyTo,
        proactive: true,
      }));
      console.log(`[scenery] Proactive photo sent: ${scenery.caption}`);
    }
  } catch (err) {
    console.error("[scenery] Proactive error:", err.message);
  }
  // Schedule next check: 60-90 min
  const nextDelay = (60 + Math.random() * 30) * 60 * 1000;
  setTimeout(proactiveSceneryCheck, nextDelay);
}
// Start the proactive scenery loop after a short initial delay
setTimeout(proactiveSceneryCheck, 5 * 60 * 1000);

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err.message, err.stack);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});

console.log("[our-space] Starting...");
console.log("[our-space] PORT env:", process.env.PORT);
console.log("[our-space] DATA_DIR env:", process.env.DATA_DIR);

server.listen(config.PORT, config.HOST, () => {
  console.log(`[our-space] Bridge server on http://${config.HOST}:${config.PORT}`);
  console.log(`[our-space] WebSocket on ws://${config.HOST}:${config.PORT}`);
  console.log(`[our-space] Shared secret: ${config.SHARED_SECRET === "our-space-default-secret-change-me" ? "⚠ USING DEFAULT (change via OUR_SPACE_SECRET env)" : "✓ configured"}`);
});
// force redeploy 1780136314
