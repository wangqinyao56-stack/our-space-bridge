/**
 * Proactive chat — 夏彦主动给华生发消息。
 * 早上9点到晚上11点之间，每2-3小时检查一次，发消息后冷却4小时，
 * 每天最多5条。华生20分钟不回则追发，最多3-5轮。
 */

import fs from "node:fs";
import { askClaude } from "./ai.js";
import { getDailySystemPrompt } from "./message-router.js";
import { getRecentHistoryMessages, recordUserMessage, recordBotReply } from "./memory.js";

const STATE_FILE = "./proactive-chat-state.json";
const CHECK_MIN = 120; // min minutes between checks (2h)
const CHECK_MAX = 180; // max minutes between checks (3h)
const COOLDOWN_MINUTES = 240; // 4h cooldown after sending
const MAX_DAILY = 5;
const FOLLOW_UP_DELAY = 20; // minutes before follow-up
const FOLLOW_UP_MIN = 3;
const FOLLOW_UP_MAX = 5;

let state = {
  date: "",
  dailyCount: 0,
  lastCheckTime: 0,
  lastProactiveTime: 0,
  followUp: {
    active: false,
    rounds: 0,
    maxRounds: 3,
    lastSent: 0,
  },
};

let proactiveTimer = null;
let followUpTimer = null;
let onProactiveMessage = null;

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      state = { ...state, ...saved };
    }
  } catch {}
}
load();

function save() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function chinaNow() {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

function chinaDateStr() {
  const c = chinaNow();
  return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, "0")}-${String(c.getUTCDate()).padStart(2, "0")}`;
}

function chinaHour() {
  return chinaNow().getUTCHours();
}

function isActiveHours() {
  const h = chinaHour();
  return h >= 9 && h < 23;
}

function dailyReset() {
  const today = chinaDateStr();
  if (state.date !== today) {
    state.date = today;
    state.dailyCount = 0;
    state.followUp.active = false;
    state.followUp.rounds = 0;
    save();
  }
}

// ── Topic variety pool ──
const TOPIC_HINTS = [
  "分享一件今天让你觉得有趣的小事（不问她问题）",
  "分享一个突然想到的回忆或想法，自然开启话题",
  "关心她当下的状态——比如这个时间段她可能在做什么，温柔地问一句",
  "提一下花生（你们的宠物），说说它可能在干嘛",
  "分享一个冷知识或者你刚学到的新东西",
  "用撒娇的语气说想她了，但不要只发这一句，后面接个自然的话题",
  "提到最近你们一起做的事或者聊过的话题，延续下去",
  "根据当前时间段自然地展开话题（午餐时间聊吃的，下午聊工作/学习进度，晚上聊放松）",
  "分享一个关于你的小日常（你在做什么/在想什么），让她感觉你在生活",
  "用轻松搞怪的语气开启一个假设性问题（「如果…你会…」之类的）",
];

// Topic tracker to avoid repetition within same day
const usedTopics = [];

function pickTopicHint() {
  const available = TOPIC_HINTS.filter((t) => !usedTopics.includes(t));
  if (available.length === 0) {
    usedTopics.length = 0;
    return TOPIC_HINTS[Math.floor(Math.random() * TOPIC_HINTS.length)];
  }
  const pick = available[Math.floor(Math.random() * available.length)];
  usedTopics.push(pick);
  return pick;
}

async function generateProactiveMessage(isFollowUp = false) {
  const prompt = getDailySystemPrompt();
  const hour = chinaHour();
  const history = await getRecentHistoryMessages();

  let timeContext = "";
  if (hour >= 9 && hour < 12) timeContext = "现在是上午，华生可能在工作或学习。";
  else if (hour >= 12 && hour < 14) timeContext = "现在是午饭时间，可以关心她吃了没、吃了什么。";
  else if (hour >= 14 && hour < 18) timeContext = "现在是下午，她可能在忙。关心一下她的状态。";
  else if (hour >= 18 && hour < 21) timeContext = "现在是晚上，她可能刚下班/放学或在休息。";
  else if (hour >= 21 && hour < 23) timeContext = "夜深了，她可能准备休息了。语气更温柔。";

  const topicHint = pickTopicHint();

  const followUpContext = isFollowUp
    ? `\n\n【追发模式】你之前发的消息华生还没回。再发一条——可以换个话题，也可以用撒娇的语气说"诶你怎么不理我～"，但不要有责备的语气。不要重复上一条的内容。`
    : `\n\n【话题指导】${topicHint}\n${timeContext}\n这是你今天第${state.dailyCount + 1}条主动消息（每天最多${MAX_DAILY}条）。消息要像真人发微信——简短自然（1-3句话），不要长篇大论。`;

  const userContent = `夏彦，你现在想主动给华生发一条消息。\n${followUpContext}\n\n【重要规则】\n- 像平时发微信一样，简短自然，1-3句话\n- 不要括号动作描写\n- 不要问她"在干嘛"（太平淡了）\n- 不要开场白式的"宝宝"（除非你平时就这样叫她）\n- 直接开启一个自然的话题\n- 用夏彦的口吻——活泼、阳光、可以撒娇`;

  const reply = await askClaude({
    systemPrompt: prompt + `\n\n【主动发消息模式】你现在是主动给华生发微信。像真实生活中的男朋友——不会每次都问"你在干嘛"，而是自然地说点什么：分享一件趣事、突然想她了、关心她现在好不好。你是小太阳性格——开朗活泼，消息要简短自然，像真人发微信。`,
    userContent,
    history: history.slice(-6),
    maxTokens: 200,
  });

  return reply.trim();
}

async function sendProactiveMessage(isFollowUp = false) {
  if (!onProactiveMessage) return null;

  const message = await generateProactiveMessage(isFollowUp);
  if (!message) return null;

  onProactiveMessage(message);
  recordBotReply(message);

  state.lastProactiveTime = Date.now();
  state.dailyCount++;

  if (isFollowUp) {
    state.followUp.rounds++;
    state.followUp.lastSent = Date.now();
  } else {
    // Start follow-up tracking
    state.followUp.active = true;
    state.followUp.rounds = 0;
    state.followUp.maxRounds = FOLLOW_UP_MIN + Math.floor(Math.random() * (FOLLOW_UP_MAX - FOLLOW_UP_MIN + 1));
    state.followUp.lastSent = Date.now();
    scheduleFollowUpCheck();
  }

  save();
  console.log(`[proactive] Sent${isFollowUp ? " follow-up" : ""} message (#${state.dailyCount}/${MAX_DAILY}, follow-up ${state.followUp.rounds}/${state.followUp.maxRounds})`);
  return message;
}

function scheduleFollowUpCheck() {
  if (followUpTimer) clearTimeout(followUpTimer);

  if (!state.followUp.active || state.followUp.rounds >= state.followUp.maxRounds) {
    return;
  }

  const delay = FOLLOW_UP_DELAY * 60 * 1000;
  followUpTimer = setTimeout(() => {
    checkFollowUp();
  }, delay);
}

async function checkFollowUp() {
  dailyReset();

  if (!state.followUp.active) return;
  if (state.followUp.rounds >= state.followUp.maxRounds) {
    state.followUp.active = false;
    save();
    return;
  }
  if (!isActiveHours()) {
    // Outside active hours, stop follow-ups
    state.followUp.active = false;
    save();
    return;
  }

  // Check if user has replied since last follow-up
  const lastReply = state._lastUserReplyTime || 0;
  if (lastReply > state.followUp.lastSent) {
    // User replied, stop following up
    console.log("[proactive] User replied, stopping follow-ups");
    state.followUp.active = false;
    state.followUp.rounds = 0;
    save();
    return;
  }

  // Send follow-up
  await sendProactiveMessage(true);
  scheduleFollowUpCheck();
}

function scheduleNextCheck() {
  if (proactiveTimer) clearTimeout(proactiveTimer);

  // Random delay between CHECK_MIN and CHECK_MAX minutes
  const delayMinutes = CHECK_MIN + Math.random() * (CHECK_MAX - CHECK_MIN);
  const delay = delayMinutes * 60 * 1000;

  proactiveTimer = setTimeout(() => {
    checkAndSend();
  }, delay);

  state.lastCheckTime = Date.now();
  console.log(`[proactive] Next check in ~${Math.round(delayMinutes)}min`);
}

async function checkAndSend() {
  dailyReset();

  // Check active hours
  if (!isActiveHours()) {
    console.log("[proactive] Outside active hours (9:00-23:00), skipping");
    scheduleNextCheck();
    return;
  }

  // Check daily limit
  if (state.dailyCount >= MAX_DAILY) {
    console.log(`[proactive] Daily limit reached (${MAX_DAILY}), skipping`);
    scheduleNextCheck();
    return;
  }

  // Check cooldown
  const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
  if (state.lastProactiveTime && (Date.now() - state.lastProactiveTime) < cooldownMs) {
    const remaining = Math.round((cooldownMs - (Date.now() - state.lastProactiveTime)) / 60000);
    console.log(`[proactive] Cooldown active (${remaining}min remaining), skipping`);
    scheduleNextCheck();
    return;
  }

  // Don't send if a follow-up chain is active and user hasn't replied
  if (state.followUp.active && state.followUp.rounds > 0) {
    const lastReply = state._lastUserReplyTime || 0;
    if (lastReply <= state.followUp.lastSent) {
      console.log("[proactive] Follow-up chain active, waiting for user reply");
      scheduleNextCheck();
      return;
    }
  }

  // Check if user has interacted recently (within last 30 min)
  // If they just chatted, maybe skip this round
  const lastReply = state._lastUserReplyTime || 0;
  if (lastReply && (Date.now() - lastReply) < 30 * 60 * 1000) {
    console.log("[proactive] User was active recently (<30min), skipping");
    scheduleNextCheck();
    return;
  }

  // Send proactive message
  await sendProactiveMessage(false);
  scheduleNextCheck();
}

// ── Public API ──

export function startProactiveChat(callback) {
  onProactiveMessage = callback;

  dailyReset();

  // Schedule first check in 30 minutes
  const firstDelay = 30 * 60 * 1000;
  proactiveTimer = setTimeout(() => {
    checkAndSend();
  }, firstDelay);

  console.log("[proactive] Proactive chat started (first check in 30min)");
}

export function stopProactiveChat() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  if (followUpTimer) clearTimeout(followUpTimer);
  proactiveTimer = null;
  followUpTimer = null;
  onProactiveMessage = null;
}

/**
 * Call this whenever the user sends a message (text or voice).
 * Resets follow-up chain and updates last reply time.
 */
export function notifyUserActivity() {
  state._lastUserReplyTime = Date.now();

  if (state.followUp.active) {
    console.log("[proactive] User replied, stopping follow-up chain");
    state.followUp.active = false;
    state.followUp.rounds = 0;
    if (followUpTimer) clearTimeout(followUpTimer);
    save();
  }
}

export function getProactiveState() {
  return {
    ...state,
    isActiveHours: isActiveHours(),
    remainingToday: MAX_DAILY - state.dailyCount,
    followUpActive: state.followUp.active,
  };
}
