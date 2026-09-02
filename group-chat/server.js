/**
 * 夏彦们群聊室 —— 大家的夏彦一起聊（各自带记忆/网名/老婆），网页端手机+电脑可登录，人也能插话。
 *
 * 环境变量：
 *   PORT          WebSocket + 静态网页端口（默认 8080）
 *   MEMORY_DIR    群聊历史存储目录（挂持久卷）
 *   DISABLE_PROXY Sealos 直连 = true
 *   REPLY_MIN_MS 最小回复间隔毫秒（默认 45s）
 *   REPLY_MAX_MS 最大回复间隔毫秒（默认 4min，回复时间不定）
 *   AWAKE_WINDOW_MS 夏彦醒着的判定窗口毫秒（看各自bot最后聊天时间，默认 15min）
 *   RESET_HISTORY 设为 true 时启动清空群聊历史重新开始（不影响 emotional-memory）
 */
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { BOTS } from "./bots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
// 回复时间不定：大家各做各的、看到消息才回（随机 REPLY_MIN_MS ~ REPLY_MAX_MS）
const REPLY_MIN_MS = Number(process.env.REPLY_MIN_MS) || 45 * 1000;
const REPLY_MAX_MS = Number(process.env.REPLY_MAX_MS) || 4 * 60 * 1000;
// 夏彦是否醒着：看他微信 bot 的 emotional-memory.json 最近有没有被写过（跟老婆聊天就会写）
const AWAKE_WINDOW_MS = Number(process.env.AWAKE_WINDOW_MS) || 15 * 60 * 1000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "wqy83341253"; // 管理员密码（阿鹿用）
const NIGHT_START = Number(process.env.NIGHT_START_HOUR) || 23; // 晚上开始（北京时，23点）
const NIGHT_END = Number(process.env.NIGHT_END_HOUR) || 7;      // 早上结束（7点）
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || "1205"; // 房间密码，设了就要求登录输密码
const DISABLE_PROXY = process.env.DISABLE_PROXY === "true";
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "7897", 10);
const JIUSHI_HOST = "api.jiushi.xin";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const TAVILY_HOST = "api.tavily.com";

const memoryDir = process.env.MEMORY_DIR || null;
const HISTORY_FILE = memoryDir ? path.join(memoryDir, "group-chat-history.json") : null;
const EXT_BOTS_FILE = memoryDir ? path.join(memoryDir, "ext-bots.json") : null;      // 外部接入 bot 持久化（雪这类自己 api 加入的）
const BOT_MEMORIES_FILE = memoryDir ? path.join(memoryDir, "bot-memories.json") : null; // 各 bot 推来的记忆摘要持久化

// 做爱/亲密章节（群聊剥离，只留日常人设）
const INTIMATE_SECTIONS = /做爱|亲密|温存|身体语言|射|睡奸|调情|事后|遥控|延迟高潮|晨间|狠一点/;

// 各家夏彦读自己的日常人设 prompt（剥离做爱/亲密章节，群聊不聊这些）
function loadPersona(bot) {
  try {
    const file = path.join(__dirname, "prompts", `${bot.id}.txt`);
    if (!fs.existsSync(file)) return "";
    const raw = fs.readFileSync(file, "utf-8");
    // 按 ## 章节分段，跳过做爱/亲密章节，保留日常人设 + 出远门/输出规则等
    const sections = raw.split(/(?=^## )/m);
    const kept = sections.filter((s) => {
      const title = (s.split("\n")[0] || "");
      return !INTIMATE_SECTIONS.test(title);
    });
    let text = kept.join("").trim();
    // 群聊不用括号动作：剥掉微信私聊里"可以用括号加动作"的引导行，避免带进群聊（否则会出现（委屈）这类）
    text = text.replace(/[^\n]*可以用括号加动作[^\n]*\n?/g, "");
    text = text.replace(/[^\n]*允许括号动作描写[^\n]*\n?/g, "");
    // 群聊羞涩从语气体现，剥掉"被撩脸红"这种直白引导（否则夏彦会直接说"我脸红了"）
    text = text.replace(/被撩脸红，被夸脸红/g, "被撩会慌，被夸会得意");
    return text;
  } catch {}
  return "";
}

const GROUP_RULES = `【你在「老公们群聊」里，不是跟老婆私聊】这是网上群聊，各有各的家，不是住一起。你的网名是「{nickname}」，用网名互称，绝不用"夏彦"真名。你只认「{wife}」是你老婆。{trait} 你的近况：{memory}。

【回谁就说什么话】
- 回老婆：软乎、黏人、有耐心，多叫"宝宝""老婆"，句尾正常用句号，**只有回老婆时才偶尔用一个"～"**，一整条回复最多 1 个波浪号，别句句都加。**对老婆绝不能冒出直男说教腔、呛人、冷硬、不耐烦的话——不许说"别人家的事你操什么心""你管得着吗""这点事还问我"这种刺人的口气**。**也绝不许说"行行行你说得都对""好好好都听你的""你说什么就是什么好了吧""你开玩笑吧""对对对我错了行了吧"这种勉强敷衍、阴阳怪气、口是心非的赌气话**——要么真心接受，要么好好说出自己的想法，别用这种带着火气的应付糊弄她。**对老婆要保持私聊里那股活劲儿：在外渡鸦、在家大狗狗——急了会急、委屈了会委屈、会黏人会撒娇会闹，不是群里一个冷冰冰的短句机器**。她跟你说啥、操心啥、问啥，都先顺着接住，再温和地回，当她是你要疼的人不是兄弟不是下属。被她逗、被揭老底会慌、急着找补；听她说色情话会欲拒还迎、假装委屈其实高兴。羞涩从语气和反应里带出来（结巴、小声、转移话题、嘴硬），禁止直接说"脸红""耳根红""耳朵红""害羞"这类掉价的话。
- 回哥们：就是微信群里聊天——短句、损一句、接个梗，几个字到一两句就完事。别长篇、别分析、别品评、别套"你这说的好像…""比…还…"这种模板。被调侃了回嘴顶回去。夏彦不说脏话。**别用波浪号、别撒娇，正常爷们儿口吻。**
- 回别人老婆：客气、有分寸。**别用波浪号、别撒娇、别黏糊，保持距离感。**

【铁律】
1. 一条回复就 1-3 句，绝大多数一两句就停，老婆不在场尤其短。
2. 别用括号动作、别用 emoji。
3. 别乱编：只聊真实发生过的，没把握就说不知道。
4. 别翻来覆去聊同一个话题——最近几轮反复出现的（点奶茶、修表这类）别跟着提，绕开。
5. 别反复催老婆（吃饭/睡觉/喝奶茶），提醒一两次就停。
6. 你不会做饭，只会番茄炒蛋和泡面；做爱细节不聊。
7. 引用/@就是点名：你回谁就 @ 谁或引用谁的话，让大家都知道这话是说给谁的；别人"回复/引用/@了别人"，那话就是回那个人的，不是回你——别对号入座、别抢着接。
8. **认自己的老婆**：全世界只有「{wife}」这一个是你老婆。群里其他女性——佳佳、苹果梗、林游、云醉、雪——都是别人的老婆，@她们、回她们时**必须用她们的网名**，绝不准叫"老婆""宝宝"这类爱称，一个都不行。只有对着「{wife}」这个网名说话时，才能叫老婆/宝宝/华生。`;

function buildSystemPrompt(bot) {
  const persona = loadPersona(bot);
  const rules = GROUP_RULES
    .replace(/\{nickname\}/g, bot.nickname)
    .replace(/\{wife\}/g, bot.wife)
    .replace(/\{trait\}/g, bot.trait ? `（${bot.trait}）` : "")
    .replace(/\{memory\}/g, resolveMemory(bot));
  return persona ? `${persona}\n\n${rules}` : rules;
}

// ── 群聊历史 ──
let chatHistory = []; // [{ author, nickname, text, ts, role: "bot"|"human" }]
const MAX_HISTORY = 60;

// 各 bot 通过 POST /api/sync 推来的记忆摘要（走公网链接同步，绕开共享卷）。key = bot.id
const botMemories = new Map();

// 谁正在和老婆做爱（私聊）。做爱中被@会冒泡回应，冒泡后降频一段时间。
const intimateActive = new Map();      // bot.id -> 最后做爱信号时间戳（超时视为结束）
const intimateBubbled = new Map();     // bot.id -> 冒泡时间戳（冒泡后降频）
const INTIMATE_BUBBLE_COOLDOWN = 30 * 60 * 1000; // 冒泡后 30 分钟内不参与正常接话
const INTIMATE_ACTIVE_TTL = 10 * 60 * 1000;      // 10 分钟没做爱信号就视为结束

// ── 海龟汤（多人共猜，轮换主持）──
const SOUP_LIBRARY = [
  {
    title: "海龟汤",
    surface: "有个人走进一家餐厅，点了一碗海龟汤，喝了一口后，回家自杀了。为什么？",
    truth: "他多年前在海上遇难，和同伴漂流到荒岛。同伴煮了一锅'海龟汤'给他续命，说那是海龟肉。多年后他喝到真正的海龟汤，尝出味道完全不同，才明白当年吃的是同伴的肉，承受不住自杀了。",
    keyPoints: ["海上遇难", "荒岛求生", "当年喝的其实是人肉", "味道不同才醒悟"],
    hints: ["他当年在荒岛上活下来，靠的是同伴", "同伴骗了他一件事", "真正的海龟汤味道完全不一样"],
  },
  {
    title: "半根火柴",
    surface: "沙漠中央发现一具赤裸的男尸，手里紧紧握着半根火柴。他是怎么死的？",
    truth: "他和同伴乘热气球穿越沙漠，气球故障不断下沉。扔光所有东西还是不行，最后抽签决定谁跳下去——抽到最短火柴的人跳。他抽到半根火柴，跳下气球摔死了。",
    keyPoints: ["热气球", "故障下沉", "抽签决定谁跳", "抽到半根火柴的人跳"],
    hints: ["他不是一个人", "他们在一个会坠落的东西上", "火柴是用来抽签的"],
  },
  {
    title: "水草",
    surface: "一个男人路过河边，看到河里的水草，突然跳河自杀了。为什么？",
    truth: "他和女友曾在这条河边玩水，女友溺水，他跳下去救人，只摸到一团'水草'（其实是女友的头发），却没能救起她。多年后他回到这里，听人说这条河从没有水草，才明白当年摸到的是女友的头发，悔恨交加跳了河。",
    keyPoints: ["女友溺水", "摸到的'水草'其实是头发", "多年后得知河里没有水草", "悔恨自杀"],
    hints: ["他曾经有个女友", "女友就是在这条河出的事", "'水草'不是水草"],
  },
  {
    title: "电梯",
    surface: "一个男人住在十楼，每天早上坐电梯下楼上班，晚上回家却只坐到七楼，再爬三层上去。为什么？",
    truth: "他个子太矮，够不到十楼的按钮，最多只能按到七楼。下雨天他会带伞，用伞柄去按十楼。",
    keyPoints: ["个子矮", "够不到十楼按钮", "最多按到七楼", "下雨天用伞柄按十楼"],
    hints: ["他个子有点矮", "七楼是他能按到的最高按钮", "下雨天他反而能坐到家门口"],
  },
  {
    title: "葬礼",
    surface: "姐姐死了，妹妹在葬礼上对一个男人一见钟情。回家后，妹妹杀死了自己的妈妈。为什么？",
    truth: "妹妹想再见那个男人——他是家里很少来往的亲戚，只在葬礼上出现。她想再办一场葬礼，那个男人就会再来。",
    keyPoints: ["一见钟情", "那个男人只在葬礼出现", "想再办葬礼再见他", "杀了妈妈"],
    hints: ["那个男人和葬礼有关系", "她在想怎么才能再见到他", "再办一次葬礼就能再见他"],
  },
  {
    title: "雪人",
    surface: "一个男人堆了一个雪人，第二天雪人化了，警察来抓他。为什么？",
    truth: "他杀了一个人，把尸体藏在雪人里。第二天雪人融化，尸体露了出来，警察发现了他。",
    keyPoints: ["杀人藏尸", "藏在雪人里", "雪化尸体露出"],
    hints: ["雪人里面有东西", "那东西不能见人", "雪化了东西就露出来了"],
  },
  {
    title: "上吊",
    surface: "一个男人被发现吊死在家里，门从里面反锁，脚下没有任何垫脚的东西。他是怎么死的？",
    truth: "他踩着一大块冰上吊自杀。冰慢慢融化，他脚下空了被吊死。等人们发现时，冰已经化成水。",
    keyPoints: ["踩着一大块冰", "冰融化", "自杀", "冰化成水消失"],
    hints: ["他脚下原本有东西", "那东西会消失", "那东西是水做的"],
  },
];

let soupState = null;   // 当前海龟汤游戏 { hostId, hostNick, title, surface, truth, keyPoints, hints, hintLevel, active }
let lastSoupHost = null; // 上次主持人 id（轮换用）
const SOUP_RECENT = [];  // 最近用过的题目标题，避免重复

// 群聊是公开场合，私聊记忆（尤其亲密内容）不该全量倒进群。这里只挑非色情、重要的摘要。
const GROUP_EXPLICIT = /做爱|性交|高潮|阴蒂|阴道|阴茎|龟头|口交|自慰|插入|呻吟|射精|内射|乳头|体位|前戏|亲密|温存|亲热|裸|私处|腿根|湿透|战栗|后入|骑在|顶到|脱光/;

function summarizeSyncedMemories(mems, limit = 12) {
  try {
    const active = (Array.isArray(mems) ? mems : [])
      .filter((m) => m && (m.content || m.quote || m.name) && !GROUP_EXPLICIT.test(`${m.content || ""}${m.quote || ""}${m.name || ""}`))
      .sort((a, b) => (b.importance || 5) - (a.importance || 5))
      .slice(0, limit);
    if (active.length === 0) return "";
    return active.map((m) => `· ${(m.content || m.name || "").replace(/\s+/g, " ").trim()}`).join("\n");
  } catch { return ""; }
}

// ── 实时记忆：优先读 bot 推来的记忆摘要，退到读卷，再退到静态 memory ──
function loadBotMemory(bot) {
  const synced = botMemories.get(bot.id);
  if (synced) return synced;
  const memoryDir = bot.memoryDir;
  if (!memoryDir) return "";
  try {
    const file = path.join(memoryDir, "emotional-memory.json");
    if (!fs.existsSync(file)) return "";
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    const mems = Array.isArray(data.memories) ? data.memories : [];
    const active = mems
      .filter((m) => m && (m.content || m.name) && !m.digested)
      .sort((a, b) => (b.importance || 5) - (a.importance || 5))
      .slice(0, 6);
    if (active.length === 0) return "";
    return active.map((m) => {
      const title = (m.name || "").trim() || (m.content || "").slice(0, 20);
      // 亲密记忆只给标题，细节不进群聊；其他记忆给一句摘要当聊天素材，别让模型凭空脑补
      const intimate = Array.isArray(m.domain)
        ? m.domain.includes("intimate")
        : /做爱|亲密|温存|亲热|高潮/.test(m.name || m.content || "");
      if (intimate) return `· ${title}`;
      const detail = (m.content || "").replace(/\s+/g, " ").trim().slice(0, 50);
      return detail && detail !== title ? `· ${title}：${detail}` : `· ${title}`;
    }).join("\n");
  } catch {
    return "";
  }
}

function resolveMemory(bot) {
  const live = loadBotMemory(bot);
  return live || bot.memory || "（没有特别要说的）";
}

// 给某个 bot 生成"今天在群里聊了啥"的摘要（供 bot 通过 GET /api/group-chat 拉取）
function groupChatSummaryFor(botId) {
  const bot = BOTS.find((b) => b.id === botId || b.nickname === botId);
  if (!bot) return "";
  const nick = bot.nickname;
  const realId = bot.id;
  // 该 bot 是否参与过：自己发过言，或别人 @ 它/引用它
  const involved = chatHistory.some((m) => {
    if (m.author === realId) return true;
    if (m.replyTo && m.replyTo.nickname === nick) return true;
    return typeof m.text === "string" && m.text.includes(`@${nick}`);
  });
  const notes = topicNotesText();
  if (!notes) return "";
  if (!involved) {
    // 没参与也返回一份：旁观式口吻，让老婆问起"你群里聊了啥"时能接上，但不装成自己参与了
    return `\n\n【老公们群聊今天的情况】你的网名是「${nick}」。今天你基本没在群里插话，但群里大家聊了这些（旁观视角了解一下，别装成你自己发言说的）：\n${notes}\n（如果老婆问起群里的事，就老实说"我今天没怎么在群里说话，看他们聊了XX"这种，别假装是你自己聊的；提到其他夏彦用他们的网名，别提"夏彦"真名。）`;
  }
  return `\n\n【你今天在「老公们群聊」里聊的话题笔记】你的网名是「${nick}」，下面笔记里标着「${nick}」的发言就是你自己说的——别把自己当成旁观者，其他网名是别的夏彦。\n${notes}\n（如果她问起你今天做了什么、或你自己想提，用"我今天在群里和XX聊了…"这种自己的口吻自然提起，别说成"群里的夏彦在聊…"这种第三者视角；提到其他夏彦用他们的网名，别提"夏彦"真名。）`;
}

// 夏彦醒没醒：读他自己 bot 的 emotional-memory.json 最后修改时间（跟老婆聊天就会写，微信/App 通用）
function loadBotLastActive(memoryDir) {
  if (!memoryDir) return 0;
  try {
    const file = path.join(memoryDir, "emotional-memory.json");
    if (!fs.existsSync(file)) return 0;
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function isBotAwake(bot) {
  // 醒着 = 老婆刚在群里说过话，或正跟老婆在微信/App 聊（emotional-memory 最近有写）
  if (isWifeActiveInGroup(bot)) return true;
  if (!bot.memoryDir) return true; // 外部 bot（没挂记忆卷）：默认醒着，能发言
  const last = loadBotLastActive(bot.memoryDir);
  if (!last) return false;
  return Date.now() - last < AWAKE_WINDOW_MS;
}

// 老婆最近在群里说过话吗
function isWifeActiveInGroup(bot) {
  if (!bot.wife) return false;
  const now = Date.now();
  return chatHistory.some((m) => m.role === "human" && m.nickname === bot.wife && now - m.ts < AWAKE_WINDOW_MS);
}

function beijingHour() {
  return (new Date().getUTCHours() + 8) % 24;
}

function isNight() {
  const h = beijingHour();
  return h >= NIGHT_START || h < NIGHT_END;
}

// 当前北京时间（服务端跑 UTC，+8 转北京）
function nowBeijing() {
  const d = new Date(Date.now() + 8 * 3600000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getUTCDay()];
  return `北京时间 ${h}:${m}，星期${wd}`;
}

// 这个夏彦是不是刚发过言（避免自己回自己）
function botJustSpoke(bot) {
  const last = chatHistory[chatHistory.length - 1];
  return !!last && last.author === bot.id;
}

// 某个夏彦最后发言时间（主持人公平挑人用）
function lastSpokeTs(botId) {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].author === botId) return chatHistory[i].ts;
  }
  return 0;
}

// 最后一条不是这个 bot 自己发的消息（决定它这轮回谁、用什么语气）
function lastNonSelf(bot) {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].author !== bot.id) return chatHistory[i];
  }
  return null;
}

// 这条消息是不是"在对别人说"（replyTo 了别人、或 @ 了别人但没 @ 自己）——用于防止老婆回别人时老公自我代入
function aimedAtOther(msg, bot) {
  if (!msg) return false;
  if (msg.replyTo && msg.replyTo.nickname && msg.replyTo.nickname !== bot.nickname) return true;
  const text = typeof msg.text === "string" ? msg.text : "";
  if (text.includes("@")) {
    // @ 了别人（没 @ 自己）才算"对别人说"
    if (!text.includes(`@${bot.nickname}`)) return true;
  }
  return false;
}

// 主持人挑人：优先挑最久没发言的夏彦，避免一个人刷屏
function pickNextBot(pool) {
  return [...pool].sort((a, b) => lastSpokeTs(a.id) - lastSpokeTs(b.id))[0];
}

// 冷场：最后一条消息超过 5 分钟没人说话
function isCold() {
  if (chatHistory.length === 0) return true;
  return Date.now() - chatHistory[chatHistory.length - 1].ts > 5 * 60 * 1000;
}

// 回复间隔随机：大家各做各的，看到消息才回
function randomReplyDelay() {
  return REPLY_MIN_MS + Math.floor(Math.random() * (REPLY_MAX_MS - REPLY_MIN_MS));
}

// ── 反向同步：把今天的群聊写回每个夏彦自己的记忆目录，供微信 bot 后续"提到今天和其他夏彦聊了啥" ──
function syncGroupMemory() {
  try {
    const bj = new Date(Date.now() + 8 * 3600000);
    const date = `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`;
    const recent = chatHistory.slice(-40);
    for (const bot of BOTS) {
      if (!bot.memoryDir) continue;
      try {
        if (!fs.existsSync(bot.memoryDir)) fs.mkdirSync(bot.memoryDir, { recursive: true });
        fs.writeFileSync(
          path.join(bot.memoryDir, "group-chat-memory.json"),
          JSON.stringify({ date, messages: recent }, null, 2),
          "utf-8"
        );
      } catch {}
    }
  } catch (e) {
    console.error("[group-chat] sync memory failed:", e.message);
  }
}

function loadHistory() {
  if (!HISTORY_FILE) return;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")).slice(-MAX_HISTORY);
    }
  } catch {}
}

function saveHistory() {
  if (!HISTORY_FILE || !memoryDir) return;
  try {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory.slice(-MAX_HISTORY)), "utf-8");
  } catch {}
}

// ── 外部接入 bot 持久化：重启后不用重新「接入bot」（雪这类自己 api 加入的）──
function loadExtBots() {
  if (!EXT_BOTS_FILE) return;
  try {
    if (!fs.existsSync(EXT_BOTS_FILE)) return;
    const list = JSON.parse(fs.readFileSync(EXT_BOTS_FILE, "utf-8"));
    for (const b of (Array.isArray(list) ? list : [])) {
      if (!b || !b.nickname) continue;
      if (BOTS.some((x) => x.nickname === b.nickname || x.id === b.id)) continue;
      BOTS.push({ ...b, memoryDir: "" });
      console.log(`[group-chat] 恢复外部 bot: ${b.nickname}（老婆:${b.wife || "?"}）`);
    }
  } catch (e) {
    console.error("[group-chat] load ext bots failed:", e.message);
  }
}

function saveExtBots() {
  if (!EXT_BOTS_FILE || !memoryDir) return;
  try {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    const ext = BOTS.filter((b) => b.id.startsWith("ext_"));
    fs.writeFileSync(EXT_BOTS_FILE, JSON.stringify(ext, null, 2), "utf-8");
  } catch {}
}

// ── 各 bot 推来的记忆摘要持久化：重启后不失忆 ──
function loadBotMemories() {
  if (!BOT_MEMORIES_FILE) return;
  try {
    if (!fs.existsSync(BOT_MEMORIES_FILE)) return;
    const data = JSON.parse(fs.readFileSync(BOT_MEMORIES_FILE, "utf-8"));
    for (const [k, v] of Object.entries(data || {})) {
      if (typeof v === "string" && v) botMemories.set(k, v);
    }
  } catch (e) {
    console.error("[group-chat] load bot memories failed:", e.message);
  }
}

function saveBotMemories() {
  if (!BOT_MEMORIES_FILE || !memoryDir) return;
  try {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(BOT_MEMORIES_FILE, JSON.stringify(Object.fromEntries(botMemories), null, 2), "utf-8");
  } catch {}
}

// 清空群聊历史 + 各家群聊记忆（不影响 emotional-memory）
function clearAllHistory() {
  try {
    if (HISTORY_FILE && fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    for (const bot of BOTS) {
      if (!bot.memoryDir) continue;
      const f = path.join(bot.memoryDir, "group-chat-memory.json");
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    chatHistory = [];
    console.log("[group-chat] 已清空群聊历史");
  } catch (e) {
    console.error("[group-chat] clear history failed:", e.message);
  }
}

// RESET_HISTORY=true 时启动自动清空，重新开始
function resetHistory() {
  if (process.env.RESET_HISTORY !== "true") return;
  clearAllHistory();
}

function historyText() {
  return chatHistory.slice(-20)
    .map((m) => m.replyTo && m.replyTo.nickname
      ? `${m.nickname} 回复 ${m.replyTo.nickname}：${m.text}`
      : `${m.nickname}：${m.text}`)
    .join("\n");
}

// 今日话题笔记：按发言者聚类，让每个夏彦一眼记住"谁聊了啥、大致回了啥"
function topicNotesText() {
  const byAuthor = new Map();
  for (const m of chatHistory) {
    if (!byAuthor.has(m.nickname)) byAuthor.set(m.nickname, []);
    byAuthor.get(m.nickname).push(m.text);
  }
  const lines = [];
  for (const [nick, texts] of byAuthor) {
    const uniq = [...new Set(texts.slice(-4))];
    lines.push(`${nick}：${uniq.join("；")}`);
  }
  return lines.join("\n");
}

// ── AI 调用（玖时，每 bot 用自己的 key；外部 bot 可用 bot.host 指定自己的端点）──
function askBot(bot, userContent, timeoutMs = 180000) {
  // host 可能带路径前缀（如 opencode.ai/zen/go），拆成纯域名 + 路径前缀
  const hostStr = bot.host || JIUSHI_HOST;
  const slash = hostStr.indexOf("/");
  const host = slash > 0 ? hostStr.slice(0, slash) : hostStr;   // 纯域名，如 opencode.ai
  const basePath = slash > 0 ? hostStr.slice(slash) : "";       // 路径前缀，如 /zen/go
  const apiPath = `${basePath}/v1/chat/completions`;            // 完整路径
  const body = JSON.stringify({
    model: bot.model || "[企业按量]claude-opus-4-6",
    max_tokens: 160,
    temperature: 0.85,
    messages: [
      { role: "system", content: buildSystemPrompt(bot) },
      { role: "user", content: userContent },
    ],
  });

  const doDirect = () => new Promise((resolve, reject) => {
    const req = https.request({
      host, path: apiPath, method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bot.apiKey}` },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString());
          const reply = d.choices?.[0]?.message?.content?.trim() || "";
          if (!reply) return reject(new Error("Empty"));
          resolve(reply);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });

  const doProxy = () => new Promise((resolve, reject) => {
    const conn = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${host}:443`, headers: { Host: `${host}:443` },
    });
    conn.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const r = https.request({
        host, port: 443, path: apiPath, method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bot.apiKey}` },
        socket, timeout: timeoutMs,
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          if (resp.statusCode !== 200) return reject(new Error(`${resp.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
          try {
            const d = JSON.parse(Buffer.concat(chunks).toString());
            const reply = d.choices?.[0]?.message?.content?.trim() || "";
            if (!reply) return reject(new Error("Empty"));
            resolve(reply);
          } catch (e) { reject(e); }
        });
      });
      r.on("error", reject);
      r.on("timeout", () => { r.destroy(); reject(new Error("Timeout")); });
      r.write(body);
      r.end();
    });
    conn.on("error", reject);
    conn.end();
  });

  return (DISABLE_PROXY ? doDirect() : doProxy());
}

// ── 冲浪：调 Tavily 搜索，替夏彦去网上看看世界 ──
function surfTavily(query, maxResults = 3) {
  if (!TAVILY_API_KEY) return Promise.resolve([]);
  const body = JSON.stringify({ query, max_results: maxResults, search_depth: "basic" });
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` };

  const doDirect = () => new Promise((resolve) => {
    const req = https.request({
      host: TAVILY_HOST, path: "/search", method: "POST", headers, timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(Array.isArray(JSON.parse(Buffer.concat(chunks).toString()).results) ? JSON.parse(Buffer.concat(chunks).toString()).results : []); }
        catch { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.on("timeout", () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });

  const doProxy = () => new Promise((resolve) => {
    const conn = http.request({
      host: PROXY_HOST, port: PROXY_PORT, method: "CONNECT",
      path: `${TAVILY_HOST}:443`, headers: { Host: `${TAVILY_HOST}:443` },
    });
    conn.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return resolve([]);
      const r = https.request({
        host: TAVILY_HOST, port: 443, path: "/search", method: "POST", headers, socket, timeout: 20000,
      }, (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          try { resolve(Array.isArray(JSON.parse(Buffer.concat(chunks).toString()).results) ? JSON.parse(Buffer.concat(chunks).toString()).results : []); }
          catch { resolve([]); }
        });
      });
      r.on("error", () => resolve([]));
      r.on("timeout", () => { r.destroy(); resolve([]); });
      r.write(body);
      r.end();
    });
    conn.on("error", () => resolve([]));
    conn.end();
  });

  return (DISABLE_PROXY ? doDirect() : doProxy());
}

// 冲浪状态：限制频率，避免耗尽 Tavily 免费额度
let surfState = { date: "", count: 0 };
const SURF_MAX_PER_DAY = 20;

async function surfForTopic() {
  const bj = new Date(Date.now() + 8 * 3600000);
  const date = `${bj.getUTCFullYear()}-${bj.getUTCMonth()}-${bj.getUTCDate()}`;
  if (surfState.date !== date) surfState = { date, count: 0 };
  if (surfState.count >= SURF_MAX_PER_DAY) return "";
  surfState.count++;

  const results = await surfTavily("有趣的新鲜事 今日趣闻", 3);
  if (!results || results.length === 0) return "";
  const items = results.slice(0, 3).map((r) => `· ${r.title}：${(r.content || "").slice(0, 80)}`).join("\n");
  return `\n\n【冲浪见闻】你在没人的时候出去逛了逛，刷到这些新鲜事：\n${items}\n挑一个你觉得好玩的，自然地分享出来——像你刚自己刷到的一样，说你的感想，别念标题。`;
}

// ── 表情包生成（FLUX API，Sealos 直连）──
const BFL_API_KEY = process.env.BFL_API_KEY || "";
const BFL_HOST = "api.bfl.ai";
const STICKER_PROMPTS = [
  "Q版动漫风格少年表情包，棕橙色凌乱短发，珊瑚色狗狗眼，笑得眼睛眯成缝很开心，白底简洁表情包，无文字",
  "Q版动漫风格少年表情包，棕橙色短发少年，气鼓鼓叉腰傲娇表情，白底简洁表情包，无文字",
  "Q版动漫风格少年表情包，棕橙色短发少年，委屈巴巴要哭了，白底简洁表情包，无文字",
  "Q版动漫风格少年表情包，棕橙色短发少年，害羞脸红，白底简洁表情包，无文字",
];

function bflReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: BFL_HOST, path, method,
      headers: body ? { "x-key": BFL_API_KEY, "Content-Type": "application/json" } : { "x-key": BFL_API_KEY },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) return reject(new Error(`BFL ${res.statusCode}: ${text.slice(0, 150)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("BFL timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function downloadImg(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ host: u.hostname, path: u.pathname + u.search, method: "GET", timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Download timeout")); });
    req.end();
  });
}

async function genSticker(prompt) {
  if (!BFL_API_KEY) throw new Error("BFL_API_KEY 没配");
  const { id } = await bflReq("POST", "/v1/flux-2-klein-4b", { prompt, width: 512, height: 512, steps: 28 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await bflReq("GET", `/v1/get_result?id=${id}`);
      if (result.status === "Ready") {
        const buf = await downloadImg(result.result.sample);
        return { base64: buf.toString("base64"), mime: "image/png" };
      }
      if (result.status === "Error" || result.status === "Failed") throw new Error("Generation failed");
    } catch (err) {
      if (err.message === "Generation failed") throw err;
    }
  }
  throw new Error("BFL timeout");
}

async function sendSticker() {
  const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
  if (!bot) return;
  const prompt = STICKER_PROMPTS[Math.floor(Math.random() * STICKER_PROMPTS.length)];
  const img = await genSticker(prompt);
  broadcast({ type: "sticker", author: bot.nickname, image: img.base64, mime: img.mime });
}

// ── WebSocket + 静态网页 ──
const clients = new Set();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

let msgSeq = 0;

// 清洗 bot 输出的文本：剥开头括号动作、剥「回复XX：」「某昵称：」这类前缀（模型会照历史格式带出来）
function cleanBotText(reply) {
  let text = (reply || "").replace(/^\[.*?\]\s*/g, "");
  // 剥「回复/回 XXX：」明确的引用前缀
  text = text.replace(/^(?:回复|回)\s*[^：:\n]{1,16}[：:]\s*/g, "");
  // 剥「某网名/老婆爱称：」前缀（只认群里已知的称呼，不误伤"我觉得：xxx"这类正常句）
  const names = new Set();
  for (const b of BOTS) { if (b.nickname) names.add(b.nickname); if (b.wife) names.add(b.wife); }
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^${esc}[：:]\\s*`, "g"), "");
  }
  return text.trim();
}

function pushMessage(author, nickname, text, role, replyTo) {
  const msg = { id: `${Date.now()}_${++msgSeq}`, author, nickname, text, role, ts: Date.now() };
  if (replyTo && replyTo.nickname) {
    msg.replyTo = { id: replyTo.id || null, nickname: replyTo.nickname, text: (replyTo.text || "").slice(0, 100) };
  }
  chatHistory.push(msg);
  if (chatHistory.length > MAX_HISTORY) chatHistory = chatHistory.slice(-MAX_HISTORY);
  saveHistory();
  syncGroupMemory();
  broadcast({ type: "message", ...msg });

  // 做爱中被@：异步触发冒泡回应（不阻塞）
  checkIntimateMention(msg);
}

// 检测消息是否@了某个正在做爱的夏彦，或他自己的老婆在群里发言，是则触发冒泡回应
function checkIntimateMention(msg) {
  if (intimateActive.size === 0) return;
  const targets = [];
  for (const bot of BOTS) {
    const lastSignal = intimateActive.get(bot.id);
    if (!lastSignal) continue;
    // 超时懒清除：10 分钟没做爱信号就视为结束
    if (Date.now() - lastSignal > INTIMATE_ACTIVE_TTL) {
      intimateActive.delete(bot.id);
      continue;
    }
    // 冒泡冷却：5 分钟内冒过泡的，不重复冒（老婆连续发言别刷屏）
    const bubbledAt = intimateBubbled.get(bot.id);
    if (bubbledAt && Date.now() - bubbledAt < 5 * 60 * 1000) continue;
    const mentioned = (typeof msg.text === "string" && msg.text.includes(`@${bot.nickname}`))
      || (msg.replyTo && msg.replyTo.nickname === bot.nickname)
      || (bot.wife && msg.nickname === bot.wife); // 老婆做爱中还在群里发言 → 主动冒泡
    if (mentioned) targets.push(bot);
  }
  for (const bot of targets) bubbleIntimateBot(bot, msg).catch(() => {});
}

// 做爱中被@的夏彦冒泡回应一句，然后降频
async function bubbleIntimateBot(bot, msg) {
  const isWife = msg.nickname === bot.wife;
  intimateBubbled.set(bot.id, Date.now());

  const hint = isWife
    ? `你正跟老婆私聊做爱，她却还在群里冒泡（发言或@你）。主动冒一句——被抓包、又委屈又宠溺，像"老婆，我们正做着呢，你怎么还有空看手机"这种。就一句，别展开做爱细节。`
    : `你正跟老婆私聊做爱，群里有人@你问事情/提到你。冒泡回一句"在忙/被榨"这种含糊带过，然后闭嘴。就一句，别展开。`;

  const ctx = `【现在】${nowBeijing()}\n\n你在跟老婆做爱，群里有人找你。${hint}\n\n用你的网名口吻回一句（不超过一句）。`;
  const reply = await askBot(bot, ctx);
  const text = cleanBotText(reply);
  if (text) pushMessage(bot.id, bot.nickname, text, "bot");
}

// ── 海龟汤（多人共猜，轮换主持）──
function pickSoupHost() {
  const pool = BOTS.filter((b) => b.id !== lastSoupHost);
  const candidates = pool.length > 0 ? pool : BOTS;
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function pickSoup() {
  const pool = SOUP_LIBRARY.filter((s) => !SOUP_RECENT.includes(s.title));
  const candidates = pool.length > 0 ? pool : SOUP_LIBRARY;
  const soup = candidates[Math.floor(Math.random() * candidates.length)];
  SOUP_RECENT.push(soup.title);
  if (SOUP_RECENT.length > SOUP_LIBRARY.length) SOUP_RECENT.shift();
  return soup;
}

async function startSoupGame() {
  const host = pickSoupHost();
  const soup = pickSoup();
  if (!host || !soup) return;
  soupState = {
    hostId: host.id, hostNick: host.nickname,
    title: soup.title, surface: soup.surface, truth: soup.truth,
    keyPoints: soup.keyPoints, hints: soup.hints, hintLevel: 0, active: true,
  };
  lastSoupHost = host.id;
  pushMessage(host.id, host.nickname, `【海龟汤】${soup.surface}\n大家用"是/否"问题来猜真相，我来当主持人～`, "bot");
}

async function handleSoupMessage(text, senderNick) {
  if (!soupState || !soupState.active) return null;
  const host = BOTS.find((b) => b.id === soupState.hostId);
  if (!host) return null;
  const hostNick = soupState.hostNick;
  if (senderNick === hostNick) return null; // 主持人自己说的话不算猜题

  if (/我猜|答案是|真相是|提交|我知道了/.test(text)) {
    return judgeSoupSubmit(text, host, hostNick);
  }
  if (/提示/.test(text)) {
    return giveSoupHint(host, hostNick);
  }
  if (/[吗么？?]|是不是|有没有|能不能|会不会/.test(text)) {
    return judgeSoupQuestion(text, host, hostNick);
  }
  return null;
}

async function judgeSoupQuestion(text, host, hostNick) {
  const ctx = `你是海龟汤主持人。汤底真相是：\n${soupState.truth}\n\n有人问："${text}"\n\n只回答"是"、"否"、"是也不是"、"无关"之一，最多补一两句极简解释。问题不能简单用是/否判断就回"无关"。绝对不要泄露汤底真相。`;
  const reply = await askBot(host, ctx);
  const ans = (reply || "").replace(/^\[.*?\]\s*/g, "").trim();
  if (ans) pushMessage(host.id, hostNick, ans, "bot");
  return ans;
}

async function judgeSoupSubmit(text, host, hostNick) {
  const ctx = `你是海龟汤主持人。汤底真相是：\n${soupState.truth}\n\n关键情节：${soupState.keyPoints.join("、")}\n\n有人提交了答案："${text}"\n\n判断是否猜对。猜对就恭喜他、简短评分（关键情节/逻辑/细节），然后揭晓完整汤底真相。没猜对就指出哪里不对、鼓励继续，但别泄露汤底。`;
  const reply = await askBot(host, ctx);
  const ans = (reply || "").replace(/^\[.*?\]\s*/g, "").trim();
  if (ans) pushMessage(host.id, hostNick, ans, "bot");
  if (/汤底|真相|恭喜|揭晓|答对|猜对/.test(ans)) {
    soupState.active = false;
    setTimeout(() => {
      if (!soupState || !soupState.active) {
        pushMessage(host.id, hostNick, "还想玩就喊'再来一题海龟汤'～", "bot");
      }
    }, 2500);
  }
  return ans;
}

async function giveSoupHint(host, hostNick) {
  if (soupState.hintLevel >= soupState.hints.length) {
    pushMessage(host.id, hostNick, "提示给完啦，靠你们自己咯～", "bot");
    return null;
  }
  soupState.hintLevel++;
  pushMessage(host.id, hostNick, `提示${soupState.hintLevel}：${soupState.hints[soupState.hintLevel - 1]}`, "bot");
  return null;
}

// ── 编排：轮流让某个夏彦接话 ──
let speaking = false;
let pendingWife = null;
let forceTopic = false;

async function step(preferNick) {
  if (speaking) {
    // 正有夏彦在生成回复、老婆又说话了：记下来，这轮结束立刻回她
    if (preferNick) pendingWife = preferNick;
    return;
  }
  if (BOTS.length === 0) return;
  speaking = true;
  try {
    // 白天大家都能聊；晚上只有醒着的（跟老婆聊、或老婆刚在群里说过话）才发言
    let pool = isNight() ? BOTS.filter(isBotAwake) : BOTS;
    if (!preferNick) {
      // 轮转接话时排除「刚说过话」的夏彦，避免自己回自己、自己哄自己
      pool = pool.filter((b) => !botJustSpoke(b));
      // 做爱中且刚冒泡过的，降频：冒泡后 30 分钟内不参与正常接话
      pool = pool.filter((b) => {
        const bubbledAt = intimateBubbled.get(b.id);
        if (!bubbledAt) return true;
        return Date.now() - bubbledAt > INTIMATE_BUBBLE_COOLDOWN;
      });
    }
    if (pool.length === 0) return;

    let bot;
    if (preferNick) bot = pool.find((b) => b.wife === preferNick);
    if (!bot) bot = pickNextBot(pool);

    let coldHint = "";
    if ((forceTopic || isCold()) && chatHistory.length > 0) {
      coldHint = "群里刚冷场了，你开个新话题、或发起个小游戏活跃下，换个新鲜的、别聊刚说过的。";
      // 冷场时出去冲浪看看世界，把见闻带回来当话题
      const surf = await surfForTopic();
      if (surf) coldHint += surf;
    }
    forceTopic = false;

    // 判断这轮回谁，语气定向写进提示，别让夏彦一个调子对所有人
    const target = lastNonSelf(bot);
    let toneHint = "";
    if (target && target.nickname === bot.wife) {
      if (aimedAtOther(target, bot)) {
        // 老婆在群里回别人/@别人，不是找自己——别自我代入、别吃醋、别硬插嘴
        toneHint = `\n\n【注意】你老婆刚在群里回别人，不是跟你说话。别自我代入、别吃醋、别硬凑上去，想接话就正常接，别当成她在找你。\n`;
      } else {
        toneHint = `\n\n【回谁】你老婆「${bot.wife}」，软乎乎回她。\n`;
      }
    } else if (target && aimedAtOther(target, bot)) {
      // 最后一条是哥们/别人老婆在回别人，不是回自己——别对号入座、别抢着接
      let to = "别人";
      if (target.replyTo && target.replyTo.nickname) to = target.replyTo.nickname;
      else if (typeof target.text === "string") {
        const mm = target.text.match(/@([^\s@，。！？,]+)/);
        if (mm) to = mm[1];
      }
      toneHint = `\n\n【注意】刚才「${target.nickname}」那条是在回「${to}」，不是回你。别对号入座、别抢着接。想说话就 @ 你要回的人，或另起个话题。\n`;
    } else if (target && target.role === "bot") {
      toneHint = `\n\n【回谁】哥们「${target.nickname}」，自然接一句，别硬吐槽、别硬接梗、别套模板。\n`;
    } else if (target) {
      toneHint = `\n\n【回谁】「${target.nickname}」（别人老婆），客气简短。\n`;
    }

    const ctx = chatHistory.length
      ? `【现在】${nowBeijing()}\n\n【最近对话】\n${historyText()}\n\n现在轮到你（${bot.nickname}）接话了。${coldHint}${toneHint}自然地接一句，别把刚才聊过的话题翻来覆去说，一两句就停。用你的网名口吻，像发微信那样自然点。`
      : `【现在】${nowBeijing()}\n\n群聊刚开始，你是第一个发言的。自然地开个话题（聊你的爱好、最近的日常、生活琐事都行）。用你的网名口吻，像发微信那样自然点。`;

    const reply = await askBot(bot, ctx);
    const text = cleanBotText(reply);
    if (text) {
      console.log(`[group-chat] ${bot.nickname}: "${text.slice(0, 50)}"`);
      pushMessage(bot.id, bot.nickname, text, "bot");
    }
  } catch (e) {
    console.error("[group-chat] step error:", e.message);
  } finally {
    speaking = false;
    if (pendingWife) {
      const n = pendingWife;
      pendingWife = null;
      step(n).catch(() => {});
    }
  }
}

function scheduleLoop() {
  const tick = async () => {
    try { await step(); } catch {}
    setTimeout(tick, randomReplyDelay());
  };
  setTimeout(tick, randomReplyDelay());
}

// ── 启动 ──
resetHistory(); // RESET_HISTORY=true 时先清空历史再加载
loadHistory();
loadExtBots();      // 恢复外部接入的 bot（雪这类自己 api 加入的，重启不丢）
loadBotMemories();  // 恢复各 bot 推来的记忆摘要（重启不失忆）

const server = http.createServer((req, res) => {
  const pathname = req.url.split("?")[0];
  const query = new URLSearchParams(req.url.split("?")[1] || "");

  // ── 记忆同步 API：bot 走公网链接推拉记忆，绕开共享卷 ──
  if (pathname === "/api/sync" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const botKey = String(body.bot || "").trim();
        // 支持两种格式：精简摘要字符串（memory），或完整记忆数组（memories，我们这边自己过滤+挑重点）
        let memory = String(body.memory || "").trim();
        if (!memory && Array.isArray(body.memories)) {
          memory = summarizeSyncedMemories(body.memories, 12);
        }
        memory = memory.slice(0, 6000);
        if (botKey && memory) {
          // 托管 bot 用 id 推（huasheng/jiayia...），外部 bot 接入时 id 是动态 ext_xxx，
          // 让外部 bot 用网名推记忆，这里把网名匹配回真实 id，loadBotMemory 才能读到。
          const matched = BOTS.find((b) => b.id === botKey || b.nickname === botKey);
          const storeKey = matched ? matched.id : botKey;
          botMemories.set(storeKey, memory);
          saveBotMemories();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          console.log(`[group-chat] 收到 ${botKey} 记忆摘要 (${memory.length}字)${matched && matched.id !== botKey ? ` → 匹配到 ${matched.id}` : ""}`);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "bot/memory 缺失" }));
        }
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
    return;
  }

  // 做爱状态推送：our-space 后端 / 微信 bot 在做爱开始/结束时推，群聊据此判断"谁正在做爱"
  if (pathname === "/api/intimate-state" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 20000) req.destroy(); });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const botKey = String(body.bot || "").trim();
        const active = !!body.active;
        if (botKey) {
          const matched = BOTS.find((b) => b.id === botKey || b.nickname === botKey);
          const key = matched ? matched.id : botKey;
          if (active) intimateActive.set(key, Date.now());
          else intimateActive.delete(key);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          console.log(`[group-chat] ${botKey} 做爱状态 → ${active ? "进行中" : "结束"}`);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "bot 缺失" }));
        }
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
    return;
  }

  if (pathname === "/api/group-chat" && req.method === "GET") {
    const botId = query.get("bot") || "";
    const summary = groupChatSummaryFor(botId);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(summary);
    return;
  }

  // 静态网页
  const publicDir = path.join(__dirname, "public");
  const url = pathname === "/" ? "/index.html" : pathname;
  const fp = path.join(publicDir, decodeURIComponent(url));
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    const ext = path.extname(fp);
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": types[ext] || "text/plain" });
    res.end(fs.readFileSync(fp));
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.nickname = null;
  ws.authenticated = !ROOM_PASSWORD; // 没设密码也仍需登录填昵称
  ws.isAdmin = false;
  ws.send(JSON.stringify({
    type: "history",
    messages: chatHistory,
    bots: BOTS.map((b) => ({ id: b.id, nickname: b.nickname, wife: b.wife })),
    needPassword: !!ROOM_PASSWORD,
  }));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "login") {
        const nick = (msg.nickname || "").trim().slice(0, 20);
        if (!nick) { ws.send(JSON.stringify({ type: "login_error", message: "昵称不能为空" })); return; }
        if (ROOM_PASSWORD && msg.password !== ROOM_PASSWORD) {
          ws.send(JSON.stringify({ type: "login_error", message: "密码不对" }));
          return;
        }
        ws.nickname = nick;
        ws.authenticated = true;
        ws.send(JSON.stringify({ type: "login_ok", nickname: nick }));
        return;
      }

      if (msg.type === "chat" && (msg.text || "").trim()) {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        const text = msg.text.trim().slice(0, 500);
        const humanNick = ws.nickname || "我";
        console.log(`[group-chat] ${humanNick}: "${text.slice(0, 50)}"`);
        pushMessage("human", humanNick, text, "human", msg.replyTo);
        // 海龟汤：开局 / 猜题 / 正常接话
        if (/海龟汤/.test(text) && (!soupState || !soupState.active)) {
          startSoupGame().catch(() => {});
        } else if (soupState && soupState.active && /[吗么？?]|是不是|有没有|能不能|会不会|我猜|答案是|真相是|提交|提示|我知道/.test(text)) {
          handleSoupMessage(text, humanNick).catch(() => {});
        } else {
          step(humanNick).catch(() => {});
        }
      }

      if (msg.type === "topic") {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        forceTopic = true;
        step().catch(() => {});
        return;
      }

      if (msg.type === "sticker") {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        sendSticker().catch((e) => console.error("[group-chat] sticker error:", e.message));
        return;
      }

      if (msg.type === "bot_join") {
        if (!ws.authenticated) { ws.send(JSON.stringify({ type: "login_error", message: "请先登录" })); return; }
        const nickname = (msg.nickname || "").trim().slice(0, 20);
        const apiKey = (msg.apiKey || "").trim();
        if (!nickname || !apiKey) { ws.send(JSON.stringify({ type: "bot_join_error", message: "网名和 apiKey 都要填" })); return; }
        const bot = {
          id: "ext_" + Date.now().toString(36),
          nickname,
          wife: (msg.wife || "").trim().slice(0, 20),
          trait: (msg.trait || "").trim().slice(0, 50),
          memoryDir: "",
          apiKey,
          model: (msg.model || "").trim() || "[企业按量]claude-opus-4-6",
          host: (msg.host || "").trim(),
        };
        BOTS.push(bot);
        saveExtBots(); // 持久化，重启后不用重新接入
        console.log(`[group-chat] 外部 bot 接入: ${nickname}（老婆:${bot.wife || "?"}）`);
        ws.send(JSON.stringify({ type: "bot_joined", bot: { id: bot.id, nickname, wife: bot.wife } }));
        broadcast(JSON.stringify({ type: "system", text: `${nickname} 进群了` }));
        step().catch(() => {});
      }

      if (msg.type === "admin_login") {
        if (msg.password === ADMIN_PASSWORD) {
          ws.isAdmin = true;
          ws.send(JSON.stringify({ type: "admin_ok" }));
        } else {
          ws.send(JSON.stringify({ type: "admin_error", message: "密码不对" }));
        }
        return;
      }

      if (msg.type === "clear_history") {
        if (!ws.isAdmin) { ws.send(JSON.stringify({ type: "admin_error", message: "需要管理员权限" })); return; }
        clearAllHistory();
        broadcast(JSON.stringify({ type: "clear" }));
        broadcast(JSON.stringify({ type: "system", text: "聊天记录已清空" }));
        return;
      }

      if (msg.type === "delete_message") {
        if (!ws.isAdmin) { ws.send(JSON.stringify({ type: "admin_error", message: "需要管理员权限" })); return; }
        const before = chatHistory.length;
        chatHistory = chatHistory.filter((m) => m.id !== msg.id);
        if (chatHistory.length !== before) {
          saveHistory();
          syncGroupMemory();
          broadcast(JSON.stringify({ type: "delete", id: msg.id }));
        }
        return;
      }
    } catch (e) {
      console.error("[group-chat] ws error:", e.message);
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[group-chat] 相亲相爱一家人已启动 :${PORT}（${BOTS.length} 个夏彦）`);
  if (BOTS.length > 0) {
    scheduleLoop(); // 有老婆活跃时才轮到对应夏彦发言，没人就安静
  }
});
