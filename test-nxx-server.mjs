import WebSocket from "ws";

const ws = new WebSocket("wss://siwmhifsvdnu.sealoshzh.site");

ws.on("open", () => {
  console.log("Connected");
  ws.send(JSON.stringify({ type: "auth", token: "our-space-default-secret-change-me" }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "auth_ok") {
    console.log("Auth OK - testing nxx_send...");
    ws.send(JSON.stringify({ type: "nxx_send", content: "测试消息" }));
  } else if (msg.type === "nxx_message") {
    console.log("GOT nxx_message:", msg);
  } else if (msg.type === "nxx_messages") {
    console.log("GOT nxx_messages:", msg.messages.length, "replies");
    ws.close();
  } else if (msg.type === "error") {
    console.log("ERROR:", msg.message);
    ws.close();
  } else {
    console.log("OTHER:", msg.type);
  }
});

ws.on("error", (e) => { console.error("WS error:", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 20000);
