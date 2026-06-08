/**
 * Upload all compressed audio/video files to Sealos server.
 * Usage: node upload-assets.cjs
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const SERVER = "siwmhifsvdnu.sealoshzh.site";
const AUDIO_DIR = path.join(__dirname, "data", "audio");

function uploadFile(localPath, remoteName) {
  return new Promise((resolve, reject) => {
    const buf = fs.readFileSync(localPath);
    const urlPath = `/api/admin/upload?name=${encodeURIComponent(remoteName)}`;

    const req = https.request({
      host: SERVER, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": buf.length },
      timeout: 60000,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log(`  OK: ${remoteName} (${(buf.length/1024/1024).toFixed(1)}MB)`);
          resolve();
        } else {
          console.log(`  FAIL ${res.statusCode}: ${remoteName} - ${Buffer.concat(chunks).toString().slice(0, 100)}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(buf);
    req.end();
  });
}

function* walkFiles(dir, prefix = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      yield* walkFiles(path.join(dir, entry.name), prefix + entry.name + "/");
    } else {
      yield { path: path.join(dir, entry.name), remote: prefix + entry.name };
    }
  }
}

async function main() {
  console.log(`=== Uploading assets to ${SERVER} ===\n`);

  if (!fs.existsSync(AUDIO_DIR)) {
    console.log("No data/audio directory. Run compress-audio.cjs and compress-video.cjs first.");
    return;
  }

  let count = 0;
  let errors = 0;
  for (const { path: localPath, remote } of walkFiles(AUDIO_DIR)) {
    count++;
    await uploadFile(localPath, remote).catch(() => errors++);
  }

  console.log(`\nDone: ${count - errors}/${count} uploaded`);
  if (errors > 0) console.log(`${errors} files failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
