import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  PORT: process.env.PORT || 3456,
  HOST: "0.0.0.0",
  SHARED_SECRET: process.env.OUR_SPACE_SECRET || "our-space-default-secret-change-me",
  USE_PROXY: process.env.USE_PROXY || false,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  BFL_API_KEY: process.env.BFL_API_KEY || "",
  ARK_API_KEY: process.env.ARK_API_KEY || "",
  SYSTEM_PROMPT_PATH: join(__dirname, "system-prompt.md"),
  DAILY_PROMPT_PATH: join(__dirname, "system-prompt-daily.md"),
  INTIMATE_PROMPT_PATH: join(__dirname, "system-prompt-intimate.md"),
  TRAVEL_PROMPT_PATH: join(__dirname, "system-prompt-travel.md"),
  TRAVEL_INTIMATE_PROMPT_PATH: join(__dirname, "system-prompt-travel-intimate.md"),
  HUASHENG_TRAVEL_PROMPT_PATH: join(__dirname, "system-prompt-huasheng-travel.md"),
  AFFECTION_HOME_PROMPT_PATH: join(__dirname, "system-prompt-affection-home.md"),
  AFFECTION_DATE_PROMPT_PATH: join(__dirname, "system-prompt-affection-date.md"),
  COUPLE_TRAVEL_PROMPT_PATH: join(__dirname, "system-prompt-couple-travel.md"),
  BLINDBOX_PROMPT_PATH: join(__dirname, "system-prompt-blindbox.md"),
  SENTINEL_PROMPT_PATH: join(__dirname, "system-prompt-sentinel.md"),
  SENTINEL_SFW_PROMPT_PATH: join(__dirname, "system-prompt-sentinel-sfw.md"),
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "sk_15dffb4b4bfcaf5d6b0db47ef7564f7fc1ad98a42dffa6cd",
  ELEVENLABS_VOICE_ID: "O2p1C2KJhMzz7EMpXHdN",
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
