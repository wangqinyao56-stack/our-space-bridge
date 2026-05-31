/**
 * OpenRouter AI client — standalone, no proxy needed on cloud.
 */
import https from "node:https";
import config from "../config.js";

const API_KEY = config.OPENROUTER_API_KEY;
const BASE_URL = "openrouter.ai";

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
      host: BASE_URL, path: "/api/v1/chat/completions", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
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
