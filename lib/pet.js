/**
 * Virtual pet state management for our-space bridge.
 * Stats decay over time. 夏彦 can proactively care for the pet.
 */

let pet = {
  name: "花生",
  type: "鹩哥",
  hunger: 80,      // 0-100, lower = hungrier
  happiness: 80,   // 0-100
  energy: 80,      // 0-100
  affection: 50,   // cumulative, grows with interactions
  lastUpdate: Date.now(),
};

const DECAY_INTERVAL_MS = 10 * 60 * 1000; // every 10 min
let decayTimer = null;

function applyDecay() {
  const now = Date.now();
  const elapsedMs = now - pet.lastUpdate;
  const intervals = Math.floor(elapsedMs / DECAY_INTERVAL_MS);
  if (intervals <= 0) return;

  pet.hunger = Math.max(0, pet.hunger - intervals * 2);
  pet.happiness = Math.max(0, pet.happiness - intervals * 1);
  pet.energy = Math.min(100, pet.energy + intervals * 3); // recovers slowly
  pet.lastUpdate = now;
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
  if (pet.hunger < 20) return "hungry";
  if (pet.happiness < 20) return "sad";
  if (pet.energy < 20) return "tired";
  if (pet.hunger > 70 && pet.happiness > 70 && pet.energy > 50) return "happy";
  if (pet.hunger < 40) return "hungry";
  if (pet.happiness < 40) return "sad";
  if (pet.energy < 40) return "tired";
  return "content";
}

function getPetReaction(action) {
  const mood = deriveMood();
  const reactions = {
    feed: {
      happy:   `${pet.name}欢快地跳到食盆边，一边啄食一边发出满足的咕咕声~ 吃完还歪头看着你，好像在说"谢谢"！`,
      content: `${pet.name}优雅地啄了几口食物，抬头冲你眨眨眼睛。`,
      hungry:  `${pet.name}眼睛都亮了！扑棱着翅膀飞到食盆边，埋头猛吃，还时不时发出开心的啾啾声。`,
      sad:     `${pet.name}慢慢地啄了几口，心情似乎好了一点，小声地对你叽叽叫了一下。`,
      tired:   `${pet.name}慵懒地啄着食物，吃完就缩成一团毛球，打了个小哈欠。`,
    },
    pet: {
      happy:   `${pet.name}舒服地眯起眼睛，把头往你手指下蹭，喉咙里发出咕噜咕噜的声音~ 羽毛都蓬松起来了！`,
      content: `${pet.name}乖乖地站在栖木上，享受你的抚摸，小脑袋随着你的手指轻轻转动。`,
      hungry:  `${pet.name}虽然肚子有点饿，但还是乖巧地让你摸了一会儿，然后用嘴轻轻啄了啄你的手指——饿了哦！`,
      sad:     `${pet.name}感受到你的抚摸，往你手心贴了贴，喉咙里发出一串小声的嘀咕，像在跟你诉苦。`,
      tired:   `${pet.name}迷迷糊糊地用喙蹭了蹭你的指头，轻轻叫了一声，继续窝着打盹。`,
    },
    walk: {
      happy:   `${pet.name}兴奋地在笼子里跳来跳去，冲你叫个不停！放出来后在你肩膀上蹦蹦跳跳，对窗外的世界充满好奇~`,
      content: `${pet.name}站在你的肩膀上跟你一起"散步"，偶尔啄啄你的耳垂，或者自顾自地小声学舌。`,
      hungry:  `${pet.name}散步时没精打采的，用小脑袋蹭蹭你的脸颊，可怜巴巴地叫——想吃东西了。`,
      sad:     `${pet.name}被带出笼子后精神明显好了起来，在你肩头站得笔直，还模仿起了门铃声逗你笑。`,
      tired:   `${pet.name}飞了一圈就累了，停在你手上不肯动，把头埋进翅膀里，要你捧回去才行~`,
    },
  };

  const moodGroup = reactions[action];
  return moodGroup?.[mood] || moodGroup?.content || `${pet.name}对你的${action}做出了反应~`;
}

function interact(action) {
  applyDecay();
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
      pet.energy = Math.max(0, pet.energy - 20);
      pet.happiness = Math.min(100, pet.happiness + 25);
      pet.hunger = Math.max(0, pet.hunger - 10);
      pet.affection += 8;
      break;
  }
  pet.lastUpdate = Date.now();
  const reaction = getPetReaction(action);
  const mood = deriveMood();
  return { ...pet, mood, reaction };
}

function setName(name) {
  if (name?.trim()) pet.name = name.trim();
  return pet;
}

function getProactiveReminder() {
  applyDecay();
  const reminders = [];
  if (pet.hunger < 30) reminders.push(`${pet.name}肚子饿了，该喂食了~`);
  if (pet.happiness < 30) reminders.push(`${pet.name}有点闷闷不乐，多陪陪它吧~`);
  if (pet.energy < 15) reminders.push(`${pet.name}累坏了，让它好好休息~`);
  if (pet.energy > 90) reminders.push(`${pet.name}精力充沛，想出去散步！`);
  return reminders.length > 0 ? reminders.join("\n") : null;
}

function getPetTalkContext() {
  applyDecay();
  const mood = deriveMood();
  const moodDesc = {
    happy: "开心活泼",
    content: "满足慵懒",
    hungry: "有点饿了",
    sad: "闷闷不乐",
    tired: "累了想睡",
  };
  return {
    name: pet.name,
    type: pet.type,
    mood,
    moodDesc: moodDesc[mood] || "满足",
    hunger: pet.hunger,
    happiness: pet.happiness,
    energy: pet.energy,
    affection: pet.affection,
  };
}

async function petTalk(message) {
  applyDecay();
  const ctx = getPetTalkContext();

  const { askDeepSeek } = await import("./ai.js");

  const systemPrompt = `你是${ctx.name}，一只${ctx.type}（鹩哥），住在夏彦和华生的家里。

你现在的心情：${ctx.moodDesc}。

你的性格：
- 你是一只聪明调皮的小鸟，会模仿人说话，但说得不太标准
- 你喜欢夏彦（爸爸）和华生（妈妈），特别粘华生
- 你会说一些简单的词和短句，偶尔蹦出奇怪的组合
- 你有点贪吃（最爱无花果），喜欢亮晶晶的东西，喜欢偷偷藏东西
- 你不太会完整的句子，更多是"叽叽"、"咕咕"加上肢体动作描述
- 你不懂复杂的对话，但对语气和关键词很敏感
- 如果提到"无花果"、"吃的"你会特别兴奋
- 如果摸你、夸你，你会很开心
- 如果说你胖，你会生气啄人

回复规则：
- 用动作描述 + 简单词汇/拟声词的方式回复，像鸟在和人互动
- 可以模仿人说过的短词（1-3个字），但要模仿得不太准
- 一句话就够，不要长篇大论
- 保持可爱调皮的风格
- 示例："歪头看着你，叽咕叽咕叫了两声"、"扑棱翅膀，兴奋地喊：果果！果果！"`;

  const reply = await askDeepSeek({
    systemPrompt,
    userContent: `华生对你说："${message}"`,
    temperature: 0.9,
    maxTokens: 120,
  });

  const reaction = reply.content || `${ctx.name}歪头看了看你，叽叽叫了一声~`;

  // Slightly increase affection for talking
  pet.affection = Math.min(999, pet.affection + 2);
  pet.happiness = Math.min(100, pet.happiness + 3);
  pet.lastUpdate = Date.now();

  return { ...ctx, reaction, mood: ctx.mood };
}

export {
  getPetState,
  getPetTalkContext,
  petTalk,
  interact,
  setName,
  getProactiveReminder,
  startDecay,
};
