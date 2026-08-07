---
name: project-toy-system-progress
description: 小玩具系统 App 集成开发进度，2026-07-22
metadata:
  type: project
---

# 小玩具系统 — 开发进度

**开始日期**: 2026-07-21
**当前状态**: Phase 1 完成 ✅ | Phase 2 KISSTOY BLE 进行中

## 已完成

### Phase 1 — App 集成 (已完成)
- HomeScreen 入口图标 ✅
- ToyControlScreen 专用遥控页面（双端指示灯+手动控制+聊天区）✅
- toyManager 统一抽象层（Kistoy BLE > Lovense HTTP > 手机震动）✅
- toyStore (Zustand) + useToyDiscovery + useRemoteToy ✅
- App.tsx 路由 + WS 双向通信 ✅

### Phase 2 — KISSTOY BLE (进行中)
- ✅ react-native-ble-plx 3.5.1 已安装
- ✅ BLE 扫描可发现设备
- ✅ 连接成功（跳过服务发现后连接稳定）
- ✅ 写入正常（多个 characteristic × 多种协议格式均尝试）
- ❌ **玩具不响应命令 — 协议格式未破解**

## 已尝试的协议格式
全部写入成功但玩具不震。已尝试：
- Raw bytes: 1/2/3 字节组合（motor+intensity+pattern）
- ASCII hex 字符串（如 "016400"）
- Lovense 文本协议（"Vibrate:10;Air:10;"）
- AT 命令（"AT+VIB=50\r\n" 等）
- 多种前缀格式（0xAA + checksum, 0xFF, 0x55）
- V:/M: 简洁文本格式
- 空字节唤醒

写入渠道：10+ 组候选 UUID（1000/1001, 1000/1002, 1000/1003, UART/TX, UART/RX, FFF0/FFF1, FFF0/FFF2, 1800/2A00）
写入模式：Write-With-Response + Write-Without-Response 均尝试

## 下一步：nRF Connect 反推协议
需要用 nRF Connect 手动连 bobo → 找到 service 0x1000/char 0x1001 → 手写数据 → 看玩具是否响应。
一旦找到能震的格式，立即实装。

## 关键文件
- `src/services/kistoy.ts` — BLE 连接+命令（当前版本 v7，连接稳定，多格式轰炸）
- `src/services/toy-manager.ts` — 统一抽象层
- `src/screens/ToyControlScreen.tsx` — 遥控页面
- `src/hooks/useRemoteToy.ts` — toyManager hook
- `App.tsx` / `src/screens/HomeScreen.tsx` — 路由+入口
- ~~`node_modules/react-native-ble-manager/`~~ → 改为 `react-native-ble-plx`
