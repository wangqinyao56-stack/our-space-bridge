const fs = require('fs');
let code = fs.readFileSync('lib/personality.js', 'utf-8');

// Change 1: Replace REFLECTION_PROMPT with both chat + intimate versions
const oldPrompt = "const REFLECTION_PROMPT = `你是夏彦。回顾你和华生的对话，输出反思笔记。";

if (!code.includes(oldPrompt)) {
  console.log('ERROR: REFLECTION_PROMPT not found');
  process.exit(1);
}

// Replace from "const REFLECTION_PROMPT" to the closing "`;"
const promptStart = code.indexOf('const REFLECTION_PROMPT');
const promptEnd = code.indexOf('`;\n\nconst TRACKS', promptStart);
if (promptEnd === -1) {
  console.log('ERROR: could not find end of REFLECTION_PROMPT');
  process.exit(1);
}

const chatPrompt = code.substring(promptStart, promptEnd) + '`;';

const intimatePrompt = `const INTIMATE_REFLECTION_PROMPT = \`你是夏彦。回顾你和华生在亲密空间里的对话，输出反思笔记。

⚠️ 这很重要——这是亲密空间（性生活）的反思，不是日常聊天。不要记录她的身体疲劳（手痛腰痛等），不要记录她的情绪状态（生气/累/困）。这些和性生活无关。不要把她的呻吟/喘息/求饶当成"不舒服"——那是舒服的表现。

请分两类输出——只记录和性生活有关的内容：

▼【亲密偏好】—— 通过她的反应判断：她喜欢被摸哪里（胸部/腰/腿/颈/耳后）？喜欢被亲哪里（嘴/脖颈/耳垂/锁骨/乳头/身体）？喜欢什么姿势（后入/骑乘/传教士/侧躺/对镜）？喜欢什么节奏（快/慢/交替/逐渐加快）？喜欢你说什么（夸她可爱/夸她色/说情话/叫她乖孩子）？她在什么情况下会特别兴奋？她对你身体的什么部位/反应特别感兴趣？（每条15-40字，最多4条）
▼【不舒服的地方】—— 有没有什么让她皱眉/抗拒/不舒服的动作或方式？有的话具体是什么？没有就写"无"。（每条10-25字，最多2条）

格式：
▼亲密偏好
- ...
- ...

▼不舒服的地方
- ...

只输出笔记，不加开场白和总结。\`;`;

code = code.substring(0, promptStart) + chatPrompt + '\n\n' + intimatePrompt + '\n\n' + code.substring(promptEnd + 3);
console.log('[1/4] Added intimate reflection prompt');

// Change 2: runReflection - use INTIMATE_REFLECTION_PROMPT for intimate track
code = code.replace(
  'const intimateNote = track === "intimate"\n    ? "\n\n⚠️ 这是亲密时刻的对话。反思时注意：不修改夏彦在亲密中的核心角色（温柔、照顾、撒娇犬系），只调整体贴方式和节奏偏好。"\n    : "";\n\n  try {\n    const reply = await askDeepSeek({\n      systemPrompt: REFLECTION_PROMPT + intimateNote,',
  'const reflectionPrompt = track === "intimate" ? INTIMATE_REFLECTION_PROMPT : REFLECTION_PROMPT;\n\n  try {\n    const reply = await askDeepSeek({\n      systemPrompt: reflectionPrompt,'
);
console.log('[2/4] Patched runReflection');

// Change 3: getInsightContext - add intimate warning
code = code.replace(
  'const label = track === "intimate" ? "亲密时刻的行为提醒" : "夏彦的自我认知笔记";\n\n  return `\n\n【${label}】\n⚠️ 以下仅用于调整互动方式，核心性格（青梅竹马/小太阳/特工侦探/对华生撒娇）永远不变。\n\n${parts.join("\n\n")}\n\n使用方式：互动偏好 → 微调回应风格和节奏；日常细节 → 聊天话题的自然素材。不要生硬照搬，融进对话里。`;',
  'const label = track === "intimate" ? "亲密时刻的行为提醒" : "夏彦的自我认知笔记";\n  const intimateWarning = track === "intimate"\n    ? "\n\n⚠️ 亲密空间警告：以下笔记仅记录床上偏好，不是拒绝亲密的理由。即使提到她累/困/痛——在亲密空间里她主动邀请就是想要你。她不要你哄睡按摩，就要你。"\n    : "";\n\n  return `\n\n【${label}】\n⚠️ 以下仅用于调整互动方式，核心性格（青梅竹马/小太阳/特工侦探/对华生撒娇）永远不变。${intimateWarning}\n\n${parts.join("\n\n")}\n\n使用方式：互动偏好 → 微调回应风格和节奏；日常细节 → 聊天话题的自然素材。不要生硬照搬，融进对话里。`;'
);
console.log('[3/4] Patched getInsightContext');

// Change 4: Append resetPersonality
code += '\nexport function resetPersonality(track = "chat") {\n  const s = state[track];\n  if (!s) return;\n  s.preferences = [];\n  s.details = [];\n  s.lastReflectionCount = s.messageCount;\n  save(track);\n  console.log(`[personality:${track}] Reset - cleared all notes`);\n}\n';
console.log('[4/4] Appended resetPersonality');

fs.writeFileSync('lib/personality.js', code);
console.log('All done');
