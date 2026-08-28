/**
 * VoxCPM（开源免费 TTS）接入：调 AutoDL 上的 VoxCPM server，克隆夏彦音色合成。
 * 通过环境变量 VOXCPM_URL 启用（未设置则回退火山 synthesizeBuffer）。
 */
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

const VOXCPM_URL = process.env.VOXCPM_URL || "";

export function voxcpmEnabled() {
  return !!VOXCPM_URL;
}

// 调 VoxCPM server 合成，返回 mp3 Buffer（服务端已把 wav 转 mp3）
export async function voxcpmSynthesizeMp3(text) {
  if (!VOXCPM_URL) throw new Error("VOXCPM_URL 未配置");
  const url = `${VOXCPM_URL.replace(/\/+$/, "")}/tts`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`VoxCPM HTTP ${res.status}`);
  const wav = Buffer.from(await res.arrayBuffer());
  return wavToMp3(wav);
}

// wav → mp3（96k mono），复用 ffmpeg-static
function wavToMp3(wavBuf) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegStatic, [
      "-i", "pipe:0",
      "-c:a", "libmp3lame",
      "-b:a", "96k",
      "-ac", "1",
      "-f", "mp3",
      "pipe:1",
    ]);
    const chunks = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", () => {});
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}`));
    });
    ff.on("error", reject);
    ff.stdin.write(wavBuf);
    ff.stdin.end();
  });
}
