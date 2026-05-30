// Re-clone 夏彦 voice on ElevenLabs with ALL reference audio files
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import config from "./config.js";

const API_KEY = config.ELEVENLABS_API_KEY;
const REF_DIR = "F:/Claude-memory/voice-clone/ref_audio";
const OLD_VOICE_ID = "Mxl4qhZZXKf0Ks8rDYkd";

async function deleteVoice(voiceId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "api.elevenlabs.io", path: `/v1/voices/${voiceId}`, method: "DELETE",
      headers: { "xi-api-key": API_KEY },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        console.log(`Delete ${voiceId}: ${res.statusCode} ${body}`);
        resolve(res.statusCode === 200);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function createVoice(name, audioFiles, description) {
  // Build multipart form data manually
  const boundary = "----ElevenLabsClone" + Date.now();
  const parts = [];

  // Add name field
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`));

  // Add description field
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`));

  // Add audio files
  for (const file of audioFiles) {
    const fileData = fs.readFileSync(file.path);
    const fileName = path.basename(file.path);
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: audio/mpeg\r\n\r\n`));
    parts.push(fileData);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "api.elevenlabs.io", path: "/v1/voices/add", method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const respBody = Buffer.concat(chunks).toString();
        console.log(`Create voice: ${res.statusCode}`);
        console.log(respBody.slice(0, 1000));
        try {
          const data = JSON.parse(respBody);
          resolve(data);
        } catch {
          resolve({ error: respBody });
        }
      });
    });
    req.on("error", (e) => { console.error("Request error:", e.message); reject(e); });
    req.write(body);
    req.end();
  });
}

// Collect all reference audio files
const audioFiles = fs.readdirSync(REF_DIR)
  .filter(f => f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".m4a"))
  .map(f => ({ path: path.join(REF_DIR, f), name: f }));

console.log(`Found ${audioFiles.length} reference audio files:`);
audioFiles.forEach(f => console.log(`  ${f.name} (${fs.statSync(f.path).size} bytes)`));

// Step 1: Create new voice with ALL reference audio
console.log("\n--- Creating new 夏彦 voice with all reference audio ---");
const result = await createVoice("夏彦-v2", audioFiles, "未定事件簿 夏彦 全参考音频语音克隆 v2");

if (result.voice_id) {
  console.log(`\n✅ New voice created! Voice ID: ${result.voice_id}`);
  console.log(`Update config.js ELEVENLABS_VOICE_ID to: ${result.voice_id}`);

  // Step 2: Delete old voice
  console.log(`\n--- Deleting old voice ${OLD_VOICE_ID} ---`);
  const deleted = await deleteVoice(OLD_VOICE_ID);
  if (deleted) {
    console.log("✅ Old voice deleted");
  }
} else {
  console.log("\n❌ Failed to create voice:", JSON.stringify(result, null, 2));
}
