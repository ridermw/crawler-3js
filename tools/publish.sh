#!/bin/sh
# Publish the playable site (no reference art or validation artifacts) to the gh-pages branch.
# Run only after tools/fidelity/playtest.mjs and playtest-mobile.mjs pass.
set -e
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
SHA=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
git worktree add --detach "$TMP" >/dev/null 2>&1
cd "$TMP"
git checkout --orphan gh-pages-new >/dev/null 2>&1
git rm -rfq . >/dev/null
git -C "$ROOT" archive HEAD index.html style.css src .nojekyll | tar -x -C "$TMP"
printf '# The Ashen Reliquary\n\nPublished build of [ridermw/crawler-3js@%s](https://github.com/ridermw/crawler-3js/tree/%s).\n' "$SHA" "$SHA" > README.md
git add -A && git commit -qm "Publish $SHA"
git branch -D gh-pages >/dev/null 2>&1 || true
git branch -m gh-pages
cd "$ROOT"; git worktree remove --force "$TMP"
echo "gh-pages now holds $SHA; push with: git push -f origin gh-pages"
