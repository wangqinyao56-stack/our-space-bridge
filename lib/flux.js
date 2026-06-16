/**
 * Shared FLUX API client for gift icons, stickers, and scenery photos.
 */
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import config from "../config.js";

const API_KEY = config.BFL_API_KEY || process.env.BFL_API_KEY;
const API_HOST = "api.bfl.ai";
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy ||
  ((process.env.SEALOS || process.env.KUBERNETES_SERVICE_HOST) ? null : "http://127.0.0.1:7897");
const proxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

function bflRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: API_HOST,
      path,
      method,
      headers: { "x-key": API_KEY, "Content-Type": "application/json" },
      agent: proxyAgent,
      timeout: 60000,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`BFL ${res.statusCode}: ${text.slice(0, 200)}`));
        } else {
          try { resolve(JSON.parse(text)); } catch { resolve(text); }
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("BFL timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generate an image using FLUX and return as base64 string.
 * @param {string} prompt
 * @param {object} opts - { width, height, steps, model }
 * @returns {Promise<{base64: string, mime: string}>}
 */
export async function generateImage(prompt, opts = {}) {
  const {
    width = 512,
    height = 512,
    steps = 28,
    model = "flux-2-klein-4b",
  } = opts;

  // Submit job
  const { id } = await bflRequest("POST", `/v1/${model}`, {
    prompt,
    width,
    height,
    steps,
  });

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    try {
      const result = await bflRequest("GET", `/v1/get_result?id=${id}`);
      if (result.status === "Ready") {
        // Download image
        const imgBuf = await downloadImage(result.result.sample);
        return {
          base64: imgBuf.toString("base64"),
          mime: "image/png",
        };
      }
      if (result.status === "Error" || result.status === "Failed") {
        throw new Error("Generation failed");
      }
    } catch (err) {
      if (err.message === "Generation failed") throw err;
      // 404 or network error = keep polling
    }
  }
  throw new Error("BFL timeout waiting for result");
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      agent: proxyAgent,
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
