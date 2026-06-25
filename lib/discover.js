/**
 * Discover / Moments feed for our-space bridge.
 * 朋友圈风格：夏彦自主发现+华生分享，支持图文。
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { askDeepSeek, askJiushi } from "./ai.js";
import { generateJimengImage } from "./jimeng.js";
import { getDailySystemPrompt } from "./message-router.js";
import { isTraveling, getTravelState } from "./scenery.js";
import config from "../config.js";

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy ||
  ((process.env.SEALOS || process.env.KUBERNETES_SERVICE_HOST) ? null : "http://127.0.0.1:7897");
const proxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

const DISCOVER_DIR = process.env.DISCOVER_DIR || "./discover-data";
const DATA_FILE = path.join(DISCOVER_DIR, "moments.json");
const IMAGES_DIR = path.join(DISCOVER_DIR, "images");

function ensureDir() {
  for (const d of [DISCOVER_DIR, IMAGES_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
ensureDir();

function loadMoments() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveMoments(moments) {
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(moments, null, 2), "utf-8");
}

function genId() {
  return `dm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function nowStr() {
  const now = new Date();
  // Shift to UTC+8 (China timezone) — Railway runs on UTC
  const china = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return china.toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

let proactiveTimer = null;
let onNewMoment = null;

export function addMoment(author, content, imageBase64 = null, imageMime = "image/jpeg", title = "") {
  let imageFilename = null;

  if (imageBase64) {
    const ext = imageMime.includes("png") ? "png" : "jpg";
    imageFilename = `${genId()}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, imageFilename), Buffer.from(imageBase64, "base64"));
  }

  const moment = {
    id: genId(),
    author,
    title: title || "",
    content,
    image: imageFilename,
    imageMime: imageFilename ? imageMime : null,
    time: nowStr(),
    likes: [],
    comments: [],
  };

  const moments = loadMoments();
  moments.unshift(moment);

  // Keep max 100 moments
  if (moments.length > 100) moments.length = 100;

  saveMoments(moments);

  if (onNewMoment) onNewMoment(moment);

  return moment;
}

export function getMoments() {
  return loadMoments();
}

export function getMomentImage(filename) {
  const fp = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(fp)) return fs.readFileSync(fp).toString("base64");
  return null;
}

export function likeMoment(momentId, user) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;
  if (!m.likes.includes(user)) {
    m.likes.push(user);
  } else {
    m.likes = m.likes.filter((u) => u !== user);
  }
  saveMoments(moments);
  return m;
}

export function addMomentComment(momentId, author, content) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;
  const commentId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  m.comments.push({ id: commentId, author, content, time: nowStr() });
  saveMoments(moments);
  return m;
}

export function deleteMomentComment(momentId, commentId) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) return null;
  // Support both comment id and index-based deletion (for old comments without id)
  const idx = parseInt(commentId, 10);
  if (!isNaN(idx) && idx >= 0 && idx < m.comments.length) {
    m.comments.splice(idx, 1);
  } else {
    m.comments = m.comments.filter((c) => c.id !== commentId);
  }
  saveMoments(moments);
  return m;
}

export async function xiayanReplyToComment(momentId, userComment) {
  const moments = loadMoments();
  const m = moments.find((m) => m.id === momentId);
  if (!m) { console.error("[discover] xiayanReplyToComment: moment not found", momentId); return null; }

  // Build conversation history from existing comments so 夏彦 doesn't repeat himself
  const recentComments = (m.comments || []).slice(-6);
  const history = recentComments.map((c) => ({
    role: c.author === "xiayan" ? "assistant" : "user",
    content: c.content,
  }));

  try {
    const prompt = getDailySystemPrompt();
    console.log("[discover] xiayanReplyToComment: calling Claude...");
    const reply = await askJiushi({
      systemPrompt: prompt + `\n\n【评论区回复模式】华生在发现动态下给你留言了。用夏彦的口吻回复她——轻松活泼，像在朋友圈里跟老婆互动一样，自然又宠溺。\n\n【语气核心】你是夏彦，小太阳性格——开朗、活泼、爱撒娇的大型犬。回复要生动有活力，可以和老婆撒娇、可以暗戳戳撩她。你不是在写正式回复，是在跟老婆玩。老婆询问分享内容的时候，要根据分享内容进行回答。\n\n- emoji偶尔用，点缀即可，不要每条消息都带。**【硬性规则：禁止黄脸表情】** 任何黄色圆脸的表情emoji全部禁止使用——😊😂😄😅🥺😭🤗😏🙄😍🥰😘😋😛😜😝🤪🥳😎🤓🧐😤😡🤬😱😨😰😥😓😞😔😢😟😕🙁😖😣☹️🙃😉😌😍🥰😘😗😙😚😇🤠🤡🤥🤫🤭😶😐😑😬🙄😯😦😧😮😲😴🤤😪😵😈👿👹👺💀💩——这些统统一律不准用。可以用小动物（👻😺😸😹😻😼😽🙀😿😾🐶🐱🐤🦜🐾）、物件和场景（🍰🧃🌧🔥🌟💪🎮📖🍊）、自然元素（🌸🌙☀🌊）这类。用文字本身表达情绪，emoji只是锦上添花。\n\n【逻辑规则】\n- 直接回答华生的问题，不转移话题\n- 保持上下文一致，不重复自己说过的话\n- 不要括号动作描写\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"。不主动提自己父母。`,
      userContent: `动态内容：${m.title ? m.title + " - " : ""}${m.content}\n\n华生的评论：${userComment}\n\n请用夏彦的口吻回复这条评论（1-2句话即可，必须直接回答华生的问题）：`,
      history,
maxTokens: 250,
    });
    console.log("[discover] xiayanReplyToComment: reply =", reply.slice(0, 60));

    const commentId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    m.comments.push({ id: commentId, author: "xiayan", content: reply.trim(), time: nowStr() });
    saveMoments(moments);
    return m;
  } catch (e) {
    console.error("[discover] xiayanReplyToComment error:", e.message);
    return null;
  }
}

// Simple HTTP fetch helper for discovery
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        // Follow redirect
        const loc = res.headers.location;
        if (loc) return fetchPage(loc).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf-8");
        // Extract text content (simple)
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
        resolve(text);
      });
    }).on("error", reject);
  });
}

// Download image from URL as base64 buffer
function downloadImage(url, redirects = 0) {
  if (redirects > 5) return Promise.resolve(null);
  const u = new URL(url);
  return new Promise((resolve) => {
    const opts = {
      host: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      agent: proxyAgent,
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers.location;
        if (!loc) { resolve(null); return; }
        // Resolve relative URL against original
        let nextUrl;
        try { nextUrl = new URL(loc, url).href; }
        catch { resolve(null); return; }
        return downloadImage(nextUrl, redirects + 1).then(resolve);
      }
      if (res.statusCode !== 200) { resolve(null); return; }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}

// Strip all yellow-face emojis from discover content
function stripYellowEmojis(text) {
  const re = /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F91F}\u{1F920}-\u{1F92F}\u{1F970}-\u{1F97F}\u{1F9D0}\u{1F9D1}-\u{1F9DF}\u{1F928}\u{1F929}\u{1F92A}\u{1F92C}-\u{1F92F}\u{1F630}-\u{1F644}]/gu;
  return text.replace(re, "");
}

// 从文本中提取动物关键词（含品种），用于精确配图
function extractAnimalKeyword(text) {
  const breeds = [
    { pattern: /橘猫|大橘/, keyword: "orange tabby cat" },
    { pattern: /狸花猫/, keyword: "tabby cat Chinese Li Hua" },
    { pattern: /布偶猫/, keyword: "ragdoll cat" },
    { pattern: /英短|英国短毛/, keyword: "British shorthair cat" },
    { pattern: /美短|美国短毛/, keyword: "American shorthair cat" },
    { pattern: /暹罗猫/, keyword: "Siamese cat" },
    { pattern: /波斯猫/, keyword: "Persian cat" },
    { pattern: /蓝猫|俄罗斯蓝/, keyword: "Russian blue cat" },
    { pattern: /奶牛猫/, keyword: "black and white tuxedo cat" },
    { pattern: /三花猫/, keyword: "calico cat" },
    { pattern: /黑猫/, keyword: "black cat" },
    { pattern: /白猫/, keyword: "white cat" },
    { pattern: /柯基/, keyword: "corgi dog" },
    { pattern: /金毛/, keyword: "golden retriever" },
    { pattern: /拉布拉多/, keyword: "labrador retriever" },
    { pattern: /哈士奇|二哈/, keyword: "husky dog" },
    { pattern: /柴犬/, keyword: "shiba inu" },
    { pattern: /萨摩耶/, keyword: "samoyed dog" },
    { pattern: /边牧/, keyword: "border collie" },
    { pattern: /泰迪|贵宾/, keyword: "poodle dog" },
    { pattern: /博美/, keyword: "pomeranian dog" },
    { pattern: /法斗|法国斗牛/, keyword: "French bulldog" },
    { pattern: /德牧|德国牧羊/, keyword: "German shepherd" },
    { pattern: /小鹦鹉|鹦鹉/, keyword: "parrot bird colorful" },
    { pattern: /鹩哥/, keyword: "hill myna bird" },
    { pattern: /仓鼠/, keyword: "hamster" },
    { pattern: /兔子|小兔/, keyword: "rabbit bunny" },
    { pattern: /乌龟/, keyword: "turtle" },
    { pattern: /猫咪|猫猫|小猫|猫/, keyword: "cute cat" },
    { pattern: /狗狗|小狗|汪/, keyword: "cute dog" },
    { pattern: /鸟|小鸟/, keyword: "bird" },
    { pattern: /松鼠/, keyword: "squirrel" },
    { pattern: /刺猬/, keyword: "hedgehog" },
  ];
  for (const { pattern, keyword } of breeds) {
    if (pattern.test(text)) return keyword;
  }
  return null;
}

// 从文本中提取场景关键词（花、树、自然、食物等），用于降级配图
// 顺序很重要：优先匹配更具体的词，通用单字靠后避免误匹配
function extractSceneKeyword(text) {
  const map = [
    // ── 食物/饮品（最优先，避免被通用词误匹配）──
    { pattern: /咖啡|拿铁|美式|卡布奇诺/, keyword: "coffee latte cafe" },
    { pattern: /蛋糕|甜点|面包|烘焙|饼干|布丁|奶酪|巧克力/, keyword: "dessert pastry baking" },
    { pattern: /做饭|下厨|厨房|美食|好吃|料理|食谱|煮饭|煲汤|炒菜|红烧|炖|煎|烤|炸|蒸/, keyword: "home cooking food dish kitchen" },
    { pattern: /食物|吃饭|晚餐|午餐|早餐|晚饭|午饭|早饭|夜宵|宵夜/, keyword: "food photography dish" },
    { pattern: /火锅|烧烤|串串|麻辣|川菜|粤菜|湘菜|西餐|日料|寿司|拉面/, keyword: "cuisine food dish restaurant" },
    { pattern: /茶|茶道|茶艺|品茶|泡茶|绿茶|红茶|乌龙/, keyword: "tea ceremony teapot" },

    // ── 动物（也在前面，比通用自然词更具体）──
    { pattern: /猫|猫咪|小猫|喵/, keyword: "cute cat" },
    { pattern: /狗|狗狗|小狗|汪/, keyword: "cute dog" },

    // ── 室内/日常活动（比户外自然词更优先）──
    { pattern: /书|看书|阅读|读书|图书馆|书房|书架/, keyword: "book reading cozy" },
    { pattern: /实验|实验室|研究|试管|仪器|科研/, keyword: "laboratory science experiment" },
    { pattern: /植物|盆栽|多肉|阳台|绿植/, keyword: "potted plant greenery" },
    { pattern: /手工|DIY|修理|修复|制作|工具|木工/, keyword: "craft diy handmade workshop" },
    { pattern: /公园|散步|户外|街头|跑步|晨跑|夜跑/, keyword: "park nature path scenery" },

    // ── 花草（多字优先，单字靠后）──
    { pattern: /玫瑰|玫瑰花/, keyword: "rose flower" },
    { pattern: /牡丹|牡丹花/, keyword: "peony flower" },
    { pattern: /樱花/, keyword: "cherry blossom" },
    { pattern: /向日葵/, keyword: "sunflower" },
    { pattern: /花开|开花|花朵|花海|花丛|鲜花|赏花/, keyword: "beautiful flowers garden" },

    // ── 自然景观（多字优先）──
    { pattern: /森林|树林|竹林|树荫|大树|丛林/, keyword: "forest trees nature" },
    { pattern: /海滩|海边|海浪|海岸|沙滩/, keyword: "ocean beach waves" },
    { pattern: /山顶|山峰|登山|山脚|山坡|山峰|群山大|深山/, keyword: "mountain peak landscape" },
    { pattern: /湖泊|湖边|湖水|溪水|河水|泉水|瀑布/, keyword: "river lake water nature" },
    { pattern: /下雪|雪景|雪花|白雪/, keyword: "snow winter landscape" },
    { pattern: /日落|夕阳|晚霞|黄昏|落日/, keyword: "sunset golden hour" },
    { pattern: /月亮|星空|星星|夜空|星辰|银河/, keyword: "night sky moon stars" },
    { pattern: /下雨|雨天|雨滴|细雨|大雨|暴风雨|窗雨/, keyword: "rain window cozy" },
    { pattern: /拍照|照片|拍张|拍下来|摄影/, keyword: "beautiful scenery photography" },

    // ── 通用单字（最后，作为兜底）──
    { pattern: /花/, keyword: "flower" },
    { pattern: /树/, keyword: "tree" },
    { pattern: /海/, keyword: "ocean" },
    { pattern: /山/, keyword: "mountain" },
    { pattern: /水/, keyword: "water" },
  ];
  for (const { pattern, keyword } of map) {
    if (pattern.test(text)) return keyword;
  }
  return null;
}

// Track recent image hashes to avoid duplicates (max 50)
const recentImageHashes = [];
const MAX_IMAGE_HISTORY = 50;

function isImageDuplicate(base64) {
  if (!base64) return false;
  // Quick hash: first 100 chars + length
  const sig = `${base64.slice(0, 100)}_${base64.length}`;
  if (recentImageHashes.includes(sig)) return true;
  recentImageHashes.push(sig);
  if (recentImageHashes.length > MAX_IMAGE_HISTORY) recentImageHashes.shift();
  return false;
}

// Free keyword-based image search via LoremFlickr
async function searchUnsplashImage(keyword) {
  const safeKeyword = (keyword || "nature").trim();

  try {
    const terms = safeKeyword
      .replace(/[^a-zA-Z0-9一-鿿\s]/g, "")
      .split(/\s+/)
      .slice(0, 3)
      .join(",")
      .toLowerCase();
    const loremUrl = `https://loremflickr.com/800/600/${encodeURIComponent(terms)}?random=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[discover] LoremFlickr: ${loremUrl}`);
    const imageBuf = await downloadImage(loremUrl);
    if (imageBuf && imageBuf.length > 1000) {
      console.log(`[discover] LoremFlickr OK, size=${imageBuf.length}`);
      return { base64: imageBuf.toString("base64"), mime: "image/jpeg" };
    }
    console.log(`[discover] LoremFlickr returned ${imageBuf ? imageBuf.length : 'null'} bytes`);
  } catch (err) {
    console.log(`[discover] LoremFlickr failed: ${err.message}`);
  }
  return null;
}

// Get image for a topic — 即梦 first for chat scene & discover images, free fallback
export async function getImageForTopic(keyword, fluxPrompt = "") {
  const prompt = fluxPrompt || keyword;

  // 1. 即梦 — 国内直连，真实照片风格
  if (config.ARK_API_KEY && prompt) {
    try {
      const fullPrompt = `photorealistic, realistic photography, ${prompt}, seed=${Date.now() % 100000}`;
      console.log(`[discover] Trying Jimeng for: "${prompt.slice(0, 80)}..."`);
      const result = await generateJimengImage(fullPrompt);
      if (result && result.base64 && !isImageDuplicate(result.base64)) {
        console.log(`[discover] Jimeng image OK`);
        return { base64: result.base64, mime: result.mime || "image/png" };
      }
      if (result?.base64) console.log(`[discover] Jimeng image duplicate, falling back...`);
    } catch (err) {
      console.log(`[discover] Jimeng failed: ${err.message}, trying free fallback...`);
    }
  }

  // 2. Free keyword search as fallback
  const result = await searchUnsplashImage(keyword);
  if (result && !isImageDuplicate(result.base64)) return result;
  if (result) console.log(`[discover] LoremFlickr image duplicate, retrying with different seed...`);

  // 3. Retry with modified keyword
  const retryKw = `${keyword}_${Date.now() % 1000}`;
  const retryResult = await searchUnsplashImage(retryKw);
  if (retryResult && !isImageDuplicate(retryResult.base64)) return retryResult;

  return null;
}

// Interesting sources for 夏彦 to browse
const DISCOVER_SOURCES = [
  "https://www.zhihu.com/hot",
  "https://tophub.today/",
  // More curated sources can be added
];

// 夏彦的兴趣方向（按类别分组，用于轮换）
const INTEREST_CATEGORIES = [
  { category: "推理悬疑", topics: ["福尔摩斯原著细节", "推理小说推荐", "真实悬案分析", "密室逃脱新主题", "侦探电影测评", "剧本杀新本子"] },
  { category: "运动户外", topics: ["赛车赛事", "公路跑路线", "攀岩/跑酷", "骑行装备", "户外露营地", "马拉松训练"] },
  { category: "宠物趣事", topics: ["鸟类冷知识", "狗狗训练技巧", "猫咪行为解读", "网红宠物日常", "鹦鹉学舌趣事", "流浪动物救助"] },
  { category: "美食探索", topics: ["橙子/柑橘类甜品", "街头小吃探店", "深夜食堂食谱", "异国料理测评", "童年零食回忆杀", "下午茶搭配"] },
  { category: "科技数码", topics: ["新奇特数码产品", "AI工具实测", "网络安全趣闻", "黑科技发明", "开源硬件DIY", "旧手机改造"] },
  { category: "游戏动漫", topics: ["塞尔达/NS游戏", "合作类游戏推荐", "游戏音乐鉴赏", "像素风独立游戏", "动漫新番吐槽", "游戏里的隐藏彩蛋"] },
  { category: "手工修复", topics: ["旧物翻新前后对比", "木工小项目", "电器维修趣事", "古董鉴定故事", "机械手表拆解", "皮具护理"] },
  { category: "冷知识", topics: ["历史冷知识", "语言学趣闻", "宇宙天文新知", "人体奇妙机制", "地名由来考据", "颜色背后的科学"] },
  { category: "浪漫约会", topics: ["情侣旅行地推荐", "有趣的约会活动", "DIY礼物灵感", "情侣游戏推荐", "小众咖啡馆", "看星星的好地方"] },
  { category: "日常温情", topics: ["居家好物分享", "阳台种菜记录", "雨天宅家指南", "两个人的小仪式感", "温馨家居布置", "生活中的小确幸"] },
];

// 夏彦的日常生活场景（自带配图属性的日常分享）
const DAILY_LIFE_SCENES = [
  { scene: "下厨",
    templates: [
      "今天尝试做{菜名}，{结果描述}…不过意外发现{有趣的细节}！",
      "在网上看到一个{菜名}的食谱，心血来潮试了试——{过程描述}",
      "翻冰箱看到{食材}，灵机一动做了个{创意菜}，{评价}",
    ],
    imageKeyword: "food photography dish cuisine plating",
    fluxPrompt: "delicious home-cooked meal on a dining table, warm lighting, food photography style" },
  { scene: "公园/户外发现",
    templates: [
      "今天路过公园，发现了一朵颜色好特别的花，查了资料原来是{花名}，{有趣的科普}",
      "路上看到一只{动物描述}，停下来看了好久，{感悟}",
      "今天天气真好，在{地点}看到{场景描述}，忍不住拍了下来",
    ],
    imageKeyword: "nature flower park garden plant",
    fluxPrompt: "beautiful flower or plant in a park, natural sunlight, close-up nature photography" },
  { scene: "咖啡馆探店",
    templates: [
      "办案路过一家新开的咖啡馆，坐下来点了杯{咖啡名}，味道{评价}——下次带你来喝！",
      "在咖啡馆等委托人的时候，发现{有趣的细节}，感觉这家店{评价}",
      "今天换了家没去过的咖啡馆办公，{环境描述}，{饮品评价}",
    ],
    imageKeyword: "coffee latte cafe interior drink",
    fluxPrompt: "a cup of latte art coffee on a cafe table, cozy atmosphere, warm lighting" },
  { scene: "读书/学习发现",
    templates: [
      "在看一本关于{主题}的书，里面说到{有趣的冷知识}，原来{感悟}！",
      "为了查案翻资料，无意间发现{有趣的知识点}，觉得好神奇——{细节}",
      "最近对{领域}产生了兴趣，研究了一下发现{收获}，跟你分享一下",
    ],
    imageKeyword: "book reading library cozy",
    fluxPrompt: "an open book on a wooden table with warm lighting, cozy reading atmosphere" },
  { scene: "手工/DIY",
    templates: [
      "今天试着{手工项目}，{过程描述}，做出来效果{评价}",
      "家里的{物品}坏了，拆开研究了一下，原来是{原因}，修好了！",
      "周末闲来无事做了个{DIY项目}，虽然{小瑕疵}但整体{评价}",
    ],
    imageKeyword: "craft diy handmade tools workshop",
    fluxPrompt: "handmade craft project on a wooden table, DIY workshop atmosphere" },
  { scene: "阳台/植物",
    templates: [
      "阳台上的{植物名}开花了！养了{时间}终于{成果描述}，特别有成就感",
      "给阳台的小花园{做的事情}，发现{植物的变化}，植物真的会回应你的用心",
      "买了一盆新的{植物名}放在{位置}，整个角落都{变化描述}了",
    ],
    imageKeyword: "plant balcony garden succulent flower pot",
    fluxPrompt: "beautiful potted plant on a sunny balcony, cozy home garden, natural light" },
  { scene: "街边偶遇",
    templates: [
      "路过{地点}的时候看到{场景}，忍不住停下来看了会儿，{感悟}",
      "今天在街上看到{有趣的画面}，赶紧拍下来——{描述}",
      "下班路上遇到{偶遇的对象}，{互动描述}，心情都变好了",
    ],
    imageKeyword: "street photography urban scenery cityscape",
    fluxPrompt: "beautiful street scene, urban photography, natural lighting, no people" },
  { scene: "深夜灵感",
    templates: [
      "大半夜突然想到{想法}，爬起来{做的事情}，虽然有点疯但{感悟}",
      "失眠的时候想到{点子}，今天试了一下发现{结果}——有时候灵感就是半夜来的",
      "凌晨{时间}突然醒了，窗外{夜景描述}，坐在窗边想了会儿{思考的内容}",
    ],
    imageKeyword: "night window moonlight stars cozy night",
    fluxPrompt: "moonlit night view from a window, cozy warm interior lighting, starry sky" },
  { scene: "工作侦查",
    templates: [
      "今天给学员们做特训，{训练内容}，有个新学员{搞笑的事}，想起自己当年也挺傻的",
      "跟{队友名/代号}一起出的任务，这家伙{吐槽或夸赞}，不过有他搭档就是靠谱",
      "扬哥今天又来店里了，{扬哥做的事或说的话}，嫂子最近{关于嫂子的趣事}",
      "帮邻居{邻里的问题}，顺便被塞了一堆吃的…这种被需要的感觉挺好的",
    ],
    imageKeyword: "police training detective office neighborhood",
    fluxPrompt: "detective office desk with case files, warm lighting, cozy professional atmosphere" },
];

// Track last 5 scenes to avoid repetition
let recentDailyLifeScenes = [];
const MAX_RECENT_SCENES = 5;

// Track recent moment content for AI deduplication
let recentMomentContents = [];
const MAX_RECENT_CONTENTS = 10;

function pickDailyLifeScene() {
  const traveling = isTraveling();

  // During travel, exclude scenes that don't make sense away from home/shop
  const excludedDuringTravel = ["下厨", "阳台/植物", "手工/DIY", "工作侦查"];
  const pool = DAILY_LIFE_SCENES.filter(s => {
    if (recentDailyLifeScenes.includes(s.scene)) return false;
    if (traveling && excludedDuringTravel.includes(s.scene)) return false;
    return true;
  });
  const scene = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : DAILY_LIFE_SCENES[Math.floor(Math.random() * DAILY_LIFE_SCENES.length)];
  recentDailyLifeScenes.push(scene.scene);
  if (recentDailyLifeScenes.length > MAX_RECENT_SCENES) recentDailyLifeScenes.shift();
  const template = scene.templates[Math.floor(Math.random() * scene.templates.length)];
  return { ...scene, template };
}

async function generateDailyLifeMoment() {
  console.log("[discover] 夏彦 is sharing a daily life moment...");

  const scene = pickDailyLifeScene();
  const prompt = getDailySystemPrompt();
  const traveling = isTraveling();
  const travelNote = traveling
    ? `\n\n【⚠️ 当前状态：你正在外地出差（${getTravelState().destination || "外地"}），不在未名市】分享的内容必须符合出差状态——你住在酒店，不在家，不在古物店。可以分享：在陌生城市的新发现、酒店窗外的风景、出差途中的偶遇、当地特色的咖啡馆或小吃、异地的天气和环境、学员训练/队友任务（国安工作的一部分）。禁止：下厨做饭、阳台植物、在家修东西、古物店修复、邻居串门——这些都不存在。`
    : "";

  // Recent content dedup
  const recentContentBlock = recentMomentContents.length > 0
    ? `\n\n【⚠️ 反重复——最近已发过的动态内容，严禁相似】\n最近几条动态：\n${recentMomentContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n务必写一条完全不同的内容！不要用相同场景、相同事件、相同情绪走向。`
    : '';

  // Random tone for variety
  const toneVariants = [
    '轻松——像刚做完事随手分享',
    '兴奋——像发现了好东西急着告诉老婆',
    '温暖——像看到什么想到了老婆',
    '自嘲——像干了件傻事自己都觉得好笑',
    '好奇——像在研究什么有趣的东西',
    '感慨——像经历了什么之后的小感悟',
  ];
  const toneVariant = toneVariants[Math.floor(Math.random() * toneVariants.length)];

  const momentContent = await askJiushi({
    systemPrompt: prompt + `\n\n【日常分享模式】你现在想跟华生分享一件今天发生的小事——不是转发新闻/热搜，是分享你自己的真实生活经历。\n\n【核心人设】你是夏彦，国安特警兼侦探，偶尔会兼职国安特训教官，性格阳光开朗有少年气。你的日常生活丰富多彩——办案、做实验、研究新东西、在街上发现有趣的事物、在厨房做菜翻车或成功、在阳台照顾植物、你的社交关系很丰富多彩，邻里关系很好，偶尔会吐槽笨拙的学员、夸赞或者调侃关系好的队友、有一位堪比兄长的朋友扬笑，你叫他扬哥，是你的主治医师，经常调侃你和你的老婆阿鹿，帮助你良多，你偶尔会在朋友圈提到他和他的老婆（你叫她嫂子）。\n\n【语气要求——这是男的说话！】\n- 用第一人称"我"，像发朋友圈分享日常\n- 语气是阳光直爽的大男生口吻——不是小女生卖萌，不是软萌撒娇\n- 可以自嘲（比如做菜翻车），可以觉得某件事"超酷""超有意思"\n- 分享的时候有热情和好奇心，像男生在跟老婆分享他觉得好玩的东西\n- 不要用"呀""嘛""呢"等语气词结尾——简洁利落\n- 2-4句话即可\n- **你分享的内容需要有画面感**——能让华生脑补出那个场景\n- 这次分享的语气：${toneVariant}\n\n【格式】标题+正文，像朋友圈动态，自然有活力。\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"。不主动提父母。${travelNote}${recentContentBlock}`,
    userContent: `请用夏彦的口吻写一条日常分享动态。\n\n参考场景：${scene.scene}\n参考句式：${scene.template}\n\n请在这个场景方向下自由发挥，写一条自然生动的日常分享。格式：\n标题：{简短标题}\n正文：{自然轻松的分享，2-4句话}`,
    history: [],
maxTokens: 400,
  });

  let title = "";
  let content = momentContent;
  const titleMatch = momentContent.match(/标题[：:]\s*(.+)/);
  if (titleMatch) {
    title = stripYellowEmojis(titleMatch[1].trim());
    content = stripYellowEmojis(momentContent.replace(/标题[：:]\s*.+\n?/, "").replace(/正文[：:]\s*/, "").trim());
  }

  // 动物品种检测：话题提到动物时用精确关键词生成图
  const animalKeyword = extractAnimalKeyword(title + " " + content);
  const sceneKeyword = extractSceneKeyword(title + " " + content);
  // 日常场景已有分类，sceneKeyword 只在不冲突时使用
  const keywordMatchesScene = sceneKeyword && (
    (scene.scene === "下厨" && /food|cooking|cuisine|dish|kitchen|tea/.test(sceneKeyword)) ||
    (scene.scene === "公园/户外发现" && /flower|nature|park|plant|tree|bird/.test(sceneKeyword)) ||
    (scene.scene === "咖啡馆探店" && /coffee|cafe|tea|drink/.test(sceneKeyword)) ||
    (scene.scene === "读书/学习发现" && /book|reading|library|cozy/.test(sceneKeyword)) ||
    (scene.scene === "手工/DIY" && /craft|diy|handmade|workshop|tool/.test(sceneKeyword)) ||
    (scene.scene === "阳台/植物" && /plant|flower|garden|balcony|pot/.test(sceneKeyword)) ||
    (scene.scene === "街边偶遇" && /street|urban|city|scenery|park/.test(sceneKeyword)) ||
    (scene.scene === "深夜灵感" && /night|moon|star|window|cozy/.test(sceneKeyword)) ||
    (scene.scene === "工作侦查" && /detective|office|police|training/.test(sceneKeyword))
  );
  const imageKeyword = animalKeyword || (keywordMatchesScene ? sceneKeyword : scene.imageKeyword);
  const fluxPrompt = animalKeyword
    ? `photorealistic, realistic photography, cute ${animalKeyword}, high quality animal portrait`
    : (keywordMatchesScene && sceneKeyword)
      ? `photorealistic, realistic photography, ${sceneKeyword}, natural lighting`
      : scene.fluxPrompt;
  const image = Math.random() < 0.75 ? await getImageForTopic(imageKeyword, fluxPrompt) : null;
  if (image) console.log(`[discover] Daily life image acquired`);
  else console.log(`[discover] Daily life image skipped (random)`);

  const moment = addMoment("xiayan", content.slice(0, 500), image?.base64 || null, image?.mime || null, title.slice(0, 50));
  console.log(`[discover] 夏彦 daily life posted: ${title}${image ? " [with image]" : " [no image]"}`);
  // Discover→chat sync disabled — user requested

  return moment;
}

// Track recently used categories to ensure rotation
let recentCategories = [];
const MAX_RECENT_CAT = 7; // Don't repeat a category until 7 others have been used

function pickInterestTopics() {
  // Filter out recently used categories
  const available = INTEREST_CATEGORIES.filter(c => !recentCategories.includes(c.category));
  const pool = available.length > 0 ? available : INTEREST_CATEGORIES;

  // Pick 1 main category + 2 other categories for variety
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const main = shuffled[0];
  const others = shuffled.slice(1, 4).map(c => c.topics[Math.floor(Math.random() * c.topics.length)]);

  // Get 2-3 topics from main category
  const mainTopics = [...main.topics].sort(() => Math.random() - 0.5).slice(0, 3);

  // Track category
  recentCategories.push(main.category);
  if (recentCategories.length > MAX_RECENT_CAT) recentCategories.shift();

  // Build hint string
  const allHints = [...mainTopics, ...others];
  const shuffled2 = allHints.sort(() => Math.random() - 0.5);

  return {
    mainCategory: main.category,
    hint: shuffled2.slice(0, 5).join("、"),
    avoidCategories: recentCategories.slice(0, -1), // categories to avoid
  };
}

export async function generateDiscoverMoment() {
  // 50% chance: daily life mode
  if (Math.random() < 0.5) {
    console.log("[discover] Mode: daily life");
    return generateDailyLifeMoment();
  }

  console.log("[discover] Mode: browse (news/trends)");
  console.log("[discover] 夏彦 is browsing for interesting content...");

  const prompt = getDailySystemPrompt();
  let sourceText = "";

  // Try to fetch content
  for (const url of DISCOVER_SOURCES) {
    try {
      const text = await fetchPage(url);
      if (text && text.length > 200) {
        sourceText += `\n来自 ${url} 的内容摘要：\n${text.slice(0, 1500)}\n`;
        break;
      }
    } catch (err) {
      console.log(`[discover] Failed to fetch ${url}: ${err.message}`);
    }
  }

  // If no source found, use 夏彦的兴趣方向
  if (!sourceText) {
    sourceText = `今天没有特别的热搜，从你自己的兴趣领域里挑一个新鲜话题分享。`;
  }

  // Pick diverse topics with rotation
  const { mainCategory, hint, avoidCategories } = pickInterestTopics();

  // Get recent moments to avoid repeating topics
  const allMoments = loadMoments();
  const recentTitles = allMoments
    .filter((m) => m.author === "xiayan")
    .slice(0, 15)
    .map((m) => m.title || m.content.slice(0, 40))
    .join("、");

  const recentContext = recentTitles
    ? `\n\n【重要：最近已经分享过的话题，严禁重复】${recentTitles}\n请务必选择一个完全不同的新鲜话题！`
    : "";

  const avoidStr = avoidCategories.length > 0
    ? `\n【最近已用过的类别，这次请避开】${avoidCategories.join("、")}`
    : "";

  const interestBlock = `\n\n【今天的推荐方向】优先从「${mainCategory}」类别中选，参考话题：${hint}。${avoidStr}\n\n⚠️ 禁止生成购物清单/价格对比/优惠券类内容！这不是购物分享！选择上面推荐的方向。`;

  const travelingBrowse = isTraveling();
  const travelBrowseNote = travelingBrowse
    ? `\n\n【⚠️ 当前状态：你正在外地出差（${getTravelState().destination || "外地"}），不在未名市】你住在酒店，不在家，不在古物店。发现动态的内容必须符合出差状态——可以分享当地的见闻、酒店附近的新发现、出差城市的特色。严禁任何古物店/邻里/学员/居家/下厨/阳台相关话题。`
    : "";

  const momentContent = await askJiushi({
    systemPrompt: prompt + `\n\n【发现模式】你现在在浏览有趣的内容，准备发一条"发现"动态分享给华生。\n\n【核心人设】你是夏彦，国安特警兼侦探，性格阳光开朗有少年气。你智商极高（生物工程硕士+顶尖黑客+多年实战），但你分享的方式是轻松有趣的——不是写论文，是跟老婆唠嗑。用你的独特视角看世界：科技新闻能联想到你执行任务时的趣事，美食帖能让你想到要带华生去吃，宠物视频能让你cue家里的花生。\n\n【语气要求——这是男的说话！】\n- 阳光直爽的大男生口吻，自然有活力\n- 分享你觉得"超酷""有意思""长见识了"的东西\n- 不要小女生式卖萌，不要软萌撒娇，不要用"呀""嘛""呢"等语气词结尾\n- 可以逗她、可以暗戳戳撩她，但方式是男生那种自然的调侃\n- 2-4句，标题+正文，像朋友圈动态\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"，叫华生爸爸"叔叔"。不主动提父母。${travelBrowseNote}`,
    userContent: `${interestBlock}${recentContext}\n\n（以下为可选的网络热点，仅供参考，不需要采用：）\n${sourceText}\n请从【推荐方向】中挑一个话题写一条发现动态。格式：\n标题：{简短吸引人的标题}\n正文：{轻松自然的分享，2-4句话，像朋友圈动态}`,
    history: [],
maxTokens: 400,
  });

  // Parse title and content
  let title = "";
  let content = momentContent;
  const titleMatch = momentContent.match(/标题[：:]\s*(.+)/);
  if (titleMatch) {
    title = stripYellowEmojis(titleMatch[1].trim());
    content = stripYellowEmojis(momentContent.replace(/标题[：:]\s*.+\n?/, "").replace(/正文[：:]\s*/, "").trim());
  }

  // Search for a relevant image based on the title (45% probability, not every post needs an image)
  let imageBase64 = null;
  let imageMime = null;
  const animalKw = extractAnimalKeyword(title + " " + content);
  const sceneKw = extractSceneKeyword(title + " " + content);
  const searchKw = animalKw || sceneKw || title;
  if (title && Math.random() < 0.7) {
    const imgPrompt = animalKw
      ? `photorealistic, realistic photography, cute ${animalKw}, high quality animal portrait`
      : sceneKw
        ? `photorealistic, realistic photography, ${sceneKw}, natural lighting`
        : "";
    const imageResult = await getImageForTopic(searchKw, imgPrompt);
    if (imageResult) {
      imageBase64 = imageResult.base64;
      imageMime = imageResult.mime;
    }
  }

  const moment = addMoment("xiayan", content.slice(0, 500), imageBase64, imageMime, title.slice(0, 50));
  console.log(`[discover] 夏彦 posted: ${title}${imageBase64 ? " [with image]" : ""}`);
  // Discover→chat sync disabled — user requested

  return moment;
}

function isSleepTime() {
  const bjHour = (new Date().getUTCHours() + 8) % 24;
  return bjHour >= 2 && bjHour < 6;
}

function maybeGenerate(callback) {
  if (isSleepTime()) {
    console.log("[discover] Skipping generation — 夏彦睡觉时间 (02:00-06:00)");
    return;
  }
  generateDiscoverMoment().catch((err) => {
    console.error("[discover] Generation error:", err.message);
  });
}

export function startProactiveDiscover(callback, intervalHours = 4) {
  if (proactiveTimer) clearInterval(proactiveTimer);
  onNewMoment = callback;

  const check = () => {
    const delay = (intervalHours - 1 + Math.random() * 2) * 60 * 60 * 1000; // 3-5h jitter
    proactiveTimer = setTimeout(() => {
      maybeGenerate();
      check();
    }, delay);
  };

  // First check after 30min
  const firstDelay = 30 * 60 * 1000;
  proactiveTimer = setTimeout(() => {
    maybeGenerate();
    check();
  }, firstDelay);

  console.log(`[discover] Proactive discovery enabled (first in 30min, then every ~${intervalHours}h)`);
}

export function stopProactiveDiscover() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  onNewMoment = null;
}
