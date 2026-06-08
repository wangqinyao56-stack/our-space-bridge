/**
 * api2d API client — Claude via openai.api2d.net
 *
 * Supports proper system role (OpenAI format), Chinese users OK.
 * Local dev: routes through proxy (Clash Verge) for GFW bypass.
 * Docker/Sealos: direct HTTPS (DISABLE_PROXY=true)
 */

import http from "node:http";
import https from "node:https";

const API2D_KEY = "fk243680-T6aAs9kjlPLEy9sMfkDFwRdA6ob1Xwov";
const API2D_HOST = "openai.api2d.net";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";

// ── Direct HTTPS (Docker/Sealos) ──

function directRequest({ body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: API2D_HOST,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API2D_KEY}`,
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const errBody = Buffer.concat(chunks).toString().slice(0, 300);
          reject(new Error(`api2d ${res.statusCode}: ${errBody}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          // api2d returns Anthropic-native format (content array)
          const content = data.content;
          let reply = "";
          if (Array.isArray(content)) {
            reply = content.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
          } else if (typeof content === "string") {
            reply = content.trim();
          }
          // Fallback to OpenAI format
          if (!reply && data.choices?.[0]?.message?.content) {
            reply = data.choices[0].message.content.trim();
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

function proxyRequest({ body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${API2D_HOST}:443`,
      headers: { Host: `${API2D_HOST}:443` },
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const r = https.request({
        method: "POST",
        host: API2D_HOST, port: 443,
        path: "/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API2D_KEY}`,
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
            reject(new Error(`api2d ${resp.statusCode}: ${errBody}`));
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
            if (!reply && data.choices?.[0]?.message?.content) {
              reply = data.choices[0].message.content.trim();
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

/**
 * Ask Claude via api2d.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userContent
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {string} [opts.model]        - Default: claude-sonnet-4-5
 * @param {number} [opts.maxTokens]    - Default: 800
 * @param {number} [opts.temperature]  - Default: 0.65
 * @param {number} [opts.timeoutMs]    - Default: 60000
 * @param {string} [opts.imageBase64]
 * @param {string} [opts.imageMime]
 */
export async function askClaude(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    model = "claude-sonnet-4-5",
    maxTokens = 800,
    temperature = 0.65,
    timeoutMs = 60000,
    imageBase64,
    imageMime,
  } = opts;

  if (!systemPrompt || !userContent) {
    throw new Error("systemPrompt and userContent are required");
  }

  // Build user content — text or multimodal
  function buildUserContent(text) {
    if (!imageBase64) return text;
    const parts = [];
    if (text) parts.push({ type: "text", text });
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

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: buildUserContent(userContent) },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
  });

  const requestFn = DISABLE_PROXY ? directRequest : proxyRequest;
  return requestFn({ body, timeoutMs });
}
