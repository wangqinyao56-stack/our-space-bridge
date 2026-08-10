---
name: project-sentinel-fix-20260809
description: 向哨8连修 2026-08-09 + 2026-08-10 系统解说prompt迭代+UI修复
metadata:
  type: project
---

# 向哨 2026-08-09~10 大修

## 2026-08-10 追加

### 客户端 UI 修复
- **红色UI跳回bug**：`SentinelGameScreen.tsx` 6处硬编码RED改动态C.*覆盖
  - `bgSource` 初始值 STORY_BG → SAFEHOUSE_BG
  - `topTitle`/`topBar`边框/`textInput`/`loadingText`/`refreshBtnText` 全部加 C.* 内联覆盖
- APK 已构建安装到手机

### 服务端 — 首轮系统解说 prompt 三次迭代

**迭代1**：七阶段结构化流程（系统现身→世界观→哨向→觉醒→安全屋→系统自身→论坛），但prompt 3000+ token，AI迷失在感官描写里，系统从未出现

**迭代2**：压缩到1/3，加强制限速（开场≤3句、系统前100字出现），仍不生效

**迭代3（最终版）**：发现根因是系统性格理解错误
- 之前：系统="不耐烦打工人"
- 正确（来自system-prompt-sentinel.md）：系统=愉快旁观者，乐见痛苦→愉悦赞美，幸福→遗憾嘲讽，被规则锁着能龇牙不能咬
- 全部示例台词替换为正确性格
- 资质测试流程：系统开心恐吓"普通人活三天"→测试→觉醒→系统真心失望"啧。双精神体和白鹿。真行。"
- 输出格式强制：[旁白]→（动作）→"对话"→【系统】四者循环

### 数值公式重构
- `applyStatDrift` 从全随机改为半确定性：探索按轮次消耗、BOSS加速恶化、安全阶段恢复
- AI prompt 规则10升级：代码处理被动漂移，AI只报重大事件额外变化，附完整公式量级参考
- 系统对话约束写入prompt：不能说谎/剧透/建议选门/干预副本/表露情感

## 2026-08-09（原记录）

### 服务端 sentinel-guide.js
- **Bug1 BGM+UI切换**: `updateStateFromReply` init→door_select 必须 `_initRounds>=3`；世界进入只在 door_select 阶段触发
- **Bug2+3 开场**: `startSession` 从空白空间改为安全屋（床/桌/椅/暖灯/铁门），渐进式觉醒强化
- **Bug4 副本通报**: `selectWorld` 要求输出【系统】副本世界观+规则提示
- **Bug7 系统框架**: `parseReply` 正则补 `\n【系统】` 截断点，系统消息不再吃进旁白
- **Fallback** 文本同步改安全屋

### Prompt 文风重构 (system-prompt-sentinel.md + sfw.md)
- 写作铁律完全重写：动作推进优先 / 身体反应优先 / 短段落≤4行 / 删文学腔散文腔 / 删"如月光般"类比喻

### 夏彦人设强化（双prompt同步）
- 对外：冷的锋利的利落的——特工底色
- 对她：声音自动切换柔软 / 撒娇+肢体接触 / 占有欲 / 对她受伤极高敏感度
- **安全网**：她害怕手抖了他握住，她卡住了他说"没关系慢慢来我等你"

### App端
- **Bug5 论坛**: `getPost()` 改异步查服务端帖子；`ForumPostScreen` 异步加载

## 部署状态
- 服务端 pushed (`a60bd94`) — Sealos 自动部署
- App APK 已装 (`app-release.apk`)

## 相关
- [[project-sentinel-game-status]]
- [[project-sentinel-update-20260807]]
