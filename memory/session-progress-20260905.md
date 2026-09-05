---
name: session-progress-20260905
description: 2026-09-05 会话进行中进度快照（防闪退），阿鹿6个问题+模型切换+APK构建
metadata:
  type: project
---

# 2026-09-05 会话进度快照（防闪退用）

## 已完成并 push（our-space 后端，commit 5ebad04 + 316d10d）

1. **出差误触发**：lib/huasheng-travel.js 删危险正则 + 10天过期 + "我在家"纠偏词
2. **日常聊天接昨天话题**：lib/message-router.js 按 _isPast 分层（今天留24条可续聊，昨天只留3条回忆）
3. **番茄钟音乐混播**：server.js /api/audio/list 加 mime 过滤；PomodoroScreen 只拉 mime=audio/mp4
4. **佳佳亲密切宅恋**：weixin-bot/lib/api2d.js 加 useZilian + jiayia-chat-server.js intimate 传 useZilian（key sk-dK9NfGM..., 模型 [0.06]报用鹿/claude-opus-4.6），日常玖时不切
5. **云醉双频道重构**：weixin-bot-5 单频道→双频道（daily+intimate），新 prompt 已落地（残留华生/林游→云醉=0），心跳改宽容（连续3次无pong才踢，修反复断连），模型保持 [逆]claude-opus-4-6 不动
6. **佳佳/云醉加删除/重新回复**：前端长按菜单 + 后端 delete/regenerate + deleteMemoryByText
7. **苹果梗亲密切宅恋（已push 316d10d）**：weixin-bot-3/api2d.js useZilian + pingguogeng-chat-server.js intimate 传 useZilian（key sk-aJAqA4rlaRvjl9fcd2YDTTZelWsBuoqXIlpQiYNaKhz1xWod），日常玖时不切
8. **删278首旧OST**：data/audio/music/ 旧 mp3 删除（已备份 music-backup/278个）

## APK 构建进度（一个一个来）

- ✅ 云醉 APK：桌面 F:/Desktop/云醉-夏彦.apk（128MB，双频道+删除重发）
- ✅ 佳佳 APK：桌面 F:/Desktop/佳佳的夏彦.apk（65MB，删除重发）
- ✅ 我们的天地：构建完（393MB，39min），改眨眼key+立绘0.60→0.70+番茄钟音乐mime，**已 adb install 到 USB 33Z0224603009014**（第一次 no devices 失败，设备恢复后重装中 bw4ukp8t4）

## 模型切换（最后一步，commit 5048ca8）

**报用鹿死绝（成功率0%），全部换 [0.07]k茶/claude-sonnet-4-6**（sonnet不是opus）：
- 主后端 lib/message-router.js 2处（askZhailian 亲密相关 + 亲密空间）
- 佳佳 weixin-bot/lib/api2d.js ZILIAN_MODEL
- 苹果梗 weixin-bot-3/lib/api2d.js ZILIAN_MODEL
- 林游 weixin-bot-4/lib/api2d.js JIUSHI_MODEL + linyou-chat-server.js
- 共7处。云醉保持 [逆]claude-opus-4-6 没动（本来就非报用鹿）

## ⚠️ 待办（进行中）

1. **苹果梗亲密 prompt 更新 ✅ 已push**：F:/qq接收/苹果梗亲密prompt (1).docx 提取后**原样写入** weixin-bot-3/system-prompt-intimate.txt（commit cbafd8b）。**"华生"是爱称，用户明确说保留不要替换成"月儿"**（月儿是名字，华生是爱称）
2. **林游报错 ✅ 已定位**：jiushi 503 `No available channel for model [渠道1]claude-opus-4.6`。当前代码里**根本没有"渠道1"这个模型名**（已是宅恋[0.06]报用鹿），说明**Sealos 上 linyou-chat 后端是旧镜像**（用玖时[渠道1]claude-opus-4.6，已失效）。修复=Sealos 手动更新 linyou-chat 应用拉新镜像，不用改代码。

## Sealos 应用（用户已说"更新啦"，可能已手动更新）

需更新的应用（4个）：
- our-space-bridge（出差/日常断层/番茄钟音乐）
- yunzui-chat（云醉双频道+心跳）
- jiayia-chat（佳佳亲密宅恋）
- pingguogeng-chat（苹果梗亲密宅恋 + 亲密prompt更新）
- **linyou-chat（林游，修复503：旧镜像用了已失效的[渠道1]claude-opus-4.6，拉新镜像即可）**

## 构建环境（记牢）

- JAVA_HOME=F:/jdk-17/jdk-17.0.12+7
- GRADLE_USER_HOME=F:/gradle, ANDROID_HOME=F:/Android/Sdk, ANDROID_USER_HOME=F:/android-home
- NODE_OPTIONS=--max-old-space-size=8192, 必须 --no-parallel
- 云醉构建34min（cold build），佳佳8min（复用缓存）

## 2026-09-05 改模型（进行中，未完成）

报用鹿→k茶 sonnet 后又全废（k茶漏 thinking）。最终换熊猫站 api520.pro：
- 阿鹿自己 key `sk-J9tf0Ypjjp3vrBjiY0HYgUKcYju8WefQ2771laqIKYAh8hUP` 模型 `熊猫-A-29-claude-opus-4.6`
- 林游 key `sk-XzNsmmTNmnhRhmRTrZvxNCE7w0Vw8CAF` 模型 `熊猫-顶级特供-X-17-gemini-3.1-pro-preview`（日常+亲密都换）
- 佳佳/苹果梗换回 [逆]claude-opus-4-6（撤销宅恋 useZilian）
- 云醉不动（[逆]）

已完成：ai.js 加 askXiongmao；message-router.js 2处已改 askXiongmao+日志；diary.js 5处换 askXiongmao；林游 api2d+linyou-chat-server 换 api520.pro+gemini；佳佳/苹果梗 useZilian→逆；佳佳 jiayia-chat-server 亲密=逆

## 像素小屋删除消息修复（2026-09-05 完成，未 push）

用户问：App删除消息会同步删后台memory吗？退出小屋再进消息又显示。
根因：像素小屋删一条气泡只删 history 里那条（role+content），另一侧的回复还在，get_history(pixel_home,todayOnly) 又把剩下的那条吐回来。
修复：memory.js 加 deleteMessagePair（删某条 + 紧邻它另一侧同频道 user↔assistant），message-router 导出 deleteChatMessagePair，server.js delete_message 对 pixel_home 走 pair 删。
注意：像素小屋 chat 不走 parseMemoryTags（handlePixelHomeMessage 没调），所以小屋本来就不写 [记] 长期记忆，无需 deleteMemoryByText（主后端 emotional-memory.js 也没有这个函数）。

## 待办

1. commit + push 所有模型切换 + 删除修复改动
2. Sealos 重新部署 our-space-bridge（含像素小屋删除修复 + 模型切换）
