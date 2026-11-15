"""A patch: every cached cutout covering one sky position, organised by visit (prereg/YARDSTICK.md §2).

A visit is one observation ID (obs_id without its trailing exposure number): up to 4 exposures
about 129 s apart, each taken by a simultaneous detector pair (D1/D4, D2/D5, D3/D6).
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

from smo.data.exposure import load_cutout
from smo.provenance import atomic_write_json

PARTNER = {1: 4, 4: 1, 2: 5, 5: 2, 3: 6, 6: 3}
SHORT = (1, 2, 3)


@dataclass(frozen=True)
class Frame:
    path: str
    visit: str
    exposure: int
    detector: int
    mjd_beg: float
    mjd_avg: float
    mjd_end: float

    @property
    def is_short(self) -> bool:
        return self.detector in SHORT


def frames_from_manifest(manifest: Path, table_cache: Path) -> list[Frame]:
    """Frames of a fetch manifest (runs/fetch_region_*.json), with times read from each cutout's
    header once and cached as a table next to the manifest's cache."""
    if table_cache.exists():
        return [Frame(**r) for r in json.loads(table_cache.read_text())]
    m = json.loads(Path(manifest).read_text())
    out = []
    for r in m["fetched"]:
        cut = load_cutout(Path(r["path"]))
        h = cut.image_header
        visit, exposure = r["obs_id"].rsplit("_", 1)
        out.append(Frame(r["path"], visit, int(exposure), cut.detector, float(h["MJD-BEG"]),
                         float(h["MJD-AVG"]), float(h["MJD-END"])))
    out.sort(key=lambda f: (f.mjd_avg, f.detector))
    atomic_write_json(table_cache, [asdict(f) for f in out])
    return out


def by_visit(frames: list[Frame]) -> dict[str, list[Frame]]:
    v: dict[str, list[Frame]] = defaultdict(list)
    for f in frames:
        v[f.visit].append(f)
    return {k: sorted(fs, key=lambda f: (f.exposure, f.detector)) for k, fs in sorted(v.items())}
