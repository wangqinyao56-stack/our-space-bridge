/**
 * Scenery photo system — 夏彦外出时分享沿途风景.
 * Detects travel/mission state from conversation, randomly sends photorealistic scenery.
 */
import fs from "node:fs";
import path from "node:path";
import { askClaude } from "./ai.js";
import { generateImage } from "./flux.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const TRAVEL_STATE_FILE = path.join(DATA_DIR, "travel-state.json");
const SCENERY_LOG = path.join(DATA_DIR, "scenery-log.json");

// Scenery prompt themes for variety
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

// Travel state
let travelState = { active: false, destination: "", since: null, lastPhoto: null };

try {
  if (fs.existsSync(TRAVEL_STATE_FILE)) {
    travelState = JSON.parse(fs.readFileSync(TRAVEL_STATE_FILE, "utf-8"));
  }
} catch {}

function saveTravelState() {
  try { fs.writeFileSync(TRAVEL_STATE_FILE, JSON.stringify(travelState), "utf-8"); } catch {}
}

// Scenery history to avoid repeats
let sceneryHistory = [];
try {
  if (fs.existsSync(SCENERY_LOG)) {
    sceneryHistory = JSON.parse(fs.readFileSync(SCENERY_LOG, "utf-8"));
  }
} catch {}

function saveSceneryLog() {
  try { fs.writeFileSync(SCENERY_LOG, JSON.stringify(sceneryHistory), "utf-8"); } catch {}
}

/**
 * Check conversation context for travel/mission keywords.
 * Called after each message to potentially enter travel mode.
 */
export async function checkTravelState(userMessage, botReply) {
  const combined = `${userMessage || ""} ${botReply || ""}`.toLowerCase();

  const travelKeywords = [
    "出差", "出任务", "去外地", "旅行", "远行", "外出", "执行任务",
    "调查", "情报", "跟踪", "监视", "保护任务",
  ];

  const departKeywords = ["出发", "走了", "出门", "离开", "去了"];
  const returnKeywords = ["回来", "到家", "回未名", "任务完成", "收工"];

  const hasTravel = travelKeywords.some((k) => combined.includes(k));

  if (!travelState.active && hasTravel) {
    // Check if departing
    const isDeparting = departKeywords.some((k) => combined.includes(k));
    if (isDeparting) {
      travelState.active = true;
      travelState.destination = extractDestination(botReply || "");
      travelState.since = new Date().toISOString();
      travelState.lastPhoto = null;
      saveTravelState();
      console.log(`[scenery] Travel mode ON, destination: ${travelState.destination || "unknown"}`);
    }
  }

  if (travelState.active) {
    const isReturning = returnKeywords.some((k) => combined.includes(k));
    if (isReturning) {
      travelState.active = false;
      travelState.destination = "";
      travelState.since = null;
      travelState.lastPhoto = null;
      saveTravelState();
      console.log("[scenery] Travel mode OFF");
    }
  }
}

function extractDestination(text) {
  // Simple extraction: look for place names after keywords
  const patterns = ["去了", "到", "在", "去"];
  for (const p of patterns) {
    const idx = text.indexOf(p);
    if (idx >= 0) {
      const after = text.slice(idx + p.length).trim();
      const place = after.match(/[一-龥]{2,6}/);
      if (place) return place[0];
    }
  }
  return "";
}

/**
 * Attempt to trigger a scenery photo while in travel mode.
 * @param {number} probability - chance 0-1 per check
 * @returns {object|null} scenery with {caption, imageBase64, destination} or null
 */
export async function tryTriggerScenery(probability = 0.08) {
  if (!travelState.active) return null;
  if (Math.random() > probability) return null;

  // Avoid sending too frequently (at least 30 min between photos)
  if (travelState.lastPhoto) {
    const elapsed = Date.now() - new Date(travelState.lastPhoto).getTime();
    if (elapsed < 30 * 60 * 1000) return null;
  }

  console.log(`[scenery] Triggering photo from ${travelState.destination || "travel"}...`);

  // Pick a theme, avoiding recent ones
  const recentThemes = new Set(sceneryHistory.slice(-5).map((s) => s.theme));
  const available = SCENERY_THEMES.filter((t) => !recentThemes.has(t));
  const theme = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : SCENERY_THEMES[Math.floor(Math.random() * SCENERY_THEMES.length)];

  // Generate caption
  const destStr = travelState.destination ? `在${travelState.destination}，` : "";
  const caption = await generateCaption(destStr, theme);

  // Generate photo
  const prompt = `${theme}, high resolution, no people, natural lighting, professional travel photography`;
  const image = await generateImage(prompt, { width: 1024, height: 768, model: "flux-2-pro" });

  // Record
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
    const reply = await askClaude({
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

export function isTraveling() {
  return travelState.active;
}
