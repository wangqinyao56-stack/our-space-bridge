/**
 * Affection Home CG (illustration) storage — persistent volume.
 *
 * CG images stored in data/affection-home-cgs/images/
 * Metadata stored in data/affection-home-cgs/cgs.json
 *
 * CGs are unlocked/triggered during affection home conversations.
 * The gallery shows all CGs with context (when unlocked, what triggered them).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const CG_DIR = path.join(DATA_DIR, "affection-home-cgs");
const IMAGES_DIR = path.join(CG_DIR, "images");
const META_FILE = path.join(CG_DIR, "cgs.json");

try { fs.mkdirSync(IMAGES_DIR, { recursive: true }); } catch {}

let cgs = [];
try {
  if (fs.existsSync(META_FILE)) {
    cgs = JSON.parse(fs.readFileSync(META_FILE, "utf-8"));
    console.log(`[affection-cg] Loaded ${cgs.length} CGs`);
  }
} catch {}

function save() {
  try { fs.writeFileSync(META_FILE, JSON.stringify(cgs, null, 2), "utf-8"); } catch {}
}

/**
 * Upload a new CG image. Returns the CG record.
 */
export function uploadCG(filename, imageBuffer) {
  const id = `cg_${Date.now()}`;
  const ext = path.extname(filename) || ".png";
  const imageFile = `${id}${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, imageFile), imageBuffer);

  const cg = {
    id,
    filename: imageFile,
    originalName: filename,
    uploadedAt: Date.now(),
    unlockedAt: null,    // when it first appeared in chat
    unlockContext: null, // what triggered it
    seen: false,
  };
  cgs.push(cg);
  save();
  console.log(`[affection-cg] Uploaded: ${filename} → ${imageFile}`);
  return cg;
}

/**
 * Record that a CG was shown/unlocked during conversation.
 */
export function unlockCG(cgId, context = "") {
  const cg = cgs.find(c => c.id === cgId);
  if (!cg) return null;
  cg.unlockedAt = Date.now();
  cg.unlockContext = context || null;
  cg.seen = true;
  save();
  console.log(`[affection-cg] Unlocked: ${cgId} (${context?.slice(0, 50) || "no context"})`);
  return cg;
}

/**
 * Get all CGs ordered by upload date (newest first).
 */
export function getCGHistory() {
  return [...cgs].sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/**
 * Get all unlocked CGs.
 */
export function getUnlockedCGs() {
  return cgs.filter(c => c.seen).sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0));
}

/**
 * Serve a CG image file path by CG id.
 * Returns { filePath, mime } or null.
 */
export function getCGImage(cgId) {
  const cg = cgs.find(c => c.id === cgId);
  if (!cg) return null;
  const filePath = path.join(IMAGES_DIR, cg.filename);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(cg.filename).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return { filePath, mime };
}

/**
 * Delete a CG (image + metadata).
 */
export function deleteCG(cgId) {
  const idx = cgs.findIndex(c => c.id === cgId);
  if (idx === -1) return false;
  const cg = cgs[idx];
  try { fs.unlinkSync(path.join(IMAGES_DIR, cg.filename)); } catch {}
  cgs.splice(idx, 1);
  save();
  return true;
}
