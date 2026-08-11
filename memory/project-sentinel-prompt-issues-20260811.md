---
name: sentinel-prompt-issues-20260811
description: 2026-08-11 向哨prompt调试记录——格式问题、模型切换、已知bug
metadata:
  type: project
---

# 向哨 Prompt 调试 — 2026-08-11

## 今日核心教训

**不要在 prompt 里跟模型打架。** 花了大量时间试图让 AI 遵守结构化格式（括号动作、[旁白]标记），但模型始终偏向自然散文。最终发现让 AI 做它擅长的事（纯散文+引号对话）比强制格式效果好得多。

## 已做改动

### 模型切换
- `[企业按量]claude-opus-4-6` → `[满血]gemini-3.1-pro-preview`
- 9100 API 代理的 Claude 指令跟随极差（可能是路由到了非 Claude 模型），Gemini 在格式遵守上稍好但输出风格偏短偏干

### 格式演进
- 括号动作格式 → 自然散文格式（去掉所有 `（）`）
- parseReply 改为提取 `"..."` 引号对话为夏彦对话，其余为叙述
- 兼容旧格式：`[旁白]` 标记和 `（）` 括号作为 fallback

### Token 调整
- startSession: 2000 → 3000
- playerAction: 4000 → 6000 → 8000

### Prompt 规则多次重写
- 去掉"你"视角 → 夏彦第三人称
- 禁止写华生动作（在规则3，但持续被违反）
- 动作叙述分离 → 纯散文
- 加"写饱满"指令

## 已知未解决问题

1. **AI 持续写华生动作** — 规则明确禁止但 Gemini 仍然写"华生皱着眉睁开眼"等，需要更强的约束方式
2. **对话堆在末尾** — 对话应该穿插在叙述中，但 AI 倾向于集中输出
3. **回复太短** — 需要更详细的场景描写
4. **SENTINEL_PROMPT 冲突嫌疑** — system-prompt-sentinel.md（900+行文学指令）可能在系统层覆盖了 userContent 的格式要求，这个假设没验证过
5. **parseReply 可能还需要调** — 纯散文格式下的解析稳定性待继续观察

## 当前配置
- 模型：`[满血]gemini-3.1-pro-preview` @ 9100 API
- 温度：0.5
- startSession maxTokens: 3000
- playerAction maxTokens: 8000
- 格式：纯散文，无括号，`"..."` = 夏彦对话，其余 = 叙述
- 视角：夏彦第三人称，不用"你"
