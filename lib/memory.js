/**
 * In-memory chat history for our-space bridge.
 */

let exchanges = [];
const MAX = 12;

export function recordUserMessage(text) {
  exchanges.push({ role: "user", content: text.slice(0, 2000) });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
}

export function recordBotReply(text) {
  exchanges.push({ role: "assistant", content: text.slice(0, 2000) });
  if (exchanges.length > MAX * 2) exchanges = exchanges.slice(-MAX * 2);
}

export async function getRecentHistory() {
  const lines = [];
  for (const e of exchanges) {
    if (e.role === "user") lines.push(`华生：${e.content}`);
    else lines.push(`夏彦：${e.content}`);
  }
  return lines.join("\n") + "\n";
}

export async function getRecentHistoryMessages() {
  return exchanges.slice(-8);
}

export function clearMemory() {
  exchanges = [];
}
