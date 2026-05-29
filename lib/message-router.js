import fs from "node:fs";
import https from "node:https";
import { askClaude } from "./ai.js";
import {
  recordUserMessage,
  recordBotReply,
  getRecentHistoryMessages,
  getRecentHistory,
  clearMemory,
} from "./memory.js";
import config from "../config.js";

let systemPrompt = "";

export function loadSystemPrompt() {
  try {
    systemPrompt = fs.readFileSync(config.SYSTEM_PROMPT_PATH, "utf-8");
  } catch {
    systemPrompt = "你是夏彦，一个温柔黏人的丈夫。用中文回复。";
  }
  return systemPrompt;
}

export function getSystemPrompt() {
  return systemPrompt || loadSystemPrompt();
}

function buildVoiceSystemPrompt(basePrompt) {
  return basePrompt + "\n\n【语音模式】你现在用语音回复。纯对话，不要加括号动作描写，自然展开聊，多说几句，像真人打电话一样别一句话敷衍。";
}

export async function handleTextMessage(text, isVoice = false) {
  const prompt = isVoice ? buildVoiceSystemPrompt(getSystemPrompt()) : getSystemPrompt();
  const history = await getRecentHistoryMessages();

  let userContent = `华生：${text}`;
  if (isVoice) {
    userContent = `## 这是语音消息\n华生发来的是语音，你会用语音回复她。语音回复和文字不同——**绝对不要加括号动作描写**，纯对话，只说出口的话。自然展开聊，多说几句，像真人打电话一样别一句话敷衍。\n\n华生：${text}`;
  }

  const reply = await askClaude({
    systemPrompt: prompt,
    userContent,
    history,
    maxTokens: 1200,
  });

  recordUserMessage(isVoice ? `[语音] ${text}` : text);
  recordBotReply(reply);

  return reply;
}

export async function handleVoiceMessage(wavBuf) {
  // STT via Groq (direct HTTPS, no proxy on cloud)
  const groqApiKey = process.env.GROQ_API_KEY || "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";

  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`;
  const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(header), wavBuf, Buffer.from(footer)]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "api.groq.com", path: "/openai/v1/audio/transcriptions", method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const text = data.text?.trim();
          if (!text || text.length < 2) {
            resolve({ text: null, reply: "宝宝，语音没听清…再说一次？" });
            return;
          }
          handleTextMessage(text, true).then((reply) => {
            resolve({ text, reply });
          }).catch(reject);
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

export function getChatHistory() {
  return getRecentHistory();
}

export function getChatHistoryMessages() {
  return getRecentHistoryMessages();
}

export function clearChatHistory() {
  clearMemory();
}
