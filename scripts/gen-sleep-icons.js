/**
 * Generate watercolor-style icons for white noise tracks using BFL/Flux.
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const API_KEY = "bfl_yQzRVUDrmrusbQwVi9V1VBbHLLaQMpAe";
const OUTPUT_DIR = "F:/Claude-memory/our-space-app/assets/sleep-icons";

const TRACKS = [
  { id: "rain-light", label: "小雨",
    prompt: "watercolor painting of gentle light rain, soft blue raindrops, minimal delicate brushstrokes, white paper background, hand-painted watercolor style, no outlines" },
  { id: "rain-heavy", label: "大雨",
    prompt: "watercolor painting of heavy rain pouring down, deep blue and grey tones, expressive wet brush strokes, white paper background, hand-painted watercolor style" },
  { id: "thunderstorm", label: "雷雨",
    prompt: "watercolor painting of a small lightning bolt with dark purple storm clouds, dramatic but cute, minimal brushstrokes, white paper background, hand-painted watercolor style" },
  { id: "ocean", label: "海浪",
    prompt: "watercolor painting of gentle ocean waves in soft teal and blue, simple flowing lines, white paper background, hand-painted watercolor style, minimal" },
  { id: "underwater", label: "海底",
    prompt: "watercolor painting of underwater scene with subtle bubbles, deep blue-green tones, serene atmosphere, white paper background, hand-painted watercolor style, minimal" },
  { id: "bowl", label: "钵音",
    prompt: "watercolor painting of a small singing bowl with gentle golden ripples, warm amber and sand tones, zen atmosphere, white paper background, hand-painted watercolor style" },
  { id: "soda", label: "碳酸水",
    prompt: "watercolor painting of fizzy bubbles rising in a glass, light teal and mint tones, refreshing feel, white paper background, hand-painted watercolor style, minimal" },
  { id: "onsen", label: "温泉",
    prompt: "watercolor painting of gentle steam rising from a hot spring, soft green and warm mist tones, peaceful atmosphere, white paper background, hand-painted watercolor style" },
  { id: "shower", label: "浴室",
    prompt: "watercolor painting of soft water spray from a shower, light blue misty droplets, relaxing bathroom atmosphere, white paper background, hand-painted watercolor style" },
  { id: "writing", label: "写字",
    prompt: "watercolor painting of a simple quill or pen writing on paper, warm beige and sepia tones, quiet study atmosphere, white paper background, hand-painted watercolor style" },
  { id: "train", label: "火车",
    prompt: "watercolor painting of a small vintage train in the distance, warm brown and grey tones, gentle countryside feel, white paper background, hand-painted watercolor style" },
  { id: "cat-purr", label: "猫咪打呼",
    prompt: "watercolor painting of a sleeping cat curled up, warm orange and cream tones, cozy and peaceful, white paper background, hand-painted watercolor style" },
  { id: "bonfire", label: "篝火",
    prompt: "watercolor painting of a small campfire with gentle orange flames, warm amber glow, cozy evening atmosphere, white paper background, hand-painted watercolor style" },
  { id: "sherlock", label: "神探夏洛克",
    prompt: "watercolor painting of a classic detective pipe and magnifying glass, vintage brown and grey tones, Sherlock Holmes aesthetic, white paper background, hand-painted watercolor style" },
];

function bflRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: "api.bfl.ai", path, method,
      headers: { "x-key": API_KEY, "Content-Type": "application/json" },
      timeout: 60000,
    };
    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        if (res.statusCode !== 200) reject(new Error(`BFL ${res.statusCode}: ${d.slice(0, 200)}`));
        else resolve(JSON.parse(d));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function download(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(u, { timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function generateOne(track) {
  const outPath = path.join(OUTPUT_DIR, `${track.id}.png`);
  if (fs.existsSync(outPath)) {
    console.log(`[skip] ${track.id} (${track.label}) — already exists`);
    return;
  }

  console.log(`[gen] ${track.id} (${track.label})...`);
  const fullPrompt = `${track.prompt}, icon illustration, simple composition, centered, no text, no people, clean edges`;

  // Submit
  const { id } = await bflRequest("POST", "/v1/flux-2-klein-4b", {
    prompt: fullPrompt,
    width: 512,
    height: 512,
    steps: 28,
  });
  console.log(`  submitted: ${id}`);

  // Poll
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    try {
      const result = await bflRequest("GET", `/v1/get_result?id=${id}`);
      if (result.status === "Ready") {
        const buf = await download(result.result.sample);
        fs.writeFileSync(outPath, buf);
        console.log(`  [done] ${track.id} (${track.label}) saved`);
        return;
      }
      if (result.status === "Error" || result.status === "Failed") {
        console.log(`  [fail] ${track.id}: generation failed`);
        return;
      }
      console.log(`  polling... status: ${result.status}`);
    } catch (err) {
      if (err.message === "Generation failed") throw err;
      // keep polling on transient errors
    }
  }
  console.log(`  [timeout] ${track.id}`);
}

async function main() {
  for (const track of TRACKS) {
    try {
      await generateOne(track);
    } catch (err) {
      console.error(`  [error] ${track.id}: ${err.message}`);
    }
    // Rate limit between tracks
    await sleep(2000);
  }
  console.log("\nAll done!");
}

main();
