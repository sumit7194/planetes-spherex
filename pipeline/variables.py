"""G4: brightness change of the variable stars from unsaturated colours (rules: prereg/variables/PLAN.md).

Steps (python variables.py <step> <slug>):
  steady   The steady-star test only (Physics checks it before any target ratio): per detector and
           pass pair, the Gaia comparison stars' ratios. Writes cache/variables_<slug>_steady.json.
  target   (only after Physics signs the steady stars) The target's differential ratio.

Photometry is the field guide's masked aperture (fieldguide.measure_masked: 3x3 sum minus the
median of a 4-9 px ring with FIT_REJECT masked). measure.py has no ePSF masked-fraction correction,
so by PLAN §1 a star with any FIT_REJECT pixel in its 3x3 is rejected in that photo.
"""
from __future__ import annotations

import asyncio
import collections
import json
import math
import pickle
import sys
import urllib.parse
import urllib.request

import numpy as np
import aiohttp
from astropy.io import fits
from astropy.wcs import WCS

import catalogs
import fieldguide as fg
import spherex as sx

CACHE = fg.CACHE
SAT = ("OVERFLOW", "NONLINEAR", "BLOOM", "PERSIST")
GAP_DAYS = 60


def target_of(slug: str) -> dict:
    t = json.loads((fg.HERE / "targets.json").read_text())
    tl = t["targets"] if isinstance(t, dict) else t
    return [x for x in tl if x.get("slug") == slug][0]


def photos(t: dict) -> list[dict]:
    """One cached box per photo around the target, with its pass number."""
    idx = json.loads((CACHE / "fieldguide_index.json").read_text())
    seen, out = set(), []
    for r in idx["rows"]:
        if fg.sep_deg(r["ra"], r["dec"], t["ra"], t["dec"]) >= 0.05 or (r["obs"], r["det"]) in seen:
            continue
        seen.add((r["obs"], r["det"]))
        out.append(r)
    out.sort(key=lambda r: r["mjd"])
    mj = [r["mjd"] for r in out]
    p = 0
    for i, r in enumerate(out):
        if i and mj[i] - mj[i - 1] > GAP_DAYS:
            p += 1
        r["pass"] = p
    return out


def gaia_field(ra: float, dec: float, radius_deg: float) -> list[dict]:
    """Gaia DR3 with the variability flag (ESA archive), G < 19. Cached."""
    path = CACHE / f"variables_gaia_{ra:.4f}_{dec:.4f}_{radius_deg:.3f}.json"
    if path.exists():
        return json.loads(path.read_text())
    adql = ("SELECT source_id, ra, dec, pmra, pmdec, phot_g_mean_mag, phot_variable_flag FROM gaiadr3.gaia_source "
            f"WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius_deg})) "
            "AND phot_g_mean_mag < 19")
    q = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql})
    with urllib.request.urlopen(f"https://gea.esac.esa.int/tap-server/tap/sync?{q}", timeout=120) as r:
        d = json.loads(r.read())
    cols = [c["name"] for c in d["metadata"]]
    rows = [dict(zip(cols, row)) for row in d["data"]]
    if not rows:
        raise SystemExit("Gaia answered with no stars: not using an empty catalogue")
    path.write_text(json.dumps(rows))
    return rows


def at_date(s: dict, mjd: float, epoch: float = 2016.0) -> tuple[float, float]:
    return catalogs.propagate(dict(ra=s["ra"], dec=s["dec"], pmra=s.get("pmra") or 0, pmdec=s.get("pmdec") or 0,
                                   epoch=epoch), fg.year_of(mjd))


def star_in(e: dict, w: WCS, ra: float, dec: float) -> dict | None:
    """Masked-aperture flux, peak and flags for a star in one cached box; None if unusable here."""
    px, py = w.all_world2pix(ra, dec, 0)
    x, y = float(px) - e["x0"], float(py) - e["y0"]
    h, wd = e["img"].shape
    xi, yi = int(round(x)), int(round(y))
    if not (10 <= xi < wd - 10 and 10 <= yi < h - 10):
        return None
    core = (slice(yi - 1, yi + 2), slice(xi - 1, xi + 2))
    if fg.mask_of(e, SAT)[core].any() or fg.mask_of(e, fg.FIT_REJECT)[core].any():
        return dict(rejected=True)
    m = fg.measure_masked(e, x, y)
    if not m or m["usable"] < 9:
        return dict(rejected=True)
    img = e["img"].astype(float)
    yy, xx = np.mgrid[0:h, 0:wd]
    d = np.maximum(np.abs(xx - xi), np.abs(yy - yi))
    bad = fg.mask_of(e, fg.FIT_REJECT) | ~np.isfinite(img)
    ring = (d >= 4) & (d <= 9) & ~bad
    bk = float(np.median(img[ring]))
    sd = 1.4826 * float(np.median(np.abs(img[ring] - bk)))
    flux = float((img[core] - bk).sum())
    return dict(rejected=False, flux=flux, err=sd * 3.0, peak=float(img[core].max() - bk), x=x, y=y)


async def waves(rows: list[dict]) -> dict:
    """Each photo's WCS-WAVE table, for the wavelength at any pixel (one small read per photo)."""
    out = {}
    async with aiohttp.ClientSession() as s:
        rd = sx.RangeReader(s)
        for r in rows:
            e = pickle.loads((CACHE / r["path"]).read_bytes())  # our own cache
            out[r["path"]] = await sx.read_wave(rd, e["url"])
        print(f"{len(out)} wavelength tables read", flush=True)
    return out


def steady(slug: str) -> None:
    t = target_of(slug)
    rows = photos(t)
    gaia = gaia_field(t["ra"], t["dec"], 0.12)
    tepoch = float(t.get("epoch", 2016.0))

    def tg_of(r):
        e = pickle.loads((CACHE / r["path"]).read_bytes())  # our own cache, written by this pipeline
        w = WCS(fits.Header.fromstring(e["wcs_hdr"]))
        return e, w, star_in(e, w, *at_date(t, r["mjd"], tepoch))

    # Wavelength tables only for photos where the target is usable (the others can't pair).
    usable = [r for r in rows if (lambda m: m and not m.get("rejected"))(tg_of(r)[2])]
    tab = asyncio.run(waves(usable))
    # Per photo: the target (for the selection only: peak and usability, never its ratio here) and
    # every Gaia star.
    per = []
    for r in rows:
        e, w, tg = tg_of(r)
        if r["path"] not in tab:
            per.append(dict(obs=r["obs"], det=r["det"], mjd=r["mjd"], pass_=r["pass"], target=tg, target_lam=None, stars={}))
            continue
        stars = {}
        for s in gaia:
            m = star_in(e, w, *at_date(s, r["mjd"]))
            if m and not m["rejected"]:
                lam = sx.wave_at(tab[r["path"]], m["x"] + e["x0"], m["y"] + e["y0"])[0]
                stars[str(s["source_id"])] = dict(m, lam=lam)
        tl = sx.wave_at(tab[r["path"]], e["xt"], e["yt"])[0]
        per.append(dict(obs=r["obs"], det=r["det"], mjd=r["mjd"], pass_=r["pass"], target=tg, target_lam=tl, stars=stars))
    # Gaia's own variability flag, and no neighbour brighter than G+3 within 2 px (12.3").
    ok_ids = set()
    for s in gaia:
        if (s.get("phot_variable_flag") or "") == "VARIABLE" or s["phot_g_mean_mag"] is None:
            continue
        crowded = any(o is not s and o["phot_g_mean_mag"] is not None and o["phot_g_mean_mag"] < s["phot_g_mean_mag"] + 3
                      and fg.sep_deg(o["ra"], o["dec"], s["ra"], s["dec"]) * 3600 < 2 * fg.PIX_ARCSEC for o in gaia)
        if not crowded:
            ok_ids.add(str(s["source_id"]))
    result = {}
    for det in range(1, 7):
        mine = [p for p in per if p["det"] == det]
        usable_t = [p for p in mine if p["target"] and not p["target"].get("rejected")]
        key = f"D{det}"
        if not usable_t:
            result[key] = dict(status="saturated in every photo here", photos=len(mine))
            continue
        passes = sorted({p["pass_"] for p in usable_t})
        result[key] = {}
        for i, a in enumerate(passes):
            for b in passes[i + 1:]:
                A = [p for p in usable_t if p["pass_"] == a]
                B = [p for p in usable_t if p["pass_"] == b]
                tpairs = [(pa, pb) for pa in A for pb in B if abs(pa["target_lam"] - pb["target_lam"]) <= pa["target_lam"] / 80]
                entry = dict(target_pairs=len(tpairs))
                if len(tpairs) < 3:
                    entry["status"] = "fewer than 3 wavelength-matched pairs"
                    result[key][f"{a + 1}->{b + 1}"] = entry
                    continue
                tpeak = float(np.median([x["target"]["peak"] for pr in tpairs for x in pr]))
                ratios = {}
                for sid in ok_ids:
                    rs, es = [], []
                    for pa, pb in tpairs:
                        sa, sb = pa["stars"].get(sid), pb["stars"].get(sid)
                        if not sa or not sb or sa["flux"] <= 0 or sb["flux"] <= 0:
                            continue
                        if abs(sa["lam"] - sb["lam"]) > sa["lam"] / 80:
                            continue
                        if not (tpeak / 3 <= sa["peak"] <= tpeak * 3):
                            continue
                        q = sb["flux"] / sa["flux"]
                        rs.append(q)
                        es.append(q * math.hypot(sa["err"] / sa["flux"], sb["err"] / sb["flux"]))
                    if rs:
                        wts = 1 / np.array(es) ** 2
                        mean = float((np.array(rs) * wts).sum() / wts.sum())
                        err = max(float(1 / math.sqrt(wts.sum())),
                                  float(np.std(rs) / math.sqrt(len(rs))) if len(rs) > 1 else 0.0)
                        peak = max(pa["stars"][sid]["peak"] for pa, _ in tpairs if sid in pa["stars"])
                        ratios[sid] = dict(ratio=round(mean, 4), err=round(err, 4), pairs=len(rs), peak_over_target=round(peak / tpeak, 2))
                n = len(ratios)
                entry.update(steady_stars=n, target_peak=round(tpeak, 2), stars=ratios)
                if n < 5:
                    entry["status"] = "fewer than 5 steady stars"
                else:
                    v = np.array([s["ratio"] for s in ratios.values()])
                    e_ = np.array([s["err"] for s in ratios.values()])
                    med = float(np.median(v))
                    chi2 = float((((v - med) / e_) ** 2).sum() / max(1, n - 1))
                    bright = [s for s in ratios.values() if s["peak_over_target"] >= 0.5]
                    entry.update(median=round(med, 4), chi2_dof=round(chi2, 2), bright_enough=len(bright))
                    if not bright:
                        entry["status"] = "no steady star this bright here, not tested"
                    elif abs(med - 1) > 0.02 or chi2 >= 2:
                        entry["status"] = "steady stars don't hold, no number"
                    else:
                        entry["status"] = "steady stars hold"
                result[key][f"{a + 1}->{b + 1}"] = entry
    out = CACHE / f"variables_{slug}_steady.json"
    out.write_text(json.dumps(dict(slug=slug, rule="prereg/variables/PLAN.md", result=result), indent=1))
    for k, v in result.items():
        if "status" in v:
            print(k, v["status"], v.get("photos"))
        else:
            for pp, e in v.items():
                print(k, pp, {x: e[x] for x in e if x != "stars"})


def wide(slug: str) -> None:
    """Amendment (15 Nov): one wider read (250x250 px, centred on the target) of the same photos of
    the one pass pair that has >= 3 target pairs, then the steady-star test with counts per rule.
    No target ratio is computed here."""
    t = target_of(slug)
    tepoch = float(t.get("epoch", 2016.0))
    prev = json.loads((CACHE / f"variables_{slug}_steady.json").read_text())
    rows = {r["obs"] + f"_D{r['det']}": r for r in photos(t)}
    # The pass pair(s) that met "3 pairs" in the first step, and their photos (D1 for RW Aur).
    todo = [(det, pp) for det, v in prev["result"].items() if "status" not in v
            for pp, e in v.items() if e.get("target_pairs", 0) >= 3]
    gaia = gaia_field(t["ra"], t["dec"], 0.25)
    report = {}
    for det, pp in todo:
        d = int(det[1:])
        a, b = (int(x) - 1 for x in pp.split("->"))
        rs = [r for r in rows.values() if r["det"] == d and r["pass"] in (a, b)]
        # The same photos: those where the target is usable (as in the first step).
        boxes = {}
        async def read_all():
            async with aiohttp.ClientSession() as s_:
                rd = sx.RangeReader(s_)
                for r in rs:
                    e0 = pickle.loads((CACHE / r["path"]).read_bytes())  # our own cache
                    w0 = WCS(fits.Header.fromstring(e0["wcs_hdr"]))
                    tg = star_in(e0, w0, *at_date(t, r["mjd"], tepoch))
                    if not tg or tg.get("rejected"):
                        continue
                    tra, tdec = at_date(t, r["mjd"], tepoch)
                    bx = await sx.read_box(rd, dict(url=e0["url"], t=r["mjd"]), tra, tdec, 125)
                    tab = await sx.read_wave(rd, e0["url"])
                    if bx:
                        boxes[r["obs"]] = (r, bx, tab, tg)
        asyncio.run(read_all())
        counts = collections.Counter()
        per = {}
        for obs, (r, bx, tab, tg) in boxes.items():
            e = dict(img=bx["img"], fl=bx["fl"], bits=bx["bits"], x0=bx["x0"], y0=bx["y0"])
            w = bx["wcs"]
            nx, ny = int(bx["hdr"]["NAXIS1"]), int(bx["hdr"]["NAXIS2"])
            stars = {}
            for s in gaia:
                sra, sdec = at_date(s, r["mjd"])
                px, py = w.all_world2pix(sra, sdec, 0)
                if not (8 <= float(px) <= nx - 9 and 8 <= float(py) <= ny - 9):
                    continue  # the detector-edge rule
                m = star_in(e, w, sra, sdec)
                if m is None:
                    continue
                counts["in box, off the edge"] += 1
                if m["rejected"]:
                    continue
                counts["unsaturated, clean core (§1)"] += 1
                stars[str(s["source_id"])] = dict(m, lam=sx.wave_at(tab, m["x"] + bx["x0"], m["y"] + bx["y0"])[0])
            tl = sx.wave_at(tab, bx["xt"], bx["yt"])[0]
            per[obs] = dict(pass_=r["pass"], target=tg, target_lam=tl, stars=stars)
        ok_ids = set()
        for s in gaia:
            if (s.get("phot_variable_flag") or "") == "VARIABLE" or s["phot_g_mean_mag"] is None:
                continue
            if any(o is not s and o["phot_g_mean_mag"] is not None and o["phot_g_mean_mag"] < s["phot_g_mean_mag"] + 3
                   and fg.sep_deg(o["ra"], o["dec"], s["ra"], s["dec"]) * 3600 < 2 * fg.PIX_ARCSEC for o in gaia):
                continue
            ok_ids.add(str(s["source_id"]))
        A = [p_ for p_ in per.values() if p_["pass_"] == a]
        B = [p_ for p_ in per.values() if p_["pass_"] == b]
        tpairs = [(pa, pb) for pa in A for pb in B if abs(pa["target_lam"] - pb["target_lam"]) <= pa["target_lam"] / 80]
        tpeak = float(np.median([x["target"]["peak"] for pr in tpairs for x in pr]))
        rule = collections.Counter()
        ratios = {}
        for sid in {k for p_ in per.values() for k in p_["stars"]}:
            rule["clean in some photo (§1)"] += 1
            if sid not in ok_ids:
                continue
            rule["not Gaia VARIABLE, no bright neighbour (§3)"] += 1
            rs_, es_ = [], []
            peaks = []
            for pa, pb in tpairs:
                sa, sb = pa["stars"].get(sid), pb["stars"].get(sid)
                if not sa or not sb or sa["flux"] <= 0 or sb["flux"] <= 0:
                    continue
                # Paired at the star's own wavelength (λ/80), not the target's (Physics).
                if abs(sa["lam"] - sb["lam"]) > sa["lam"] / 80:
                    continue
                if not (tpeak / 3 <= sa["peak"] <= tpeak * 3):
                    continue
                q = sb["flux"] / sa["flux"]
                rs_.append(q)
                es_.append(q * math.hypot(sa["err"] / sa["flux"], sb["err"] / sb["flux"]))
                peaks.append(sa["peak"])
            if not rs_:
                continue
            rule["peak within x3 of the target's, paired at its own wavelength"] += 1
            wts = 1 / np.array(es_) ** 2
            mean = float((np.array(rs_) * wts).sum() / wts.sum())
            err = max(float(1 / math.sqrt(wts.sum())), float(np.std(rs_) / math.sqrt(len(rs_))) if len(rs_) > 1 else 0.0)
            ratios[sid] = dict(ratio=round(mean, 4), err=round(err, 4), pairs=len(rs_),
                               peak_over_target=round(max(peaks) / tpeak, 2))
        n = len(ratios)
        entry = dict(box_px=250, photos_read=len(boxes), target_pairs=len(tpairs), target_peak=round(tpeak, 2),
                     star_counts=dict(counts), rule_counts=dict(rule), steady_stars=n, stars=ratios)
        if n < 5:
            entry["status"] = "fewer than 5 steady stars, not tested"
        else:
            v = np.array([x["ratio"] for x in ratios.values()])
            e_ = np.array([x["err"] for x in ratios.values()])
            med = float(np.median(v))
            chi2 = float((((v - med) / e_) ** 2).sum() / max(1, n - 1))
            bright = [x for x in ratios.values() if x["peak_over_target"] >= 0.5]
            diff = v / med
            entry.update(median=round(med, 4), chi2_dof=round(chi2, 2), bright_enough=len(bright),
                         systematic_rms=round(float(np.sqrt(np.mean((diff - 1) ** 2))), 4))
            if not bright:
                entry["status"] = "no steady star this bright here, not tested"
            elif abs(med - 1) > 0.02 or chi2 >= 2:
                entry["status"] = "steady stars don't hold, no number"
            else:
                entry["status"] = "steady stars hold"
        report[f"{det} {pp}"] = entry
        print(det, pp, {k: v for k, v in entry.items() if k != "stars"})
    (CACHE / f"variables_{slug}_wide.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    {"steady": steady, "wide": wide}[sys.argv[1]](sys.argv[2])
