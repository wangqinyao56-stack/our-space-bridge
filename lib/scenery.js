/**
 * Travel + scenery system for our-space bridge.
 * Probability-triggered travel with state machine:
 *   idle → announcing (夏彦 tells 华生) → traveling (2-3 days) → returning (夏彦 sends return msg) → idle
 * Scenery photos are sent during travel phase.
 */
import fs from "node:fs";
import path from "node:path";
import { askJiushi } from "./ai.js";
import { generateImage } from "./flux.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const TRAVEL_STATE_FILE = path.join(DATA_DIR, "travel-state.json");
const SCENERY_LOG = path.join(DATA_DIR, "scenery-log.json");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── Travel reasons — ALL are out-of-town (不在未名市) ──
// Known cities: 首都, 枝冬市, 芳平市, 诺克拉文市, 昭南市, 深港市
// statusText is what shows on the home screen status bar during travel
const TRAVEL_REASONS = [
  { statusText: "处理古物委托", destination: "芳平市", detail: "有一批文物需要修复，请我去芳平市的博物馆指导一下，要出趟远门", showDest: true },
  { statusText: "处理古物委托", destination: "昭南市", detail: "昭南市那边出土了一批文物，让我过去帮忙鉴定，得去几天", showDest: true },
  { statusText: "执行国安任务", destination: "保密地点", detail: "有个秘密任务需要我过去处理一下，具体地点不方便说，不在未名市，大概两三天", showDest: false },
  { statusText: "执行国安任务", destination: "保密地点", detail: "总部临时召集，得去开个紧急会议，地点保密，不在未名市，三四天左右", showDest: false },
  { statusText: "执行国安任务", destination: "保密地点", detail: "有个证人需要护送转移，具体地点保密，顺利的话两天就回来", showDest: false },
  { statusText: "处理侦探委托", destination: "枝冬市", detail: "有个委托人找我帮忙查一个跨市的案子，得去枝冬市几天", showDest: true },
  { statusText: "处理侦探委托", destination: "深港市", detail: "深港市那边的同行请我去协助分析一批案件数据，大概两三天", showDest: true },
  { statusText: "赛车旅行", destination: "诺克拉文市", detail: "诺克拉文市有个赛车活动，好久没飙了，去跑两圈放松一下", showDest: true },
  { statusText: "赛车旅行", destination: "首都", detail: "首都那边有个改装车展，想去看看，顺便试几台新车，两三天就回来", showDest: true },
  { statusText: "朋友相约", destination: "诺克拉文市", detail: "以前一起训练的几个兄弟说要聚一聚，在诺克拉文市，好久没见了", showDest: true },
  { statusText: "朋友相约", destination: "首都", detail: "之前一起做项目的朋友发来邀请，让我去首都参加一个交流会，正好见见老朋友", showDest: true },
  { statusText: "朋友相约", destination: "枝冬市", detail: "枝冬市那边的老同学约我过去玩两天，好久没见他了，正好休息一下", showDest: true },
];

// ── Scenery themes ──
const SCENERY_THEMES = [
  "Golden sunset over a calm ocean, soft waves, warm orange and pink sky, photorealistic, travel photography style",
  "Mountain peak view above clouds at sunrise, golden light, photorealistic landscape, travel photography",
  "Quiet ancient town alley at dusk, warm lantern light, cobblestone path, photorealistic street photography",
  "Cherry blossom trees in full bloom along a riverside path, soft pink petals falling, photorealistic spring scenery",
  "Starry night sky over a quiet campsite with a tent, campfire glow, milky way visible, photorealistic",
  "Snow-capped mountain reflected in a crystal-clear alpine lake, crisp blue sky, photorealistic",
  "Lush green forest path with sunlight streaming through trees, magical atmosphere, photorealistic nature photography",
  "City skyline at blue hour, lights starting to twinkle, modern architecture, photorealistic cityscape",
  "Traditional Japanese garden with koi pond, autumn maple leaves, peaceful zen atmosphere, photorealistic",
  "Seaside cliff with lighthouse in the distance, dramatic clouds, waves crashing below, photorealistic",
  "Rainy evening in a European old town, wet cobblestones reflecting street lamps, photorealistic mood photography",
  "Desert landscape at golden hour, dramatic sand dunes, warm amber tones, photorealistic travel shot",
  "Northern lights dancing over a snow-covered cabin, green and purple aurora, photorealistic night photography",
  "Tropical beach with crystal turquoise water, white sand, palm trees swaying, photorealistic paradise",
  "Foggy morning over rolling hills with a single tree silhouette, misty atmosphere, photorealistic",
];

// ── Travel state ──
const PHASES = { IDLE: "idle", ANNOUNCING: "announcing", TRAVELING: "traveling", RETURNING: "returning" };

let travelState = {
  active: false,
  phase: PHASES.IDLE,
  destination: "",
  statusText: "",
  reason: "",
  detail: "",
  showDest: true,
  since: null,
  until: null,
  announcedAt: null,
  returnMessageSent: false,
  lastPhoto: null,
  lastProactivePhoto: null,
  lastTravelEnd: null,
};

try {
  if (fs.existsSync(TRAVEL_STATE_FILE)) {
    travelState = JSON.parse(fs.readFileSync(TRAVEL_STATE_FILE, "utf-8"));
    console.log(`[travel] Loaded state: phase=${travelState.phase} dest=${travelState.destination || "?"}`);
    // Auto-reset stuck RETURNING state (shouldn't last > 1 hour)
    if (travelState.phase === PHASES.RETURNING && travelState.since) {
      const hoursStuck = (Date.now() - new Date(travelState.since).getTime()) / 3600000;
      if (hoursStuck > 1) {
        console.log(`[travel] Auto-resetting stuck RETURNING state (${hoursStuck.toFixed(1)}h)`);
        travelState = { active: false, phase: PHASES.IDLE, destination: "", statusText: "", reason: "", detail: "", showDest: true, since: null, until: null, announcedAt: null, returnMessageSent: false, lastPhoto: null, lastProactivePhoto: null, lastTravelEnd: new Date().toISOString() };
        saveTravelState();
      }
    }
  }
} catch {}

function saveTravelState() {
  try { fs.writeFileSync(TRAVEL_STATE_FILE, JSON.stringify(travelState), "utf-8"); } catch {}
}

// ── Scenery history ──
let sceneryHistory = [];
try {
  if (fs.existsSync(SCENERY_LOG)) {
    sceneryHistory = JSON.parse(fs.readFileSync(SCENERY_LOG, "utf-8"));
  }
} catch {}

function saveSceneryLog() {
  try { fs.writeFileSync(SCENERY_LOG, JSON.stringify(sceneryHistory), "utf-8"); } catch {}
}

// ── State machine ──

export function isTraveling() {
  // Only true during active travel, NOT during returning phase (he's back)
  return travelState.phase === PHASES.TRAVELING;
}

export function getTravelState() {
  return { ...travelState };
}

export function getTravelPhase() {
  return travelState.phase;
}

/**
 * Check if we should trigger a new travel announcement.
 * Called periodically (e.g. every few hours).
 * Returns the travel reason info if triggered, null otherwise.
 */
export function maybeTriggerTravel() {
  if (travelState.phase !== PHASES.IDLE) return null;

  // Cooldown: at least 5 days since last travel ended
  if (travelState.lastTravelEnd) {
    const daysSince = (Date.now() - new Date(travelState.lastTravelEnd).getTime()) / 86400000;
    if (daysSince < 5) return null;
  }

  // 12% chance per check (checked ~4x/day, so ~40% daily chance)
  if (Math.random() > 0.12) return null;

  const picked = TRAVEL_REASONS[Math.floor(Math.random() * TRAVEL_REASONS.length)];

  travelState.phase = PHASES.ANNOUNCING;
  travelState.statusText = picked.statusText || picked.reason || "外出任务中";
  travelState.destination = picked.showDest !== false ? picked.destination : "";
  travelState.reason = picked.reason;
  travelState.detail = picked.detail;
  travelState.showDest = picked.showDest !== false;
  travelState.announcedAt = null;
  travelState.active = false;
  travelState.returnMessageSent = false;
  saveTravelState();

  console.log(`[travel] Triggered: ${picked.reason} → ${picked.destination}`);
  return picked;
}

/**
 * Called after 夏彦 has announced travel in chat.
 * Traveling phase starts the next day.
 */
export function confirmAnnounced() {
  if (travelState.phase !== PHASES.ANNOUNCING) return;
  travelState.announcedAt = new Date().toISOString();
  saveTravelState();
  console.log("[travel] Announcement confirmed, will activate tomorrow");
}

/**
 * Activate traveling phase. Called by checkDayTransition.
 */
function activateTravel() {
  travelState.phase = PHASES.TRAVELING;
  travelState.active = true;
  travelState.since = new Date().toISOString();

  // Duration: 2-3 days
  const days = 2 + Math.floor(Math.random() * 2);
  const until = new Date();
  until.setDate(until.getDate() + days);
  // End between 18:00-20:00 Beijing time (UTC+8)
  const endHour = 18 + Math.floor(Math.random() * 3);
  const endMinute = Math.floor(Math.random() * 60);
  until.setHours(endHour - 8, endMinute, 0, 0); // Convert BJT to UTC
  travelState.until = until.toISOString();

  saveTravelState();
  console.log(`[travel] Activated! Until ${until.toISOString()} (${days} days, ends ~${endHour}:${String(endMinute).padStart(2,"0")} BJT)`);
}

/**
 * Transition to returning phase — 夏彦 sends return message in next chat.
 */
function activateReturning() {
  travelState.phase = PHASES.RETURNING;
  travelState.returnMessageSent = false;
  travelState.returnedAt = new Date().toISOString();
  saveTravelState();
  console.log("[travel] Returning phase — waiting for return message in chat");
}

/**
 * Called after 夏彦 has sent the return message.
 */
export function confirmReturned() {
  travelState.lastTravelEnd = new Date().toISOString();
  travelState.phase = PHASES.IDLE;
  travelState.active = false;
  travelState.statusText = "";
  travelState.destination = "";
  travelState.reason = "";
  travelState.detail = "";
  travelState.since = null;
  travelState.until = null;
  travelState.announcedAt = null;
  travelState.returnMessageSent = false;
  travelState.lastPhoto = null;
  saveTravelState();
  console.log("[travel] Return confirmed — back to idle");
}

/**
 * Daily transition check — called periodically.
 * Handles: announcing→traveling (next day), traveling→returning (time reached)
 */
export function checkDayTransition() {
  const now = new Date();

  // announcing → traveling: check if it's the next day after announcement
  if (travelState.phase === PHASES.ANNOUNCING && travelState.announcedAt) {
    const announced = new Date(travelState.announcedAt);
    const announcedDay = new Date(announced.getFullYear(), announced.getMonth(), announced.getDate()).getTime();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (todayStart > announcedDay) {
      activateTravel();
    }
  }

  // traveling → returning: check if end time has passed
  if (travelState.phase === PHASES.TRAVELING && travelState.until) {
    if (now >= new Date(travelState.until)) {
      activateReturning();
    }
  }

  // returning → idle: auto-reset after 3 hours
  if (travelState.phase === PHASES.RETURNING && travelState.returnedAt) {
    const hoursSinceReturn = (now - new Date(travelState.returnedAt).getTime()) / 3600000;
    if (hoursSinceReturn > 3) {
      console.log(`[travel] Auto-reset RETURNING after ${hoursSinceReturn.toFixed(1)}h`);
      confirmReturned();
    }
  }
}

// ── Chat context injection ──

/**
 * Get the travel context block for chat system prompt.
 */
export function getTravelChatContext() {
  if (travelState.phase === PHASES.ANNOUNCING) {
    if (!travelState.announcedAt) {
      return {
        injection: `\n【出行通知——必须执行】你需要在这轮对话中自然地告诉华生你要出远门，离开未名市。目的地：${travelState.destination}。原因：${travelState.reason}。具体说法：${travelState.detail}。要自然——不是宣布任务，是跟老婆说一声你要去外地几天，不在未名市。可以说你会想她、会给她带礼物、提醒她照顾好自己。说完后对话照常继续即可。`,
        markAnnounced: true,
      };
    }
    return {
      injection: `\n【出行提醒】你已经告诉华生你要出门了（${travelState.reason}），明天出发。如果她提起这事就自然聊聊，没提起也不用刻意提。`,
      markAnnounced: false,
    };
  }

  // TRAVELING phase: handled by standalone system-prompt-travel.md
  // No injection needed — the entire prompt is travel-mode

  if (travelState.phase === PHASES.RETURNING) {
    return {
      injection: `\n【你回来了——必须执行】你已经回到家了！在这轮对话中要自然地告诉华生你回来了。可以说类似"我回来了！呼！还是家里好啊！"或者"任务结束啦！老婆让我抱抱~累死我了..."。语气开心、撒娇、想她了。说完后对话照常继续。`,
      markAnnounced: false,
      markReturned: true,
    };
  }

  return null;
}

/**
 * Get travel context for intimate space (phone sex mode).
 */
export function getTravelIntimateContext() {
  // Travel intimate mode is now handled by standalone system-prompt-travel-intimate.md
  // No injection needed — the entire prompt is travel-phone-sex mode
  return null;
}

// ── Scenery photos (during travel) ──

export async function tryTriggerScenery(probability = 0.08) {
  if (travelState.phase !== PHASES.TRAVELING) return null;
  if (Math.random() > probability) return null;

  if (travelState.lastPhoto) {
    const elapsed = Date.now() - new Date(travelState.lastPhoto).getTime();
    if (elapsed < 30 * 60 * 1000) return null;
  }

  console.log(`[scenery] Triggering photo from ${travelState.destination || "travel"}...`);

  const recentThemes = new Set(sceneryHistory.slice(-5).map((s) => s.theme));
  const available = SCENERY_THEMES.filter((t) => !recentThemes.has(t));
  const theme = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : SCENERY_THEMES[Math.floor(Math.random() * SCENERY_THEMES.length)];

  const destStr = travelState.destination ? `在${travelState.destination}，` : "";
  const caption = await generateCaption(destStr, theme);

  const prompt = `${theme}, high resolution, no people, natural lighting, professional travel photography`;
  const image = await generateImage(prompt, { width: 1024, height: 768, model: "flux-2-pro" });

  travelState.lastPhoto = new Date().toISOString();
  saveTravelState();

  sceneryHistory.push({ theme, date: travelState.lastPhoto });
  if (sceneryHistory.length > 100) sceneryHistory = sceneryHistory.slice(-100);
  saveSceneryLog();

  return {
    caption,
    imageBase64: image.base64,
    destination: travelState.destination || "远方",
  };
}

async function generateCaption(destStr, theme) {
  try {
    const reply = await askJiushi({
      systemPrompt: "你是夏彦，正在外出旅行/执行任务。看到美丽的风景，想发一张照片给华生（你的恋人）。用撒娇温柔的语气写一句话分享（20字以内）。只回复这句话。",
      userContent: `${destStr}看到了这样的风景：${theme.slice(0, 80)}`,
maxTokens: 80,
      temperature: 0.9,
    });
    return reply.trim();
  } catch {
    return `${destStr}华生你看，这里的风景好美～`;
  }
}

/**
 * Proactive scenery — called periodically during travel (not in response to user messages).
 * Longer cooldown than reactive photos (2-3 hours vs 30 min).
 * Returns scenery object or null.
 */
export async function tryProactiveScenery() {
  if (travelState.phase !== PHASES.TRAVELING) return null;

  // Cooldown: at least 2 hours between proactive photos
  if (travelState.lastProactivePhoto) {
    const elapsed = Date.now() - new Date(travelState.lastProactivePhoto).getTime();
    if (elapsed < 2 * 60 * 60 * 1000) return null;
  }

  // Also respect the general photo cooldown (don't send if a reactive one just went out)
  if (travelState.lastPhoto) {
    const elapsed = Date.now() - new Date(travelState.lastPhoto).getTime();
    if (elapsed < 15 * 60 * 1000) return null;
  }

  // 60% chance per check (checked every ~3h, so ~2-3 photos per day of travel)
  if (Math.random() > 0.6) return null;

  console.log(`[scenery] Proactive photo from ${travelState.destination || "travel"}...`);

  const recentThemes = new Set(sceneryHistory.slice(-5).map((s) => s.theme));
  const available = SCENERY_THEMES.filter((t) => !recentThemes.has(t));
  const theme = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : SCENERY_THEMES[Math.floor(Math.random() * SCENERY_THEMES.length)];

  const destStr = travelState.destination ? `在${travelState.destination}，` : "";
  const caption = await generateCaption(destStr, theme);

  const prompt = `${theme}, high resolution, no people, natural lighting, professional travel photography`;
  const image = await generateImage(prompt, { width: 1024, height: 768, model: "flux-2-pro" });

  const now = new Date().toISOString();
  travelState.lastPhoto = now;
  travelState.lastProactivePhoto = now;
  saveTravelState();

  sceneryHistory.push({ theme, date: now });
  if (sceneryHistory.length > 100) sceneryHistory = sceneryHistory.slice(-100);
  saveSceneryLog();

  return {
    caption,
    imageBase64: image.base64,
    destination: travelState.destination || "远方",
    proactive: true,
  };
}

// ── Legacy compatibility ──

export async function checkTravelState(_userMessage, _botReply) {
  // Legacy function — no longer keyword-based. State machine handles all transitions.
  // Still export for backward compatibility.
  checkDayTransition();
}
