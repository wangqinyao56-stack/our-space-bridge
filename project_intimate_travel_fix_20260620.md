---
name: project_intimate_travel_fix_20260620
description: 亲密空间旅行记忆隔离+旅行时间线精确化+群聊频率优化，2026-06-20
metadata:
  type: project
---

# 2026-06-20 亲密空间 & 旅行系统优化

## 修改的文件
- `lib/intimate-memory.js`
- `lib/message-router.js`
- `lib/scenery.js`
- `server.js`
- `system-prompt-travel.md`
- `src/services/config.ts` (App)
- `src/components/RemoteToyPanel.tsx` (App)

## 修复内容

### 1. 亲密空间旅行记忆隔离
**问题**：出差期间电话亲密记录和日常亲密空间记录混在一起。旅行结束后进亲密空间，AI 接着电话话题往下聊。
**修复**：
- `getIntimateHistory(travelFilter)` 按旅行状态过滤：旅行中只取 travel=true，在家只取 travel≠true
- 旧消息（无 travel 字段）归入非旅行类，不会被误过滤
- 日常聊天注入亲密空间时增加硬性规则：禁止主动提旅行/出差话题，除非华生先开口

### 2. 亲密记忆上限扩容+平衡裁剪
**问题**：上限 40 条，出差电话亲密占满后挤掉全部日常亲密记录，导致历史丢失。
**修复**：
- MAX 从 40 扩至 100
- save() 新增平衡裁剪：旅行和非旅行各保留最多 100 条，再按时间排序，不会互相挤

### 3. 旅行时间线精确化
**问题**：AI 不知道具体天数，每天说"还要两三天"，突然就到家，回家也没有通知。
**修复**：
- `travelState` 新增 `durationDays` 和 `departedWithoutAnnounce` 字段
- TRAVELING 阶段注入精确时间线（共X天、剩余X天、预计到家时间）
- 未打招呼就出门时 AI 会主动道歉解释
- RETURNING 阶段的回家通知**不再因用户活跃而跳过**（之前 `userActiveRecently` 会跳过回家通知）
- `system-prompt-travel.md` 增加硬性规则：天数必须递减，回来必须通知

### 4. 遥控震动面板遮挡
**问题**：RemoteToyPanel position:absolute top:0 覆盖了亲密空间顶部返回按钮。
**修复**：新增关闭按钮（×），点击缩成右上角小圆点，再点展开。

### 5. NXX群聊频率
**问题**：每 3-6 小时触发一次，一天 4-8 次太频繁。
**修复**：改为 1200-1440 分钟（20-24h，约一天一次）。

### 6. 导出接口扩展
**问题**：`/api/admin/export` 只导出 chat+intimate，没有温存/约会记录。
**修复**：新增 `affection_home` 和 `affection_date` 的导出和导入。

### 7. App 红屏修复
**问题**：`src/services/config.ts` 缺失导致 `couple-travel-store.ts` 找不到 `getHttpUrl`。
**修复**：新建 `src/services/config.ts`，封装 WebSocket URL → HTTP URL 转换。

### 8. 亲密空间字体颜色调亮
**问题**：亲密空间文字颜色太暗（深棕 #2A2218），电话亲密用户对话和动作同色无区分。
**修复**：
- IntimateBubble: 对话文字 #2A2218→#FFF5E8，动作括号 #788CE8→#A0B4FF
- PhoneCallBubble: 用户动作文字新增 textMeAction 样式，半透明白色斜体，与对话区分

### 9. 震动面板位置修正
**问题**：缩小后的震动小圆点（top:50, right:10）挡住右上方菜单按钮。
**修复**：改为 bottom:100, right:10，挪到右下角。

## 关键教训
- 亲密记忆的 travel 字段是布尔值，旧消息可能是 undefined，过滤时用 `m.travel !== true` 而非 `m.travel === false`
- 旅行状态转换（RETURNING）的注入绝不能因用户活跃而跳过
- 不同场景的记忆需要独立上限，否则一种场景会挤掉另一种
