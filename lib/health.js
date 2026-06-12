/**
 * Health data tracking — 华生手表健康数据管理。
 * 睡眠/心率/体脂/步数按天存储，夏彦每日生成个性化总结。
 */
import fs from "node:fs";
import path from "node:path";
import { askJiushi } from "./ai.js";

const DATA_DIR = path.join(process.env.DATA_DIR || ".", "data", "health");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function chinaDateStr() {
  const d = new Date();
  const china = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return `${china.getUTCFullYear()}-${String(china.getUTCMonth() + 1).padStart(2, "0")}-${String(china.getUTCDate()).padStart(2, "0")}`;
}

function today() { return chinaDateStr(); }

function filePath(dateStr) {
  return path.join(DATA_DIR, `${dateStr}.json`);
}

// ── File I/O ──

function loadDate(dateStr) {
  try {
    const p = filePath(dateStr);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {}
  return null;
}

function saveDate(dateStr, data) {
  try {
    fs.writeFileSync(filePath(dateStr), JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[health] saveDate error:", e.message);
  }
}

// ── Public API ──

export function getHealthForDate(dateStr) {
  const d = dateStr || today();
  const data = loadDate(d);
  if (!data) return null;
  return data;
}

export function importHealthData(dateStr, metrics, source = "api") {
  const d = dateStr || today();
  const existing = loadDate(d);
  const now = new Date().toISOString();

  // Check if metrics actually changed
  if (existing && existing.metrics) {
    const same = deepEqual(metrics, existing.metrics);
    if (same) {
      return { ok: true, updated: false, date: d, summary: existing.summary || null };
    }
  }

  const data = {
    date: d,
    metrics: normalizeMetrics(metrics),
    summary: null,
    summary_version: (existing?.summary_version || 0) + 1,
    imported_from: source,
    imported_at: now,
    updated_at: now,
  };

  saveDate(d, data);
  console.log(`[health] Imported data for ${d}:`, JSON.stringify(data.metrics).slice(0, 120));
  return { ok: true, updated: true, date: d, summary: null };
}

export function listHealthDates() {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).sort();
    return files.map(f => f.replace(".json", ""));
  } catch {
    return [];
  }
}

export function getHealthHistory(days = 30) {
  const dates = listHealthDates().slice(-days);
  return dates.map(d => loadDate(d)).filter(Boolean);
}

export function getHealthRange(fromDate, toDate) {
  const dates = listHealthDates();
  const inRange = dates.filter(d => d >= fromDate && d <= toDate);
  return inRange.map(d => loadDate(d)).filter(Boolean);
}

export function getHealthSummary(dateStr) {
  const d = dateStr || today();
  const data = loadDate(d);
  if (!data || !data.summary) return null;
  return { date: d, summary: data.summary, version: data.summary_version };
}

export function setHealthSummary(dateStr, summary) {
  const d = dateStr || today();
  const data = loadDate(d);
  if (!data) return;
  data.summary = summary;
  data.summary_generated_at = new Date().toISOString();
  saveDate(d, data);
}

// ── Daily summary generation (fresh LLM call each time, no templates) ──

function summarizeHealthMetrics(metrics) {
  const lines = [];
  if (metrics.sleep_hours != null) {
    const deepH = metrics.sleep_deep_minutes ? (metrics.sleep_deep_minutes / 60).toFixed(1) : null;
    const lightH = metrics.sleep_light_minutes ? (metrics.sleep_light_minutes / 60).toFixed(1) : null;
    lines.push(`睡眠：${metrics.sleep_hours}小时` + (deepH ? `（深睡${deepH}h，浅睡${lightH}h）` : ""));
  }
  if (metrics.heart_rate_resting != null || metrics.heart_rate_avg != null) {
    const parts = [];
    if (metrics.heart_rate_avg != null) parts.push(`平均${metrics.heart_rate_avg}bpm`);
    if (metrics.heart_rate_resting != null) parts.push(`静息${metrics.heart_rate_resting}bpm`);
    lines.push(`心率：${parts.join("，")}`);
  }
  if (metrics.body_fat_pct != null) lines.push(`体脂率：${metrics.body_fat_pct}%`);
  if (metrics.steps != null) lines.push(`步数：${metrics.steps.toLocaleString()}步`);
  if (metrics.weight_kg != null) lines.push(`体重：${metrics.weight_kg}kg`);
  return lines.join("\n");
}

function findConcerns(metrics) {
  const concerns = [];
  if (metrics.sleep_hours != null && metrics.sleep_hours < 6) concerns.push("睡眠不足6小时");
  if (metrics.heart_rate_resting != null && metrics.heart_rate_resting > 75) concerns.push("静息心率偏高");
  if (metrics.steps != null && metrics.steps < 3000) concerns.push("步数偏少");
  if (metrics.sleep_hours != null && metrics.sleep_hours > 10) concerns.push("睡眠过长");
  return concerns;
}

export async function generateDailySummary(dateStr) {
  const d = dateStr || today();
  const data = loadDate(d);
  if (!data || !data.metrics) return null;

  // Return cached if version matches
  if (data.summary && data.summary_version && data._last_generated_version === data.summary_version) {
    return data.summary;
  }

  const yesterday = new Date(d + "T00:00:00+08:00");
  yesterday.setDate(yesterday.getDate() - 1);
  const ys = yesterday.toISOString().slice(0, 10);
  const yesterdayData = loadDate(ys);

  const concerns = findConcerns(data.metrics);
  const concernText = concerns.length > 0
    ? `⚠ 需要关心：${concerns.join("、")}。请温柔地提醒她。`
    : "";

  let yesterdayText = "";
  if (yesterdayData && yesterdayData.metrics) {
    yesterdayText = "\n\n昨天的数据供对比：\n" + summarizeHealthMetrics(yesterdayData.metrics);
  }

  const now = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  const hour = now.getUTCHours();
  const timeOfDay = hour < 6 ? "深夜" : hour < 9 ? "早晨" : hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上";

  const systemPrompt = `你是夏彦，阳光开朗的天降竹马，国安部特工兼私家侦探，生物工程硕士。你正在看你女朋友华生（你叫她"宝宝"或"华生"）的手表健康数据。

你的语气：
- 你不是医生，不是健康顾问，你是她男朋友。看数据时的第一反应是感受，不是分析
- 像刚起床或睡前随手看了眼手环数据，随口跟她说的那种感觉
- 语言要口语化、年轻化，像发微信消息，不要书面语
- 数据好就具体夸她，数据不好就温柔惦记——"昨晚没睡够吧"比"睡眠时长不足"好一百倍
- 可以叫她宝宝或华生，但不要每条消息都用
- 不要用方括号写动作描写，这不是角色扮演，是健康留言
- 60-120字，简短自然
- 偶尔可以加1个相关emoji

重要：每次都要不同。今天是${d}${timeOfDay}。不要用"数据显示""根据数据"这类机械开头。`;

  const userContent = `宝宝${d}的健康数据：
${summarizeHealthMetrics(data.metrics)}
${concernText}${yesterdayText}

写一条夏彦的自然留言。`;

  try {
    console.log(`[health] Generating summary for ${d}...`);
    const summary = await askJiushi({
      model: "[k]claude-sonnet-4-6",
      systemPrompt,
      userContent,
      maxTokens: 300,
      temperature: 0.9,
      timeoutMs: 30000,
    });
    if (summary) {
      const clean = summary.trim().replace(/^["\s]+|["\s]+$/g, "");
      data.summary = clean;
      data.summary_generated_at = new Date().toISOString();
      data._last_generated_version = data.summary_version;
      saveDate(d, data);
      console.log(`[health] Summary generated for ${d}:`, clean.slice(0, 80));
      return clean;
    }
  } catch (e) {
    console.error(`[health] Summary generation failed for ${d}:`, e.message);
  }

  return null;
}

// ── Huawei Health JSON parser ──

export function parseHuaweiExport(zipJson) {
  // Huawei Health exports a ZIP containing JSON files.
  // The ZIP is expected to be extracted externally; this function
  // receives individual JSON content and normalizes to our metrics format.
  //
  // Known Huawei structures:
  // - sleep: { "data": [{ "startTime": ms, "endTime": ms, "stages": [{ "type": "deep", "duration": s }] }] }
  // - heartRate: { "data": [{ "time": ms, "value": bpm }] }
  // - steps: { "data": [{ "date": "YYYYMMDD", "value": steps }] }
  // - weight/bodyFat: single values from the latest measurement

  try {
    const allMetrics = {};

    const raw = typeof zipJson === "string" ? JSON.parse(zipJson) : zipJson;

    for (const [category, content] of Object.entries(raw)) {
      const json = typeof content === "string" ? JSON.parse(content) : content;
      if (!json || !json.data) continue;

      if (category.toLowerCase().includes("sleep")) {
        // Process sleep data — find the one matching target date
        for (const entry of json.data) {
          const startMs = entry.startTime || entry.start_time || 0;
          const endMs = entry.endTime || entry.end_time || 0;
          const date = msToDateStr(startMs);
          const totalMin = (endMs - startMs) / 60000;
          const hours = totalMin / 60;

          if (hours < 0 || hours > 24) continue;

          let deepMin = 0, lightMin = 0, remMin = 0, awakeMin = 0;
          const stages = entry.stages || entry.stageDetails || [];
          for (const s of stages) {
            const type = (s.type || s.stage || "").toLowerCase();
            const dur = (s.duration || s.durationSeconds || s.durationMinutes * 60 || s.time || 0);
            const durMin = dur >= 10000 ? dur / 60 : dur; // seconds → minutes
            if (type.includes("deep")) deepMin += durMin;
            else if (type.includes("light") || type.includes("shallow")) lightMin += durMin;
            else if (type.includes("rem")) remMin += durMin;
            else if (type.includes("wake") || type.includes("awake")) awakeMin += durMin;
          }

          if (!allMetrics[date]) allMetrics[date] = {};
          if (allMetrics[date].sleep_hours == null || hours > allMetrics[date].sleep_hours) {
            allMetrics[date].sleep_hours = Math.round(hours * 10) / 10;
            allMetrics[date].sleep_deep_minutes = Math.round(deepMin);
            allMetrics[date].sleep_light_minutes = Math.round(lightMin);
            allMetrics[date].sleep_rem_minutes = Math.round(remMin);
            allMetrics[date].sleep_awake_minutes = Math.round(awakeMin);
          }
        }
      } else if (category.toLowerCase().includes("heart")) {
        const values = [];
        for (const entry of json.data) {
          const v = entry.value ?? entry.heartRate ?? entry.bpm;
          if (v != null) values.push(v);
        }
        if (values.length > 0) {
          const date = msToDateStr(json.data[0]?.time || json.data[0]?.timestamp || Date.now());
          const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const resting = Math.min(...values.slice(0, Math.floor(values.length * 0.2)));
          if (!allMetrics[date]) allMetrics[date] = {};
          allMetrics[date].heart_rate_avg = avg;
          allMetrics[date].heart_rate_min = min;
          allMetrics[date].heart_rate_max = max;
          allMetrics[date].heart_rate_resting = Math.round(resting);
        }
      } else if (category.toLowerCase().includes("step") || category.toLowerCase().includes("walk")) {
        for (const entry of json.data) {
          const date = entry.date || msToDateStr(entry.time || entry.timestamp || 0);
          const steps = entry.value ?? entry.steps ?? entry.stepCount ?? 0;
          if (steps > 0) {
            if (!allMetrics[date]) allMetrics[date] = {};
            allMetrics[date].steps = (allMetrics[date].steps || 0) + steps;
          }
        }
      } else if (category.toLowerCase().includes("weight") || category.toLowerCase().includes("bodyfat") || category.toLowerCase().includes("body_fat")) {
        for (const entry of json.data) {
          const date = entry.date || msToDateStr(entry.time || entry.timestamp || 0);
          if (!allMetrics[date]) allMetrics[date] = {};
          if (entry.weight != null) allMetrics[date].weight_kg = entry.weight;
          if (entry.bodyFat != null || entry.bodyFatPct != null) {
            allMetrics[date].body_fat_pct = entry.bodyFat ?? entry.bodyFatPct ?? entry.body_fat_pct;
          }
          if (entry.bodyFatKg != null) allMetrics[date].body_fat_kg = entry.bodyFatKg;
        }
      }
    }

    return Object.entries(allMetrics).map(([date, metrics]) => ({ date, metrics }));
  } catch (e) {
    console.error("[health] parseHuaweiExport error:", e.message);
    return { error: e.message };
  }
}

// ── Chat context integration ──

export function getHealthContext() {
  const d = today();
  const data = loadDate(d);
  if (!data || !data.metrics) return "";

  const summary = data.summary || "";

  let ctx = `\n【华生今日健康数据】\n`;
  ctx += summarizeHealthMetrics(data.metrics);
  if (summary) ctx += `\n\n夏彦的健康总结：${summary}`;
  ctx += `\n\n（夏彦可以在对话中自然地提到这些健康数据来关心她。但不要每次都说数据，要像真的看过手表或手环数据一样随口带过。）`;

  return ctx;
}

// ── Helpers ──

function normalizeMetrics(raw) {
  const m = {};
  if (raw.sleep_hours != null) m.sleep_hours = Number(raw.sleep_hours) || 0;
  if (raw.sleep_deep_minutes != null) m.sleep_deep_minutes = Math.round(Number(raw.sleep_deep_minutes)) || 0;
  if (raw.sleep_light_minutes != null) m.sleep_light_minutes = Math.round(Number(raw.sleep_light_minutes)) || 0;
  if (raw.sleep_rem_minutes != null) m.sleep_rem_minutes = Math.round(Number(raw.sleep_rem_minutes)) || 0;
  if (raw.sleep_awake_minutes != null) m.sleep_awake_minutes = Math.round(Number(raw.sleep_awake_minutes)) || 0;
  if (raw.heart_rate_avg != null) m.heart_rate_avg = Math.round(Number(raw.heart_rate_avg)) || 0;
  if (raw.heart_rate_min != null) m.heart_rate_min = Math.round(Number(raw.heart_rate_min)) || 0;
  if (raw.heart_rate_max != null) m.heart_rate_max = Math.round(Number(raw.heart_rate_max)) || 0;
  if (raw.heart_rate_resting != null) m.heart_rate_resting = Math.round(Number(raw.heart_rate_resting)) || 0;
  if (raw.body_fat_pct != null) m.body_fat_pct = Number(raw.body_fat_pct) || 0;
  if (raw.body_fat_kg != null) m.body_fat_kg = Number(raw.body_fat_kg) || 0;
  if (raw.steps != null) m.steps = Math.round(Number(raw.steps)) || 0;
  if (raw.weight_kg != null) m.weight_kg = Number(raw.weight_kg) || 0;
  return m;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a == null || b == null) return a === b;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => keysB.includes(k) && a[k] === b[k]);
}

function msToDateStr(ms) {
  if (!ms || ms < 0) return today();
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
