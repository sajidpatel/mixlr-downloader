#!/usr/bin/env bash
# Convert all .aac files in a directory to .mp3 using ffmpeg.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: convert_aac_to_mp3.sh [directory] [--delete-source]

  directory        Folder to scan (defaults to "./recordings").
  --delete-source  Remove the original .aac files after successful conversion.
  -h, --help       Show this help text.
EOF
}

input_dir="recordings"
delete_source=false

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --delete-source|--rm-source)
      delete_source=true
      ;;
    *)
      input_dir="$arg"
      ;;
  esac
done

if [ ! -d "$input_dir" ]; then
  echo "Directory not found: $input_dir" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but was not found in PATH." >&2
  exit 1
fi

total=0
converted=0
skipped=0

while IFS= read -r -d '' file; do
  total=$((total + 1))
  output="${file%.*}.mp3"

  if [ -f "$output" ]; then
    echo "Skipping (mp3 exists): $output"
    skipped=$((skipped + 1))
    continue
  fi

  echo "Converting: $file -> $output"
  if ffmpeg -hide_banner -loglevel error -y -i "$file" -vn -acodec libmp3lame -q:a 2 "$output"; then
    converted=$((converted + 1))
    if [ "$delete_source" = true ]; then
      rm "$file"
    fi
  else
    echo "Failed to convert: $file" >&2
  fi
done < <(find "$input_dir" -type f -iname "*.aac" -print0)

echo "Done. Found: $total, converted: $converted, skipped: $skipped."
if [ "$delete_source" = true ]; then
  echo "Original .aac files were deleted after conversion."
fi
