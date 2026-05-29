/**
 * CLI test client for our-space bridge server.
 * Usage: node test/ws-client.js [text message]
 */
import WebSocket from "ws";
import readline from "node:readline";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:3456";
const SECRET = process.env.SECRET || "our-space-default-secret-change-me";

const msg = process.argv[2] || "你好，测试消息";

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log(`Connected to ${WS_URL}`);
  // Auth first
  ws.send(JSON.stringify({ type: "auth", token: SECRET }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log(`\n← ${msg.type}:`, JSON.stringify(msg, null, 2).slice(0, 500));

  if (msg.type === "auth_ok") {
    console.log("✓ Authenticated, sending test message...");
    ws.send(JSON.stringify({ type: "text", id: "test-1", content: process.argv[2] || "你好，测试消息" }));
  }

  if (msg.type === "text_reply") {
    console.log(`\n夏彦: ${msg.content}`);
  }

  if (msg.type === "audio_queued") {
    console.log(`⏳ TTS queued: ${msg.job_id}`);
  }

  if (msg.type === "audio_ready") {
    console.log(`✅ TTS done: ${msg.job_id} (${msg.audio?.length || 0} base64 chars)`);
  }

  if (msg.type === "audio_failed") {
    console.log(`❌ TTS failed: ${msg.error}`);
  }
});

ws.on("error", (err) => {
  console.error("WebSocket error:", err.message);
  process.exit(1);
});

ws.on("close", () => {
  console.log("Disconnected");
  process.exit(0);
});

// Timeout
setTimeout(() => {
  console.log("(timeout, exiting)");
  process.exit(0);
}, 30000);
