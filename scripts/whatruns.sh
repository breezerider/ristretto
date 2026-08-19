#!/usr/bin/env bash
# Which ristretto is Claude Code actually executing, and is it the one you are editing?
#
# The plugin does not run from your working tree. A marketplace clone is fetched from the git
# remote, a copy of that clone is what the hooks and commands execute, and neither knows your
# checkout exists. So an unpushed fix cannot reach the thing being tested: you edit, re-run, and
# get the identical failure — not because the fix was wrong, but because it was never loaded.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INST="$HOME/.claude/plugins/installed_plugins.json"
RUNNING=$(node -e '
  const fs = require("fs");
  const db = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const key = Object.keys(db.plugins || {}).find((k) => k.startsWith("ristretto@"));
  const entry = key && (db.plugins[key] || [])[0];
  process.stdout.write(entry ? entry.installPath : "");
' "$INST" 2>/dev/null)

[ -z "$RUNNING" ] && { echo "ristretto is not installed as a plugin — nothing to compare."; exit 0; }
echo "running:  $RUNNING"
echo "editing:  $ROOT"
DRIFT=$(diff -rq --strip-trailing-cr "$RUNNING" "$ROOT" 2>/dev/null \
  | grep -vE '\.git|\.idea|\.playwright|\.in_use|docs: superpowers')
if [ -z "$DRIFT" ]; then
  echo "IN SYNC — what runs is what you are editing."
else
  echo "$DRIFT"
  echo
  echo ">>> DRIFT. The plugin being executed is NOT your working tree."
  echo ">>> Push to the marketplace remote and let it update, or you will debug a fix that never loaded."
fi
