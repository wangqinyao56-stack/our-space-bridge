/**
 * 实时语音链路（Realtime Voice）
 * 火山 ASR（听）→ askJiushi（夏彦人设）→ 火山 TTS（大模型复刻音色，说）
 *
 * 凭证（环境变量）：
 *   VOLC_APP_ID        — 火山语音技术 App ID（=3076776720）
 *   VOLC_ACCESS_TOKEN  — Access Token（=Y6XmfasZeI...）
 *   VOLC_SPEAKER_ID    — 大模型复刻音色 ID（=S_7D9LSyic2，豆包声音复刻模型2.0）
 *   VOLC_RESOURCE      — 合成资源，复刻音色用 seed-icl-2.0（默认已设）
 *   VOLC_LOUDNESS      — 音量 [-50,100]，默认 40
 *   VOLC_SPEED         — 语速 [-50,100]，默认 0
 *   VOLC_PITCH         — 音调 [-12,12]，默认 8（甜度）
 *
 * ✅ 已验证：大模型音色合成走 HTTP SSE（POST /api/v3/tts/unidirectional/sse）。
 *    header 用 X-Api-App-Id + X-Api-Access-Key + X-Api-Resource-Id。
 *    （注意：训练 voice_clone 用 X-Api-App-Key，合成用 X-Api-App-Id，两者不同！）
 *    响应是 SSE，`data:` 行里 `data` 字段是 base64 音频片段。
 */

import https from "node:https";
import crypto from "node:crypto";
import WebSocket from "ws";
import { askJiushi } from "./ai.js";
import { asrTranscribe } from "./realtime-asr.js";

const uuid = () => crypto.randomUUID();

const VOLC = {
  appId: process.env.VOLC_APP_ID || "3076776720",
  token: process.env.VOLC_ACCESS_TOKEN || "Y6XmfasZeI__q0v4dsSz3D3FEuJk3ioS",
  speakerId: process.env.VOLC_SPEAKER_ID || "S_7D9LSyic2",
  resource: process.env.VOLC_RESOURCE || "seed-icl-2.0",
  loudness: parseInt(process.env.VOLC_LOUDNESS || "40", 10),
  speed: parseInt(process.env.VOLC_SPEED || "0", 10),
  pitch: parseInt(process.env.VOLC_PITCH || "8", 10),
  host: "openspeech.bytedance.com",
};

const hasCreds = () => !!VOLC.token;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 情绪→音调/语速/音量微调：让语音不只是一条平线。
// 返回相对 base 的 delta，调用方叠加到 VOLC.pitch/speed/loudness。
function emotionParams(text) {
  const t = text || "";
  let pitch = 0, speed = 0, loudness = 0;

  // 兴奋/开心：更亮更快
  if (/[！!]{2,}|哈哈|太好|开心|喜欢|好耶|太棒|爱死|兴奋|激动|耶|棒呆/.test(t)) {
    pitch += 4; speed += 8;
  }
  // 疑问/追问：句尾略上扬
  else if (/[？?]|吗$|呢$|什么|怎么|为什么|几点|在哪/.test(t)) {
    pitch += 2;
  }
  // 难过/疲惫/安抚：更低更慢更轻
  else if (/难过|想哭|对不起|担心|害怕|委屈|累|困|抱抱|别走|难受|哭|疼|想我/.test(t)) {
    pitch -= 3; speed -= 6; loudness -= 6;
  }
  // 撒娇/软语：略软略慢
  else if (/[～~]|啦|嘛|呀|喔|乖|宝宝|老婆|亲|想你/.test(t)) {
    pitch += 1; speed -= 4;
  }

  return { pitch, speed, loudness };
}

// ─────────────────────────────────────────────
// 非流式 TTS（已验证可用，大模型复刻音色）
// 输入文本 → 返回 base64 mp3 字符串
// overrideParams 可选 { pitch, speed, loudness }，覆盖情绪自动调节
// ─────────────────────────────────────────────
export async function synthesize(text, overrideParams = null) {
  if (!hasCreds()) {
    throw new Error("缺少 VOLC_ACCESS_TOKEN，无法合成语音");
  }

  const emo = emotionParams(text);
  const pitch = clamp(overrideParams?.pitch ?? VOLC.pitch + emo.pitch, -12, 12);
  const speed = clamp(overrideParams?.speed ?? VOLC.speed + emo.speed, -50, 100);
  const loudness = clamp(overrideParams?.loudness ?? VOLC.loudness + emo.loudness, -50, 100);

  const body = JSON.stringify({
    user: { uid: "huasheng" },
    req_params: {
      text,
      speaker: VOLC.speakerId,
      audio_params: {
        format: "mp3",
        loudness_rate: loudness,
        speech_rate: speed,
      },
      post_process: { pitch },
    },
  });

  const raw = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: VOLC.host,
        path: "/api/v3/tts/unidirectional/sse",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Api-App-Id": VOLC.appId,
          "X-Api-Access-Key": VOLC.token,
          "X-Api-Resource-Id": VOLC.resource,
          "X-Api-Request-Id": uuid(),
        },
        timeout: 60000,
      },
      (res) => {
        let buf = [];
        res.on("data", (c) => buf.push(c));
        res.on("end", () => resolve(Buffer.concat(buf).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TTS 超时"));
    });
    req.write(body);
    req.end();
  });

  const chunks = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let d;
    try {
      d = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (d.code && d.code !== 0 && d.code !== 20000000) {
      throw new Error(`TTS 失败 code=${d.code}: ${d.message}`);
    }
    if (d.data) {
      chunks.push(Buffer.from(d.data, "base64"));
    }
  }

  if (!chunks.length) {
    throw new Error("TTS 未返回音频数据");
  }
  return Buffer.concat(chunks).toString("base64");
}

// 合成并返回 Buffer（方便直接写文件/发音频）
export async function synthesizeBuffer(text) {
  const chunks = splitForTTS(text);
  if (chunks.length === 1) {
    const b64 = await synthesize(chunks[0]);
    return Buffer.from(b64, "base64");
  }
  // 长文本分段合成：并行请求，避免串行多次 HTTP 往返拖慢语音加载
  const buffers = await Promise.all(
    chunks.map(async (chunk) => {
      const b64 = await synthesize(chunk);
      return Buffer.from(b64, "base64");
    })
  );
  return Buffer.concat(buffers);
}

// 按句子/逗号边界切分长文本，避免单次合成超过火山 TTS 上限被截断
function splitForTTS(text, maxLen = 100) {
  if (!text || text.length <= maxLen) return [text];
  const parts = text
    .split(/(?<=[。！？!?\n])/)
    .flatMap((s) => s.length > maxLen ? s.split(/(?<=[，,；;])/) : [s])
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text];
  const chunks = [];
  let cur = "";
  for (const p of parts) {
    if (cur && (cur + p).length > maxLen) {
      chunks.push(cur);
      cur = p;
    } else {
      cur += p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length > 1 ? chunks : [text];
}

// ─────────────────────────────────────────────
// 流式 TTS（骨架，TODO：改用 seed-icl-2.0 后待验证）
// ─────────────────────────────────────────────
export class VolcTts {
  constructor({ onAudio, onDone, onError } = {}) {
    this.onAudio = onAudio || (() => {});
    this.onDone = onDone || (() => {});
    this.onError = onError || ((e) => console.error("[tts]", e.message));
    this.ws = null;
  }

  connect() {
    if (!hasCreds()) {
      throw new Error("缺少 VOLC_ACCESS_TOKEN，无法启动 TTS");
    }
    const url = `wss://${VOLC.host}/api/v3/tts/bidirection`;
    this.ws = new WebSocket(url, {
      headers: {
        "X-Api-Key": process.env.VOLC_API_KEY || "",
        "X-Api-Resource-Id": VOLC.resource,
        "X-Api-Connect-Id": uuid(),
      },
    });
    this.ws.on("message", (data) => {
      if (Buffer.isBuffer(data)) this.onAudio(data);
      else {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.is_last || msg.type === "end") this.onDone();
        } catch {}
      }
    });
    this.ws.on("error", (e) => this.onError(e));
    this.ws.on("close", () => this.onDone());
    return new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }

  speak(text) {
    const req = {
      app: { appid: VOLC.appId, token: VOLC.token, cluster: VOLC.resource },
      user: { uid: "huasheng" },
      audio: { voice_type: VOLC.speakerId, encoding: "mp3" },
      request: { reqid: uuid(), text, operation: "query" },
    };
    this.ws.send(JSON.stringify(req));
  }
}

// ─────────────────────────────────────────────
// 一轮实时通话编排（骨架）
//  audioChunks → ASR → 文字 → askJiushi → 回复文字 → TTS → 音频
// ─────────────────────────────────────────────
export async function realtimeTurn({
  systemPrompt,
  history = [],
  userText,             // ASR 结果（暂时由调用方提供，ASR 端点待接）
  onReplyText = () => {},
  onAudioBase64 = () => {},
}) {
  if (!userText) throw new Error("缺少 userText（ASR 尚未接入）");

  console.log(`[realtime] 用户说: "${userText}"`);

  const reply = await askJiushi({ systemPrompt, userContent: userText, history, maxTokens: 400 });
  onReplyText(reply);
  console.log(`[realtime] 夏彦回: "${reply.slice(0, 40)}..."`);

  const audioBase64 = await synthesize(reply);
  onAudioBase64(audioBase64);

  return { userText, reply, audioBase64 };
}

// ─────────────────────────────────────────────
// 完整实时通话：音频(PCM) → ASR → askJiushi → TTS → 音频
//   audioPcm 是已重采样到 16000Hz 的 PCM16 mono Buffer
// ─────────────────────────────────────────────
export async function realtimeCall({
  systemPrompt,
  history = [],
  audioPcm,
  onRecognized = () => {},
  onReplyText = () => {},
  onAudioBase64 = () => {},
}) {
  if (!audioPcm) throw new Error("缺少 audioPcm（PCM16 16000Hz 音频）");

  console.log("[realtime] 开始 ASR 识别...");
  const recognized = await asrTranscribe(audioPcm);
  onRecognized(recognized);
  console.log(`[realtime] 用户说: "${recognized}"`);

  const reply = await askJiushi({ systemPrompt, userContent: recognized, history, maxTokens: 400 });
  onReplyText(reply);
  console.log(`[realtime] 夏彦回: "${reply.slice(0, 40)}..."`);

  const audioBase64 = await synthesize(reply);
  onAudioBase64(audioBase64);

  return { recognized, reply, audioBase64 };
}
