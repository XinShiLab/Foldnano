#!/usr/bin/env sh
# Lint only files changed in the working tree (default) or since a base ref.
#   scripts/lint-changed.sh          -> uncommitted changes vs HEAD (+ untracked)
#   scripts/lint-changed.sh main     -> all branch changes vs merge-base(main) (+ untracked)
# Prettier checks every supported file; ESLint runs on the .ts/.svelte/.js subset.
set -eu

BASE="${1:-}"
if [ -n "$BASE" ]; then
	DIFF_FROM="$(git merge-base "$BASE" HEAD)"
else
	DIFF_FROM="HEAD"
fi

# --diff-filter=ACMR: added/copied/modified/renamed only (skip deletions).
{
	git diff --name-only --diff-filter=ACMR "$DIFF_FROM"
	git ls-files --others --exclude-standard
} | sort -u >/tmp/.lint-changed-all

PRETTIER_FILES="$(grep -E '\.(ts|svelte|js|css|html|json|md)$' /tmp/.lint-changed-all || true)"
if [ -z "$PRETTIER_FILES" ]; then
	echo "lint-changed: no changed files to lint."
	exit 0
fi

echo "lint-changed: prettier --check"
printf '%s\n' "$PRETTIER_FILES" | tr '\n' '\0' | xargs -0 prettier --check

ESLINT_FILES="$(printf '%s\n' "$PRETTIER_FILES" | grep -E '\.(ts|svelte|js)$' || true)"
if [ -n "$ESLINT_FILES" ]; then
	echo "lint-changed: eslint"
	printf '%s\n' "$ESLINT_FILES" | tr '\n' '\0' | xargs -0 eslint
fi
