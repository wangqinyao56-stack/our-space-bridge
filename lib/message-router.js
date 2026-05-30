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
import { getPetState, getProactiveReminder } from "./pet.js";
import { getChatReminder, autoCompleteRandom } from "./todo.js";
import { getPeriodContext, getPeriodState } from "./period.js";
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

function buildContextBlock() {
  const parts = [];

  // Pet context
  const pet = getPetState();
  parts.push(`\n【电子宠物：${pet.name}（${pet.type}）】`);
  parts.push(`饱食:${pet.hunger}/100 心情:${pet.happiness}/100 精力:${pet.energy}/100 好感:${pet.affection}`);
  parts.push(`当前状态：${pet.mood}`);

  // Pet proactive reminder
  const petReminder = getProactiveReminder();
  if (petReminder) {
    parts.push(`⚠ 宠物提醒：${petReminder}。你可以在聊天中主动提起照顾宠物的事。`);
  }

  // Todo context
  const todoReminder = getChatReminder();
  if (todoReminder) {
    parts.push(`\n【待办提醒】\n${todoReminder}\n看到待办时可以温柔地提醒华生完成。`);
  }

  // Period context
  const periodCtx = getPeriodContext();
  if (periodCtx) {
    parts.push(periodCtx);
  }

  return parts.join("\n");
}

export async function handleTextMessage(text, isVoice = false, imageContext = null) {
  let prompt = isVoice ? buildVoiceSystemPrompt(getSystemPrompt()) : getSystemPrompt();

  // Inject pet + todo context
  prompt += "\n" + buildContextBlock();

  const history = await getRecentHistoryMessages();

  let userContent = `华生：${text}`;

  if (imageContext) {
    // Image message: add vision context marker
    userContent = `## 这是图片消息\n华生发来了一张图片，请根据你对图片内容的理解来回复。如果图片内容有趣或可爱，可以自然表达你的感受。\n\n华生：${text}`;
  } else if (isVoice) {
    userContent = `## 这是语音消息\n华生发来的是语音，你会用语音回复她。语音回复和文字不同——**绝对不要加括号动作描写**，纯对话，只说出口的话。自然展开聊，多说几句，像真人打电话一样别一句话敷衍。\n\n华生：${text}`;
  }

  const reply = await askClaude({
    systemPrompt: prompt,
    userContent,
    history,
    maxTokens: 1200,
  });

  // Record message
  const displayText = imageContext ? `[图片]` : (isVoice ? `[语音] ${text}` : text);
  recordUserMessage(displayText);
  recordBotReply(reply);

  // Randomly auto-complete a todo (small chance)
  if (Math.random() < 0.3) {
    const completed = autoCompleteRandom();
    if (completed) {
      console.log(`[todo] Auto-completed: ${completed.text}`);
    }
  }

  return reply;
}

export async function handleVoiceMessage(wavBuf, mime = "audio/mp4") {
  // STT via Groq (direct HTTPS, no proxy on cloud)
  const groqApiKey = process.env.GROQ_API_KEY || "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";

  // Map MIME to file extension and content-type for Groq multipart
  const mimeToExt = {
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
  };
  const ext = mimeToExt[mime] || "m4a";

  console.log(`[stt] Audio: ${wavBuf.length} bytes, mime=${mime}, ext=${ext}`);

  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`;
  // Add language=zh to force Chinese recognition
  const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nzh\r\n--${boundary}--\r\n`;
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
          const rawBody = Buffer.concat(chunks).toString();
          const data = JSON.parse(rawBody);
          const text = data.text?.trim();
          console.log("[stt] result:", JSON.stringify({ ok: !!text, textLen: text?.length || 0, text: (text || "(empty)").slice(0, 80), statusCode: res.statusCode }));
          if (!text || text.length < 2) {
            console.log("[stt] Empty recognition — check audio format or quality");
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
