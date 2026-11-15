"""G2 (15 Nov): add SPHEREx's own position (header X_SC/Y_SC/Z_SC, km, geocentric, mid-exposure)
to every frame of the five packs, as `observerKm`, so the app can place known asteroids as SPHEREx
saw them (the spot check's correction, checked against kete). Read from each frame's own header in
our photo-box cache (every pack frame has one); nothing else in the manifest changes.

Usage: python add_observer.py            (all five; fails loudly if any frame lacks a header)
"""
from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path

from astropy.io import fits

HERE = Path(__file__).parent
CACHE = HERE / "cache"
PACKS = HERE.parent / "public" / "data" / "packs" / "dr1qr3"


def main() -> None:
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    path_of = {}
    for r in idx["rows"]:
        path_of.setdefault((r["obs"], r["det"]), r["path"])
    for pack in sorted(p for p in PACKS.iterdir() if (p / "manifest.json").exists()):
        mpath = pack / "manifest.json"
        m = json.loads(mpath.read_text())
        missing = 0
        for f in m["frames"]:
            obs = f["obsId"][:-2] if f["obsId"][-2] == "D" else f["obsId"]
            path = path_of.get((obs, f["detector"]))
            if not path:
                missing += 1
                continue
            # Our own cache, written only by this pipeline on this machine.
            e = pickle.loads((CACHE / path).read_bytes())
            h = fits.Header.fromstring(e["wcs_hdr"])
            if str(h.get("XYZ_SC_SYSTEM", "")).strip() != "GEOCENTER":
                raise SystemExit(f"{pack.name} {f['obsId']}: XYZ_SC_SYSTEM is {h.get('XYZ_SC_SYSTEM')!r}")
            f["observerKm"] = [float(h["X_SC"]), float(h["Y_SC"]), float(h["Z_SC"])]
        if missing:
            raise SystemExit(f"{pack.name}: {missing} frames without a cached header; nothing written")
        # The manifests are compact JSON; keep that style so the diff is only the new field.
        mpath.write_text(json.dumps(m, separators=(",", ":"), ensure_ascii=False))
        print(pack.name, len(m["frames"]), "frames: observerKm added")


if __name__ == "__main__":
    sys.exit(main())
