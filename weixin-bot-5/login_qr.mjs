import { login } from "weixin-agent-sdk";
import QRCode from "qrcode";

// Patch qrcode-terminal BEFORE SDK's dynamic import gets it
const qt = await import("qrcode-terminal");
const orig = qt.default.generate;
qt.default.generate = function (text, opts, cb) {
  QRCode.toFile("F:/Desktop/weixin-login-qr.png", text, {
    type: "png", width: 400, margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  }).then(() => console.log("[QR] ✅ 已保存到桌面: weixin-login-qr.png"))
    .catch(err => console.error("[QR] 保存失败:", err.message));
  return orig.call(this, text, opts, cb);
};

console.log("正在生成微信登录二维码...\n");
await login();
