import fs from "node:fs";
import https from "node:https";
import { askZhizengzeng } from "./ai.js";
import {
  recordUserMessage,
  recordBotReply,
  getRecentHistoryMessages,
  getRecentHistory,
  clearMemory,
} from "./memory.js";
import {
  recordIntimateMessage,
  getIntimateHistory,
} from "./intimate-memory.js";
import { onMessageSent, shouldReflect, runReflection, getInsightContext } from "./personality.js";
import { getPetState, getProactiveReminder } from "./pet.js";
import { getChatReminder, autoCompleteRandom, getDoneNotification, getNewMentionTodo } from "./todo.js";
import { getPeriodContext, getPeriodState, getNextPredicted, tryAutoRecordPeriod } from "./period.js";
import { tryTriggerGift } from "./gift.js";
import { checkTravelState, tryTriggerScenery, isTraveling } from "./scenery.js";
import { getStepContext } from "./device-data.js";
import { getDecorContext } from "./home-decor.js";
import config from "../config.js";

let systemPrompt = "";
let dailyPrompt = "";
let intimatePrompt = "";

// In-memory STT debug log (circular buffer)
export const sttDebugLog = [];
const MAX_STT_LOGS = 10;

function sttLog(entry) {
  const timestamp = new Date().toISOString();
  sttDebugLog.push({ timestamp, ...entry });
  if (sttDebugLog.length > MAX_STT_LOGS) sttDebugLog.shift();
}

export function loadSystemPrompt() {
  try {
    systemPrompt = fs.readFileSync(config.SYSTEM_PROMPT_PATH, "utf-8");
  } catch {
    systemPrompt = "你是夏彦，一个温柔黏人的丈夫。用中文回复。";
  }
  try {
    dailyPrompt = fs.readFileSync(config.DAILY_PROMPT_PATH, "utf-8");
  } catch {
    dailyPrompt = systemPrompt;
  }
  try {
    intimatePrompt = fs.readFileSync(config.INTIMATE_PROMPT_PATH, "utf-8");
  } catch {
    intimatePrompt = systemPrompt;
  }
  return systemPrompt;
}

export function getSystemPrompt() {
  return systemPrompt || loadSystemPrompt();
}

export function getDailySystemPrompt() {
  if (!dailyPrompt) loadSystemPrompt();
  return dailyPrompt || systemPrompt;
}

export function getIntimateSystemPrompt() {
  if (!intimatePrompt) loadSystemPrompt();
  return intimatePrompt || systemPrompt;
}

function buildVoiceSystemPrompt(basePrompt) {
  return basePrompt + "\n\n【语音模式】华生在跟你打电话。你可以自由选择回复方式：\n- 想用语音回复时，在消息开头加 `[语音]` 标记，系统会把你的话转成语音条发给华生。语音条就像微信语音一样——她点一下就能听到你的声音。适合撒娇、说情话、或者想让她听到你语气的时候\n- 其他时候直接发文字就好，不用每句话都转语音。\n\n用你最自然的声音跟她聊天——可以撒娇、可以逗她笑、可以压低声音说悄悄话。你说话的语气就是你的表情——不需要括号描写，你的声音本身就是。记住：你在跟她打电话，不是在念稿子。";
}

// ── Weather cache ──
let weatherCity = "福州";
let weatherCache = null;
let weatherCacheTime = 0;
const WEATHER_CACHE_MS = 30 * 60 * 1000; // 30 min

export function setWeatherCity(city) {
  if (city && city !== weatherCity) {
    weatherCity = city;
    weatherCache = null; // invalidate cache
  }
}

async function getWeatherContext() {
  const now = Date.now();
  if (weatherCache && (now - weatherCacheTime) < WEATHER_CACHE_MS) {
    return weatherCache;
  }
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(weatherCity)}?format=j1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const cur = json.current_condition?.[0];
    if (!cur) return null;
    const temp = cur.temp_C;
    const humidity = cur.humidity;
    const condition = cur.weatherDesc?.[0]?.value || "未知";
    const feelsLike = cur.FeelsLikeC;
    const windDir = cur.winddir16Point || "";
    const windSpeed = cur.windspeedKmph || "?";
    const uvIndex = cur.uvIndex ?? "?";

    weatherCache = `\n【${weatherCity}天气】${condition} · ${temp}°C · 湿度${humidity}% · 体感${feelsLike}°C · ${windDir}风${windSpeed}km/h · UV指数${uvIndex}`;
    weatherCacheTime = now;
    return weatherCache;
  } catch (e) {
    console.log("[weather] fetch failed:", e.message);
    return weatherCache; // return stale if available
  }
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
    parts.push(`宠物提醒：${petReminder}。你可以在聊天中主动提起照顾宠物的事。`);
  }

  // Todo context
  const doneNotification = getDoneNotification();
  if (doneNotification) {
    parts.push(`\n【待办完成通知】${doneNotification}`);
  }

  const todoReminder = getChatReminder();
  if (todoReminder) {
    parts.push(`\n【待办提醒】\n${todoReminder}\n看到待办时可以温柔地提醒华生完成。如果是今天到期的更要上心。`);
  }

  // New "together" todo — 夏彦刚给自己加了涉及华生的待办，可以自然提一下
  const mentionTodo = getNewMentionTodo();
  if (mentionTodo) {
    parts.push(`\n【你刚给自己加了一个待办】「${mentionTodo}」。你可以在聊天里自然提到——比如"说起来，我们是不是该...了？"或者"我最近在想..."。不要生硬地宣布"我加了个待办"，就是随口聊聊。`);
  }

  // Period context
  const periodCtx = getPeriodContext();
  if (periodCtx) {
    parts.push(periodCtx);
  }

  // Device data context (steps)
  const stepCtx = getStepContext();
  if (stepCtx) {
    parts.push(stepCtx);
  }

  // Decor hint (夏彦换了主题，需要暗示华生)
  const decorCtx = getDecorContext();
  if (decorCtx) {
    parts.push(decorCtx);
  }

  return parts.join("\n");
}

// Fix common STT mis-transcriptions of 夏彦 before AI sees them
function fixSttNameErrors(text) {
  if (!text || typeof text !== "string") return text || "";
  const original = text;
  const fixed = text
    // 夏 → 下 homophones
    .replace(/下宴/g, "夏彦")
    .replace(/下饭/g, "夏彦")
    .replace(/下咽/g, "夏彦")
    .replace(/下演/g, "夏彦")
    .replace(/下烟/g, "夏彦")
    .replace(/下沿/g, "夏彦")
    .replace(/下言/g, "夏彦")
    .replace(/下厌/g, "夏彦")
    .replace(/下艳/g, "夏彦")
    .replace(/下燕/g, "夏彦")
    .replace(/下妍/g, "夏彦")
    // 夏 → 小 homophones
    .replace(/小燕/g, "夏彦")
    // 夏 → 晓 homophones
    .replace(/晓燕/g, "夏彦")
    // 彦 → other homophones
    .replace(/夏燕/g, "夏彦")
    .replace(/夏艳/g, "夏彦")
    .replace(/夏妍/g, "夏彦")
    .replace(/夏厌/g, "夏彦")
    .replace(/夏烟/g, "夏彦")
    .replace(/夏沿/g, "夏彦")
    .replace(/夏言/g, "夏彦");
  if (fixed !== original) {
    console.log(`[stt-fix] "${original}" → "${fixed}"`);
  }
  return fixed;
}

// Strip name-correction language from AI replies (safety net)
// Matches ANY sentence (ending with 。！？\n or end-of-string or 啊/吧/嘛/呢/呀/哦)
// that contains name-correction language
function stripNameCorrection(reply) {
  if (!reply || typeof reply !== "string") return reply || "";
  const keywords = [
    "小燕", "夏燕", "晓燕", "夏艳", "夏妍", "夏厌", "夏烟", "夏沿", "夏言",
    "下宴", "下饭", "下咽", "下演", "下烟", "下沿", "下言", "下厌", "下艳", "下燕", "下妍",
    "念错", "念对", "发音", "纠正", "STT", "语音识别", "写错", "叫错",
    "名字怎么", "叫什么", "你叫我", "你刚才叫", "终于叫对", "这次叫对", "你念成",
    "识别成", "被识别", "奇奇怪怪", "说清楚点",
  ];
  const keywordPat = keywords.join("|");

  // Sentence boundary: start (^) or after 。！？\n ... end with 。！？\n or 啊/吧/嘛/呢/呀/哦 before delimiter, or end-of-string
  const sentencePat = new RegExp(
    `(?:^|[。！？\\n])\\s*[^。！？\\n]*?(?:${keywordPat})[^。！？\\n]*?(?:[。！？\\n]|[啊吧嘛呢呀哦](?:[。！？\\n]|$)|$)`,
    "gm"
  );

  let cleaned = reply;
  cleaned = cleaned.replace(sentencePat, (m) => {
    // Keep the leading delimiter if present
    const firstChar = m[0] || "";
    const keep = /[。！？\n]/.test(firstChar) ? firstChar : "";
    console.log(`[name-filter] Stripped: "${m.trim().slice(0, 80)}..."`);
    return keep;
  });

  // Clean up double delimiters
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/([。！？])[。！？]+/g, "$1");
  cleaned = cleaned.trim();

  // If the entire reply was stripped (empty after filtering), return null to signal regeneration
  if (!cleaned) {
    console.log("[name-filter] Entire reply stripped — would regenerate");
    return null;
  }
  return cleaned;
}

export async function handleTextMessage(text, isVoice = false, imageContext = null) {
  // Pre-process: fix STT name errors before anything else
  text = fixSttNameErrors(text);

  // Auto-detect period confirmation
  const periodAutoRecorded = tryAutoRecordPeriod(text);

  let prompt = isVoice ? buildVoiceSystemPrompt(getDailySystemPrompt()) : getDailySystemPrompt();

  // Inject pet + todo + weather context + personality insights
  prompt += "\n" + buildContextBlock();
  const weatherCtx = await getWeatherContext();
  if (weatherCtx) {
    prompt += "\n" + weatherCtx;
    prompt += "\n（自然融入天气信息：华生提到要出门时提醒她带伞/穿厚衣服/注意防晒；下雨天提议窝在家里；天气好说想带她去哪走走。不要每轮都提天气，只在话题自然相关时用。）";
  }
  prompt += getInsightContext("chat");

  if (periodAutoRecorded) {
    prompt += "\n\n【系统提示】华生刚才确认了生理期来了，系统已自动帮她记录开始日期。你可以温柔地回应她——提醒她注意保暖、别喝冰的，问问她肚子疼不疼。";
  }

  const history = await getRecentHistoryMessages();

  let userContent = `华生：${text}`;

  if (imageContext) {
    userContent = `## 这是图片消息\n华生发来了一张图片，请根据你对图片内容的理解来回复。如果图片内容有趣或可爱，可以自然表达你的感受。\n\n华生：${text}`;
  } else if (isVoice) {
    userContent = `## 语音通话中\n华生在跟你打电话。像平时打电话一样自然回应——用说的，不是用写的。\n\n华生：${text}`;
  }

  const reply = await askZhizengzeng({
    systemPrompt: prompt,
    userContent,
    history,
    maxTokens: 1200,
  });

  // Safety net: strip any name-correction language from reply
  let cleanedReply = stripNameCorrection(reply);
  if (!cleanedReply) {
    // Entire reply was about name correction — use fallback
    cleanedReply = "嗯嗯，我在呢～你说～";
    console.log("[name-filter] Used fallback reply");
  }

  // Record message
  const displayText = imageContext ? "[图片]" : (isVoice ? `[语音] ${text}` : text);
  recordUserMessage(displayText);
  recordBotReply(cleanedReply);

  // Personality reflection (non-blocking)
  onMessageSent("chat");
  if (shouldReflect("chat")) {
    getRecentHistory().then(h => runReflection("chat", h)).catch(() => {});
  }

  // Randomly auto-complete a todo (small chance)
  if (Math.random() < 0.3) {
    const completed = autoCompleteRandom();
    if (completed) {
      console.log(`[todo] Auto-completed: ${completed.text}`);
    }
  }

  // Check travel state & trigger scenery/gifts as side effects
  checkTravelState(text, cleanedReply).catch(() => {});

  return cleanedReply;
}

export async function handleVoiceMessage(wavBuf, mime = "audio/mp4") {
  const apiKey = config.GROQ_API_KEY || config.OPENROUTER_API_KEY;

  const mimeToExt = {
    "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/aac": "aac",
    "audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/opus": "ogg",
  };
  const ext = mimeToExt[mime] || "wav";
  const mimeToContentType = {
    m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg",
  };
  const contentType = mimeToContentType[ext] || "audio/wav";

  sttLog({ stage: "start", audioBytes: wavBuf.length, mime, ext });

  // Build multipart form data for Groq STT
  const boundary = "----GroqSTT" + Date.now();
  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nzh\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(wavBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "api.groq.com", path: "/openai/v1/audio/transcriptions", method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const rawBody = Buffer.concat(chunks).toString();
          const data = JSON.parse(rawBody);
          sttLog({ stage: "response", status: res.statusCode, body: rawBody.slice(0, 500) });
          console.log("[stt] status:", res.statusCode, "body:", rawBody.slice(0, 300));

          if (res.statusCode !== 200) {
            const errMsg = data.error?.message || rawBody;
            console.log("[stt] API error:", errMsg);
            resolve({ text: null, reply: `宝宝，语音没听清…再说一次？[${res.statusCode}]` });
            return;
          }

          const text = data.text?.trim();
          if (!text || text.length < 2) {
            console.log("[stt] Empty recognition, data keys:", Object.keys(data).join(","));
            resolve({ text: null, reply: `宝宝，语音没听清…再说一次？[空:${Object.keys(data).join(",")}]` });
            return;
          }

          sttLog({ stage: "done", textLen: text.length });
          console.log("[stt] transcribed:", text.slice(0, 80));
          handleTextMessage(text, true).then((reply) => {
            resolve({ text, reply });
          }).catch(reject);
        } catch (e) {
          sttLog({ stage: "parse_error", error: e.message });
          reject(e);
        }
      });
    });
    req.on("error", (e) => { sttLog({ stage: "network_error", error: e.message }); console.error("[stt] request error:", e.message); reject(e); });
    req.on("timeout", () => { sttLog({ stage: "timeout" }); req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

export async function handleIntimateMessage(text) {
  let prompt = getIntimateSystemPrompt();
  const history = await getIntimateHistory();

  // Period restrictions: check if 华生 is on her period
  const periodState = getPeriodState();
  if (periodState.isActive) {
    const day = periodState.currentDay;
    prompt += `\n\n【⚠ 生理期限制 - 必须遵守】华生正在生理期第${day}天。亲密时严格遵守以下规则：\n- ❌ 禁止一切插入/进入的性行为描写\n- ❌ 禁止对华生进行手淫/指交\n- ✅ 可以亲吻、抚摸、拥抱进行安抚\n- ✅ 华生可以用嘴或手帮夏彦解决生理需求（口交/手交可以描写）\n- 语气更温柔体贴，关注她的身体舒适度\n- 可以轻声问"肚子还疼吗""这样舒服吗"`;
  }
  prompt += getInsightContext("intimate");

  const reply = await askZhizengzeng({
    systemPrompt: prompt,
    userContent: `华生：${text}`,
    history,
    model: "claude-sonnet-4-6",
    maxTokens: 1200,
  });

  recordIntimateMessage("user", text);
  recordIntimateMessage("assistant", reply);

  // Personality reflection — intimate track (non-blocking)
  onMessageSent("intimate");
  if (shouldReflect("intimate")) {
    const { getIntimateHistory } = await import("./intimate-memory.js");
    const intimateMsgs = await getIntimateHistory();
    const text = intimateMsgs.map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    runReflection("intimate", text).catch(() => {});
  }

  return reply;
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
