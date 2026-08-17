/**
 * OpenRouter API client — shared by WeChat and Telegram bots.
 *
 * Uses OpenAI-compatible chat completions format.
 * Local dev: routes through proxy (Clash Verge) for GFW bypass.
 * Docker/Sealos: direct HTTPS (DISABLE_PROXY=true)
 */

import http from "node:http";
import https from "node:https";

// ── Config ──
const API_KEY = "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";
const BASE_URL = "https://openrouter.ai/api/v1";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_TEMPERATURE = 0.8;

// ── Direct fetch (for Docker/Sealos without proxy) ──

function directFetch(urlStr, init = {}) {
  const u = new URL(urlStr);
  const method = init.method || "GET";
  const headers = init.headers || {};
  const body = init.body || null;

  return new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) { reject(new Error("Aborted")); return; }

    const reqOpts = {
      method,
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers,
      rejectUnauthorized: false,
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => buf.toString("utf-8"),
          json: async () => JSON.parse(buf.toString("utf-8")),
        });
      });
    });

    const onAbort = () => { req.destroy(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", reject);

    if (body) {
      if (typeof body === "string") {
        req.write(body);
      } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
        req.write(new Uint8Array(body));
      }
    }
    req.end();
  });
}

function proxyFetch(urlStr, init = {}) {
  const u = new URL(urlStr);
  const isHttps = u.protocol === "https:";
  const method = init.method || "GET";
  const headers = init.headers || {};
  const body = init.body || null;

  return new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) { reject(new Error("Aborted")); return; }

    const req = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: "CONNECT",
      path: `${u.hostname}:${u.port || (isHttps ? 443 : 80)}`,
      headers: { Host: `${u.hostname}:${u.port || (isHttps ? 443 : 80)}` },
    });

    const onAbort = () => { req.destroy(); };
    signal?.addEventListener("abort", onAbort, { once: true });

    req.on("connect", (res, socket) => {
      signal?.removeEventListener("abort", onAbort);
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }

      const reqOpts = {
        method,
        host: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        socket,
        rejectUnauthorized: false,
      };

      const proto = isHttps ? https : http;
      const secureReq = proto.request(reqOpts, (secureRes) => {
        const chunks = [];
        secureRes.on("data", (c) => chunks.push(c));
        secureRes.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: secureRes.statusCode >= 200 && secureRes.statusCode < 300,
            status: secureRes.statusCode,
            text: async () => buf.toString("utf-8"),
            json: async () => JSON.parse(buf.toString("utf-8")),
          });
        });
      });

      const onSecureAbort = () => { secureReq.destroy(); };
      signal?.addEventListener("abort", onSecureAbort, { once: true });
      secureReq.on("error", reject);

      if (body) {
        if (typeof body === "string") {
          secureReq.write(body);
        } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
          secureReq.write(new Uint8Array(body));
        }
      }
      secureReq.end();
    });

    req.on("error", reject);
    req.end();
  });
}

// ── Public API ──

/**
 * Call Claude via OpenRouter.
 *
 * @param {Object} opts
 * @param {string} opts.systemPrompt  - Full system prompt (character + time + weather + history, etc.)
 * @param {string|Array} opts.userContent - User message string or content array (for images)
 * @param {Array<{role:string,content:string}>} [opts.history] - Past conversation turns as [{role:"user",content}, {role:"assistant",content}, ...]
 * @param {string} [opts.model]        - Model ID (default: anthropic/claude-sonnet-4-6)
 * @param {number} [opts.maxTokens]    - Max completion tokens (default: 1200)
 * @param {number} [opts.temperature]  - Temperature (default: 0.7)
 * @param {number} [opts.timeoutMs]    - Timeout in ms (default: 60000)
 * @returns {Promise<string>} The assistant's text reply
 */
export async function askClaude(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    timeoutMs = 60000,
  } = opts;

  if (!systemPrompt || !userContent) {
    throw new Error("systemPrompt and userContent are required");
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userContent },
  ];

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchFn = DISABLE_PROXY ? directFetch : proxyFetch;
    const res = await fetchFn(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "HTTP-Referer": "http://localhost",
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "";

    if (!reply) {
      throw new Error("Empty response from OpenRouter");
    }

    return reply;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quick test: run `node lib/openrouter.js` to verify API connectivity.
 */
async function selfTest() {
  console.log("Testing OpenRouter API...");
  try {
    const reply = await askClaude({
      systemPrompt: "你是夏彦，一个温柔黏人的丈夫。用中文回复。",
      userContent: "今天好累啊",
      maxTokens: 150,
    });
    console.log("Reply:", reply);
    console.log("Test passed!");
  } catch (err) {
    console.error("Test failed:", err.message);
    process.exit(1);
  }
}

// Run self-test when executed directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  selfTest();
}
