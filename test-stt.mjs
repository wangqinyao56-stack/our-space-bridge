// Direct test of OpenRouter STT API
import https from "node:https";
import config from "./config.js";

const apiKey = config.OPENROUTER_API_KEY;

// Generate a minimal M4A/MP4 file with AAC audio (or test with WAV)
// For a real test, let's create a simple WAV with a 1kHz tone at 16kHz mono
function createTestWav(durationSec = 2) {
  const sampleRate = 16000;
  const numSamples = sampleRate * durationSec;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;

  const header = Buffer.alloc(44);
  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const samples = Buffer.alloc(dataSize);
  for (let i = 0; i < numSamples; i++) {
    // 440Hz tone at low volume
    const t = i / sampleRate;
    const val = Math.sin(2 * Math.PI * 440 * t) * 2000;
    samples.writeInt16LE(Math.round(val), i * 2);
  }

  return Buffer.concat([header, samples]);
}

async function testSTT(audioBuf, format, description) {
  console.log(`\n=== Test: ${description} ===`);
  console.log(`Audio: ${audioBuf.length} bytes, format: ${format}`);

  const audioBase64 = audioBuf.toString("base64");

  const payload = JSON.stringify({
    model: "openai/whisper-large-v3-turbo",
    language: "zh",
    input_audio: {
      data: audioBase64,
      format,
    },
  });

  return new Promise((resolve) => {
    const req = https.request({
      host: "openrouter.ai",
      path: "/api/v1/audio/transcriptions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://our-space.app",
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString();
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${rawBody.slice(0, 500)}`);
        try {
          const data = JSON.parse(rawBody);
          console.log(`Text: "${data.text || "(empty)"}"`);
          console.log(`Keys: ${Object.keys(data).join(", ")}`);
        } catch (e) {
          console.log(`Parse error: ${e.message}`);
        }
        resolve();
      });
    });
    req.on("error", (e) => {
      console.error(`Request error: ${e.message}`);
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      console.error("Timeout");
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

// Test 1: WAV with sine tone (should return empty - no speech)
const wavBuf = createTestWav(2);
await testSTT(wavBuf, "wav", "Generated WAV (sine tone)");

// Test 2: Also test with mp4 format
await testSTT(wavBuf, "mp4", "Same WAV but format=mp4 (should fail or empty)");

// Test 3: M4A format
await testSTT(wavBuf, "m4a", "Same WAV but format=m4a (should fail or empty)");

console.log("\n=== Done ===");
