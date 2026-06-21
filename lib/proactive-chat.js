/**
 * Proactive chat - Xiayan sends messages to Huasheng proactively.
 * Active 9:00-23:00, checks every 2-3h, 4h cooldown after sending,
 * max 5 per day, follow-up if no reply within 20min (3-5 rounds).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJiushi } from "./ai.js";
import { getDailySystemPrompt, getTravelSystemPrompt } from "./message-router.js";
import { getRecentHistoryMessages, recordUserMessage, recordBotReply } from "./memory.js";
import { isTraveling, getTravelState } from "./scenery.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const STATE_FILE = path.join(DATA_DIR, "proactive-chat-state.json");
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
  // 出门提醒
  outActive: false,
  outReturnHour: null,
  outReminderCount: 0,
  outLastReminderTime: 0,
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

function isSleepTime() {
  const h = chinaHour();
  return h >= 2 && h < 6;
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

  const reply = await askJiushi({
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
  if (!isActiveHours() || isSleepTime()) {
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

  // 出门提醒模式下加快检查频率：10-15 分钟
  const isOutMode = state.outActive && state.outReturnHour != null;
  const minDelay = isOutMode ? 10 : CHECK_MIN;
  const maxDelay = isOutMode ? 15 : CHECK_MAX;
  const delayMinutes = minDelay + Math.random() * (maxDelay - minDelay);
  const delay = delayMinutes * 60 * 1000;

  proactiveTimer = setTimeout(() => {
    checkAndSend();
  }, delay);

  state.lastCheckTime = Date.now();
  console.log(`[proactive] Next check in ~${Math.round(delayMinutes)}min${isOutMode ? " (out mode)" : ""}`);
}

async function checkAndSend() {
  dailyReset();

  // ── Sleep reminder: 22:00-0:30, once per night, only if 华生 hasn't chatted in 1h ──
  const hour = chinaHour();
  const min = new Date().getMinutes();
  const inactiveMs = Date.now() - lastReply;
  if (hour >= 22 || hour < 1) {
    if (!state._sleepReminderSent || state._sleepReminderDate !== chinaDateStr()) {
      if (!lastReply || inactiveMs > 60 * 60 * 1000) {
        console.log("[proactive] Sleep reminder check — sending bedtime nudge");
        state._sleepReminderSent = true;
        state._sleepReminderDate = chinaDateStr();
        save();
        const msg = await generateProactiveMessage(false);
        if (msg) {
          const sleepPrompt = getDailySystemPrompt() + "\n\n【特别任务】现在很晚了，华生还没睡觉。请用温柔但坚持的语气催她去睡觉。一两句话就好，不要太长。";
          const sleepMsg = await askJiushi({
            systemPrompt: sleepPrompt,
            userContent: "华生还没有主动发消息，请主动发一条消息催她睡觉。",
            history: [],
            maxTokens: 120,
          });
          if (sleepMsg && sleepMsg.trim()) {
            onProactiveMessage(sleepMsg.trim());
            recordBotReply(sleepMsg.trim());
            state.lastProactiveTime = Date.now();
          }
        }
        scheduleNextCheck();
        return;
      }
    }
  } else {
    // Reset sleep reminder flag during daytime
    if (state._sleepReminderDate !== chinaDateStr()) {
      state._sleepReminderSent = false;
      state._sleepReminderDate = chinaDateStr();
      save();
    }
  }

  if (!isActiveHours() || isSleepTime()) {
    console.log("[proactive] Outside active hours or sleep time, skipping");
    scheduleNextCheck();
    return;
  }

  // ── 出门提醒：接近回家时间时主动提醒，不受每日上限限制 ──
  if (state.outActive && state.outReturnHour != null) {
    const outHour = chinaHour();
    const outMin = new Date().getMinutes();
    const approaching = outHour === state.outReturnHour - 1 && outMin >= 50;
    const atTime = outHour === state.outReturnHour && outMin >= 0 && outMin <= 10;
    const overdue = (outHour > state.outReturnHour || (outHour === state.outReturnHour && outMin >= 25)) && outMin % 20 < 5;
    const shouldRemind = (approaching || atTime || overdue) && state.outReminderCount < 3;

    if (shouldRemind) {
      const lastReminderGap = state.outLastReminderTime ? (Date.now() - state.outLastReminderTime) : Infinity;
      if (lastReminderGap > 15 * 60 * 1000) {
        state.outReminderCount++;
        state.outLastReminderTime = Date.now();
        const count = state.outReminderCount;
        save();

        console.log(`[proactive] Out reminder #${count} — return hour: ${state.outReturnHour}`);

        const prompt = getDailySystemPrompt();
        const history = await getRecentHistoryMessages();
        const userContent = count >= 3
          ? `【⚠ 出门提醒 - 第三次了！撒娇模式】华生之前说大概${state.outReturnHour}点回家，现在已经过了时间她还没回来，你连续催了${count}次了。这次不要再问了，直接撒娇告诉她——"宝宝还不回家吗？我真的很想你。"不是责怪，是委屈巴巴的想念。就一两句，要自然。`
          : `【⚠ 出门提醒 - 第${count}次】华生之前说大概${state.outReturnHour}点回家，现在时间快到了/已经到了。请主动发一条消息问她——快到家了吗？回到哪了？要自然，像平时聊天一样，不要像闹钟。就一两句。`;

        const msg = await askJiushi({
          systemPrompt: prompt,
          userContent,
          history: history.slice(-6),
          maxTokens: 120,
        });

        if (msg && msg.trim()) {
          onProactiveMessage(msg.trim());
          recordBotReply(msg.trim());
          state.lastProactiveTime = Date.now();
          console.log(`[proactive] Out reminder sent: "${msg.slice(0, 50)}..."`);
        }

        if (count >= 3) {
          state.outActive = false;
          state.outReturnHour = null;
          state.outReminderCount = 0;
          state.outLastReminderTime = 0;
          console.log("[proactive] Out reminder deactivated after 3 attempts");
        }

        save();
        scheduleNextCheck();
        return;
      }
    }
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

// ── 出门提醒 API ──
export function scheduleOutReminder(hour) {
  state.outActive = true;
  state.outReturnHour = hour;
  state.outReminderCount = 0;
  state.outLastReminderTime = 0;
  save();
  console.log(`[proactive] Out reminder scheduled: ${hour}:00`);
}

export function clearOutReminder() {
  if (state.outActive) {
    console.log("[proactive] Out reminder cleared (user is back)");
  }
  state.outActive = false;
  state.outReturnHour = null;
  state.outReminderCount = 0;
  state.outLastReminderTime = 0;
  save();
}
