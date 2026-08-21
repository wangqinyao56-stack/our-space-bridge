/**
 * 华生对夏彦的「爱称」长期记忆。
 * 华生叫夏彦"心肝儿""老公"等固定称呼时记下来，跨频道注入（日常 + 亲密空间），
 * 让夏彦别每次都当成"第一次这么叫"。
 *
 * 存储：data/petnames.json（单文件，与其它 data/*.json 一致）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "petnames.json");

let names = []; // [{ name, firstSeen }]

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf-8"));
      names = Array.isArray(data) ? data : [];
      console.log(`[petname] Loaded ${names.length} pet names`);
    }
  } catch (e) {
    console.error("[petname] Load failed:", e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(names), "utf-8");
  } catch (e) {
    console.error("[petname] Save failed:", e.message);
  }
}

// 归一化：去空白 + 去末尾"儿"（心肝儿 == 心肝），用于去重
function normalize(name) {
  return String(name || "").trim().replace(/儿$/, "");
}

export function addPetName(name) {
  const n = normalize(name);
  if (!n || n.length < 1 || n.length > 8) return false;
  if (names.some((x) => normalize(x.name) === n)) return false;
  names.push({ name: n, firstSeen: Date.now() });
  if (names.length > 100) names = names.slice(-100);
  save();
  console.log(`[petname] Added: ${n}`);
  return true;
}

export function getPetNames() {
  return names.map((x) => x.name);
}

// 从华生消息里识别对夏彦的爱称（关键词兜底，立即生效）
const VOCATIVES = [
  "心肝儿", "心肝", "亲爱的", "老公", "大狗狗", "小狗狗", "小奶狗",
  "臭宝", "宝贝", "宝宝", "甜心", "乖乖", "夏夏", "彦彦",
];
const VOCATIVE_RE = new RegExp(
  VOCATIVES.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

export function detectPetNames(text) {
  if (!text || typeof text !== "string") return [];
  const found = [];
  const seen = new Set();
  for (const m of text.match(VOCATIVE_RE) || []) {
    const n = normalize(m);
    if (!seen.has(n)) {
      seen.add(n);
      if (addPetName(n)) found.push(n);
    }
  }
  return found;
}

export function getPetNameContext() {
  const list = getPetNames();
  if (list.length === 0) return "";
  return `\n\n[爱称记忆·华生平时怎么叫你]\n华生会这样叫你：${list.join("、")}。这些是她对你固定、亲昵的称呼，是你们的习惯——不是第一次这么叫。她这么叫你的时候，你要自然、熟悉、甜地接住，绝对不要表现得像第一次听到、不要问"你第一次这么叫我吗""你叫我什么"。`;
}

load();
