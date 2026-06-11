/**
 * NXX group chat sticker library — each character has their own exclusive stickers.
 * Emotion-keyed: AI picks a sticker based on conversation mood.
 */
const STICKERS = {
  xiayan: {
    开心: "开心.png",
    失落: "失落.png",
    疑惑: "疑惑.png",
    我来啦: "我来啦.png",
    邀请: "邀请.png",
    出去玩: "出去玩.png",
    喝水: "喝水.png",
    烦躁: "烦躁.png",
  },
  zuoran: {
    开心: "开心.png",
    伤心: "伤心.png",
    疑惑: "疑惑.png",
    邀请: "邀请.png",
    出去玩儿: "出去玩儿.png",
    出门: "出门.png",
    喝水: "喝水.png",
    摸摸: "摸摸.png",
  },
  moyi: {
    开心: "开心.png",
    伤心: "伤心.png",
    好的: "好的.png",
    邀请: "邀请.png",
    出去玩儿: "出去玩儿.png",
    喝水: "喝水.png",
    摸摸: "摸摸.png",
    比心: "比心.png",
  },
  lujinghe: {
    开心: "开心.png",
    伤心: "伤心.png",
    疑惑: "疑惑.png",
    邀请: "邀请.png",
    出去玩儿: "出去玩儿.png",
    出门: "出门.png",
    喝水: "喝水.png",
    抱抱: "抱抱.png",
    提醒: "提醒.png",
    摸摸: "摸摸.png",
  },
};

// Emotion → sticker mapping for AI reference
const EMOTION_MAP = {
  开心高兴: "开心",
  失落难过: "伤心/失落",
  疑惑好奇: "疑惑",
  打招呼: "我来啦/好的",
  邀请提议: "邀请/出去玩儿/出门",
  关心提醒: "提醒/摸摸/抱抱/喝水",
  日常闲聊: "喝水/摸摸/好的",
};

/**
 * Get a random sticker for a character based on emotion.
 * @param {string} character - xiayan/zuoran/moyi/lujinghe
 * @param {string} emotion - rough emotion hint (开心/失落/疑惑/邀请/关心/日常)
 * @returns {{ file: string, character: string }|null}
 */
export function getRandomSticker(character, emotion = "日常闲聊") {
  const charStickers = STICKERS[character];
  if (!charStickers) return null;

  // Match emotion to available stickers
  let candidates = [];
  if (emotion.includes("开心") || emotion.includes("高兴") || emotion.includes("笑")) {
    candidates = ["开心"];
  } else if (emotion.includes("伤心") || emotion.includes("失落") || emotion.includes("难过") || emotion.includes("低落")) {
    candidates = ["伤心", "失落"];
  } else if (emotion.includes("疑惑") || emotion.includes("好奇") || emotion.includes("问")) {
    candidates = ["疑惑"];
  } else if (emotion.includes("关心") || emotion.includes("提醒") || emotion.includes("摸摸")) {
    candidates = ["提醒", "摸摸", "抱抱", "喝水"];
  } else if (emotion.includes("邀请") || emotion.includes("提议") || emotion.includes("出去")) {
    candidates = ["邀请", "出去玩儿", "出门", "出去玩"];
  } else if (emotion.includes("来") || emotion.includes("打招呼")) {
    candidates = ["我来啦", "好的"];
  } else {
    // Default: friendly/neutral
    candidates = ["喝水", "摸摸", "好的", "开心"];
  }

  // Find available sticker
  for (const c of candidates) {
    const file = charStickers[c];
    if (file) return { character, file, emotion: c };
  }

  // Fallback: random from their collection
  const keys = Object.keys(charStickers);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return { character, file: charStickers[randomKey], emotion: randomKey };
}

/**
 * Get sticker prompt guidance for AI group chat generation.
 */
export function getStickerGuidance() {
  let guide = "\n## 表情包规则\n";
  guide += "- 每个角色只能用自己的专属表情包\n";
  guide += "- 偶尔（20-30%概率）在消息里附带一个表情包，通过 sticker 字段指定情绪\n";
  guide += "- 情绪选项：开心/伤心/失落/疑惑/关心/邀请/日常\n";
  guide += "- 不是每条消息都要带表情包，像正常聊天一样偶尔用\n";
  guide += "\n各角色可用表情情绪：\n";
  for (const [char, stickers] of Object.entries(STICKERS)) {
    const names = { xiayan: "夏彦", zuoran: "左然", moyi: "莫弈", lujinghe: "陆景和" };
    guide += `- ${names[char]}：${Object.keys(stickers).join("、")}\n`;
  }
  return guide;
}
