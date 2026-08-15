/**
 * Hindsight 记忆系统适配层（vectorize-io/hindsight）。
 * 长期记忆：实体解析 + 时间推理 + 反思，LongMemEval SOTA。
 * 优雅降级：HINDSIGHT_URL 未配置或服务不可达时全部返回空，回退到 Ombre-Brain(emotional-memory.js)。
 */
import { HindsightClient } from "@vectorize-io/hindsight-client";
import config from "../config.js";

const BANK_ID = "xiayan-huasheng";
const TIMEOUT_MS = 4000; // 读写超时，防止 Hindsight 卡住阻塞机器人主流程

let client = null;
let bankReady = false;

function getClient() {
  const url = config.HINDSIGHT_URL || process.env.HINDSIGHT_URL;
  if (!url) return null;
  if (!client) {
    try {
      client = new HindsightClient({ baseUrl: url });
      console.log(`[hindsight] client -> ${url}`);
    } catch (e) {
      console.error("[hindsight] client init failed:", e.message);
      client = null;
    }
  }
  return client;
}

function withTimeout(ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** 建记忆仓（幂等，仅首次成功执行一次） */
async function ensureBank() {
  const c = getClient();
  if (!c || bankReady) return !!c;
  try {
    const t = withTimeout(8000);
    await c.createBank(BANK_ID, {
      name: "夏彦与华生",
      background: "华生是夏彦的青梅竹马兼恋人。这里记着华生的一切：喜好、习惯、情绪、说过的重要的话、关系里程碑。",
      reflectMission: "记住华生的喜好/习惯/情绪/承诺/关系节点，在合适的时候自然地想起并回应，而不是复述。",
      signal: t.signal,
    });
    t.clear();
    bankReady = true;
    console.log("[hindsight] bank ready:", BANK_ID);
  } catch (e) {
    console.error("[hindsight] createBank failed:", e.message);
  }
  return bankReady;
}

/** 写入一条长期记忆。失败静默返回 false（不打断主流程）。 */
export async function retainMemory(content, opts = {}) {
  const c = getClient();
  if (!c) return false;
  try {
    await ensureBank();
    const t = withTimeout();
    await c.retain(BANK_ID, content, {
      timestamp: opts.timestamp ? new Date(opts.timestamp) : new Date(),
      context: opts.context,
      metadata: opts.metadata,
      signal: t.signal,
    });
    t.clear();
    return true;
  } catch (e) {
    console.error("[hindsight] retain failed:", e.message);
    return false;
  }
}

/** 根据查询召回相关记忆，返回可直接注入 prompt 的上下文块。无结果/失败返回空串。 */
export async function recallContext(query, maxTokens = 500) {
  const c = getClient();
  if (!c || !query) return "";
  try {
    await ensureBank();
    const t = withTimeout();
    const resp = await c.recall(BANK_ID, query, { maxTokens, budget: "low", signal: t.signal });
    t.clear();
    const lines = (resp?.results || []).map((r) => r?.text).filter(Boolean);
    if (!lines.length) return "";
    return `\n\n[长期记忆·你记得]\n${lines.map((t) => `· ${t}`).join("\n")}`;
  } catch (e) {
    console.error("[hindsight] recall failed:", e.message);
    return "";
  }
}

/** 让 Hindsight 基于记忆给一个反思性回答。失败返回空串。 */
export async function reflectContext(query) {
  const c = getClient();
  if (!c || !query) return "";
  try {
    await ensureBank();
    const t = withTimeout(10000);
    const resp = await c.reflect(BANK_ID, query, { budget: "low", signal: t.signal });
    t.clear();
    return resp?.text || "";
  } catch (e) {
    console.error("[hindsight] reflect failed:", e.message);
    return "";
  }
}
