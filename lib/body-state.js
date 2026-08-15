/**
 * 身体状态引擎（Eventide/Tidefall 思路的 7 驱动力模型）。
 * 把向哨游戏里散落的同步率/感官负荷/屏障/失控/精神力/污染/体力，统一成带推导与阈值判定的身体状态。
 * 读多写少：deriveFrenzy 只用于推导与提示，不改动游戏里手动控制的 sentinelFrenzy（避免破坏商店针剂/剧情）。
 */

const DRIVE_DEFS = [
  { key: "syncRate", label: "同步率" },
  { key: "senseOverload", label: "感官负荷" },
  { key: "barrier", label: "精神屏障" },
  { key: "mental", label: "精神力" },
  { key: "contamination", label: "精神污染" },
  { key: "stamina", label: "体力" },
];

function read(state) {
  return {
    syncRate: state.sentinel?.syncRate ?? 85,
    senseOverload: state.sentinel?.senseOverload ?? 5,
    barrier: state.sentinel?.barrierStrength ?? 95,
    mental: state.player?.mentalState ?? 90,
    contamination: state.player?.contamination ?? 0,
    stamina: state.xiayanBaseStats?.体力 ?? 110,
  };
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * 失控度（派生）：感官负荷 + 精神污染 累积，精神屏障 抑制。
 * 这是"身体状态"意义上的失控趋势，不覆盖 sentinelFrenzy 字段。
 */
export function deriveFrenzy(d) {
  const raw = d.senseOverload * 0.55 + d.contamination * 0.45 - d.barrier * 0.25;
  return clamp(raw);
}

/**
 * 身体状态摘要：统一展示 7 驱动力 + 阈值判定。
 * 返回的文本可直接注入 buildContextBlock。
 */
export function summary(state) {
  const d = read(state);
  const frenzy = clamp(state.sentinelFrenzy ?? deriveFrenzy(d));
  const derived = deriveFrenzy(d);

  let s = `[身体状态] 同步率:${clamp(d.syncRate)}% 感官负荷:${clamp(d.senseOverload)}% 屏障:${clamp(d.barrier)}% 精神力:${clamp(d.mental)}% 污染:${clamp(d.contamination)}% 体力:${clamp(d.stamina)}% 失控度:${frenzy}%\n`;

  const flags = [];
  if (frenzy >= 70) flags.push("⚠️ 失控临界——夏彦感官濒临崩溃，行为会失控化");
  else if (frenzy >= 40) flags.push("夏彦感官紧绷，随时可能失控，需要华生的安抚/镇定");
  if (d.senseOverload >= 60) flags.push("感官负荷过高，急需净化或安全屋休息");
  if (d.contamination >= 40) flags.push("精神污染累积，夏彦的精神在被侵蚀");
  if (d.barrier <= 40) flags.push("精神屏障薄弱，防御脆弱");
  if (d.stamina <= 30) flags.push("体力见底，需要休整");
  if (derived >= 15 && Math.abs(derived - frenzy) >= 20) {
    flags.push(`失控趋势${derived > frenzy ? "上升" : "缓解"}中（身体状态推导值 ${derived}%，当前 ${frenzy}%）`);
  }

  if (flags.length) s += `[身体状态判定] ${flags.join("；")}\n`;
  return s;
}

export { DRIVE_DEFS, read };
