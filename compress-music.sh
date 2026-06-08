#!/bin/bash
# Compress HOYO-MiX music files for cloud serving.
# Converts to 96kbps mono AAC (.m4a) — small, good quality for background music.
#
# Usage: bash compress-music.sh
# Output: ./compressed/ directory with .m4a files

INPUT_DIR="H:/未定素材/未定音乐"
OUTPUT_DIR="./compressed"

mkdir -p "$OUTPUT_DIR"

echo "Compressing HOYO-MiX files from $INPUT_DIR..."
count=0
total=0

for f in "$INPUT_DIR"/HOYO-MiX*.mp3; do
  [ -e "$f" ] || continue
  base=$(basename "$f" .mp3)
  out="$OUTPUT_DIR/${base}.m4a"
  if [ -f "$out" ]; then
    echo "  SKIP: $base (already exists)"
    continue
  fi
  echo "  [$((++count))] $base"
  ffmpeg -y -loglevel error -i "$f" \
    -c:a aac -b:a 96k -ac 1 -ar 44100 \
    "$out"
  size_in=$(stat -c%s "$f" 2>/dev/null || echo 0)
  size_out=$(stat -c%s "$out" 2>/dev/null || echo 0)
  echo "    $(numfmt --to=iec $size_in 2>/dev/null || echo $size_in) -> $(numfmt --to=iec $size_out 2>/dev/null || echo $size_out)"
  total=$((total + 1))
done

echo ""
echo "Done! Compressed $total files to $OUTPUT_DIR/"
du -sh "$OUTPUT_DIR"
