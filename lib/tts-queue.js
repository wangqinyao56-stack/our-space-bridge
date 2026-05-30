import { EventEmitter } from "node:events";
import https from "node:https";
import config from "../config.js";

const ELEVENLABS_VOICE_ID = config.ELEVENLABS_VOICE_ID;
const ELEVENLABS_API_KEY = config.ELEVENLABS_API_KEY;

async function elevenlabsTTS(text) {
  const body = JSON.stringify({
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.48, similarity_boost: 0.96, style: 0.25, use_speaker_boost: true },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        if (resp.statusCode !== 200) {
          reject(new Error(`ElevenLabs ${resp.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

export class TTSQueue extends EventEmitter {
  constructor(maxDepth = 10) {
    super();
    this.queue = [];
    this.maxDepth = maxDepth;
    this.processing = false;
  }

  enqueue(job) {
    if (this.queue.length >= this.maxDepth) {
      this.emit("rejected", job);
      return false;
    }
    this.queue.push(job);
    this.emit("queued", job);
    if (!this.processing) this._processNext();
    return true;
  }

  get length() {
    return this.queue.length + (this.processing ? 1 : 0);
  }

  async _processNext() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const job = this.queue.shift();

    try {
      const audioBuf = await elevenlabsTTS(job.text);
      this.emit("done", { jobId: job.jobId, audio: audioBuf, replyTo: job.replyTo });
    } catch (err) {
      this.emit("failed", { jobId: job.jobId, error: err.message, replyTo: job.replyTo });
    }

    await new Promise(r => setTimeout(r, 1000));
    this._processNext();
  }
}
