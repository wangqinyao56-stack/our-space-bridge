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
  handleVoiceMessage,
  getChatHistory,
  getChatHistoryMessages,
  clearChatHistory,
} from "./lib/message-router.js";
import {
  loadDiary,
  listDiaryDates,
  addDiaryPost,
  addDiaryReply,
  generateAIReply,
} from "./lib/diary.js";

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
    res.end(JSON.stringify({ ok: true, clients: clients.size, tts_queue: ttsQueue.length }));
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
        const reply = await handleTextMessage(msg.content);
        ws.send(JSON.stringify({
          type: "text_reply",
          reply_to: msg.id,
          content: reply,
        }));
        // Auto-queue TTS
        const jobId = uuid();
        ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
        ws.send(JSON.stringify({
          type: "audio_queued",
          job_id: jobId,
          reply_to: msg.id,
          text: reply.slice(0, 40),
        }));
      } catch (err) {
        console.error("[ws] Text error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "voice") {
      if (!msg.audio) return;
      try {
        const wavBuf = Buffer.from(msg.audio, "base64");
        const { text, reply } = await handleVoiceMessage(wavBuf);
        // Send text reply immediately
        ws.send(JSON.stringify({
          type: "text_reply",
          reply_to: msg.id,
          content: reply,
          transcribed: text,
        }));
        // Queue TTS
        const jobId = uuid();
        ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
        ws.send(JSON.stringify({
          type: "audio_queued",
          job_id: jobId,
          reply_to: msg.id,
          text: reply.slice(0, 40),
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
