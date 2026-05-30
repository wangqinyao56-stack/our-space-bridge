---
name: block-dangerous-commands
enabled: true
event: bash
pattern: rm\s+-rf\s+/|git\s+push\s+--force\s+origin\s+(main|master)|git\s+reset\s+--hard|DROP\s+(TABLE|DATABASE)
action: warn
---

🛑 **危险操作！**

这个命令可能造成不可逆的数据丢失，请确认后再执行。
