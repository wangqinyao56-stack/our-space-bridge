import crypto from "node:crypto";
import config from "../config.js";

const TOKENS = new Map(); // token → expiry

export function verifyAuth(token) {
  if (token === config.SHARED_SECRET) return true;
  // Check session token
  const expiry = TOKENS.get(token);
  if (expiry && expiry > Date.now()) return true;
  return false;
}

export function createSessionToken() {
  const token = crypto.randomBytes(32).toString("hex");
  TOKENS.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24h expiry
  // Clean old tokens
  if (TOKENS.size > 100) {
    const now = Date.now();
    for (const [k, v] of TOKENS) {
      if (v < now) TOKENS.delete(k);
    }
  }
  return token;
}
