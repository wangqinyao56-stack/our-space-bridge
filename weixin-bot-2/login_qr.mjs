/**
 * 微信扫码登录 — 生成二维码PNG到桌面
 */
import { login } from "weixin-agent-sdk";

console.log("正在生成微信扫码登录二维码...\n");
await login();
console.log("\n请在桌面上找到 weixin-login-qr.png 用微信扫描！");
