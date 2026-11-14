"""Catalogue sources around a position from IRSA TAP: Gaia DR3 and CatWISE2020.

Used for (1) the overlay on the flipbook, with positions moved to each pass's date by proper
motion, and (2) a target's proper motion when targets.json doesn't give one.
"""

from __future__ import annotations

import csv
import io
import math
import urllib.parse
import urllib.request

TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"  # ESA's Gaia archive: fast cone searches
CATWISE_EPOCH_MJD = 57170.0  # CatWISE2020 reference epoch for ra_pm/dec_pm


def _tap(adql: str, timeout: float = 180, url: str = TAP) -> list[dict]:
    q = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "QUERY": adql, "FORMAT": "csv"})
    req = urllib.request.Request(f"{url}?{q}", headers={"User-Agent": "planetes-pipeline/0.1"})
    txt = urllib.request.urlopen(req, timeout=timeout).read().decode()
    out = []
    for r in csv.DictReader(io.StringIO(txt)):
        d = {}
        for k, v in r.items():
            try:
                d[k] = float(v) if v not in ("", None) else None
            except ValueError:
                d[k] = v
        out.append(d)
    return out


def _cone(ra: float, dec: float, r: float) -> str:
    return f"CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {r}))=1"


def gaia_dr3(ra: float, dec: float, radius_deg: float, gmax: float = 19.0) -> list[dict]:
    """Gaia DR3 sources (positions at epoch 2016.0) within radius, brighter than gmax."""
    q = (f"SELECT source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag FROM gaiadr3.gaia_source "
         f"WHERE {_cone(ra, dec, radius_deg)} AND phot_g_mean_mag < {gmax}")
    return [dict(cat="Gaia DR3", id=str(int(r["source_id"])), ra=r["ra"], dec=r["dec"],
                 pmra=r["pmra"] or 0.0, pmdec=r["pmdec"] or 0.0, plx=r["parallax"], epoch=2016.0,
                 mag=round(r["phot_g_mean_mag"], 2), band="G")
            for r in _tap(q, url=GAIA_TAP)]


def catwise2020(ra: float, dec: float, radius_deg: float, w2max: float = 16.5) -> list[dict]:
    """CatWISE2020 sources within radius (positions at MJD 57170, proper motions in mas/yr)."""
    # No magnitude cut in the query: IRSA answers a plain cone much faster; cut here instead.
    q = (f"SELECT source_name, ra_pm, dec_pm, pmra, pmdec, w1mpro_pm, w2mpro_pm FROM catwise_2020 "
         f"WHERE {_cone(ra, dec, radius_deg)}")
    ep = mjd_to_year(CATWISE_EPOCH_MJD)
    return [dict(cat="CatWISE2020", id=str(r["source_name"]), ra=r["ra_pm"], dec=r["dec_pm"],
                 pmra=1000 * (r["pmra"] or 0.0), pmdec=1000 * (r["pmdec"] or 0.0), plx=None, epoch=ep,
                 mag=None if r["w2mpro_pm"] is None else round(r["w2mpro_pm"], 2), band="W2",
                 w1=None if r["w1mpro_pm"] is None else round(r["w1mpro_pm"], 2))
            for r in _tap(q) if r["w2mpro_pm"] is not None and r["w2mpro_pm"] < w2max]


def propagate(src: dict, epoch: float) -> tuple[float, float]:
    """Move a catalogue position to a decimal-year epoch by proper motion (mas/yr; no parallax)."""
    dt = epoch - src["epoch"]
    ddec = (src.get("pmdec") or 0.0) * dt / 3.6e6
    dra = (src.get("pmra") or 0.0) * dt / 3.6e6 / max(1e-6, math.cos(math.radians(src["dec"])))
    return src["ra"] + dra, src["dec"] + ddec


def mjd_to_year(mjd: float) -> float:
    return 2000.0 + (mjd - 51544.5) / 365.25
