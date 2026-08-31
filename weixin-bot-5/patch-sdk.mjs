// Docker 构建时给 weixin-agent-sdk 打补丁：
// sendMessage 加微信业务返回码检查 + 发送失败重试（通道不稳定时自动重发）
// 为什么：SDK 的 sendMessage 只查 HTTP 状态码，不查微信业务码(ret/errcode)，
// 微信回 200 但业务失败时会静默丢消息；且发送失败不重试，抖一下就丢。
import fs from "node:fs";

const FILE = "node_modules/weixin-agent-sdk/dist/index.mjs";

const OLD = `async function sendMessage(params) {
\tawait apiFetch({
\t\tbaseUrl: params.baseUrl,
\t\tendpoint: "ilink/bot/sendmessage",
\t\tbody: JSON.stringify({
\t\t\t...params.body,
\t\t\tbase_info: buildBaseInfo()
\t\t}),
\t\ttoken: params.token,
\t\ttimeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
\t\tlabel: "sendMessage"
\t});
}`;

const NEW = `async function sendMessage(params) {
\tconst body = JSON.stringify({
\t\t...params.body,
\t\tbase_info: buildBaseInfo()
\t});
\tlet lastErr;
\tfor (let attempt = 0; attempt < 3; attempt++) {
\t\ttry {
\t\t\tconst raw = await apiFetch({
\t\t\t\tbaseUrl: params.baseUrl,
\t\t\t\tendpoint: "ilink/bot/sendmessage",
\t\t\t\tbody,
\t\t\t\ttoken: params.token,
\t\t\t\ttimeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
\t\t\t\tlabel: "sendMessage"
\t\t\t});
\t\t\tlet ret, errcode;
\t\t\ttry { const p = JSON.parse(raw); ret = p.ret; errcode = p.errcode; } catch {}
\t\t\tif ((ret !== void 0 && ret !== 0) || (errcode !== void 0 && errcode !== 0)) {
\t\t\t\tthrow new Error("sendMessage business error ret=" + ret + " errcode=" + errcode);
\t\t\t}
\t\t\treturn;
\t\t} catch (err) {
\t\t\tlastErr = err;
\t\t\tif (attempt < 2) {
\t\t\t\tlogger.warn("sendMessage attempt " + (attempt + 1) + " failed, retrying: " + String(err).slice(0, 120));
\t\t\t\tawait new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
\t\t\t}
\t\t}
\t}
\tthrow lastErr;
}`;

const src = fs.readFileSync(FILE, "utf-8");
if (!src.includes(OLD)) {
  console.error("[patch-sdk] WARN: sendMessage 原文不匹配（SDK 可能升级了），未打补丁，构建继续");
  process.exit(0);
}
fs.writeFileSync(FILE, src.replace(OLD, NEW), "utf-8");
console.log("[patch-sdk] OK: sendMessage 已加返回码检查 + 3 次重试");
