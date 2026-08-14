---
name: sentinel-format-lessons-20260812
description: 2026-08-12 向哨格式Debug完整复盘——根因/教训/防重复指南
metadata:
  type: project
---

# 向哨格式Debug — 2026-08-12 完整复盘

## 最终成果

- **模型**：`[k]claude-sonnet-4-5`（按次计费），指令跟随远好于 `[k-特特惠]claude-opus-5`
- **格式**：纯散文体，对话 `"..."` 穿插在叙述中，手机上一体渲染不分框
- **称呼**：叙述称"阿鹿"，夏彦对话自由叫宝宝/华生/老婆/心肝
- **铁则**：禁止替阿鹿写反应、禁止"不是...是..."、每段至少出现一次"夏彦"

## 根因分析

最初以为是 prompt 问题，反复改了三轮规则无效。真正的根因有两个：

### 1. 客户端分框渲染（核心问题）
`parseReply` 函数从 AI 输出中抽走所有 `"..."` 对话 → 单独放到 `xiayan` 字段 → 服务端先存 narration 再存 xiayan → 客户端先渲染一大段叙述，再渲染一个单独的对话框（XiayanBubble）。**无论 AI 写得多自然，手机上永远显示成分离的两个块。**

修复：parseReply 不再抽取对话。完整文本（含 `"..."` 引号）直接作为 narration 传给客户端。xiayan 置空，不推入 narrative 数组。

### 2. buildHistoryForAI 自相矛盾
历史消息构建时强制加 `[旁白]` 前缀 → 等于在训练数据里告诉模型"你应该用这个标记" → 和 prompt 里"不要用[旁白]"互相矛盾。

修复：去掉 `[旁白]` 前缀，历史消息直接存原始叙述文本。

### 3. 智能引号导致服务端崩溃
Edit 工具在编辑过程中把空字符串 `""` 替换成了 Unicode 弯引号 `""`（U+201C/U+201D）→ Node.js 无法解析 → 服务端崩溃重启 11 次。

教训：**每次编辑 JS 文件后必须用 `node --check` 验证语法。**

## 改动文件

- `lib/sentinel-guide.js`：parseReply/buildHistoryForAI/selectWorld/generateDoors 全部清理
- `system-prompt-sentinel.md`：输出格式重写+示例重写+自检清单+代词规则
- `system-prompt-sentinel-sfw.md`：同步
- `lib/ai.js`：默认模型切到 `[k]claude-sonnet-4-5`
- `SentinelGameScreen.tsx`：accentBg 透明度提高（RED 0.25→0.45，BLUE 0.4→0.55）+ 去掉 `[旁白]` 标签

### 追加修复：parseReply 第二次重写
`【系统】` 正则 `([\s\S]*?)(?=\n【数值变化】|\n【选项】|$)` 中的 `|$` 导致非贪婪匹配延伸到文本末尾 → systemNotification 吞掉了后面的所有叙述 → replace 后 working 只剩【系统】之前的文本。

修复：改用 index 定位 + 截取到空行或下一个 `【` 标记，保留【系统】后的叙述。

### 追加修复：客户端遮罩
- `accentBg` alpha 太低（0.25），背景图透过来看不清字 → 提高到 0.45（RED）/ 0.55（BLUE）
- 叙述块头部的 `[旁白]` 标签移除（格式已废弃）

## 防重复指南

下次向哨"格式不对"时，排查顺序：
1. `node --check` 确认代码无语法错误
2. 看 Sealos 日志确认部署成功、无重启循环
3. 检查 `parseReply` 是不是又把对话抽出来了
4. 检查 `buildHistoryForAI` 是不是加了不该加的前缀
5. **最后**才考虑 prompt 问题

## 追加修复：init 流程重构

**问题**：第一轮把 7 个阶段全塞进 phaseHint → 模型扫一眼就自己总结 → 直接跳到觉醒后，系统对话也不用【系统】块。

**修复**：
- 第一轮只做系统现身 + 世界介绍，其余按玩家节奏走
- phaseHint 里加了【系统】块的具体格式示例，模型照猫画虎效果好于读规则
- 第二轮起加"不要自己推进太快，等阿鹿的节奏"

**核心教训**：给模型的指令越长越细，它越不看。一轮只让它做一件事，效果最好。

## 当前状态

- 模型：`[k]claude-sonnet-4-5`（玖时，按次计费）
- 格式：纯散文体，对话穿插 + 【系统】分块，手机上合并渲染
- 客户端：accentBg 加深 + 复制按钮保留 + 无 [旁白] 标签
- init 流程：渐进式，由玩家节奏驱动
- parseReply：不再抽对话，【系统】用 index 精确截取
- "勉强能用"状态 — 可继续游戏测试，细节待打磨

相关：[[project-sentinel-game-status]] [[project-sentinel-prompt-issues-20260811]]
