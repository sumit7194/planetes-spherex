"""Add (or refresh) the Gaia DR3 + CatWISE2020 overlay in already-built packs, without refetching photos.

Usage: uv run python add_catalog.py barnard w0855 ...   (pack folders under ../public/packs)
"""
import json
import sys
from pathlib import Path

import catalogs

ROOT = Path(__file__).parent.parent / "public" / "packs"
for slug in sys.argv[1:]:
    p = ROOT / slug / "pack.json"
    pack = json.loads(p.read_text())
    ra, dec = pack["grid"]["crval"]
    rad = pack["grid"]["n"] * pack["grid"]["pixArcsec"] / 3600 * 0.75
    cat = []
    for fn in (catalogs.gaia_dr3, catalogs.catwise2020):
        try:
            got = fn(ra, dec, rad)
            print(slug, fn.__name__, len(got), flush=True)
            cat += got
        except Exception as ex:  # noqa: BLE001
            print(slug, fn.__name__, "failed:", repr(ex)[:120], flush=True)
    if cat:
        pack["catalog"] = cat
        p.write_text(json.dumps(pack, separators=(",", ":")))
