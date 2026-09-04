/**
 * 玖时 API client — Claude via api.jiushi.xin (按量)
 *
 * Local dev: routes through proxy (Clash Verge) for GFW bypass.
 * Docker/Sealos: direct HTTPS (DISABLE_PROXY=true)
 */

import http from "node:http";
import https from "node:https";

const JIUSHI_KEY = "sk-PuPG6Jrbk1Xj1j6Wt5AbLHzxkjiYa1dKGY7ibERnXY7WHpuc";
const JIUSHI_HOST = "az.zlapi.vip";
const JIUSHI_MODEL = "[0.06]报用鹿/claude-opus-4.6";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";

// ── Direct HTTPS (Docker/Sealos) ──

function directRequest({ body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: JIUSHI_HOST,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${JIUSHI_KEY}`,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const errBody = Buffer.concat(chunks).toString().slice(0, 300);
          reject(new Error(`jiushi ${res.statusCode}: ${errBody}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const reply = data.choices?.[0]?.message?.content?.trim() || "";
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
      path: `${JIUSHI_HOST}:443`,
      headers: { Host: `${JIUSHI_HOST}:443` },
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const r = https.request({
        method: "POST",
        host: JIUSHI_HOST, port: 443,
        path: "/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${JIUSHI_KEY}`,
        },
        socket,
        timeout: timeoutMs,
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            const errBody = Buffer.concat(chunks).toString().slice(0, 300);
            reject(new Error(`jiushi ${resp.statusCode}: ${errBody}`));
            return;
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const reply = data.choices?.[0]?.message?.content?.trim() || "";
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
 * Ask Claude via 玖时.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userContent
 * @param {Array<{role:string,content:string}>} [opts.history]
 * @param {string} [opts.model]        - Default: [k]claude-sonnet-4-6
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
    model = JIUSHI_MODEL,
    maxTokens = 800,
    temperature = 0.65,
    timeoutMs = 180000,
    imageBase64,
    imageMime,
  } = opts;

  if (!systemPrompt || !userContent) {
    throw new Error("systemPrompt and userContent are required");
  }

  function buildUserContent(text) {
    if (!imageBase64) return text;
    const parts = [];
    if (text) parts.push({ type: "text", text });
    // OpenAI 兼容接口用 image_url（不是 Anthropic 的 source），否则图片会被中转丢弃
    const mime = imageMime && imageMime !== "image/*" ? imageMime : "image/jpeg";
    parts.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${imageBase64}` },
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

  // 429 限流退避重试：玖时提示 quota reset after 1s，撞上限流停一下再试基本就过
  const MAX_RETRIES = 2;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await requestFn({ body, timeoutMs });
    } catch (err) {
      lastErr = err;
      const isRateLimited = String(err?.message || "").includes("429");
      if (!isRateLimited || attempt >= MAX_RETRIES) {
        throw lastErr;
      }
      const waitMs = 1500 * (attempt + 1);
      console.error(`[api2d] 429 限流，${waitMs}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
