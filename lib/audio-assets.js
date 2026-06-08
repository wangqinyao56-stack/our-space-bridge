/**
 * Cloud audio/video asset registry.
 *
 * Files stored on server's data directory, served via HTTP.
 * App downloads and caches locally on first use.
 *
 * Directory structure:
 *   data/audio/sleep/     — sleep white noise tracks
 *   data/audio/music/     — pomodoro music tracks (auto-scanned)
 *   data/audio/video/     — pomodoro background video
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");

const MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

function scanDir(dir: string, category: string): Array<{ id: string; label: string; category: string; path: string; mime: string; size: number }> {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /\.(mp3|m4a|aac|ogg|wav|flac)$/i.test(f))
      .map(f => {
        const fp = path.join(dir, f);
        const ext = path.extname(f).toLowerCase();
        const label = f.replace(/\.[^.]+$/, "").replace(/^HOYO-MiX - /, "").replace(/_/g, " ").slice(0, 40);
        return {
          id: `${category}-${f.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9一-鿿\-_]/g, "-").slice(0, 60)}`,
          label,
          category,
          path: fp,
          mime: MIME_MAP[ext] || "audio/mpeg",
          size: fs.statSync(fp).size,
        };
      });
  } catch {
    return [];
  }
}

// ── Sleep white noise (hardcoded — must match what the app expects) ──
const SLEEP_TRACKS = [
  { id: "sleep-rain-light", file: "sleep/rain-light.mp3", label: "小雨" },
  { id: "sleep-rain-heavy", file: "sleep/rain-heavy.mp3", label: "大雨" },
  { id: "sleep-thunderstorm", file: "sleep/thunderstorm.mp3", label: "雷雨" },
  { id: "sleep-ocean", file: "sleep/ocean.mp3", label: "海浪" },
  { id: "sleep-underwater", file: "sleep/underwater.mp3", label: "海底" },
  { id: "sleep-bowl", file: "sleep/bowl.mp3", label: "钵音" },
  { id: "sleep-soda", file: "sleep/soda.mp3", label: "碳酸水" },
  { id: "sleep-onsen", file: "sleep/onsen.mp3", label: "温泉" },
  { id: "sleep-shower", file: "sleep/shower.mp3", label: "浴室" },
  { id: "sleep-writing", file: "sleep/writing.mp3", label: "写字" },
  { id: "sleep-train", file: "sleep/train.mp3", label: "火车" },
  { id: "sleep-cat-purr", file: "sleep/cat-purr.mp3", label: "猫咪打呼" },
  { id: "sleep-bonfire", file: "sleep/bonfire.mp3", label: "篝火" },
  { id: "sleep-sherlock", file: "sleep/sherlock.mp3", label: "神探夏洛克" },
  { id: "sleep-goodnight", file: "sleep/goodnight.mp3", label: "晚安问候" },
  { id: "sleep-lullaby", file: "sleep/lullaby.mp3", label: "摇篮曲" },
];

// ── Build flat index ──
let _cachedFlat: any[] | null = null;

function buildIndex() {
  if (_cachedFlat) return _cachedFlat;

  const flat: any[] = [];

  // Sleep tracks
  for (const t of SLEEP_TRACKS) {
    const fp = path.join(AUDIO_DIR, t.file);
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).toLowerCase();
      flat.push({ id: t.id, label: t.label, category: "sleep", path: fp, mime: MIME_MAP[ext] || "audio/mpeg", size: fs.statSync(fp).size });
    }
  }

  // Music tracks (auto-scanned)
  const musicDir = path.join(AUDIO_DIR, "music");
  flat.push(...scanDir(musicDir, "music"));

  // Video
  const videoDir = path.join(AUDIO_DIR, "video");
  flat.push(...scanDir(videoDir, "video"));

  _cachedFlat = flat;
  return flat;
}

// Clear cache (e.g. after uploading new files)
export function refreshAssetIndex() {
  _cachedFlat = null;
}

const byId = () => {
  const m = new Map<string, any>();
  for (const a of buildIndex()) m.set(a.id, a);
  return m;
};

export function listAudioAssets() {
  return buildIndex().map(a => ({ id: a.id, label: a.label, category: a.category, mime: a.mime, size: a.size }));
}

export function getAudioAsset(id: string) {
  return byId().get(id) || null;
}

export function getPomodoroVideo() {
  return buildIndex().find(a => a.category === "video") || null;
}
