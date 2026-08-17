/**
 * 火山流式 ASR（听）
 * wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
 *
 * 协议跟 TTS bidirection 不同：ASR 用「序列号(seq)」协议，没有 StartConnection/StartSession 事件。
 * 所有 payload 都 gzip 压缩。
 *
 * 凭证（环境变量，跟 TTS 共用一套）：
 *   VOLC_APP_ID        — =3076776720
 *   VOLC_ACCESS_TOKEN  — =Y6XmfasZeI...
 *   VOLC_ASR_RESOURCE  — 默认 volc.bigasr.sauc.duration
 *
 * 流程：
 *   1. 连 WebSocket（header X-Api-App-Id + X-Api-Access-Key + X-Api-Resource-Id）
 *   2. 发 init 消息（FullClientRequest + PositiveSeq + gzip(音频配置)）
 *   3. 逐段发音频（AudioOnlyClient + PositiveSeq + gzip(pcm)）
 *   4. 发最后一段（AudioOnlyClient + NegativeSeq + seq取负）
 *   5. 收 FullServerResponse，gzip 解压后取 result.text
 */

import zlib from "node:zlib";
import crypto from "node:crypto";
import WebSocket from "ws";

const uuid = () => crypto.randomUUID();

const MsgType = {
  FullClientRequest: 0b0001,
  AudioOnlyClient: 0b0010,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  FrontEndResultServer: 0b1100,
  Error: 0b1111,
};
const Flags = { NoSeq: 0, PositiveSeq: 1, LastNoSeq: 2, NegativeSeq: 3, WithEvent: 4 };
const Serialization = { JSON: 1 };
const Compression = { None: 0, Gzip: 1 };

const SEQ_TYPES = new Set([
  MsgType.FullClientRequest,
  MsgType.FullServerResponse,
  MsgType.FrontEndResultServer,
  MsgType.AudioOnlyClient,
  MsgType.AudioOnlyServer,
]);

function marshal({ type, flag, sequence = 0, compression = Compression.Gzip, payload = Buffer.alloc(0) }) {
  const parts = [Buffer.from([0x11, (type << 4) | flag, (Serialization.JSON << 4) | compression, 0x00])];
  if ((flag === Flags.PositiveSeq || flag === Flags.NegativeSeq) && SEQ_TYPES.has(type)) {
    const s = Buffer.alloc(4);
    s.writeInt32BE(sequence);
    parts.push(s);
  }
  const plen = Buffer.alloc(4);
  plen.writeUInt32BE(payload.length);
  parts.push(plen, payload);
  return Buffer.concat(parts);
}

function unmarshal(data) {
  const type = data[1] >> 4;
  const flag = data[1] & 0x0f;
  const compression = data[2] & 0x0f;
  const headerSize = (data[0] & 0x0f) * 4;
  let off = headerSize;
  let sequence = 0;
  let errorCode = 0;
  if (type === MsgType.Error) {
    errorCode = data.readUInt32BE(off);
    off += 4;
  } else if ((flag === Flags.PositiveSeq || flag === Flags.NegativeSeq) && SEQ_TYPES.has(type)) {
    sequence = data.readInt32BE(off);
    off += 4;
  }
  let payload = Buffer.alloc(0);
  if (off + 4 <= data.length) {
    const plen = data.readUInt32BE(off);
    off += 4;
    if (plen && off + plen <= data.length) payload = data.slice(off, off + plen);
  }
  if (compression === Compression.Gzip && payload.length) {
    try { payload = zlib.gunzipSync(payload); } catch {}
  }
  return { type, flag, compression, sequence, errorCode, payload };
}

const VOLC = {
  appId: process.env.VOLC_APP_ID || "3076776720",
  token: process.env.VOLC_ACCESS_TOKEN || "Y6XmfasZeI__q0v4dsSz3D3FEuJk3ioS",
  resource: process.env.VOLC_ASR_RESOURCE || "volc.bigasr.sauc.duration",
  host: "openspeech.bytedance.com",
};

export class VolcAsr {
  constructor({ sampleRate = 16000, onResult, onError } = {}) {
    this.sampleRate = sampleRate;
    this.onResult = onResult || (() => {});
    this.onError = onError || ((e) => console.error("[asr]", e.message));
    this.ws = null;
    this.seq = 0;
    this.requestId = uuid();
  }

  connect() {
    const url = `wss://${VOLC.host}/api/v3/sauc/bigmodel`;
    this.ws = new WebSocket(url, {
      headers: {
        "X-Api-App-Id": VOLC.appId,
        "X-Api-App-Key": VOLC.appId,
        "X-Api-Access-Key": VOLC.token,
        "X-Api-Resource-Id": VOLC.resource,
        "X-Api-Request-Id": this.requestId,
        "X-Api-Connect-Id": uuid(),
      },
      maxPayload: 16 * 1024 * 1024,
    });

    this.ws.on("message", (data) => {
      try {
        const msg = unmarshal(Buffer.from(data));
        if (msg.type === MsgType.FullServerResponse) {
          const payload = msg.payload.toString("utf8");
          let json = {};
          try { json = JSON.parse(payload); } catch {}
          const result = json.result || {};
          const text = result.text || "";
          const isFinal = !!result.is_final || msg.flag === Flags.LastNoSeq;
          if (text) this.onResult(text, isFinal);
          if (isFinal) this.close();
        }
      } catch (e) {
        this.onError(e);
      }
    });
    this.ws.on("error", (e) => this.onError(e));

    return new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        // 发 init 消息：音频配置
        const initPayload = {
          user: { uid: this.requestId },
          audio: { format: "pcm", codec: "raw", rate: this.sampleRate, bits: 16, channel: 1 },
          request: {
            model_name: "bigmodel",
            enable_itn: true,
            enable_punc: true,
            enable_ddc: true,
            show_utterances: true,
            enable_nonstream: false,
          },
        };
        this.seq = 1;
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(initPayload)));
        this.ws.send(marshal({
          type: MsgType.FullClientRequest,
          flag: Flags.PositiveSeq,
          sequence: this.seq,
          compression: Compression.Gzip,
          payload: gz,
        }));
        this.seq += 1;
        resolve();
      });
      this.ws.once("error", reject);
    });
  }

  // 发送一段 PCM16 音频
  sendAudio(pcm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const gz = zlib.gzipSync(Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm));
    this.ws.send(marshal({
      type: MsgType.AudioOnlyClient,
      flag: Flags.PositiveSeq,
      sequence: this.seq,
      compression: Compression.Gzip,
      payload: gz,
    }));
    this.seq += 1;
  }

  // 结束输入（发送 NegativeSeq 结束标记）
  finish() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(marshal({
      type: MsgType.AudioOnlyClient,
      flag: Flags.NegativeSeq,
      sequence: -this.seq,
      compression: Compression.Gzip,
      payload: zlib.gzipSync(Buffer.alloc(0)),
    }));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// 便捷函数：一段 PCM16 音频 → 完整文本（内部处理连接/分块/结束/等待）
export async function asrTranscribe(pcm, { sampleRate = 16000, chunkMs = 200, timeoutMs = 20000 } = {}) {
  const pcmBuf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  let lastText = "";

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => (val) => { if (!settled) { settled = true; fn(val); } };

    const asr = new VolcAsr({
      sampleRate,
      onResult: (text, isFinal) => {
        lastText = text;
        if (isFinal) { asr.close(); done(resolve)(text); }
      },
      onError: (e) => done(reject)(e),
    });

    asr.connect()
      .then(() => {
        const chunkBytes = Math.max(1, Math.floor(sampleRate * 2 * chunkMs / 1000));
        for (let off = 0; off < pcmBuf.length; off += chunkBytes) {
          asr.sendAudio(pcmBuf.slice(off, off + chunkBytes));
        }
        asr.finish();
        setTimeout(() => { asr.close(); done(resolve)(lastText); }, timeoutMs);
      })
      .catch((e) => done(reject)(e));
  });
}
