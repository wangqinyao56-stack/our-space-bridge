/**
 * Cloud audio/video asset registry.
 *
 * Files are stored on the server's data directory and served via HTTP.
 * App downloads and caches them locally on first use.
 *
 * Directory structure:
 *   data/audio/sleep/     — sleep white noise tracks
 *   data/audio/music/     — pomodoro music tracks
 *   data/audio/video/     — pomodoro background video
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");

const ASSETS = {
  // ── Sleep white noise tracks ──
  sleep: [
    { id: "sleep-rain-light", label: "小雨", category: "sleep", file: "sleep/rain-light.mp3" },
    { id: "sleep-rain-heavy", label: "大雨", category: "sleep", file: "sleep/rain-heavy.mp3" },
    { id: "sleep-thunderstorm", label: "雷雨", category: "sleep", file: "sleep/thunderstorm.mp3" },
    { id: "sleep-ocean", label: "海浪", category: "sleep", file: "sleep/ocean.mp3" },
    { id: "sleep-underwater", label: "海底", category: "sleep", file: "sleep/underwater.mp3" },
    { id: "sleep-bowl", label: "钵音", category: "sleep", file: "sleep/bowl.mp3" },
    { id: "sleep-soda", label: "碳酸水", category: "sleep", file: "sleep/soda.mp3" },
    { id: "sleep-onsen", label: "温泉", category: "sleep", file: "sleep/onsen.mp3" },
    { id: "sleep-shower", label: "浴室", category: "sleep", file: "sleep/shower.mp3" },
    { id: "sleep-writing", label: "写字", category: "sleep", file: "sleep/writing.mp3" },
    { id: "sleep-train", label: "火车", category: "sleep", file: "sleep/train.mp3" },
    { id: "sleep-cat-purr", label: "猫咪打呼", category: "sleep", file: "sleep/cat-purr.mp3" },
    { id: "sleep-bonfire", label: "篝火", category: "sleep", file: "sleep/bonfire.mp3" },
    { id: "sleep-sherlock", label: "神探夏洛克", category: "sleep", file: "sleep/sherlock.mp3" },
    { id: "sleep-goodnight", label: "晚安问候", category: "sleep", file: "sleep/goodnight.mp3", mime: "audio/mpeg" },
    { id: "sleep-lullaby", label: "摇篮曲", category: "sleep", file: "sleep/lullaby.mp3", mime: "audio/mpeg" },
  ],

  // ── Pomodoro music tracks ──
  music: [
    // Placeholder — user will add music files to data/audio/music/
    // { id: "piano-calm", label: "平静钢琴", category: "music", file: "music/piano-calm.mp3" },
    // { id: "lofi-beats", label: "Lo-fi 节拍", category: "music", file: "music/lofi-beats.mp3" },
  ],

  // ── Pomodoro video ──
  video: { id: "pomodoro-bg", label: "番茄钟背景", category: "video", file: "video/pomodoro-bg.mp4", mime: "video/mp4" },
};

// Build flat index
const flat: Array<{ id: string; label: string; category: string; path: string; mime: string }> = [];

for (const [cat, items] of Object.entries(ASSETS)) {
  if (cat === "video") {
    const v = items as typeof ASSETS.video;
    flat.push({ id: v.id, label: v.label, category: v.category, path: path.join(AUDIO_DIR, v.file), mime: v.mime });
  } else {
    for (const item of items as any[]) {
      const ext = path.extname(item.file).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
        ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
        ".mp4": "video/mp4", ".webm": "video/webm",
      };
      flat.push({
        id: item.id,
        label: item.label,
        category: item.category || cat,
        path: path.join(AUDIO_DIR, item.file),
        mime: item.mime || mimeMap[ext] || "audio/mpeg",
      });
    }
  }
}

// Build lookup map
const byId = new Map<string, typeof flat[0]>();
for (const a of flat) byId.set(a.id, a);

export function listAudioAssets() {
  // Only list assets whose files actually exist
  return flat.filter(a => fs.existsSync(a.path)).map(a => ({
    id: a.id, label: a.label, category: a.category, mime: a.mime,
    size: fs.statSync(a.path).size,
  }));
}

export function getAudioAsset(id: string) {
  return byId.get(id) || null;
}

export function getPomodoroVideo() {
  return byId.get("pomodoro-bg") || null;
}
