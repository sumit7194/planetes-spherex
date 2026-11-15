"""Save each frame's searched area and WCS before a patch's v0 maps and raw cutouts are discarded.

The FAR denominator (area-visits) is each frame's valid pixels x pixel solid angle. It is stored in
the v0 map's meta, and it can also be recomputed exactly from the raw cutout: the valid mask is
smo.scene.pipeline's (finite IMAGE - ZODI and VARIANCE, VARIANCE > 0, no FIT_REJECT flag) and the
solid angle comes from the WCS. Where both exist they must agree exactly. The cutout's WCS (full
header cards, SIP included; reconstruct with WCS(header)[y0:y0+ny, x0:x0+nx]) is kept as well, so
fake and candidate positions can still be compared on the sky after the cutouts are gone.
Writes runs/yardstick/<patch>/areas.json.

Usage: uv run python scripts/save_map_areas.py <patch> [<patch> ...]
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
warnings.filterwarnings("ignore")


def from_cutout(path: Path) -> dict:
    from astropy.wcs import WCS

    from smo.data.exposure import load_cutout
    from smo.data.flags import FIT_REJECT, bit_map, mask_for
    from smo.inject.render import pixel_solid_angle_sr

    cut = load_cutout(path)
    rej, _ = mask_for(cut.flags, bit_map(cut.flags_header), FIT_REJECT)
    data = cut.image.astype(np.float64) - cut.zodi.astype(np.float64)
    var = cut.variance.astype(np.float64)
    valid = np.isfinite(data) & np.isfinite(var) & (var > 0) & ~rej
    return {"valid_px": int(valid.sum()), "omega_sr": float(pixel_solid_angle_sr(cut)),
            "wcs_header": WCS(cut.image_header).to_header(relax=True).tostring(),
            "x0": cut.x0, "y0": cut.y0, "shape": list(cut.shape)}


def main():
    from smo.data.patch import frames_from_manifest
    from smo.provenance import atomic_write_json

    for patch in sys.argv[1:]:
        man = ROOT / "runs" / f"fetch_{patch}.json"
        frames = frames_from_manifest(man if man.exists() else None, ROOT / "cache" / "patch" / f"{patch}_frames.json")
        out, n_map, n_cut = {}, 0, 0
        for f in frames:
            stem = Path(f.path).stem
            rec = {}
            mp = ROOT / "cache" / "v0maps" / patch / f"{stem}.npz"
            if mp.exists():
                with np.load(mp, allow_pickle=False) as z:
                    meta = json.loads(str(z["meta"]))
                rec = {"valid_px": int(meta["valid_px"]), "omega_sr": float(meta["omega_sr"]), "source": "v0 map"}
                n_map += 1
            if Path(f.path).exists():
                c = from_cutout(Path(f.path))
                n_cut += 1
                if rec and (rec["valid_px"] != c["valid_px"] or not np.isclose(rec["omega_sr"], c["omega_sr"], rtol=1e-12, atol=0)):
                    raise SystemExit(f"{patch}: {stem}: map and raw cutout disagree ({rec} vs {c['valid_px']}, {c['omega_sr']})")
                rec = {**c, "source": "v0 map and raw cutout" if rec else "raw cutout"}
            if not rec:
                raise SystemExit(f"{patch}: {stem}: neither a v0 map nor the raw cutout exists")
            out[stem] = rec
        atomic_write_json(ROOT / "runs/yardstick" / patch / "areas.json", {"patch": patch, "frames": out})
        print(f"{patch}: {len(out)} frames saved ({n_map} from v0 maps, {n_cut} from raw cutouts, agreeing wherever both exist)")


if __name__ == "__main__":
    main()
