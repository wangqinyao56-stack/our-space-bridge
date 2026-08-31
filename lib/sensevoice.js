/**
 * 听语气 — SenseVoice 情绪识别客户端
 * 调用 sensevoice 服务（sherpa-onnx），从 PCM16 音频里识别华生的语气。
 * 未配置 SENSEVOICE_URL 或服务不可达时，静默返回 null（不影响语音链路）。
 */

import http from "node:http";
import https from "node:https";
import config from "../config.js";

/** 情绪中文标签（供注入夏彦 prompt 用） */
export function emotionHint(emotion) {
  if (!emotion || !emotion.label) return "";
  return emotion.label;
}

/**
 * PCM16 16000Hz mono 音频 → { text, emotion, events } 或 null。
 * 只在服务返回了非中性情绪时才有价值，调用方自行判断。
 */
export async function detectVoiceEmotion(pcm, { timeoutMs = 10000 } = {}) {
  const url = config.SENSEVOICE_URL || "";
  if (!url) return null;

  const body = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  if (!body.length) return null;

  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve(null);
    }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        host: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: "/recognize",
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Sample-Rate": "16000",
          "Content-Length": body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolve(data && typeof data === "object" ? data : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}
