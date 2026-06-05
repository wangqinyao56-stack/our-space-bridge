// Quick test: connect to WebSocket and check diary data
import WebSocket from "ws";

const WS_URL = "wss://siwmhifsvdnu.sealoshzh.site";

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("[test] Connected, requesting diary list...");
  ws.send(JSON.stringify({ type: "diary_get_list" }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("[test] Received:", msg.type);
  if (msg.type === "diary_list") {
    console.log("[test] Diary dates:", msg.dates);
  }
  if (msg.type === "diary_data") {
    console.log("[test] Diary data:", JSON.stringify(msg.diary).slice(0, 500));
  }
  // Also check if we can write a test diary
  if (msg.type === "diary_list" && msg.dates) {
    const today = new Date().toISOString().slice(0, 10);
    console.log(`[test] Writing test diary for ${today}...`);
    ws.send(JSON.stringify({
      type: "diary_write",
      date: today,
      title: "test",
      content: "这是一个测试日记条目，夏彦应该回复这条。"
    }));
  }
});

ws.on("error", (e) => console.error("[test] Error:", e.message));

setTimeout(() => {
  console.log("[test] Timeout, closing...");
  ws.close();
  process.exit(0);
}, 15000);
