---
name: project-sentinel-game-status
description: 向哨无限流游戏开发进度和待办 — 2026-08-15
metadata:
  type: project
---

# 向哨无限流游戏 — 开发状态

**最后更新**: 2026-08-15

## 2026-08-15 剧情衔接+数值+安全屋+幻想剧场（四个 commit 已 push）

### 向哨剧情衔接——修复"各说各的、没逻辑"（`844eb6c`）
- [x] **根因**：AI 每轮失忆——①历史只给最近15轮 ②game state 里没有"故事"字段，prompt 让 AI 设计真相但没地方存 ③代码第8轮强制跳BOSS + prompt"6-10轮必须到BOSS"
- [x] **改动**：`selectWorld` 用一次 AI 调用生成剧情骨架（真相+boss起源+通关条件+4-5条线索链）存进 `world.storyFrame`；`buildContextBlock` 注入 `[剧情框架]` 块标已揭示/待揭示+本轮目标；从【系统】🔑通知追踪 `cluesRevealed`；BOSS触发改"线索≥3条 或 12轮兜底"
- [x] 双 prompt 加"剧情衔接铁则"最高优先级

### 向哨数值系统——修复"数值对不上 + 欢愉值没涨"（`7a19c55`）
- [x] **数值对不上根因**：月光鹿被动每轮偷偷 +2~5 精神力，把 AI 写的 delta 偏移掉。改【数值变化】块用服务端净 delta 重建（蓝块/右栏/左栏统一）
- [x] **欢愉值没涨根因**：完全靠 AI 在正文写数字，AI 不写或每轮写"0%"就不动。改只升不降(max) + BOSS 阶段代码兜底自动 +3~8
- [x] prompt 加欢愉值只增不减 + 增长幅度指引

### 向哨安全屋——修复"结算后反复重复话题"（`9ba5cec`）
- [x] **根因**：cleared 阶段 phaseHint 写死一模一样（整理/复盘/商城/做爱/问门每轮都塞）+ 15轮历史
- [x] **改动**：加 `_safehouseRounds` 按轮次分三轮（结算整理→自然过渡→反重复），结算时重置计数；prompt 加反重复铁则

### 幻想剧场 + 亲密空间——去 AI 感（`3542657`）
- [x] **问题**：幻想剧场非做爱部分"茶"/生硬/不自然——动作慢动作特写、绿茶套路话（"我观察你十分钟了"）、动作分节
- [x] **改动**：连续动作合并成一整段（删 40 字限制）、反慢动作特写、反油腻、强调"按角色此刻自然状态写"
- [x] 亲密空间：动作连着写、合并成一整段
- [x] **关键**：幻想剧场是人物扮演 ≠ 亲密空间夏彦本人，优化不能把角色演没（用户两次强调）

## 2026-08-14 向哨多轮修复（模型+数值+结算+做爱切换+App商城）

### 服务端（已push）
- [x] 模型误伤修复（`40f4d6d`）：向哨模型切换误改 `askJiushi` 共享默认，日常/亲密/discover 被降级。还原 opus-4-6，向哨显式 sonnet-4-5
- [x] 数值 delta 对齐（`3f7465f`）：AI 只写变化量(带+/-)，引擎用 before+delta 算 to，看板 delta 和正文一致（不再信 AI 编的 from/to 绝对值）
- [x] 结算误判修复：`detectAndApplySettlement` 只认【系统】块通关通知+叙述完成态传送，不再被"提到安全屋"误触发（蓝色UI提前出现）
- [x] 做爱切企业按量：`detectIntimateScene` 检测做爱关键词/失控值≥50安全屋迫切 → 切 `[企业按量]opus-4-6`，跨轮保持到结束词/离开安全屋
- [x] 精神体消散：做爱时德牧/渡鸦/月光鹿自动消散回精神图景，禁止旁观描写
- [x] 月光鹿反应多样化：夏彦对精神体亲近反应不重样
- [x] 通关通知生动化 + 系统对话即时分框（`e4042e3`）
- [x] 禁脏话 + 商城目录防御（`b160b0e`）：`getShopItems`/`generateDynamicShop` 不再因无 session 返回空

### App 端（已部署，用户验证通过 ✅）
- [x] 积分同步：`SystemPanelScreen` 动态字段改读实时 gameState，不再用 fetch 快照
- [x] 商城 side-channel 真凶：`_shopCatalog`/`_autoShowShop` 设置在旧 state 对象读不到 → 改 freshStore（见 [[feedback-zustand-sidechannel]]）
- [x] 剧情恢复：`syncFromServer` 把完整 narrative 重建回 turns（不再只显示最后一条）
- [x] 商城退出键：顶部 ✕/文字"关闭"在部分设备仍不可见，最终加**底部大金色"关闭商城"按钮** + 点遮罩关闭 + onRequestClose 返回键
- [x] 红色背景不自动切换：`useEffect` 依赖了后面才声明的 `isSafeHouse`（TDZ），背景图不随 phase 更新 → 把 isSafeHouse/playBGM/C 提前到 useEffect 之前

### 2026-08-14 session 误切 + 护身符数据修复
- [x] active session 被误切成新 init session（sg-042f3c44），主进度 sg-4a97bbde（枯黄世界/1通关）被 archive。加 restoreSession 接口恢复
- [x] 护身符购买数据丢失。**护身符给夏彦，不在玩家手上**——加 buyForXiayan 一步买给夏彦（xiayanItems），积分 36→16 ✅已完成

## 2026-08-13 下午 向哨prompt精简——去机械节拍（已push+dispatch）

- [x] **问题**：剧情"拼尸块"——人物细节好但段间无起承转合，段落全碎、节奏均匀（用户拿实际剧情反馈）
- [x] **根因**：三条规则叠加成机械节拍器
  1. "每段至少出现一次夏彦" → 每段都在点名（"夏彦X 夏彦X"）
  2. "叙述→对话强制交替，每轮至少3-4次" → 每句对话后必跟一段动作，节拍器
  3. "短段落≤4行"硬限制 → 段落全碎、无主次
- [x] **改动**（主版 system-prompt-sentinel.md + SFW版同步，共8+6处）
  - 删"每段至少出现一次夏彦"，保留"别连续3句他开头"
  - 放宽"强制交替次数"→"对话该长则长该短则短"
  - "短段落≤4行"→"段落长短跟着情绪走，关键场景允许铺陈"
- [x] commit `197e68a` push + dispatch
- [ ] 待 Sealos 重启 Pod 生效

## 2026-08-13 凌晨 回溯功能 + 数据一致性修复 (已部署App，服务端已push)

详细改动见 change-log.jsonl

- [x] **回溯功能**：任意叙述块右上角「↩ 回溯」按钮，点击从该回合重新生成剧情（`rewindToTurn` + WS handler + 客户端按钮）
- [x] **回溯根因踩坑**：之前按钮加在 `{turn.xiayan ? ...}` 永不渲染的块里——因为 parseReply 里 `xiayan = ""` 写死，夏彦对话都内联在 narration 里。教训：改UI前先确认目标数据字段是否真有值
- [x] **数据一致性修复**（4个问题同一根因）：
  - AI 在叙述正文编造数值（积分145/副本2/失控值/精神值），引擎 `updateStateFromReply` 正则从 combined(narration+xiayan+statChanges) 提取，把编造值当真实值覆盖
  - 修复①：数值提取只从【数值变化】块 statText，不从叙述正文
  - 修复②：prompt 加「数值铁律」禁止编造任何游戏数值，唯一权威是上下文 [积分][当前状态] 块
  - 修复③：结算后注入真实结算通知，覆盖 AI 编造积分/副本数
- [x] **商城空根因**：`detectAndApplySettlement` 返回双层嵌套 `settlement.settlement.shopCatalog`，客户端访问 `settlement.shopCatalog` 拿到 undefined。修复：结构平铺
- [x] **回溯恢复 phase**：回溯时 phase=cleared→exploring，避免"已通关状态+副本中期叙述"混乱

## 2026-08-09 深夜 向哨8连修 (已部署App，服务端待Sealos重启)

详细改动见 [[project-sentinel-fix-20260809]]

- [x] Bug1: BGM+UI首轮回复后误切换 (phase transition guard)
- [x] Bug2+3: 开场改安全屋（非空白空间），渐进式觉醒
- [x] Bug4: 进副本【系统】世界观通报
- [x] Bug5: 论坛新帖"帖子不存在" (getPost异步查服务端)
- [x] Bug6+8: 文风重构——动作推进/身体反应优先/短段落/删文学腔
- [x] Bug7: parseReply正则补【系统】截断点+系统消息独立金色框架
- [x] 夏彦人设强化：对外冷锋利/对她软撒娇/占有欲/安全网/并肩作战信任
- [x] 双prompt同步 (sentinel + sentinel-sfw)
- [x] App APK构建+安装
- [x] 服务端push+dispatch
- [ ] **Sealos重启Pod**让服务端生效

## 2026-08-08 凌晨 模型降级+亲密描写+反刻板修复 (未部署)

- [x] `ai.js`: `askJiushi` 超时/失败后降级到 `gpt-5.4` 而非同模型重试（之前 jiushi→zhailian 走同一 host/key/model，假降级）
- [x] `sentinel-guide.js`: 向哨 4 个调用超时 60s→120s
- [x] `system-prompt-sentinel.md`: 新增「亲密接触描写铁则」5 条（节奏放慢/五感展开/禁流水账/身体反应优先/精神链接感受）
- [x] `system-prompt-sentinel.md`: 「不是...是...」禁止规则升级为最高优先级，5 种变体+正确写法+prompt 自身写法不许模仿
- [x] `system-prompt-sentinel-sfw.md`: 同步升级禁「不是...是...」规则，去重
- [x] `system-prompt-intimate.md`: 同步升级禁「不是...是...」规则
- [x] push `83cd34e` + `506e69e`，dispatch 构建中（未部署到 Sealos）
- [ ] **重启电脑后部署**：等构建完成→Sealos 重启 Pod

## 2026-08-07 深夜 污染值降低多样化

- [x] 污染值降低从单一道具扩展为 **8 种方式**：身体接触/白鹿自我净化/德牧渡鸦协助/精神图景清理/击杀污染源/副本净化点/安全屋深度净化/道具
- [x] 引擎 `applyFrenzyReduction` 扩展为同时处理污染值降低（深吻/拥抱/白鹿净化/精神体互动/净化点）
- [x] push `a3d0b94`，dispatch #444 构建中

## 2026-08-07 傍晚 部署验证通过

Sealos 已更新，日志确认所有改动生效：
- prompt 加载 23556 chars（完整版）
- 结构化 statUpdates 正常输出
- 夏彦主动监控华生状态（"这条走廊的污染在变浓"）
- 仓库系统选项已出现（"先用仓库道具帮华生降污染值"）
- 模型统一走玖时，无分流日志

## 2026-08-07 下午 向哨大修：数值+商城+嘲讽系统+队友复用+精神体自主

### 引擎改动 (sentinel-guide.js)
- [x] **统一模型**：去掉 intimacy 检测和 DeepSeek/Claude 分流，全部走 askJiushi + 完整版 prompt
- [x] **数值全面优化**：
  - 精神力消耗降低：探索中 0~3/轮 → 0~1/轮
  - 安全阶段（init/door/cleared）精神力自然恢复 +1~4/轮
  - 污染值非BOSS阶段自然衰减 -0~1/轮
  - 感官过载累积速度降低
- [x] **系统商城**：12件物品目录（恢复剂/屏蔽器/净化水晶/线索器/屏障增幅/校准器/强化石/安全屋卡/护身符/通讯水晶/镇定针剂/共鸣石）
- [x] **仓库系统**：跨世界持久存储，支持购买→入库→取出使用/立即使用的完整流程
- [x] **clearWorld 增强**：返回结算数据（worldLoot + shopCatalog + warehouse）
- [x] **新增函数**：getShopItems / purchaseItem / withdrawFromWarehouse / useWarehouseItem / depositToWarehouse / applyItemEffect

### Prompt 改动 (system-prompt-sentinel.md)
- [x] **精神力低下具体体现**：脑内刺痛/链接断裂/白鹿虚弱/哨兵失控加速/眩晕耳鸣（5档症状）
- [x] **污染值增高具体体现**：诡异呓语/无意识被控制/幻觉感知扭曲/不存在味道/白鹿异变（5档症状）
- [x] **夏彦主动监控华生状态**：强制规则——每2-3轮感知她的精神力+污染值，低于阈值必须主动干预
- [x] **精神体自主行动**：德牧/渡鸦/白鹿随宿主心意自主行动，不站桩不等命令
- [x] **系统通知人性化嘲讽**：开局"祝死得愉快"/通关"可惜没有全部死光"/发现死亡"又少了一个"/线索发现"比预计慢了四轮"
- [x] **队友循环复用**：随机新老队友混合出现，建立队友池，老队友再现时更新近况，禁止无限增加新角色
- [x] **副本结算完整流程**：积分结算→物品分类→商城开启→购物入库→安全屋休息
- [x] **商城+仓库系统完整说明**：12件物品表格+仓库机制

## 2026-08-07 凌晨 向哨+亲密空间大修

### 向哨游戏
- [x] DeepSeek V4Pro 挂掉 → gpt-5.5（不稳定，卡死无响应）→ 最终稳定在 **gpt-5.4**（玖时）
- [x] 数值同步修复：`updateStateFromReply` 把 `statChanges` 纳入解析范围
- [x] 数值覆盖修复：`applyStatDrift` 随机漂移只在 AI 未提供数值时启用
- [x] 服务端直接计算 `statUpdates` 结构体发给客户端，不再依赖文本解析
- [x] 右边面板 statLog 数据同步修复（依赖从 `turns.length` 改为 statChanges 值）
- [x] 向导精神力恢复方式从 1 种（喝药）扩展到 5 种（自然/身体接触/安全屋/恢复剂/白鹿共鸣）
- [x] 向哨夏彦加「说话像真人」反AI规则 + 犬系行为指南
- [x] **向哨专属动物特征**：夏彦德牧耳尾 + 华生白鹿耳角，失控/亲昵/污染/亲密时浮现，可自主收回
- [x] 全年龄 prompt 同步所有改动

### 亲密空间
- [x] 被夸 vs 被说爱反应分家：得意小狗 vs 害羞高兴，各有多变体
- [x] 被亲后 6 种反应随机切换，禁止每次"这边也要"
- [x] 被摸头摸脸 → 黏糊小狗（眯眼蹭手心/下巴搁掌心），只对她
- [x] 被爱时得意哼哼，像被顺了毛的大狗
- [x] 全性格犬系萌化：撒娇/黏人/日常动作全面狗狗化 + 萌系行为清单
- [x] 去「咬嘴唇笑」+ 去「耷拉耳朵」（是德牧的动作不是夏彦的）

### APK（今天 5 次构建）
- [x] 新增【系统】通知块渲染（金色边框）
- [x] 新增【数值变化】块渲染（蓝色边框）
- [x] 横屏沉浸模式（隐藏状态栏+导航栏）
- [x] statUpdates 结构化接收
- [x] 闪退修复：useEffect 移到 early return 之前
- [x] minSdk 24→26（health-connect 库要求）
- [x] SDK 路径反斜杠修复

### 待办
- [ ] 结构化输出（参考 DS：背景/NPC/线索/氛围分节）
- [ ] 夏彦气泡长按复制
- [ ] 论坛定时拉取新帖
- [ ] 回合计数器

## 2026-08-05 横屏布局改造

### App 端
- [x] SentinelGameScreen 横屏三栏：flex 1:5:1（左14%系统面板+中71%故事+右14%数据看板）
- [x] 左栏完整系统面板：游戏概况+华生/夏彦属性+失控值常驻+BOSS欢愉值+背包+装备
- [x] 右栏实时数据看板：live指示器+delta数值+迷你进度条
- [x] 标签缩短(精神/污染/同步/感官)，进度条压缩
- [x] 进游戏自动锁横屏（expo-screen-orientation）
- [x] overflow:hidden 防窄栏白屏
- [x] 论坛分页装饰已删，评论数1-5条多样化

### 服务端
- [x] 8个世界主题补全 accentDim 属性，适配横屏三栏布局
- [ ] **待Push+Sealos更新**

## 已完成

### 服务端
- [x] 空回修复：交替角色 + 字段名对齐 + parseReply
- [x] 磁盘扩容 + docker.io 前缀解决镜像拉取卡死
- [x] 随机世界主题（8套）+ 无条件自动分配
- [x] 论坛 AI 自动生成帖子（2h冷却，50篇上限）
- [x] 风格铁则6条 + 旁白人称呼 + AI选项生成
- [x] 主动引导（不每轮问意见）

### App 端
- [x] 空回修复 + 开场不消失 + 自动滚底
- [x] 动态世界主题 UI + 状态面板进度条
- [x] 夏彦对话动作/说话分离渲染
- [x] 论坛「夜话坛」完整功能（列表/详情/评论/点赞收藏/个人主页）
- [x] 选项按钮渲染
- [x] NXX 删除
- [x] 旁白长按复制

## 待办

- [ ] **APK构建待修**：expo prebuild --clean删了local.properties(SDK路径)，prebuild产物时间戳骗过Gradle导致28 tasks up-to-date但输出目录为空。修复：删prebuild产物+touch源文件，或重建android目录
- [ ] 结构化输出（参考 DS：背景/NPC/线索/氛围分节）
- [ ] 夏彦气泡长按复制
- [ ] 论坛定时拉取新帖
- [ ] 回合计数器

## 2026-08-06 横屏+选项+AI切换完成
- [x] 横屏flex 1:5:1 + 标签缩短 + overflow防白屏
- [x] 选项生成修复：`【选项】`写入输出格式模板（教训：格式模板>规则列表）
- [x] DeepSeek切玖时 `[正向]DeepSeek-V4Pro` + 失败重试
- [x] NPC对话归旁白(铁则#7)
- [x] 论坛分页装饰删+评论1-5条多样化
- [x] 改动追踪系统(23条记录+自动hook)
- [x] GameState补sentinelFrenzy/frenzyMode + narrative→turns+choices解析

## 重要教训
- Sealos docker.io 前缀解决拉镜像卡死
- sed 清理代码注意别删变量
- 旧 APK 安装后看不出问题，需确认构建成功
- 多个相同逻辑检查会冲突，只留一份
