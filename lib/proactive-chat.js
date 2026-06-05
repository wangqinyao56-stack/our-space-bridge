/**
 * Proactive chat - Xiayan sends messages to Huasheng proactively.
 * Active 9:00-23:00, checks every 2-3h, 4h cooldown after sending,
 * max 5 per day, follow-up if no reply within 20min (3-5 rounds).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askAicoding } from "./ai.js";
import { getDailySystemPrompt, getTravelSystemPrompt } from "./message-router.js";
import { getRecentHistoryMessages, recordUserMessage, recordBotReply } from "./memory.js";
import { isTraveling, getTravelState } from "./scenery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "proactive-chat-state.json");
const STRINGS_FILE = path.join(__dirname, "..", "proactive-chat-strings.json");
const CHECK_MIN = 120;
const CHECK_MAX = 180;
const COOLDOWN_MINUTES = 240;
const MAX_DAILY = 5;
const FOLLOW_UP_DELAY = 20;
const FOLLOW_UP_MIN = 3;
const FOLLOW_UP_MAX = 5;

let S = null;
function loadStrings() {
  try {
    S = JSON.parse(fs.readFileSync(STRINGS_FILE, "utf-8"));
    if (!S.userContentFormat) console.error("[proactive] WARNING: userContentFormat missing in strings file");
  } catch (err) {
    console.error(`[proactive] Failed to load strings file (${STRINGS_FILE}):`, err.message);
    S = { topicHints: [], timeContext: {}, followUpContext: "", topicGuideFormat: "", userContentFormat: "", systemPromptAddition: "" };
  }
}
loadStrings();

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

// Topic tracker to avoid repetition within same day
const usedTopics = [];

// Topics that don't make sense when 夏彦 is traveling (not in 未名市)
const LOCAL_ONLY_TOPICS = [
  "分享你今天在侦探事务所遇到的案子",
  "跟华生聊聊花生今天的趣事",
  "分享你修理古物时的一个新发现",
  "分享你今天跑步时看到的好风景",
];

function pickTopicHint() {
  const traveling = isTraveling();
  let pool = S.topicHints.filter((t) => !usedTopics.includes(t));
  // When traveling, filter out local-only topics
  if (traveling) {
    pool = pool.filter((t) => !LOCAL_ONLY_TOPICS.includes(t));
  }
  if (pool.length === 0) {
    usedTopics.length = 0;
    pool = traveling
      ? S.topicHints.filter((t) => !LOCAL_ONLY_TOPICS.includes(t))
      : [...S.topicHints];
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  usedTopics.push(pick);
  return pick;
}

function getTimeContext() {
  const hour = chinaHour();
  if (hour >= 9 && hour < 12) return S.timeContext.morning;
  if (hour >= 12 && hour < 14) return S.timeContext.lunch;
  if (hour >= 14 && hour < 18) return S.timeContext.afternoon;
  if (hour >= 18 && hour < 21) return S.timeContext.evening;
  if (hour >= 21 && hour < 23) return S.timeContext.night;
  return "";
}

async function generateProactiveMessage(isFollowUp = false) {
  // Use standalone travel prompt when traveling — completely separate rules
  const traveling = isTraveling();
  const prompt = traveling ? getTravelSystemPrompt() : getDailySystemPrompt();
  const history = await getRecentHistoryMessages();

  const topicHint = pickTopicHint();
  const timeContext = getTimeContext();

  const followUpContext = isFollowUp
    ? "\n\n" + S.followUpContext
    : "\n\n" + S.topicGuideFormat
        .replace("{topicHint}", topicHint)
        .replace("{timeContext}", timeContext)
        .replace("{count}", String(state.dailyCount + 1))
        .replace("{max}", String(MAX_DAILY));

  const userContent = S.userContentFormat.replace("{followUpContext}", followUpContext);

  const reply = await askAicoding({
    systemPrompt: prompt + "\n\n" + S.systemPromptAddition,
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
    state.followUp.active = false;
    save();
    return;
  }

  const lastReply = state._lastUserReplyTime || 0;
  if (lastReply > state.followUp.lastSent) {
    console.log("[proactive] User replied, stopping follow-ups");
    state.followUp.active = false;
    state.followUp.rounds = 0;
    save();
    return;
  }

  await sendProactiveMessage(true);
  scheduleFollowUpCheck();
}

function scheduleNextCheck() {
  if (proactiveTimer) clearTimeout(proactiveTimer);

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

  if (!isActiveHours()) {
    console.log("[proactive] Outside active hours (9:00-23:00), skipping");
    scheduleNextCheck();
    return;
  }

  if (state.dailyCount >= MAX_DAILY) {
    console.log(`[proactive] Daily limit reached (${MAX_DAILY}), skipping`);
    scheduleNextCheck();
    return;
  }

  const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
  if (state.lastProactiveTime && (Date.now() - state.lastProactiveTime) < cooldownMs) {
    const remaining = Math.round((cooldownMs - (Date.now() - state.lastProactiveTime)) / 60000);
    console.log(`[proactive] Cooldown active (${remaining}min remaining), skipping`);
    scheduleNextCheck();
    return;
  }

  if (state.followUp.active && state.followUp.rounds > 0) {
    const lastReply = state._lastUserReplyTime || 0;
    if (lastReply <= state.followUp.lastSent) {
      console.log("[proactive] Follow-up chain active, waiting for user reply");
      scheduleNextCheck();
      return;
    }
  }

  const lastReply = state._lastUserReplyTime || 0;
  if (lastReply && (Date.now() - lastReply) < 30 * 60 * 1000) {
    console.log("[proactive] User was active recently (<30min), skipping");
    scheduleNextCheck();
    return;
  }

  await sendProactiveMessage(false);
  scheduleNextCheck();
}

// Public API

export function startProactiveChat(callback) {
  onProactiveMessage = callback;
  dailyReset();
  // Start with a shorter first check (5-15 min) so proactive messages fire sooner
  const firstDelay = (5 + Math.random() * 10) * 60 * 1000;
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
