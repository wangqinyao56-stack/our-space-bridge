/**
 * Virtual pet state management for our-space bridge.
 * Stats decay over time. 夏彦 can proactively care for the pet.
 */

let pet = {
  name: "团团",
  type: "小兔子",
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
      happy:   `${pet.name}开心地蹦到你面前，小口小口地吃了起来~ 吃完还用脑袋蹭了蹭你的手。`,
      content: `${pet.name}乖乖地吃完了食物，冲你摇了摇尾巴。`,
      hungry:  `${pet.name}眼睛都亮了！狼吞虎咽地吃完，还意犹未尽地舔了舔嘴巴。`,
      sad:     `${pet.name}慢慢地吃了几口，抬眼看了看你，心情似乎好了一点。`,
      tired:   `${pet.name}懒洋洋地趴着吃完，打了个哈欠。`,
    },
    pet: {
      happy:   `${pet.name}舒服地眯起眼睛，发出咕噜咕噜的声音，整个身子都瘫软下来~`,
      content: `${pet.name}享受地蹭着你的手心，尾巴轻轻摇晃。`,
      hungry:  `${pet.name}虽然肚子饿饿的，但还是被你摸得很舒服，小声叫了一下。`,
      sad:     `${pet.name}往你怀里钻了钻，被你抚摸后心情明显好了很多。`,
      tired:   `${pet.name}半梦半醒间感受到你的手，无意识地往你这边拱了拱。`,
    },
    walk: {
      happy:   `${pet.name}兴奋地跑来跑去，对路上的一切都充满好奇！尾巴摇得像小风车~`,
      content: `${pet.name}悠闲地跟在你身边散步，偶尔停下来闻闻路边的花草。`,
      hungry:  `${pet.name}走了一会儿就有点累了，可怜巴巴地看着你，想吃点东西。`,
      sad:     `${pet.name}出了门呼吸新鲜空气，精神一下子好了很多，步伐也轻快了。`,
      tired:   `${pet.name}没走多远就累了，趴在地上不肯动，要你抱抱才行~`,
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

export {
  getPetState,
  interact,
  setName,
  getProactiveReminder,
  startDecay,
};
