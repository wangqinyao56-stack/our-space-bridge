#!/bin/sh
# Copy static assets to persistent data volume (only if not already present)
# This ensures audio/video files survive container restarts while the volume persists

ASSET_DIR="/data/audio"
APP_ASSET_DIR="/app/data/audio"

if [ -d "$APP_ASSET_DIR" ]; then
  mkdir -p "$ASSET_DIR"
  # Copy files that don't already exist in the target
  for src in "$APP_ASSET_DIR"/*/; do
    dirname=$(basename "$src")
    mkdir -p "$ASSET_DIR/$dirname"
    for f in "$src"*; do
      [ -f "$f" ] || continue
      fn=$(basename "$f")
      if [ ! -f "$ASSET_DIR/$dirname/$fn" ]; then
        cp "$f" "$ASSET_DIR/$dirname/"
      fi
    done
  done
  echo "[entrypoint] Audio assets synced to $ASSET_DIR"
fi

# Copy reading txt books (打镜像的阅读书库) to persistent volume
READING_SRC="/app/data/reading-txt"
READING_DST="/data/reading-txt"
if [ -d "$READING_SRC" ]; then
  mkdir -p "$READING_DST"
  for f in "$READING_SRC"/*.txt; do
    [ -f "$f" ] || continue
    fn=$(basename "$f")
    if [ ! -f "$READING_DST/$fn" ]; then
      cp "$f" "$READING_DST/"
    fi
  done
  echo "[entrypoint] Reading txt books synced to $READING_DST"
fi

exec node server.js
