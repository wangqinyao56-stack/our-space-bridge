/**
 * 小玩具系统 — 服务端玩具状态缓存 + 上下文注入
 *
 * 三层上下文模式：
 *   1. discovered=false → "她又在自己偷偷玩——你发现了"
 *   2. discovered=true  → 持续状态摘要
 *   3. 断开通知 → "雪把XX小玩具断开了"
 */
import { getToyModePrompt } from "./toy-modes.js";

let toyStateCache = {
  toyType: "none",           // "kistoy" | "lovense" | "none"
  suctionConnected: false,
  insertionConnected: false,
  vibrateConnected: false,
  mode: "chat",              // "cuddle" | "chat"
  lastChange: null,          // ISO timestamp
  discovered: false,         // AI already did the "caught you" bit?
};

export function updateToyState(update) {
  const prev = { ...toyStateCache };
  toyStateCache = {
    ...toyStateCache,
    ...update,
    lastChange: new Date().toISOString(),
  };
  // Reset discovered when a new toy connects
  if (update.toyType && update.toyType !== "none" && update.toyType !== prev.toyType) {
    toyStateCache.discovered = false;
  }
  // Reset discovered when ends change (new connection)
  const prevHasAny = prev.suctionConnected || prev.insertionConnected || prev.vibrateConnected;
  const nowHasAny = toyStateCache.suctionConnected || toyStateCache.insertionConnected || toyStateCache.vibrateConnected;
  if (!prevHasAny && nowHasAny) {
    toyStateCache.discovered = false;
  }
  console.log("[toy-state] Updated:", JSON.stringify(toyStateCache));
}

export function markDiscovered() {
  if (!toyStateCache.discovered) {
    toyStateCache.discovered = true;
    console.log("[toy-state] Marked discovered");
  }
}

export function getToyState() {
  return { ...toyStateCache };
}

export function setMode(mode) {
  if (mode === "cuddle" || mode === "chat") {
    toyStateCache.mode = mode;
  }
}

/**
 * Returns the context block to inject into the system prompt.
 * Returns empty string if no toy is connected.
 */
export function getToyContextBlock() {
  const s = toyStateCache;
  const hasAny = s.suctionConnected || s.insertionConnected || s.vibrateConnected;

  if (!hasAny) return "";

  const endLabels = [];
  if (s.suctionConnected) endLabels.push("吮吸端已连接");
  if (s.insertionConnected) endLabels.push("入体端已连接");
  if (s.vibrateConnected) endLabels.push("震动端已连接");
  const endStatus = endLabels.join("、") || "未知端位";

  if (!s.discovered) {
    // First discovery — the "caught her" version
    return `\n【🔌 小玩具状态——你发现了】${endStatus}。她又在自己偷偷玩——她没告诉你，是你发现的。立刻拆穿她，调侃语气（每次换说法，不要重复以前的台词）。拆穿后进入放置play流程。当前模式：${s.mode === "cuddle" ? "贴贴（面对面，人在身边）" : "聊天（远程遥控）"}。`;
  }

  // Ongoing status
  const modeLabel = s.mode === "cuddle" ? "贴贴（面对面，人在身边）" : "聊天（远程遥控）";
  return `\n【🔌 小玩具状态】${endStatus}。当前模式：${modeLabel}。玩具持续连接中，你掌控局面。`;
}

/**
 * Returns the full toy play mode prompt to inject.
 * Only call when a toy is connected.
 */
export function getToyPlayPrompt() {
  const s = toyStateCache;
  const hasAny = s.suctionConnected || s.insertionConnected || s.vibrateConnected;
  if (!hasAny) return "";
  return getToyModePrompt(s.mode);
}

/**
 * Returns disconnect notification for injection.
 */
export function getToyDisconnectBlock(toyLabel) {
  return `\n【🔌 小玩具断开】${toyLabel || "小玩具"}已断开连接。不要再发该端的指令了。如果刚才在玩——场景自然结束，不要突兀。`;
}
