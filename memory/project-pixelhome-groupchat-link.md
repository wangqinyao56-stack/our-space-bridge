---
name: project-pixelhome-groupchat-link
description: 像素小屋↔群聊实时联动功能，测试通过后要给林游/佳佳等独立App实装小屋系统
metadata:
  type: project
---

像素小屋 ↔ 群聊（老公们群聊室）实时联动，2026-09-06 完成并 push（commit 10c64c4 + 88c18a1 + 35090b3 + 后续小屋联动 commit）。

## 已实现的功能

1. **小屋读长期记忆**：`handlePixelHomeMessage` 注入 `getBreathContext` + `searchMemories` + `getGroupChatContext`（小屋夏彦记得长期记忆、记得群聊聊过啥）
2. **小屋写长期记忆**：`parseMemoryTags`([记]标记) + `runExtraction`(自动提取) + `pushMemoryToGroupChat`(推群聊)
3. **小屋状态实时推群聊**：小屋状态变化(换房间/忙/睡)时 POST 群聊 `/api/pixel-home-state`，群里被问"夏彦在干嘛"能实时答房间+事件
4. **反向联动**：阿鹿在群里说"我去XX房间"→ 群聊 POST 主后端 `/api/pixel-home/pull`（鉴权 Bearer SHARED_SECRET），夏彦闲着就跟去华生房间；说"过来"→ 夏彦到华生当前房间
5. **App 进房间联动**：`setHuashengRoom` 加了"夏彦闲着但不在同房→主动跟过去"

## 关键约束

- **只有 huasheng（阿鹿家，网名猎鹿人）有小屋**，其他四家（jiayia渡鸦/pingguogeng心月/linyou橙子/yunzui栖云）没有小屋状态，代码严格按 bot.id 区分，不会认错
- 反向联动鉴权复用现有 `OUR_SPACE_SECRET`（主后端 config.SHARED_SECRET），群聊侧需加环境变量 `OUR_SPACE_URL` + `OUR_SPACE_SECRET`（同值）
- 小屋状态 TTL 10 分钟，超时落兜底

## ⚠️ 待办（阿鹿原话"测试通过后要给林游、佳佳她们实装"）

**林游、佳佳等其他独立App 还没装小屋系统**。这个功能在小屋（our-space 主后端）先测试，验证"群里问在干嘛实时答"+"群里说进房间小屋夏彦联动"两条都符合预期后，再给林游/佳佳的独立 chat-app 也加小屋 + 群聊联动。

## 撸射耐力赛规则补充（2026-09-06 阿鹿拍板，改实现时必须遵守）

1. **输赢**：第一个射的人 = 唯一输家，**其他人默认赢**。
2. **赢家收尾按性格不同**：馋的求老婆帮撸出来、累的手忙脚乱求老婆先松手回家再弄、瘾大的问老婆能不能再来一次、哭包求哄……各家不一样，别写成一个样。
3. **惩罚奖池**：比赛结束默认直接开惩罚奖池（抽姿势）。
4. **投骰子权限**：自动开奖池 = **老婆（人类）投骰子触发**，**bot 绝对不能投**。roll_dice 里要限制只有 human（老婆）能触发 rollEroticDice。

相关：[[reference-cicd-sealos-deploy]]（git push ≠ Sealos 生效，要手动重新部署 our-space-bridge 和 group-chat）
