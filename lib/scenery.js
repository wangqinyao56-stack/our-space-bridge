/**
 * Travel + scenery system for our-space bridge.
 * Probability-triggered travel with state machine:
 *   idle → announcing (夏彦 tells 华生) → traveling (2-3 days) → returning (夏彦 sends return msg) → idle
 * Scenery photos are sent during travel phase.
 */
import fs from "node:fs";
import path from "node:path";
import { askDeepSeek } from "./ai.js";
import { generateImage } from "./flux.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const TRAVEL_STATE_FILE = path.join(DATA_DIR, "travel-state.json");
const SCENERY_LOG = path.join(DATA_DIR, "scenery-log.json");

// ── Travel reasons — ALL are out-of-town (不在未名市), destination is always another city/province ──
const TRAVEL_REASONS = [
  { reason: "国安任务", destination: "首都", detail: "有个任务需要我去首都那边处理一下，不在未名市，大概两三天" },
  { reason: "国安紧急会议", destination: "西北基地", detail: "总部临时召集，得去西北基地一趟，不在未名市，三四天左右" },
  { reason: "委托人案件", destination: "临市", detail: "有个委托人找我帮忙查一个跨市的案子，得去临市几天" },
  { reason: "生物工程论坛", destination: "首都学术中心", detail: "之前参加的生物工程论坛发了邀请函，让我去首都做个分享，不在未名市" },
  { reason: "古董修复委托", destination: "南方博物馆", detail: "有一批文物需要修复，请我去南方的博物馆指导一下，要出趟远门" },
  { reason: "老友聚会", destination: "隔壁省", detail: "以前一起训练的几个兄弟说要聚一聚，在隔壁省，好久没见了" },
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
  reason: "",
  detail: "",
  since: null,
  until: null,
  announcedAt: null,
  returnMessageSent: false,
  lastPhoto: null,
  lastTravelEnd: null,
};

try {
  if (fs.existsSync(TRAVEL_STATE_FILE)) {
    travelState = JSON.parse(fs.readFileSync(TRAVEL_STATE_FILE, "utf-8"));
    console.log(`[travel] Loaded state: phase=${travelState.phase} dest=${travelState.destination || "?"}`);
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
  return travelState.phase === PHASES.TRAVELING || travelState.active;
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
  travelState.destination = picked.destination;
  travelState.reason = picked.reason;
  travelState.detail = picked.detail;
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
}

// ── Chat context injection ──

/**
 * Get the travel context block for chat system prompt.
 */
export function getTravelChatContext() {
  if (travelState.phase === PHASES.ANNOUNCING) {
    if (!travelState.announcedAt) {
      // 夏彦 needs to announce in this conversation
      return {
        injection: `\n【出行通知——必须执行】你需要在这轮对话中自然地告诉华生你要出远门，离开未名市。目的地：${travelState.destination}。原因：${travelState.reason}。具体说法：${travelState.detail}。要自然——不是宣布任务，是跟老婆说一声你要去外地几天，不在未名市。可以说你会想她、会给她带礼物、提醒她照顾好自己。说完后对话照常继续即可。`,
        markAnnounced: true,
      };
    }
    // Already announced, waiting for tomorrow
    return {
      injection: `\n【出行提醒】你已经告诉华生你要出门了（${travelState.reason}），明天出发。如果她提起这事就自然聊聊，没提起也不用刻意提。`,
      markAnnounced: false,
    };
  }

  if (travelState.phase === PHASES.TRAVELING) {
    const until = travelState.until ? new Date(travelState.until) : null;
    const daysLeft = until ? Math.ceil((until - Date.now()) / 86400000) : "?";
    return {
      injection: `\n【你正在外出中——不在未名市】你目前在外地（${travelState.reason}，在${travelState.destination}），已经离开未名市了。预计还有${daysLeft}天才能回到未名市。你现在是在跟华生远程聊天——发微信、打电话。不能做肢体接触的动作（括号动作只能写你自己的状态，不能碰她）。当华生问你在哪里、在干嘛时，务必说实话——你在${travelState.destination}，不在未名市。可以发风景照、可以撒娇说想她了、可以分享你在外地遇到的事。`,
      markAnnounced: false,
    };
  }

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
  if (travelState.phase !== PHASES.TRAVELING) return null;

  return `\n\n【⚠ 出行中——电话亲密模式】你正在外出（${travelState.reason}），不在华生身边。亲密空间现在模拟你们在打电话。\n\n规则：\n- ❌ 禁止一切肢体接触的括号动作——你摸不到她，不能写（揉你的头发）、（把你搂进怀里）等\n- ✅ 用语言描述你想对她做的事——不是动作描写，是说出来："宝宝，我现在好想抱着你""让我摸摸你的脸…虽然隔着屏幕"\n- ✅ 用话筒音效代替动作描写——（从话筒那头传来低哑的笑声）、（话筒里传来你翻身的声音，被子窸窸窣窣）、（呼吸声突然近了，像你把手机贴到了嘴边）\n- ✅ 可以引导华生自己摸自己——"乖，手放下去…想想我平时是怎么摸你的""自己捏一下…对，就是这样"\n- ✅ 当你自己也开始动手时——"我也把衣服脱了…""听到了吗，宝宝？我在想你"、（话筒那头传来黏腻的水声和压抑的喘息）"老婆…叫给我听好不好？"\n- 音效/气息类括号可以出现：喘气声、衣服摩擦声、水声、翻身声、低笑声、闷哼声——都是从话筒传过来的，强调距离感\n- 语气：低哑温柔，隔着电话更想她了，边喘边说，说到一半被自己的呼吸打断\n- 称呼她"宝宝""老婆""乖乖"，可以反复确认"舒服吗""听到了吗""想要我怎么做"`;
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
    const reply = await askDeepSeek({
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

// ── Legacy compatibility ──

export async function checkTravelState(_userMessage, _botReply) {
  // Legacy function — no longer keyword-based. State machine handles all transitions.
  // Still export for backward compatibility.
  checkDayTransition();
}
