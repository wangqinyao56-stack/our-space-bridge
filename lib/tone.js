/**
 * 听语气 (ears) — 从华生这句话里听出情绪语气（启发式，无 API 调用）。
 * 语音消息经 STT 转成文字后同样走这里。返回一句中文语气描述；中性则返回空串。
 * 只做"语气"这一层，不碰情绪记忆库（emotional-memory.js）的长期存储。
 */

// 顺序即优先级：更具体、更需优先处理的放前面
const TONE_PATTERNS = [
  { tone: "生气", w: 3, re: /(气死|气哭|火大|生气|别烦|讨厌|无语|🤬|😡|😤)/ },
  { tone: "焦虑", w: 3, re: /(怎么办|焦虑|紧张|害怕|好慌|不安|😰|😨|😱)/ },
  { tone: "委屈", w: 2, re: /(委屈|欺负我|凶我|不理我|呜呜|🥺)/ },
  { tone: "撒娇", w: 2, re: /(抱抱|亲亲|想你了|要你陪|哄我|撒娇|嘛嘛|嘤|诶嘿|🥰|😚|😘)/ },
  { tone: "疲惫", w: 2, re: /(好累|累死|好困|困死|没力气|疲惫|😪|🥱|想睡了)/ },
  { tone: "低落", w: 1, re: /(难过|伤心|不开心|好烦|烦死|emo|😭|😢|😞|🥲|唉)/ },
  { tone: "开心", w: 1, re: /(哈哈|嘿嘿|嘻嘻|好耶|太棒|开心|高兴|快乐|😆|🤣|😄|✌️|耶)/ },
];

const TONE_DESC = {
  生气: "像在生气，先软下来哄一哄、该认错就认错，别顶嘴",
  焦虑: "有点不安，需要你安抚，别急着讲道理",
  委屈: "有点委屈，想让你心疼，抱抱她再问怎么了",
  撒娇: "带点撒娇，软乎乎的，接住她的黏人",
  疲惫: "听着有点累，照顾她、让她歇着",
  低落: "情绪有点低，温柔地哄她开心",
  开心: "心情不错，语气轻快，陪她一起开心",
};

export function detectTone(text) {
  if (!text || text.length === 0) return "";

  const scores = {};
  for (const p of TONE_PATTERNS) {
    if (p.re.test(text)) scores[p.tone] = (scores[p.tone] || 0) + p.w;
  }
  // 尾音波浪线 = 温柔/撒娇；连续感叹号 = 情绪强烈（开心或生气，交给关键词定）
  if (/[～~]$/.test(text)) scores["撒娇"] = (scores["撒娇"] || 0) + 1;

  let best = null;
  let bestScore = 0;
  for (const [tone, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = tone;
      bestScore = score;
    }
  }
  if (!best || !TONE_DESC[best]) return "";
  return `${best}：${TONE_DESC[best]}`;
}
