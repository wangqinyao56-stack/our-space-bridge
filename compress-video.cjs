/**
 * Compress pomodoro video files for cloud streaming.
 * 开场/结尾: copy as-is (already small)
 * 学习视频: compress 4.1GB → ~80MB (720p H.265 ~1.5Mbps)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ffmpeg = require("ffmpeg-static");

const OUT_DIR = path.join(__dirname, "data", "audio", "video");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIDEOS = [
  {
    in: "H:/BaiduSyncdisk/直播所需素材/【夏彦同学时分】和夏彦一起学习一小时/开场.mp4",
    out: "pomodoro-intro.mp4",
    label: "开场",
    compress: false,
  },
  {
    in: "H:/BaiduSyncdisk/直播所需素材/【夏彦同学时分】和夏彦一起学习一小时/6月8日 (1).mp4",
    out: "pomodoro-focus.mp4",
    label: "学习循环",
    compress: true,
    // 720p H.265 ~1.5Mbps for ~1h video → ~80MB
    args: ["-c:v", "libx265", "-preset", "medium", "-crf", "32",
           "-vf", "scale=1280:720", "-r", "24",
           "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "22050",
           "-movflags", "+faststart"],
  },
  {
    in: "H:/BaiduSyncdisk/直播所需素材/【夏彦同学时分】和夏彦一起学习一小时/结尾.mp4",
    out: "pomodoro-outro.mp4",
    label: "结尾",
    compress: false,
  },
];

function compress(inputPath, outputPath, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y", "-loglevel", "error", "-i", inputPath,
      ...extraArgs,
      outputPath,
    ];
    console.log(`  ffmpeg ${args.join(" ").slice(0, 120)}...`);
    const p = spawn(ffmpeg, args, { stdio: "inherit" });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}`));
    });
    p.on("error", reject);
  });
}

function fmtSize(bytes) { return (bytes / 1024 / 1024).toFixed(1) + "MB"; }

async function main() {
  console.log("=== Video Compression ===\n");
  for (const v of VIDEOS) {
    const outPath = path.join(OUT_DIR, v.out);
    if (fs.existsSync(outPath)) {
      const sz = fs.statSync(outPath).size;
      console.log(`  SKIP: ${v.label} (${fmtSize(sz)}, already exists)`);
      continue;
    }
    if (!fs.existsSync(v.in)) {
      console.log(`  MISSING: ${v.in}`);
      continue;
    }
    const sizeIn = fs.statSync(v.in).size;
    console.log(`  [${v.label}] ${fmtSize(sizeIn)} → ${v.out}`);
    if (v.compress) {
      await compress(v.in, outPath, v.args);
    } else {
      fs.copyFileSync(v.in, outPath);
    }
    const sizeOut = fs.statSync(outPath).size;
    console.log(`    Done: ${fmtSize(sizeOut)}`);
  }
  console.log(`\nDone! Videos in: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
