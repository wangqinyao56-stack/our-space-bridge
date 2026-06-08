/**
 * 火山方舟 即梦/Seedream 图片生成 — 用于发现配图 & 聊天场景图
 * 国内直连，不走代理
 */
import https from "node:https";
import config from "../config.js";

const API_KEY = config.ARK_API_KEY || process.env.ARK_API_KEY;
const API_HOST = "ark.cn-beijing.volces.com";
const API_PATH = "/api/v3/images/generations";

const HUMAN_FILTER = "no humans, no people, no faces, no portraits, no fingers, no hands, no hair, no body parts, no skin, no person";

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Download timeout")); });
    req.end();
  });
}

/**
 * Generate image via 即梦/Seedream, returns { base64, mime } or null.
 * Retries up to 2 times on failure.
 */
export async function generateJimengImage(prompt, opts = {}) {
  if (!API_KEY) {
    console.log("[jimeng] No ARK_API_KEY");
    return null;
  }
  const { width = 1920, height = 1920 } = opts;
  const cleanPrompt = `${prompt}, ${HUMAN_FILTER}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[jimeng] Generating (attempt ${attempt}): "${prompt.slice(0, 80)}..."`);
      const body = JSON.stringify({
        model: "doubao-seedream-5-0-lite-260128",
        prompt: cleanPrompt,
        size: `${width}x${height}`,
        response_format: "url",
        watermark: false,
        n: 1,
      });

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          host: API_HOST,
          path: API_PATH,
          method: "POST",
          headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 180000,
        }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            if (res.statusCode !== 200) {
              reject(new Error(`Jimeng ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`));
              return;
            }
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch (e) { reject(e); }
          });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("Jimeng timeout (180s)")); });
        req.write(body);
        req.end();
      });

      const url = result.data?.[0]?.url;
      if (!url) {
        console.log("[jimeng] No URL in response, retrying...");
        continue;
      }

      const imgBuf = await downloadImage(url);
      if (imgBuf && imgBuf.length > 1000) {
        console.log(`[jimeng] OK attempt=${attempt}, ${imgBuf.length} bytes`);
        return { base64: imgBuf.toString("base64"), mime: "image/png" };
      }
      console.log(`[jimeng] Download empty/small, retrying...`);
    } catch (err) {
      console.log(`[jimeng] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 2) {
        // Wait before retry
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  console.log("[jimeng] All attempts failed");
  return null;
}
