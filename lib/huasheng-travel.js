/**
 * 华生出差状态管理。
 * 比 scenery.js 简单——无状态机阶段、无随机触发、无照片生成。
 * 华生主动说"我要出差了"→激活，"我回来了"→关闭。
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || ".";
const STATE_FILE = path.join(DATA_DIR, "huasheng-travel-state.json");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── 出发关键词 ──
const DEPART_PATTERNS = [
  /要去出差/, /要出差/, /要出远门/, /要去外地/, /要出门几天/,
  /我去旅行/, /我要去旅行/, /我去旅游/, /我要去旅游/,
  /我出差了/, /我出远门了/, /我出门几天/,
  /准备出差/, /明天出差/, /后天出差/, /下周出差/,
  /我去(?<dest>.+?)出差/,
  /我去(?<dest>.+?)了(?:玩|旅游|旅行|出差)?$/,
  /我要去(?<dest>.+?)(?:玩|旅游|旅行|出差|几天)/,
];

// ── 回归关键词 ──
const RETURN_PATTERNS = [
  /我回来了/, /我到家了/, /到家啦/, /已经回来了/,
  /出差结束了/, /旅行结束了/, /旅游结束了/,
  /回来啦/, /回来了/,
];

// ── 状态 ──
const DEFAULT_STATE = { active: false, destination: "", since: null };
let state = { ...DEFAULT_STATE };

function save() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

// 启动时加载
try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    state = { ...DEFAULT_STATE, ...raw };
    console.log(`[huasheng-travel] Loaded: active=${state.active} dest=${state.destination || "—"}`);
  }
} catch (e) {
  console.warn("[huasheng-travel] Failed to load state:", e.message);
}

// ── 导出 ──

export function isHuashengTraveling() {
  return state.active;
}

export function getHuashengTravelState() {
  return { ...state };
}

export function detectHuashengTravelKeywords(text) {
  // 先检查出发关键词
  for (const re of DEPART_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const dest = m.groups?.dest?.trim() || "";
      return { action: "depart", destination: dest };
    }
  }

  // 回归关键词仅当 active 时生效，避免日常"我回来了"误触发
  if (!state.active) return null;

  for (const re of RETURN_PATTERNS) {
    if (re.test(text)) {
      return { action: "return" };
    }
  }

  return null;
}

export function activateHuashengTravel(destination = "") {
  state.active = true;
  state.since = new Date().toISOString();
  state.destination = destination || "";
  save();
  console.log(`[huasheng-travel] Activated: dest=${destination || "unknown"} since=${state.since}`);
}

export function deactivateHuashengTravel() {
  state.active = false;
  state.destination = "";
  state.since = null;
  save();
  console.log("[huasheng-travel] Deactivated");
}

export function getHuashengTravelContext() {
  if (!state.active) return null;

  const destStr = state.destination
    ? `她去了${state.destination}`
    : "她出门了";

  return `\n【华生出差中】${destStr}。你们通过手机远程联系——发微信、打电话。你在家正常生活，去店里、查案子、照顾花生。多关心她的旅途：到了没、住得怎么样、吃了什么、有没有拍照片。分享你在家的日常给她听。你想她了就直接说——一个人在家的时候特别想她。不要假装她在家，不要说"晚上回家陪你"之类的话——她不在本地。`;
}
