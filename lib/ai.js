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

// ── 智谱 GLM-4V 视觉识别 ──
const ZHIPU_VISION_MODEL = "glm-4v-plus";
const ZHIPU_HOST = "open.bigmodel.cn";

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
    model: ZHIPU_VISION_MODEL,
    max_tokens: 300,
    temperature: 0.5,
    messages,
  });

  return new Promise((resolve) => {
    const req = https.request({
      host: ZHIPU_HOST,
      path: "/api/paas/v4/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.ZHIPU_API_KEY}`,
      },
      timeout: 25000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            console.error("[vision] Zhipu error:", res.statusCode, Buffer.concat(chunks).toString().slice(0, 200));
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

// ── DeepSeek via 玖时 (api.jiushi.xin) ──

const DEEPSEEK_KEY = "sk-sKe3UbGiWOYaqsPN2WuErVGNyGekOcYMSvJePQEnsBXcfdWq";
const DEEPSEEK_HOST = "api.jiushi.xin";
const DEEPSEEK_MODEL = "gpt-5.4";

export async function askDeepSeek(opts = {}) {
  try {
    return await _openaiCompatCall({
      ...opts,
      model: opts.model || DEEPSEEK_MODEL,
      host: DEEPSEEK_HOST,
      apiKey: DEEPSEEK_KEY,
    });
  } catch (e) {
    console.log("[deepseek] First attempt failed:", e.message, "retrying in 3s...");
    await new Promise(r => setTimeout(r, 3000));
    return _openaiCompatCall({
      ...opts,
      model: opts.model || DEEPSEEK_MODEL,
      host: DEEPSEEK_HOST,
      apiKey: DEEPSEEK_KEY,
    });
  }
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

const ZHAILIAN_KEY = "sk-pJzEUjdQT4nC3AAVl7mJap0H0jXXyFlJtNo0R7njaGExFTvW";
const ZHAILIAN_HOST = "az.zlapi.vip";

export async function askZhailian(opts = {}) {
  try {
    return await _openaiCompatCall({
      ...opts,
      model: opts.model || "[0.01]限时/claude-opus-5",
      host: ZHAILIAN_HOST,
      apiKey: ZHAILIAN_KEY,
    });
  } catch (e) {
    if (e.message === "Timeout") {
      console.log("[zhailian] Timeout, retrying once...");
      return _openaiCompatCall({
        ...opts,
        model: opts.model || "[0.01]限时/claude-opus-5",
        host: ZHAILIAN_HOST,
        apiKey: ZHAILIAN_KEY,
      });
    }
    throw e;
  }
}

// ── 玖时API (api.jiushi.xin / 按量) for daily chat / discover / intimate ──

const JIUSHI_KEY = "sk-sKe3UbGiWOYaqsPN2WuErVGNyGekOcYMSvJePQEnsBXcfdWq";
const JIUSHI_HOST = "api.jiushi.xin";

export async function askJiushi(opts = {}) {
  try {
    return await _openaiCompatCall({
      ...opts,
      model: opts.model || "[企业按量]claude-opus-4-6",
      host: JIUSHI_HOST,
      apiKey: JIUSHI_KEY,
    });
  } catch (e) {
    console.log("[jiushi] Claude failed (" + e.message + "), falling back to 宅恋...");
    const rest = { ...opts };
    delete rest.model; // 去掉玖时专用 model，宅恋用自己默认 [0.05]报用鹿/claude-opus-4.5
    return askZhailian(rest);
  }
}

// 玖时流式（SSE）——逐字吐文本。失败且尚未吐任何字时回退非流式宅恋。
export async function* askJiushiStream(opts = {}) {
  let emitted = false;
  try {
    for await (const delta of _openaiStream({
      ...opts,
      model: opts.model || "[企业按量]claude-opus-4-6",
      host: JIUSHI_HOST,
      apiKey: JIUSHI_KEY,
    })) {
      emitted = true;
      yield delta;
    }
    if (!emitted) throw new Error("Empty stream");
  } catch (e) {
    if (emitted) throw e;
    console.log("[jiushi-stream] 流式失败 (" + e.message + ")，回退非流式宅恋");
    const rest = { ...opts };
    delete rest.model;
    const full = await askZhailian(rest);
    yield full;
  }
}

// ── Shared OpenAI-compatible streaming client (SSE) ──

async function* _openaiStream(opts = {}) {
  const {
    systemPrompt,
    userContent,
    history = [],
    messages: prebuiltMessages,
    host,
    apiKey,
    model = "deepseek-v4-pro",
    maxTokens = 500,
    temperature = 0.7,
    timeoutMs = 90000,
  } = opts;

  let messages;
  if (prebuiltMessages) {
    messages = prebuiltMessages;
  } else {
    messages = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push(...history, { role: "user", content: userContent });
  }

  const body = JSON.stringify({ model, max_tokens: maxTokens, temperature, messages, stream: true });

  const raw = await new Promise((resolve, reject) => {
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
        } else {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    } catch {}
  }
}

// ── Shared OpenAI-compatible HTTP client ──

async function _openaiCompatCall(opts = {}) {
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
    timeoutMs = 90000,
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

  const doCall = () => new Promise((resolve, reject) => {
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

  // 429 限流退避重试：玖时提示 quota reset after 1s，撞上限流停一下再试基本就过
  const MAX_RETRIES = 2;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await doCall();
    } catch (err) {
      lastErr = err;
      const isRateLimited = String(err?.message || "").includes("429");
      if (!isRateLimited || attempt >= MAX_RETRIES) throw lastErr;
      const waitMs = 1500 * (attempt + 1);
      console.error(`[ai] 429 限流，${waitMs}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
