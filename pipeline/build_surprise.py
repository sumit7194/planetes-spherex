"""A curated list of interesting spots for the viewer's "Surprise me": famous fast-moving stars and
long-period variables, each checked against Gaia DR3 during the event (the highest proper motion
source within 3 arcmin of its approximate J2000 position), with its position moved to 2026.0.

Output: public/data/surprise.json
Usage: uv run python build_surprise.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import catalogs

OUT = Path(__file__).parent.parent / "public" / "data" / "surprise.json"

# name, approximate J2000 RA/Dec (deg), kind, one line for the visitor
CANDIDATES = [
    ("Kapteyn's Star", 77.919, -45.018, "mover", "A red dwarf from the Milky Way's halo, crossing the sky at about 8.6 arcseconds a year."),
    ("Groombridge 1830", 178.245, 37.719, "mover", "An old halo star with one of the largest proper motions known."),
    ("Lacaille 9352", 346.467, -35.853, "mover", "A nearby red dwarf, 10.7 light years away, moving almost 7 arcseconds a year."),
    ("Teegarden's Star", 43.254, 16.881, "mover", "A small, faint red dwarf with planets, 12.5 light years away."),
    ("Wolf 359", 164.120, 7.015, "mover", "One of the Sun's nearest neighbours, a dim red dwarf 7.9 light years away."),
    ("Lalande 21185", 165.834, 35.970, "mover", "One of the brightest red dwarfs in the sky, 8.3 light years away."),
    ("61 Cygni A", 316.725, 38.749, "mover", "The first star whose distance was measured (Bessel, 1838)."),
    ("Luyten's Star", 111.852, 5.226, "mover", "A red dwarf 12 light years away with a planet in its habitable zone."),
    ("Van Maanen's Star", 12.291, 5.389, "mover", "The nearest solitary white dwarf, a burnt-out star core."),
    ("Proxima Centauri", 217.429, -62.680, "mover", "The nearest star to the Sun, 4.2 light years away."),
    ("Ross 128", 176.935, 0.804, "mover", "A quiet red dwarf 11 light years away, with an Earth-sized planet."),
    ("Mira", 34.837, -2.978, "variable", "The original long-period variable: it brightens and fades over about 11 months."),
    ("Chi Cygni", 297.641, 32.914, "variable", "A Mira variable with one of the largest brightness swings of any star."),
]


def main():
    out = []
    for name, ra, dec, kind, note in CANDIDATES:
        try:
            near = catalogs.gaia_dr3(ra, dec, 3 / 60, gmax=19.0)
        except Exception as ex:  # noqa: BLE001
            print(name, "Gaia failed", repr(ex)[:80])
            continue
        if not near:
            print(name, "no Gaia sources")
            continue
        best = max(near, key=lambda s: math.hypot(s["pmra"], s["pmdec"]) if kind == "mover" else -(s["mag"] or 99))
        ra26, dec26 = catalogs.propagate(best, 2026.0)
        pm = math.hypot(best["pmra"], best["pmdec"]) / 1000
        out.append(dict(name=name, kind=kind, note=note, ra=round(ra26, 6), dec=round(dec26, 6), epoch=2026.0,
                        source=f"Gaia DR3 {best['id']} (position and proper motion; position moved to 2026.0)",
                        pmArcsecYr=round(pm, 3), gaiaDr3=best["id"], gMag=best["mag"],
                        parallaxMas=None if best["plx"] is None else round(best["plx"], 2)))
        print(f"{name:20s} Gaia DR3 {best['id']} G {best['mag']} pm {pm:.2f}\"/yr plx {best['plx']}")
    OUT.write_text(json.dumps(dict(
        format="planetes-surprise/1",
        what="Interesting spots for a live look: fast-moving stars and long-period variables",
        source="Gaia DR3 (ESA/Gaia/DPAC) via the ESA Gaia archive; positions moved to 2026.0 by proper motion",
        spots=out), indent=1, ensure_ascii=False))
    print(len(out), "spots ->", OUT)


if __name__ == "__main__":
    main()
