/**
 * Gift system — 夏彦随机送华生小礼物.
 * Dynamic generation: AI creates gift idea → FLUX generates icon → deliver.
 * Tracks history to avoid repeats. Special dates (July 15) trigger guaranteed gifts.
 */
import fs from "node:fs";
import path from "node:path";
import { askZhizengzeng } from "./ai.js";
import { generateImage } from "./flux.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const GIFT_LOG = path.join(DATA_DIR, "gift-log.json");

const CATEGORIES = [
  "花朵扩香器", "周边小物", "蛋糕甜点", "玩偶公仔", "香水香氛",
  "发卡饰品", "游戏手柄", "德牧相关周边", "手持风扇", "充电宝",
  "巧克力", "各类小吃零食", "情侣物品", "改装防身小物",
];

let sentGifts = [];
try {
  if (fs.existsSync(GIFT_LOG)) {
    sentGifts = JSON.parse(fs.readFileSync(GIFT_LOG, "utf-8"));
  }
} catch {}

function saveLog() {
  try { fs.writeFileSync(GIFT_LOG, JSON.stringify(sentGifts), "utf-8"); } catch {}
}

function isSpecialDate() {
  const now = new Date();
  return now.getMonth() === 6 && now.getDate() === 15;
}

function getAnniversaries() {
  const year = new Date().getFullYear();
  return [
    `${year - 2020}周年告白纪念日`,
    `${year - 2021}周年求婚纪念日`,
    `${year - new Date().getFullYear()}周年结婚纪念日`,
  ];
}

/**
 * Use AI to create a unique gift idea.
 */
async function createGiftIdea(isSpecial) {
  const usedNames = sentGifts.map((g) => g.name).join("、") || "无";
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  const prompt = isSpecial
    ? `今天是夏彦和华生的重要纪念日（${getAnniversaries().join("、")}）。请以夏彦的口吻，设计一份特别的浪漫礼物。已送过：${usedNames}。必须想全新的。回复JSON：{"name":"礼物名(简洁)","message":"送礼物时说的一句话(撒娇语气,30字内)","category":"类别"}`
    : `请以夏彦的口吻随机想一份小礼物。参考方向：${category}。已送过：${usedNames}。必须想全新的不重复的。回复JSON：{"name":"礼物名(简洁)","message":"送礼物时说的一句话(撒娇语气,30字内)","category":"类别"}`;

  try {
    const reply = await askZhizengzeng({
      systemPrompt: "你是夏彦，温柔体贴的恋人。你会随机送小礼物给华生。每次要有创意不重复。只回复JSON。",
      userContent: prompt,
      maxTokens: 250,
      temperature: 0.9,
    });
    return JSON.parse(reply.replace(/```json|```/g, "").trim());
  } catch {
    return {
      name: "神秘小惊喜",
      message: "华生～给你准备了一个小惊喜，快打开看看！",
      category: "随机",
    };
  }
}

/**
 * Attempt to trigger a gift.
 * @param {number} probability - chance 0-1, default 0.03
 * @returns {object|null} gift with {name, message, category, imageBase64, isSpecial} or null
 */
export async function tryTriggerGift(probability = 0.03) {
  const special = isSpecialDate();

  // Special date: high chance. Normal: low chance.
  if (!special && Math.random() > probability) return null;
  if (special && Math.random() > 0.5) return null; // check up to 2x/day on special dates

  console.log(`[gift] Triggering${special ? " (SPECIAL DATE!)" : ""}...`);

  const gift = await createGiftIdea(special);
  console.log(`[gift] Idea: ${gift.name}`);

  // Generate icon
  const iconPrompt = `Delicate watercolor illustration of ${gift.name}, soft blended colors, no outlines, gentle artistic brush strokes, pastel tones, light airy feel, hand-painted look, warm cream paper texture background, elegant refined icon design, dreamy romantic aesthetic`;
  const image = await generateImage(iconPrompt, { width: 512, height: 512 });

  // Record
  sentGifts.push({ name: gift.name, category: gift.category, date: new Date().toISOString() });
  if (sentGifts.length > 500) sentGifts = sentGifts.slice(-500);
  saveLog();

  return {
    name: gift.name,
    message: gift.message,
    category: gift.category,
    imageBase64: image.base64,
    isSpecial: special,
  };
}
