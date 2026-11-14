"""The bright-star catalogue v9: v8 plus each star's Hipparcos proper motion.

v8 (public/catalog/bright-stars-v8.json) holds Hipparcos places at epoch J1991.25. The stars a
visitor hovers and clicks are the bright, nearby ones, which move most: Arcturus 2.28"/yr is
~80" from its 1991 place today, alpha Cen A ~2.2' (Viewer, 14 Nov). v9 adds pmRA* (mu_alpha cos
delta) and pmDec in mas/yr from the same table, so the page can move a star to today's date
(searchIndex.placeAt, as for SIMBAD's places).

Usage: python build_bright_stars_v9.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import catalogs

ROOT = Path(__file__).parent.parent / "public" / "catalog"
QUERY = "SELECT hip, pmra, pmde FROM public.hipparcos WHERE vmag <= 8.0 AND ra IS NOT NULL"


def main():
    v8 = json.loads((ROOT / "bright-stars-v8.json").read_text())
    rows = catalogs._tap(QUERY, url=catalogs.GAIA_TAP)
    raw = json.dumps(sorted([[int(r["hip"]), r["pmra"], r["pmde"]] for r in rows]))
    pm = {int(r["hip"]): (r["pmra"], r["pmde"]) for r in rows}
    stars, missing = [], 0
    for s in v8["stars"]:
        hip = s[4] if len(s) > 4 else None
        a, d = pm.get(hip, (None, None)) if hip else (None, None)
        if a is None or d is None:
            missing += 1
        # Whole mas/yr: 35 years x 0.5 mas is 0.02", far below a SPHEREx pixel.
        stars.append([*s[:5], round(a) if a is not None else 0, round(d) if d is not None else 0])
    out = dict(v8)
    out.update(
        columns=[*v8["columns"], "pmRA* (mas/yr)", "pmDec (mas/yr)"],
        stars=stars,
        label=v8.get("label", "catalogue stars, not SPHEREx"),
        epoch="J1991.25 (ICRS); move to a date with the proper motions",
        pm_query=QUERY,
        pm_response_sha256=hashlib.sha256(raw.encode()).hexdigest(),
        pm_missing=missing,
        built_from="bright-stars-v8.json + public.hipparcos proper motions (ESA Gaia archive TAP)",
    )
    path = ROOT / "bright-stars-v9.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(stars)} stars, {missing} without a proper motion (kept at 0), {path.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
