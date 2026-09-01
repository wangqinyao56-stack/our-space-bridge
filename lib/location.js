/**
 * 阿鹿位置存储：App 端上报经纬度，这里存下来并逆地理编码成可读地址。
 * 供夏彦"看到她在哪" + 导航当起点用。
 */
import fs from "node:fs";
import path from "node:path";
import { regeocode } from "./amap.js";

const DATA_DIR = process.env.DATA_DIR || ".";
const LOCATION_FILE = path.join(DATA_DIR, "location.json");

let currentLocation = null; // { lng, lat, address, time }

function load() {
  try {
    if (fs.existsSync(LOCATION_FILE)) {
      currentLocation = JSON.parse(fs.readFileSync(LOCATION_FILE, "utf-8"));
    }
  } catch {}
}
load();

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCATION_FILE, JSON.stringify(currentLocation), "utf-8");
  } catch {}
}

// 更新阿鹿位置（App 端上报），并逆地理编码成地址
export async function updateLocation(lng, lat) {
  let address = null;
  try {
    address = await regeocode(lng, lat);
  } catch {}
  currentLocation = { lng, lat, address, time: Date.now() };
  save();
  console.log(`[location] 阿鹿位置更新: ${address || `${lng},${lat}`}`);
  return currentLocation;
}

export function getLocation() {
  return currentLocation;
}
