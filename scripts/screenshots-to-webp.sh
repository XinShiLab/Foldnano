#!/usr/bin/env sh
# Convert doc-site screenshots to lossless WebP and delete the source PNGs.
#   scripts/screenshots-to-webp.sh          -> every PNG under static/screenshots/
#   scripts/screenshots-to-webp.sh a.png …  -> only the given files
# Requires cwebp (macOS: brew install webp). Lossless keeps UI text sharp; color profiles are
# dropped so every screenshot renders as plain sRGB. Update the guide's image links to .webp.
set -eu

command -v cwebp >/dev/null 2>&1 || {
	echo "cwebp not found; install it with: brew install webp" >&2
	exit 1
}

if [ "$#" -eq 0 ]; then
	set -- $(find static/screenshots -name '*.png')
fi
[ "$#" -eq 0 ] && { echo "No PNG screenshots to convert."; exit 0; }

for png in "$@"; do
	webp="${png%.png}.webp"
	cwebp -quiet -lossless -z 9 -metadata none "$png" -o "$webp"
	rm "$png"
	echo "$webp"
done
