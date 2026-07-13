/**
 * Node.js loader — intercepts qrcode-terminal to also save QR as PNG
 * Usage: node --import ./qr-hook.mjs $(which weixin-acp) login
 */
import QRCode from "qrcode";

// This runs before the main module loads
const origGen = (await import("qrcode-terminal")).generate;
const mod = await import("qrcode-terminal");
mod.generate = function (text, opts, cb) {
  console.log("[QR] 正在生成桌面二维码图片...");
  QRCode.toFile("F:/Desktop/weixin-login-qr.png", text, {
    type: "png", width: 400, margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  }).then(() => {
    console.log("[QR] ✅ 二维码图片已保存: F:/Desktop/weixin-login-qr.png");
    console.log("[QR] 请打开图片用微信扫描！");
  }).catch(err => {
    console.error("[QR] 图片生成失败:", err.message);
  });
  return origGen.call(this, text, opts, cb);
};
console.log("[hook] qrcode-terminal patched");
