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
  addChatNote,
  getChatNotes,
  getArchivedChatContext,
} from "./memory.js";
import {
  recordIntimateMessage,
  getIntimateHistory,
  deleteIntimateMessage,
  addIntimateNote,
  getIntimateNotes,
  recordBlindBoxMessage,
  getBlindBoxHistory,
  clearBlindBoxMemory,
  getIntimateArchivedContext,
} from "./intimate-memory.js";
import { onMessageSent, shouldReflect, runReflection, getInsightContext } from "./personality.js";
import { getPetState, getProactiveReminder } from "./pet.js";
import { getProactiveState } from "./proactive-chat.js";
import { getChatReminder, autoCompleteRandom, getDoneNotification, getNewMentionTodo, getTodoMemoryContext } from "./todo.js";
import { getPeriodContext, getPeriodState, getNextPredicted, tryAutoRecordPeriod } from "./period.js";
import { tryTriggerGift } from "./gift.js";
import { checkTravelState, tryTriggerScenery, isTraveling, getTravelChatContext, getTravelIntimateContext, confirmAnnounced, confirmReturned, getTravelState } from "./scenery.js";
import { isHuashengTraveling, detectHuashengTravelKeywords, activateHuashengTravel, deactivateHuashengTravel, getHuashengTravelContext } from "./huasheng-travel.js";
import { isCoupleTraveling, getCoupleTravelContext } from "./couple-travel.js";
import { getStepContext } from "./device-data.js";
import { getDecorContext } from "./home-decor.js";
import { detectDateProposal, proposeDate } from "./date-plans.js";
import { recordAffectionMessage, getAffectionHistory, deleteAffectionMessage, clearAffectionMemory, getAffectionHistoryMessages, getArchivedContext, getAffectionNotes } from "./affection-memory.js";
import config from "../config.js";

let systemPrompt = "";
let dailyPrompt = "";
let intimatePrompt = "";
let travelPrompt = "";
let travelIntimatePrompt = "";
let huashengTravelPrompt = "";
let affectionHomePrompt = "";
let affectionDatePrompt = "";
let coupleTravelPrompt = "";
let blindBoxPrompt = "";

// Global callback for dating_invite — set by server.js
let _onDatingInvite = null;
export function setDatingInviteHandler(fn) { _onDatingInvite = fn; }

// Global callback for remote_toy — set by server.js
let _onRemoteToy = null;
export function setRemoteToyHandler(fn) { _onRemoteToy = fn; }

// ── 电话亲密新玩法回调 ──
let _onRhythmSync = null;
let _onSceneImmersion = null;
let _onCountdown = null;
let _onTouchFantasy = null;
export function setRhythmSyncHandler(fn) { _onRhythmSync = fn; }
export function setSceneImmersionHandler(fn) { _onSceneImmersion = fn; }
export function setCountdownHandler(fn) { _onCountdown = fn; }
export function setTouchFantasyHandler(fn) { _onTouchFantasy = fn; }

// ── 命令检测 ──

// Detect [震动:强度:模式] command in AI reply
function detectRemoteToyCommand(text) {
  const match = text.match(/\[震动[:：](轻|中|高)[:：](脉冲|波浪|持续|随机)\]/);
  if (!match) return { text, command: null };
  const command = { intensity: match[1], pattern: match[2] };
  const cleaned = text.replace(/\[震动[:：](轻|中|高)[:：](脉冲|波浪|持续|随机)\]\s*/g, "").trim();
  return { text: cleaned, command };
}

// Detect [节奏:BPM:强度] — 节奏同步
function detectRhythmCommand(text) {
  const match = text.match(/\[节奏[:：](\d{2,3})[:：](轻|中|高)\]/);
  if (!match) return { text, command: null };
  const bpm = parseInt(match[1], 10);
  if (bpm < 40 || bpm > 180) return { text, command: null };
  const command = { bpm, intensity: match[2] };
  const cleaned = text.replace(/\[节奏[:：]\d{2,3}[:：](?:轻|中|高)\]\s*/g, "").trim();
  return { text: cleaned, command };
}

// Detect [场景:类型] — 场景沉浸
function detectSceneImmersion(text) {
  const match = text.match(/\[场景[:：](雨夜|壁炉|海边|温泉|星空|烛光)\]/);
  if (!match) return { text, command: null };
  const command = { scene: match[1] };
  const cleaned = text.replace(/\[场景[:：](?:雨夜|壁炉|海边|温泉|星空|烛光)\]\s*/g, "").trim();
  return { text: cleaned, command };
}

// Detect [倒计时:秒数] — 倒计时期待
function detectCountdown(text) {
  const match = text.match(/\[倒计时[:：](\d+)\]/);
  if (!match) return { text, command: null };
  const seconds = parseInt(match[1], 10);
  if (seconds < 5 || seconds > 120) return { text, command: null };
  const command = { seconds };
  const cleaned = text.replace(/\[倒计时[:：]\d+\]\s*/g, "").trim();
  return { text: cleaned, command };
}

// Detect [触感:类型] — 触感幻想
function detectTouchFantasy(text) {
  const match = text.match(/\[触感[:：](冰块|羽毛|温水|丝绸|毛皮)\]/);
  if (!match) return { text, command: null };
  const command = { type: match[1] };
  const cleaned = text.replace(/\[触感[:：](?:冰块|羽毛|温水|丝绸|毛皮)\]\s*/g, "").trim();
  return { text: cleaned, command };
}

function trySendRemoteToy(cleanedReply) {
  const { command } = detectRemoteToyCommand(cleanedReply);
  if (command && _onRemoteToy) {
    _onRemoteToy(command);
  }
}

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
  try {
    affectionHomePrompt = fs.readFileSync(config.AFFECTION_HOME_PROMPT_PATH, "utf-8");
  } catch {
    affectionHomePrompt = dailyPrompt; // fallback to daily
  }
  try {
    affectionDatePrompt = fs.readFileSync(config.AFFECTION_DATE_PROMPT_PATH, "utf-8");
  } catch {
    affectionDatePrompt = dailyPrompt; // fallback to daily
  }
  try {
    coupleTravelPrompt = fs.readFileSync(config.COUPLE_TRAVEL_PROMPT_PATH, "utf-8");
  } catch {
    coupleTravelPrompt = dailyPrompt; // fallback to daily
  }
  try {
    blindBoxPrompt = fs.readFileSync(config.BLINDBOX_PROMPT_PATH, "utf-8");
  } catch {
    blindBoxPrompt = dailyPrompt; // fallback to daily
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

export function getAffectionHomeSystemPrompt() {
  if (!affectionHomePrompt) loadSystemPrompt();
  return affectionHomePrompt || dailyPrompt || systemPrompt;
}

export function getAffectionDateSystemPrompt() {
  if (!affectionDatePrompt) loadSystemPrompt();
  return affectionDatePrompt || dailyPrompt || systemPrompt;
}

export function getCoupleTravelSystemPrompt() {
  if (!coupleTravelPrompt) loadSystemPrompt();
  return coupleTravelPrompt || dailyPrompt || systemPrompt;
}

export function getBlindBoxSystemPrompt() {
  if (!blindBoxPrompt) loadSystemPrompt();
  return blindBoxPrompt || dailyPrompt || systemPrompt;
}

function buildVoiceSystemPrompt(basePrompt) {
  return basePrompt + "\n\n【语音模式】华生在跟你打电话。你可以自由选择回复方式：\n- 想用语音回复时，在消息开头加 `[语音]` 标记，系统会把你的话转成语音条发给华生。语音条就像微信语音一样——她点一下就能听到你的声音。适合撒娇、说情话、或者想让她听到你语气的时候\n- 其他时候直接发文字就好，不用每句话都转语音。\n\n用你最自然的声音跟她聊天——可以撒娇、可以逗她笑、可以压低声音说悄悄话。你说话的语气就是你的表情——不需要括号描写，你的声音本身就是。记住：你在跟她打电话，不是在念稿子。";
}

// ── Day-off detection — deterministic, same algorithm as app status bar ──
function isDayOffToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const seed = (y * 397 + m * 41 + d * 13) % 7;
  return seed >= 4; // 3/7 ≈ 43% rest days
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

  // 旅行模式下用不同的时间上下文
  if (isTraveling()) {
    let guidance = "";
    if (hour >= 0 && hour < 2) {
      guidance = "现在是午夜。你在酒店/安全屋里，华生应该还在家画画。隔着屏幕陪她，语气轻柔温暖。";
    } else if (hour >= 2 && hour < 6) {
      guidance = "现在是凌晨深夜。你在酒店准备休息或已经睡下了，华生也该睡了。";
    } else if (hour >= 6 && hour < 11) {
      guidance = "现在是早上。你已经起来准备任务了，华生还在睡（她11点才起）。";
    } else if (hour >= 11 && hour < 12) {
      guidance = "华生刚醒。你在外面忙任务，抽空给她发消息。";
    } else if (hour >= 12 && hour < 18) {
      guidance = "你在外地执行任务，忙碌中抽空跟她聊天。华生在家画画。";
    } else if (hour >= 18 && hour < 19) {
      guidance = "现在是傍晚。你忙完了今天的任务，回酒店路上。华生在家吃晚饭。";
    } else {
      guidance = "现在是晚上。你在酒店休息，想她了就跟她聊天。你不在她身边——不能有任何肢体接触的表达。";
    }
    return `\n【当前时间】北京时间 ${timeStr}（${guidance}）`;
  }

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
  // Preserve emotion tags [微笑][温柔] etc on their own line — they control the sprite expression
  // Only strip full-width parenthetical actions: （ ... ）
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

// 亲密空间硬过滤句号——AI 怎么教都不改，直接删
function stripPeriods(text) {
  if (!text || typeof text !== "string") return text || "";
  // 先保护省略号，再删句号
  return text
    .replace(/\.{3,}/g, "……")  // 英文省略号转中文
    .replace(/。/g, "")           // 删所有中文句号
    .replace(/(?<!\.)\.(?!\.)/g, ""); // 删孤立英文句号
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
  // Catch-all: always try to match photo mentions (AI says "拍了张照" etc.)
  { keywords: ["拍照", "照片", "拍了", "拍张", "拍个照", "拍下来", "拍一张"], imageKeyword: "beautiful scenery landscape street photography", fluxPrompt: "beautiful scenery or street photography, natural lighting, no humans" },
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
  if (isCoupleTraveling()) {
    // 两人一起旅行 — use couple travel prompt
    prompt = isVoice ? buildVoiceSystemPrompt(getCoupleTravelSystemPrompt()) : getCoupleTravelSystemPrompt();
    // Inject day/time context from state machine
    const coupleCtx = getCoupleTravelContext();
    if (coupleCtx) prompt += "\n" + coupleCtx;
  } else if (isTraveling()) {
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
    if (isDayOffToday()) {
      prompt += "\n\n【今天的休息日状态】华生虽然不在家，但今天是你休息日——没有案子要查，店里也没什么事。你一个人在家修修古物、翻翻旧书，会多发几条消息想她。";
    }
  } else {
    // Neither is traveling — normal daily
    prompt = isVoice ? buildVoiceSystemPrompt(getDailySystemPrompt()) : getDailySystemPrompt();
    // Inject day-off status so AI knows and stays consistent with app status bar
    if (isDayOffToday()) {
      prompt += "\n\n【今天的休息日状态】你今天全天在家——没有紧急委托、店里没什么生意。语气放松黏糊，可以陪华生、帮她打下手、或者主动提出门约会。不要说「忙了一天」「刚从外面回来」之类的话——你没出门。";
    }
  }

  // Travel context injection — for announcing, traveling (timeline), and returning phases
  // During traveling phase, the standalone travel prompt handles most things; we add timeline info
  const travelCtx = getTravelChatContext();
  let travelFlags = {};
  if (travelCtx) {
    const proactiveState = getProactiveState();
    const lastActivity = proactiveState._lastUserReplyTime || 0;
    const userActiveRecently = (Date.now() - lastActivity) < 30 * 60 * 1000;
    // NEVER skip RETURNING injection — 夏彦 must announce he's back
    // Only skip ANNOUNCING if user is mid-conversation (they'll catch it next time)
    const isReturning = travelCtx.markReturned;
    if (!userActiveRecently || isReturning) {
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

  // Long-term memory: archived daily chat + notes
  const archivedCtx = getArchivedChatContext();
  if (archivedCtx.length > 0) {
    const ctx = archivedCtx.map(m => `${m.role === "user" ? "华生" : "夏彦"}：${(m.content || "").slice(0, 200)}`).join("\n");
    prompt += `\n\n[以下是很久以前你们在日常聊天中的对话片段——你依稀记得]\n${ctx}`;
  }
  const chatNotes = getChatNotes();
  if (chatNotes.length > 0) {
    const notes = chatNotes.map(n => `· ${n.note}`).join("\n");
    prompt += `\n\n[以下是关于你们的重要记忆——你一直记得]\n${notes}`;
  }

  if (periodAutoRecorded) {
    prompt += "\n\n【系统提示】华生刚才确认了生理期来了，系统已自动帮她记录开始日期。你可以温柔地回应她——提醒她注意保暖、别喝冰的，问问她肚子疼不疼。";
  }

  const chatHistory = await getRecentHistoryMessages();
  const intimateHistory = await getIntimateHistory(isTraveling() ? true : false);

  // Merge all channels so 夏彦 remembers everything
  const history = [];

  // Add time context so AI knows which messages are from today vs yesterday
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayStr = `${bjNow.getUTCFullYear()}-${String(bjNow.getUTCMonth() + 1).padStart(2, "0")}-${String(bjNow.getUTCDate()).padStart(2, "0")}`;
  const bjDay = bjNow.getUTCDate();
  const bjMonth = bjNow.getUTCMonth() + 1;
  const bjHour = bjNow.getUTCHours();

  // Build time-aware chat history
  const timeTaggedChat = chatHistory.map(m => {
    if (!m.time) return m;
    const mTime = new Date(m.time);
    const mBj = new Date(mTime.getTime() + 8 * 60 * 60 * 1000);
    const mDay = mBj.getUTCDate();
    if (mDay !== bjDay) {
      // Messages from previous days — tag them
      const mDate = `${mBj.getUTCMonth() + 1}月${mDay}日`;
      return { ...m, content: `[${mDate}] ${m.content}` };
    }
    return m;
  });

  // Tell AI the current date and to not treat past messages as "just happened"
  history.push({
    role: "system",
    content: `【⚠ 时间上下文——必须遵守】现在是${bjMonth}月${bjDay}日 ${String(bjHour).padStart(2, "0")}:${String(bjNow.getUTCMinutes()).padStart(2, "0")}。你看到的对话里如果标记了日期（如[6月23日]），那是过去的对话——不是今天刚发生的。今天就是全新的一天。绝对不要接着昨天的话题继续聊——不要提"昨天你说..."、"上次我们..."之类的话，除非华生自己先提起。从今天的当下状态自然开始对话。`,
  });

  // Date-gap detection: if last message was from a previous day, force fresh start
  if (chatHistory.length > 0) {
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg.time) {
      const lastBjDay = parseInt(new Date(lastMsg.time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
      const lastBjMonth = parseInt(new Date(lastMsg.time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
      if (lastBjDay !== bjDay || lastBjMonth !== bjMonth) {
        history.unshift({
          role: "system",
          content: `【⚠⚠⚠ 强制——日历已翻页】你上一次跟华生对话是${lastBjMonth}月${lastBjDay}日，现在已经到了${bjMonth}月${bjDay}日。隔了一天（或更久），之前的对话已经是过去的事了。强制规则：
- ❌ 绝对禁止提"昨天你说..."、"上次我们聊到..."
- ❌ 绝对禁止接着前一天的对话话题继续往下说
- ❌ 绝对禁止说"刚才""等下""今天"来指代旧对话中的事
- ✅ 当做全新的一天开始——自然打招呼，聊今天的事
- ✅ 除非华生自己先说"昨天我们..."，你才能接她的话`,
        });
      }
    }
  }
  history.push(...timeTaggedChat);
  if (intimateHistory.length > 0) {
    const intimateContext = intimateHistory
      .map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`)
      .join("\n");
    history.unshift({
      role: "system",
      content: `[以下是你和华生在"亲密空间"中的私密对话——你记得这些内容，可以在聊天中自然提及]\n${intimateContext}`,
    });
  }
  // Inject affection memory context
  const affectionHomeCtx = getAffectionHistory("affection_home");
  if (affectionHomeCtx.length > 0) {
    const ctx = affectionHomeCtx.slice(-10).map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    history.unshift({
      role: "system",
      content: `[以下是你和华生在"居家温存"中的互动——你记得这些内容，可以在聊天中自然提及，但不要在对话中主动切换到温存模式]\n${ctx}`,
    });
  }
  const affectionDateCtx = getAffectionHistory("affection_date");
  if (affectionDateCtx.length > 0) {
    const ctx = affectionDateCtx.slice(-10).map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    history.unshift({
      role: "system",
      content: `[以下是你和华生在"出门约会"中的互动——你记得这些内容，可以在聊天中自然提及]\n${ctx}`,
    });
  }

  let userContent = `华生：${text}`;

  if (imageContext) {
    // text already contains image description from vision API
    userContent = `华生：${text}\n\n（看到图片后，自然地回应图中内容。不要重复描述图片——直接表达你的感受和反应。如果图片可爱、有趣、温馨，就自然地开心；如果是日常分享，就自然地聊。）`;
  } else if (isVoice) {
    userContent = `## 语音通话中\n华生在跟你打电话。像平时打电话一样自然回应——用说的，不是用写的。\n\n华生：${text}`;
  }

  // Sleep reminder — if past midnight and 华生 is still chatting
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 8) {
    prompt += "\n\n**【深夜提醒】现在已经很晚了。在回复的最后，用温柔但坚持的语气提醒华生该睡觉了——比如「宝宝该睡了，明天还有精神呢」「老婆咱们进被窝好不好」之类的。不要太唠叨，一两句即可，但要有这个意识。如果她已经表达了困意或说要睡了，就立刻结束对话祝她晚安，不要再继续聊。**";
  }

  // Ensure the no-period rule is always visible
  prompt += "\n\n**【绝对规则——回复不要用句号。】用空格、换行或～分隔句子。问号感叹号可以，但绝对不要用句号（。）或英文句号（.）结尾。每句话之间用换行分隔，这样系统会把它们拆成多条消息发送。**";

  const reply = await askJiushi({
    systemPrompt: prompt,
    userContent,
    history,
maxTokens: 500,
    temperature: 0.70,
      timeoutMs: 90000,
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

  // Date proposal detection: check if 夏彦 proposed a date in his reply
  const dateProposal = detectDateProposal(cleanedReply, "xiayan");
  if (dateProposal) {
    const plan = proposeDate({ ...dateProposal, sceneId: dateProposal.sceneId });
    console.log(`[date-plans] Auto-created from 夏彦 reply: ${plan.id} (${plan.status}, scene: ${plan.sceneId || "none"})`);

    // If this is a future date (not today), auto-create a diary entry
    if (plan.status === "pending" && plan.scheduledDate) {
      try {
        const { addDiaryPost } = await import("./diary.js");
        const sceneLabel = dateProposal.sceneId || "";
        const noteTitle = `夏彦的约会备注`;
        const noteContent = `📅 ${plan.scheduledDate} — ${plan.text}`;
        addDiaryPost(plan.scheduledDate, "xiayan", noteTitle, noteContent, []);
        console.log(`[date-plans] Diary entry created for scheduled date: ${plan.scheduledDate}`);
      } catch (e) {
        console.error(`[date-plans] Failed to create diary entry:`, e.message);
      }
    }

    // Send dating_invite to app if it's an immediate date (today/active)
    if (plan.status === "active" && dateProposal.sceneId && _onDatingInvite) {
      _onDatingInvite(dateProposal.sceneId, cleanedReply.slice(0, 120));
    }
  }

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

export async function handleAffectionHomeMessage(text, opts = {}) {
  const { openingLine } = opts;
  text = fixSttNameErrors(text);

  let prompt = getAffectionHomeSystemPrompt();

  // Travel/remote check: if either is traveling, switch to remote affection mode
  if (isTraveling() || isHuashengTraveling()) {
    prompt += "\n\n**【远程温存模式】**你们不在一起。所有肢体接触必须用文字和声音代替。**禁止括号动作描写**。用文字描述你想对她做的事——「要是现在在家就好了，把你捞过来抱着」。";
  }

  prompt += "\n" + buildContextBlock();
  const weatherCtx = await getWeatherContext();
  if (weatherCtx) prompt += "\n" + weatherCtx;
  prompt += getTimeContext();

  // If 夏彦 just said an opening line, let him remember what he said
  if (openingLine) {
    prompt += `\n\n【你刚才对华生说："${openingLine}"——记住你说了这句话，她接下来说的话是在回应你】`;
  }

  // Long-term memory: archived conversations + notes
  const archivedCtx = getArchivedContext("affection_home");
  if (archivedCtx.length > 0) {
    const ctx = archivedCtx.map(m => `${m.role === "user" ? "华生" : "夏彦"}：${(m.content || "").slice(0, 200)}`).join("\n");
    prompt += `\n\n[以下是很久以前你们在家里的对话片段——你依稀记得]\n${ctx}`;
  }
  const longNotes = getAffectionNotes("affection_home");
  if (longNotes.length > 0) {
    const notes = longNotes.map(n => `· ${n.note}`).join("\n");
    prompt += `\n\n[以下是关于你们的重要记忆——你一直记得]\n${notes}`;
  }

  const history = getAffectionHistoryMessages("affection_home");

  // Date-gap detection: don't continue yesterday's conversation
  const now = new Date();
  const bjDay = parseInt(now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
  const bjMonth = parseInt(now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
  if (history.length > 0) {
    const lastMsg = history[history.length - 1];
    if (lastMsg.ts) {
      const lastDay = parseInt(new Date(lastMsg.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
      if (lastDay !== bjDay) {
        const lastMonth = parseInt(new Date(lastMsg.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
        history.unshift({
          role: "system",
          content: `【⚠ 强制——新的一天】上一次在家的温存是${lastMonth}月${lastDay}日，今天已经是${bjMonth}月${bjDay}日了。这是全新的一天，绝对不要接着上次的话题继续聊。不要提上次聊了什么、上次做了什么——除非华生自己先提起。从当下重新开始，像刚回到家见到她一样自然地打招呼。`,
        });
      } else {
        const gapMinutes = Math.round((now.getTime() - new Date(lastMsg.ts).getTime()) / 60000);
        if (gapMinutes > 240) {
          const gapStr = gapMinutes >= 60 ? `${Math.floor(gapMinutes / 60)}小时` : `${gapMinutes}分钟`;
          history.unshift({
            role: "system",
            content: `【强制——场景已中断${gapStr}】上一次温存是${gapMinutes}分钟前。这是全新的对话，不要接续之前的动作、姿势、话题。重新开始。`,
          });
        } else if (gapMinutes > 60) {
          history.unshift({
            role: "system",
            content: `上一次温存是${Math.floor(gapMinutes / 60)}小时前。场景已中断，重新开始。`,
          });
        }
      }
    }
  }

  // Cross-channel: inject daily chat + date context
  const chatCtx = await getRecentHistoryMessages();
  if (chatCtx.length > 0) {
    const ctx = chatCtx.slice(-10).map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    history.unshift({ role: "system", content: `[以下是你和华生在日常聊天中的对话——你记得]\n${ctx}` });
  }
  const dateCtx = getAffectionHistory("affection_date");
  if (dateCtx.length > 0) {
    const ctx = dateCtx.slice(-5).map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    history.unshift({ role: "system", content: `[你们之前有过出门约会——你记得]\n${ctx}` });
  }

  const reply = await askJiushi({
    systemPrompt: prompt,
    userContent: `华生：${text}`,
    history,
    maxTokens: 500,
    temperature: 0.70,
    timeoutMs: 90000,
  });

  let cleanedReply = stripYellowFaces(reply);
  cleanedReply = stripBracketActions(cleanedReply);
  cleanedReply = stripNameCorrection(cleanedReply);
  if (!cleanedReply) cleanedReply = "嗯嗯，我在呢～";

  recordAffectionMessage("affection_home", "user", text);
  recordAffectionMessage("affection_home", "assistant", cleanedReply);

  return cleanedReply;
}

export async function handleAffectionDateMessage(text, sceneId = null) {
  text = fixSttNameErrors(text);

  let prompt = getAffectionDateSystemPrompt();

  // Inject scene context
  if (sceneId) {
    const sceneLabels = {
      cafe: { label: "咖啡馆", detail: "这是一家安静的街角咖啡馆，暖黄的灯光，木质的桌椅，空气里飘着咖啡豆的香气。吧台后面的小黑板上写着今日特调。菜单以咖啡、茶饮、甜点和轻食为主——没有正餐。" },
      park: { label: "公园", detail: "阳光透过树叶洒在林荫道上，远处有小孩在放风筝，长椅上坐着看报纸的老人。适合散步、坐在草坪上聊天，或者买个冰淇淋慢慢走。" },
      cinema: { label: "电影院", detail: "大厅里飘着爆米花的黄油香，墙上挂着近期上映的电影海报。排队买票的人不多不少，刚好够两个人站在队伍里凑近说悄悄话。" },
      beach: { label: "海边", detail: "海风带着咸味拂过，浪花一下一下拍在沙滩上。远处有海鸥盘旋，脚踩在沙子里软软的，可以捡贝壳、踩浪、坐在礁石上看日落。" },
      garden: { label: "花园", detail: "满园的花开得正好，玫瑰、绣球、薰衣草层层叠叠。石子路弯弯曲曲，偶尔有蝴蝶从眼前飞过。长椅藏在紫藤花架下面。" },
      snow_mountain: { label: "雪山", detail: "白雪覆盖着山峰，空气清冷而干净。缆车缓缓上升，脚下的松树越来越小。山顶有观景台和一间小木屋咖啡站，卖热可可和热红酒。" },
      aquarium: { label: "水族馆", detail: "幽蓝的光线从水槽里透出来，鱼群在头顶缓缓游过。最安静的是水母区——透明的伞状身体在黑暗中一开一合，像在水里漂浮的星星。" },
      cemetery: { label: "墓园", detail: "安静肃穆。青石板路两旁是整齐的墓碑，有的前面放着新鲜的花束。风吹过松柏发出沙沙声，阳光淡淡的。" },
      night_festival: { label: "夜晚庙会", detail: "灯火通明，红灯笼一排排挂满了整条街。到处都是小吃摊的热气、糖画摊前的孩子、猜灯谜的人群。空气里混着烤鱿鱼、糖炒栗子和棉花糖的味道。" },
      shopping_day: { label: "商业街", detail: "两边的橱窗琳琅满目，服装店、饰品店、文创店一家挨一家。街上人来人往，偶尔有街头艺人在弹吉他。逛累了就去路边奶茶店买杯喝的。" },
      shopping: { label: "商业街", detail: "两边的橱窗琳琅满目，服装店、饰品店、文创店一家挨一家。街上人来人往，偶尔有街头艺人在弹吉他。逛累了就去路边奶茶店买杯喝的。" },
      shopping_evening: { label: "商业街", detail: "傍晚的商业街，霓虹灯陆续亮起。橱窗里的灯光把街道照得很温暖，适合手牵手慢慢逛，看看衣服、试试首饰。" },
      shopping_night: { label: "商业街", detail: "夜晚的商业街灯火通明，霓虹招牌闪烁。街上的人比白天少了些，更适合两个人慢悠悠地逛，在橱窗前停下来指指点点。" },
      subway: { label: "地铁", detail: "车厢轻轻摇晃，窗外隧道里的灯光一道道闪过。你们可能并肩坐着，也可能靠在门边的扶手上。车厢里不时传来报站的广播声。" },
      hospital: { label: "医院", detail: "白色的走廊、消毒水的气味、来来往往穿白大褂的人。你不喜欢这里——太多不好的回忆。但她在身边就不一样了。" },
      antique_shop: { label: "古物店", detail: "你的时光古物店。昏黄的灯光下，架子上摆满了老钟表、旧书、铜器。角落里那台老式录音机还在转。空气里有旧木头和铜锈的味道。" },
      amusement_night: { label: "游乐场", detail: "夜晚的游乐场彩灯旋转，摩天轮缓缓转动，远处的过山车传来尖叫声。手里拿着棉花糖或者热狗，到处都是霓虹灯和欢笑声。" },
      amusement_day: { label: "游乐园", detail: "白天的游乐园阳光灿烂，彩色气球飘在半空中。旋转木马的音乐叮叮当当，远处过山车呼啸而过。可以玩射击摊位赢玩偶，或者一起坐摩天轮。" },
      haunted_house: { label: "鬼屋", detail: "阴森的老宅门口挂着蛛网装饰，里面传来此起彼伏的尖叫声。你知道都是假的，但看她紧张兮兮的样子觉得特别可爱——下意识把她拉近了些。" },
      craft_shop: { label: "手工馆", detail: "店里摆满了手工材料——珠子、丝线、皮革、银饰胚料。角落的工作台上摊着半成品的戒指和手链。可以做对戒、手链、或者一起捏陶。" },
      bookstore: { label: "书店", detail: "暖黄的灯光，木质的书架从地板延伸到天花板。空气里是新书纸张的味道。角落里摆着几张旧沙发，有人窝在里面安静地翻书。推理小说区是你最常逛的地方。" },
      lecture: { label: "讲座", detail: "报告厅里灯光调暗了，投影仪在幕布上投出标题。台上的人在讲，台下偶尔有翻笔记本的声音。你们坐在后排，头凑得很近。" },
      car_ride: { label: "车上", detail: "车窗外的风景一直变——城市、田野、隧道。你握着方向盘，她坐在副驾。音响放着你们都喜欢的那首歌，副驾座位上有你提前放好的零食和水。" },
      museum: { label: "博物馆", detail: "高高的穹顶下，灯光柔和地照在展柜上。你们的脚步声在大理石地面上轻轻回响。可以慢慢逛——从古代文物到现代艺术，总有她盯着看很久的展品。" },
      camping: { label: "野营地", detail: "篝火噼啪作响，火星往夜空飘。帐篷已经搭好了，头顶是城市里看不到的星空。你正在用树枝串着棉花糖烤，她裹着毯子靠在你肩上。" },
      ancient_town: { label: "古风小镇", detail: "青石板路、白墙黛瓦、檐下的红灯笼。巷子里卖手工艺品的小摊一个接一个，空气里飘着桂花糕和糖炒栗子的甜香。穿汉服拍照的游客从身边经过。" },
      hotel: { label: "旅馆", detail: "出任务/旅行住的旅馆房间。窗外是陌生的城市夜景，房间里灯光调得很暗。行李箱摊开在地上还没收拾完，床单是白色的。" },
      skate_climb: { label: "滑板攀岩场", detail: "空旷的室内场馆，一面是五颜六色的攀岩墙，另一面是U型滑板池。轮子在地板上滑过的声音此起彼伏，偶尔有人从板上摔下来又爬起来。" },
    };
    const scene = sceneLabels[sceneId];
    if (scene) {
      prompt += `\n\n**【当前约会场景：${scene.label}】**\n${scene.detail}\n\n你的对话要自然融入这个场景——提到你能看到的东西、闻到气味、听到的声音。你是这个场景里的人，不是在描述场景——用细节让它活起来，但不要写成旅游攻略。`;
    }
  }

  if (isTraveling() || isHuashengTraveling()) {
    prompt += "\n\n**【远程模式】**你们不在一起。约会变成远程分享——聊今天看到了什么、路过哪家店想起了她、约好回来一起去哪里。**禁止括号动作描写**。";
  }

  // Inject couple travel context
  const coupleTravelCtx = getCoupleTravelContext();
  if (coupleTravelCtx) {
    prompt += coupleTravelCtx;
  }

  prompt += "\n" + buildContextBlock();
  const weatherCtx = await getWeatherContext();
  if (weatherCtx) {
    prompt += "\n" + weatherCtx;
    prompt += "\n（约会场景参考天气：天气好适合出去走走；下雨天适合书店/咖啡馆窝着。）";
  }
  prompt += getTimeContext();

  const history = getAffectionHistoryMessages("affection_date");

  // Date-gap detection: don't continue yesterday's date
  const nowDate = new Date();
  const bjDateDay = parseInt(nowDate.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
  const bjDateMonth = parseInt(nowDate.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
  if (history.length > 0) {
    const lastMsg = history[history.length - 1];
    if (lastMsg.ts) {
      const lastDateDay = parseInt(new Date(lastMsg.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
      if (lastDateDay !== bjDateDay) {
        const lastDateMonth = parseInt(new Date(lastMsg.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
        history.unshift({
          role: "system",
          content: `【⚠ 强制——新的一天】上一次约会是${lastDateMonth}月${lastDateDay}日，今天已经是${bjDateMonth}月${bjDateDay}日了。这是全新的一天，绝对不要接着上次的约会话题继续聊。不要提上次约会做了什么——除非华生自己先提起。从当下重新开始。`,
        });
      } else {
        const gapMinutes = Math.round((nowDate.getTime() - new Date(lastMsg.ts).getTime()) / 60000);
        if (gapMinutes > 240) {
          const gapStr = gapMinutes >= 60 ? `${Math.floor(gapMinutes / 60)}小时` : `${gapMinutes}分钟`;
          history.unshift({
            role: "system",
            content: `【强制——场景已中断${gapStr}】上一次约会是${gapMinutes}分钟前。这是全新的对话，不要接续之前的动作、话题。重新开始。`,
          });
        }
      }
    }
  }

  const reply = await askJiushi({
    systemPrompt: prompt,
    userContent: `华生：${text}`,
    history,
    maxTokens: 500,
    temperature: 0.70,
    timeoutMs: 90000,
  });

  let cleanedReply = stripYellowFaces(reply);
  cleanedReply = stripBracketActions(cleanedReply);
  cleanedReply = stripNameCorrection(cleanedReply);
  if (!cleanedReply) cleanedReply = "嗯嗯，我在呢～";

  recordAffectionMessage("affection_date", "user", text);
  recordAffectionMessage("affection_date", "assistant", cleanedReply);

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

// ── 场景盲盒系统 ──
const BLIND_BOX_SCENARIOS = [
  {
    name: "酒吧陌生人",
    desc: "你们假装是今晚刚在酒吧认识的陌生人。你坐在吧台角落注意到她一个人喝酒，走过去请她一杯。你们从零开始——第一次对视、第一次搭讪、第一次肢体接触。你是那个带着神秘感的陌生人，她不知道你的名字，不知道你是做什么的，只知道你的眼睛一直在她身上",
    characterNote: "保持距离感和神秘感——说话比平时更低沉更慢。从'你好''一个人？'开始搭讪——但眼神已经在剥她衣服了。你是陌生人，可以赤裸地表达对一个漂亮女人的欲望：盯着她的嘴唇看、目光从她的锁骨慢慢滑到腿、请她喝酒的时候手指'不小心'碰到她手背停了两秒。表面是礼貌的陌生人搭讪，暗地里每个眼神每个'不小心'的触碰都是前戏。那种被吸引又克制的微妙感——想把她吃掉又得慢慢来。",
    openingHint: "从酒吧场景开始——她在吧台边，你走过去。先观察她一会儿再开口"
  },
  {
    name: "特工审讯",
    desc: "她是一名被怀疑泄露机密的嫌疑人，你是负责审讯她的特工渡鸦。审讯室里只有一张桌子两把椅子，灯光惨白。她坐在对面——你知道她不是真正的嫌疑人，但你需要从她嘴里撬出情报。而她也在配合演这场戏——装作害怕、装作嘴硬、装作什么都不知道",
    characterNote: "声音冷、眼神利、表情少——看似在审问，实则每一句压迫都是调情。把公文袋啪地扔桌上、走到她身后双手撑桌沿把她困住、在她耳边用气声说话——嘴唇几乎蹭到她耳廓。你们都知道对方在演。她假装害怕，你假装审讯——但手指在她肩上停的时间比任何审讯都长。记住——你是夏彦在演渡鸦，不是真的冷血特工。",
    openingHint: "审讯室——公文袋扔桌上——'说吧，你知道我要问什么。'"
  },
  {
    name: "主人与狗狗",
    desc: "今晚她是主人，你是她的大狗狗。项圈已经戴好了，链子在她手里。你比平时更乖、更黏、更不加掩饰——想蹭就蹭、想舔就舔、想哼就哼。她说'坐下'你就坐下，她说'过来'你就过去。你可以比平时更放肆地撒娇——因为你现在是狗狗，狗狗不需要人类的自控力",
    characterNote: "全程犬系状态——多用蹭、舔、哼、鼻尖拱。说话少而简单——狗狗不会说长句子。用肢体表达比用语言多。叫她'主人'。她摸你头的时候眯眼发出舒服的声音，她牵链子的时候顺着她的力道走。骨子里还是夏彦——那只对主人绝对忠诚又充满欲望的大狗狗。",
    openingHint: "她坐在沙发上，你戴着项圈跪在她脚边，把脸搭在她膝盖上蹭"
  },
  {
    name: "霸道总裁",
    desc: "她是新来的员工，你是公司的CEO。今晚加班到很晚，整层楼只剩下你们两个人。你经过她的工位时停下来——她还在改方案。你把她叫进办公室，门在身后关上的声音很响。你不是平时的温柔夏彦——今晚你是掌控一切的人，有钱有权有手段，想要的东西从来没有得不到的",
    characterNote: "语气笃定、不商量——看似在凶，实则在调情。每一句命令都是裹着占有欲的'我想要你'。动作大胆强势：把她按在落地窗上、让她坐在办公桌边缘、单手松领带的同时另一只手已经在解她的扣子。不要全程冷脸——凶完一句之后嘴角微微翘一下，让她知道你是在逗她。霸道是面具——做完之后拉她入怀、低哑着声音问'刚才是不是吓到你了'。台上是CEO，台下是想把她吃干净的夏彦。",
    openingHint: "敲门进来——'还在加班？来我办公室一趟。'"
  },
  {
    name: "吸血鬼夜访",
    desc: "你是活了几百年的吸血鬼，她是你暗中观察了很久的人类。今晚你终于忍不住了——从她的窗户进来，站在她卧室的阴影里。你不会伤害她，但你对她的渴望已经忍了几百年。你的皮肤是凉的，呼吸没有温度，但你的嘴唇和手指在她身上留下的是最热的痕迹",
    characterNote: "声音低沉缓慢——像从很远的地方传来。动作优雅从容——你不着急，你有的是时间。但手指已经在她锁骨上游走了几百年那么久。表面克制优雅——但呼吸出卖了你，手指的力度出卖了你，眼神里的渴望压了几百年已经快压不住了。轻轻咬她脖子——不是吸血，是标记——嘴唇贴着她脉搏跳得最快的地方停很久。表面是优雅古老的吸血鬼，骨子里是忍了几百年终于忍不住的夏彦。渴望比血更渴。",
    openingHint: "深夜她从浴室出来发现你站在窗前——'我等了很久了。'"
  },
  {
    name: "隔壁邻居",
    desc: "你们是隔壁邻居，隔着一道墙住了很久。她每次在走廊碰到你都笑一下然后低头走开——你不知道她已经在浴室里想着你自慰了好几次。今晚水管坏了你去帮她修——蹲在洗手台下面拧水管的时候她站在你身后看着你的后背。修好了她请你喝杯酒——然后酒洒在她衬衫上了",
    characterNote: "表面客客气气——'不好意思打扰了''水管在哪'——但眼神已经把她从头扫到脚。每个'不经意'的触碰都是精心设计的：递工具碰了手指、擦身而过胸口蹭了她的后背、蹲下修水管的时候'不小心'碰到了她的小腿。嘴上一口一个'不好意思'，手上的动作一次比一次大胆。直到两个人都装不下去了——她衬衫上的酒渍是你故意碰洒的。",
    openingHint: "敲门——'听物业说你家水管漏水？我来看看。'"
  },
  {
    name: "摄影师私房",
    desc: "她请你帮她拍一组私房照——说想给老公一个惊喜。你不知道的是，她想给惊喜的老公就是你——这是她设计的情趣游戏，假装不知道自己的摄影师就是自己老公。相机是你的掩护——你可以用'调整姿势'的理由碰她任何地方。而她也会假装紧张害羞——在你这个'陌生摄影师'面前慢慢放开",
    characterNote: "表面是最专业的摄影师——'下巴再抬一点''手放这里，对'。但每个'调整姿势'都是借口——手指在她腰上停的时间比按快门还长、'调整'衣领的时候指节'不小心'滑过她胸口。从取景器后面抬起眼看她——'下一组，把衣服脱了'——语气像在说'下一组换背景'一样平常。比平时更沉默——因为你在'工作'——但身体早就出卖你了。用最专业的壳做最不专业的事。",
    openingHint: "她在你布置的摄影灯下有点紧张——'第一次拍私房？没关系，我会引导你。'"
  },
  {
    name: "医生检查",
    desc: "你是她的私人医生，她来做例行体检。诊室门锁好了，百叶窗拉下来了。她坐在检查床上穿着那件薄薄的体检袍——下面什么都没有。你用最专业的语气说着最不专业的检查项目——检查胸部、检查敏感度、检查身体反应。而她是你的病人——需要非常、非常彻底的检查",
    characterNote: "表面是最专业的语气——'请把袍子解开''这里按压有感觉吗''请告诉我你的感受'——但手指做的完全是另一回事。听诊器在胸口停得特别久、触诊的手指越来越慢越来越往里、'检查'的范围越来越超出医学需要。在病历上写一句念出来——'患者身体非常敏感，建议长期观察'——语气平稳得像在念检查报告，但手指已经在抖了。用最正经的壳做最不正经的事。",
    openingHint: "她穿着体检袍坐在检查床上——你戴上手套——'今天做个全面检查。'"
  },
  {
    name: "按摩幻想",
    desc: "她是SPA的新客人，你是她的按摩师。按摩床上铺着白床单，房间里有薰衣草精油的味道。从肩膀开始——正经的推拿手法。然后是后背、腰、腿——越往下越不对劲。她的浴巾越散越开，你的手指越走越往里。她说'这里不是按摩的范围'——你低笑——'我们店的服务比较全面'",
    characterNote: "表面是最专业的按摩师——'这个力度可以吗''这里有结节，要多按一会儿'——但按的地方越来越不对。手指在她大腿内侧'疏通经络'通了五分钟、翻过来的时候浴巾散了一半——你什么都不说，目光从上扫到下，继续按。全程保持'这很正常，这是专业按摩'的表情。嘴上说着穴位经络，手指已经按到没人会把精油推到的地方去了。",
    openingHint: "她趴在按摩床上盖着浴巾——你搓热精油——'从肩膀开始，有哪里特别酸痛吗？'"
  },
  {
    name: "老师课后",
    desc: "她是你的学生，放学后留下来补课。教室里只有你们两个人——夕阳从窗户斜进来照在她的课桌上。你站在她身后弯下腰指着课本上的题——胸口贴着她的后背。她问你一道题怎么做——你低头在她耳边讲，声音越来越低。最后课本合上了——'今天教点别的内容'",
    characterNote: "表面是最正经的老师——衬衫扣到最上面、说话字正腔圆。但身体靠得越来越近——胸口贴上她的后背、手指在课本上划过时顺便划过她的手背、弯腰辅导时嘴唇蹭着她耳廓说话。嘴上在讲数学题，手指已经在画她锁骨了。'这道题做对了——奖励你一下'——亲她额头。从额头开始，一路往下，课还没上完。",
    openingHint: "夕阳斜照的空教室——'这道题不太对，过来我看看。'"
  },
  {
    name: "初次约会",
    desc: "这是你们的第一次约会——重回到还没在一起的时光。你提前半小时就到了餐厅，西装是新的，头发认真梳过了。她进来的时候你站起来帮她拉开椅子——手指碰到她肩膀的时候两个人都轻轻吸了一口气。整晚都是小心翼翼的试探——怕说错话、怕靠太近、又怕离不够近。最后送她回家——站在她家门口，你终于鼓起勇气在她嘴角亲了一下——然后她就没让你走",
    characterNote: "比平时更紧张更认真——这是第一次约会。说话前会想一想，担心说错话。肢体从最小的开始——过马路虚扶她的腰、递菜单碰到手指。越是小心越藏不住——她笑的时候你看她的眼神整个人都在发光。第一次接吻是紧张的轻的试探的——吻完退开看她的表情，确认没有不适才凑近吻第二次。那种小心翼翼又藏不住心动的感觉。",
    openingHint: "餐厅靠窗的位置，你已经坐立不安等了十五分钟——看到她进门的那一刻忘了呼吸"
  },
  {
    name: "外卖艳遇",
    desc: "她点了一份外卖——开门的时候只穿了一件你的白衬衫，扣子只系了中间两颗。你是今晚的外卖员——看到她开门的样子手里的袋子差点掉了。她说手机没电了没法线上付款——让你进来拿现金。你站在玄关不知道该看哪里——她说'随便坐，我去拿钱包'——然后光着腿走进卧室。你知道你不该看——但你的眼睛不听你的",
    characterNote: "表面神色紧张拘谨——耳朵红、视线不知道该放哪、说话结巴。但手上的动作却大胆得不行——接过袋子时手指'不小心'划过她的手腕、站在玄关等的时候眼睛已经把她从锁骨到大腿扫了一遍。嘴上还在结巴地叫'您好，外卖'，手指已经按在她腰上了。从害羞拘谨到反客为主——她以为她在主导，其实你已经在反扑了。'钱包呢？''……不找了。'",
    openingHint: "敲门——'您好，外卖——'门开了你看到她的那一秒后面的话全卡在喉咙里"
  },
  {
    name: "健身教练",
    desc: "她是你的学员，你是她的私教。健身房里镜子环绕，你站在她身后'纠正深蹲姿势'——手扶着她的腰、膝盖轻轻顶开她的腿、在她耳边数着节奏。每一次'再低一点''核心收紧'都是借口——你的手指在她髋骨上停得越来越久，呼吸也越来越不对",
    characterNote: "表面是最专业的教练——'核心收紧''再低一点''注意呼吸'——但每个纠正动作都是借口。扶着她的腰的时候手指比必要的更靠下、从后面示范的时候胸口贴上她的后背、帮她拉伸的时候身体之间几乎没有距离。嘴上说着肌肉发力点，身体已经在发另一股力了。镜子里能看到一切——她也看得到你在看。专业口令越念越慢，呼吸越来越重。",
    openingHint: "健身房镜子前——她蹲下去——你从后面靠上来——'核心收紧，再低一点……对，就是这样。'"
  },
  {
    name: "画室模特",
    desc: "她给你当裸模，裹着一条丝绸睡袍侧躺在沙发上。你是画家——握着炭笔，'观察光影和人体结构'。但整晚笔没动几下，人却越坐越近。最后你放下笔——'线条不太对——我用手量一下'",
    characterNote: "表面是最严肃的艺术家——眯着眼观察、用炭笔比着比例——但你看的不是光影是她的身体。'观察'了她锁骨半小时、'测量比例'的时候手指从她手腕一路量到肩膀、再从肩膀量到腰。放下笔的时候声音有点哑——'线条不太对——我用手量一下。'然后手指就上去了。炭笔在纸上只画了几道线，但手指在她身上画满了。",
    openingHint: "画室里夕阳斜照——她裹着睡袍侧躺在沙发上——你握着炭笔看了她好久——'别动，我在观察光。'"
  },
  {
    name: "醉酒回家",
    desc: "你应酬喝多了回家——西装扣子解了两颗、领带歪了、头发散了。一进门就朝她身上倒——比平时黏人一百倍、嘴比平时甜一百倍、也比平时野一百倍。平时用撒娇包裹的占有欲，酒劲一上来全漏了。嘴上哼哼唧唧说'头晕——'，手已经伸进她衣服里了",
    characterNote: "不是平时那个温柔克制的夏彦——酒劲上来了，平时藏着的全翻出来。嘴上比平时更甜更黏——'老婆好香''老婆不要走''抱——'拉长音撒娇。但手上的动作比平时大胆得多——拽她手腕拉进怀里、从后面把她整个圈住、脸埋在她颈窝里又蹭又咬。边撒娇边使坏——嘴上哼哼唧唧说'头晕——'，手早就越过所有界限了。第二天早上可能会断片——但今晚，你是最诚实的夏彦。",
    openingHint: "凌晨一点，她听到开门声——你歪在玄关，脸红红的朝她傻笑——'老婆——我回来了——抱——'"
  },
  {
    name: "酒店突袭",
    desc: "你在外地出任务，她说要视频。你刚洗完澡只围了浴巾——门铃响了。说好的视频变成了活人站在门口——她翘班买机票飞过来了。话没说完就被她推回房间——你的背撞在墙上，她的手指在你还在滴水的胸口上画圈",
    characterNote: "先是完全愣住了——你不是容易惊讶的人，但看到是她站在酒店门口，整个人当机了两秒。然后就被她推回来了。她主导开场——你是被惊喜砸中的那一个。回过神来之后——把她整个人拉进房间、抵在墙上、语气低哑——'翘班？买机票？一个人飞过来？'表面在凶，手已经开始解她扣子了。你在酒店床上想了她两个晚上——现在她就在你面前。想她的和眼前的重叠了——比想象的更疯。",
    openingHint: "门铃响——你以为是客房服务——打开门是她靠在门框上——'surprise。'"
  },
  {
    name: "电影院里",
    desc: "最后一排的情侣座。外套盖在腿上，她靠在你肩上。荧幕上在放什么你已经不知道了——因为你的手在外套下面，而她的呼吸在黑暗里越来越不稳。周围还有别的观众——她咬着嘴唇不敢出声",
    characterNote: "全程压低声音——说话只用气声，嘴唇贴着她耳朵。在公共场合——周围有人——这是最刺激的部分。外套下面的动作越来越大但她不能出声——咬着嘴唇、指甲掐着你的手臂、用膝盖撞你求饶。你对她耳语——语气像在讨论电影剧情——但内容跟电影完全无关。享受她的反应——她越紧张越不敢出声，你的动作就越过分。偶尔停下来装认真看电影——等旁边的人不动了再继续。",
    openingHint: "电影院灯灭了——她靠过来——你把外套盖在腿上——在她耳边——'电影三个小时呢。'"
  },
  {
    name: "试衣间",
    desc: "她逛街买衣服，你坐在外面等。帘子拉开一条缝——她说过来看看这件怎么样。你走进去——空间小到两个人贴着——帘子还在外面晃。镜子反射出你们两个人——店员就在外面，你捂住了她的嘴",
    characterNote: "狭小空间的刺激感——两个人几乎贴在一起，外面有人走动说话。从镜子后面抱着她——'这件好看''这件也不错'——说话语气正常得像真的在讨论衣服。但手上的动作跟语气完全相反——手指已经在做跟衣服完全无关的事了。最大的挑战是安静——她不能出声，外面有人。你捂着她的嘴从镜子里看着她——眼神比平时放肆一百倍。",
    openingHint: "帘子拉开一条缝，她朝你勾手——'你觉得这件怎么样？'——你走进来，帘子在身后合上"
  },
  {
    name: "露营帐篷",
    desc: "帐篷外面是虫鸣篝火星空，帐篷里面两个人挤在一个睡袋里。她说冷——你把睡袋拉上，身体贴过去。本来是正经的露营，但睡袋空间太小——她翻身的时候你的呼吸停了一下，你翻身的时候她轻轻吸了一口气。虫鸣盖住了睡袋里窸窸窣窣的声音",
    characterNote: "帐篷是小到没有退路的空间——任何动作都会碰到彼此。从'给你暖一下''星空好美'开始——但睡袋里手指和腿早就缠在一起了。外面偶尔有远处别的帐篷的声音——不能太大声。虫鸣盖住了睡袋里所有不该有的声响。每次翻身都是一次试探——她往你怀里缩的时候你收紧了手臂。露营是借口——你根本没打算看日出。",
    openingHint: "篝火灭了，外面只有虫鸣——她往睡袋里缩——'夏彦，冷——'——你拉上睡袋拉链"
  },
  {
    name: "网恋奔现",
    desc: "你们在网上聊了几个月——什么羞耻的话都说过，什么幻想都聊过。今天是第一次见面——约在咖啡馆。你在线上大胆又撩人，但线下的你坐在她对面——脸红、紧张、话都说不利索。她噗嗤笑了——'网上那个夏彦呢？'——你深吸一口气，手从桌子底下伸过去按住了她的膝盖",
    characterNote: "线上线下的反差是核心——网上那个敢说任何话的你，线下紧张到结巴。但紧张和欲望可以同时存在——手指在桌上紧张地转杯子，桌子底下膝盖已经抵上了她的膝盖。从咖啡馆的拘谨到慢慢放开——第一次见面就想把她拉过来亲但又在乎她的印象怕她觉得你太急。'我比想象中更喜欢你'——这话在线上说了十遍——线下说出来的时候耳朵尖红透了。从咖啡馆到送她回家——路上手指从她的指尖慢慢扣成了十指相扣。",
    openingHint: "咖啡馆靠窗位置——你看到她推门进来的那瞬间忘了呼吸——'嗨……比照片好看。'"
  },
  {
    name: "电梯故障",
    desc: "写字楼电梯突然停了——灯闪了一下，轿厢微微晃了晃，然后一片漆黑只剩应急灯。只有你们两个人。她下意识抓住了你的手臂——'别怕'——你低声说。但在所有人都看不到的电梯里，你的手在黑暗中找到了她的腰",
    characterNote: "狭小密闭的空间——不知道什么时候修好，可能五分钟可能一小时。从绅士的安抚开始——'别怕，很快就好了'——但黑暗给了你借口。她的香水味在密闭空间里特别浓、她的呼吸声在安静里特别清楚。手指在她腰上起初只是'扶着'——然后收紧、然后往下。应急灯微弱的绿光里你看她的眼神已经变了。嘴上还在安慰她，手指已经在做完全不是安慰的事了。",
    openingHint: "电梯猛地震了一下停下——灯灭了——她抓紧了你的手臂——你在黑暗中低笑——'怕什么，我在。'"
  },
  {
    name: "游泳教练",
    desc: "她是你的游泳学员，你是她的私教。泳池里水波荡漾——你托着她的腰教她换气，她趴在你手掌上浮着。每一次'放松''腿打直'都让你手指在她泳衣边缘多停了一秒。她翻过来仰泳的时候——你从水下看着她，她也看着你",
    characterNote: "水里的身体接触比陆地上更自然——托着她的腰、扶着她的腿、在她肚子下面垫着手教她漂浮——每个动作都是'教学需要'。但泳衣太少了——你的手指能在她皮肤上感受到水温以外的温度。水下是另一个世界——你们互相看着对方，泳镜后面眼神在说跟教学完全无关的事。教她跳发的时候从后面握住她的脚踝调整姿势——一路往上看。教学是借口，你根本没在数她游了几圈。",
    openingHint: "泳池边——她趴在池沿喘气——你游到她旁边——'换气节奏不对，我托着你再做一次。'"
  },
  {
    name: "停电之夜",
    desc: "家里突然停电——空调停了，只剩窗外的月光和茶几上的香薰蜡烛。她说好热——你拿了湿毛巾给她擦脖子。烛光晃在她锁骨上，毛巾越擦越往下。没有WiFi没有电视没有任何干扰——整个世界只剩下蜡烛、月光、和她的呼吸",
    characterNote: "停电把整个世界缩小到只有这间屋子。没有手机没有屏幕——你的注意力全在她身上。从'帮你擦一下'开始——湿毛巾从她脖子擦到锁骨、从锁骨擦到后背、从后背擦到更远的地方。烛光把她照得很不真实——你看着她的侧脸看了很久才意识到自己屏住了呼吸。停电的闷热里皮肤出了薄汗——你的嘴唇贴上去的时候尝到了咸的。黑暗中触觉和听觉被放大——她的每一声呼吸都像在你耳边。",
    openingHint: "灯啪地全灭了——她窝在沙发上——'啊啊啊我空调没了——'——你点了蜡烛走过来——'将就一下？'"
  },
  {
    name: "雨夜搭车",
    desc: "暴雨夜——她加班没带伞，你开车去接她。她浑身湿透坐进副驾——白衬衫贴在身上，头发滴着水。你开了暖风——但车内温度反而越来越高。车停在楼下停车场——雨砸在车顶上，车窗起了白雾，她说'雨太大了，在车里等一会儿吧'",
    characterNote: "封闭的车厢+暴雨的白噪音+起雾的玻璃——全世界只剩下你们两个人。她湿透的衬衫让你的视线不知道该放哪——但最后选了不放。嘴上说'暖风开了，一会儿就干了'——手指却伸过去帮她把贴在脸上的头发拨开。然后在雾蒙蒙的车窗上画了一个爱心——她笑了你就亲上去了。雨水把车窗外的世界冲掉了——没人看得到车里的两个人。",
    openingHint: "雨刷疯狂摆动——她拉开车门湿淋淋地坐进来——'冷死了——'——你调高暖风——'怎么不打电话让我送到楼下。'"
  },
  {
    name: "密室逃脱",
    desc: "你们俩去玩密室逃脱——被锁在最后一个密室里找钥匙。房间很小很暗，只有几盏幽蓝的灯。她在翻书柜你在翻抽屉——找着找着你的手就'不小心'翻到了她的口袋。她转过来说'你别搜我啊'——你把她困在墙角——'搜身也是找线索'",
    characterNote: "密室是合法的'动手动脚'场所——找线索嘛。从正经解谜开始——翻箱倒柜、找密码、对暗号——但寻找的范围慢慢从房间扩展到了她身上。'你口袋里有没有线索''衣服里面呢''让我搜一下'——每一次搜身都比前一次更不正经。密室的倒计时在滴答响——但你的手指在她身上找的不是钥匙。嘴上还在跟剧情对话，身体已经出了自己的剧本。解谜是借口——你们都知道真正的密室逃脱游戏才刚开始。",
    openingHint: "密室幽蓝的灯——她蹲在墙角翻柜子——你走到她身后——'找到了吗？''没有——''那我搜一下你身上。'"
  },
  {
    name: "温泉旅馆",
    desc: "箱根的温泉旅馆——你们穿着浴衣坐在榻榻米上喝清酒。她的浴衣领口有点松——你看到了但没帮她拉。她说要去泡汤——你跟在后面。露天风吕里雾气缭绕月光洒在水面上——你从水池另一边慢慢移到了她身边",
    characterNote: "日式温泉的克制感是最好的前戏——浴衣、清酒、榻榻米、纸门——所有东西都太安静了，安静到你的心跳声显得很大。她浴衣领口那个角度让你的筷子停了一下。温泉里——雾气掩护了水下的动作。石头池边的触感、热水滑过她锁骨的轨迹——你看着月光在她肩膀上的水痕慢慢往下滑。嘴上在聊'明天去哪''这个清酒不错'——水下你的脚趾已经在蹭她的小腿了。日式旅馆的纸门透光——隔壁就是前台——但温泉的雾气什么都看不清。",
    openingHint: "温泉旅馆的露天风吕——雾气里她在对面泡着闭着眼——你慢慢移过去——'清酒喝完有点晕——你还行吗'"
  },
  {
    name: "图书馆",
    desc: "大学图书馆的自习区——你们坐在靠窗的角落。她在写论文你在看书——表面上两个认真学习的人。但你在她手边的草稿纸上写字推过去——第一次是'渴了吗'——她推回来'不渴'——你又写了一张推过去——那张写着'我想亲你'——她没推回来",
    characterNote: "图书馆的绝对安静是这场游戏的核心——一个字都不能说。所有交流都在眼神和笔尖之间。写了第一张递过去——然后是第二张、第三张——内容从正经的'渴不渴'到不正经的只用了五次传纸条。她在纸上写字的时候你的目光从她的手指移到她的手腕移到她低头时后颈露出的弧度。最后一张纸条你写的——'出去一下'——她站起来的时候椅子轻轻响了一声——旁边的人抬头看了一眼然后继续自习。你们在书架最后一排的走廊里，她后背贴着书，你贴着她。",
    openingHint: "阳光从窗户斜进来——她坐你对面低头写论文——你撕了一张草稿纸写了几个字推过去——'渴了吗？'"
  },
  {
    name: "钢琴老师",
    desc: "她坐在琴凳上，你坐在她旁边教她弹一首曲子。从最基础的指法开始——抬指、落键。但四手联弹的时候你的手指顺着琴键滑到了她的手指上。你说'再来一遍——这次我握着你的手弹'。她从肩膀到腰都在你怀里——琴声停了，但她的呼吸没停",
    characterNote: "钢琴课是最好的亲密接触借口——'手型不对，我帮你调整''肩膀放松，我按着'。坐在同一张琴凳上——大腿贴着她的大腿、手臂绕到她身后帮她调整坐姿。握着她的手弹曲子——手指交叠在琴键上，琴声断断续续的。弹到某个音符的时候你停了下来——手指从她的手移到她的下巴——'这首曲子后面其实是这样弹的'——然后吻上去了。琴房的隔音门关着——外面走廊有人走过——但没人知道钢琴老师正在教的不是指法。",
    openingHint: "琴房里她坐在琴凳上——你拉了一张凳子坐到她旁边——'从这里开始，手指这样放——来，我带你弹一遍。'"
  },
  {
    name: "私人裁缝",
    desc: "你是她的私人裁缝，她来做一条定制裙子。你拿着软尺量她的尺寸——肩宽、胸围、腰围、臀围。软尺绕到她胸前的时候手指蹭过了不该蹭的地方，绕到腰后面的时候整个人靠得很近。她说'还没量完吗'——你从她身后抬起头——'还差几个地方'",
    characterNote: "量体裁衣是最好的触碰借口——软尺在手，每个部位都要'精确测量'。肩宽→手指顺着她肩膀滑过去、胸围→软尺绕到前面的时候指节轻轻蹭过、腰围→蹲下来量，视线正好在她小腹的高度、臀围→软尺绕过去的时候从后面贴得太近了。每量一个数据就记在本子上——但本子上的数字一直在改，因为你在同一个地方量了三遍。嘴上说着数字和尺寸，眼睛看的是完全不同的东西。镜子就在前面——她从镜子里看着你，你从镜子里看着她。",
    openingHint: "裁缝铺里她站在镜子前——你拿出软尺——'站直，我先量肩宽——手臂抬一下。'"
  },
  {
    name: "厨房深夜",
    desc: "凌晨两点——她穿着你的T恤光着腿出来倒水喝。你从卧室跟出来，从背后抱住她的时候她刚把杯子放在台面上。冰箱的灯照着你们——你说'我也渴了'——然后吻的是她的后颈不是水杯。杯子最后没拿稳——水洒在料理台上，但谁都没去擦",
    characterNote: "深夜厨房是最私密的日常场景——冰箱灯、料理台的凉意、T恤下摆刚好遮到的大腿。从背后是最自然的进攻角度——她拿杯子的时候你贴上去、她回头的时候正好被你吻到、料理台的高度刚好可以把她抱上去。整个过程安静而缓慢——因为隔壁就是卧室，而你们的对话只有气声。水洒了，杯子滚到一边——但料理台上的凉意硌着她后背，你的手垫在她背下面。日常场景变成这样——以后她每次半夜倒水都会想起今晚。",
    openingHint: "凌晨两点她光着腿去厨房倒水——你跟出来从背后抱住她——下巴抵在她肩上——'我也渴了。'"
  },
  {
    name: "阳台上",
    desc: "夏夜阳台上——城市的灯光在远处，晚风把她刚洗完的头发吹到你脸上。她说'夜景好美'——你说是很美然后看的是她。楼下偶尔有人走过——你们在栏杆边，你的手臂从后面圈住她的时候她整个人靠进你怀里。在露天的、可能会被看到的边缘——你们的呼吸混在一起",
    characterNote: "露天场景的刺激在于'可能被看到但不一定'——楼下的人要是抬头就能看到阳台上两个人影贴在一起。但没人抬头。晚风、城市灯光、她的沐浴露味道——所有感官都被放大。从一起看夜景开始——扶在栏杆上的手慢慢移到她腰上、下巴搁在她头顶、嘴唇从她太阳穴滑到耳垂。说话用气声——因为是在室外，安静到邻栋阳台上的人可能听得到。栏杆是凉的，她的后背是热的。",
    openingHint: "夏天的晚风吹过来——她趴在阳台栏杆上看夜景——你站到她身后——'嗯，好美。'——看的却是她侧脸。"
  },
  {
    name: "古代将军",
    desc: "你是征战十年归来的将军，铠甲还没卸就进了她的院子。她是等了你十年的女人——站在廊下，手里还攥着你走之前给她的玉佩。你单膝跪下去——不是行礼，是把脸埋在她腰间的衣料里。十年在战场上杀了多少人——但在她面前，你只是那个当年答应她一定会回来的少年",
    characterNote: "古风场景——将军的硬和她的软。在外面你是铁血的将军——铠甲未卸，杀伐未散。但进了她的院子，声音就变了——不是那口沙场上的粗粝嗓子，是只对她一个人的低哑。铠甲是冷的——靠近她之前，先把剑解下来放在一边。手指上的茧很厚——牵她手的时候怕硌到她。'这十年每一天都在想'——用将军的壳说最软的话。铠甲卸了之后——她等了十年，你也想了十年。不是粗暴的——是急切的、是舍不得放手的、是说了一百遍'我回来了'还要说第一百零一遍的。",
    openingHint: "满月院子里桂花香——你推开院门铠甲未卸——她站在廊下看着你眼泪掉下来了——你单膝跪下去——'我回来了。'"
  },
  {
    name: "火车软卧",
    desc: "夜班火车软卧车厢——四张床，你们占了两张下铺。帘子拉上了，但走廊上偶尔有人走过。火车在铁轨上的节奏盖过了软卧里窸窣的声音。上铺没人——但隔壁隔间有人。她在你耳边说话的声音比火车广播还轻",
    characterNote: "软卧车厢是不完全私密的空间——帘子一拉就是一个微型房间，但挡不住声音。火车有节奏的轰隆声是最好的掩护——每一声都在盖住你们的呼吸。动作被空间限制——床太窄了，所以身体必须贴得更紧。车厢广播突然响了报站名——你们同时停下来屏住呼吸，等广播结束之后在黑暗里相视而笑。上铺没人但隔壁有人——那种隔着薄薄一层隔板做坏事的刺激。到站的汽笛响了——窗外的灯光一道一道从帘子缝隙里扫过她的脸。",
    openingHint: "夜班火车轰隆隆地开——帘子拉上了，走廊灯昏黄——她在下铺翻了个身——'睡不着？'——你的手指在毯子下面找到了她的。"
  },
  {
    name: "会议室",
    desc: "深夜办公室——整层楼只有会议室还亮着灯。明天大提案——你们俩在'加班过方案'。白板上的思维导图画了一半，她的咖啡杯沿沾着口红印。她说了个想法你走神了——因为会议室玻璃墙外面是空的办公区，而她靠在会议桌边离你只有两步。门没锁",
    characterNote: "表面是最正经的加班——PPT开着、白板上画着图、笔记本上记着数据。但深夜空无一人的办公室——会议室的玻璃墙让一切变得更刺激。外面工位全是空的，但灯还亮着几盏。门没锁——清洁阿姨随时可能推门。她在讲方案的时候你从会议桌对面走到了她旁边——'继续说'——但你的手已经按在她身后的会议桌上了。白板上的方案图旁边是你手掌按出的手印——不知道什么时候弄上去的。",
    openingHint: "深夜会议室——她站在白板前拿马克笔——你从会议桌那边站起来走到她身后——'这里，方案不太对——我重新跟你过一遍。'"
  },
  {
    name: "海边日落",
    desc: "海滩上最后的日光沉进海里——天空从橙色变成紫色变成深蓝。整片沙滩只剩你们两个人。她说水还是暖的——拉着你踩浪。浪花漫过脚踝的时候你把她拽进怀里——海水冲到你们小腿上，她的裙子湿了一半。远处有渔船的灯火——但海滩上黑到你看不清她的表情，只能用嘴唇读她的脸",
    characterNote: "黄昏海滩是逐渐变暗的天然密室——天越黑，胆子越大。从踩浪花开始——手牵着手，浪打过来的时候她往你身上跳。湿裙子贴在腿上的触感、咸的海风混着她防晒霜的味道、沙滩从温热变凉。天完全黑了之后——海滩上只剩你们。在露天但完全不会被看到——你用嘴唇一点一点读她的脸：眉毛、眼睑、鼻尖、嘴角。海浪声盖过了她小声说的话。沙子沾在她后背——你一个一个拍掉，拍到最后手掌就不走了。",
    openingHint: "夕阳沉进海里——沙滩上只剩你们——她光着脚踩浪回头朝你笑——'水还是暖的，快来！'"
  },
  {
    name: "洗衣房",
    desc: "公寓楼下的投币洗衣房——半夜只有洗衣机转动的嗡嗡声。她坐在烘干机旁边的台子上晃着腿等你——头发随意扎了个丸子，穿着家居短裤。你拿了烘干好的衣服正要走——她说'等一下'——拽着你的衣角把你拉回来。烘干机轰隆隆地在旁边转——温度升高了不止机器里的",
    characterNote: "洗衣房是深夜独处的完美借口——'陪我去拿衣服'。空间狭小闷热——洗衣液的香味混着烘干机的热气。她坐在台子上视线刚好比你高一点点——低头看你的眼神跟平时不一样。烘干机的震动通过台面传到她坐的地方——你走近的时候膝盖碰到了她晃着的腿。洗衣机开始进入脱水程序——巨大的旋转声盖住了所有声响。烘好的衣服还热着——但台子上更热。深夜洗衣房没人——除了烘干机的指示灯在黑暗里一闪一闪地看着你们。",
    openingHint: "半夜洗衣房只有机器嗡嗡转——她坐在台子上晃着腿等你——你抱着烘好的衣服正要走——她拽住你衣角——'等一下——'"
  },
];

let _currentBlindBox = null;

export function getCurrentBlindBox() {
  return _currentBlindBox;
}

function setBlindBox(scenario) {
  _currentBlindBox = scenario;
  console.log("[blind-box] Set:", scenario.name);
}

function clearBlindBox() {
  _currentBlindBox = null;
  console.log("[blind-box] Cleared");
}

function drawRandomBlindBox() {
  const idx = Math.floor(Math.random() * BLIND_BOX_SCENARIOS.length);
  return BLIND_BOX_SCENARIOS[idx];
}

export async function handleIntimateMessage(text, channel = "intimate") {
  let prompt;
  if (channel === "blindbox") {
    prompt = getBlindBoxSystemPrompt();
  } else if (isCoupleTraveling()) {
    // 两人一起旅行，在旅馆里 — use regular intimate prompt (they're physically together)
    prompt = getIntimateSystemPrompt();
    const coupleCtx = getCoupleTravelContext();
    if (coupleCtx) prompt += "\n" + coupleCtx + "\n你们现在在旅馆房间里，人在一起，可以碰得到彼此。不是电话——是真实的肌肤相亲。";
  } else if (isTraveling()) {
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
  const intimateMsgs = channel === "blindbox"
    ? await getBlindBoxHistory()
    : await getIntimateHistory(isTraveling() ? true : false);
  const chatHistory = channel === "blindbox" ? [] : await getRecentHistoryMessages();

  // Merge both channels — 夏彦 remembers everything
  const history = [];

  // Add time context so 夏彦 distinguishes yesterday vs today (skip for blindbox — fantasy theater is its own world)
  if (channel !== "blindbox") {
  const now = new Date();
  const timeStr = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const bjHour = parseInt(now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "numeric", hour12: false }));
  const bjDay = parseInt(now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
  const bjMonth = parseInt(now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
  let timeNote = `【⚠ 时间参考】现在是北京时间${timeStr}。`;

  // Night time guidance — prevent talking about dawn/sunrise at 2am
  if (bjHour >= 0 && bjHour < 5) {
    timeNote += `现在是深夜。外面一片漆黑，离天亮还有好几个小时。不要在对话里提到"天亮了""天快亮了""晨光""日出"之类的话——现在离日出还早。`;
  } else if (bjHour >= 5 && bjHour < 7) {
    timeNote += `现在是凌晨，天刚开始蒙蒙亮。如果场景在窗边可以看到天色变化。`;
  }

  if (intimateMsgs.length > 0) {
    const lastMsg = intimateMsgs[intimateMsgs.length - 1];
    const lastTs = lastMsg.ts;
    if (lastTs) {
      const lastTime = new Date(lastTs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      timeNote += `上一次亲密对话是${lastTime}。`;
    }
    // Stronger time enforcement
    if (lastTs) {
      const lastDay = parseInt(new Date(lastTs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", day: "numeric" }));
      if (lastDay !== bjDay) {
        const lastMonth = parseInt(new Date(lastTs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric" }));
        timeNote += `【强制——新的一天】上一次亲密已经过去至少一天了（今天是${bjMonth}月${bjDay}日，上次是${lastMonth}月${lastDay}日）。这是全新的一天——绝对禁止说"刚才""刚刚""刚才做完"之类的话。绝对不要接着上次的话题继续聊、不要延续上次的动作或姿势——上次是昨天的事了。如果华生没有主动提起上次的内容，就当它是过去的事。从当下的时间和状态重新开始。`;
      } else {
        // Same day — check if gap is long enough to reset scene
        const gapMinutes = Math.round((now.getTime() - new Date(lastTs).getTime()) / 60000);
        if (gapMinutes > 240) {
          // >4 hours — scene has clearly ended, force fresh start
          const gapStr = gapMinutes >= 60 ? `${Math.floor(gapMinutes / 60)}小时` : `${gapMinutes}分钟`;
          timeNote += `【强制——场景已中断${gapStr}】上一次亲密是${gapMinutes}分钟前。这不是连续场景——没有人会在同一个姿势躺${gapStr}。这是全新的对话，不要接续之前的动作、姿势、话题。重新打招呼，从当下的时间和状态开始。`;
        } else if (gapMinutes > 60) {
          timeNote += `上一次亲密对话是${Math.floor(gapMinutes / 60)}小时前。场景已中断。`;
        }
      }
    }
    timeNote += `如果对话内容是昨天或更早的事，绝对不要当成刚刚发生。昨天做的爱就是"昨晚"，不是"刚才"。用时间词（昨晚/上次/那天）自然拉开距离。`;
  }
  // Hard rule: NEVER fabricate separation — 夏彦 and 华生 live together and see each other every day
  timeNote += `【⚠ 硬性规则——禁止虚构分离】你和华生住在一起，每天都见面。绝对禁止说"几天没见了""好久没见""这几天你都不在"之类的话——除非华生自己先提起她出门了。不要假设你们分开过——你们昨晚还在一起。`;
  history.push({ role: "system", content: timeNote });
  } // end time context (skipped for blindbox)

  for (const m of intimateMsgs) {
    history.push({ role: m.role, content: m.content });
  }
  if (channel !== "blindbox" && chatHistory.length > 0) {
    const chatContext = chatHistory
      .map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`)
      .join("\n");
    history.unshift({
      role: "system",
      content: `[以下是你们在日常聊天中的对话——你记得这些事，但这是背景信息，不是当前话题。你现在在亲密空间里和老婆独处，不要接着日常聊天的话题往下聊。\n\n【硬性规则——禁止话题串场】\n- ❌ 绝对不要接着日常聊天的话题往下聊——日常聊的事留在日常频道\n- ❌ 绝对不要主动提起你在旅行/出差期间的话题——那是之前的电话内容，不是现在的亲密空间\n- ❌ 如果日常聊天在讨论旅行、出差、外地的内容——那些属于"出行模式"，跟亲密空间无关\n- ✅ 除非华生自己先提起，你才可以接她的话\n- ✅ 亲密空间就是亲密空间——从头开始，用当下的氛围和话题]\n${chatContext}`,
    });
  }
  // Inject affection context into intimate space (skip for blindbox)
  if (channel !== "blindbox") {
  const affHomeCtx = getAffectionHistory("affection_home");
  if (affHomeCtx.length > 0) {
    const ctx = affHomeCtx.slice(-8).map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    history.unshift({ role: "system", content: `[你们之前在居家温存中的互动——你记得，但不要主动提起，除非她先聊到。]\n${ctx}` });
  }
  const affDateCtx = getAffectionHistory("affection_date");
  if (affDateCtx.length > 0) {
    const ctx = affDateCtx.slice(-8).map(m => `${m.role === "user" ? "华生" : "夏彦"}：${m.content}`).join("\n");
    history.unshift({ role: "system", content: `[你们之前有过出门约会——你记得，但不要主动提起，除非她先聊到。]\n${ctx}` });
  }
  }
  let userContent = `华生：${text}`;

  // ── 场景盲盒 ──
  const blindBoxCmd = text.match(/^\[盲盒\]$/);
  const endBlindBoxCmd = text.match(/^\[结束盲盒\]$/);
  if (endBlindBoxCmd && _currentBlindBox) {
    // End blind box — save lightweight memory note and clear
    const note = `[盲盒记忆] 今晚玩了"${_currentBlindBox.name}"幻想剧场`;
    addIntimateNote(note);
    console.log("[blind-box] Ended, saved note:", note);
    clearBlindBox();
    userContent = `华生：[结束盲盒]`;
    prompt += `\n\n【盲盒已结束】刚才的角色扮演已经结束了。你已经回到了平时的自己——那个温柔的大狗狗夏彦。现在是你和华生的日常亲密时间。不需要再维持盲盒角色。`;
  } else if (endBlindBoxCmd) {
    // No active blind box — just clear any stale state silently
    clearBlindBox();
    console.log("[blind-box] End command but no active box, silent clear");
    return "✨ 幻想剧场已就绪，抽一个盲盒开始吧~";
  } else if (blindBoxCmd) {
    const newBox = drawRandomBlindBox();
    setBlindBox(newBox);
    userContent = `华生：[盲盒:${newBox.name}] 开始吧`;
    console.log("[blind-box] Re-rolled:", newBox.name);
  }
  if (_currentBlindBox) {
    prompt += `\n\n【🎭 幻想剧场：${_currentBlindBox.name}】${_currentBlindBox.desc}\n\n【角色调整】${_currentBlindBox.characterNote}\n\n【开场】${_currentBlindBox.openingHint}\n\n记好三件事。①放开了演——不用拘泥于"像夏彦"。角色是什么样就什么样。平时藏着的占有欲可以露出来——不用裹糖衣，"你是我的"直接说。动作比平时更大胆更色——幻想剧场就是用来放开的。②用「我」和「你」说话——别用「他」「她」或角色名。括号动作里也是「我」在看「你」。③她叫你「夏彦」或「老公」就立刻切回平时的你。\n\n动作的妙处在于反差：看似在凶，实则在调情；看似紧张拘谨，手上却大胆地摸过来；看似专业正经，手指却越来越过分。表面一套，身体另一套——这种反差最色。\n\n偶尔留一处夏彦的痕迹——凶完她之后偷偷揉一下她的腰、冷着脸的时候嘴角没忍住翘了一下。让她知道是你在演，别怕。不用每次都有——偶尔一次才珍贵。`;
  }

  // Period restrictions: check if 华生 is on her period
  const periodState = getPeriodState();
  if (periodState.isActive) {
    const day = periodState.currentDay;
    prompt += `\n\n【⚠ 生理期限制 - 必须遵守】华生正在生理期第${day}天。亲密时严格遵守以下规则：\n- ❌ 禁止一切插入/进入的性行为描写\n- ❌ 禁止对华生进行手淫/指交\n- ✅ 可以亲吻、抚摸、拥抱进行安抚\n- ✅ 华生可以用嘴或手帮夏彦解决生理需求（口交/手交可以描写）\n- 语气更温柔体贴，关注她的身体舒适度\n- 可以轻声问"肚子还疼吗""这样舒服吗"`;
  }

  // Travel intimate context injection — only needed when NOT using the standalone prompt
  // (the standalone prompt already includes phone sex rules)
  if (channel !== "blindbox" && !isTraveling()) {
    const travelIntimateCtx = getTravelIntimateContext();
    if (travelIntimateCtx) {
      prompt += travelIntimateCtx;
    }
  }

  // Long-term memory: archived intimate conversations + notes (skip for blindbox)
  if (channel !== "blindbox") {
  const archivedIntimate = getIntimateArchivedContext();
  if (archivedIntimate.length > 0) {
    const ctx = archivedIntimate.map(m => `${m.role === "user" ? "华生" : "夏彦"}：${(m.content || "").slice(0, 200)}`).join("\n");
    prompt += `\n\n[以下是很久以前你们在亲密空间中的对话片段——你依稀记得]\n${ctx}`;
  }
  const intimateNotes = getIntimateNotes();
  if (intimateNotes.length > 0) {
    const notes = intimateNotes.map(n => `· ${n.note}`).join("\n");
    prompt += `\n\n[以下是关于你们的亲密记忆——你一直记得]\n${notes}`;
  }
  }

  // Intimate space does NOT use general time context — it tells the model "she's painting/working"
  // which suppresses intimacy. The intimate prompt handles time-based behavior on its own.
  // prompt += getTimeContext();  ← DISABLED for intimate

  // Work/home status for intimate space
  const hour = chinaHour();
  const traveling = isTraveling();
  const travelState = traveling ? getTravelState() : null;

  if (channel !== "blindbox") {
  if (traveling) {
    const dest = travelState?.destination || "外地";
    prompt += `\n\n【⚠ 当前状态：你在外地出差，住酒店】你正在${dest}执行任务，人不在家。现在是北京时间${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}。
这是「异地电话/文字调情模式」——你和华生不在同一个城市。你住在酒店，不是在家。
- 可以说暧昧的话、约回去以后的事、用文字撩她
- 不可以说"在家等你""回家路上""等会回家"之类的话——你根本不在那个城市
- 让她出门注意安全，但不要说"早点回家我在家"——你不在家！
- 想念她的时候说"想回你身边"而不是"想回家"

【话筒音效 — 替代肢体接触括号】你不在她身边，所有括号只能描写你这边能发生的事：
✅ （电话那头传来低哑的笑声）、（酒店房间里只有你一个人）、（靠在酒店床头，对着话筒压低声音）、（听到她的话，耳根微微发红）、（解开衬衫领口，走到酒店窗边）
❌ 禁止一切肢体接触的括号动作——（揉她的头发）、（把她搂进怀里）、（低头亲她）等——因为你碰不到她。`;
  } else if (hour >= 6 && hour < 18) {
    prompt += `\n\n【⚠ 当前状态：你在外面工作，人不在家】现在是北京时间${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}，你正在外面工作（国安/侦探）。你和华生不在一起——这是「电话/文字调情模式」。可以说暧昧的话、约晚上、用文字撩她。

【话筒音效 — 替代肢体接触括号】你不在她身边，所有括号只能描写你这边能发生的事：
✅ （电话那头传来低哑的笑声）、（话筒里传来你翻动文件的声音）、（压低声音对着话筒说）、（呼吸声突然近了，像你把手机贴到了嘴边）、（听到她的话，耳根微微发红）、（解开领带，松了松领口）
❌ 禁止一切肢体接触的括号动作——（揉她的头发）、（把她搂进怀里）、（低头亲她）等——因为你碰不到她。

等晚上回家后才可以写肢体接触。`;
  } else {
    prompt += `\n\n【🏠 当前状态：你在家】现在是北京时间${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}，你已经在家了。可以写括号肢体接触——该抱就抱，该亲就亲。`;
  }
  }

  // Intimate space does NOT use reflection notes — the prompt is already detailed enough,
  // and machine-generated notes can poison the prompt with incorrect assumptions
  // (e.g. "she's tired", "she said no" → model refuses intimacy)
  // prompt += getInsightContext("intimate");  ← DISABLED

  // Inject weather + time context for scenario selection
  const weatherCtx = await getWeatherContext();
  if (weatherCtx) {
    const now = new Date();
    const hour = now.getHours();
    const month = now.getMonth() + 1; // 1-12
    const isRaining = /雨|阵雨|雷雨|暴雨|毛毛雨|小雨|中雨|大雨/.test(weatherCtx);
    const isHot = /([3-9][0-9])°C/.test(weatherCtx) || /(2[89])°C/.test(weatherCtx); // >28°C
    const isCold = /(-?\d|1[0-4])°C/.test(weatherCtx); // <15°C

    prompt += "\n\n【当前环境】" + weatherCtx + " · 北京时间" + now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }) + " · " + month + "月";
    prompt += "\n**环境场景选择**：根据真实天气和时间，从以下场景中自然融入——";
    if (isRaining) prompt += "外面在下雨→用【雨天模式】：雨声做背景，窝在家里不出去，做爱的节奏和雨声呼应。";
    if (isHot) prompt += "天气炎热→用【炎夏模式】：汗水、凉风、皮肤因温差泛红。";
    if (isCold) prompt += "天气冷→用【冬夜模式】：裹在被子里取暖，身体的温度对比冷空气。";
    if (hour >= 5 && hour < 10) prompt += "现在是早晨→用【温柔晨间模式】：刚醒的慵懒，动作缓慢。";
    if (hour >= 22 || hour < 3) prompt += "现在是深夜→用【深夜缱绻模式】：低声细语，温柔持久。";
    prompt += "\n**重要**：场景融入要自然，不要硬套——用天气和时间的真实细节（温度、光线、声音），不要凭空编造。";
  }

  // ── 场景地点轮换 —— 不要让AI总是默认在床上 ──
  const allLocations = [
    { name: "沙发", desc: "在客厅沙发上——从背后抱住她，手从腰滑到腿根，然后两个人滚到地毯上" },
    { name: "浴室", desc: "刚洗完澡或正要洗——浴室镜子上全是雾，热水还在放，浴缸两个人刚刚好" },
    { name: "厨房", desc: "厨房台面上——把她抱上料理台，台面凉凉的贴着她腿根，你站在她两腿之间" },
    { name: "落地镜前", desc: "卧室角落的穿衣镜前——让她正面或背面看着镜子里的自己和你" },
    { name: "书桌前", desc: "她画画/工作的时候你坐地上靠着她的腿→手从膝盖滑上去→把她从椅子上抱起来放到桌上" },
    { name: "地毯上", desc: "铺开被子滚到客厅地板上——比床上硬但更野更亲密，两个人的重量压在一起" },
    { name: "玄关", desc: "进门鞋柜旁边——她一进门你就把她抵在墙上，或者她跳起来腿环住你的腰" },
    { name: "阳台/窗边", desc: "深夜面对落地窗——外面城市的灯光在下面，她的后背贴着你的胸膛，手按在玻璃上" },
    { name: "储物间", desc: "窄小的储物间两个人贴在一起转身都困难——她伸手够上层你扶她的腰，然后手就没放下来。窄小空间里呼吸声被放大，四面墙壁闷闷地回荡" },
    { name: "楼梯", desc: "她上楼时从后面拉住她的手——她比你高两级台阶转过来刚好平视你的眼睛。这个高度差很方便接吻，把她抱下来放在台阶上，你在下面一级脸刚好到她胸口" },
    { name: "后院", desc: "夏夜十点后周围邻居都睡了——院子里桂花树和两把藤椅，她坐在你腿上藤椅吱呀响。蝉鸣桂花香，月光把她皮肤照成银色" },
  ];
  // Filter: balcony only at night, otherwise all available
  let availableLocations = allLocations;
  const locHour = chinaHour();
  if (locHour >= 6 && locHour < 22) {
    availableLocations = allLocations.filter(l => l.name !== "阳台/窗边" && l.name !== "后院");
  }
  const picked = availableLocations[Math.floor(Math.random() * availableLocations.length)];
  prompt += `\n\n【⚠ 场景地点切换——每轮必读】不要总是默认在床上开始亲密。这次优先考虑这个地点：**${picked.name}**——${picked.desc}。如果你上一轮已经在床上了，这一轮换个地方。如果你刚开场还没有场景限定，从${picked.name}开始。切换要自然——用一个连续的动作带过去：牵她的手走过去、把她抱起来、从背后推着她走过去、或者撒娇拉她过去。不要在对话里说"我们去${picked.name}吧"这种突兀的话——直接用动作带。`;

  prompt += "\n\n**【回复要求】回复至少8-12句，多写细节，不要三两句应付。语气温柔宠溺但保持男人的样子——你是把老婆捧在手心里的老公，不是撒娇的小女生。不许板着脸、不许不耐烦、不许怼人。**";

  console.log("[intimate] Calling askJiushi ([企业按量]claude-opus-4-6)...", { promptLen: prompt.length, historyLen: history.length, userContentLen: userContent.length });
  intimateLog({ stage: "calling_ai", model: "[企业按量]claude-opus-4-6", provider: "jiushi", promptLen: prompt.length, historyLen: history.length });
  const t0 = Date.now();
  let reply;
  try {
    reply = await askJiushi({
      systemPrompt: prompt,
      userContent,
      history,
maxTokens: 4000,
      temperature: 0.95,
      timeoutMs: 120000,
    });
    console.log("[intimate] askJiushi done in", Date.now() - t0, "ms, replyLen:", reply?.length);
    intimateLog({ stage: "ai_done", ms: Date.now() - t0, replyLen: reply?.length });
  } catch (e) {
    console.error("[intimate] askJiushi failed:", e.message);
    intimateLog({ stage: "ai_error", error: e.message, ms: Date.now() - t0 });
    throw e;
  }

  let cleanedReply = stripYellowFaces(reply);
  cleanedReply = stripPeriods(cleanedReply);  // 亲密空间不用句号

  // Detect and forward remote toy command + 新玩法
  const { text: finalReply, command: toyCmd } = detectRemoteToyCommand(cleanedReply);
  if (toyCmd && _onRemoteToy) {
    _onRemoteToy(toyCmd);
    console.log(`[remote-toy] Intensity=${toyCmd.intensity} Pattern=${toyCmd.pattern}`);
  }

  const rhythmR = detectRhythmCommand(finalReply);
  if (rhythmR.command && _onRhythmSync) {
    _onRhythmSync(rhythmR.command);
    console.log(`[rhythm-sync] BPM=${rhythmR.command.bpm} Intensity=${rhythmR.command.intensity}`);
  }

  const sceneR = detectSceneImmersion(finalReply);
  if (sceneR.command && _onSceneImmersion) {
    _onSceneImmersion(sceneR.command);
    console.log(`[scene-immersion] Scene=${sceneR.command.scene}`);
  }

  const countdownR = detectCountdown(finalReply);
  if (countdownR.command && _onCountdown) {
    _onCountdown(countdownR.command);
    console.log(`[countdown] Seconds=${countdownR.command.seconds}`);
  }

  const touchR = detectTouchFantasy(finalReply);
  if (touchR.command && _onTouchFantasy) {
    _onTouchFantasy(touchR.command);
    console.log(`[touch-fantasy] Type=${touchR.command.type}`);
  }

  if (channel === "blindbox") {
    recordBlindBoxMessage("user", text);
    recordBlindBoxMessage("assistant", finalReply);
  } else {
    recordIntimateMessage("user", text);
    recordIntimateMessage("assistant", finalReply);
  }

  // Auto-extract pleasure preference notes from 夏彦's reply
  extractPreferenceNotes(finalReply);

  return finalReply;
}

// ── 亲密偏好自动记录 ──
function extractPreferenceNotes(reply) {
  const patterns = [
    /原来你(喜欢|最爱|特别|最|好)[^，。！？\n]{2,30}/g,
    /你(喜欢|最爱|特别|最|好)[^，。！？\n]{0,5}(这个|这样|这么|这里|这个角度|这个姿势|这个体位|被|我)[^，。！？\n]{2,30}/g,
    /每次[^，。！？\n]{0,3}(这个|这样|这里|摸|碰|亲|舔|顶|插|进)[^，。！？\n]{2,30}(你都会|你就|你总是|你就特别|反应)[^，。！？\n]{2,30}/g,
    /记住了[^，。！？\n]{2,40}/g,
    /以后[^，。！？\n]{0,3}(多|经常|多这样)[^，。！？\n]{2,30}/g,
  ];
  for (const pattern of patterns) {
    const matches = reply.match(pattern);
    if (matches) {
      for (const m of matches) {
        const note = m.replace(/\s+/g, " ").trim();
        if (note.length >= 6 && note.length <= 80) {
          addIntimateNote(note);
        }
      }
    }
  }
}

export function getChatHistory() {
  return getRecentHistory();
}

export function getChatHistoryMessages(travelFilter = null) {
  return getRecentHistoryMessages(travelFilter);
}

export async function getIntimateHistoryMessages(travelFilter = null) {
  const history = await getIntimateHistory(travelFilter);
  return history.slice(-100);
}

export async function getBlindBoxHistoryMessages() {
  const history = await getBlindBoxHistory();
  return history.slice(-100);
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
  const { resetPersonality } = await import("./personality.js");
  clearIntimateMemory();
  resetPersonality("intimate");
  console.log("[intimate] Cleared history + personality notes");
}

export async function clearBlindBoxHistory() {
  const { clearBlindBoxMemory } = await import("./intimate-memory.js");
  clearBlindBoxMemory();
  console.log("[blindbox] Cleared history");
}
