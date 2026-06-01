/**
 * AI clients — OpenRouter (Claude) + DeepSeek.
 */
import https from "node:https";
import config from "../config.js";

// ── OpenRouter (Claude) for intimate space ──

const OPENROUTER_KEY = config.OPENROUTER_API_KEY;
const OPENROUTER_HOST = "openrouter.ai";

export async function askClaude(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    model = "anthropic/claude-sonnet-4-6",
    maxTokens = 1200,
    temperature = 0.65,
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

  const body = JSON.stringify({ model, max_tokens: maxTokens, temperature, messages });

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: OPENROUTER_HOST, path: "/api/v1/chat/completions", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": "https://our-space.app",
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenRouter ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const reply = data.choices?.[0]?.message?.content?.trim() || "";
          if (!reply) throw new Error("Empty response");
          resolve(reply);
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

// ── DeepSeek for daily chat / discover / diary ──

const DEEPSEEK_KEY = "sk-ae57496be8cf4b979883cc31806b0cfa";
const DEEPSEEK_HOST = "api.deepseek.com";

export async function askDeepSeek(opts = {}) {
  return _openaiCompatCall({ ...opts, host: DEEPSEEK_HOST, apiKey: DEEPSEEK_KEY });
}

// ── 智增增 (Claude) for intimate space ──

const ZHIZENGZENG_KEY = "sk-zk264d777a9cbeb2bec0f9026cd8126679a6a1d35526013a";
const ZHIZENGZENG_HOST = "api.zhizengzeng.com";

export async function askZhizengzeng(opts = {}) {
  return _openaiCompatCall({
    ...opts,
    host: ZHIZENGZENG_HOST,
    apiKey: ZHIZENGZENG_KEY,
    model: opts.model || "claude-sonnet-4-6",
  });
}

// ── Shared OpenAI-compatible HTTP client ──

function _openaiCompatCall(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    host,
    apiKey,
    model = "deepseek-v4-pro",
    maxTokens = 1200,
    temperature = 0.65,
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

  const body = JSON.stringify({ model, max_tokens: maxTokens, temperature, messages });

  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path: "/v1/chat/completions", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`${host} ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const reply = data.choices?.[0]?.message?.content?.trim() || "";
          if (!reply) throw new Error("Empty response");
          resolve(reply);
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
