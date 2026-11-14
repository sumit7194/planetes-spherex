"""The homepage band's data: one small file instead of the five packs' manifests (~845 kB).

Writes public/data/band/band.json:
  targets: {id: [[mjd, lambdaUm, detector], ...]}   every pack photo, from the same manifests the
                                                      shows use, so the two can't disagree
  weeks:   [{start, end, label}]                      the coverage's planning weeks
  survey:  {passes: {1|2|3: {fraction, firstWeek}}, line, lastWeek, releaseSeamMjd}
           Passes per nside-16 cell (Physics' rule, 14 Nov): a new pass starts after a gap of more
           than 60 days; a cell with no such gap over more than half a year (near the ecliptic
           poles, watched on every orbit) counts one pass per six months of its span. "The whole
           sky" is said only at >= 99%. The line names the data, not the mission: releases lag the
           telescope.

Usage: python build_band.py
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent.parent / "public" / "data"
FIVE = ["barnard", "w0855", "epsind-b", "rw-aur", "r-dra"]
QR3_START_MJD = 61174.5  # IRSA TAP, 13 Nov 2026 (src/app/targets.ts)


def coverage():
    meta = json.loads((ROOT / "coverage" / "dr1qr3" / "weeks.json").read_text())
    b = (ROOT / "coverage" / "dr1qr3" / "weekly.bin").read_bytes()
    assert b[:4] == b"PXW1"
    nside, weeks, npix = struct.unpack("<III", b[4:16])
    cov = np.frombuffer(b, "<u2", weeks * npix, 16).reshape(weeks, npix) > 0
    return meta, cov


def passes_by_week(meta, cov) -> np.ndarray:
    """passes[k, p]: passes over cell p by the end of week k."""
    mid = np.array([(w["startMjd"] + w["endMjd"]) / 2 for w in meta["weeks"]])
    weeks, npix = cov.shape
    out = np.zeros((weeks, npix), int)
    for p in range(npix):
        ks = np.nonzero(cov[:, p])[0]
        if not len(ks):
            continue
        t = mid[ks]
        gaps = np.diff(t)
        continuous = (len(gaps) == 0 or gaps.max() <= 60) and (t[-1] - t[0]) > 182
        n, last = 0, -1e9
        for k in range(weeks):
            if cov[k, p]:
                if continuous:
                    n = 1 + int((mid[k] - t[0]) // 182.6)
                elif mid[k] - last > 60:
                    n += 1
                last = mid[k]
            out[k, p] = n
    return out


def survey_line(fr: dict) -> str:
    """e.g. "In the data released so far (DR1 + QR3): the whole sky photographed twice, and over 96%
    of it a third time." The deepest pass done (>= 99%) leads; the next one follows if begun."""
    times = {1: "once", 2: "twice", 3: "three times"}
    again = {2: "twice", 3: "a third time"}
    done = [n for n in (1, 2, 3) if fr[n]["fraction"] >= 0.99]
    top = max(done) if done else 0
    parts = [f"the whole sky photographed {times[top]}"] if top else []
    nxt = top + 1
    if nxt <= 3 and fr[nxt]["fraction"] >= 0.01:
        pct = int(fr[nxt]["fraction"] * 100)
        parts.append(f"and over {pct}% of it {again[nxt]}" if top else f"{pct}% of the sky photographed once")
    if not parts:
        return "In the data released so far (DR1 + QR3): under 1% of the sky photographed."
    return "In the data released so far (DR1 + QR3): " + ", ".join(parts) + "."


def main():
    meta, cov = coverage()
    pw = passes_by_week(meta, cov)
    fr = {}
    for n in (1, 2, 3):
        f = (pw >= n).mean(axis=1)
        first = next((k for k, v in enumerate(f) if v >= 0.95), None)
        fr[n] = dict(fraction=round(float(f[-1]), 4),
                     firstWeek95=None if first is None else meta["weeks"][first]["startUtc"])
    targets = {}
    for slug in FIVE:
        m = json.loads((ROOT / "packs" / "dr1qr3" / slug / "manifest.json").read_text())
        rows = sorted([round(f["mjd"], 2), round(f["lambdaUm"], 3), f["detector"]] for f in m["frames"])
        targets[slug] = rows
    weeks = [dict(start=w["startMjd"], end=w["endMjd"], label=w["label"], startUtc=w["startUtc"]) for w in meta["weeks"]]
    out = dict(
        format="planetes-band/1",
        built=meta.get("source", "")[:40],
        targets=targets,
        weeks=weeks,
        survey=dict(passes=fr, line=survey_line(fr), lastWeek=meta["weeks"][-1]["endUtc"],
                    releaseSeamMjd=QR3_START_MJD,
                    rule="new pass after a gap > 60 days; cells watched continuously for > 6 months count one pass per 6 months; 'whole sky' only at >= 99%"),
    )
    (ROOT / "band").mkdir(parents=True, exist_ok=True)
    txt = json.dumps(out, separators=(",", ":"))
    (ROOT / "band" / "band.json").write_text(txt)
    print(out["survey"]["line"], {n: fr[n] for n in fr}, f"{len(txt) / 1024:.1f} kB",
          {k: len(v) for k, v in targets.items()})


if __name__ == "__main__":
    main()
