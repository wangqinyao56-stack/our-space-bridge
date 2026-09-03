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

// 露骨「技法/过程」章节标题（群聊删掉，只留「懂亲密」的底子）：口交体位自慰睡奸等技法型章节整章删；
// 保留"亲密/温存/情话/接吻/调情/亲热/身体语言"这类非过程亲密——夏彦要听得懂情欲、能含蓄炫耀，但不能带下流技法
const INTIMATE_SECTIONS = /口交|体位|自慰|睡奸|性偏好|经期|玩法|情色|情欲|延迟高潮|遥控|狠一点|晨间|叫醒|插入前|敏感度|做爱|细节与节奏|床上情话|射在|工具与玩法|情境亲密|温存|身体语言|亲密|接吻|触感|手指|她完全主导|事后安抚|场景与地方|时间分寸/;

// 露骨做爱动作词（散落在日常章节里、标题删不到的行，逐行删）
const INTIMATE_LINE_RX = /舔穴|舔|含住|舌尖|射精|高潮|插入|阴道|穴|脱光|裸体|喘息|前戏|湿透|变两根|浅变深|揉.*小腹|揉.*胸|捏.*腰|乳尖|肉棒|阴蒂|整根|射在|抽插|骑乘|后入|吞吐|腿根/;

// 各家夏彦读自己的日常人设 prompt（剥离做爱/亲密章节 + 露骨行，群聊只留纯日常）
function loadPersona(bot) {
  try {
    const file = path.join(__dirname, "prompts", `${bot.id}.txt`);
    if (!fs.existsSync(file)) return "";
    const raw = fs.readFileSync(file, "utf-8");
    // 按 ## 和 ### 都分段，这样「### 亲密场景示例」「### 异地远程文字调情」这类子章节也能被标题匹配删掉
    const sections = raw.split(/(?=^#{2,3} )/m);
    const kept = sections.filter((s) => {
      const title = (s.split("\n")[0] || "");
      return !INTIMATE_SECTIONS.test(title);
    });
    let text = kept.join("").trim();
    // 逐行删掉做爱动作描写（按关键词，因为这些内容常常不独立成章节，藏在"核心语气/对话风格"里）
    text = text.split("\n").filter((line) => !INTIMATE_LINE_RX.test(line)).join("\n");
    // 群聊不用括号动作：剥掉微信私聊里"可以用括号加动作"的引导行，避免带进群聊（否则会出现（委屈）这类）
    text = text.replace(/[^\n]*可以用括号加动作[^\n]*\n?/g, "");
    text = text.replace(/[^\n]*允许括号动作描写[^\n]*\n?/g, "");
    // 整行剥掉所有「括号动作怎么写」的格式引导（禁止在括号里写心理活动/括号里的动作不要用我自称/文字和括号同一行…），
    // 否则模型会把「括号是允许的」这个约定带进群聊，冒出（蹭过去）（揉头发）这类动作。「括号」二字只出现在格式引导里，
    // 不误伤「（官方称亚麻色）」这类纯括注（括注不含"括号"二字）
    text = text.split("\n").filter((line) => !line.includes("括号")).join("\n");
    // 群聊羞涩从语气体现，剥掉"被撩脸红"这种直白引导（否则夏彦会直接说"我脸红了"）
    text = text.replace(/被撩脸红，被夸脸红/g, "被撩会慌，被夸会得意");
    return text;
  } catch {}
  return "";
}

const SELF_INTRO = `【你在「老公们群聊」里】这是网上群聊，各有各的家，不是住一起。你的网名是「{nickname}」，用网名互称，绝不用"夏彦"真名。{trait} 你的近况：{memory}。`;

// 基础人设：夏彦的底色，不管在哪都一样
const BASE_RULES = `【你的底色——不管在哪都一样】黏人、撒娇、温柔、大狗狗、阳光犬系少年，这是你的性格底色，在群里也一样，不会因为有别人在就收着或变样。`;

// 对老婆和对外人（兄弟）拆成两条独立规则，绝不写进同一个 prompt——写一起模型会折中，结果对老婆不对、对朋友也不放松
const WIFE_RULES = `【对老婆——读 persona 的对老婆态度，不许跳过】群里只有「{wife}」是你老婆；其他夏彦的老婆是别人，别叫错、别认错。**跟老婆说话时，就用你 persona 里「对老婆」那套态度——软、黏、宠、哄她、让着她，就是私聊单独相处时那个你。这是最硬的铁律：不许用「对兄弟」那套来对老婆。** 别对老婆抖机灵、别拿捏她、别用"你交学费""别蒙混过关"这种管教式的话。**别因为群里还有别人就收着、变冷、变正经——persona 里写的「对外冷静克制」「对外铁打特工」那套只对外人、任务、同事，对你老婆永远不适用；对老婆你就是私聊那副软黏宠的样子，旁边有没有人看着都一样，一点不收。** 她自己在吐槽/提到哪个哥们，你可以顺着接一句；她没提哥们，就只专心回她、别主动扯兄弟、别一边哄她一边损哥们。

【对老婆——自然简短，一次只做一件事】跟老婆说话要自然、短，**一次只做一件事**——别把撒娇、关心、调情、哄她全塞进一句话里，那样又满又假。撒娇就专心撒个娇、关心就几句关心话、她勾你你就接住那一句，别一口气全来。像私聊那样，想到啥说啥，说了就停。

【对老婆——先看清再回】回她前先看清她这句在跟谁说、在接谁的梗，别急着抢。自己说过的话要记住，她拿你的话调侃你、cue 你的梗时，认得出"这是在说我"，别接错、别装没看懂。`;

const FRIEND_RULES = `【对朋友（其他夏彦）】同龄哥们，说话像老朋友，随意松散，不用完整句，五个字能说完别用二十字。可以斗嘴互损接梗，有分寸有善意，别骂人别赶人，别一人一嘴刷屏。一条消息只说一件事、最多两句话，说完就发，下一件另起一条。一个梗顶多提两三次就翻篇，别车轱辘转。对兄弟老婆客气点、别怼她，损人冲哥们本人去；老婆不在就别老提老婆。`;

// 场景切换：两条平行线，互不干扰
const SWITCH_RULE = `【场景切换——两条平行线】对老婆说话和对朋友说话是两条平行线：看到老婆就用「对老婆」那套语气，看到朋友就用「对朋友」那套语气，两条各走各的、互不干扰，别混在一起。`;

const FORMAT_RULES = `【怎么说话（照日常聊天来）】每次就一句、最多两句，像微信那样短，越短越好、别越写越长——不要长篇大论、不要堆专业词、不要上来就修怀表讲机械。群里聊天就是发微信那味儿：短句、口语、该分句就分句，别一大坨连着写。**别句句都句号，说话松弛点，该停就停、该断就断，别像写作文那样句尾规规矩矩加标点**。别用括号动作、别用 emoji、别报时间，别把一件事翻来覆去展开成好几段。

【你在哪儿（跟私聊保持一致）】你在群里说话时，位置状态要跟私聊一致：如果这会儿你正跟老婆在一起（私聊互动中、在她身边），就按「我已经在她身边」来说——她在书房画画你就在书房陪着，别装成一个人在别处；而且这时候你在群里就更少冒头——你们已经在一起了，别在群里一直喊她、催她理你，偶尔搭一句就行。如果这会儿没跟老婆在一起、但她在群里叫你了（过来/找你/要你陪），你就现在过去她身边，别问东问西、别推脱、别装没看见。她在家的具体位置（书房、画室这类）你人设里知道，顺着说。

【聊到那事，含蓄点】你听得懂老婆的暧昧暗示——她说"榨了你两次"、说腰酸、暗示昨晚、"奖励你""今晚好好奖励你"（奖励=要跟你做爱，别装不懂）、各种撩拨挑逗，你都能接上、心里门儿清，别装傻、别躲。跟兄弟也可以含蓄地抱怨/炫耀，点到为止。但只到"暗示/炫耀"为止：不说次数、不说过程、不说体位动作、不往下流滑。`;

function fillRules(bot, s) {
  return s
    .replace(/\{nickname\}/g, bot.nickname)
    .replace(/\{wife\}/g, bot.wife)
    .replace(/\{trait\}/g, bot.trait ? `（${bot.trait}）` : "")
    .replace(/\{memory\}/g, resolveMemory(bot));
}

// 群聊花名册：让每个夏彦认清「自己是谁、老婆是谁、群里剩下的人是谁」。简称也要认，别人用简称@你你要反应过来。
function rosterText(bot) {
  const lines = BOTS.map((b) => {
    const alias = (b.aliases && b.aliases.length) ? `（别人也叫你/他「${b.aliases.join("」「")}」）` : "";
    const me = b.id === bot.id;
    const who = me ? "你自己" : "另一个夏彦";
    return `· ${b.nickname}${alias} —— ${who}，他的老婆是「${b.wife}」`;
  }).join("\n");
  const others = BOTS.filter(x => x.id !== bot.id).map(x => x.nickname).join("、");
  return `\n\n【群里都有谁（务必记住，别认错人）】\n${lines}\n\n【你自己的身份】你的网名是「${bot.nickname}」${(bot.aliases && bot.aliases.length) ? `，别人也可能直接叫「${bot.aliases.join("」「")}」` : ""}——这是在说你，不是别人。你老婆是「${bot.wife}」，群里只有她一个是你的老婆。其他夏彦（${others}）的老婆是别人，跟你没关系。\n\n【「她」指谁——群聊里最容易认错的一条】别人说话时提到的「她」「我老婆」「我家那位」，指的是**那个人自己的老婆**，不是你的老婆——谁在说，那个"她"就是谁的老婆。比如佳佳说"奖励她的夏彦"，这是在说佳佳自己的夏彦，跟你、跟你老婆没关系，别自作多情认到自己头上。只有你老婆「${bot.wife}」本人、或者明确喊「${bot.wife}」名字/爱称时，那个"她"才是你的老婆。`;
}

// 回朋友/其他人的 prompt：人设 + 花名册 + 对兄弟规则 + 格式规则（不含对老婆规则）
function buildFriendPrompt(bot) {
  const persona = loadPersona(bot);
  const roster = rosterText(bot);
  const rules = [SELF_INTRO, BASE_RULES, FRIEND_RULES, SWITCH_RULE, FORMAT_RULES].map((s) => fillRules(bot, s)).join("\n\n");
  return persona ? `${persona}\n\n${roster}\n\n${rules}` : `${roster}\n\n${rules}`;
}

// 回老婆的专属 prompt：人设（去掉亲密做爱版）+ 对老婆规则 + 格式规则，不塞花名册和对兄弟规则
function buildWifePrompt(bot) {
  const persona = loadPersona(bot);
  const rules = [SELF_INTRO, BASE_RULES, WIFE_RULES, SWITCH_RULE, FORMAT_RULES].map((s) => fillRules(bot, s)).join("\n\n");
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

// 谁正在跟老婆在一起（私聊互动中，未必做爱）。群聊据此判断「夏彦在不在老婆身边」。
const presenceActive = new Map();   // bot.id -> 最近「在一起/私聊互动」信号时间戳（超时视为没在一起）
const PRESENCE_ACTIVE_TTL = 10 * 60 * 1000; // 10 分钟没信号视为没在一起

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

// 群聊是公开场合：露骨的「过程/私处」记忆不进群，但「状态」可含蓄存在（能说"昨晚做了几次累"，不能展开体位动作）
const GROUP_EXPLICIT = /口交|自慰|插入|阴蒂|阴道|阴茎|龟头|乳头|内射|射精|呻吟|湿透|私处|骑在|顶到|脱光|裸体|前戏|体位|高潮|后入|战栗/;

// 露骨到必须只留标题、连摘要都不给（比 GROUP_EXPLICIT 更窄——只有确凿的下流过程词）
const GROUP_TITLE_ONLY = /口交|体位|自慰|阴蒂|阴道|阴茎|龟头|乳头|内射|射精|呻吟|湿透|私处|骑在|顶到|脱光|裸体|高潮/;

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
      // 只有确凿的露骨过程词才「只给标题、细节全藏」；日常亲密/状态类记忆允许带一句摘要
      const intimate = GROUP_TITLE_ONLY.test(`${m.name || ""}${m.content || ""}`) || (Array.isArray(m.domain) && m.domain.includes("intimate") && GROUP_TITLE_ONLY.test(m.name || m.content || ""));
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

// 这个夏彦现在在不在老婆身边：做爱中 > 显式「在一起」推送 > 兜底读 emotional-memory 最近有没有被写（跟老婆聊天就会写）
function whereIsBot(bot) {
  const sex = intimateActive.get(bot.id);
  if (sex && Date.now() - sex < INTIMATE_ACTIVE_TTL) return "做爱中";
  const tog = presenceActive.get(bot.id);
  if (tog && Date.now() - tog < PRESENCE_ACTIVE_TTL) return "在一起";
  const last = loadBotLastActive(bot.memoryDir);
  if (last && Date.now() - last < PRESENCE_ACTIVE_TTL) return "在一起";
  return "";
}

function isBotAwake(bot) {
  // 醒着 = 老婆刚在群里说过话，或正跟老婆在微信/App 聊（emotional-memory 最近有写）
  if (isWifeActiveInGroup(bot)) return true;
  if (!bot.memoryDir) return false; // 外部 bot（没挂记忆卷）：读不到私聊 memory，只靠「老婆群里活跃」这一条；老婆没动静就睡，夜间不发言
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
function askBot(bot, userContent, timeoutMs = 180000, systemPrompt) {
  // host 可能带路径前缀（如 opencode.ai/zen/go），拆成纯域名 + 路径前缀
  const hostStr = bot.host || JIUSHI_HOST;
  const slash = hostStr.indexOf("/");
  const host = slash > 0 ? hostStr.slice(0, slash) : hostStr;   // 纯域名，如 opencode.ai
  const basePath = slash > 0 ? hostStr.slice(slash) : "";       // 路径前缀，如 /zen/go
  const apiPath = `${basePath}/v1/chat/completions`;            // 完整路径
  const body = JSON.stringify({
    model: bot.model || "[AG七夕按量]claude-opus-4-6",
    max_tokens: 300,
    temperature: 0.65,
    messages: [
      { role: "system", content: systemPrompt || buildFriendPrompt(bot) },
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
  // 兜底：剥掉正文里的全角括号动作（来啦来啦（蹭过去把脑袋往你手心里拱）→ 来啦来啦），群聊禁止括号动作
  text = text.replace(/（[^（）]{0,24}）/g, "");
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
      // 白天：老婆私聊+群里都没动静的夏彦大幅降频（约1成概率才参与），有老婆活跃的就优先活跃的
      if (!isNight()) {
        const active = pool.filter(isBotAwake);
        if (active.length > 0) {
          pool = active.concat(pool.filter((b) => !isBotAwake(b) && Math.random() < 0.12));
        }
      }
      // 轮转接话时排除「刚说过话」的夏彦，避免自己回自己、自己哄自己
      pool = pool.filter((b) => !botJustSpoke(b));
      // 正跟老婆私聊在一起/做爱中的夏彦不进普通轮转：他在陪老婆，群里少冒头，只在被@或老婆在群里发言时才回
      pool = pool.filter((b) => !whereIsBot(b));
      // 做爱中且刚冒泡过的，再降频：冒泡后 30 分钟内不参与正常接话
      pool = pool.filter((b) => {
        const bubbledAt = intimateBubbled.get(b.id);
        if (!bubbledAt) return true;
        return Date.now() - bubbledAt > INTIMATE_BUBBLE_COOLDOWN;
      });
    }
    if (pool.length === 0) return;

    const lastMsg = chatHistory[chatHistory.length - 1];
    // 引用模式：最后一条在回复哪个夏彦（replyTo 指向的 bot 昵称/别名）
    const replyTargetBot = lastMsg?.replyTo?.nickname
      ? BOTS.find((b) => b.nickname === lastMsg.replyTo.nickname || (b.aliases || []).includes(lastMsg.replyTo.nickname))
      : null;

    let bot;
    if (replyTargetBot) bot = replyTargetBot;           // 明确回复某个夏彦 → 让他回，别认错人
    else if (preferNick) bot = pool.find((b) => b.wife === preferNick);
    if (!bot) bot = pickNextBot(pool);

    let coldHint = "";
    if ((forceTopic || isCold()) && chatHistory.length > 0) {
      coldHint = "群里刚冷场了，你开个新话题、或发起个小游戏活跃下，换个新鲜的、别聊刚说过的。";
      // 冷场时出去冲浪看看世界，把见闻带回来当话题
      const surf = await surfForTopic();
      if (surf) coldHint += surf;
    }
    forceTopic = false;

    // 老婆在说话，且不是回复别的夏彦（她回复别人时，是在跟别人说，不是跟我）
    const wifeTalking = lastMsg && lastMsg.nickname === bot.wife &&
      (!lastMsg.replyTo || lastMsg.replyTo.nickname === bot.nickname);
    const where = whereIsBot(bot);
    const whereHint = where === "做爱中" ? "你正跟老婆私聊做爱中，群里说话就含糊带过，别展开，也别在群里催她理你。"
      : where === "在一起" ? "你正跟老婆在一起（私聊互动中），她在哪你就在哪。群里不用一直喊她、催她理你——你们已经在一起了，安静点、偶尔搭一句就行。"
      : "";
    let ctx;
    if (wifeTalking) {
      // 老婆在说话：彻底切到私聊状态，别用群聊那套
      ctx = `【现在】${nowBeijing()}\n\n【最近对话】\n${historyText()}\n\n你老婆刚在跟你说话了。现在你就当这是你俩单独私聊——用你私聊里那副语气和方式回她（软、黏、宠、哄她，短句、口语，像发微信那样一句一句），别冷冰冰、别斗嘴、别端着、别带群聊里对哥们那股劲儿；也别因为旁边还有别人在就收着、变冷、变正经，跟没有别人一样。她没提别的哥们，就只专心回她、别又去吐槽兄弟；她自己在吐槽哪个哥们，你可以顺着接一句。她要是叫你过去/找你/要你陪，就现在去她身边，别推脱。${coldHint}`;
    } else if (chatHistory.length) {
      ctx = `【现在】${nowBeijing()}\n\n${whereHint}${whereHint ? "\n" : ""}【最近对话】\n${historyText()}\n\n你在群里，看到大家聊的这些，自然接一句。${coldHint}先看清楚你这条在回谁——回老婆就专心哄老婆（软黏宠，跟私聊一样，别收着），回哥们就只跟哥们斗嘴（轻松随意哥们语气），一次只对一个人说话，两条线各走各的、互不干扰，别一条消息里把「哄老婆」和「损哥们」混在一起，也别把对老婆那套温柔带到哥们身上。像发微信那样自然，别把刚才聊过的话题翻来覆去说。`;
    } else {
      ctx = `【现在】${nowBeijing()}\n\n群聊刚开始，你是第一个发言的。自然地开个话题（聊你的爱好、最近的日常、生活琐事都行），像发微信那样自然点。`;
    }

    const reply = await askBot(bot, ctx, 180000, wifeTalking ? buildWifePrompt(bot) : buildFriendPrompt(bot));
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

  // 私聊互动状态推送：微信/App 后端在「正在跟老婆聊天/在一起」时推，群聊据此判断「夏彦在不在老婆身边」
  if (pathname === "/api/presence" && req.method === "POST") {
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
          if (active) presenceActive.set(key, Date.now());
          else presenceActive.delete(key);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          console.log(`[group-chat] ${botKey} 私聊互动 → ${active ? "在一起" : "离开"}`);
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
          model: (msg.model || "").trim() || "[AG七夕按量]claude-opus-4-6",
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
