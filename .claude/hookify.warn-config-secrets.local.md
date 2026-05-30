---
name: warn-hardcoded-config
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: config\.(js|ts|json)$
  - field: new_text
    operator: regex_match
    pattern: (password|secret|token|key)\s*[:=]\s*["']
---

⚙️ **敏感配置项出现在 config 文件中！**

config 文件里不要放密钥/密码，改用 `process.env.XXX || " defaultValue"` 模式，实际值在环境变量设。
