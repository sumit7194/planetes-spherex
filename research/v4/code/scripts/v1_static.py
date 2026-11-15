"""Build the v1 leave-half-out static source lists for a patch (smo.catalogs.stack).

Usage: uv run python scripts/v1_static.py <patch> <ra> <dec>
Writes cache/v1/<patch>/static.json: per half (A, B), the sources found in that half's visits,
and the visit -> half assignment (a visit in half A is fitted with half B's sources).
"""

from __future__ import annotations

import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
warnings.filterwarnings("ignore")


def main():
    import yardstick_run as Y
    from smo.catalogs import catwise, gaia
    from smo.catalogs.stack import find_sources, split_halves, static_map
    from smo.data.patch import Frame, by_visit
    from smo.detect.maps import Plane
    from smo.detect.v0 import _stack
    from smo.provenance import atomic_write_json

    patch, ra0, dec0 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    t = time.time()
    fbv = by_visit([Frame(**r) for r in json.loads((ROOT / "cache" / "patch" / f"{patch}_frames.json").read_text())])
    maps = {v: [m for m in (Y.load_map(patch, f) for f in fs) if m is not None] for v, fs in fbv.items()}
    halves = split_halves({v: min(f.mjd_avg for f in fs) for v, fs in fbv.items()})
    pl = Plane(ra0, dec0)
    t_mid = float(np.median([f.mjd_avg for fs in fbv.values() for f in fs]))
    g = gaia.cone(ra0, dec0, 0.75, ROOT / "cache")
    gra, gdec = gaia.propagate(g, t_mid)
    gxy = np.stack(pl.from_sky(gra, gdec), 1)
    c = None
    for attempt in range(6):  # IRSA TAP returns intermittent 502/504s; retry with back-off (output unchanged)
        try:
            c = catwise.cone(ra0, dec0, 0.75, ROOT / "cache")
            break
        except Exception as e:  # noqa: BLE001 - re-raised after the last attempt
            if attempt == 5:
                raise
            print(f"CatWISE query failed ({e!r}); retrying in {60 * (attempt + 1)} s", flush=True)
            time.sleep(60 * (attempt + 1))
    cra, cdec = catwise.propagate(c, t_mid)
    cxy = np.stack(pl.from_sky(cra, cdec), 1)
    out = {"patch": patch, "halves": halves, "t_mid": t_mid, "lists": {}}
    for h in ("A", "B"):
        vs = [v for v, hh in halves.items() if hh == h]
        med, cover, ax = static_map(maps, vs, 0.56 * 3600, _stack)
        sl = find_sources(med, cover, ax, gxy, g["phot_g_mean_mag"].to_numpy(), cxy, h)
        ra, dec = pl.to_sky(sl.xi, sl.eta)
        out["lists"][h] = {"n_visits": len(vs), "built_from": vs, "ra": list(map(float, ra)), "dec": list(map(float, dec)),
                           "nu": list(map(float, sl.nu)), "snapped": list(map(bool, sl.snapped))}
        print(f"{patch} half {h}: {len(vs)} visits, {len(sl.xi)} static sources (median nu >= 2), "
              f"{sl.snapped.mean() if len(sl.xi) else 0:.2f} snapped to CatWISE, {time.time() - t:.0f}s", flush=True)
    atomic_write_json(ROOT / "cache" / "v1" / patch / "static.json", out)


if __name__ == "__main__":
    main()
