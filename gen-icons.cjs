/**
 * Generate watercolor icons using 即梦/Seedream API.
 * Usage: node gen-icons.js
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const API_KEY = "ark-eb4cc461-f909-41d1-9c79-97c4cb069b52-f468f";
const API_HOST = "ark.cn-beijing.volces.com";
const API_PATH = "/api/v3/images/generations";

const OUT_DIR = path.join(__dirname, "data", "icons");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ICONS = [
  { id: "pomodoro", prompt: "watercolor illustration, a cute golden retriever puppy wearing glasses and studying at a desk with a small tomato timer, soft warm colors, hand-painted watercolor texture, white background, simple and minimal" },
  { id: "noise-writing", prompt: "watercolor illustration, a hand holding a fountain pen writing on paper, ink splatter, soft blue-grey tones, hand-painted watercolor texture, white background, elegant and minimal" },
  { id: "noise-pageflip", prompt: "watercolor illustration, an open book with pages flipping in the breeze, soft brown and cream tones, hand-painted watercolor texture, white background, scholarly and minimal" },
  { id: "noise-boiling", prompt: "watercolor illustration, a small kettle boiling over a gentle fire, steam rising, soft orange and grey tones, hand-painted watercolor texture, white background, cozy and minimal" },
  { id: "noise-cat-purr", prompt: "watercolor illustration, a sleepy orange cat curled up and purring, soft warm orange and cream tones, hand-painted watercolor texture, white background, cute and minimal" },
  { id: "noise-spring", prompt: "watercolor illustration, a small mountain spring flowing over rocks, clear water droplets, soft blue-green tones, hand-painted watercolor texture, white background, serene and minimal" },
  { id: "music", prompt: "watercolor illustration, a pair of wireless earbuds with gentle musical notes floating around, soft pink and lavender tones, hand-painted watercolor texture, white background, modern and minimal" },
];

function generateImage(prompt, filename) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "doubao-seedream-5-0-lite-260128",
      prompt: `${prompt}, no humans, no people, no faces, no text, no letters`,
      size: "1920x1920",
      response_format: "url",
      watermark: false,
      n: 1,
    });

    const req = https.request({
      host: API_HOST, path: API_PATH, method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", async () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const url = data.data?.[0]?.url;
          if (!url) { reject(new Error("No URL in response")); return; }
          // Download image
          https.get(url, { timeout: 30000 }, (r) => {
            const imgChunks = [];
            r.on("data", c => imgChunks.push(c));
            r.on("end", () => {
              fs.writeFileSync(filename, Buffer.concat(imgChunks));
              resolve();
            });
          }).on("error", reject);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== Generating watercolor icons via 即梦 ===\n");
  for (const icon of ICONS) {
    const outFile = path.join(OUT_DIR, `${icon.id}.png`);
    if (fs.existsSync(outFile)) {
      console.log(`  SKIP: ${icon.id} (already exists)`);
      continue;
    }
    process.stdout.write(`  [${icon.id}] generating... `);
    try {
      await generateImage(icon.prompt, outFile);
      const size = fs.statSync(outFile).size;
      console.log(`OK (${(size/1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  console.log(`\nDone! Icons saved to: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
