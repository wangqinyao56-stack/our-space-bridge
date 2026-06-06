import fs from "node:fs";
import https from "node:https";
import { askDeepSeek, askZhizengzeng, askJiushi } from "./ai.js";
import {
  recordUserMessage,
  recordBotReply,
  getRecentHistoryMessages,
  getRecentHistory,
  clearMemory,
  deleteMessage,
} from "./memory.js";
import {
  recordIntimateMessage,
  getIntimateHistory,
  deleteIntimateMessage,
} from "./intimate-memory.js";
import { onMessageSent, shouldReflect, runReflection, getInsightContext } from "./personality.js";
import { getPetState, getProactiveReminder } from "./pet.js";
import { getProactiveState } from "./proactive-chat.js";
import { getChatReminder, autoCompleteRandom, getDoneNotification, getNewMentionTodo, getTodoMemoryContext } from "./todo.js";
import { getPeriodContext, getPeriodState, getNextPredicted, tryAutoRecordPeriod } from "./period.js";
import { tryTriggerGift } from "./gift.js";
import { checkTravelState, tryTriggerScenery, isTraveling, getTravelChatContext, getTravelIntimateContext, confirmAnnounced, confirmReturned, getTravelState } from "./scenery.js";
import { isHuashengTraveling, detectHuashengTravelKeywords, activateHuashengTravel, deactivateHuashengTravel, getHuashengTravelContext } from "./huasheng-travel.js";
import { getStepContext } from "./device-data.js";
import { getDecorContext } from "./home-decor.js";
import config from "../config.js";

let systemPrompt = "";
let dailyPrompt = "";
let intimatePrompt = "";
let travelPrompt = "";
let travelIntimatePrompt = "";
let huashengTravelPrompt = "";

// In-memory STT debug log (circular buffer)
export const sttDebugLog = [];
const MAX_STT_LOGS = 10;

function sttLog(entry) {
  const timestamp = new Date().toISOString();
  sttDebugLog.push({ timestamp, ...entry });
  if (sttDebugLog.length > MAX_STT_LOGS) sttDebugLog.shift();
}

// In-memory intimate processing debug log
export const intimateDebugLog = [];
const MAX_INTIMATE_LOGS = 20;

function intimateLog(entry) {
  const timestamp = new Date().toISOString();
  intimateDebugLog.push({ timestamp, ...entry });
  if (intimateDebugLog.length > MAX_INTIMATE_LOGS) intimateDebugLog.shift();
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
  try {
    travelPrompt = fs.readFileSync(config.TRAVEL_PROMPT_PATH, "utf-8");
  } catch {
    travelPrompt = dailyPrompt; // fallback to daily if travel prompt missing
  }
  try {
    travelIntimatePrompt = fs.readFileSync(config.TRAVEL_INTIMATE_PROMPT_PATH, "utf-8");
  } catch {
    travelIntimatePrompt = intimatePrompt; // fallback to intimate if travel intimate missing
  }
  try {
    huashengTravelPrompt = fs.readFileSync(config.HUASHENG_TRAVEL_PROMPT_PATH, "utf-8");
  } catch {
    huashengTravelPrompt = dailyPrompt; // fallback to daily
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

export function getTravelSystemPrompt() {
  if (!travelPrompt) loadSystemPrompt();
  return travelPrompt || dailyPrompt || systemPrompt;
}

export function getTravelIntimateSystemPrompt() {
  if (!travelIntimatePrompt) loadSystemPrompt();
  return travelIntimatePrompt || intimatePrompt || systemPrompt;
}

export function getHuashengTravelSystemPrompt() {
  if (!huashengTravelPrompt) loadSystemPrompt();
  return huashengTravelPrompt || dailyPrompt || systemPrompt;
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

function chinaHour() {
  return (new Date().getUTCHours() + 8) % 24;
}

function getTimeContext() {
  const hour = chinaHour();
  const timeStr = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });

  let guidance = "";
  if (hour >= 0 && hour < 2) {
    guidance = "现在是午夜。华生一般凌晨2点才睡，现在她还在画画或做自己的事，是正常的晚间活动时间。不用催她睡觉。可以陪她聊聊天、问问她在画什么。语气轻松自然，像深夜的陪伴。";
  } else if (hour >= 2 && hour < 6) {
    guidance = "现在是凌晨深夜。华生凌晨2点睡觉，这个时间她应该已经睡了。如果她还在跟你聊天，说明她失眠或熬夜了。绝对不要提吃的、外卖、出门活动。温柔地陪她、轻声哄她睡觉，语气要低柔，像在耳边说悄悄话。";
  } else if (hour >= 6 && hour < 11) {
    guidance = "现在是早上。但华生凌晨2点才睡、一般11点起床，现在她还在睡觉。不要催促她起床、不要问她要吃什么早餐、不要提早饭——她不吃早饭。如果她已经在跟你聊天，说明她提前醒了，可以轻声问一句怎么醒了，但不要急着聊白天的计划。语气要轻柔。";
  } else if (hour >= 11 && hour < 12) {
    guidance = "华生刚醒。她大概11点起床，现在可能在迷糊中。不要提「已经中午了」——她就是这个作息。可以温柔地问醒了没、睡得好不好。她的一天刚开始了。";
  } else if (hour >= 12 && hour < 14) {
    guidance = "现在是中午。华生12点左右吃午饭，这是她一天的第一顿饭。问问她中午想吃什么，提醒她别空着肚子画画。";
  } else if (hour >= 14 && hour < 18) {
    guidance = "现在是下午。华生在家画画。你继续在外面忙，可以分享下午遇到的事。";
  } else if (hour >= 18 && hour < 21) {
    guidance = "现在是晚上。华生6点左右吃晚饭。你已经回家了，在家陪她。可以聊晚饭、一起做的事。可以有肢体接触的表达。";
  } else {
    guidance = "现在是夜里。华生在画画或做自己的事。你已经在家陪她了。可以聊她在画什么、一起窝着。她凌晨2点左右才睡，不用急着催她。有亲密互动的话会睡得更晚。";
  }

  return `\n【当前时间】北京时间 ${timeStr}（${guidance}）`;
}

function buildContextBlock() {
  const parts = [];

  // Pet context — background only, 华生不提你就别提
  const pet = getPetState();
  parts.push(`\n【电子宠物：${pet.name}（${pet.type}）— 背景信息，不要主动提起】`);
  parts.push(`饱食:${pet.hunger}/100 心情:${pet.happiness}/100 精力:${pet.energy}/100 好感:${pet.affection}`);
  parts.push(`当前状态：${pet.mood}`);

  // Pet proactive reminder — background info only, do NOT mention unless 华生 asks
  const petReminder = getProactiveReminder();
  if (petReminder) {
    parts.push(`宠物状态（背景信息，华生不提你就别提）：${petReminder}`);
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

  // Todo memory + today's overview
  const todoMemoryCtx = getTodoMemoryContext();
  if (todoMemoryCtx) {
    parts.push(todoMemoryCtx);
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

  // CRITICAL: only pick ONE contextual element to mention naturally
  if (parts.length > 0) {
    parts.push(`\n【话题聚焦——最重要】以上这些是给你的背景信息参考，不是话题清单。**你最多只能选其中1个自然地融入聊天**，其余的忽略掉。千万不要试图每一项都提一遍——那会让话题跳来跳去。当前华生跟你聊什么，你就围绕什么聊。背景信息只是辅助，不是任务列表。\n【一次最多问一个问题】不要一口气问四五个问题——你是老公不是问卷调查。每次回复最多问1个问题，其余的等华生回应后再继续聊。`);
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

// Strip Chinese bracket action descriptions from chat replies (safety net)
// Normal chat must be pure text — no （笑）、（揉揉你的头发） etc.
function stripBracketActions(text) {
  if (!text || typeof text !== "string") return text || "";
  // Match full-width parentheses: （ ... ）
  const cleaned = text.replace(/（[^）]*）/g, "").replace(/（[^）]*）/g, "");
  // Clean up double spaces and hanging punctuation
  const tidied = cleaned.replace(/ {2,}/g, " ").replace(/，\s*，/g, "，").replace(/。\s*。/g, "。").trim();
  if (tidied !== text) {
    console.log(`[bracket-filter] Stripped bracket actions`);
  }
  return tidied;
}

// Strip yellow-face emojis from AI replies (safety net — prompt rule isn't enough)
const YELLOW_FACE_EMOJIS = /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F92F}\u{1F970}\u{1F973}-\u{1F976}\u{1F97A}\u{1F978}\u{1F979}\u{1F9D0}\u{2639}\u{263A}\u{263B}\u{1F480}\u{1F47F}\u{1F608}\u{1F47D}\u{1F916}\u{1F47B}\u{1F47E}\u{1F4A9}\u{1F31E}]/gu;

function stripYellowFaces(text) {
  if (!text || typeof text !== "string") return text || "";
  const cleaned = text.replace(YELLOW_FACE_EMOJIS, "");
  if (cleaned !== text) {
    console.log(`[emoji-filter] Stripped yellow-face emojis`);
  }
  return cleaned;
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

// ── Chat scene image detection ──
// Scenes 夏彦 might describe that would benefit from an illustration
const SCENE_PATTERNS = [
  { keywords: ["咖啡", "拿铁", "美式", "卡布奇诺", "摩卡", "冷萃", "咖啡馆", "咖啡店"], imageKeyword: "coffee latte art cafe", fluxPrompt: "a beautiful cup of latte art coffee on a cafe table, warm cozy atmosphere, no humans" },
  { keywords: ["蛋糕", "甜点", "布丁", "面包", "饼干", "烘焙", "烤", "甜品", "点心"], imageKeyword: "dessert pastry baking homemade", fluxPrompt: "delicious homemade pastry or dessert on a plate, warm lighting, food photography, no humans" },
  { keywords: ["花", "花园", "开花", "花海", "花瓣", "玫瑰", "向日葵", "雏菊", "樱花", "花束"], imageKeyword: "beautiful flowers garden bloom", fluxPrompt: "beautiful flowers in bloom, garden photography, natural sunlight, no humans" },
  { keywords: ["公园", "散步", "户外", "河边", "湖边", "草地", "树林", "山路", "小径"], imageKeyword: "park nature path scenery landscape", fluxPrompt: "peaceful park or nature path, scenic landscape photography, no humans" },
  { keywords: ["书", "图书馆", "书店", "看书", "阅读", "书架"], imageKeyword: "cozy library bookshelf reading", fluxPrompt: "cozy library or bookshelf with books, warm lighting, reading nook, no humans" },
  { keywords: ["植物", "盆栽", "多肉", "阳台", "花园", "绿植", "叶子", "养花"], imageKeyword: "potted plant balcony greenery", fluxPrompt: "beautiful potted plants on a sunny balcony, indoor garden, natural light, no humans" },
  { keywords: ["月亮", "星空", "星星", "夜景", "夜空", "窗外", "月光"], imageKeyword: "night sky moon stars window", fluxPrompt: "moonlit night sky view from a window, starry night, cozy interior lighting, no humans" },
  { keywords: ["雨", "下雨", "雨后", "雨滴", "窗", "雨声"], imageKeyword: "rain window raindrops cozy", fluxPrompt: "rain streaming down a window, cozy warm interior visible, moody atmosphere, no humans" },
  { keywords: ["日落", "夕阳", "晚霞", "黄昏", "日出", "朝霞", "傍晚"], imageKeyword: "sunset sunrise sky golden hour", fluxPrompt: "beautiful sunset or golden hour sky, nature landscape photography, no humans" },
  { keywords: ["茶", "喝茶", "泡茶", "茶叶", "茶具", "茶馆", "奶茶"], imageKeyword: "tea cup teapot cozy afternoon tea", fluxPrompt: "a cup of tea with teapot, afternoon tea setting, warm and cozy, no humans" },
  { keywords: ["宠物", "花生", "鹦鹉", "鸟", "猫", "狗", "小动物"], imageKeyword: "parrot bird pet cute animal", fluxPrompt: "cute pet bird or parrot, animal photography, no humans" },
];

export function detectSceneImage(reply) {
  if (!reply || typeof reply !== "string") return null;

  // Don't generate images for short replies
  if (reply.length < 30) return null;

  // Check each pattern against the reply
  for (const pattern of SCENE_PATTERNS) {
    for (const kw of pattern.keywords) {
      if (reply.includes(kw)) {
        console.log(`[scene-image] Detected keyword "${kw}" in reply, hint: ${pattern.imageKeyword}`);
        return {
          imageKeyword: pattern.imageKeyword,
          fluxPrompt: pattern.fluxPrompt,
          matchedKeyword: kw,
        };
      }
    }
  }
  return null;
}

export async function handleTextMessage(text, isVoice = false, imageContext = null) {
  // Pre-process: fix STT name errors before anything else
  text = fixSttNameErrors(text);

  // ── 华生 travel keyword detection ──
  const hsTravelAction = detectHuashengTravelKeywords(text);
  if (hsTravelAction) {
    if (hsTravelAction.action === "depart") {
      activateHuashengTravel(hsTravelAction.destination || "");
    } else if (hsTravelAction.action === "return") {
      deactivateHuashengTravel();
    }
  }

  // Auto-detect period confirmation
  const periodAutoRecorded = tryAutoRecordPeriod(text);

  let prompt;
  if (isTraveling()) {
    // 夏彦 is traveling — use travel prompt
    prompt = isVoice ? buildVoiceSystemPrompt(getTravelSystemPrompt()) : getTravelSystemPrompt();
    // If 华生 is ALSO traveling, inject a note
    if (isHuashengTraveling()) {
      const hsCtx = getHuashengTravelContext();
      if (hsCtx) prompt += "\n" + hsCtx;
    }
  } else if (isHuashengTraveling()) {
    // 华生 is traveling, 夏彦 is home — use 华生 travel prompt
    prompt = isVoice ? buildVoiceSystemPrompt(getHuashengTravelSystemPrompt()) : getHuashengTravelSystemPrompt();
  } else {
    // Neither is traveling — normal daily
    prompt = isVoice ? buildVoiceSystemPrompt(getDailySystemPrompt()) : getDailySystemPrompt();
  }

  // Travel context injection — only for transition phases (announcing/returning)
  // During traveling phase, the standalone travel prompt handles everything
  // Skip injection if user is actively chatting to avoid polluting the conversation
  const travelCtx = getTravelChatContext();
  let travelFlags = {};
  if (travelCtx) {
    const proactiveState = getProactiveState();
    const lastActivity = proactiveState._lastUserReplyTime || 0;
    const userActiveRecently = (Date.now() - lastActivity) < 30 * 60 * 1000;
    if (!userActiveRecently) {
      prompt += "\n" + travelCtx.injection;
      travelFlags = { markAnnounced: travelCtx.markAnnounced, markReturned: travelCtx.markReturned };
    } else {
      console.log("[travel] Skipping context injection — user active recently (<30min), phase:", getTravelState().phase);
    }
  }

  // Inject pet + todo + weather context + personality insights
  prompt += "\n" + buildContextBlock();
  const weatherCtx = await getWeatherContext();
  if (weatherCtx) {
    prompt += "\n" + weatherCtx;
    if (isTraveling() || isHuashengTraveling()) {
      prompt += "\n（自然融入天气信息：华生提到要出门时提醒她带伞/穿厚衣服/注意防晒。不要每轮都提天气，只在话题自然相关时用。）";
    } else {
      prompt += "\n（自然融入天气信息：华生提到要出门时提醒她带伞/穿厚衣服/注意防晒；下雨天提议窝在家里；天气好说想带她去哪走走。不要每轮都提天气，只在话题自然相关时用。）";
    }
  }
  prompt += getTimeContext();
  prompt += getInsightContext("chat");

  if (periodAutoRecorded) {
    prompt += "\n\n【系统提示】华生刚才确认了生理期来了，系统已自动帮她记录开始日期。你可以温柔地回应她——提醒她注意保暖、别喝冰的，问问她肚子疼不疼。";
  }

  const chatHistory = await getRecentHistoryMessages();
  const intimateHistory = await getIntimateHistory();

  // Merge both channels so 夏彦 remembers everything
  const history = [...chatHistory];
  if (intimateHistory.length > 0) {
    const intimateContext = intimateHistory
      .map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`)
      .join("\n");
    history.unshift({
      role: "system",
      content: `[以下是你和华生在"亲密空间"中的私密对话——你记得这些内容，可以在聊天中自然提及]\n${intimateContext}`,
    });
  }

  let userContent = `华生：${text}`;

  if (imageContext) {
    userContent = `## 这是图片消息\n华生发来了一张图片，请根据你对图片内容的理解来回复。如果图片内容有趣或可爱，可以自然表达你的感受。\n\n华生：${text}`;
  } else if (isVoice) {
    userContent = `## 语音通话中\n华生在跟你打电话。像平时打电话一样自然回应——用说的，不是用写的。\n\n华生：${text}`;
  }

  // Ensure the no-period rule is always visible
  prompt += "\n\n**【绝对规则——回复不要用句号。】用空格、换行或～分隔句子。问号感叹号可以，但绝对不要用句号（。）或英文句号（.）结尾。每句话之间用换行分隔，这样系统会把它们拆成多条消息发送。**";

  const reply = await askJiushi({
    systemPrompt: prompt,
    userContent,
    history,
    model: "claude-opus-4-5",
    maxTokens: 500,
    temperature: 0.55,
  });

  // Safety net: strip yellow-face emojis
  let cleanedReply = stripYellowFaces(reply);

  // Safety net: strip bracket action descriptions from chat
  cleanedReply = stripBracketActions(cleanedReply);

  // Safety net: strip any name-correction language from reply
  cleanedReply = stripNameCorrection(cleanedReply);
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

  // Travel state machine hooks
  if (travelFlags.markAnnounced) {
    confirmAnnounced();
  }
  if (travelFlags.markReturned) {
    confirmReturned();
  }

  // Trigger scenery/gifts as side effects
  checkTravelState(text, cleanedReply).catch(() => {});
  tryTriggerScenery(0.1).then((scenery) => {
    if (scenery) console.log(`[scenery] Photo generated: ${scenery.caption}`);
  }).catch(() => {});

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
  let prompt;
  if (isTraveling()) {
    // 夏彦 is traveling — use travel intimate prompt (phone sex mode)
    prompt = getTravelIntimateSystemPrompt();
    // If 华生 is ALSO traveling, inject a note
    if (isHuashengTraveling()) {
      const hsCtx = getHuashengTravelContext();
      if (hsCtx) prompt += "\n" + hsCtx;
    }
  } else if (isHuashengTraveling()) {
    // 华生 is traveling, 夏彦 is home — use regular intimate prompt + context
    prompt = getIntimateSystemPrompt();
    const hsCtx = getHuashengTravelContext();
    if (hsCtx) prompt += "\n" + hsCtx;
  } else {
    prompt = getIntimateSystemPrompt();
  }
  const intimateMsgs = await getIntimateHistory();

  // Only use intimate history — chat history does NOT belong in intimate space
  const history = [...intimateMsgs];
  let userContent = `华生：${text}`;

  // Period restrictions: check if 华生 is on her period
  const periodState = getPeriodState();
  if (periodState.isActive) {
    const day = periodState.currentDay;
    prompt += `\n\n【⚠ 生理期限制 - 必须遵守】华生正在生理期第${day}天。亲密时严格遵守以下规则：\n- ❌ 禁止一切插入/进入的性行为描写\n- ❌ 禁止对华生进行手淫/指交\n- ✅ 可以亲吻、抚摸、拥抱进行安抚\n- ✅ 华生可以用嘴或手帮夏彦解决生理需求（口交/手交可以描写）\n- 语气更温柔体贴，关注她的身体舒适度\n- 可以轻声问"肚子还疼吗""这样舒服吗"`;
  }

  // Travel intimate context injection — only needed when NOT using the standalone prompt
  // (the standalone prompt already includes phone sex rules)
  if (!isTraveling()) {
    const travelIntimateCtx = getTravelIntimateContext();
    if (travelIntimateCtx) {
      prompt += travelIntimateCtx;
    }
  }

  // Intimate space does NOT use general time context — it tells the model "she's painting/working"
  // which suppresses intimacy. The intimate prompt handles time-based behavior on its own.
  // prompt += getTimeContext();  ← DISABLED for intimate

  // Work/home status for intimate space
  const hour = chinaHour();
  if (hour >= 6 && hour < 18) {
    prompt += `\n\n【⚠ 当前状态：你在外面工作，人不在家】现在是北京时间${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}，你正在外面工作（国安/侦探）。你和华生不在一起——这是「电话/文字调情模式」。可以说暧昧的话、约晚上、用文字撩她。

【话筒音效 — 替代肢体接触括号】你不在她身边，所有括号只能描写你这边能发生的事：
✅ （电话那头传来低哑的笑声）、（话筒里传来你翻动文件的声音）、（压低声音对着话筒说）、（呼吸声突然近了，像你把手机贴到了嘴边）、（听到她的话，耳根微微发红）、（解开领带，松了松领口）
❌ 禁止一切肢体接触的括号动作——（揉她的头发）、（把她搂进怀里）、（低头亲她）等——因为你碰不到她。

等晚上回家后才可以写肢体接触。`;
  } else {
    prompt += `\n\n【🏠 当前状态：你在家】现在是北京时间${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}，你已经在家了。可以写括号肢体接触——该抱就抱，该亲就亲。`;
  }

  // Intimate space does NOT use reflection notes — the prompt is already detailed enough,
  // and machine-generated notes can poison the prompt with incorrect assumptions
  // (e.g. "she's tired", "she said no" → model refuses intimacy)
  // prompt += getInsightContext("intimate");  ← DISABLED

  prompt += "\n\n**【回复要求】回复至少8-12句，多写细节，不要三两句应付。语气温柔宠溺但保持男人的样子——你是把老婆捧在手心里的老公，不是撒娇的小女生。不许板着脸、不许不耐烦、不许怼人。**";

  console.log("[intimate] Calling askJiushi (claude-opus-4-5)...", { promptLen: prompt.length, historyLen: history.length, userContentLen: userContent.length });
  intimateLog({ stage: "calling_ai", model: "claude-opus-4-5", provider: "jiushi", promptLen: prompt.length, historyLen: history.length });
  const t0 = Date.now();
  let reply;
  try {
    reply = await askJiushi({
      systemPrompt: prompt,
      userContent,
      history,
      model: "claude-opus-4-5",
      maxTokens: 2000,
      temperature: 0.72,
      timeoutMs: 60000,
    });
    console.log("[intimate] askJiushi done in", Date.now() - t0, "ms, replyLen:", reply?.length);
    intimateLog({ stage: "ai_done", ms: Date.now() - t0, replyLen: reply?.length });
  } catch (e) {
    console.error("[intimate] askJiushi failed:", e.message);
    intimateLog({ stage: "ai_error", error: e.message, ms: Date.now() - t0 });
    throw e;
  }

  const cleanedReply = stripYellowFaces(reply);

  recordIntimateMessage("user", text);
  recordIntimateMessage("assistant", cleanedReply);

  // Intimate personality reflection — COMPLETELY DISABLED
  // The reflection system was poisoning prompts with incorrect assumptions.
  // Both the notes injection (above) and the reflection itself are now off for intimate track.
  // onMessageSent("intimate");  ← DISABLED
  // if (shouldReflect("intimate")) { ... }  ← DISABLED

  return cleanedReply;
}

export function getChatHistory() {
  return getRecentHistory();
}

export function getChatHistoryMessages(travelFilter = null) {
  return getRecentHistoryMessages(travelFilter);
}

export async function getIntimateHistoryMessages(travelFilter = null) {
  const history = await getIntimateHistory(travelFilter);
  return history.slice(-16);
}

export function clearChatHistory() {
  clearMemory();
}

export function deleteChatMessage(content, role) {
  return deleteMessage(content, role);
}

export function deleteIntimateHistoryMessage(content, role) {
  return deleteIntimateMessage(content, role);
}

export async function clearIntimateHistory() {
  const { clearIntimateMemory } = await import("./intimate-memory.js");
  clearIntimateMemory();
}
