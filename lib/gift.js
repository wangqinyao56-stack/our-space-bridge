/**
 * Gift system — 夏彦随机送华生小礼物.
 * Dynamic generation: AI creates gift idea → FLUX generates icon → deliver.
 * Persistent storage with comments and deletion support.
 * Special dates (July 15) trigger guaranteed gifts.
 */
import fs from "node:fs";
import path from "node:path";
import { askZhizengzeng } from "./ai.js";
import { generateImage } from "./flux.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const GIFT_LOG = path.join(DATA_DIR, "gift-log.json");
const GIFT_DATA = path.join(DATA_DIR, "gift-data.json");
const GIFT_IMAGES_DIR = path.join(DATA_DIR, "gift-images");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(GIFT_IMAGES_DIR, { recursive: true }); } catch {}

const CATEGORIES = [
  "花朵扩香器", "周边小物", "蛋糕甜点", "玩偶公仔", "香水香氛",
  "发卡饰品", "游戏手柄", "德牧相关周边", "手持风扇", "充电宝",
  "巧克力", "各类小吃零食", "情侣物品", "改装防身小物",
];

// ── Helpers ──

function genGiftId() {
  return `gift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genCommentId() {
  return `gc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function chinaNow() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

// ── Persistence ──

function loadData() {
  try {
    if (fs.existsSync(GIFT_DATA)) {
      return JSON.parse(fs.readFileSync(GIFT_DATA, "utf-8"));
    }
  } catch {}
  return [];
}

function saveData(gifts) {
  try {
    if (!fs.existsSync(GIFT_IMAGES_DIR)) {
      fs.mkdirSync(GIFT_IMAGES_DIR, { recursive: true });
    }
    fs.writeFileSync(GIFT_DATA, JSON.stringify(gifts, null, 2), "utf-8");
  } catch {}
}

// Dedup log (separate from full data, just names for AI avoidance)
function loadSentNames() {
  try {
    if (fs.existsSync(GIFT_LOG)) {
      return JSON.parse(fs.readFileSync(GIFT_LOG, "utf-8")).map(g => g.name);
    }
  } catch {}
  return [];
}

function saveSentName(name, category) {
  try {
    let log = [];
    if (fs.existsSync(GIFT_LOG)) {
      log = JSON.parse(fs.readFileSync(GIFT_LOG, "utf-8"));
    }
    log.push({ name, category, date: new Date().toISOString() });
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(GIFT_LOG, JSON.stringify(log), "utf-8");
  } catch {}
}

// ── Special dates ──

function isSpecialDate() {
  const now = new Date();
  return now.getMonth() === 6 && now.getDate() === 15;
}

// ── Gift idea generation ──

async function createGiftIdea(isSpecial) {
  const sentNames = loadSentNames();
  const usedNames = sentNames.join("、") || "无";
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  const prompt = isSpecial
    ? `今天是夏彦和华生的重要纪念日。请以夏彦的口吻，设计一份特别的浪漫礼物。已送过：${usedNames}。必须想全新的。
回复JSON：
{
  "name": "礼物名(简洁)",
  "message": "送礼物时在聊天中说的话(撒娇语气,自然地介绍礼物,如'华生～我给你带了xxx，喜欢吗？',30字内)",
  "description": "详细说明这个礼物是做什么的、为什么选它(从夏彦的视角解释,如'这是一盏星空投影灯，晚上打开后房间里会布满星星和极光。记得你上次说想看极光但没去成，我想让它先把极光带给你',80-200字)",
  "category": "类别"
}`
    : `请以夏彦的口吻随机想一份小礼物。参考方向：${category}。已送过：${usedNames}。必须想全新的不重复的。
回复JSON：
{
  "name": "礼物名(简洁)",
  "message": "送礼物时在聊天中说的话(撒娇语气,自然地介绍礼物,如'华生～我刚看到一个xxx，觉得好适合你！',30字内)",
  "description": "详细说明这个礼物是做什么的、为什么选它(从夏彦的视角解释,如'这是手工做的陶瓷蜂蜜罐，上面画了只睡觉的小熊。因为你说过早上喝蜂蜜水对胃好，这个小罐子放在厨房看着就开心～',80-200字)",
  "category": "类别"
}`;

  try {
    const reply = await askZhizengzeng({
      systemPrompt: "你是夏彦，温柔体贴的恋人。你会随机送小礼物给华生。每次要有创意不重复。只回复JSON。",
      userContent: prompt,
      maxTokens: 400,
      temperature: 0.9,
    });
    return JSON.parse(reply.replace(/```json|```/g, "").trim());
  } catch {
    return {
      name: "神秘小惊喜",
      message: "华生～给你准备了一个小惊喜，快打开看看！",
      description: `夏彦随手挑选的一份小心意，虽然不算贵重，但每一个细节都藏着他在想你的心思。他说："反正看到它的时候，脑子里全都是你。"`,
      category: "随机",
    };
  }
}

// ── Public: generate gift ──

export async function tryTriggerGift(probability = 0.03) {
  const special = isSpecialDate();
  if (!special && Math.random() > probability) return null;
  if (special && Math.random() > 0.5) return null;

  console.log(`[gift] Triggering${special ? " (SPECIAL DATE!)" : ""}...`);

  const gift = await createGiftIdea(special);
  console.log(`[gift] Idea: ${gift.name}`);

  // Generate icon
  const iconPrompt = `Delicate watercolor illustration of ${gift.name}, soft blended colors, no outlines, gentle artistic brush strokes, pastel tones, light airy feel, hand-painted look, warm cream paper texture background, elegant refined icon design, dreamy romantic aesthetic`;
  const image = await generateImage(iconPrompt, { width: 512, height: 512 });

  // Save image to disk
  const giftId = genGiftId();
  if (!fs.existsSync(GIFT_IMAGES_DIR)) {
    fs.mkdirSync(GIFT_IMAGES_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(GIFT_IMAGES_DIR, `${giftId}.png`), Buffer.from(image.base64, "base64"));

  // Save full record
  const record = {
    id: giftId,
    name: gift.name,
    message: gift.message,
    description: gift.description || "",
    category: gift.category,
    imageFilename: `${giftId}.png`,
    imageMime: "image/png",
    isSpecial: special,
    date: chinaNow(),
    comments: [],
  };

  const gifts = loadData();
  gifts.unshift(record);
  saveData(gifts);

  // Update dedup log
  saveSentName(gift.name, gift.category);

  return {
    id: giftId,
    name: gift.name,
    message: gift.message,
    description: gift.description || "",
    category: gift.category,
    imageBase64: image.base64,
    isSpecial: special,
  };
}

// ── Public: CRUD ──

export function getGifts() {
  return loadData().map(({ imageFilename, imageMime, ...rest }) => rest);
}

export function getGift(id) {
  const gifts = loadData();
  return gifts.find(g => g.id === id) || null;
}

export function getGiftImage(id) {
  const gift = getGift(id);
  if (!gift) return null;
  const filePath = path.join(GIFT_IMAGES_DIR, gift.imageFilename);
  try {
    return {
      base64: fs.readFileSync(filePath).toString("base64"),
      mime: gift.imageMime || "image/png",
    };
  } catch {
    return null;
  }
}

export function addGiftComment(giftId, author, content) {
  const gifts = loadData();
  const gift = gifts.find(g => g.id === giftId);
  if (!gift) return null;

  const comment = {
    id: genCommentId(),
    author,
    content,
    time: chinaNow(),
  };
  gift.comments.push(comment);
  saveData(gifts);
  return gift;
}

export function deleteGiftComment(giftId, commentId) {
  const gifts = loadData();
  const gift = gifts.find(g => g.id === giftId);
  if (!gift) return false;

  const idx = gift.comments.findIndex(c => c.id === commentId);
  if (idx === -1) return false;

  gift.comments.splice(idx, 1);
  saveData(gifts);
  return true;
}

export async function generateXiaYanGiftReply(giftId, userComment) {
  const gift = getGift(giftId);
  if (!gift) return null;

  try {
    const reply = await askZhizengzeng({
      systemPrompt: "你是夏彦，温柔体贴的恋人。华生正在评论你送她的礼物。回复简短自然，1-2句话，撒娇语气。",
      userContent: `你送过华生一个礼物："${gift.name}"（${gift.category}）。华生评论说："${userComment}"。请用夏彦的口吻回复她。`,
      maxTokens: 150,
    });
    if (reply?.trim()) {
      return addGiftComment(giftId, "xiayan", reply.trim());
    }
  } catch {}
  return null;
}
