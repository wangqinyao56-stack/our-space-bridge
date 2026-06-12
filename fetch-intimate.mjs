import WebSocket from "ws";

const WS_URL = "wss://siwmhifsvdnu.sealoshzh.site";
const SECRET = "our-space-default-secret-change-me";

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("Connected, authenticating...");
  ws.send(JSON.stringify({ type: "auth", token: SECRET }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "auth_ok") {
    console.log("Auth OK, fetching intimate history...\n");
    ws.send(JSON.stringify({ type: "get_history", channel: "intimate" }));
  } else if (msg.type === "history") {
    console.log(`=== Intimate History (${msg.messages.length} messages) ===\n`);
    msg.messages.forEach((m, i) => {
      const role = m.from === "me" ? "华生" : "夏彦";
      const preview = m.content.slice(0, 80).replace(/\n/g, "\\n");
      console.log(`[${i}] ${role}: ${preview}...`);
    });
    ws.close();
  } else if (msg.type === "auth_error" || msg.type === "error") {
    console.error("Error:", msg.message || JSON.stringify(msg));
    ws.close();
  }
});

ws.on("error", (err) => {
  console.error("WS error:", err.message);
  process.exit(1);
});

ws.on("close", () => process.exit(0));
setTimeout(() => { console.log("Timeout"); process.exit(1); }, 20000);
