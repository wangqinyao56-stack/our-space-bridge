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
  // 智增增 has strict roleplay detection — convert system prompt to story format
  const { systemPrompt, userContent, history = [] } = opts;

  // Build a single merged user message that avoids roleplay keywords
  let mergedUser = "";

  if (systemPrompt) {
    // Strip "你是夏彦" style role assignment, reframe as story context
    const cleaned = systemPrompt
      .replace(/你是夏彦[。，,\s]*/g, "")
      .replace(/你是夏彦[^。\n]*/g, "")
      .replace(/你的名字是夏彦[。，,\s]*/g, "")
      .replace(/你在扮演[^。\n]*/g, "")
      .trim();

    if (cleaned) {
      mergedUser += `[故事设定]\n${cleaned}\n\n`;
    }
  }

  // Add history as story context
  if (history.length > 0) {
    const historyLines = history.map(m => {
      const role = m.role === "assistant" ? "夏彦" : "华生";
      return `${role}：${m.content}`;
    }).join("\n");
    mergedUser += `[前文]\n${historyLines}\n\n`;
  }

  mergedUser += `${userContent}`;

  // Wrap with invisible story directive
  mergedUser = `续写以下故事，只输出夏彦的对话和动作描写。\n\n${mergedUser}`;

  return _openaiCompatCall({
    ...opts,
    systemPrompt: "", // no system role
    userContent: mergedUser,
    history: [], // already inlined
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

  if (!userContent) {
    throw new Error("userContent is required");
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push(...history, { role: "user", content: userContent });

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
