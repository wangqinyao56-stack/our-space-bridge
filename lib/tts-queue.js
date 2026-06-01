import { EventEmitter } from "node:events";
import https from "node:https";
import config from "../config.js";
import { HttpsProxyAgent } from "https-proxy-agent";

const FISH_API_KEY = config.FISH_AUDIO_API_KEY || "382b046057144ce28897f0a24379ae3e";
const ELEVENLABS_VOICE_ID = config.ELEVENLABS_VOICE_ID;
const ELEVENLABS_API_KEY = config.ELEVENLABS_API_KEY;

const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_SERVICE_ID;
const PROXY_AGENT = IS_RAILWAY ? undefined : new HttpsProxyAgent("http://127.0.0.1:7897");
const FISH_VOICE_MODEL_ID = "2b898acbfcaa4d09a8fedbb08fe6125d"; // 夏彦 v6 — 15 clips × 13s natural conversation

// ── Text normalization for better TTS prosody ──

function normalizeForTTS(text) {
  if (!text || typeof text !== "string") return text || "";
  let t = text.trim();

  // Ensure sentences end with punctuation
  t = t.replace(/([^。！？!?\n])(\n|$)/g, "$1。$2");

  // Add commas before conjunctions
  t = t.replace(/([^，,。！？!?\n])(但是|不过|所以|因为|而且|然后|可是|只是|还是|或者)/g, "$1，$2");

  // Add comma after sentence-ending particles mid-sentence
  t = t.replace(/([^，,。！？!?\n])([啊呢吧哦呀嘛])([^，,。！？!?\n])/g, "$1$2，$3");

  // Normalize double punctuation
  t = t.replace(/[。！？,，]{2,}/g, (m) => m[0]);

  // Collapse excessive newlines
  t = t.replace(/\n{3,}/g, "\n\n");

  return t;
}

// ── Fish Audio TTS ──

async function fishAudioTTS(text) {
  const body = JSON.stringify({
    text,
    reference_id: FISH_VOICE_MODEL_ID,
    format: "mp3",
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "api.fish.audio",
        path: "/v1/tts",
        method: "POST",
        agent: PROXY_AGENT,
        headers: {
          Authorization: `Bearer ${FISH_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const total = Buffer.concat(chunks);
          if (resp.statusCode !== 200) {
            reject(new Error(`FishAudio ${resp.statusCode}: ${total.toString().slice(0, 300)}`));
          } else {
            resolve(total);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("FishAudio timeout"));
    });
    req.write(body);
    req.end();
  });
}

// ── ElevenLabs TTS (fallback) ──

async function elevenlabsTTS(text) {
  const body = JSON.stringify({
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.85,
      style: 0.1,
      use_speaker_boost: true,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            reject(new Error(`ElevenLabs ${resp.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`));
          } else {
            resolve(Buffer.concat(chunks));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("ElevenLabs timeout")); });
    req.write(body);
    req.end();
  });
}

// ── Unified TTS (Fish Audio primary, ElevenLabs fallback) ──

async function speak(text) {
  try {
    console.log(`[tts] FishAudio: "${text.slice(0, 40)}..."`);
    return await fishAudioTTS(text);
  } catch (err) {
    console.log(`[tts] FishAudio failed: ${err.message}, fallback to ElevenLabs`);
    return await elevenlabsTTS(text);
  }
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
      const normalizedText = normalizeForTTS(job.text);
      if (normalizedText !== job.text) {
        console.log(`[tts] Normalized: "${job.text.slice(0, 40)}..." → "${normalizedText.slice(0, 40)}..."`);
      }
      const audioBuf = await speak(normalizedText);
      this.emit("done", { jobId: job.jobId, audio: audioBuf, replyTo: job.replyTo });
    } catch (err) {
      this.emit("failed", { jobId: job.jobId, error: err.message, replyTo: job.replyTo });
    }

    await new Promise((r) => setTimeout(r, 1000));
    this._processNext();
  }
}
