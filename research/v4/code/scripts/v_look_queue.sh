#!/usr/bin/env bash
# First V look (prereg/V_LOOK_1.md): frozen v4 on V-1..V-3. Each finished step leaves runs/v_done/<tag>, so the queue
# can be restarted. Waits while free disk < 5 GB or swap > 6 GB. Worker count read from runs/v_workers at each step.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p runs/v_done
wk() { cat runs/v_workers 2>/dev/null || echo 2; }  # detection
psub() { cat runs/v_plan_subprocess 2>/dev/null || echo 0; }  # 1: injection plan in a child process (memory only; V_LOOK_1 A4)
step() { local tag="$1"; shift; [ -f "runs/v_done/$tag" ] && return 0
  local free_gb swap_mb
  free_gb=$(df -g . | awk 'NR==2 {print $4}')
  swap_mb=$(sysctl -n vm.swapusage | awk '{for (i = 1; i <= NF; i++) if ($i == "used") {gsub("M", "", $(i + 2)); print int($(i + 2))}}')
  while [ "$free_gb" -lt 5 ] || [ "$swap_mb" -gt 6000 ]; do
    echo "== waiting before $tag: ${free_gb} GB free, ${swap_mb} MB swap used ($(date '+%H:%M'))"; sleep 600
    free_gb=$(df -g . | awk 'NR==2 {print $4}')
    swap_mb=$(sysctl -n vm.swapusage | awk '{for (i = 1; i <= NF; i++) if ($i == "used") {gsub("M", "", $(i + 2)); print int($(i + 2))}}')
  done
  echo "== $tag $(date '+%H:%M:%S')"; if "$@"; then touch "runs/v_done/$tag"; else echo "== FAILED: $tag"; return 1; fi; }
coords() { awk -F, -v n="$1" '$1==n {print $2, $3}' prereg/patches.csv; }
V="${V_PATCHES:-V-1 V-2 V-3}"  # V-3 held (V_LOOK_1 A3): V_PATCHES="V-1 V-2"
for p in $V; do  # method-independent preparation; refetch must have verified every file
  python3 -c "import json,sys; r=json.load(open('runs/yardstick/$p/refetch.json')); sys.exit(0 if r['verified']==r['n'] and r['kept'] else 1)" \
    || { echo "== $p: refetch not fully verified; skipping"; continue; }
  read -r ra dec < <(coords $p)
  step "${p}_maps" bash -c "bash scripts/v_maps_step.sh $p $ra $dec > runs/v_${p}_maps.log 2>&1"  # same command; workers adjustable
  step "${p}_areas" bash -c "uv run python scripts/save_map_areas.py $p > runs/v_${p}_areas.log 2>&1"
  step "${p}_static" bash -c "uv run python scripts/v1_static.py $p $ra $dec > runs/v_${p}_static.log 2>&1"
  step "${p}_known" bash -c "RAYON_NUM_THREADS=2 uv run --extra ephem python scripts/yardstick_known.py $p runs/fetch_${p}.json > runs/v_${p}_known.log 2>&1"
done
for mode in real 0 scramble_guard0 1; do
  for p in $V; do
    [ -f "runs/v_done/${p}_static" ] || continue
    read -r ra dec < <(coords $p)
    step "${p}_v4_${mode}" bash -c "SMO_PLAN_SUBPROCESS=$(psub) SMO_METHOD=v4 SMO_STORE_MIN_SCORE=3 SMO_ALLOW_MAP_FAILURES=1 uv run --extra ephem python scripts/yardstick_run.py detect $p runs/fetch_${p}.json $ra $dec $mode $(wk) > runs/v_${p}_v4_${mode}.log 2>&1"
  done
done
echo "== V look queue complete $(date '+%H:%M:%S')"
