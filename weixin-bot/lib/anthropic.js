/**
 * Anthropic Claude API client (via aicoding.sh)
 *
 * Local dev: routes through proxy (Clash Verge) for GFW bypass.
 * Docker/Sealos: direct HTTPS (DISABLE_PROXY=true)
 */

import http from "node:http";
import https from "node:https";

const API_KEY = "aicoding-6db8a479f7b063d26197bed965865805";
const API_HOST = "api.aicoding.sh";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";

// ── Direct HTTPS (Docker/Sealos) ──

function directRequest(opts) {
  const { body, timeoutMs } = opts;
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API_HOST,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const errBody = Buffer.concat(chunks).toString().slice(0, 300);
          reject(new Error(`Anthropic ${res.statusCode}: ${errBody}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const content = data.content;
          let reply = "";
          if (Array.isArray(content)) {
            reply = content.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
          } else if (typeof content === "string") {
            reply = content.trim();
          }
          if (!reply) reject(new Error("Empty response"));
          else resolve(reply);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Proxy (local dev) ──

function proxyRequest(opts) {
  const { body, timeoutMs } = opts;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${API_HOST}:443`,
      headers: { Host: `${API_HOST}:443` },
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const r = https.request({
        method: "POST",
        host: API_HOST, port: 443,
        path: "/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        socket,
        timeout: timeoutMs,
        rejectUnauthorized: false,
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            const errBody = Buffer.concat(chunks).toString().slice(0, 300);
            reject(new Error(`Anthropic ${resp.statusCode}: ${errBody}`));
            return;
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const content = data.content;
            let reply = "";
            if (Array.isArray(content)) {
              reply = content.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
            } else if (typeof content === "string") {
              reply = content.trim();
            }
            if (!reply) reject(new Error("Empty response"));
            else resolve(reply);
          } catch (e) {
            reject(e);
          }
        });
      });
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("Timeout")); });
      r.write(body);
      r.end();
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Public API ──

export async function askClaude(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    model = "claude-sonnet-4-6",
    maxTokens = 800,
    temperature = 0.65,
    timeoutMs = 60000,
    imageBase64,
    imageMime,
  } = opts;

  if (!systemPrompt || !userContent) {
    throw new Error("systemPrompt and userContent are required");
  }

  // Build user content — with or without image
  function buildUserContent(text) {
    if (!imageBase64) return text;

    // Multimodal: text + image in content array
    const parts = [];
    if (text) parts.push({ type: "text", text: text });
    parts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMime || "image/jpeg",
        data: imageBase64,
      },
    });
    return parts;
  }

  let messages;
  if (history.length === 0) {
    messages = [
      { role: "user", content: `${systemPrompt}\n\n---\n\n以下是以角色身份回复用户的消息。\n\n${userContent}` },
    ];
    // If has image, use content array for last message
    if (imageBase64) {
      messages[0].content = [
        { type: "text", text: `${systemPrompt}\n\n---\n\n以下是以角色身份回复用户的消息。` },
        ...(userContent ? [{ type: "text", text: userContent }] : []),
        { type: "image", source: { type: "base64", media_type: imageMime || "image/jpeg", data: imageBase64 } },
      ];
    }
  } else {
    messages = [
      { role: "user", content: `${systemPrompt}\n\n---\n\n以下是以角色身份回复用户的消息。` },
      ...history.map(m => ({ role: m.role === "system" ? "user" : m.role, content: m.content })),
      { role: "user", content: buildUserContent(userContent) },
    ];
  }

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
    tool_choice: { type: "none" },
  });

  const requestFn = DISABLE_PROXY ? directRequest : proxyRequest;
  return requestFn({ body, timeoutMs });
}
