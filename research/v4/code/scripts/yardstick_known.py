"""Known asteroids for every frame of a patch, for yardstick scoring only (prereg/YARDSTICK.md §5).

Method code never reads this output (§4, no oracle access). kete integrates every MPC object once,
with n-body physics, across the time span of the patch's frames, from states n-body propagated
to the patch's median epoch, and checks each frame's footprint with SPHEREx's header position as
the observer. Each visit then gets every object seen in any of its frames, at the visit's mean
time t0, by linear interpolation in the object's own predicted rates from the frame nearest t0.

Usage: RAYON_NUM_THREADS=2 uv run --extra ephem python scripts/yardstick_known.py <patch> <manifest>
Writes runs/yardstick/<patch>/known.json.
"""

from __future__ import annotations

import sys
import time
import warnings
from collections import defaultdict
from pathlib import Path

import numpy as np

from smo.data.exposure import load_cutout
from smo.data.patch import by_visit, frames_from_manifest
from smo.ephem.known import footprint, load_orbits, observer_state, predict, states_at_epoch
from smo.provenance import atomic_write_json, environment_stamp

ROOT = Path(__file__).resolve().parents[1]
warnings.filterwarnings("ignore", module="astropy")


def main():
    patch, manifest = sys.argv[1], Path(sys.argv[2])
    frames = frames_from_manifest(manifest, ROOT / "cache" / "patch" / f"{patch}_frames.json")
    fbv = by_visit(frames)
    t = time.time()
    fovs, owner = [], []
    for f in frames:
        cut = load_cutout(Path(f.path))
        ny, nx = cut.shape
        fovs.append(footprint(cut.wcs(), ny, nx, observer_state(cut.image_header)))
        owner.append(f)
    jd_med = float(np.median([f.mjd_avg for f in frames])) + 2400000.5
    orbits, states = load_orbits()
    states = states_at_epoch(states, round(jd_med, 0), ROOT / "cache")
    print(f"{len(fovs)} FOVs, states at JD {round(jd_med, 0)}, {time.time() - t:.0f}s", flush=True)
    preds = predict(fovs, orbits, states)
    print(f"{len(preds)} object-frame predictions, {time.time() - t:.0f}s", flush=True)
    by_jd = defaultdict(list)
    for p in preds:
        by_jd[round(p["fov_jd"], 7)].append(p)
    frame_of_jd = {round(fv.observer.jd, 7): f for fv, f in zip(fovs, owner, strict=True)}
    per_visit = defaultdict(dict)
    for jd, ps in by_jd.items():
        f = frame_of_jd[jd]
        for p in ps:
            per_visit[f.visit].setdefault(str(p["desig"]), []).append((f, p))
    out = {}
    for visit, objs in per_visit.items():
        t0 = float(np.mean([f.mjd_avg for f in fbv[visit]]))
        rows = []
        for desig, hits in objs.items():
            f, p = min(hits, key=lambda h: abs(h[0].mjd_avg - t0))
            dt = t0 - f.mjd_avg  # days
            rows.append({"desig": desig, "ra_t0": p["ra"] + p["dra_deg_per_day"] * dt / np.cos(np.radians(p["dec"])),
                         "dec_t0": p["dec"] + p["ddec_deg_per_day"] * dt, "v_mag": p["v_mag"], "h_mag": p["h_mag"],
                         "r_au": p["r_au"], "delta_au": p["delta_au"],
                         "rate_arcsec_per_s": float(np.hypot(p["dra_deg_per_day"], p["ddec_deg_per_day"]) * 3600 / 86400),
                         "dra_cosdec_deg_per_day": p["dra_deg_per_day"], "ddec_deg_per_day": p["ddec_deg_per_day"],
                         "n_frames": len(hits)})
        out[visit] = {"t0": t0, "objects": rows}
    path = ROOT / "runs" / "yardstick" / patch / "known.json"
    atomic_write_json(path, {"patch": patch, "states_jd": round(jd_med, 0), "visits": out, "env": environment_stamp()})
    print(f"wrote {path}: {sum(len(v['objects']) for v in out.values())} visit-objects in {len(out)} visits")


if __name__ == "__main__":
    main()
