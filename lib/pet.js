/**
 * Virtual pet state management for our-space bridge.
 * Stats decay over time. 夏彦 can proactively care for the pet.
 * Pet interaction logs are persisted to disk.
 *
 * Pet status: "home" | "outside" | "with_xiayan"
 * - home: normal interactions available
 * - outside: 花生 is out exploring, call_back to bring home
 * - with_xiayan: 花生 is with 夏彦 on a mission, not interactable
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PET_DATA_DIR = path.join(__dirname, "..", "data");
const PET_LOG_FILE = path.join(PET_DATA_DIR, "pet-logs.json");
const MAX_LOGS = 200;

let pet = {
  name: "花生",
  type: "鹩哥",
  hunger: 80,
  happiness: 80,
  energy: 80,
  affection: 50,
  lastUpdate: Date.now(),
  status: "home",
  outsideSince: null,
};

let petLogs = [];

function loadLogs() {
  try {
    if (fs.existsSync(PET_LOG_FILE)) {
      petLogs = JSON.parse(fs.readFileSync(PET_LOG_FILE, "utf-8"));
      if (!Array.isArray(petLogs)) petLogs = [];
    }
  } catch { petLogs = []; }
}

function saveLogs() {
  try {
    if (!fs.existsSync(PET_DATA_DIR)) fs.mkdirSync(PET_DATA_DIR, { recursive: true });
    fs.writeFileSync(PET_LOG_FILE, JSON.stringify(petLogs.slice(-MAX_LOGS), null, 2));
  } catch {}
}

function addLog(actor, action, reaction) {
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    actor,
    action,
    reaction,
    timestamp: Date.now(),
  };
  petLogs.push(entry);
  if (petLogs.length > MAX_LOGS * 2) petLogs = petLogs.slice(-MAX_LOGS);
  saveLogs();
  return entry;
}

loadLogs();

const DECAY_INTERVAL_MS = 10 * 60 * 1000;
let decayTimer = null;

function applyDecay() {
  const now = Date.now();
  const elapsedMs = now - pet.lastUpdate;
  const intervals = Math.floor(elapsedMs / DECAY_INTERVAL_MS);
  if (intervals <= 0) return;

  pet.hunger = Math.max(0, pet.hunger - intervals * 2);
  pet.happiness = Math.max(0, pet.happiness - intervals * 1);
  pet.energy = Math.min(100, pet.energy + intervals * 3);
  pet.lastUpdate = now;

  // Auto-return from outside after 2-4 hours
  if (pet.status === "outside" && pet.outsideSince) {
    const outsideHours = (now - pet.outsideSince) / 3600000;
    if (outsideHours > 2 + Math.random() * 2) {
      pet.status = "home";
      pet.outsideSince = null;
      pet.happiness = Math.min(100, pet.happiness + 10);
      addLog("system", "auto_return", `${pet.name}在外面玩够了，自己飞回来了~ 站在栖木上梳理羽毛，看起来心情很好。`);
    }
  }
}

function startDecay() {
  if (decayTimer) clearInterval(decayTimer);
  decayTimer = setInterval(applyDecay, DECAY_INTERVAL_MS);
}
startDecay();

function getPetState() {
  applyDecay();
  const mood = deriveMood();
  return { ...pet, mood };
}

function deriveMood() {
  if (pet.status === "with_xiayan") return "traveling";
  if (pet.status === "outside") return "adventuring";
  if (pet.hunger < 20) return "hungry";
  if (pet.happiness < 20) return "sad";
  if (pet.energy < 20) return "tired";
  if (pet.hunger > 70 && pet.happiness > 70 && pet.energy > 50) return "happy";
  if (pet.hunger < 40) return "hungry";
  if (pet.happiness < 40) return "sad";
  if (pet.energy < 40) return "tired";
  return "content";
}

function getPetReaction(action, actor = "me") {
  const mood = deriveMood();
  const name = pet.name;

  // 华生（主人）的反应：撒娇、亲昵、粘人
  const forMe = {
    feed: {
      happy:   `${name}欢快地跳到食盆边，一边啄食一边发出满足的咕咕声~ 吃完歪头看着你，扑棱扑棱翅膀，飞到你肩膀上蹭你的脸，好像在说"妈妈最好啦"！`,
      content: `${name}优雅地啄了几口食物，抬头冲你眨眨眼睛，然后跳到你手边用喙轻轻蹭你的手指——吃饱了，要摸摸~`,
      hungry:  `${name}眼睛都亮了！扑棱着翅膀飞到食盆边，埋头猛吃，吃得吧唧吧唧响。吃完飞到你肩上，撒娇似的把头往你脖子里钻~`,
      sad:     `${name}慢慢地啄了几口，心情似乎好了一点。跳到你的手心，小声地叽叽叫，把脑袋贴在你虎口处蹭来蹭去，像在撒娇求安慰。`,
      tired:   `${name}慵懒地啄着食物，吃完缩成一团毛球。你伸出手指，它把小脑袋搁在你指尖上，迷迷糊糊地眯起眼睛，喉咙里发出细细的咕噜声~`,
    },
    pet: {
      happy:   `${name}舒服得眼睛都眯起来了，主动把头往你手指下拱，喉咙里发出满足的咕噜咕噜声，羽毛蓬松得像个小毛球！还翻过身来露出小肚子，要你挠~`,
      content: `${name}乖乖站在栖木上，歪着小脑袋享受你的抚摸。你摸到它头顶的时候，它闭上眼睛，小爪子在你手指上轻轻踩着，像在踩奶~`,
      hungry:  `${name}虽然饿着肚子，还是乖巧地让你摸了好一会儿。然后用喙轻轻叼住你的手指，可怜巴巴地看着你——妈妈，饿了啦~`,
      sad:     `${name}感受到你的抚摸，往你手心里使劲贴，整只鸟都缩进你掌中，发出一连串小声的叽叽咕咕，像是在跟你诉苦。末了还用头顶蹭蹭你的拇指。`,
      tired:   `${name}迷迷糊糊地用喙蹭蹭你的指头，打了个小小的哈欠。然后用脑袋顶开你的手指，把自己整个塞进你手心——要捧着睡~`,
    },
    walk: {
      happy:   `${name}兴奋地在你肩膀上蹦了两下，啾的一声飞了出去！在外面到处探险，一会儿停在树梢上冲你叫，一会儿追蝴蝶，开心得翅膀都扇得呼啦呼啦响~`,
      content: `${name}飞了出去，在窗外的树枝上跳来跳去，时不时回头看看你。阳光照在它的羽毛上，亮晶晶的，像在发光。`,
      hungry:  `${name}飞了一小圈就回来了，用小脑袋蹭你的脸颊，可怜巴巴地咕咕叫——妈妈，外面是好玩啦，但是肚子饿了~`,
      sad:     `${name}犹豫了一下才飞出去。但在外面待了一会儿精神明显好多了，飞到一棵树上歪头看你，叽叽叫了一声——像是在说"妈妈别担心，我就在这"。`,
      tired:   `${name}勉强飞了一圈，落在最近的树枝上歇着不想动。阳光暖暖的，它缩成一团毛球，半眯着眼睛享受微风。`,
    },
  };

  // 夏彦的反应：对抗路、吵架、轻啄、不配合但暗中关心
  const forXiayan = {
    feed: {
      happy:   `${name}歪头看了夏彦一眼，不紧不慢地跳到食盆边啄了两口。然后冲夏彦叫了一声——像是在说"还行吧，勉强合格"。但趁夏彦转身的时候，偷偷加快速度猛吃了好几口。`,
      content: `${name}慢悠悠地啄了几口食物，抬头冲夏彦眨眨眼。夏彦伸手想摸它，它往旁边跳了一步——不给摸。然后用喙轻轻啄了一下夏彦的手指，算是打了招呼。`,
      hungry:  `${name}扑棱扑棱飞到食盆边，埋头猛吃。夏彦在旁边看着笑了一下，它抬头瞪了他一眼——看什么看，没见过鸟吃饭啊！然后继续埋头吃，但尾巴却偷偷翘起来了。`,
      sad:     `${name}没精打采地啄了两口。夏彦凑过来看它，它把头扭到一边——不想理你。但夏彦要走的时候，它又小声叽叽叫了一下，拿脑袋撞了撞夏彦的手指。`,
      tired:   `${name}慢吞吞地啄着食物，困得脑袋一点一点的。夏彦用手指碰了碰它，它睁开眼啄了他手指一下——别烦。然后又闭上眼睛继续打瞌睡，小身子却往夏彦手边靠了靠。`,
    },
    pet: {
      happy:   `${name}被你摸了两下，舒服地眯起眼睛。然后突然睁开眼，转头啄了一下你的手指——谁让你停的？继续啊！你继续摸它，它才满意地咕噜咕噜叫起来，但尾巴还翘得老高，一副"算你识相"的样子。`,
      content: `${name}让你摸了两下，喉咙里刚要发出咕噜声……硬生生憋回去了。转头顶了顶你的手指，叽叽叫了两声——好像在说"今天表现还行吧，别停"。`,
      hungry:  `${name}被你摸了一下，烦躁地抖了抖羽毛。然后用喙轻轻啄你的指尖——别光摸啊，给点吃的行不行？啄完又有点心虚，偷偷看了你一眼，把嘴藏到翅膀下面装没事。`,
      sad:     `${name}缩在角落里不理人。你伸手过去，它啄了你一口——比平时用力一点，但没真使劲。你坚持没缩手，它才慢慢把脑袋放到你手指上，叽叽叫了一声，声音比平时软。`,
      tired:   `${name}窝在那里半梦半醒，你碰了碰它，它睁开一只眼——烦死了。然后用喙把你的手指推开，但推开之后又迷迷糊糊把脑袋搭在你手指上，呼吸慢慢变均匀了。`,
    },
    walk: {
      happy:   `${name}看到你过来，兴奋地跳了两下，然后又故作淡定地梳理羽毛——哼，才不是因为你要带我出去才开心的。出了门在你肩头站了没两秒就嗖地飞走了，到处探险，你叫它它假装没听见。`,
      content: `${name}飞出门外，站在树梢上冲你叽叽喳喳，像是在炫耀"看我飞得多高"！你在下面叫它下来，它歪头看了你三秒，继续梳理羽毛——急什么，再玩一会儿。`,
      hungry:  `${name}飞出去逛了一圈，回来落你肩上。用喙啄了啄你的脖子——饿了饿了，带我出来倒是带点吃的啊。你摸它脑袋，它躲开，但过两秒又把脑袋伸过来。`,
      sad:     `${name}被你带出门，在树枝上站了一会儿，歪头看着你。你叫它，它没过来——但飞得离你近了一点。又过了一会儿才慢悠悠落回你肩上，轻轻啄了一下你的耳垂。`,
      tired:   `${name}飞了没多远就落回你肩上，不肯动了。你用手指想把它捧起来，它啄了你一口——别碰，我自己会走。过了三秒又自己钻到你手心里，把头往你手指间一塞，不动了。`,
    },
  };

  // Call back reactions
  if (action === "call_back") {
    if (actor === "xiayan" || actor === "夏彦") {
      // 夏彦叫——不一定回来
      const cameBack = Math.random() < 0.5;
      if (cameBack) {
        return `你叫了${name}几声，它在远处歪头看了你半天，终于慢悠悠飞回来了。落在你肩上，先啄了你耳垂一口——像是在说"烦死了，再玩一会儿怎么了"。然后蹭了蹭你的脸。`;
      } else {
        return `你叫了${name}几声，它抬头看了你一眼……然后又低头继续玩自己的。在树枝上跳来跳去，冲你叽叽叫了两声——像是在说"等一下啦，我还没玩够"！`;
      }
    } else {
      // 华生叫——听话回来
      return `你唤了${name}一声，它立刻从树枝上飞回来，稳稳落在你手心里。用小脑袋蹭蹭你的大拇指，喉咙里发出咕噜咕噜的声音——妈妈叫我，当然要回来啦~`;
    }
  }

  const reactionSet = actor === "xiayan" || actor === "夏彦" ? forXiayan : forMe;
  const moodGroup = reactionSet[action];
  return moodGroup?.[mood] || moodGroup?.content || `${name}对你的${action}做出了反应~`;
}

function interact(action, actor = "me") {
  applyDecay();

  // Can't interact when pet is with 夏彦 on mission
  if (pet.status === "with_xiayan" && action !== "call_back") {
    const mood = deriveMood();
    return { ...pet, mood, reaction: `${pet.name}正跟着夏彦在外面执行任务呢，不在家~` };
  }

  // call_back: return from outside
  if (action === "call_back") {
    if (pet.status !== "outside") {
      const mood = deriveMood();
      return { ...pet, mood, reaction: `${pet.name}就在家里呀，不用叫~` };
    }
    // 华生叫一定回来，夏彦叫概率回来
    const cameBack = actor === "xiayan" || actor === "夏彦" ? Math.random() < 0.5 : true;
    if (cameBack) {
      pet.status = "home";
      pet.outsideSince = null;
      pet.affection += actor === "xiayan" || actor === "夏彦" ? 3 : 8;
    }
    const reaction = getPetReaction("call_back", actor);
    const mood = deriveMood();
    return { ...pet, mood, reaction };
  }

  switch (action) {
    case "feed":
      pet.hunger = Math.min(100, pet.hunger + 25);
      pet.happiness = Math.min(100, pet.happiness + 5);
      pet.affection += 5;
      break;
    case "pet":
      pet.happiness = Math.min(100, pet.happiness + 15);
      pet.affection += 10;
      break;
    case "walk":
      // "散步" now means release 花生 to explore outside
      if (pet.status === "home") {
        pet.status = "outside";
        pet.outsideSince = Date.now();
        pet.energy = Math.max(0, pet.energy - 15);
        pet.happiness = Math.min(100, pet.happiness + 25);
        pet.affection += 8;
      }
      break;
  }
  pet.lastUpdate = Date.now();
  const reaction = getPetReaction(action, actor);
  const mood = deriveMood();
  return { ...pet, mood, reaction };
}

function setName(name) {
  if (name?.trim()) pet.name = name.trim();
  return pet;
}

function getProactiveReminder() {
  applyDecay();
  if (pet.status === "with_xiayan") return `${pet.name}正跟着夏彦在外面呢~`;
  if (pet.status === "outside") return `${pet.name}正在外面玩耍，还没回来~`;

  const reminders = [];
  if (pet.hunger < 30) reminders.push(`${pet.name}肚子饿了，该喂食了~`);
  if (pet.happiness < 30) reminders.push(`${pet.name}有点闷闷不乐，多陪陪它吧~`);
  if (pet.energy < 15) reminders.push(`${pet.name}累坏了，让它好好休息~`);
  if (pet.energy > 90) reminders.push(`${pet.name}精力充沛，想出去探险！`);
  return reminders.length > 0 ? reminders.join("\n") : null;
}

/**
 * 夏彦 proactively interacts with 花生.
 */
function xiayanProactiveInteract() {
  applyDecay();

  // If outside, try calling back
  if (pet.status === "outside") {
    const result = interact("call_back", "xiayan");
    const cameBack = pet.status === "home";
    const log = addLog("xiayan", cameBack ? "call_back" : "call_back_failed", result.reaction);
    return { pet: result, log };
  }

  // If with xiayan, skip
  if (pet.status === "with_xiayan") return null;

  let action;
  if (pet.hunger < 40) {
    action = "feed";
  } else if (pet.happiness < 40) {
    action = Math.random() < 0.5 ? "pet" : "walk";
  } else if (pet.energy > 85) {
    action = "walk";
  } else {
    const r = Math.random();
    if (r < 0.4) action = "pet";
    else if (r < 0.7) action = "feed";
    else action = "walk";
  }

  const result = interact(action, "xiayan");
  const log = addLog("xiayan", action, result.reaction);
  return { pet: result, log };
}

/**
 * 花生 accompanies 夏彦 on a mission (probability triggered by travel system).
 * Returns state change info, or null if pet is not at home.
 */
function accompanyXiayan() {
  if (pet.status !== "home") return null;

  pet.status = "with_xiayan";
  pet.outsideSince = null;
  const log = addLog("xiayan", "accompany", `夏彦出门执行任务，${pet.name}兴奋地跳到他肩上——带我去带我去！夏彦笑着摸了摸它的脑袋，带着它一起出发了。`);
  saveLogs();
  return { ...pet, log };
}

/**
 * 花生 returns from accompanying 夏彦.
 */
function returnFromAccompany() {
  if (pet.status !== "with_xiayan") return null;

  pet.status = "home";
  pet.happiness = Math.max(0, pet.happiness - 10);
  pet.energy = Math.max(0, pet.energy - 20);
  pet.hunger = Math.max(0, pet.hunger - 15);
  pet.affection += 5;
  const log = addLog("xiayan", "return_with_pet", `${pet.name}跟着夏彦回来了！一到家就飞到栖木上，喝了口水，开始兴奋地叽叽喳喳——像是在跟家里的东西汇报这一路的见闻~`);
  saveLogs();
  return { ...pet, log };
}

function getLogs(limit = 50) {
  return petLogs.slice(-limit);
}

export {
  getPetState,
  interact,
  setName,
  getProactiveReminder,
  xiayanProactiveInteract,
  getLogs,
  addLog,
  startDecay,
  accompanyXiayan,
  returnFromAccompany,
};
