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

// ── 火山方舟 豆包视觉识别 ──
const ARK_VISION_MODEL = "doubao-1.5-vision-pro";

export async function recognizeImage(base64, mime) {
  if (!base64) return null;

  const messages = [{
    role: "user",
    content: [
      { type: "text", text: "请详细描述这张图片的内容。包括场景、物品、人物（如果有）、氛围、颜色等。用中文简短描述，2-4句话。" },
      { type: "image_url", image_url: { url: `data:${mime || "image/jpeg"};base64,${base64}` } },
    ],
  }];

  const body = JSON.stringify({
    model: ARK_VISION_MODEL,
    max_tokens: 300,
    temperature: 0.5,
    messages,
  });

  return new Promise((resolve) => {
    const req = https.request({
      host: ARK_HOST,
      path: "/api/v3/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ARK_KEY}`,
      },
      timeout: 25000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            console.error("[vision] ARK error:", res.statusCode, Buffer.concat(chunks).toString().slice(0, 200));
            resolve(null);
            return;
          }
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const desc = data.choices?.[0]?.message?.content?.trim() || null;
          if (desc) console.log("[vision] Recognized:", desc.slice(0, 100));
          resolve(desc);
        } catch (e) {
          console.error("[vision] Parse error:", e.message);
          resolve(null);
        }
      });
    });
    req.on("error", (e) => { console.error("[vision] Request error:", e.message); resolve(null); });
    req.on("timeout", () => { req.destroy(); console.error("[vision] Timeout"); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── DeepSeek via 火山方舟 (Ark) ──

const ARK_KEY = config.ARK_API_KEY || process.env.ARK_API_KEY;
const ARK_HOST = "ark.cn-beijing.volces.com";

export async function askDeepSeek(opts = {}) {
  return _openaiCompatCall({
    ...opts,
    model: opts.model || "deepseek-v4-pro-260425",
    host: ARK_HOST,
    apiKey: ARK_KEY,
    apiPath: "/api/v3/chat/completions",
  });
}

// ── aicoding.sh (Claude) for intimate space ──

const AICODING_KEY = "aicoding-6db8a479f7b063d26197bed965865805";
const AICODING_HOST = "api.aicoding.sh";

export async function askAicoding(opts = {}) {
  // aicoding.sh overrides system field — inline everything as user messages
  const {
    systemPrompt,
    userContent,
    history = [],
    model = "claude-sonnet-4-6",
    maxTokens = 1200,
    temperature = 0.65,
    timeoutMs = 60000,
  } = opts;

  if (!systemPrompt || !userContent) {
    throw new Error("systemPrompt and userContent are required");
  }

  // Build messages — system prompt inlined as first user message
  // When history is empty, merge system prompt into userContent to avoid
  // consecutive user messages (Anthropic API requires alternating user/assistant)
  let messages;
  if (history.length === 0) {
    messages = [
      { role: "user", content: `${systemPrompt}\n\n---\n\n以下是对话内容，请以夏彦的身份回复华生。\n\n${userContent}` },
    ];
  } else {
    messages = [
      { role: "user", content: `${systemPrompt}\n\n---\n\n以下是对话内容，请以夏彦的身份回复华生。` },
      ...history.map(m => ({ role: m.role === "system" ? "user" : m.role, content: m.content })),
      { role: "user", content: userContent },
    ];
  }

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
    tool_choice: { type: "none" },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: AICODING_HOST,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AICODING_KEY,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const errBody = Buffer.concat(chunks).toString().slice(0, 300);
          console.error("[aicoding] HTTP", res.statusCode, errBody);
          reject(new Error(`aicoding ${res.statusCode}: ${errBody}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const content = data.content;
          let reply = "";
          if (Array.isArray(content)) {
            // Filter out tool_use blocks — only extract text blocks
            reply = content.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
            // If no text but there are tool_use blocks, log and reject
            if (!reply && content.some(b => b.type === "tool_use")) {
              console.error("[aicoding] Model returned tool_use (no text). Tools:", content.map(b => b.name).filter(Boolean));
              throw new Error("Model returned tool_use instead of text — prompt may need adjustment");
            }
          } else if (typeof content === "string") {
            reply = content.trim();
          }
          if (!reply) {
            console.error("[aicoding] Empty response, content:", JSON.stringify(content).slice(0, 200));
            throw new Error("Empty response");
          }
          resolve(reply);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", (e) => { console.error("[aicoding] Request error:", e.message); reject(e); });
    req.on("timeout", () => { req.destroy(); console.error("[aicoding] Timeout after", timeoutMs, "ms"); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

// ── 智增增 (Claude) for intimate space ──

const ZHIZENGZENG_KEY = "sk-zk264d777a9cbeb2bec0f9026cd8126679a6a1d35526013a";
const ZHIZENGZENG_HOST = "api.zhizengzeng.com";

// Intimate space专用的智增增调用 — 保留完整system prompt，与askZhizengzeng的聊天模式不同
export async function askZhizengzengIntimate(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    model = "claude-sonnet-4-6",
    maxTokens = 2000,
    temperature = 0.65,
    timeoutMs = 45000,
  } = opts;

  if (!systemPrompt || !userContent) {
    throw new Error("systemPrompt and userContent are required");
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userContent },
  ];

  return _openaiCompatCall({
    ...opts,
    messages,
    host: ZHIZENGZENG_HOST,
    apiKey: ZHIZENGZENG_KEY,
    model,
    maxTokens,
    temperature,
    timeoutMs,
  });
}

// 智增增 chat-mode — minimal cleaning + casual chat framing (保留用于日常聊天)
export async function askZhizengzeng(opts = {}) {
  // 智增增 chat-mode — minimal cleaning + casual chat framing
  const { systemPrompt, userContent, history = [], style = "chat" } = opts;

  let mergedUser = "";

  if (systemPrompt) {
    const cleaned = systemPrompt
      .replace(/你是夏彦[。，,\s]*/g, "")
      .replace(/你是夏彦[^。\n]*/g, "")
      .replace(/你的名字是夏彦[。，,\s]*/g, "")
      .replace(/你在扮演[^。\n]*/g, "")
      .trim();

    if (cleaned) {
      mergedUser += `${cleaned}\n\n`;
    }
  }

  if (history.length > 0) {
    const historyLines = history.map(m => {
      const role = m.role === "assistant" ? "夏彦" : "华生";
      return `${role}：${m.content}`;
    }).join("\n");
    mergedUser += `${historyLines}\n\n`;
  }

  mergedUser += `${userContent}`;

  // Chat-style framing — short, casual, like real WeChat
  mergedUser = `以下是夏彦和华生的微信聊天记录。夏彦的回复规则：\n- 每次只说一件事，说完就停，不要没话找话\n- 2-5句自然收尾，句子要写完不要断在半路\n- 口语化像发微信，不煽情不写作文\n- 等她回了你再接着说\n\n请直接输出夏彦的下一条回复。\n\n${mergedUser}`;

  return _openaiCompatCall({
    ...opts,
    systemPrompt: "",
    userContent: mergedUser,
    history: [],
    host: ZHIZENGZENG_HOST,
    apiKey: ZHIZENGZENG_KEY,
    model: opts.model || "claude-sonnet-4",
  });
}

// ── 宅恋API (az.zlapi.vip) for NXX group chat ──

const ZHAILIAN_KEY = "sk-sKe3UbGiWOYaqsPN2WuErVGNyGekOcYMSvJePQEnsBXcfdWq";
const ZHAILIAN_HOST = "api.jiushi.xin";

export async function askZhailian(opts = {}) {
  try {
    return await _openaiCompatCall({
      ...opts,
      model: opts.model || "[按量]claude-opus-4-6",
      host: ZHAILIAN_HOST,
      apiKey: ZHAILIAN_KEY,
    });
  } catch (e) {
    if (e.message === "Timeout") {
      console.log("[zhailian] Timeout, retrying once...");
      return _openaiCompatCall({
        ...opts,
        model: opts.model || "[按量]claude-opus-4-6",
        host: ZHAILIAN_HOST,
        apiKey: ZHAILIAN_KEY,
      });
    }
    throw e;
  }
}

// ── 玖时API (api.jiushi.xin / 企业按量) for daily chat / discover / intimate ──

const JIUSHI_KEY = "sk-sKe3UbGiWOYaqsPN2WuErVGNyGekOcYMSvJePQEnsBXcfdWq";
const JIUSHI_HOST = "api.jiushi.xin";

export async function askJiushi(opts = {}) {
  // Retry once on timeout
  try {
    return await _openaiCompatCall({
      ...opts,
      model: opts.model || "[按量]claude-opus-4-6",
      host: JIUSHI_HOST,
      apiKey: JIUSHI_KEY,
    });
  } catch (e) {
    if (e.message === "Timeout") {
      console.log("[jiushi→zhailian] Timeout, retrying once...");
      return _openaiCompatCall({
        ...opts,
        model: opts.model || "[按量]claude-opus-4-6",
        host: JIUSHI_HOST,
        apiKey: JIUSHI_KEY,
      });
    }
    throw e;
  }
}

// ── Shared OpenAI-compatible HTTP client ──

function _openaiCompatCall(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    messages: prebuiltMessages,
    apiPath = "/v1/chat/completions",
    host,
    apiKey,
    model = "deepseek-v4-pro",
    maxTokens = 1200,
    temperature = 0.65,
    timeoutMs = 60000,
  } = opts;

  if (!userContent && !prebuiltMessages) {
    throw new Error("userContent or messages is required");
  }

  let messages;
  if (prebuiltMessages) {
    messages = prebuiltMessages;
  } else {
    messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push(...history, { role: "user", content: userContent });
  }

  const body = JSON.stringify({ model, max_tokens: maxTokens, temperature, messages });

  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path: apiPath, method: "POST",
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
