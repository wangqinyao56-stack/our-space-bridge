---
name: project-feature-roadmap-20260815
description: 2026-08-15 用户拍板的大更新范围：5项优化+5项新功能，源自 awesome-ai-companion 清单
metadata:
  type: project
---

# 大更新路线图（2026-08-15 拍板）

来源：`DasterProkio/awesome-ai-companion` 清单。用户说"可优化的你就优化，新功能里共读/一起听歌/主动电话+语音信箱/关系成长模型/桌面形象都加"。

## 五项优化
1. 主动聊天改漂移轴驱动 — jiwen（想联系/倔强/情绪/焦虑/忙碌 5 轴）+ revive-companion 泊松触发
2. 情绪/失控改身体状态引擎 — Eventide/Tidefall 7 驱动力 + Drivesoid
3. 语音加听语气 — ears（语速/音高/停顿 vs 基线）+ Callhome SenseVoice 情绪标签
4. 记忆库补 dream 做梦消化 — Ombre dream + kiwi-mem（睡前消化当天记忆）
5. 小纸条加积分奖励 — Phosphene（积分账本/连击/成就/奖励兑换）

## 五项新功能
1. 共读 — coread/reading-nook（同读一本书、批注、进度同步）
2. 一起听歌 — Duetto（夏彦记得分享过的每首歌）
3. 主动电话+语音信箱 — Callhome（主动打来/忙时留言/睡前读故事）
4. 关系成长模型 — Aura（关系随时间深化、明确阶段）
5. 桌面 Live2D 立绘替换约会静态立绘 — Miru/LingChat（⚠️只加在外出约会场景）

## 已完成的记忆库
Ombre-Brain 公式已落地（lib/emotional-memory.js + weixin-bot 版），见 [[project-feature-roadmap-20260815]] 之前的会话。

**How to apply:** 一项项做，先优化后新功能。每项流程：扒对应源码 → 出方案 → 实现 → 测 → push。
