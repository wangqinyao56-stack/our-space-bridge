import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  PORT: process.env.PORT || 3456,
  HOST: "0.0.0.0",
  SHARED_SECRET: process.env.OUR_SPACE_SECRET || "our-space-default-secret-change-me",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "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",
  SYSTEM_PROMPT_PATH: join(__dirname, "system-prompt.md"),
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "sk_15dffb4b4bfcaf5d6b0db47ef7564f7fc1ad98a42dffa6cd",
  ELEVENLABS_VOICE_ID: "1Z7sIyndBVWMBmD0EmY7",
  TTS: {
    MAX_QUEUE_DEPTH: 10,
  },
  PROACTIVE: {
    ENABLED: true,
    INACTIVITY_MINUTES: 120,
  },
  HISTORY: {
    MAX_MESSAGES: 200,
  },
};
