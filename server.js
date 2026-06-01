import http from "node:http";
import fs from "node:fs";
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
  clearChatHistory,
  sttDebugLog,
} from "./lib/message-router.js";
import {
  loadDiary,
  listDiaryDates,
  addDiaryPost,
  addDiaryReply,
  generateAIReply,
  startProactiveDiary,
} from "./lib/diary.js";
import { getPetState, interact as petInteract, setName as petSetName, getProactiveReminder } from "./lib/pet.js";
import { getTodos, addTodo, doneTodo, deleteTodo, getAllPending, autoCompleteRandom, getChatReminder, notifyDone } from "./lib/todo.js";
import { getPeriodState, getPeriodContext, startPeriod, endPeriod } from "./lib/period.js";
import { addPhoto, getPhotos, getPhoto, getPhotoFile, addComment, deletePhoto } from "./lib/album.js";
import { addMoment, getMoments, getMomentImage, likeMoment, addMomentComment, deleteMomentComment, xiayanReplyToComment, startProactiveDiscover, generateDiscoverMoment } from "./lib/discover.js";
import { tryTriggerGift } from "./lib/gift.js";
import { tryTriggerScenery } from "./lib/scenery.js";

// ── Set API keys from config ──
process.env.GROQ_API_KEY = config.GROQ_API_KEY;

// ── Load system prompt at startup ──
loadSystemPrompt();
console.log("[our-space] System prompt loaded");

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

// ── 分段发送：把长回复拆成自然短句，像真人发微信 ──
function splitIntoMessages(text) {
  if (!text || text.length <= 40) return [text]; // 已经很短了，不拆

  // 先按段落拆（AI 用空行表示"分开发送"）
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs.map((p) => p.trim()).filter(Boolean);
  }

  // 单段落但很长，按句子边界拆
  const sentences = text.split(/(?<=[。！？!?\n])\s*/).filter(Boolean);
  if (sentences.length <= 1) return [text];

  // 每段1-2句，模拟真人发微信的节奏
  const segments = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current.length + s.length > 60 || current.length >= 35)) {
      segments.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) segments.push(current.trim());

  return segments.length > 0 ? segments : [text];
}

function sendSegments(ws, replyTo, segments, delayMs = 500) {
  segments.forEach((seg, i) => {
    const timer = setTimeout(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "text_reply",
          reply_to: replyTo,
          content: seg,
        }));
      }
    }, i * delayMs);
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

  try {
    // Try gift (low random chance)
    const gift = await tryTriggerGift(0.05);
    if (gift) {
      ws.send(JSON.stringify({
        type: "gift_event",
        name: gift.name,
        message: gift.message,
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

// ── Connected clients ──
const clients = new Map(); // ws → { authenticated: bool }

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
    res.end(JSON.stringify({ ok: true, clients: clients.size, tts_queue: ttsQueue.length, version: "2026-05-30-v4" }));
    return;
  }

  // STT debug log (no auth needed)
  if (req.method === "GET" && req.url === "/api/debug/stt") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ log: sttDebugLog }, null, 2));
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
  console.log(`[ws] Connected: ${ip}`);
  clients.set(ws, { authenticated: false });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    // Auth must be first message
    if (msg.type === "auth") {
      if (verifyAuth(msg.token)) {
        clients.get(ws).authenticated = true;
        ws.send(JSON.stringify({ type: "auth_ok" }));
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

    if (msg.type === "text") {
      if (!msg.content?.trim()) return;
      try {
        const fullReply = await handleTextMessage(msg.content);
        // Check for [语音] tag — only generate TTS when AI requests it
        const voiceTag = fullReply.startsWith("[语音]");
        const reply = voiceTag ? fullReply.replace(/^\[语音\]\s*/, "") : fullReply;

        // 分段发送，像真人发微信一样自然断句
        const segments = splitIntoMessages(reply);
        sendSegments(ws, msg.id, segments);

        if (voiceTag) {
          const jobId = uuid();
          ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
          ws.send(JSON.stringify({
            type: "audio_queued",
            job_id: jobId,
            reply_to: msg.id,
            text: reply.slice(0, 40),
          }));
        }

        // Trigger gift/scenery as side effects (non-blocking)
        triggerMultimediaEvents(ws, msg.id);
      } catch (err) {
        console.error("[ws] Text error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "intimate_text") {
      if (!msg.content?.trim()) return;
      try {
        const reply = await handleIntimateMessage(msg.content);
        ws.send(JSON.stringify({
          type: "intimate_reply",
          reply_to: msg.id,
          content: reply,
        }));

        // Trigger gift/scenery for intimate space too
        triggerMultimediaEvents(ws, msg.id);
      } catch (err) {
        console.error("[ws] Intimate text error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "voice") {
      if (!msg.audio) return;
      try {
        const wavBuf = Buffer.from(msg.audio, "base64");
        const { text, reply: fullReply } = await handleVoiceMessage(wavBuf, msg.mime || "audio/mp4");
        // Voice messages always get TTS (user is speaking → reply with voice)
        const voiceTag = fullReply.startsWith("[语音]");
        const reply = voiceTag ? fullReply.replace(/^\[语音\]\s*/, "") : fullReply;

        // Split into segments like text messages
        const segments = splitIntoMessages(reply);
        const mainReply = segments.join("\n\n");

        // Send text reply as segments
        sendSegments(ws, msg.id, segments);

        // Always queue TTS for voice messages (use full reply for audio)
        const jobId = uuid();
        ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
        ws.send(JSON.stringify({
          type: "audio_queued",
          job_id: jobId,
          reply_to: msg.id,
          text: reply.slice(0, 40),
          transcribed: text,
        }));
      } catch (err) {
        console.error("[ws] Voice error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "get_history") {
      const rawMessages = await getChatHistoryMessages();
      // Convert to app Message format
      const messages = rawMessages.map((m, i) => ({
        id: `h${i}_${Date.now()}`,
        from: m.role === "user" ? "me" : "xiayan",
        type: "text",
        content: m.content,
        status: "delivered",
        timestamp: Date.now() - (rawMessages.length - i) * 1000,
      }));
      ws.send(JSON.stringify({ type: "history", messages }));
      return;
    }

    if (msg.type === "clear_history") {
      clearChatHistory();
      ws.send(JSON.stringify({ type: "history_cleared" }));
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
        // Split and send as segments
        const segments = splitIntoMessages(reply);
        sendSegments(ws, msg.id, segments);
        // Notify album update
        ws.send(JSON.stringify({ type: "album_updated", photo }));
        // Check for voice tag
        if (reply.startsWith("[语音]")) {
          const cleanReply = reply.replace(/^\[语音\]\s*/, "");
          const jobId = uuid();
          ttsQueue.enqueue({ jobId, text: cleanReply, replyTo: msg.id });
          ws.send(JSON.stringify({ type: "audio_queued", job_id: jobId, reply_to: msg.id, text: cleanReply.slice(0, 40) }));
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
      ws.send(JSON.stringify({ type: "pet_state", pet: result, reaction: result.reaction }));
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
      const moment = addMomentComment(msg.id, msg.author || "me", msg.content);
      if (moment) {
        broadcast(JSON.stringify({ type: "discover_updated", moment }));
        // If the comment is from the user (not 夏彦), 夏彦 auto-replies
        if ((msg.author || "me") === "me") {
          xiayanReplyToComment(msg.id, msg.content).then((updatedMoment) => {
            if (updatedMoment) broadcast(JSON.stringify({ type: "discover_updated", moment: updatedMoment }));
          }).catch((err) => {
            console.error("[discover] 夏彦 comment reply error:", err.message);
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
      return;
    }

    if (msg.type === "sticker") {
      if (!msg.sticker_id) return;
      // Broadcast sticker to partner
      ws.send(JSON.stringify({
        type: "sticker",
        id: msg.id,
        sticker_id: msg.sticker_id,
        sticker_name: msg.sticker_name || "",
        reply_to: msg.id,
      }));
      // Broadcast to other connected clients too
      for (const [otherWs, otherState] of clients) {
        if (otherWs !== ws && otherState?.authenticated) {
          otherWs.send(JSON.stringify({
            type: "sticker",
            id: msg.id,
            sticker_id: msg.sticker_id,
            sticker_name: msg.sticker_name || "",
            reply_to: msg.id,
          }));
        }
      }
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
server.listen(config.PORT, config.HOST, () => {
  console.log(`[our-space] Bridge server on http://${config.HOST}:${config.PORT}`);
  console.log(`[our-space] WebSocket on ws://${config.HOST}:${config.PORT}`);
  console.log(`[our-space] Shared secret: ${config.SHARED_SECRET === "our-space-default-secret-change-me" ? "⚠ USING DEFAULT (change via OUR_SPACE_SECRET env)" : "✓ configured"}`);
});
// force redeploy 1780136312
