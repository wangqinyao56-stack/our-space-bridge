#!/bin/bash
# Deploy script for our-space-bridge
# Fetches current chat data from running server, saves to data/, commits and pushes.
# Usage: bash deploy.sh

set -e

SERVER_URL="https://our-space-bridge-production.up.railway.app"
SECRET="${OUR_SPACE_SECRET:-our-space-default-secret-change-me}"
DATA_DIR="$(dirname "$0")/data"

echo "[deploy] Fetching data from running server..."
EXPORT=$(curl -sf -H "Authorization: Bearer $SECRET" "$SERVER_URL/api/admin/export" 2>&1) || true

if echo "$EXPORT" | jq -e '.chat' > /dev/null 2>&1; then
  echo "$EXPORT" | jq '.chat' > "$DATA_DIR/chat-memory.json"
  echo "$EXPORT" | jq '.intimate' > "$DATA_DIR/intimate-memory.json"
  echo "[deploy] Data saved: $(cat "$DATA_DIR/chat-memory.json" | jq 'length') chat msgs, $(cat "$DATA_DIR/intimate-memory.json" | jq 'length') intimate msgs"
else
  echo "[deploy] Warning: Could not fetch data from server (server may be down or old version)"
fi

echo "[deploy] Committing and pushing..."
git add data/ server.js lib/memory.js lib/intimate-memory.js
git diff --cached --quiet || git commit -m "backup: sync chat data before deploy $(date +%Y-%m-%d_%H:%M)"
git push origin main

echo "[deploy] Done! Railway will auto-deploy from GitHub."
