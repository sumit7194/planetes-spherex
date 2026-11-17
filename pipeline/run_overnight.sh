#!/bin/zsh
# Fake-mover run, overnight 15-16 Nov (PLAN §8). Reads through the helper's own code run on this Mac
# (cloud/live/wrangler.batch.toml), not the hosted helper, so the live site keeps Cloudflare's free
# daily requests (Sumit, 22:15 IST). One local helper per worker, restarted with a fresh state folder
# for each field (the Cache API's local copies would otherwise fill the disk).
#  1. identity check on the 4 SIA-done fields (Physics' rule: stack counts, pixels, flags, truth IDs);
#     results appended to PLAN §8; any difference stops here;
#  2. the remaining fields from the sky index (ROWS_FROM=index, margin -0.05 deg), $WORKERS workers,
#     up to 3 rounds (a field with a helper error is retried);
#  3. the E1 extension the same way.
# Usage: WORKERS=4 ./run_overnight.sh   (log: yardstick_overnight.log; per-field logs night_*.log)
cd "$(dirname "$0")"
W=${WORKERS:-1}
ROOT=$PWD/..
STATE=${TMPDIR:-/tmp}/planetes-batch-helper
log() { echo "$(date '+%d %b %H:%M:%S') $*"; }

start_helper() {  # $1 = slot; echoes the URL once it answers. Own HTTP and inspector ports per slot,
  # up to 3 attempts, each waiting up to 90 s for the ready check (Physics, 16 Nov 01:02: a parallel
  # start failed on a shared inspector socket and a leftover test instance).
  local port=$((8790 + $1)) insp=$((9300 + $1)) dir=$STATE/w$1 attempt
  for attempt in 1 2 3; do
    stop_helper $1
    mkdir -p $dir
    (cd $ROOT/cloud/live && exec npx --no-install wrangler dev --local --ip 127.0.0.1 --port $port \
        --inspector-port $insp --config wrangler.batch.toml --persist-to $dir --log-level warn) \
        >> $STATE/w$1.log 2>&1 &
    for _ in {1..90}; do
      curl -s -o /dev/null -m 2 http://127.0.0.1:$port/ && { echo http://127.0.0.1:$port; return 0; }
      sleep 1
    done
    echo "$(date '+%H:%M:%S') slot $1 start attempt $attempt failed" >> $STATE/w$1.log
    sleep $((5 * attempt))
  done
  return 1
}
stop_helper() {  # $1 = slot: the whole tree (npm, node, workerd), then the folder
  local port=$((8790 + $1))
  pkill -f -- "--port $port --inspector-port" 2>/dev/null
  pkill -f -- "socket-addr=entry=127.0.0.1:$port" 2>/dev/null
  sleep 1
  pkill -9 -f -- "--port $port --inspector-port" 2>/dev/null
  pkill -9 -f -- "socket-addr=entry=127.0.0.1:$port" 2>/dev/null
  rm -rf $STATE/w$1
}
trap 'for i in {0..9}; do stop_helper $i; done' EXIT

one_field() {  # $1 = slot, $2 = field index, $3 = "" or E1, $4 = output dir
  local url; url=$(start_helper $1) || { log "slot $1: local helper did not start"; return 1; }
  HELPER_URL=$url ROWS_FROM=index GAIA_SOURCE=vizier W2_SYSTEM=wise YARD_EXT=$3 \
    .venv/bin/python -W ignore yardstick_inject.py --first $2 --count 1 >> $4/night_w$1.log 2>&1
  stop_helper $1
}

run_set() {  # $1 = "" or E1, $2 = output dir
  mkdir -p $2
  for round in 1 2 3; do
    todo=()
    for i in {0..39}; do
      f=$(.venv/bin/python -c "import json;print(json.load(open('../prereg/slowmover/fields_dev.json'))[$i]['field'])")
      [ -f $2/$f/run.json ] || todo+=($i)
    done
    [ ${#todo} -eq 0 ] && break
    log "${1:-registered} round $round: ${#todo} fields to do, $W workers"
    for ((s = 0; s < W; s++)); do
      ( sleep $((10 * s)); for ((k = s + 1; k <= ${#todo}; k += W)); do one_field $s ${todo[$k]} "$1" $2; done ) &
    done
    wait
    log "${1:-registered} round $round end ($(ls $2/*/run.json 2>/dev/null | wc -l | tr -d ' ')/40 done)"
  done
}

mkdir -p $STATE
# One field at a time: from this Mac, two or more local helpers at once share one network
# bottleneck and time out (16 Nov 04:30 probe); one helper at READ_CONC=24 reads cleanly.
export READ_CONC=${READ_CONC:-24}
log "identity check (one local helper, index lists at -0.05 deg, READ_CONC=$READ_CONC), one field at a time"
ok=0
for f in ${=IDENTITY_FIELDS:-Y-01 Y-12 Y-15 Y-27}; do
  for try in 1 2; do  # a helper error (not a difference) gets one more try
    url=$(start_helper 0) || { echo "$f: local helper did not start" > identity_$f.txt; continue; }
    HELPER_URL=$url GAIA_SOURCE=vizier W2_SYSTEM=wise .venv/bin/python -W ignore yardstick_identity.py $f > identity_$f.txt 2>&1
    stop_helper 0
    grep -q "helper error\|did not start\|could be read" identity_$f.txt || break
    log "$f: helper trouble, try $try"
  done
  log "$(head -1 identity_$f.txt | cut -c1-200)"
done
cat identity_Y-01.txt identity_Y-12.txt identity_Y-15.txt identity_Y-27.txt > identity_overnight.txt
# All four must be IDENTICAL on file (a field checked in an earlier attempt keeps its result).
for f in Y-01 Y-12 Y-15 Y-27; do grep -q "^$f: .*IDENTICAL$" identity_$f.txt || ok=1; done
cat identity_overnight.txt
# The 4 fields' results go into PLAN §8 before any new field runs (Physics' condition 2).
{
  echo "  - **$(date '+%d %b %Y, %H:%M') IST — identity check (the helper's code on this Mac, index lists at -0.05 deg): $([ $ok -eq 0 ] && echo 'PASSED, the run continues' || echo 'FAILED, the run stopped').**"
  grep -v "^ *[0-9.]* *\(real\|user\|sys\)" identity_overnight.txt | sed 's/^/    /'
} >> ../prereg/slowmover/PLAN.md
if [ $ok -ne 0 ]; then
  log "IDENTITY CHECK FAILED: stopped before any new field (Physics' rule)"
  exit 1
fi
log "identity check passed"
run_set "" yardstick_inject
run_set E1 yardstick_inject_e1
log "all done"
