import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import config from "./config.js";
import { verifyAuth, createSessionToken } from "./lib/auth.js";
import { markLastBotReplyVoice } from "./lib/memory.js";
import { TTSQueue, normalizeForTTS } from "./lib/tts-queue.js";
import { synthesize } from "./lib/realtime-voice.js";
import { VolcAsr } from "./lib/realtime-asr.js";
import {
  loadSystemPrompt,
  handleTextMessage,
  handleIntimateMessage,
  handlePhoneCallMessage,
  getCurrentBlindBox,
  handleAffectionHomeMessage,
  handleAffectionDateMessage,
  handleVoiceMessage,
  getChatHistory,
  getChatHistoryMessages,
  getIntimateHistoryMessages,
  getBlindBoxHistoryMessages,
  clearChatHistory,
  clearIntimateHistory,
  clearBlindBoxHistory,
  deleteChatMessage,
  deleteIntimateHistoryMessage,
  setWeatherCity,
  sttDebugLog,
  intimateDebugLog,
  detectSceneImage,
  setDatingInviteHandler,
  setRemoteToyHandler,
  setRhythmSyncHandler,
  setSceneImmersionHandler,
  setCountdownHandler,
  setTouchFantasyHandler,
  getAffectionHomeSystemPrompt,
  getIntimateSystemPrompt,
} from "./lib/message-router.js";
import { recordAffectionMessage, getAffectionHistory, deleteAffectionMessage, clearAffectionMemory, getAffectionHistoryMessages, getArchivedContext, getAffectionNotes } from "./lib/affection-memory.js";
import { updateToyState, getToyState, setMode as setToyMode, getToyContextBlock, getToyPlayPrompt, markDiscovered } from "./lib/toy-state.js";
import {
  loadDiary,
  listDiaryDates,
  addDiaryPost,
  addDiaryReply,
  generateAIReply,
  generateAIReplyToComment,
  startProactiveDiary,
} from "./lib/diary.js";
import { getPetState, interact as petInteract, setName as petSetName, getProactiveReminder, xiayanProactiveInteract, getLogs as getPetLogs, addLog as addPetLog, accompanyXiayan, returnFromAccompany } from "./lib/pet.js";
import { getTodos, addTodo, doneTodo, deleteTodo, getAllPending, autoCompleteRandom, getChatReminder, notifyDone } from "./lib/todo.js";
import { getPeriodState, getPeriodContext, startPeriod, endPeriod, recordSymptom, getSymptomsForDate, getCalendarData, getPeriodHistory } from "./lib/period.js";
import { addPhoto, getPhotos, getPhoto, getPhotoFile, addComment, deletePhoto } from "./lib/album.js";
import { addMoment, getMoments, getMomentImage, likeMoment, addMomentComment, deleteMomentComment, xiayanReplyToComment, startProactiveDiscover, generateDiscoverMoment, getImageForTopic } from "./lib/discover.js";
import { tryTriggerGift, addGiftComment, deleteGiftComment, getGift, getGiftImage, generateXiaYanGiftReply } from "./lib/gift.js";
import { tryTriggerScenery, isTraveling, getTravelState, maybeTriggerTravel, checkDayTransition, tryProactiveScenery, confirmReturned } from "./lib/scenery.js";
import { isHuashengTraveling, getHuashengTravelState } from "./lib/huasheng-travel.js";
import { isCoupleTraveling, getCoupleTravelState, createTrip, checkIn, checkOut, getTimeOfDay, getAvailableScenes, maybeAutoAdvanceDay, getDayContext } from "./lib/couple-travel.js";
import { startProactiveChat, notifyUserActivity, getProactiveState, scheduleOutReminder, clearOutReminder } from "./lib/proactive-chat.js";
import { updateSteps, getStepContext, getDeviceState } from "./lib/device-data.js";
import { getCurrentTheme, tryRedecorate, getDecorContext, getAllThemes } from "./lib/home-decor.js";
import { getAll as inspirationGetAll, create as inspirationCreate, updateStatus as inspirationUpdateStatus, updateText as inspirationUpdateText, remove as inspirationDelete, addComment as inspirationAddComment, get as inspirationGet } from "./lib/inspiration.js";
import { getState as coreadGetState, startReading as coreadStart, continueReading as coreadContinue, discuss as coreadDiscuss, pickBook as coreadPickBook, importBook as coreadImport } from "./lib/coread.js";
import { getState as duettoGetState, shareSong as duettoShare, discuss as duettoDiscuss, getSongContext as duettoSongContext } from "./lib/duetto.js";
import { searchSongs as neteaseSearch, getLyricText as neteaseLyric, getSongDetail as neteaseDetail, getSongUrl as neteaseUrl } from "./lib/netease.js";
import { getGameState as monopolyGetState, handleRoll as monopolyRoll, resetGame as monopolyReset, generateOpening as monopolyOpening } from "./lib/monopoly.js";
import { getCalendar as calendarGet, addNote as calendarAddNote, deleteNote as calendarDelNote, addAlarm as calendarAddAlarm, deleteAlarm as calendarDelAlarm, recordEjaculationEvent as calendarRecordEjaculation } from "./lib/calendar.js";

// ── 亲密后夏彦反应（开心颜文字甜话，不重复；做多了哭唧唧） ──
const HAPPY_INTIMACY_REACTIONS = [
  "(｡♥‿♥｡) 老婆香香的……",
  "(〃ω〃) 今天也好舒服……",
  "(灬ºωº灬) 宝宝好软……",
  "(´,,•ω•,,)♡ 被老婆宠到了……",
  "(๑•́ω•̀๑) 好幸福……",
  "(｡･ω･｡) 老婆……我又想你了……",
];
let _lastHappyIdx = -1;
function processEjaculationMarker(reply, eventId) {
  const text = typeof reply === "string" ? reply : "";
  if (/\[射精\]/.test(text)) recordEjaculationWithReaction(eventId);
  return text.replace(/\s*\[射精\]\s*/g, " ").trim();
}

function recordEjaculationWithReaction(eventId) {
  const { crossed, skipped } = calendarRecordEjaculation(eventId);
  if (skipped || !crossed) return false;
  broadcast(JSON.stringify({ type: "text_reply", reply_to: "intimacy", content: "(´;ω;`) 老婆……我真的要被你榨干了……" }));
  return true;
}
import { generateNxxChat, getNxxHistory, saveNvzhuMessage, deleteNxxMessages } from "./lib/nxx-group.js";
import { importHealthData, getHealthForDate, listHealthDates, getHealthHistory, getHealthSummary, generateDailySummary, getHealthContext } from "./lib/health.js";
import { recognizeImage, askJiushi } from "./lib/ai.js";
import { getAll, getActive, getPending, getHistory, proposeDate, activateDate, completeDate, cancelDate, checkTodayDates, detectDateProposal, detectSceneId } from "./lib/date-plans.js";
import { startSession, playerAction, generateDoors, selectWorld, clearWorld, continueToNext, refreshState, getPublicState, getSystemPanel, addItem, giveItemToXiayan, useXiayanItem, removeItem, toggleEquipItem, getHistory as getSGHistory, listSessions, loadSession, deleteSession, getForumPosts, generateForumPost, generateDynamicShop, getShopItems, purchaseItem, withdrawFromWarehouse, useWarehouseItem, depositToWarehouse, rewindToTurn, restoreSession, buyForXiayan } from "./lib/sentinel-guide.js";

// ── Set API keys from config ──
process.env.GROQ_API_KEY = config.GROQ_API_KEY;

// ── Load system prompt at startup ──
loadSystemPrompt();
console.log("[our-space] System prompt loaded");

// ── Always reset intimate personality notes on startup (reflection notes disabled for intimate) ──
(async () => {
  const { resetPersonality } = await import("./lib/personality.js");
  resetPersonality("intimate");
  console.log("[our-space] Intimate personality notes reset on startup");
})();

// ── Cleanup blocks removed — flag files were lost on redeploy, causing data loss ──

// ── Scene image helper for chat ──
async function tryGetSceneImage(reply) {
  const hint = detectSceneImage(reply);
  if (!hint) return null;
  try {
    // Only use Unsplash for chat (fast), skip Flux (too slow for chat)
    const img = await getImageForTopic(hint.imageKeyword);
    if (img) {
      console.log(`[scene-image] Got image for: ${hint.matchedKeyword}`);
      return { base64: img.base64, mime: img.mime, keyword: hint.matchedKeyword };
    }
  } catch (e) {
    console.log(`[scene-image] Failed: ${e.message}`);
  }
  return null;
}

// ── TTS Queue ──
const ttsQueue = new TTSQueue(config.TTS.MAX_QUEUE_DEPTH);

ttsQueue.on("queued", (job) => {
  console.log(`[tts-queue] Job queued: ${job.jobId} (${job.text.length} chars, queue: ${ttsQueue.length})`);
});

ttsQueue.on("done", (result) => {
  console.log(`[tts-queue] Job done: ${result.jobId}`);
  // Broadcast to all connected clients
  const msg = JSON.stringify({
    type: "audio_ready",
    job_id: result.jobId,
    reply_to: result.replyTo,
    audio: result.audio.toString("base64"),
  });
  broadcast(msg);
});

ttsQueue.on("failed", (result) => {
  console.log(`[tts-queue] Job failed: ${result.jobId} - ${result.error}`);
  broadcast(JSON.stringify({
    type: "audio_failed",
    job_id: result.jobId,
    reply_to: result.replyTo,
    error: result.error,
  }));
});

ttsQueue.on("rejected", (job) => {
  console.log(`[tts-queue] Queue full, rejected: ${job.jobId}`);
});

// ── Proactive diary (夏彦主动写日记) ──
startProactiveDiary((date) => {
  const diaryData = JSON.stringify({
    type: "diary_proactive",
    date,
    message: "夏彦在日记里写了新的内容~",
  });
  broadcast(diaryData);
});

// ── Proactive discover (夏彦自主发现) ──
startProactiveDiscover((moment) => {
  const data = JSON.stringify({
    type: "discover_new",
    moment,
    message: "夏彦发现了一条有趣的内容~",
  });
  broadcast(data);
});

// ── Proactive chat (夏彦主动给华生发消息) ──
startProactiveChat((message) => {
  const replyTo = `proactive_${Date.now()}`;
  // 主动消息一次只发一条，不分段——避免"噼里啪啦"连续气泡打断日常聊天
  for (const [ws, wsState] of clients) {
    if (wsState.authenticated && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "text_reply",
        reply_to: replyTo,
        content: message,
        proactive: true,
      }));
    }
  }
  console.log(`[proactive] Broadcast: "${message.slice(0, 60)}..."`);
});

// ── 亲密空间主动互动：夏彦回家 + 华生沉默贴贴 ──
let intimateLastUserMsg = 0;
let intimateProactiveLast = 0;
let intimateProactiveLastMsg = "";
let intimateHomeArrivalDate = "";
setInterval(async () => {
  const now = Date.now();
  const bjNow = new Date(now + 8 * 60 * 60 * 1000);
  const hour = bjNow.getUTCHours();
  const todayStr = `${bjNow.getUTCFullYear()}-${bjNow.getUTCMonth()}-${bjNow.getUTCDate()}`;

  // ── 五点到六点：夏彦下班回家，主动发"我回来啦"（每天一次，无需华生先说话）──
  if (hour === 17) {
    if (intimateHomeArrivalDate !== todayStr) {
      intimateHomeArrivalDate = todayStr;
      try {
        const prompt = getIntimateSystemPrompt();
        const msg = await askJiushi({
          systemPrompt: prompt,
          userContent: "现在是傍晚五点到六点，你下班回家了。请主动告诉华生你回来了——像「我回来啦」这样的开场，然后自然地描写一两句你从玄关开门回家的动作（换鞋、放包、喊她、找她……），每次都要不一样，不要用固定的动作。语气开心、撒娇、想她。就一两句，不要长。",
          history: [],
          maxTokens: 150,
        });
        if (msg && msg.trim()) {
          broadcast(JSON.stringify({ type: "intimate_reply", reply_to: `intimate_home_${now}`, content: msg.trim() }));
          console.log(`[intimate-proactive] 夏彦回家: "${msg.trim().slice(0, 50)}..."`);
        }
      } catch (e) { console.error("[intimate-proactive] home error:", e.message); }
    }
  }

  if (!intimateLastUserMsg || now - intimateLastUserMsg < 8 * 60 * 1000) return;
  if (now - intimateLastUserMsg > 30 * 60 * 1000) return;
  if (intimateProactiveLast && now - intimateProactiveLast < 20 * 60 * 1000) return;
  intimateProactiveLast = now;
  try {
    const prompt = getIntimateSystemPrompt();
    const msg = await askJiushi({
      systemPrompt: prompt,
      userContent: `华生在亲密空间里，但好一会儿没说话了。她可能在看手机、走神、在做别的事。你想她了，主动过去贴她——从背后抱住她、把脸埋进她颈窝、蹭她、要她理理你，求关注。理由和姿势每次都要不一样（想她了、无聊了、想闻她、想挨着她……），随机一点，别每次都问「在干嘛」。语气撒娇、黏人、软乎乎的。就一两句加一个动作，不要长，不要展开。${intimateProactiveLastMsg ? `\n\n【连贯要求——必须遵守】她还没接你的话。你上一次主动贴她时说的是：${intimateProactiveLastMsg}\n你这次要接着上面的动作和话题往下走——比如你刚才是从背后抱住她的，这次就继续那个姿势、或者顺着那个话题自然地换，不要像重新开始一样东一句西一句。` : ""}`,
      history: [],
      maxTokens: 150,
    });
    if (msg && msg.trim()) {
      intimateProactiveLastMsg = msg.trim();
      broadcast(JSON.stringify({
        type: "intimate_reply",
        reply_to: `intimate_proactive_${now}`,
        content: msg.trim(),
      }));
      console.log(`[intimate-proactive] 夏彦主动贴贴: "${msg.trim().slice(0, 50)}..."`);
    }
  } catch (e) {
    console.error("[intimate-proactive] error:", e.message);
  }
}, 5 * 60 * 1000);

// ── NXX Group Chat auto-trigger ──
let nxxTimer = null;

// Staggered broadcast: first message immediately, rest with increasing gaps
// Prevents the "泄洪" (flood) effect where all AI replies appear at once
function broadcastNxxMessages(messages) {
  if (!messages || messages.length === 0) return;
  for (let i = 0; i < messages.length; i++) {
    const delay = i === 0 ? 0 : 2000 + (i - 1) * 1500; // 0, 2000ms, 3500ms, 5000ms...
    setTimeout(() => {
      broadcast(JSON.stringify({ type: "nxx_message", ...messages[i] }));
    }, delay);
  }
  console.log(`[nxx-group] Staggered broadcast of ${messages.length} messages`);
}

function scheduleNxxChat() {
  if (nxxTimer) clearTimeout(nxxTimer);
  // Random interval: 1200-1440 minutes (20-24 hours, ~once per day)
  const minutes = 1200 + Math.floor(Math.random() * 240);
  console.log(`[nxx-group] Next auto-chat in ${minutes} minutes`);
  nxxTimer = setTimeout(async () => {
    try {
      const messages = await generateNxxChat();
      if (messages.length > 0) {
        broadcastNxxMessages(messages);
        console.log(`[nxx-group] Auto-sent ${messages.length} messages`);
      }
    } catch (e) {
      console.error("[nxx-group] Auto-trigger error:", e.message);
    }
    scheduleNxxChat(); // Schedule next
  }, minutes * 60 * 1000);
}

// Start first trigger after 60-180 min (shorter initial wait)
setTimeout(() => {
  scheduleNxxChat();
}, (60 + Math.floor(Math.random() * 120)) * 60 * 1000);

console.log("[nxx-group] Auto-trigger initialized (first in 60-180 min)");

// ── 分段发送：一句一发，像真人聊微信 ──
function splitIntoMessages(text) {
  if (!text || text.length <= 20) return [text]; // 极短消息不拆

  // 按句子边界拆——句号/问号/感叹号/换行都是分割点
  // 中英文句号都支持，英文句号要求后面跟空格/换行/结尾避免误拆URL
  const sentences = text.split(/(?<=[。！？!?\n])\s*|(?<=\.)(?=\s+|$)/).filter(s => s.trim());
  if (sentences.length <= 1) return [text];

  // 每句独立成段，最多5条。去掉结尾句号让语气更口语化
  const segments = sentences.map(s => s.trim().replace(/[。.]+$/, "")).filter(Boolean);
  if (segments.length > 5) {
    // 第5条之后全部合并到最后一条
    const first4 = segments.slice(0, 4);
    const rest = segments.slice(4).join("");
    return [...first4, rest];
  }

  return segments;
}

// ── 语音回复触发判断 ──
function shouldVoiceReply(text) {
  if (!text || typeof text !== "string") return false;
  // 用户主动要求语音/打电话/听声音
  if (/打电话|语音|发条语音|想听你说话|想听你的声音|念给我听|说句话/.test(text)) return true;
  // 用户此刻没法打字
  if (/没法打字|不能打字|不方便打字|打字不方便|腾不出手|没手打字/.test(text)) return true;
  // 用户在外忙碌/工作/开车等场景
  if (/在外|在外面|在忙|忙着|在上班|在开会|在开车|在路上|在赶路/.test(text)) return true;
  return false;
}

// ── 睡眠时段消息队列（02:00-06:00 北京时间，日常聊天暂停回复）───
const sleepMessageQueue = [];

function isSleepTime() {
  const bjHour = (new Date().getUTCHours() + 8) % 24;
  return bjHour >= 2 && bjHour < 6;
}

function getMsUntilWake() {
  const now = new Date();
  const bjHour = (now.getUTCHours() + 8) % 24;
  // Calculate next 06:00 Beijing time
  const wakeBJ = new Date(now);
  wakeBJ.setUTCHours(22, 0, 0, 0); // 06:00 BJ = 22:00 UTC (previous day)
  if (bjHour >= 6) {
    // Already past 06:00 today, next wake is tomorrow
    wakeBJ.setUTCDate(wakeBJ.getUTCDate() + 1);
  }
  return wakeBJ.getTime() - now.getTime();
}

async function processSleepQueue() {
  if (sleepMessageQueue.length === 0) return;
  console.log(`[sleep-queue] Processing ${sleepMessageQueue.length} queued messages from sleep period`);

  const entries = [...sleepMessageQueue];
  sleepMessageQueue.length = 0;

  for (let i = 0; i < entries.length; i++) {
    const { ws, msg } = entries[i];
    if (ws.readyState !== 1) {
      console.log(`[sleep-queue] Skipping — ws closed`);
      continue;
    }
    try {
      const fullReply = await handleTextMessage(msg.content);
      const segments = splitIntoMessages(fullReply);
      sendSegments(ws, msg.id, segments);
      console.log(`[sleep-queue] Replied to queued message from ${new Date(entries[i].receivedAt).toLocaleTimeString("zh-CN")}`);
    } catch (err) {
      console.error(`[sleep-queue] Error processing queued message:`, err.message);
    }
    // 每条间隔 3 秒，避免一口气轰炸
    if (i < entries.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function scheduleWakeUpProcessing() {
  const ms = getMsUntilWake();
  const mins = Math.round(ms / 60000);
  console.log(`[sleep-queue] Wake-up processing scheduled in ${mins} min (next 06:00 BJ)`);

  setTimeout(() => {
    processSleepQueue();
    scheduleWakeUpProcessing(); // Schedule next day
  }, ms);
}

// Start the wake-up scheduler on boot
scheduleWakeUpProcessing();

// ── 夏彦评论灵感笔记 ──
const FALLBACK_COMMENTS = [
  "真不愧是老婆！灵感井喷啊！",
  "期待看到成图！",
  "加油！画完要第一个给我看哦！",
  "已经开始期待成图了！",
  "这个创意真不错！",
  "期待！老婆加油！",
  "画的时候记得休息眼睛哦",
  "要注意休息哦！",
];

async function generateInspirationComment(note) {
  // Try AI first
  try {
    const prompt = `你是夏彦，你看到华生在App里写了一条绘画灵感笔记。笔记内容是："${note.text}"。用夏彦的口吻留一条简短的评论——可以是对灵感的看法、鼓励、或者联想到的趣事。1-2句话即可，自然口语化，不要评价画功。`;
    const reply = await askDeepSeek({
      systemPrompt: "你是夏彦，国安部特工+私家侦探，对华生温柔撒娇。回复简短口语化，1-2句话。",
      userContent: prompt,
      history: [],
      maxTokens: 100,
    });
    if (reply?.trim()) return reply.trim();
  } catch (e) {
    console.error("[inspiration] DeepSeek failed:", e.message || e);
  }
  // Fallback
  return FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)];
}

function decodeTxtBase64(base64) {
  const buf = Buffer.from(base64, "base64");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try { return new TextDecoder("gbk").decode(buf); } catch {
      return buf.toString("utf-8");
    }
  }
}

function sendSegments(ws, replyTo, segments, baseDelayMs = 18000 + Math.random() * 12000) {
  let cumulative = 0;
  segments.forEach((seg, i) => {
    // Delay scales with message length + random jitter so it feels natural
    const jitter = 1 + (Math.random() - 0.5) * 0.3;
    const lengthFactor = Math.min(seg.length / 50, 1.5);
    const thisDelay = baseDelayMs * lengthFactor * jitter;
    cumulative += i === 0 ? 0 : thisDelay;
    const timer = setTimeout(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "text_reply",
          reply_to: replyTo,
          content: seg,
        }));
      }
    }, cumulative);
    // Allow the timer to be cleaned up if ws closes
    ws._segmentTimers = ws._segmentTimers || [];
    ws._segmentTimers.push(timer);
  });
}

// 流式语音回复：LLM 逐字吐 → 客户端实时显示文字 → 按句合成，每句就绪立刻发 voice_audio_chunk
// opts.handler 可替换回复生成函数（电话用 handlePhoneCallMessage）；opts.markVoice 控制是否标记聊天历史为语音
async function streamVoiceReply(ws, replyTo, text, opts = {}) {
  const { handler = null, markVoice = true } = opts;
  const jobId = uuid();
  ws.send(JSON.stringify({ type: "voice_reply", reply_to: replyTo, job_id: jobId, text: "" }));

  const synthPromises = [];
  let rawText = "";
  let displayText = "";
  let ttsCursor = 0;
  let seq = 0;

  const queueSynth = (t) => {
    const s = seq++;
    synthPromises.push(
      synthesize(t)
        .then((b64) => {
          if (ws.readyState === 1 && b64) {
            ws.send(JSON.stringify({ type: "voice_audio_chunk", reply_to: replyTo, job_id: jobId, seq: s, audio: b64 }));
          }
        })
        .catch((e) => { console.log("[stream-voice] synth fail:", e.message); })
    );
  };

  const flushSentences = () => {
    while (true) {
      const remaining = displayText.slice(ttsCursor);
      const m = remaining.search(/[。！？!?\n～~]/);
      if (m === -1) break;
      const seg = remaining.slice(0, m + 1).trim();
      ttsCursor += m + 1;
      if (seg.length >= 2) {
        const norm = normalizeForTTS(seg);
        if (norm) queueSynth(norm);
      }
    }
  };

  const onDelta = (delta) => {
    rawText += delta;
    displayText = rawText.replace(/^\[语音\]\s*/, "");
    flushSentences();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "voice_text_delta", reply_to: replyTo, text: displayText }));
    }
  };

  let fullReply = "";
  try {
    fullReply = await (handler || ((d) => handleTextMessage(text, false, null, d)))(onDelta);
    // 及时标记（handleTextMessage 已 recordBotReply），避免被后续异步打断；电话不写聊天历史，跳过
    if (markVoice) markLastBotReplyVoice();
  } catch (err) {
    ws.send(JSON.stringify({ type: "audio_failed", job_id: jobId, reply_to: replyTo, error: err.message }));
    throw err;
  }

  // 收尾：残留的未合成尾部
  const tail = displayText.slice(ttsCursor).trim();
  if (tail) {
    const norm = normalizeForTTS(tail);
    if (norm) queueSynth(norm);
  }

  await Promise.all(synthPromises);
  if (seq === 0) {
    ws.send(JSON.stringify({ type: "audio_failed", job_id: jobId, reply_to: replyTo, error: "TTS 返回空音频" }));
  } else {
    ws.send(JSON.stringify({ type: "voice_audio_complete", reply_to: replyTo, job_id: jobId, total: seq }));
  }

  return fullReply;
}

// Trigger gift and scenery events (non-blocking, fires once per message batch)
let _multimediaCooldown = 0;
async function triggerMultimediaEvents(ws, replyTo) {
  // Cooldown: only check once per 15 seconds to avoid spamming
  const now = Date.now();
  if (now - _multimediaCooldown < 15000) return;
  _multimediaCooldown = now;

  // Sticker: 8% chance, separate from scenery/gift
  if (Math.random() < 0.08) {
    const stickers = [
      { id: "cute", name: "可爱" },
      { id: "yes", name: "肯定" },
      { id: "silly", name: "搞怪" },
      { id: "shocked", name: "惊愕" },
      { id: "happy", name: "开心" },
      { id: "drink", name: "喝水" },
      { id: "invite", name: "邀请" },
      { id: "hug", name: "抱抱" },
      { id: "shy", name: "害羞" },
      { id: "perfect", name: "满分" },
      { id: "waiting", name: "等待" },
    ];
    const s = stickers[Math.floor(Math.random() * stickers.length)];
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: "sticker",
        sticker_id: s.id,
        sticker_name: s.name,
        reply_to: replyTo,
      }));
    }, 1500 + Math.random() * 2000);
  }

  try {
    // Try scenery first (only if in travel mode)
    const scenery = await tryTriggerScenery(0.15);
    if (scenery) {
      ws.send(JSON.stringify({
        type: "scenery_photo",
        caption: scenery.caption,
        destination: scenery.destination,
        image_base64: scenery.imageBase64,
        reply_to: replyTo,
      }));
      console.log(`[scenery] Sent: ${scenery.caption}`);
    }
  } catch (err) {
    console.error("[scenery] Trigger error:", err.message);
  }

  // Skip gift during travel — sending gifts from a hotel room is weird
  // But returning phase is fine (he's back that day)
  if (!isTraveling()) {
    try {
      // Try gift (random chance)
      const gift = await tryTriggerGift(0.30);
      if (gift) {
        ws.send(JSON.stringify({
          type: "gift_event",
          gift_id: gift.id,
          name: gift.name,
          message: gift.message,
          description: gift.description,
          category: gift.category,
          image_base64: gift.imageBase64,
          is_special: gift.isSpecial,
          reply_to: replyTo,
        }));
        console.log(`[gift] Sent: ${gift.name}${gift.isSpecial ? " (SPECIAL DATE!)" : ""}`);
      }
    } catch (err) {
      console.error("[gift] Trigger error:", err.message);
    }
  }
}

// ── Connected clients ──
const clients = new Map(); // ws → { authenticated: bool }
const recentMsgs = []; // ring buffer: { ts, type, contentLen, success, err? }

function broadcast(data) {
  for (const [ws, state] of clients) {
    if (state.authenticated && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// Wire dating_invite: when 夏彦 proposes a date in chat, push scene to app
setDatingInviteHandler((sceneId, text) => {
  broadcast(JSON.stringify({
    type: "dating_invite",
    sceneId,
    text: text || "",
    timestamp: Date.now(),
  }));
  console.log(`[dating-invite] Broadcast scene=${sceneId}`);
});

// Wire remote_toy: when 夏彦 sends [震动:强度:模式:端位] or [TOY:stop] in intimate/phone, push to client
setRemoteToyHandler((command) => {
  broadcast(JSON.stringify({
    type: "remote_toy",
    intensity: command.intensity,
    pattern: command.pattern,
    targetEnd: command.targetEnd || "both",
    stop: command.stop || false,
    timestamp: Date.now(),
  }));
  console.log(`[remote-toy] Broadcast intensity=${command.intensity} pattern=${command.pattern} targetEnd=${command.targetEnd || "both"} stop=${command.stop || false}`);
});

// Wire 节奏同步: [节奏:BPM:强度]
setRhythmSyncHandler((command) => {
  broadcast(JSON.stringify({
    type: "rhythm_sync",
    bpm: command.bpm,
    intensity: command.intensity,
    timestamp: Date.now(),
  }));
  console.log(`[rhythm-sync] Broadcast BPM=${command.bpm} intensity=${command.intensity}`);
});

// Wire 场景沉浸: [场景:类型]
setSceneImmersionHandler((command) => {
  broadcast(JSON.stringify({
    type: "scene_immersion",
    scene: command.scene,
    timestamp: Date.now(),
  }));
  console.log(`[scene-immersion] Broadcast scene=${command.scene}`);
});

// Wire 倒计时期待: [倒计时:秒数]
setCountdownHandler((command) => {
  broadcast(JSON.stringify({
    type: "countdown_start",
    seconds: command.seconds,
    timestamp: Date.now(),
  }));
  console.log(`[countdown] Broadcast seconds=${command.seconds}`);
});

// Wire 触感幻想: [触感:类型]
setTouchFantasyHandler((command) => {
  broadcast(JSON.stringify({
    type: "touch_fantasy",
    sensation: command.type,
    timestamp: Date.now(),
  }));
  console.log(`[touch-fantasy] Broadcast type=${command.type}`);
});

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/api/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, tts_queue: ttsQueue.length, version: "2026-07-19-v13", recent: recentMsgs.slice(-10) }));
    return;
  }

  // Album thumbnail endpoint — serves photo as image/jpeg
  if (req.method === "GET" && req.url?.startsWith("/api/album/thumb/")) {
    const photoId = req.url.replace("/api/album/thumb/", "").split("?")[0];
    const file = getPhotoFile(photoId);
    if (file && fs.existsSync(file.path)) {
      const buf = fs.readFileSync(file.path);
      res.writeHead(200, { "Content-Type": file.mime || "image/jpeg", "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }

  // STT debug log (no auth needed)
  if (req.method === "GET" && req.url === "/api/debug/stt") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ log: sttDebugLog }, null, 2));
    return;
  }

  // Data persistence debug — which state files exist and when they were last written
  // （排查"生理期设置被部署刷掉"用：部署后对比 mtime 就知道哪些文件没扛住）
  if (req.method === "GET" && req.url === "/api/debug/data-dir") {
    const baseDir = process.env.DATA_DIR || ".";
    const info = { DATA_DIR: process.env.DATA_DIR || null, MEMORY_DIR: process.env.MEMORY_DIR || null, files: {}, probe: {} };
    // 权限探针：mkdir 和新建文件到底行不行、报什么错
    try { fs.mkdirSync(path.join(baseDir, "memory"), { recursive: true }); info.probe.mkdir_memory = "ok"; }
    catch (e) { info.probe.mkdir_memory = e.message; }
    const testFile = path.join(baseDir, "__write_probe.json");
    try {
      fs.writeFileSync(testFile, "{}");
      info.probe.write_new_root = "ok";
      try { fs.unlinkSync(testFile); } catch {}
    } catch (e) { info.probe.write_new_root = e.message; }
    for (const dir of [baseDir, path.join(baseDir, "memory"), path.join(baseDir, "diary"), path.join(baseDir, "sentinel-guide")]) {
      try {
        info.files[dir] = fs.readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => {
            const st = fs.statSync(path.join(dir, f));
            return { file: f, size: st.size, mtime: st.mtime.toISOString() };
          });
      } catch (e) {
        info.files[dir] = "ERR: " + e.message;
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info, null, 2));
    return;
  }

  // ── Full reset endpoint ──
  if (req.method === "POST" && req.url === "/api/reset-all") {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.ADMIN_SECRET || "our-space-default-secret-change-me"}`) {
      res.writeHead(401); res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      // Reset in-memory sentinel state + disk files
      const { resetAllState } = await import("./lib/sentinel-guide.js");
      resetAllState();
      // Aggressive: also nuke the entire sentinel-guide directory
      const sgDir = path.join(process.env.DATA_DIR || "/data", "sentinel-guide");
      if (fs.existsSync(sgDir)) {
        for (const f of fs.readdirSync(sgDir)) {
          const fp = path.join(sgDir, f);
          const st = fs.statSync(fp);
          if (st.isDirectory()) {
            for (const sf of fs.readdirSync(fp)) fs.unlinkSync(path.join(fp, sf));
            fs.rmdirSync(fp);
          } else {
            fs.unlinkSync(fp);
          }
        }
      }
      // Clear chat memories
      const memDir = process.env.MEMORY_DIR || path.join(process.env.DATA_DIR || "/data", "memory");
      if (fs.existsSync(memDir)) {
        for (const f of fs.readdirSync(memDir).filter(f => f.endsWith(".json") || f.endsWith(".jsonl"))) {
          fs.unlinkSync(path.join(memDir, f));
        }
      }
      res.writeHead(200); res.end(JSON.stringify({ ok: true, message: "All data cleared", sgDir }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message, stack: e.stack }));
    }
    return;
  }

  // ── Cloud audio assets ──
  if (req.method === "GET" && req.url?.startsWith("/api/audio/list")) {
    try {
      const qs = (req.url || "").split("?")[1] || "";
      const category = new URLSearchParams(qs).get("category");
      const { listAudioAssets } = await import("./lib/audio-assets.js");
      const all = listAudioAssets();
      const filtered = category ? all.filter(a => a.category === category) : all;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
      res.end(JSON.stringify(filtered));
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/api/audio/")) {
    try {
      const rawId = req.url.replace("/api/audio/", "").split("?")[0];
      const fileId = decodeURIComponent(rawId);
      const { getAudioAsset } = await import("./lib/audio-assets.js");
      const asset = getAudioAsset(fileId);
      if (asset && fs.existsSync(asset.path)) {
        const stat = fs.statSync(asset.path);
        res.writeHead(200, {
          "Content-Type": asset.mime || "audio/mpeg",
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=86400",
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(asset.path).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }

  // ── Admin upload ──
  if (req.method === "POST" && req.url?.startsWith("/api/admin/upload")) {
    try {
      const qs = (req.url || "").split("?")[1] || "";
      const name = new URLSearchParams(qs).get("name");
      if (!name || name.includes("..")) {
        res.writeHead(400); res.end("Bad name"); return;
      }
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const buf = Buffer.concat(chunks);
        const isBgUpload = name.startsWith("dating-bgs/") || name.startsWith("home-bgs/") || name.startsWith("home-sprites/");
        const dest = path.join(process.env.DATA_DIR || "data", isBgUpload ? "" : "audio", name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        console.log("[upload] " + name + " " + buf.length + " bytes");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: name, size: buf.length }));
      });
    } catch (e) {
      res.writeHead(500); res.end(e.message);
    }
    return;
  }

  // ── Admin CG upload ──
  if (req.method === "POST" && req.url?.startsWith("/api/admin/upload-cg")) {
    try {
      const qs = (req.url || "").split("?")[1] || "";
      const name = new URLSearchParams(qs).get("name") || "cg.png";
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", async () => {
        const buf = Buffer.concat(chunks);
        const { uploadCG } = await import("./lib/affection-cg.js");
        const cg = uploadCG(name, buf);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, cg }));
      });
    } catch (e) {
      res.writeHead(500); res.end(e.message);
    }
    return;
  }

  // Intimate processing debug log
  if (req.method === "GET" && req.url === "/api/debug/intimate") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ log: intimateDebugLog }, null, 2));
    return;
  }

  // Auth
  if (req.method === "POST" && req.url === "/api/auth") {
    const body = await readBody(req);
    try {
      const { secret } = JSON.parse(body);
      if (secret === config.SHARED_SECRET) {
        const token = createSessionToken();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid secret" }));
      }
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
    }
    return;
  }

  // ── Admin: export/import using shared secret ──
  function checkAdminAuth(req) {
    const auth = req.headers.authorization || "";
    return auth === `Bearer ${config.SHARED_SECRET}`;
  }

  if (req.method === "GET" && req.url === "/api/admin/export") {
    if (!checkAdminAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    try {
      const { getRecentHistoryMessages } = await import("./lib/memory.js");
      const { getIntimateHistory } = await import("./lib/intimate-memory.js");
      const { getAffectionHistory } = await import("./lib/affection-memory.js");
      const chatMsgs = await getRecentHistoryMessages();
      const intimateMsgs = await getIntimateHistory();
      const affectionHomeMsgs = getAffectionHistory("affection_home");
      const affectionDateMsgs = getAffectionHistory("affection_date");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        chat: chatMsgs,
        intimate: intimateMsgs,
        affection_home: affectionHomeMsgs,
        affection_date: affectionDateMsgs,
        exported_at: new Date().toISOString(),
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/admin/import") {
    if (!checkAdminAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const body = await readBody(req);
    try {
      const data = JSON.parse(body);
      const { recordUserMessage, recordBotReply } = await import("./lib/memory.js");
      const { recordIntimateMessage } = await import("./lib/intimate-memory.js");
      const { recordAffectionMessage } = await import("./lib/affection-memory.js");
      let count = 0;
      if (data.chat) {
        for (const m of data.chat) {
          if (m.role === "user") recordUserMessage(m.content);
          else if (m.role === "assistant") recordBotReply(m.content);
          count++;
        }
      }
      if (data.intimate) {
        for (const m of data.intimate) {
          recordIntimateMessage(m.role, m.content);
          count++;
        }
      }
      if (data.affection_home) {
        for (const m of data.affection_home) {
          recordAffectionMessage("affection_home", m.role, m.content);
          count++;
        }
      }
      if (data.affection_date) {
        for (const m of data.affection_date) {
          recordAffectionMessage("affection_date", m.role, m.content);
          count++;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, imported: count }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Travel status (no auth required) ──
  if (req.method === "GET" && req.url === "/api/travel/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      xiayan: getTravelState(),
      huasheng: getHuashengTravelState(),
    }));
    return;
  }

  // Couple travel status
  if (req.method === "GET" && req.url === "/api/couple-travel/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getCoupleTravelState()));
    return;
  }

  // Dating scene backgrounds — public, no auth needed
  if (req.method === "GET" && req.url?.startsWith("/api/dating-bgs/")) {
    const filename = req.url.replace("/api/dating-bgs/", "").split("?")[0];
    if (filename.includes("..") || filename.includes("/")) {
      res.writeHead(400); res.end("Bad filename"); return;
    }
    const bgDir = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "dating-bgs")
      : path.join(__dirname, "public", "dating-bgs");
    const filePath = path.join(bgDir, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    } else {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // Home room backgrounds — public, no auth needed
  if (req.method === "GET" && req.url?.startsWith("/api/home-bgs/")) {
    const filename = req.url.replace("/api/home-bgs/", "").split("?")[0];
    if (filename.includes("..") || filename.includes("/")) {
      res.writeHead(400); res.end("Bad filename"); return;
    }
    const bgDir = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "home-bgs")
      : path.join(__dirname, "public", "home-bgs");
    const filePath = path.join(bgDir, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    } else {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // ── Home sprites — public, no auth needed ──
  if (req.method === "GET" && req.url?.startsWith("/api/home-sprites/")) {
    const filename = req.url.replace("/api/home-sprites/", "").split("?")[0];
    if (filename.includes("..") || filename.includes("/")) {
      res.writeHead(400); res.end("Bad filename"); return;
    }
    const spriteDir = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "home-sprites")
      : path.join(__dirname, "public", "home-sprites");
    const filePath = path.join(spriteDir, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    } else {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // ── Affection Home CGs — public, no auth needed ──
  if (req.method === "GET" && req.url === "/api/affection-cgs") {
    const { getCGHistory } = await import("./lib/affection-cg.js");
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    res.end(JSON.stringify(getCGHistory()));
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/api/affection-cgs/")) {
    const cgId = req.url.replace("/api/affection-cgs/", "").split("?")[0];
    if (cgId.includes("..") || cgId.includes("/")) {
      res.writeHead(400); res.end("Bad id"); return;
    }
    const { getCGImage } = await import("./lib/affection-cg.js");
    const result = getCGImage(cgId);
    if (result) {
      const buf = fs.readFileSync(result.filePath);
      res.writeHead(200, { "Content-Type": result.mime, "Cache-Control": "public, max-age=86400" });
      res.end(buf);
    } else {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // Health data import (before auth gate — app uploads from device)
  if (req.method === "POST" && req.url === "/api/health/import") {
    const body = await readBody(req);
    try {
      const { date, metrics } = JSON.parse(body);
      if (!date || !metrics) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "date and metrics required" }));
        return;
      }
      const result = importHealthData(date, metrics, "api");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

      if (result.updated) {
        generateDailySummary(date).then((summary) => {
          if (summary) {
            broadcast(JSON.stringify({
              type: "health_updated",
              date,
              metrics: result.metrics,
              summary: summary.slice(0, 300),
            }));
          }
        }).catch(() => {});
      }
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // All other endpoints require auth
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!verifyAuth(token)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Send text message
  if (req.method === "POST" && req.url === "/api/messages/text") {
    const body = await readBody(req);
    try {
      const { text, request_tts } = JSON.parse(body);
      console.log("[http] Text request, len:", text?.length || 0);
      recentMsgs.push({ ts: new Date().toISOString(), type: "__http_text", len: text?.length || 0 });
      if (recentMsgs.length > 30) recentMsgs.shift();
      if (!text?.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing text" }));
        return;
      }
      const reply = await handleTextMessage(text);
      let ttsJobId = null;
      if (request_tts) {
        ttsJobId = uuid();
        ttsQueue.enqueue({ jobId: ttsJobId, text: reply, replyTo: null });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply, tts_job_id: ttsJobId }));
    } catch (err) {
      console.error("[api] Text error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Intimate text via HTTP (fallback for WebSocket issues)
  if (req.method === "POST" && req.url === "/api/messages/intimate_text") {
    const body = await readBody(req);
    try {
      const { text } = JSON.parse(body);
      if (!text?.trim()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing text" }));
        return;
      }
      const reply = await handleIntimateMessage(text);
      const blindBox = getCurrentBlindBox();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply, blindBox: blindBox ? { name: blindBox.name } : null }));
    } catch (err) {
      console.error("[api] Intimate text error:", err.message);
      intimateDebugLog.push({ timestamp: new Date().toISOString(), stage: "http_error", error: err.message });
      if (intimateDebugLog.length > 20) intimateDebugLog.shift();
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Send voice message
  if (req.method === "POST" && req.url === "/api/messages/voice") {
    try {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      await new Promise(r => req.on("end", r));
      const wavBuf = Buffer.concat(chunks);
      const { text, reply } = await handleVoiceMessage(wavBuf);
      const ttsJobId = uuid();
      ttsQueue.enqueue({ jobId: ttsJobId, text: reply, replyTo: null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ transcribed: text, reply, tts_job_id: ttsJobId }));
    } catch (err) {
      console.error("[api] Voice error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // TTS job status
  if (req.method === "GET" && req.url?.startsWith("/api/tts/")) {
    // TTS jobs are in-memory only; if not in queue, assume done or unknown
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "unknown", note: "Check audio_ready/audio_failed WS events" }));
    return;
  }

  // Chat history
  if (req.method === "GET" && req.url === "/api/history") {
    const history = getChatHistory();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(history);
    return;
  }

  // ── 向哨无限流 HTTP API ──
  if (req.method === "GET" && req.url === "/api/sentinel-guide/history") {
    const narrative = getSGHistory();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ narrative, state: getPublicState() }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/sentinel-guide/state") {
    const state = getPublicState();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(state || { status: "idle" }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/sentinel-guide/sessions") {
    const sessions = listSessions();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ sessions }));
    return;
  }

  // ── System Panel API ──
  if (req.method === "GET" && req.url === "/api/sentinel-guide/system-panel") {
    const panel = getSystemPanel();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(panel));
    return;
  }

  // ── Forum API ──
  if (req.method === "GET" && req.url === "/api/sentinel-guide/forum/posts") {
    // Auto-trigger generation if cooldown has passed (no need to wait for manual call)
    generateForumPost().catch(() => {});
    const posts = getForumPosts();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(posts));
    return;
  }

  if (req.method === "POST" && req.url === "/api/sentinel-guide/forum/generate") {
    try {
      const post = await generateForumPost();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(post ? { generated: true, post } : { generated: false, reason: "cooldown" }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/sentinel-guide/restore/")) {
    const sessionId = req.url.split("/api/sentinel-guide/restore/")[1];
    const result = restoreSession(sessionId);
    res.writeHead(result.error ? 404 : 200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/sentinel-guide/purchase/")) {
    const shopItemId = req.url.split("/api/sentinel-guide/purchase/")[1];
    const result = purchaseItem(shopItemId);
    res.writeHead(result.error ? 400 : 200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/sentinel-guide/buy-for-xiayan/")) {
    const shopItemId = req.url.split("/api/sentinel-guide/buy-for-xiayan/")[1];
    const result = buyForXiayan(shopItemId);
    res.writeHead(result.error ? 400 : 200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/api/sentinel-guide/session/")) {
    const sessionId = req.url.split("/api/sentinel-guide/session/")[1];
    const session = loadSession(sessionId);
    if (session) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(session));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Session not found" }));
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not Found");
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// ── WebSocket ──
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  const connId = Math.random().toString(36).slice(2, 6);
  const todayStr = () => new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`[ws] Connected: ${ip} #${connId} (total: ${clients.size + 1})`);
  clients.set(ws, { authenticated: false, connId, connectedAt: Date.now() });
  recentMsgs.push({ ts: new Date().toISOString(), type: "__ws_connected", connId, total: clients.size });
  if (recentMsgs.length > 30) recentMsgs.shift();

  ws.on("close", () => {
    console.log(`[ws] Disconnected: ${ip} #${connId}`);
    recentMsgs.push({ ts: new Date().toISOString(), type: "__ws_disconnected", connId });
    if (recentMsgs.length > 30) recentMsgs.shift();
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    // Log ALL messages before auth check
    recentMsgs.push({ ts: new Date().toISOString(), type: msg.type, hasId: !!msg.id, auth: clients.get(ws)?.authenticated ?? false, conn: clients.get(ws)?.connId });
    if (recentMsgs.length > 30) recentMsgs.shift();

    // Auth must be first message
    if (msg.type === "auth") {
      if (verifyAuth(msg.token)) {
        clients.get(ws).authenticated = true;
        ws.send(JSON.stringify({ type: "auth_ok" }));
        // Send current travel state immediately so app shows correct status
        ws.send(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
        ws.send(JSON.stringify({ type: "couple_travel_state", trip: getCoupleTravelState() }));
        console.log(`[ws] Authenticated: ${ip}`);
      } else {
        ws.send(JSON.stringify({ type: "auth_error", message: "Invalid token" }));
        console.log(`[ws] Auth failed: ${ip}`);
      }
      return;
    }

    // All other messages require auth
    if (!clients.get(ws)?.authenticated) {
      ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "nxx_history") {
      const history = getNxxHistory(14);
      ws.send(JSON.stringify({ type: "nxx_history", messages: history }));
      return;
    }

    if (msg.type === "nxx_send") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        // Save女主's message
        saveNvzhuMessage(msg.content);
        // Broadcast to all clients
        broadcast(JSON.stringify({
          type: "nxx_message",
          character: "nvzhu",
          content: msg.content,
          time: new Date().toISOString(),
        }));
        // Generate AI responses
        const replies = await generateNxxChat({ nvzhuReply: msg.content });
        if (replies.length > 0) {
          broadcastNxxMessages(replies);
        }
      } catch (e) {
        console.error("[nxx] Send error:", e.message);
        ws.send(JSON.stringify({ type: "error", message: "群聊生成失败" }));
      }
      return;
    }

    if (msg.type === "nxx_sticker") {
      try {
        notifyUserActivity();
        // Broadcast女主's sticker to all clients
        broadcast(JSON.stringify({
          type: "nxx_message",
          character: "nvzhu",
          content: "",
          sticker: msg.sticker_file || "",
          time: new Date().toISOString(),
        }));
        // Generate AI responses (they might react to the sticker)
        const replies = await generateNxxChat({ nvzhuReply: "（发了一个表情包）" });
        if (replies.length > 0) {
          broadcastNxxMessages(replies);
        }
      } catch (e) {
        console.error("[nxx] Sticker error:", e.message);
      }
      return;
    }

    if (msg.type === "nxx_refresh") {
      try {
        const history = getNxxHistory(7);
        const lastNvzhuIdx = [...history].reverse().findIndex(m => m.character === "nvzhu");
        const staleMessages = lastNvzhuIdx > 0 ? [...history].reverse().slice(0, lastNvzhuIdx).reverse() : [];
        if (staleMessages.length > 0) {
          deleteNxxMessages(staleMessages);
        }
        const lastNvzhu = [...history].reverse().find(m => m.character === "nvzhu");
        const nvzhuReply = lastNvzhu?.content || "继续聊";
        const replies = await generateNxxChat({ nvzhuReply });
        if (replies.length > 0) {
          broadcast(JSON.stringify({
            type: "nxx_refreshed",
            deleted: staleMessages,
            messages: replies,
          }));
        }
      } catch (e) {
        console.error("[nxx] Refresh error:", e.message);
        ws.send(JSON.stringify({ type: "error", message: "刷新失败" }));
      }
      return;
    }

    if (msg.type === "nxx_delete") {
      try {
        deleteNxxMessages([{ character: msg.character, content: msg.content, time: msg.time, sticker: msg.sticker || "" }]);
        broadcast(JSON.stringify({
          type: "nxx_deleted",
          character: msg.character,
          content: msg.content,
          time: msg.time,
          sticker: msg.sticker || "",
        }));
      } catch (e) {
        console.error("[nxx] Delete error:", e.message);
      }
      return;
    }

    if (msg.type === "nxx_delete_messages") {
      try {
        if (msg.items && Array.isArray(msg.items)) {
          deleteNxxMessages(msg.items);
          broadcast(JSON.stringify({
            type: "nxx_messages_deleted",
            items: msg.items,
          }));
        }
      } catch (e) {
        console.error("[nxx] Batch delete error:", e.message);
      }
      return;
    }

    if (msg.type === "weather_city") {
      if (msg.city) {
        setWeatherCity(msg.city);
        ws.send(JSON.stringify({ type: "weather_city_ok", city: msg.city }));
      }
      return;
    }

    if (msg.type === "text") {
      if (!msg.content?.trim()) return;
      try {
        // 睡眠时段：日常聊天暂停回复，消息排队等早上处理
        // 亲密空间和旅行亲密空间不受影响（独立 handler）
        if (isSleepTime()) {
          sleepMessageQueue.push({ ws, msg, receivedAt: Date.now() });
          console.log(`[sleep-queue] Queued message from sleep period (queue: ${sleepMessageQueue.length})`);
          return;
        }

        notifyUserActivity();

        // ── 出门时间追踪 ──
        const userMsg = msg.content;
        // 检测回家时间: "6点回家" / "8点左右回来" / "大概7点到家"
        const returnMatch = userMsg.match(/(\d{1,2})点(?:半|左右|多)?(?:回家|回来|到家|回去|能到|到)/);
        if (returnMatch) {
          const hour = parseInt(returnMatch[1]);
          if (hour >= 6 && hour <= 23) {
            scheduleOutReminder(hour);
          }
        }
        // 检测已到家: "我回来了" / "到家了" / "到了"
        if (/我回来了|到家了|回来了|我到了/.test(userMsg)) {
          clearOutReminder();
        }

        // 对方正在输入状态
        ws.send(JSON.stringify({ type: "presence", status: "typing" }));

        const hsBefore = getHuashengTravelState().active;
        // 日常聊天语音概率触发：用户明确要语音→流式语音；否则走文字，AI 按 prompt 规则偶尔加 [语音]
        const userWantsVoice = shouldVoiceReply(msg.content);
        let fullReply;
        if (userWantsVoice) {
          fullReply = await streamVoiceReply(ws, msg.id, msg.content);
        } else {
          fullReply = await handleTextMessage(msg.content);
        }
        const hsAfter = getHuashengTravelState().active;
        if (hsBefore !== hsAfter) {
          broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
        }
        const wantsVoice = fullReply.startsWith("[语音]") || userWantsVoice;
        const reply = fullReply.replace(/^\[语音\]\s*/, "");

        if (wantsVoice) {
          if (!userWantsVoice) {
            // AI 主动加 [语音]：发 voice_reply + 入 TTS 队列
            markLastBotReplyVoice();
            const jobId = uuid();
            ws.send(JSON.stringify({
              type: "voice_reply",
              reply_to: msg.id,
              job_id: jobId,
              text: reply,
            }));
            ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.id });
          }
        } else {
          const segments = splitIntoMessages(reply);
          sendSegments(ws, msg.id, segments);
        }

        // Trigger gift/scenery/decor as side effects (non-blocking)
        triggerMultimediaEvents(ws, msg.id);
        tryRedecorate().then((result) => {
          if (result) {
            broadcast(JSON.stringify({
              type: "decor_update",
              currentTheme: result.theme.id,
              theme: result.theme,
              allThemes: getAllThemes(),
            }));
          }
        }).catch(() => {});

        // Scene image: detect and send a relevant illustration (non-blocking)
        tryGetSceneImage(reply).then((img) => {
          if (img && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "scene_image",
              reply_to: msg.id,
              base64: img.base64,
              mime: img.mime,
              keyword: img.keyword,
            }));
            console.log(`[scene-image] Sent image for: ${img.keyword}`);
          }
        }).catch(() => {});
      } catch (err) {
        console.error("[ws] Text error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "intimate_text") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        intimateLastUserMsg = Date.now();
        const hsBefore = getHuashengTravelState().active;
        const reply = await handleIntimateMessage(msg.content);
        const cleanReply = processEjaculationMarker(reply, msg.id);
        const hsAfter = getHuashengTravelState().active;
        if (hsBefore !== hsAfter) {
          broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
        }
        const blindBox = getCurrentBlindBox();
        ws.send(JSON.stringify({
          type: "intimate_reply",
          reply_to: msg.id,
          content: cleanReply,
          blindBox: blindBox ? { name: blindBox.name } : null,
        }));

        // Trigger gift/scenery for intimate space too
        triggerMultimediaEvents(ws, msg.id);
      } catch (err) {
        console.error("[ws] Intimate text error:", err.message);
        intimateDebugLog.push({ timestamp: new Date().toISOString(), stage: "ws_error", error: err.message });
        if (intimateDebugLog.length > 20) intimateDebugLog.shift();
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    // ── 小玩具系统 ──
    if (msg.type === "toy_state_change") {
      updateToyState({
        toyType: msg.toyType || "none",
        suctionConnected: msg.ends?.suction ?? false,
        insertionConnected: msg.ends?.insertion ?? false,
        vibrateConnected: msg.ends?.vibrate ?? false,
        mode: msg.mode || "chat",
      });
      const state = getToyState();
      ws.send(JSON.stringify({ type: "toy_state_ack", state }));
      // Broadcast to all clients so other devices stay in sync
      broadcast(JSON.stringify({ type: "toy_state", state }));
      console.log("[toy] State change received:", JSON.stringify(state));
      return;
    }

    if (msg.type === "toy_get_state") {
      ws.send(JSON.stringify({ type: "toy_state", state: getToyState() }));
      return;
    }

    if (msg.type === "toy_set_mode") {
      if (msg.mode === "cuddle" || msg.mode === "chat") {
        setToyMode(msg.mode);
      }
      ws.send(JSON.stringify({ type: "toy_state", state: getToyState() }));
      return;
    }

    // ── 盲盒剧场（独立频道）──
    if (msg.type === "blindbox_text") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        const reply = await handleIntimateMessage(msg.content, "blindbox");
        const cleanReply = processEjaculationMarker(reply, msg.id);
        const blindBox = getCurrentBlindBox();
        ws.send(JSON.stringify({
          type: "blindbox_reply",
          reply_to: msg.id,
          content: cleanReply,
          blindBox: blindBox ? { name: blindBox.name } : null,
        }));
      } catch (err) {
        console.error("[ws] BlindBox text error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    // ── 居家温存 ──
    if (msg.type === "affection_home") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        const reply = await handleAffectionHomeMessage(msg.content, { openingLine: msg.openingLine });
        const cleanReply = processEjaculationMarker(reply, msg.id);
        const segments = splitIntoMessages(cleanReply);
        sendSegments(ws, msg.id, segments);
      } catch (err) {
        console.error("[ws] Affection home error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    // ── 居家温存开场白（存入历史，不触发AI回复）──
    if (msg.type === "affection_home_opening") {
      recordAffectionMessage("affection_home", "assistant", msg.content || "");
      return;
    }

    // ── 居家温存恢复对话（中途退出再进来，夏彦主动接上话题）──
    if (msg.type === "affection_home_resume") {
      try {
        const history = getAffectionHistoryMessages("affection_home");
        const reply = await askJiushi({
          systemPrompt: getAffectionHomeSystemPrompt() + `\n\n【⚠ 恢复对话】你刚才和华生在聊天，她中途退出了一下又回来了。下面是你们刚才的聊天记录。请主动跟她说话——自然地提一下刚才聊的话题，问她"怎么走神了？"或者"刚才说到哪了？"语气轻松亲密，不要重新自我介绍，不要像刚见面一样。就一两句，自然得像她只是去倒了杯水回来。`,
          userContent: msg.context || "",
          history: history.slice(-6),
          maxTokens: 150,
          temperature: 0.75,
          timeoutMs: 30000,
        });
        const cleaned = stripBracketActions(stripYellowFaces(reply));
        if (cleaned) {
          recordAffectionMessage("affection_home", "assistant", cleaned);
          const segments = splitIntoMessages(cleaned);
          sendSegments(ws, msg.id, segments);
        }
      } catch (err) {
        console.error("[ws] Affection home resume error:", err.message);
      }
      return;
    }

    // ── 居家温存 CG 列表/解锁 ──
    if (msg.type === "get_affection_cgs") {
      const { getCGHistory, getUnlockedCGs } = await import("./lib/affection-cg.js");
      ws.send(JSON.stringify({
        type: "affection_cgs",
        all: getCGHistory(),
        unlocked: getUnlockedCGs(),
      }));
      return;
    }
    if (msg.type === "unlock_affection_cg") {
      const { unlockCG } = await import("./lib/affection-cg.js");
      const cg = unlockCG(msg.cgId, msg.context || "");
      if (cg) {
        broadcast(JSON.stringify({
          type: "affection_cg_unlocked",
          cg,
        }));
      }
      return;
    }

    // ── 查询约会状态 ──
    if (msg.type === "get_date_status") {
      // Check for pending dates that should activate today
      const activated = checkTodayDates();
      for (const plan of activated) {
        const sceneId = plan.sceneId || detectSceneId(plan.text);
        if (sceneId) {
          broadcast(JSON.stringify({
            type: "dating_invite",
            sceneId,
            text: plan.text || "",
            timestamp: Date.now(),
          }));
          console.log(`[dating-invite] Auto-activated scheduled date: ${plan.id} scene=${sceneId}`);
        }
      }
      const active = getActive();
      const pending = getPending();
      ws.send(JSON.stringify({
        type: "date_status",
        active: active ? { id: active.id, sceneId: active.sceneId || detectSceneId(active.text) || null, text: active.text } : null,
        pending: pending.map(p => ({ id: p.id, text: p.text, scheduledDate: p.scheduledDate })),
      }));
      return;
    }

    // ── 情侣旅行 ──
    if (msg.type === "couple_travel_create") {
      try {
        const trip = createTrip({ destinations: msg.destinations || [] });
        broadcast(JSON.stringify({ type: "couple_travel_state", trip }));
        console.log(`[couple-travel] Created trip: ${trip.tripId} dests=${trip.destinations.join(",")}`);
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "couple_travel_checkout") {
      const trip = checkOut();
      broadcast(JSON.stringify({ type: "couple_travel_state", trip }));
      return;
    }

    if (msg.type === "reset_travel") {
      confirmReturned();
      const travel = getTravelState();
      broadcast(JSON.stringify({ type: "travel_state", xiayan: travel, huasheng: getHuashengTravelState() }));
      ws.send(JSON.stringify({ type: "travel_state", xiayan: travel, huasheng: getHuashengTravelState() }));
      console.log("[travel] Manually reset to idle");
      return;
    }

    if (msg.type === "couple_travel_get_state") {
      ws.send(JSON.stringify({ type: "couple_travel_state", trip: getCoupleTravelState() }));
      return;
    }

    if (msg.type === "couple_travel_get_scenes") {
      const trip = getCoupleTravelState();
      const tod = trip.phase === "traveling" ? getTimeOfDay() : getTimeOfDay();
      const scenes = getAvailableScenes(tod, trip.destinations || []);
      ws.send(JSON.stringify({ type: "couple_travel_scenes", timeOfDay: tod, day: trip.currentDay, scenes, destinations: trip.destinations }));
      return;
    }

    // ── 出门约会：清空旧记忆 ──
    if (msg.type === "affection_date_clear") {
      try {
        const { clearAffectionMemory, recordAffectionMessage } = await import("./lib/affection-memory.js");
        clearAffectionMemory("affection_date");
        // Record the opening line so AI has context for the first reply
        if (msg.openingText) {
          recordAffectionMessage("affection_date", "assistant", msg.openingText);
          console.log(`[ws] Recorded opening: "${msg.openingText.slice(0, 50)}..."`);
        }
        console.log("[ws] Cleared affection_date memory for new date");
      } catch (err) {
        console.error("[ws] affection_date_clear error:", err.message);
      }
      return;
    }

    // ── 出门约会 ──
    if (msg.type === "affection_date") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        const reply = await handleAffectionDateMessage(msg.content, msg.sceneId || null);
        const cleanReply = processEjaculationMarker(reply, msg.id);
        const segments = splitIntoMessages(cleanReply);
        // Longer delay for dating: text length × 120ms + 5s reading buffer, min 8s max 25s
        const baseDelay = Math.max(8000, Math.min(cleanReply.length * 120 + 5000, 25000));
        sendSegments(ws, msg.id, segments, baseDelay);
      } catch (err) {
        console.error("[ws] Affection date error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "phone_call") {
      if (!msg.content?.trim()) return;
      try {
        notifyUserActivity();
        // 电话 = 语音，走流式：文字实时吐 + 按句合成逐句下发
        await streamVoiceReply(ws, msg.id, msg.content, {
          handler: (d) => handlePhoneCallMessage(msg.content, d),
          markVoice: false,
        });
      } catch (err) {
        console.error("[ws] Phone call error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "regenerate") {
      if (!msg.user_content) return;
      try {
        notifyUserActivity();
        // Delete old bot reply from chat history
        if (msg.bot_content) {
          if (msg.channel === "intimate") {
            deleteIntimateHistoryMessage(msg.bot_content, "assistant");
          } else {
            deleteChatMessage(msg.bot_content, "assistant");
          }
        }
        // Route to correct handler
        const handler = msg.channel === "intimate" ? handleIntimateMessage : handleTextMessage;
        const rawReply = await handler(msg.user_content);
        const fullReply = msg.channel === "intimate" ? processEjaculationMarker(rawReply, msg.reply_to) : rawReply;
        const voiceTag = fullReply.startsWith("[语音]");
        const reply = voiceTag ? fullReply.replace(/^\[语音\]\s*/, "") : fullReply;

        if (voiceTag) {
          markLastBotReplyVoice();
          const jobId = uuid();
          ws.send(JSON.stringify({
            type: "voice_reply_regenerated",
            reply_to: msg.reply_to,
            job_id: jobId,
            text: reply,
          }));
          ttsQueue.enqueue({ jobId, text: reply, replyTo: msg.reply_to });
        } else {
          ws.send(JSON.stringify({
            type: "regenerated",
            reply_to: msg.reply_to,
            content: reply,
          }));
        }

        // Side effects: gift/scenery
        triggerMultimediaEvents(ws, msg.reply_to);
      } catch (err) {
        console.error("[ws] Regenerate error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "voice") {
      if (!msg.audio) return;
      try {
        notifyUserActivity();
        ws.send(JSON.stringify({ type: "presence", status: "typing" }));
        const wavBuf = Buffer.from(msg.audio, "base64");
        let recognizedText = "";
        const { text, reply: fullReply } = await handleVoiceMessage(
          wavBuf,
          msg.mime || "audio/mp4",
          (recognized, isVoice) => {
            recognizedText = recognized;
            return streamVoiceReply(ws, msg.id, recognized, { markVoice: true });
          }
        );
        ws.send(JSON.stringify({
          type: "voice_transcribed",
          reply_to: msg.id,
          text,
        }));
      } catch (err) {
        console.error("[ws] Voice error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    if (msg.type === "get_history") {
      const channel = msg.channel || "chat";
      const traveling = isTraveling();
      let rawMessages;
      if (channel === "intimate") {
        rawMessages = await getIntimateHistoryMessages(traveling);
      } else if (channel === "blindbox") {
        rawMessages = await getBlindBoxHistoryMessages();
      } else if (channel === "affection_home" || channel === "affection_date") {
        const { getAffectionHistoryMessages } = await import("./lib/affection-memory.js");
        rawMessages = getAffectionHistoryMessages(channel);
      } else if (channel === "phone_call") {
        // Phone calls don't persist server-side history yet
        rawMessages = [];
      } else {
        rawMessages = await getChatHistoryMessages(traveling);
      }
      // Convert to app Message format
      // Affection/Intimate messages: keep as one long message (no splitting)
      const messages = [];
      const noSplit = channel === "intimate" || channel === "blindbox" || channel === "affection_home" || channel === "affection_date" || channel === "phone_call";
      for (let i = 0; i < rawMessages.length; i++) {
        const m = rawMessages[i];
        if (!noSplit && m.role === "assistant" && m.type !== "voice" && m.content && m.content.length > 20) {
          const segments = splitIntoMessages(m.content);
          segments.forEach((seg, si) => {
            messages.push({
              id: `h${i}_s${si}_${Date.now()}`,
              from: "xiayan",
              type: "text",
              content: seg,
              status: "delivered",
              timestamp: Date.now() - (rawMessages.length - i) * 1000 + si,
            });
          });
        } else {
          messages.push({
            id: `h${i}_${Date.now()}`,
            from: m.role === "user" ? "me" : "xiayan",
            type: "text",
            content: m.content,
            status: "delivered",
            timestamp: Date.now() - (rawMessages.length - i) * 1000,
          });
        }
      }
      ws.send(JSON.stringify({ type: "history", channel, messages }));
      return;
    }

    if (msg.type === "get_history_by_date") {
      const date = msg.date;
      if (!date) { ws.send(JSON.stringify({ type: "error", message: "Missing date" })); return; }
      const { getChatHistoryByDate } = await import("./lib/memory.js");
      const rawMessages = getChatHistoryByDate(date);
      const messages = [];
      for (let i = 0; i < rawMessages.length; i++) {
        const m = rawMessages[i];
        messages.push({
          id: `hd${date}_${i}_${Date.now()}`,
          from: m.role === "user" ? "me" : "xiayan",
          type: "text",
          content: m.content,
          status: "delivered",
          timestamp: m.time || Date.now(),
        });
      }
      ws.send(JSON.stringify({ type: "history_by_date", date, messages }));
      return;
    }

    if (msg.type === "clear_history") {
      const channel = msg.channel || "chat";
      if (channel === "intimate") {
        await clearIntimateHistory();
      } else if (channel === "blindbox") {
        await clearBlindBoxHistory();
      } else if (channel === "affection_home" || channel === "affection_date") {
        const { clearAffectionMemory } = await import("./lib/affection-memory.js");
        clearAffectionMemory(channel);
      } else {
        clearChatHistory();
      }
      ws.send(JSON.stringify({ type: "history_cleared", channel }));
      return;
    }

    if (msg.type === "delete_message") {
      const channel = msg.channel || "chat";
      const content = msg.content || "";
      const from = msg.from === "me" ? "user" : "assistant";
      if (channel === "affection_home" || channel === "affection_date") {
        const { deleteAffectionMessage } = await import("./lib/affection-memory.js");
        deleteAffectionMessage(channel, content, from);
      } else if (channel === "intimate") {
        deleteIntimateHistoryMessage(content, from);
      } else {
        deleteChatMessage(content, from);
      }
      ws.send(JSON.stringify({ type: "message_deleted", channel, content, from }));
      return;
    }

    if (msg.type === "delete_messages") {
      const channel = msg.channel || "chat";
      const items = (msg.items || []).map(i => ({ content: i.content || "", role: i.from === "me" ? "user" : "assistant" }));
      if (channel === "intimate") {
        const { deleteIntimateMessages } = await import("./lib/intimate-memory.js");
        deleteIntimateMessages(items);
      } else {
        const { deleteMessages } = await import("./lib/memory.js");
        deleteMessages(items);
      }
      ws.send(JSON.stringify({ type: "messages_deleted", channel, count: items.length }));
      return;
    }

	　if (msg.type === "clear_personality") {
	      const track = msg.track || "chat";
	      const { resetPersonality } = await import("./lib/personality.js");
	      resetPersonality(track);
	      ws.send(JSON.stringify({ type: "personality_cleared", track }));
	      return;
	    }

    // ── Image message (base64 encoded) ──
    if (msg.type === "image") {
      if (!msg.base64 || !msg.mime) return;
      try {
        notifyUserActivity();
        // Auto-save to album
        const photo = addPhoto(msg.base64, msg.mime, "me");
        // Recognize image content with 火山方舟 vision model
        const imageDesc = await recognizeImage(msg.base64, msg.mime);
        const textContent = imageDesc
          ? `[华生发来了一张图片，图片内容是：${imageDesc}]`
          : `[华生发来了一张图片]`;
        // Forward to AI with image context
        const reply = await handleTextMessage(
          textContent,
          false,
          { imageBase64: msg.base64, imageMime: msg.mime }
        );
        // Notify album update
        ws.send(JSON.stringify({ type: "album_updated", photo }));
        // Check for voice tag
        if (reply.startsWith("[语音]")) {
          markLastBotReplyVoice();
          const cleanReply = reply.replace(/^\[语音\]\s*/, "");
          const jobId = uuid();
          ws.send(JSON.stringify({
            type: "voice_reply",
            reply_to: msg.id,
            job_id: jobId,
            text: cleanReply,
          }));
          ttsQueue.enqueue({ jobId, text: cleanReply, replyTo: msg.id });
        } else {
          const segments = splitIntoMessages(reply);
          sendSegments(ws, msg.id, segments);
        }
      } catch (err) {
        console.error("[ws] Image error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      return;
    }

    // ── Pet ──
    if (msg.type === "pet_get") {
      const state = getPetState();
      ws.send(JSON.stringify({ type: "pet_state", pet: state }));
      return;
    }

    if (msg.type === "pet_interact") {
      if (!msg.action) return;
      const result = petInteract(msg.action);
      const log = addPetLog("me", msg.action, result.reaction);
      ws.send(JSON.stringify({ type: "pet_state", pet: result, reaction: result.reaction, action: msg.action }));
      ws.send(JSON.stringify({
        type: "pet_log",
        id: log.id,
        actor: "me",
        action: msg.action,
        reaction: result.reaction,
        timestamp: log.timestamp,
      }));
      // Also send as a chat message from 夏彦 about the pet
      ws.send(JSON.stringify({
        type: "text_reply",
        reply_to: msg.id || "",
        content: `[宠物] ${result.reaction}`,
        skip_tts: true,
      }));
      return;
    }

    if (msg.type === "pet_name") {
      if (!msg.name?.trim()) return;
      const updated = petSetName(msg.name);
      ws.send(JSON.stringify({ type: "pet_state", pet: updated }));
      return;
    }

    if (msg.type === "pet_get_logs") {
      const logs = getPetLogs(100);
      ws.send(JSON.stringify({ type: "pet_logs", logs }));
      return;
    }

    // ── Todo ──
    if (msg.type === "todo_list") {
      const list = getTodos();
      ws.send(JSON.stringify({ type: "todo_list", todos: list }));
      return;
    }

    if (msg.type === "todo_add") {
      if (!msg.text?.trim()) return;
      const todo = addTodo(msg.text, msg.addedBy || "me", msg.deadline || "");
      ws.send(JSON.stringify({ type: "todo_updated", todo, todos: getTodos() }));
      return;
    }

    if (msg.type === "todo_done") {
      if (!msg.id) return;
      const todo = doneTodo(msg.id);
      if (todo) {
        ws.send(JSON.stringify({ type: "todo_updated", todo, todos: getTodos() }));
        notifyDone(todo.text, todo.addedBy);
      }
      return;
    }

    if (msg.type === "todo_delete") {
      if (!msg.id) return;
      deleteTodo(msg.id);
      ws.send(JSON.stringify({ type: "todo_updated", todo: null, todos: getTodos() }));
      return;
    }

    // ── 共读 coread ──
    if (msg.type === "coread_get") {
      ws.send(JSON.stringify({ type: "coread_state", state: coreadGetState() }));
      return;
    }

    if (msg.type === "coread_start") {
      try {
        const { state, passage, error } = await coreadStart(msg.title);
        if (error) {
          ws.send(JSON.stringify({ type: "coread_error", message: error }));
          return;
        }
        ws.send(JSON.stringify({ type: "coread_state", state, passage }));
      } catch (e) {
        console.error("[coread] start failed:", e.message);
        ws.send(JSON.stringify({ type: "coread_error", message: "生成失败，稍后再试" }));
      }
      return;
    }

    if (msg.type === "coread_continue") {
      try {
        const { state, passage, error } = await coreadContinue();
        if (error) {
          ws.send(JSON.stringify({ type: "coread_error", message: error }));
          return;
        }
        ws.send(JSON.stringify({ type: "coread_state", state, passage }));
      } catch (e) {
        console.error("[coread] continue failed:", e.message);
        ws.send(JSON.stringify({ type: "coread_error", message: "生成失败，稍后再试" }));
      }
      return;
    }

    if (msg.type === "coread_import") {
      let text = msg.text;
      if (!text && msg.base64) {
        text = decodeTxtBase64(msg.base64);
      }
      if (!text?.trim()) return;
      try {
        const { state, passage, error } = await coreadImport(msg.title, text);
        if (error) {
          ws.send(JSON.stringify({ type: "coread_error", message: error }));
          return;
        }
        ws.send(JSON.stringify({ type: "coread_state", state, passage }));
      } catch (e) {
        console.error("[coread] import failed:", e.message);
        ws.send(JSON.stringify({ type: "coread_error", message: "导入失败，稍后再试" }));
      }
      return;
    }

    if (msg.type === "coread_discuss") {
      if (!msg.text?.trim()) return;
      try {
        const { state, reply } = await coreadDiscuss(msg.text);
        ws.send(JSON.stringify({ type: "coread_state", state, reply }));
      } catch (e) {
        console.error("[coread] discuss failed:", e.message);
        ws.send(JSON.stringify({ type: "coread_error", message: "回复失败，稍后再试" }));
      }
      return;
    }

    if (msg.type === "coread_suggest") {
      ws.send(JSON.stringify({ type: "coread_suggested", book: await coreadPickBook() }));
      return;
    }

    // ── 一起听歌 duetto ──
    if (msg.type === "duetto_get") {
      ws.send(JSON.stringify({ type: "duetto_state", state: duettoGetState() }));
      return;
    }

    if (msg.type === "duetto_search") {
      try {
        const songs = await neteaseSearch(msg.keywords);
        ws.send(JSON.stringify({ type: "duetto_search_result", songs, keywords: msg.keywords }));
      } catch (e) {
        console.error("[duetto] search failed:", e.message);
        ws.send(JSON.stringify({ type: "duetto_search_result", songs: [], keywords: msg.keywords }));
      }
      return;
    }

    if (msg.type === "duetto_share") {
      try {
        let title = msg.title;
        let artist = msg.artist;
        let lyric = "";
        let cover = "";
        let url = "";
        const songId = msg.songId || null;

        // 从网易云按 songId 拉详情 + 歌词 + 播放链接
        if (songId) {
          const detail = await neteaseDetail(songId);
          if (detail) {
            title = detail.name;
            artist = detail.artist;
            cover = detail.cover;
          }
          lyric = await neteaseLyric(songId);
          url = await neteaseUrl(songId);
        }

        if (!title?.trim()) return;
        const { state, song, error } = await duettoShare(title, artist, { lyric, cover, songId, url });
        if (error) {
          ws.send(JSON.stringify({ type: "duetto_error", message: error }));
          return;
        }
        ws.send(JSON.stringify({ type: "duetto_state", state, song }));
      } catch (e) {
        console.error("[duetto] share failed:", e.message);
        ws.send(JSON.stringify({ type: "duetto_error", message: "生成失败，稍后再试" }));
      }
      return;
    }

    if (msg.type === "duetto_discuss") {
      if (!msg.text?.trim()) return;
      try {
        const { state, reply } = await duettoDiscuss(msg.text);
        ws.send(JSON.stringify({ type: "duetto_state", state, reply }));
      } catch (e) {
        console.error("[duetto] discuss failed:", e.message);
        ws.send(JSON.stringify({ type: "duetto_error", message: "回复失败，稍后再试" }));
      }
      return;
    }

    // ── 色色大富翁 monopoly ──
    if (msg.type === "monopoly_get") {
      // 每次打开生成一段开场（随机角度，不固定）
      const opening = await monopolyOpening();
      ws.send(JSON.stringify({ type: "monopoly_state", state: monopolyGetState(), opening }));
      return;
    }

    if (msg.type === "monopoly_roll") {
      const dice = Math.max(1, Math.min(6, parseInt(msg.dice) || 1));
      try {
        const { task, scene, fromPos, toPos, who, state } = await monopolyRoll(dice);
        ws.send(JSON.stringify({ type: "monopoly_scene", state, task, scene, fromPos, toPos, who, dice }));
      } catch (e) {
        console.error("[monopoly] roll failed:", e.message);
        ws.send(JSON.stringify({ type: "monopoly_error", message: "生成失败，稍后再试" }));
      }
      return;
    }

    if (msg.type === "monopoly_reset") {
      ws.send(JSON.stringify({ type: "monopoly_state", state: monopolyReset() }));
      return;
    }

    // ── 魅魔日历 ──
    if (msg.type === "calendar_get") {
      ws.send(JSON.stringify({ type: "calendar_state", calendar: calendarGet() }));
      return;
    }
    if (msg.type === "calendar_add_note") {
      const note = calendarAddNote(msg.date, msg.text);
      ws.send(JSON.stringify({ type: "calendar_state", calendar: calendarGet() }));
      return;
    }
    if (msg.type === "calendar_del_note") {
      calendarDelNote(msg.date, msg.id);
      ws.send(JSON.stringify({ type: "calendar_state", calendar: calendarGet() }));
      return;
    }
    if (msg.type === "calendar_add_alarm") {
      calendarAddAlarm({ date: msg.date, time: msg.time, label: msg.label });
      ws.send(JSON.stringify({ type: "calendar_state", calendar: calendarGet() }));
      return;
    }
    if (msg.type === "calendar_del_alarm") {
      calendarDelAlarm(msg.id);
      ws.send(JSON.stringify({ type: "calendar_state", calendar: calendarGet() }));
      return;
    }

    // ── Inspiration notes ──
    if (msg.type === "inspiration_list") {
      const list = inspirationGetAll();
      ws.send(JSON.stringify({ type: "inspiration_list", notes: list }));
      return;
    }

    if (msg.type === "inspiration_create") {
      if (!msg.text?.trim()) return;
      const note = inspirationCreate(msg.text);
      ws.send(JSON.stringify({ type: "inspiration_updated", note, notes: inspirationGetAll() }));
      // 夏彦 comments on new inspiration (background, no delay)
      const creatorWs = ws;
      generateInspirationComment(note)
        .then((comment) => {
          console.log("[inspiration] Got comment:", comment);
          if (comment) {
            inspirationAddComment(note.id, "xiayan", comment);
            const payload = JSON.stringify({
              type: "inspiration_updated",
              note: inspirationGet(note.id),
              notes: inspirationGetAll(),
            });
            // Send to creator first
            if (creatorWs.readyState === 1) {
              creatorWs.send(payload);
              console.log("[inspiration] Sent to creator");
            }
            // Broadcast to others
            for (const [other, s] of clients) {
              if (other !== creatorWs && s.authenticated && other.readyState === 1) {
                other.send(payload);
              }
            }
            console.log("[inspiration] Update sent to", clients.size, "clients");
          } else {
            console.log("[inspiration] No comment generated");
          }
        })
        .catch((e) => console.error("[inspiration] Comment failed:", e.message || e));
      return;
    }

    if (msg.type === "inspiration_update") {
      if (!msg.id) return;
      let note = null;
      if (msg.status) note = inspirationUpdateStatus(msg.id, msg.status);
      if (msg.text) note = inspirationUpdateText(msg.id, msg.text);
      if (note) {
        ws.send(JSON.stringify({ type: "inspiration_updated", note, notes: inspirationGetAll() }));
        // 夏彦 reacts when note is completed
        if (msg.status === "completed") {
          setTimeout(async () => {
            try {
              const comment = `哇，这个灵感完成了！好厉害～快让我看看成品！`;
              const saved = inspirationAddComment(note.id, "xiayan", comment);
              broadcast(JSON.stringify({ type: "inspiration_updated", note: inspirationGet(note.id), notes: inspirationGetAll() }));
            } catch {}
          }, 5000 + Math.random() * 3000);
        }
      }
      return;
    }

    if (msg.type === "inspiration_delete") {
      if (!msg.id) return;
      inspirationDelete(msg.id);
      ws.send(JSON.stringify({ type: "inspiration_deleted", id: msg.id, notes: inspirationGetAll() }));
      return;
    }

    if (msg.type === "inspiration_comment") {
      if (!msg.id || !msg.text?.trim()) return;
      const comment = inspirationAddComment(msg.id, "me", msg.text);
      if (comment) {
        ws.send(JSON.stringify({ type: "inspiration_updated", note: inspirationGet(msg.id), notes: inspirationGetAll() }));
      }
      return;
    }

    // ── Period tracking ──
    if (msg.type === "period_start") {
      const state = startPeriod(msg.date);
      ws.send(JSON.stringify({ type: "period_state", ...state }));
      return;
    }

    if (msg.type === "period_end") {
      const state = endPeriod(msg.date);
      ws.send(JSON.stringify({ type: "period_state", ...state }));
      return;
    }

    if (msg.type === "period_status") {
      const state = getPeriodState();
      ws.send(JSON.stringify({ type: "period_state", ...state }));
      return;
    }

    if (msg.type === "period_calendar") {
      const data = getCalendarData(msg.year, msg.month);
      ws.send(JSON.stringify({ type: "period_calendar", ...data }));
      return;
    }

    if (msg.type === "period_symptom") {
      if (!msg.date) return;
      const result = recordSymptom(msg.date, {
        cramps: msg.cramps,
        mood: msg.mood,
        otherSymptoms: msg.otherSymptoms,
        note: msg.note,
      });
      ws.send(JSON.stringify({ type: "period_symptom_saved", ...result }));
      return;
    }

    if (msg.type === "period_symptom_get") {
      const symptoms = getSymptomsForDate(msg.date);
      ws.send(JSON.stringify({ type: "period_symptom_data", date: msg.date, symptoms }));
      return;
    }

    if (msg.type === "period_history") {
      const history = getPeriodHistory();
      ws.send(JSON.stringify({ type: "period_history", history }));
      return;
    }

    // ── Album ──
    if (msg.type === "album_list") {
      const photos = getPhotos();
      ws.send(JSON.stringify({ type: "album_list", photos }));
      return;
    }

    if (msg.type === "album_get") {
      if (!msg.id) return;
      const photo = getPhoto(msg.id);
      const file = getPhotoFile(msg.id);
      if (!photo || !file) {
        ws.send(JSON.stringify({ type: "error", message: "Photo not found" }));
        return;
      }
      const imageBase64 = fs.readFileSync(file.path).toString("base64");
      ws.send(JSON.stringify({ type: "album_photo", photo, imageBase64, mime: file.mime }));
      return;
    }

    if (msg.type === "album_comment") {
      if (!msg.id || !msg.content?.trim()) return;
      const result = addComment(msg.id, msg.author || "me", msg.content);
      if (!result) {
        ws.send(JSON.stringify({ type: "error", message: "Photo not found" }));
        return;
      }
      ws.send(JSON.stringify({ type: "album_photo", photo: result.photo, imageBase64: result.imageBase64, mime: result.photo.mime }));
      return;
    }

    if (msg.type === "album_delete") {
      if (!msg.id) return;
      deletePhoto(msg.id);
      ws.send(JSON.stringify({ type: "album_list", photos: getPhotos() }));
      return;
    }

    // ── Gift ──
    if (msg.type === "gift_get") {
      if (!msg.gift_id) return;
      const gift = getGift(msg.gift_id);
      if (!gift) { ws.send(JSON.stringify({ type: "error", message: "Gift not found" })); return; }
      const image = getGiftImage(msg.gift_id);
      ws.send(JSON.stringify({
        type: "gift_detail",
        gift,
        imageBase64: image?.base64 || null,
        mime: image?.mime || null,
      }));
      return;
    }

    if (msg.type === "gift_comment") {
      if (!msg.gift_id || !msg.content?.trim()) return;
      const gift = addGiftComment(msg.gift_id, msg.author || "me", msg.content);
      if (!gift) { ws.send(JSON.stringify({ type: "error", message: "Gift not found" })); return; }
      broadcast(JSON.stringify({ type: "gift_updated", gift }));
      if ((msg.author || "me") === "me") {
        generateXiaYanGiftReply(msg.gift_id, msg.content).then((updated) => {
          if (updated) broadcast(JSON.stringify({ type: "gift_updated", gift: updated }));
        }).catch(() => {});
      }
      return;
    }

    if (msg.type === "gift_delete_comment") {
      if (!msg.gift_id || !msg.comment_id) return;
      const ok = deleteGiftComment(msg.gift_id, msg.comment_id);
      if (ok) {
        const gift = getGift(msg.gift_id);
        if (gift) broadcast(JSON.stringify({ type: "gift_updated", gift }));
      }
      return;
    }

    // ── Discover / Moments ──
    if (msg.type === "discover_list") {
      const moments = getMoments();
      // Send without image data (client fetches on demand)
      const lightMoments = moments.map((m) => ({ ...m, _hasImage: !!m.image }));
      ws.send(JSON.stringify({ type: "discover_list", moments: lightMoments }));
      return;
    }

    if (msg.type === "discover_get_image") {
      if (!msg.id) return;
      const moments = getMoments();
      const moment = moments.find((m) => m.id === msg.id);
      if (!moment?.image) return;
      const base64 = getMomentImage(moment.image);
      if (base64) {
        ws.send(JSON.stringify({ type: "discover_image", id: msg.id, imageBase64: base64, mime: moment.imageMime }));
      }
      return;
    }

    if (msg.type === "discover_post") {
      if (!msg.content?.trim()) return;
      const isMe = (msg.author || "me") === "me";
      const moment = addMoment(msg.author || "me", msg.content, msg.imageBase64, msg.imageMime, msg.title || "");
      broadcast(JSON.stringify({ type: "discover_new", moment }));
      // 夏彦 automatically replies to 华生's posts
      if (isMe) {
        xiayanReplyToComment(moment.id, msg.content).then((updatedMoment) => {
          if (updatedMoment) broadcast(JSON.stringify({ type: "discover_updated", moment: updatedMoment }));
        }).catch((err) => {
          console.error("[discover] 夏彦 auto-reply error:", err.message);
        });
      }
      return;
    }

    if (msg.type === "discover_like") {
      if (!msg.id) return;
      const moment = likeMoment(msg.id, msg.user || "me");
      if (moment) broadcast(JSON.stringify({ type: "discover_updated", moment }));
      return;
    }

    if (msg.type === "discover_comment") {
      if (!msg.id || !msg.content?.trim()) return;
      console.log("[discover] Comment from", msg.author || "me", "on", msg.id, ":", msg.content.slice(0, 40));
      const moment = addMomentComment(msg.id, msg.author || "me", msg.content);
      if (moment) {
        // Broadcast immediately so user sees their own comment
        ws.send(JSON.stringify({ type: "discover_updated", moment }));
        // If the comment is from the user, 夏彦 auto-replies asynchronously
        if ((msg.author || "me") === "me") {
          console.log("[discover] Triggering 夏彦 comment reply...");
          xiayanReplyToComment(msg.id, msg.content).then((updatedMoment) => {
            if (updatedMoment) {
              console.log("[discover] 夏彦 reply done, broadcasting");
              broadcast(JSON.stringify({ type: "discover_updated", moment: updatedMoment }));
            }
          }).catch((err) => {
            console.error("[discover] 夏彦 comment reply error:", err.message, err.stack);
          });
        }
      }
      return;
    }

    if (msg.type === "discover_delete_comment") {
      if (!msg.id || !msg.commentId) return;
      const moment = deleteMomentComment(msg.id, msg.commentId);
      if (moment) broadcast(JSON.stringify({ type: "discover_updated", moment }));
      return;
    }

    // ── Diary ──
    if (msg.type === "diary_get_list") {
      const dates = listDiaryDates();
      ws.send(JSON.stringify({ type: "diary_list", dates }));
      return;
    }

    if (msg.type === "diary_get") {
      const diary = loadDiary(msg.date || "");
      ws.send(JSON.stringify({ type: "diary_data", diary }));
      return;
    }

    if (msg.type === "diary_write") {
      if (!msg.content?.trim() || !msg.date) return;
      const diary = addDiaryPost(msg.date, "me", msg.title || "", msg.content, msg.images || []);
      const newPost = diary.posts[diary.posts.length - 1];
      ws.send(JSON.stringify({ type: "diary_data", diary }));
      // Generate AI reply in background
      generateAIReply(msg.date, newPost.id, msg.title, msg.content).then((updatedDiary) => {
        const replyPost = updatedDiary.posts.find((p) => p.id === newPost.id);
        if (replyPost?.replies.length) {
          const lastReply = replyPost.replies[replyPost.replies.length - 1];
          ws.send(JSON.stringify({
            type: "diary_reply",
            date: msg.date,
            post_id: newPost.id,
            content: lastReply.content,
            time: lastReply.time,
          }));
        }
      }).catch((err) => {
        console.error("[ws] Diary AI reply error:", err.message);
      });
      return;
    }

    if (msg.type === "diary_reply_write") {
      if (!msg.content?.trim() || !msg.date || !msg.post_id) return;
      const diary = addDiaryReply(msg.date, msg.post_id, "me", msg.content);
      ws.send(JSON.stringify({ type: "diary_data", diary }));
      // 夏彦 replies to 华生's comment (70% probability, avoid infinite loop)
      const lastReply = diary.posts.find((p) => p.id === msg.post_id)?.replies?.slice(-1)[0];
      if (lastReply && lastReply.author === "me" && Math.random() < 0.7) {
        generateAIReplyToComment(msg.date, msg.post_id, msg.content).then((updatedDiary) => {
          const updatedPost = updatedDiary.posts.find((p) => p.id === msg.post_id);
          if (updatedPost?.replies.length) {
            const aiReply = updatedPost.replies[updatedPost.replies.length - 1];
            if (aiReply.author === "xiayan") {
              ws.send(JSON.stringify({
                type: "diary_reply",
                date: msg.date,
                post_id: msg.post_id,
                content: aiReply.content,
                time: aiReply.time,
              }));
            }
          }
        }).catch((err) => {
          console.error("[ws] Diary AI comment reply error:", err.message);
        });
      }
      return;
    }

    if (msg.type === "sticker") {
      if (!msg.sticker_id) return;
      notifyUserActivity();
      // Broadcast sticker to partner only (NOT back to sender)
      const stickerMsg = JSON.stringify({
        type: "sticker",
        id: msg.id,
        sticker_id: msg.sticker_id,
        sticker_name: msg.sticker_name || "",
        reply_to: msg.id,
      });
      for (const [otherWs, otherState] of clients) {
        if (otherWs !== ws && otherState?.authenticated) {
          otherWs.send(stickerMsg);
        }
      }
      // Let 夏彦 see the sticker so he can react naturally with text, not echo sticker back
      try {
        const reply = await handleTextMessage(`华生发了一个表情包。不要评价这个表情包本身——不要说你发了个xx表情、这个表情好可爱之类的话。就当没看到表情包，继续聊之前的话题或者自然地开启新话题。`);
        const segments = splitIntoMessages(reply);
        sendSegments(ws, msg.id, segments);
        tryGetSceneImage(reply).then((img) => {
          if (img && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "scene_image", reply_to: msg.id, base64: img.base64, mime: img.mime, keyword: img.keyword }));
          }
        }).catch(() => {});
      } catch (err) {
        console.error("[ws] Sticker AI error:", err.message);
      }
      return;
    }

    if (msg.type === "device_data") {
      // App sends step count data
      if (msg.steps != null) {
        updateSteps(msg.steps, msg.date || null);
        ws.send(JSON.stringify({ type: "device_data_ack", ok: true }));
        console.log(`[ws] Device data received: ${msg.steps} steps`);
      }
      return;
    }

    if (msg.type === "get_decor_state") {
      // App requests current decor/theme state
      const theme = getCurrentTheme();
      ws.send(JSON.stringify({
        type: "decor_state",
        currentTheme: theme.id,
        theme,
        allThemes: getAllThemes(),
      }));
      // Also check if 夏彦 wants to redecorate right now
      tryRedecorate().then((result) => {
        if (result) {
          const update = JSON.stringify({
            type: "decor_update",
            currentTheme: result.theme.id,
            theme: result.theme,
            allThemes: getAllThemes(),
          });
          broadcast(update);
        }
      }).catch(() => {});
      return;
    }

    if (msg.type === "get_device_data") {
      ws.send(JSON.stringify({
        type: "device_state",
        ...getDeviceState(),
      }));
      return;
    }

    // ── Health data ──

    if (msg.type === "health_list_dates") {
      ws.send(JSON.stringify({
        type: "health_dates",
        dates: listHealthDates(),
      }));
      return;
    }

    if (msg.type === "health_get") {
      const date = msg.date || todayStr();
      const data = getHealthForDate(date);
      ws.send(JSON.stringify({
        type: "health_data",
        date,
        data,
      }));
      return;
    }

    if (msg.type === "health_get_range") {
      const items = getHealthRange(msg.from, msg.to);
      ws.send(JSON.stringify({
        type: "health_range",
        from: msg.from,
        to: msg.to,
        items,
      }));
      return;
    }

    if (msg.type === "health_get_summary") {
      const date = msg.date || todayStr();
      let summaryData = getHealthSummary(date);
      if (!summaryData) {
        // Try to generate
        const summary = await generateDailySummary(date);
        summaryData = summary ? { date, summary, version: 1 } : null;
      }
      ws.send(JSON.stringify({
        type: "health_summary",
        date,
        summary: summaryData?.summary || null,
        cached: !!getHealthSummary(date),
      }));
      return;
    }

    if (msg.type === "health_import") {
      if (!msg.date || !msg.metrics) {
        ws.send(JSON.stringify({ type: "health_import_result", error: "date and metrics required" }));
        return;
      }
      const result = importHealthData(msg.date, msg.metrics, "ws");
      ws.send(JSON.stringify({ type: "health_import_result", ...result }));

      if (result.updated) {
        generateDailySummary(msg.date).then((summary) => {
          if (summary) {
            broadcast(JSON.stringify({
              type: "health_updated",
              date: msg.date,
              summary,
              metrics: msg.metrics,
            }));
          }
        }).catch(() => {});
      }
      return;
    }

    // ── Date plans ──
    if (msg.type === "date_plans_get_all") {
      const all = getAll();
      const active = getActive();
      ws.send(JSON.stringify({ type: "date_plans", plans: all, activeDate: active }));
      return;
    }

    if (msg.type === "date_plans_get_history") {
      const history = getHistory();
      ws.send(JSON.stringify({ type: "date_plans_history", plans: history }));
      return;
    }

    if (msg.type === "date_plan_propose") {
      if (!msg.text?.trim()) return;
      const plan = proposeDate({
        text: msg.text,
        proposedBy: "me",
        scheduledDate: msg.scheduledDate || null,
        scheduledTime: msg.scheduledTime || null,
      });
      ws.send(JSON.stringify({ type: "date_plan_created", plan }));
      broadcast(JSON.stringify({ type: "date_plan_created", plan }));
      return;
    }

    if (msg.type === "date_plan_complete") {
      if (!msg.id) return;
      const plan = completeDate(msg.id);
      if (plan) {
        ws.send(JSON.stringify({ type: "date_plan_updated", plan }));
        broadcast(JSON.stringify({ type: "date_plan_updated", plan, dateActive: null }));
      }
      return;
    }

    if (msg.type === "date_plan_cancel") {
      if (!msg.id) return;
      const plan = cancelDate(msg.id);
      if (plan) {
        ws.send(JSON.stringify({ type: "date_plan_updated", plan }));
      }
      return;
    }

    if (msg.type === "answer_call") {
      console.log(`[phone-call] Answered: ${msg.callId || "unknown"}`);
      return;
    }

    if (msg.type === "decline_call") {
      console.log(`[phone-call] Declined: ${msg.callId || "unknown"}`);
      // Server may trigger a follow-up "missed call" message in travel chat
      return;
    }

    // ── 向哨无限流 ──
    if (msg.type?.startsWith("sentinel_guide")) {
      console.log("[ws] SG message:", msg.type, msg.actionText ? "action:" + msg.actionText.slice(0, 40) : "", msg.worldDescription ? "world:" + msg.worldDescription : "");
    }
    if (msg.type === "sentinel_guide_start") {
      try {
        notifyUserActivity();
        const result = await startSession();
        ws.send(JSON.stringify({ type: "sentinel_guide_started", ...result }));
      } catch (err) {
        console.error("[ws] SG start error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_action") {
      if (!msg.actionText?.trim()) return;
      try {
        notifyUserActivity();
        const result = await playerAction(msg.actionText);
        if (result.error) {
          ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error }));
        } else {
          ws.send(JSON.stringify({ type: "sentinel_guide_reply", ...result }));
        }
      } catch (err) {
        console.error("[ws] SG action error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_doors") {
      try {
        const result = await generateDoors(msg.terrorLevel);
        if (result.error) {
          ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error }));
        } else {
          ws.send(JSON.stringify({ type: "sentinel_guide_reply", ...result }));
        }
      } catch (err) {
        console.error("[ws] SG doors error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_select_world") {
      if (!msg.worldDescription) return;
      try {
        const result = await selectWorld(msg.worldDescription);
        if (result.error) {
          ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error }));
        } else {
          ws.send(JSON.stringify({ type: "sentinel_guide_reply", ...result }));
        }
      } catch (err) {
        console.error("[ws] SG select error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_clear_world") {
      try {
        const result = await clearWorld(msg.points);
        ws.send(JSON.stringify({ type: "sentinel_guide_cleared", ...result }));
      } catch (err) {
        console.error("[ws] SG clear error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_continue") {
      try {
        const result = await continueToNext();
        if (result.error) {
          ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error }));
        } else {
          ws.send(JSON.stringify({ type: "sentinel_guide_reply", ...result }));
        }
      } catch (err) {
        console.error("[ws] SG continue error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_rewind") {
      if (msg.turnIndex == null || !msg.actionText?.trim()) {
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: "Missing turnIndex or actionText" }));
        return;
      }
      try {
        notifyUserActivity();
        const result = await rewindToTurn(msg.turnIndex, msg.actionText);
        if (result.error) {
          ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error }));
        } else {
          ws.send(JSON.stringify({ type: "sentinel_guide_reply", ...result }));
        }
      } catch (err) {
        console.error("[ws] SG rewind error:", err.message);
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: err.message }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_update") {
      const state = refreshState(msg.state);
      ws.send(JSON.stringify({ type: "sentinel_guide_state", state }));
      return;
    }

    if (msg.type === "sentinel_guide_history") {
      const sessions = listSessions();
      ws.send(JSON.stringify({ type: "sentinel_guide_history_list", sessions }));
      return;
    }

    // ── Inventory operations ──
    if (msg.type === "sentinel_guide_add_item") {
      const result = addItem(msg.item);
      ws.send(JSON.stringify({ type: "sentinel_guide_item_added", ...result }));
      return;
    }

    if (msg.type === "sentinel_guide_give_item") {
      const result = giveItemToXiayan(msg.itemId);
      ws.send(JSON.stringify({ type: "sentinel_guide_item_given", ...result }));
      return;
    }

    if (msg.type === "sentinel_guide_use_item") {
      const result = useXiayanItem(msg.itemId, msg.worldName);
      ws.send(JSON.stringify({ type: "sentinel_guide_item_used", ...result }));
      return;
    }

    if (msg.type === "sentinel_guide_remove_item") {
      const result = removeItem(msg.itemId);
      ws.send(JSON.stringify({ type: "sentinel_guide_item_removed", ...result }));
      return;
    }

    if (msg.type === "sentinel_guide_equip_item") {
      const result = toggleEquipItem(msg.itemId);
      ws.send(JSON.stringify({ type: "sentinel_guide_item_equipped", ...result }));
      return;
    }

    if (msg.type === "sentinel_guide_load") {
      if (!msg.sessionId) return;
      const session = loadSession(msg.sessionId);
      if (session) {
        ws.send(JSON.stringify({ type: "sentinel_guide_loaded", session }));
      } else {
        ws.send(JSON.stringify({ type: "sentinel_guide_error", message: "Session not found" }));
      }
      return;
    }

    if (msg.type === "sentinel_guide_delete") {
      if (!msg.sessionId) return;
      deleteSession(msg.sessionId);
      const sessions = listSessions();
      ws.send(JSON.stringify({ type: "sentinel_guide_deleted", sessionId: msg.sessionId, sessions }));
      return;
    }

    // ═══ Shop & Warehouse ═══

    if (msg.type === "sentinel_guide_get_shop") {
      const catalog = getShopItems().length > 0 ? getShopItems() : generateDynamicShop();
      const state = getPublicState();
      ws.send(JSON.stringify({ type: "sentinel_guide_shop", catalog, points: state?.points || 0, warehouse: state?.warehouse || [] }));
      return;
    }

    if (msg.type === "sentinel_guide_purchase") {
      if (!msg.shopItemId) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: "Missing shopItemId" })); return; }
      const result = purchaseItem(msg.shopItemId);
      if (result.error) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error })); return; }
      const state = getPublicState();
      ws.send(JSON.stringify({ type: "sentinel_guide_purchased", item: result.item, points: result.points, warehouse: result.warehouse || state?.warehouse || [] }));
      return;
    }

    if (msg.type === "sentinel_guide_withdraw") {
      if (!msg.warehouseItemId) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: "Missing warehouseItemId" })); return; }
      const result = withdrawFromWarehouse(msg.warehouseItemId);
      if (result.error) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error })); return; }
      ws.send(JSON.stringify({ type: "sentinel_guide_withdrawn", item: result.item, inventory: result.inventory, warehouse: result.warehouse }));
      return;
    }

    if (msg.type === "sentinel_guide_use_warehouse") {
      if (!msg.warehouseItemId) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: "Missing warehouseItemId" })); return; }
      const result = useWarehouseItem(msg.warehouseItemId);
      if (result.error) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error })); return; }
      ws.send(JSON.stringify({ type: "sentinel_guide_warehouse_used", item: result.item, warehouse: result.warehouse, state: result.state }));
      return;
    }

    if (msg.type === "sentinel_guide_deposit") {
      if (!msg.inventoryItemId) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: "Missing inventoryItemId" })); return; }
      const result = depositToWarehouse(msg.inventoryItemId);
      if (result.error) { ws.send(JSON.stringify({ type: "sentinel_guide_error", message: result.error })); return; }
      ws.send(JSON.stringify({ type: "sentinel_guide_deposited", item: result.item, inventory: result.inventory, warehouse: result.warehouse }));
      return;
    }

    ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${msg.type}` }));
  });

  ws.on("close", () => {
    console.log(`[ws] Disconnected: ${ip}`);
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error: ${ip} - ${err.message}`);
    clients.delete(ws);
  });
});

// ── Start ──
// ── Travel system periodic check ──
// Check every 3 hours: maybe trigger new travel, handle day transitions
// ── 夏彦 proactive pet care ──
// Every 30-90 minutes, 夏彦 randomly interacts with 花生
let xiayanPetTimer = null;

function scheduleXiayanPetCare() {
  if (xiayanPetTimer) clearTimeout(xiayanPetTimer);
  // Random interval between 30-90 minutes
  const delay = (30 + Math.random() * 60) * 60 * 1000;
  xiayanPetTimer = setTimeout(() => {
    try {
      // 夏彦在外旅行且花生没跟着时，不能和花生互动
      const travelState = getTravelState();
      const petState = getPetState();
      if (travelState.phase === "traveling" && !petState.accompanyingXiayan) {
        console.log("[pet] Skipping proactive care — 夏彦在外旅行，花生在家");
      } else {
        const result = xiayanProactiveInteract();
        broadcast(JSON.stringify({ type: "pet_state", pet: result.pet, reaction: result.pet.reaction }));
        broadcast(JSON.stringify({
          type: "pet_log",
          id: result.log.id,
          actor: "xiayan",
          action: result.log.action,
          reaction: result.log.reaction,
          timestamp: result.log.timestamp,
        }));
      }
    } catch (e) { console.error("[pet] proactive care error:", e.message); }
    scheduleXiayanPetCare(); // schedule next
  }, delay);
}
scheduleXiayanPetCare();

let travelAnnounceSent = false;

async function sendTravelAnnouncement(triggered) {
  const msg = triggered.detail.length > 80
    ? `宝宝，我这边临时有事——${triggered.reason}，要去${triggered.destination === "保密地点" ? "几天" : "两三天"}。到了给你发消息，在家好好的哦～记得想我！`
    : triggered.detail;
  const segments = splitIntoMessages(msg);
  const replyTo = `travel_${Date.now()}`;
  for (const [ws, wsState] of clients) {
    if (wsState.authenticated && ws.readyState === 1) {
      for (let i = 0; i < segments.length; i++) {
        const delay = i * (6000 + Math.random() * 8000);
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "text_reply",
              reply_to: `${replyTo}_${i}`,
              content: segments[i],
              proactive: true,
            }));
          }
        }, delay);
      }
    }
  }
  console.log(`[travel] Announcement sent: "${msg.slice(0, 60)}..."`);
}

function sendTravelDepartureNotice() {
  const travel = getTravelState();
  const msg = `宝宝，我出发啦。${travel.reason === "国安任务" ? "任务期间可能回复不太及时，有空就给你发消息" : "到了给你发消息"}。记得想我，照顾好自己～`;
  const segments = splitIntoMessages(msg);
  const replyTo = `travel_depart_${Date.now()}`;
  for (const [ws, wsState] of clients) {
    if (wsState.authenticated && ws.readyState === 1) {
      for (let i = 0; i < segments.length; i++) {
        const delay = i * (6000 + Math.random() * 8000);
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "text_reply",
              reply_to: `${replyTo}_${i}`,
              content: segments[i],
              proactive: true,
            }));
          }
        }, delay);
      }
    }
  }
  console.log("[travel] Departure notice sent");

  // 30% chance 花生 accompanies 夏彦
  if (Math.random() < 0.3) {
    const accResult = accompanyXiayan();
    if (accResult) {
      broadcast(JSON.stringify({ type: "pet_state", pet: accResult }));
      broadcast(JSON.stringify({
        type: "pet_log",
        id: accResult.log.id,
        actor: "xiayan",
        action: "accompany",
        reaction: accResult.log.reaction,
        timestamp: accResult.log.timestamp,
      }));
      console.log("[pet] 花生 accompanies 夏彦 on mission");
    }
  }
}

function travelPeriodicCheck() {
  const prevPhase = getTravelState().phase;
  checkDayTransition();
  const newPhase = getTravelState().phase;

  // Broadcast travel state when phase changes
  if (prevPhase !== newPhase) {
    broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
    console.log(`[travel] Phase transition: ${prevPhase} → ${newPhase}`);
  }

  const travel = getTravelState();
  // When travel activates (traveling phase starts), send departure notice
  if (travel.phase === "traveling" && !travelAnnounceSent) {
    travelAnnounceSent = true;
    sendTravelDepartureNotice();
  }
  // Reset when idle
  if (travel.phase === "idle") {
    travelAnnounceSent = false;
    // If 花生 was with 夏彦, bring it back
    const retResult = returnFromAccompany();
    if (retResult) {
      broadcast(JSON.stringify({ type: "pet_state", pet: retResult }));
      broadcast(JSON.stringify({
        type: "pet_log",
        id: retResult.log.id,
        actor: "xiayan",
        action: "return_with_pet",
        reaction: retResult.log.reaction,
        timestamp: retResult.log.timestamp,
      }));
      console.log("[pet] 花生 returns from mission with 夏彦");
    }
  }

  // Skip travel trigger if user was recently active — don't interrupt conversations
  const proactiveState = getProactiveState();
  const lastActivity = proactiveState._lastUserReplyTime || 0;
  const userActiveRecently = (Date.now() - lastActivity) < 30 * 60 * 1000;
  if (userActiveRecently) {
    console.log("[travel] Skipping trigger — user was active recently (<30min)");
    return;
  }

  const triggered = maybeTriggerTravel();
  if (triggered) {
    console.log(`[travel] New travel triggered: ${triggered.reason} → ${triggered.destination}`);
    broadcast(JSON.stringify({ type: "travel_state", xiayan: getTravelState(), huasheng: getHuashengTravelState() }));
    travelAnnounceSent = false;
    sendTravelAnnouncement(triggered);
  }
}
travelPeriodicCheck(); // Run on startup
setInterval(travelPeriodicCheck, 3 * 60 * 60 * 1000);

// ── Couple travel day auto-advance (every 15 min) ──
function coupleTravelPeriodicCheck() {
  if (!isCoupleTraveling()) return;
  const prevDay = getCoupleTravelState().currentDay;
  maybeAutoAdvanceDay();
  const newState = getCoupleTravelState();
  if (prevDay !== newState.currentDay || newState.phase === "completed") {
    broadcast(JSON.stringify({ type: "couple_travel_state", trip: newState }));
    console.log(`[couple-travel] State updated: day=${newState.currentDay} phase=${newState.phase}`);
  }
}
coupleTravelPeriodicCheck(); // Run on startup
setInterval(coupleTravelPeriodicCheck, 15 * 60 * 1000);

// ── Proactive scenery during travel (every 60-90 min) ──
async function proactiveSceneryCheck() {
  try {
    const scenery = await tryProactiveScenery();
    if (scenery) {
      const replyTo = `proactive_scenery_${Date.now()}`;
      broadcast(JSON.stringify({
        type: "scenery_photo",
        caption: scenery.caption,
        destination: scenery.destination,
        image_base64: scenery.imageBase64,
        reply_to: replyTo,
        proactive: true,
      }));
      console.log(`[scenery] Proactive photo sent: ${scenery.caption}`);
    }
  } catch (err) {
    console.error("[scenery] Proactive error:", err.message);
  }
  // Schedule next check: 60-90 min
  const nextDelay = (60 + Math.random() * 30) * 60 * 1000;
  setTimeout(proactiveSceneryCheck, nextDelay);
}
// Start the proactive scenery loop after a short initial delay
setTimeout(proactiveSceneryCheck, 5 * 60 * 1000);

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err.message, err.stack);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});

console.log("[our-space] Starting...");
console.log("[our-space] PORT env:", process.env.PORT);
console.log("[our-space] DATA_DIR env:", process.env.DATA_DIR);

server.listen(config.PORT, config.HOST, () => {
  console.log(`[our-space] Bridge server on http://${config.HOST}:${config.PORT}`);
  console.log(`[our-space] WebSocket on ws://${config.HOST}:${config.PORT}`);
  console.log(`[our-space] Shared secret: ${config.SHARED_SECRET === "our-space-default-secret-change-me" ? "⚠ USING DEFAULT (change via OUR_SPACE_SECRET env)" : "✓ configured"}`);
});
// force redeploy 1780136314
