/**
 * Generate sleep watercolor icons via 即梦/Seedream API.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const API_KEY = "ark-eb4cc461-f909-41d1-9c79-97c4cb069b52-f468f";
const API_HOST = "ark.cn-beijing.volces.com";
const API_PATH = "/api/v3/images/generations";

const OUT_DIR = path.join(__dirname, "data", "icons", "sleep");
fs.mkdirSync(OUT_DIR, { recursive: true });

const ICONS = [
  { id: "rain-light", prompt: "watercolor illustration, gentle light rain falling on a window, soft blue-grey tones, hand-painted watercolor texture, cozy peaceful atmosphere, minimal" },
  { id: "rain-heavy", prompt: "watercolor illustration, heavy rain pouring outside a window, deep blue and grey tones, hand-painted watercolor texture, dramatic yet calming, minimal" },
  { id: "thunderstorm", prompt: "watercolor illustration, distant lightning over dark clouds at night, purple and deep blue tones, hand-painted watercolor texture, powerful but safe, minimal" },
  { id: "ocean", prompt: "watercolor illustration, gentle ocean waves rolling onto a sandy beach, soft teal and blue tones, hand-painted watercolor texture, serene and peaceful, minimal" },
  { id: "underwater", prompt: "watercolor illustration, light rays filtering through deep blue water with small bubbles, cerulean blue tones, hand-painted watercolor texture, tranquil and immersive, minimal" },
  { id: "bowl", prompt: "watercolor illustration, a Tibetan singing bowl on a wooden surface with gentle vibration lines, warm gold and brown tones, hand-painted watercolor texture, meditative, minimal" },
  { id: "soda", prompt: "watercolor illustration, a glass of sparkling soda water with bubbles rising, fresh aqua and white tones, hand-painted watercolor texture, refreshing, minimal" },
  { id: "onsen", prompt: "watercolor illustration, a natural hot spring with gentle steam rising, surrounded by rocks, soft warm green and beige tones, hand-painted watercolor texture, relaxing, minimal" },
  { id: "shower", prompt: "watercolor illustration, a gentle shower of water droplets falling, soft blue-white tones, hand-painted watercolor texture, cleansing and soothing, minimal" },
  { id: "writing", prompt: "watercolor illustration, a fountain pen resting on a notebook with elegant cursive writing, sepia and cream tones, hand-painted watercolor texture, scholarly, minimal" },
  { id: "train", prompt: "watercolor illustration, a vintage train moving through a gentle countryside at dusk, soft brown and warm grey tones, hand-painted watercolor texture, nostalgic and rhythmic, minimal" },
  { id: "cat-purr", prompt: "watercolor illustration, a fluffy orange tabby cat sleeping peacefully while purring, soft warm orange and cream tones, hand-painted watercolor texture, cozy and cute, minimal" },
  { id: "bonfire", prompt: "watercolor illustration, a small campfire with gentle flames and sparks under a starry sky, warm orange and amber tones, hand-painted watercolor texture, cozy, minimal" },
  { id: "sherlock", prompt: "watercolor illustration, a vintage magnifying glass and a deerstalker hat on an old wooden desk, warm brown and amber tones, hand-painted watercolor texture, detective mystery vibe, minimal" },
  { id: "spring", prompt: "watercolor illustration, a crystal clear mountain spring flowing over smooth rocks with tiny water splashes, fresh blue-green tones, hand-painted watercolor texture, pure and serene, minimal" },
  { id: "goodnight", prompt: "watercolor illustration, a crescent moon and soft stars over a sleeping cat on a windowsill, soft indigo and silver tones, hand-painted watercolor texture, dreamy and tender, minimal" },
  { id: "lullaby", prompt: "watercolor illustration, a delicate music box with a tiny ballerina and floating musical notes, soft pink and lavender tones, hand-painted watercolor texture, gentle and nostalgic, minimal" },
];

function generateImage(prompt, filename) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "doubao-seedream-5-0-lite-260128",
      prompt: `${prompt}, no humans, no people, no faces, no text, no letters, no words`,
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
          if (!url) { reject(new Error("No URL")); return; }
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
  console.log("=== Generating sleep watercolor icons ===\n");
  for (const icon of ICONS) {
    const outFile = path.join(OUT_DIR, `${icon.id}.jpg`);
    if (fs.existsSync(outFile)) {
      console.log(`  SKIP: ${icon.id}`);
      continue;
    }
    process.stdout.write(`  [${icon.id}] ${icon.label || ""}... `);
    try {
      await generateImage(icon.prompt, outFile);
      const size = fs.statSync(outFile).size;
      console.log(`OK (${(size/1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
    }
  }
  console.log(`\nDone! ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
