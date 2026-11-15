#!/usr/bin/env bash
# V look maps step with an adjustable worker count (Sumit, 30 Oct: V-3 on at least 3-4 cores). Runs the registered maps
# command with runs/v_workers_maps workers, in its own process group (PGID in runs/v_maps.pgid) so the memory guard can
# measure and stop it. If the guard stops it to lower the count (it leaves runs/v_maps_shrink), the command is rerun:
# finished frames are stored atomically and skipped on resume, so only frames in flight are refitted, identically.
# Usage: bash scripts/v_maps_step.sh <patch> <ra> <dec>
set -uo pipefail
cd "$(dirname "$0")/.."
p=$1; ra=$2; dec=$3
set -m  # background jobs get their own process group
while :; do
  rm -f runs/v_maps_shrink
  w=$(cat runs/v_workers_maps 2>/dev/null || echo 3)
  echo "== maps $p with $w workers $(date '+%a %H:%M:%S')"
  SMO_SOLVER=superlu uv run --extra ephem --extra fast python scripts/yardstick_run.py maps "$p" "runs/fetch_${p}.json" \
    "$ra" "$dec" "$w" &
  pg=$!; echo "$pg" > runs/v_maps.pgid
  wait "$pg"; rc=$?
  rm -f runs/v_maps.pgid
  [ -f runs/v_maps_shrink ] && { echo "== maps $p stopped by the memory guard; resuming with fewer workers"; continue; }
  exit "$rc"
done
