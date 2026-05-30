---
name: warn-api-key-in-code
enabled: true
event: file
action: warn
pattern: (sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|gsk_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,})
---

🔐 **API Key 出现在代码中！**

不要把 API Key 硬编码进源代码。改用环境变量（如 `process.env.XYZ_API_KEY`），在 Railway / .env 设置实际值。
