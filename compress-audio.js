/**
 * Compress audio files for cloud serving.
 * Uses ffmpeg-static (bundled ffmpeg, no system install needed).
 *
 * Music: 96kbps mono AAC → ~1-3MB each
 * Noise: 128kbps mono AAC → ~2-6MB each
 *
 * Usage: node compress-audio.js
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ffmpeg = require("ffmpeg-static");

const OUT_DIR = path.join(__dirname, "data", "audio");

// ── Music: HOYO-MiX tracks ──
const MUSIC_IN = "H:/未定素材/未定音乐";
const MUSIC_OUT = path.join(OUT_DIR, "music");

// ── Work noise ──
const NOISE_FILES = [
  { in: "H:/未定素材/未定音乐/工作白噪音/工作白噪音/写字.mp3", out: "noise/写字.m4a" },
  { in: "H:/未定素材/未定音乐/工作白噪音/工作白噪音/翻书赶稿.mp3", out: "noise/翻书赶稿.m4a" },
  { in: "H:/未定素材/未定音乐/工作白噪音/工作白噪音/炉火煮水.mp3", out: "noise/炉火煮水.m4a" },
  { in: "H:/未定素材/未定音乐/工作白噪音/电台节目/猫咪呼噜.mp3", out: "noise/猫咪呼噜.m4a" },
];

function compress(inputPath, outputPath, bitrate = "96k") {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const args = [
      "-y", "-loglevel", "error", "-i", inputPath,
      "-c:a", "aac", "-b:a", bitrate, "-ac", "1", "-ar", "44100",
      outputPath,
    ];
    const p = spawn(ffmpeg, args, { stdio: "inherit" });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}`));
    });
    p.on("error", reject);
  });
}

function fmtSize(bytes) {
  if (!bytes) return "?";
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

async function main() {
  console.log("=== Audio Compression ===\n");

  // ── Compress work noise ──
  console.log("[noise] Compressing work white noise...");
  for (const f of NOISE_FILES) {
    const out = path.join(OUT_DIR, f.out);
    if (fs.existsSync(out)) {
      console.log(`  SKIP: ${path.basename(f.in)} (already exists)`);
      continue;
    }
    if (!fs.existsSync(f.in)) {
      console.log(`  MISSING: ${f.in}`);
      continue;
    }
    const sizeIn = fs.statSync(f.in).size;
    process.stdout.write(`  ${path.basename(f.in)} (${fmtSize(sizeIn)})... `);
    await compress(f.in, out, "128k");
    const sizeOut = fs.statSync(out).size;
    console.log(`${fmtSize(sizeOut)}`);
  }

  // ── Compress music ──
  console.log("\n[music] Compressing HOYO-MiX tracks...");
  fs.mkdirSync(MUSIC_OUT, { recursive: true });
  let musicCount = 0;
  const files = fs.readdirSync(MUSIC_IN).filter(f => f.startsWith("HOYO-MiX") && f.endsWith(".mp3"));
  for (const f of files) {
    const outFile = f.replace(".mp3", ".m4a");
    const out = path.join(MUSIC_OUT, outFile);
    if (fs.existsSync(out)) {
      musicCount++;
      continue; // skip already compressed
    }
    const inPath = path.join(MUSIC_IN, f);
    const sizeIn = fs.statSync(inPath).size;
    process.stdout.write(`  [${++musicCount}/${files.length}] ${f.slice(0, 50)}... (${fmtSize(sizeIn)}) `);
    await compress(inPath, out, "96k");
    const sizeOut = fs.statSync(out).size;
    console.log(`-> ${fmtSize(sizeOut)}`);
  }

  // ── Summary ──
  console.log("\n=== Done ===");
  console.log(`Music: ${MUSIC_OUT}`);
  console.log(`Noise: ${path.join(OUT_DIR, "noise")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
