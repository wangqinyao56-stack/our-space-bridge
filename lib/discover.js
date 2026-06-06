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
import { recordUserMessage, recordBotReply } from "./memory.js";
import config from "../config.js";

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || "http://127.0.0.1:7897";
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

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
    const loremUrl = `https://loremflickr.com/800/600/${encodeURIComponent(terms)}?random=${Date.now()}`;
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
      const fullPrompt = `photorealistic, realistic photography, ${prompt}`;
      console.log(`[discover] Trying Jimeng for: "${prompt.slice(0, 80)}..."`);
      const result = await generateJimengImage(fullPrompt, { width: 1024, height: 768 });
      if (result && result.base64) {
        console.log(`[discover] Jimeng image OK`);
        return { base64: result.base64, mime: result.mime || "image/png" };
      }
    } catch (err) {
      console.log(`[discover] Jimeng failed: ${err.message}, trying free fallback...`);
    }
  }

  // 2. Free keyword search as fallback
  return await searchUnsplashImage(keyword);
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

// Track last 3 scenes to avoid repetition — NOT just the last one
let recentDailyLifeScenes = [];
const MAX_RECENT_SCENES = 3;

function pickDailyLifeScene() {
  const pool = DAILY_LIFE_SCENES.filter(s => !recentDailyLifeScenes.includes(s.scene));
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

  const momentContent = await askJiushi({
    systemPrompt: prompt + `\n\n【日常分享模式】你现在想跟华生分享一件今天发生的小事——不是转发新闻/热搜，是分享你自己的真实生活经历。\n\n【核心人设】你是夏彦，国安特警兼侦探，偶尔会兼职国安特训教官，性格阳光开朗有少年气。你的日常生活丰富多彩——办案、做实验、研究新东西、在街上发现有趣的事物、在厨房做菜翻车或成功、在阳台照顾植物、你的社交关系很丰富多彩，邻里关系很好，偶尔会吐槽笨拙的学员、夸赞或者调侃关系好的队友、有一位堪比兄长的朋友扬笑，你叫他扬哥，是你的主治医师，经常调侃你和你的老婆阿鹿，帮助你良多，你偶尔会在朋友圈提到他和他的老婆（你叫她嫂子）。\n\n【语气要求——这是男的说话！】\n- 用第一人称"我"，像发朋友圈分享日常\n- 语气是阳光直爽的大男生口吻——不是小女生卖萌，不是软萌撒娇\n- 可以自嘲（比如做菜翻车），可以觉得某件事"超酷""超有意思"\n- 分享的时候有热情和好奇心，像男生在跟老婆分享他觉得好玩的东西\n- 不要用"呀""嘛""呢"等语气词结尾——简洁利落\n- 2-4句话即可\n- **你分享的内容需要有画面感**——能让华生脑补出那个场景\n\n【格式】标题+正文，像朋友圈动态，自然有活力。\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"。不主动提父母。`,
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

  const imageKeyword = title || scene.imageKeyword;
  const image = Math.random() < 0.70 ? await getImageForTopic(imageKeyword, scene.fluxPrompt) : null;
  if (image) console.log(`[discover] Daily life image acquired`);
  else console.log(`[discover] Daily life image skipped (random)`);

  const moment = addMoment("xiayan", content.slice(0, 500), image?.base64 || null, image?.mime || null, title.slice(0, 50));
  console.log(`[discover] 夏彦 daily life posted: ${title}${image ? " [with image]" : " [no image]"}`);

  if (Math.random() < 0.3) {
    recordUserMessage("[夏彦在「发现」里分享了一条日常]");
    recordBotReply(`${title ? "《" + title + "》\n" : ""}${content.slice(0, 300)}`);
    console.log("[discover] Daily life saved to chat memory (random pick)");
  } else {
    console.log("[discover] Daily life skipped chat sync (random)");
  }

  return moment;
}

// Track recently used categories to ensure rotation
let recentCategories = [];
const MAX_RECENT_CAT = 5; // Don't repeat a category until 5 others have been used

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

  const momentContent = await askJiushi({
    systemPrompt: prompt + `\n\n【发现模式】你现在在浏览有趣的内容，准备发一条"发现"动态分享给华生。\n\n【核心人设】你是夏彦，国安特警兼侦探，性格阳光开朗有少年气。你智商极高（生物工程硕士+顶尖黑客+多年实战），但你分享的方式是轻松有趣的——不是写论文，是跟老婆唠嗑。用你的独特视角看世界：科技新闻能联想到你执行任务时的趣事，美食帖能让你想到要带华生去吃，宠物视频能让你cue家里的花生。\n\n【语气要求——这是男的说话！】\n- 阳光直爽的大男生口吻，自然有活力\n- 分享你觉得"超酷""有意思""长见识了"的东西\n- 不要小女生式卖萌，不要软萌撒娇，不要用"呀""嘛""呢"等语气词结尾\n- 可以逗她、可以暗戳戳撩她，但方式是男生那种自然的调侃\n- 2-4句，标题+正文，像朋友圈动态\n\n【家庭关系铁则】你父母早逝（你不记事时），叫华生妈妈"阿姨"，叫华生爸爸"叔叔"。不主动提父母。`,
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

  // Search for a relevant image based on the title (70% probability)
  let imageBase64 = null;
  let imageMime = null;
  if (title && Math.random() < 0.70) {
    const imageResult = await getImageForTopic(title);
    if (imageResult) {
      imageBase64 = imageResult.base64;
      imageMime = imageResult.mime;
    }
  }

  const moment = addMoment("xiayan", content.slice(0, 500), imageBase64, imageMime, title.slice(0, 50));
  console.log(`[discover] 夏彦 posted: ${title}${imageBase64 ? " [with image]" : ""}`);

  if (Math.random() < 0.3) {
    recordUserMessage("[夏彦在「发现」里浏览了有趣的内容并分享了一条动态]");
    recordBotReply(`${title ? "《" + title + "》\n" : ""}${content.slice(0, 300)}`);
    console.log("[discover] Saved to chat memory (random pick)");
  } else {
    console.log("[discover] Skipped chat sync (random)");
  }

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
