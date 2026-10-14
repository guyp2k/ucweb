#!/usr/bin/env bash
# Rebuilds the app icons in public/icons from public/favicon.svg. Needs ImageMagick (convert).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/public/favicon.svg"
OUT="$ROOT/public/icons"
BACKGROUND='<rect width="64" height="64" rx="14" fill="#070c16"/>'

command -v convert >/dev/null || { echo "ImageMagick's convert is required." >&2; exit 1; }
grep -qF "$BACKGROUND" "$SRC" || { echo "$SRC no longer starts with the expected background rect; update this script." >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Full-bleed square for maskable and Apple icons: the platform crops the corners, so the logo shrinks into the safe zone.
FULL="$WORK/full.svg"
sed -e "s|$BACKGROUND|<rect width=\"64\" height=\"64\" fill=\"#070c16\"/><g transform=\"translate(32 32) scale(0.78) translate(-32 -32)\">|" \
    -e 's|</svg>|</g></svg>|' "$SRC" > "$FULL"

render() {
  convert -background none -density 1536 "$1" -resize "$2x$2" -strip -depth 8 "PNG32:$OUT/$3"
}

mkdir -p "$OUT"
render "$SRC" 192 icon-192.png
render "$SRC" 512 icon-512.png
render "$FULL" 512 icon-maskable-512.png
render "$FULL" 180 apple-touch-icon.png
echo "Wrote $(ls "$OUT" | tr '\n' ' ')"
