#!/usr/bin/env bash
# Health Hub data backup — nightly tar of the health data dir, off-boxed to R2.
# The data (food logs, workouts, weights, everything) otherwise lives ONLY in
# the Docker volume on this VPS. One disk failure = total loss without this.
set -euo pipefail
SRC="$HOME/.openclaw/workspace/health"
CONF="$HOME/.config/rclone/rclone.conf"
REMOTE="hh-r2:rclone-backups/health-hub"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="/tmp/hh-data-$STAMP.tgz"

[ -d "$SRC" ] || { echo "no data dir at $SRC"; exit 1; }
tar czf "$TMP" -C "$(dirname "$SRC")" "$(basename "$SRC")"
# local rolling copy too (belt + braces), keep last 14
mkdir -p "$HOME/hh-backups"; cp "$TMP" "$HOME/hh-backups/"; ls -1t "$HOME/hh-backups"/*.tgz | tail -n +15 | xargs -r rm -f
# off-box to R2, keep last 30
rclone copy "$TMP" "$REMOTE/" --config "$CONF"
rclone lsf "$REMOTE/" --config "$CONF" | sort | head -n -30 | while read -r f; do rclone deletefile "$REMOTE/$f" --config "$CONF"; done
rm -f "$TMP"
echo "OK backed up $STAMP -> R2 + ~/hh-backups"
