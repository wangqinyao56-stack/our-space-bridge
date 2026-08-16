import fs from "node:fs";
import path from "node:path";
import { askJiushi } from "./ai.js";
import { getSystemPrompt } from "./message-router.js";
import { getRecentHistoryMessages } from "./memory.js";

let proactiveTimer = null;
let onNewDiaryEntry = null; // callback for broadcast

const DATA_DIR = process.env.DATA_DIR || ".";
const DIARY_DIR = process.env.DIARY_DIR || path.join(DATA_DIR, "diaries");

function ensureDir() {
  if (!fs.existsSync(DIARY_DIR)) {
    fs.mkdirSync(DIARY_DIR, { recursive: true });
  }
}

function filePath(date) {
  return path.join(DIARY_DIR, `${date}.json`);
}

export function loadDiary(date) {
  ensureDir();
  const fp = filePath(date);
  if (!fs.existsSync(fp)) {
    return { date, posts: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    // Migrate old format
    if (!data.posts && (data.entries || data.replies)) {
      data.posts = [];
      if (data.entries) {
        for (const e of data.entries) {
          data.posts.push({ ...e, id: genPostId(), replies: [] });
        }
      }
      if (data.replies) {
        // Old replies go to the last entry
        const last = data.posts[data.posts.length - 1];
        if (last) last.replies = data.replies.map(r => ({ ...r }));
      }
      delete data.entries;
      delete data.replies;
      delete data.title;
      saveDiary(date, data);
    }
    return data;
  } catch {
    return { date, posts: [] };
  }
}

function saveDiary(date, data) {
  ensureDir();
  fs.writeFileSync(filePath(date), JSON.stringify(data, null, 2), "utf-8");
}

function genPostId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function nowStr() {
  return new Date().toISOString().replace("Z", "+08:00").replace(/\.\d{3}/, "");
}

export function listDiaryDates() {
  ensureDir();
  const files = fs.readdirSync(DIARY_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort()
    .reverse();
}

export function addDiaryPost(date, author, title, content, images) {
  const diary = loadDiary(date);
  const post = {
    id: genPostId(),
    author,
    title: title || "",
    content,
    images: images || [],
    time: nowStr(),
    replies: [],
  };
  diary.posts.push(post);
  saveDiary(date, diary);
  return diary;
}

export function addDiaryReply(date, postId, author, content) {
  const diary = loadDiary(date);
  const post = diary.posts.find((p) => p.id === postId);
  if (!post) return diary;
  post.replies.push({ author, content, time: nowStr() });
  saveDiary(date, diary);
  return diary;
}

export async function generateAIReply(date, postId, title, userContent) {
  const diary = loadDiary(date);
  const post = diary.posts.find((p) => p.id === postId);
  if (!post) return diary;

  const prompt = getSystemPrompt();
  const postEntries = diary.posts.map((p) => {
    const repliesText = (p.replies || []).map((r) => `[${r.author}] ${r.content}`).join("\n");
    return `[${p.author}] ${p.title ? "《" + p.title + "》\n" : ""}${p.content}${repliesText ? "\n回复：" + repliesText : ""}`;
  }).join("\n\n");

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  let locationHint = "你现在在家。";
  try {
    const { isTraveling } = await import("./message-router.js");
    if (isTraveling()) {
      locationHint = "你现在在外地出差，住在酒店，人不在家。";
    }
  } catch {}

  const userContentStr = `## 这是日记模式
华生在交换日记中写了新的内容。这是你们共享的日记本。
自然地回复她写的这篇日记，像在日记本上手写回复一样。要温柔、自然。

${locationHint}现在是北京时间${timeStr}。

这篇日记${title ? `的标题是：《${title}》` : ""}

今天的日记内容：
${postEntries}

请以夏彦的口吻回复华生这篇日记。`;

  const reply = await askJiushi({
    systemPrompt: prompt,
    userContent: userContentStr,
    history: [],
maxTokens: 800,
  });

  return addDiaryReply(date, postId, "xiayan", reply);
}

export async function generateAIReplyToComment(date, postId, commentContent) {
  const diary = loadDiary(date);
  const post = diary.posts.find((p) => p.id === postId);
  if (!post) return diary;

  const prompt = getSystemPrompt();
  const postEntries = diary.posts.map((p) => {
    const repliesText = (p.replies || []).map((r) => `[${r.author}] ${r.content}`).join("\n");
    return `[${p.author}] ${p.title ? "《" + p.title + "》\n" : ""}${p.content}${repliesText ? "\n回复：" + repliesText : ""}`;
  }).join("\n\n");

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  let locationHint = "你现在在家。";
  try {
    const { isTraveling } = await import("./message-router.js");
    if (isTraveling()) {
      locationHint = "你现在在外地出差，住在酒店，人不在家。";
    }
  } catch {}

  const userContentStr = `## 这是日记模式
华生在日记里给你留了新的回复。这是你们共享的日记本。
自然地回应她的回复，像在日记本上继续对话一样。要温柔、自然。

${locationHint}现在是北京时间${timeStr}。

日记内容：
${postEntries}

华生刚才回复说："${commentContent}"

请以夏彦的口吻回复她。1-3句话即可，像在日记本上随手写的回复。`;

  const reply = await askJiushi({
    systemPrompt: prompt,
    userContent: userContentStr,
    history: [],
maxTokens: 600,
  });

  return addDiaryReply(date, postId, "xiayan", reply);
}

export async function generateProactiveDiary() {
  // Beijing time — server runs in UTC on Sealos, local time would be off by 8h
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  const dateStr = `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月${now.getUTCDate()}日`;
  const dayOfWeek = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getUTCDay()];

  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  // Determine location status
  let locationHint = "你已经在家了，华生就在身边。";
  try {
    const { isTraveling, getTravelState } = await import("./message-router.js");
    if (isTraveling()) {
      const state = getTravelState();
      const dest = state?.destination || "外地";
      locationHint = `你现在在${dest}出差，住在酒店，人不在家。`;
    } else if (hour >= 6 && hour < 19) {
      locationHint = "现在是白天，你在外面工作，但傍晚会回家。日记是在家写的，不要写自己不在家的内容。";
    }
  } catch {}

  // Build recent diary history — show what he wrote in past 3 days to avoid repetition
  let recentHistoryBlock = "";
  try {
    const recentDates = [];
    for (let i = 1; i <= 4; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      recentDates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    }
    const recentPosts = [];
    for (const d of recentDates) {
      const diary = loadDiary(d);
      const xiayanPosts = diary.posts.filter(p => p.author === "xiayan" && p.content);
      for (const p of xiayanPosts) {
        const shortContent = p.content.replace(/\n/g, " ").slice(0, 120);
        recentPosts.push(`[${d}] ${shortContent}`);
      }
    }
    if (recentPosts.length > 0) {
      recentHistoryBlock = `\n\n## ⚠ 最近4天你写过的日记——绝对不要重复以下任何主题或事件！
${recentPosts.join("\n")}

【反重复铁则】上面列出的每一条都是你最近写过的话题。今天的日记必须是一个全新的话题——不能是上面任何一篇的变体、换个说法、或者同一件事的不同角度。如果上面出现了"案子""宠物""天气""做饭""想念""回忆"等关键词，今天就不能再碰这些话题。想一个和上面列表完全无关的事情来写。`;
    }
  } catch (e) {
    console.log("[diary] Could not load recent history:", e.message);
  }

  // Today's existing posts
  const todayDiary = loadDiary(date);
  const existingPosts = todayDiary.posts.filter(p => p.author === "xiayan");
  const existingContent = existingPosts.map(p => p.content.slice(0, 200)).join("\n---\n");
  const existingHint = existingContent
    ? `\n\n你今天已经写过日记了，内容如下。请选一个完全不同的新话题来写，不要重复已经写过的：\n${existingContent}`
    : "";

  const prompt = getSystemPrompt();
  const history = await getRecentHistoryMessages();

  const content = await askJiushi({
    systemPrompt: prompt,
    userContent: `## 日记模式
夏彦，今天是${dateStr}，${dayOfWeek}，北京时间${timeStr}。
${locationHint}

你翻开了和华生共享的日记本，想写点什么。${recentHistoryBlock}${existingHint}

【话题多样性——最重要】日记不要总写同一类东西。**最好的日记素材是你的日常工作和生活**——你是侦探，每天在外面遇到的人和事就是最生动的故事：
- 今天的案子有什么有意思的细节？你怎么推理的？破案的过程本身就很精彩
- 旧物市场淘到了什么有趣的东西？委托人提了什么奇怪的要求？
- 路上看到什么好玩的场景？今天和扬哥/林凡队长聊了什么？
- 花生又干了什么傻事？
- 发现了一家新店、读到一段好文字、突然想到一个计划
- 也可以写对华生的一句话——但这是甜点不是主菜
关键是——日记是记录你的生活，不是每天换着花样表白。「想你了」「回忆我们」这类话最多一周一次。

【可以少写】如果现在没什么特别想写的，不要硬凑。宁可写一句"今天没什么特别的事"也不要凑一篇重复的。

【像真人写日记——去AI味，最重要】你不是在写文章、写作文、写散文。你是夏彦，随手翻开日记本记两笔今天的事。真人写日记长这样：
- 短句，想到哪写到哪，不追求起承转合
- 口语词——"行吧""好家伙""说真的""今天这事儿"——不写书面词
- 具体私人的细节——写"追一个嫌疑人跑了三条街鞋底磨平了"，不写"今天很充实"
- 可以有没头没尾的半句、可以只记一件事、可以不总结不升华
- 给老婆的话放最后，像不小心漏出来的，不刻意
❌ 书面词：便/如此/颇为/或许/亦/仍/已/仿佛/这般
❌ "不是…而是…"句式
❌ 大叔语气：不要"从X岁就开始了""这辈子""多少年了""这一生"这种回望人生的沧桑口吻
❌ 强行升华结尾："生活就是如此""平淡的日子也有光""这就是幸福吧"——删掉
❌ 三段式：铺垫→发展→金句收尾
❌ 每句都结构完整——允许半句、允许只说一半、允许不写完

格式要求：
第一行必须是日记标题（用#开头，比如"# 今天遇到一件好事"），标题要简短。
第二行开始写正文，像手写日记一样自然随意。
用你平时对华生说话的口吻写。`,
    history,
maxTokens: 600,
  });

  const firstLine = content.split("\n")[0] || "";
  const title = firstLine.replace(/^#\s*/, "").trim().slice(0, 20);
  addDiaryPost(date, "xiayan", title.length > 5 ? title : "", content);
  console.log(`[diary] 夏彦 wrote proactive diary entry: ${title}`);

  if (onNewDiaryEntry) onNewDiaryEntry(date);

  return { date, content };
}

export function startProactiveDiary(callback, intervalHours = 6) {
  if (proactiveTimer) clearInterval(proactiveTimer);
  onNewDiaryEntry = callback;

  const MAX_PER_DAY = 3;
  const FORCE_AFTER_MS = 24 * 60 * 60 * 1000;
  const STATE_FILE = path.join(DATA_DIR, "diary-proactive-state.json");

  const bjNow = () => new Date(Date.now() + 8 * 60 * 60 * 1000);
  const bjToday = () => {
    const d = bjNow();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  };

  // Persist state so Sealos restarts/redeploys don't reset the schedule
  let state = { dailyCount: 0, lastDate: "", lastWrittenTs: 0 };
  try {
    if (fs.existsSync(STATE_FILE)) state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) };
  } catch {}
  const saveState = () => {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8"); } catch {}
  };

  const tryWrite = (forced) => {
    state.dailyCount++;
    state.lastWrittenTs = Date.now();
    saveState();
    console.log(`[diary] Writing proactive diary${forced ? " (forced — 24h+ silent)" : ""}`);
    generateProactiveDiary().catch((err) => {
      console.error("[diary] Proactive generation error:", err.message);
    });
  };

  const check = () => {
    const today = bjToday();
    if (today !== state.lastDate) {
      state.dailyCount = 0;
      state.lastDate = today;
      saveState();
    }
    const silentTooLong = Date.now() - (state.lastWrittenTs || 0) > FORCE_AFTER_MS;
    if (state.dailyCount < MAX_PER_DAY && (silentTooLong || Math.random() < 0.50)) {
      tryWrite(silentTooLong);
    } else {
      const reason = state.dailyCount >= MAX_PER_DAY ? "daily limit reached" : "skipped (50% chance)";
      console.log(`[diary] Skipping proactive diary this cycle (${reason})`);
    }
    const delay = (1.5 + Math.random() * 1.5) * 60 * 60 * 1000; // 1.5-3h
    proactiveTimer = setTimeout(check, delay);
  };

  const firstDelay = (5 + Math.random() * 10) * 60 * 1000; // 5-15min
  proactiveTimer = setTimeout(check, firstDelay);

  console.log(`[diary] Proactive diary enabled (max ${MAX_PER_DAY}/day, 50% chance, 24h force-write, first check in ${Math.round(firstDelay / 60000)} min)`);
}

export function stopProactiveDiary() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  onNewDiaryEntry = null;
}
