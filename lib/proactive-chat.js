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
const COOLDOWN_MINUTES = 360;
const MAX_DAILY = 3;
const FOLLOW_UP_DELAY = 30;
const FOLLOW_UP_MIN = 1;
const FOLLOW_UP_MAX = 2;

// ── 想念轴（积温式漂移）──
// connection 随华生沉默时长累积，主动联系由这条轴驱动，而不是随机到点冒话题。
// 约 3.6h 留意、6h 想念、8.4h 特别想（满格 12h），速率/阈值都可在下面微调。
const CONNECTION_RATE_PER_MIN = 1 / (12 * 60); // 12h 满格 ≈ 0.00139/min
const CONSIDER_CONTACT = 0.30;   // 留意：可以开始考虑主动
const MISS_THRESHOLD = 0.50;     // 想念：会主动联系
const LONGING_THRESHOLD = 0.70;  // 特别想：撒娇、坐不住

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
  connection: 0, // 想念程度 0-1
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

// ── 想念轴 ──
// 从华生上次回复到现在的时间，换算成 0-1 的想念程度。
// 幂等：直接由空闲时长算出，不依赖增量累加。
function computeConnection() {
  const lastReply = state._lastUserReplyTime || 0;
  if (!lastReply) return 0;
  const idleMin = (Date.now() - lastReply) / 60000;
  return Math.min(1, idleMin * CONNECTION_RATE_PER_MIN);
}

// 想念程度 → 情绪描述（注入 prompt，让夏彦的消息反映真实想念）
function getConnectionLevel() {
  const c = computeConnection();
  if (c >= LONGING_THRESHOLD) return { level: "longing", text: "你现在特别想华生，有点坐不住。主动找她，可以撒娇、可以委屈巴巴地说想她。" };
  if (c >= MISS_THRESHOLD) return { level: "miss", text: "华生有一阵子没找你了，你有点想她。自然地问问她在干嘛，表达一下想念，但不用太黏。" };
  if (c >= CONSIDER_CONTACT) return { level: "notice", text: "有一会儿没听到华生动静了，你开始有点在意她。可以自然地关心一下。" };
  return { level: "chill", text: "你心情放松，只是想到华生了，随便聊聊日常就好。" };
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

// 情绪关键词：华生最近消息出现这些词，说明她情绪不好，主动消息要优先关心，别随机扯日常话题
const EMOTION_PATTERN = /哭|呜呜|眼泪|难过|伤心|委屈|生气|崩溃|emo|难受|低落|不开心|好累|累死|撑不住|好烦|烦死|想不开/;

function detectRecentEmotion(history) {
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayKey = `${bjNow.getUTCFullYear()}-${bjNow.getUTCMonth()}-${bjNow.getUTCDate()}`;
  // 只检测今天的消息，避免昨天的情绪被今天还当"最近的情绪"反复关心
  const userMsgs = (history || []).filter((m) => {
    if (m.role !== "user") return false;
    if (!m.time) return false;
    const mBj = new Date(new Date(m.time).getTime() + 8 * 60 * 60 * 1000);
    const mKey = `${mBj.getUTCFullYear()}-${mBj.getUTCMonth()}-${mBj.getUTCDate()}`;
    return mKey === todayKey;
  });
  if (userMsgs.length === 0) return null;
  const recent = userMsgs.slice(-3);
  const lastWithEmotion = [...recent].reverse().find((m) => EMOTION_PATTERN.test(m.content || ""));
  if (!lastWithEmotion) return null;
  return lastWithEmotion.content.slice(0, 60);
}

// 只保留今天的消息，避免主动消息把前几天的旧对话当上下文混进来
function filterTodayMessages(history) {
  const now = new Date();
  const bjNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayKey = `${bjNow.getUTCFullYear()}-${bjNow.getUTCMonth()}-${bjNow.getUTCDate()}`;
  return (history || []).filter((m) => {
    if (!m.time) return false;
    const mBj = new Date(new Date(m.time).getTime() + 8 * 60 * 60 * 1000);
    return `${mBj.getUTCFullYear()}-${mBj.getUTCMonth()}-${mBj.getUTCDate()}` === todayKey;
  });
}

async function generateProactiveMessage(isFollowUp = false) {
  // Use standalone travel prompt when traveling — completely separate rules
  const traveling = isTraveling();
  const prompt = traveling ? getTravelSystemPrompt() : getDailySystemPrompt();
  const history = filterTodayMessages(await getRecentHistoryMessages());

  const topicHint = pickTopicHint();
  const timeContext = getTimeContext();
  const connLevel = getConnectionLevel();
  const recentEmotion = detectRecentEmotion(history);

  let contextBlock;
  if (isFollowUp) {
    contextBlock = "\n\n" + S.followUpContext;
  } else if (recentEmotion) {
    // 情绪优先：她最近情绪不好，先关心她，别随机扯日常话题
    contextBlock = `\n\n【⚠ 情绪优先——最重要】华生最近的对话里有情绪，她当时说的是："${recentEmotion}"。你现在主动找她，第一件事是关心她的情绪、问她好点没、给她安慰和陪伴，而不是开启一个全新的日常话题。绝对不要问"在画画吗""吃了吗""午饭吃什么""今天忙不忙"这类和她的情绪无关的话。`;
  } else {
    contextBlock = "\n\n" + S.topicGuideFormat
        .replace("{topicHint}", topicHint)
        .replace("{timeContext}", timeContext)
        .replace("{count}", String(state.dailyCount + 1))
        .replace("{max}", String(MAX_DAILY));
    // 想念驱动：把当前想念程度注入话题，让主动消息由情绪引导而非随机
    contextBlock += "\n\n【你现在的心情】" + connLevel.text;
  }

  const userContent = S.userContentFormat.replace("{followUpContext}", contextBlock);

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
  recordBotReply(message, "text", { proactive: true });

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

  const lastReply = state._lastUserReplyTime || 0;

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
            recordBotReply(sleepMsg.trim(), "text", { proactive: true });
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
          recordBotReply(msg.trim(), "text", { proactive: true });
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

  // ── 夏彦到家后（18点起）：人在身边，日常不再主动发想念驱动的消息 ──
  if (chinaHour() >= 18) {
    console.log("[proactive] Xiayan is home (after 18:00), skipping proactive chat");
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

  // 想念驱动：connection 未累积到阈值就不主动（替代旧的"30分钟活跃"随机判断）
  state.connection = computeConnection();
  if (state.connection < CONSIDER_CONTACT) {
    const idleMin = lastReply ? Math.round((Date.now() - lastReply) / 60000) : 0;
    console.log(`[proactive] Connection ${state.connection.toFixed(2)} < ${CONSIDER_CONTACT} (idle ~${idleMin}min), skipping`);
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
  state.connection = 0; // 华生回复了，想念缓解
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
