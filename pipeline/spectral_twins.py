"""Queue #10: a no-AI "spectral twins" baseline on the five packs (Neural reviews).

SPHEREx photographs every star at ~100 colours across its passes. If those colour-by-colour
measurements are good, stars with the same spectrum shape should be the same kind of star. This
tests that with nothing learned: principal components (PCA) and cosine similarity.

Method (fixed before running, 14 Nov 2026 evening):
  1. Sources: Gaia DR3 stars in each pack field from its overlay file, G < 16, not the target,
     inside the 64 x 64 grid with a 6 px margin, and no other Gaia star with G < (its G + 2)
     within 3 px (18").
  2. Per photo: aperture flux (radius 2 px) minus the median of a 4-6 px annulus, at the star's
     place at that photo's pass; skipped if any aperture pixel is flagged saturated/rejected or
     is NaN. One value per photo at the photo's own wavelength.
  3. Spectrum: 24 bins, log-spaced 0.75-5.0 um; the median per bin; a star is kept if >= 20
     bins are filled (gaps filled by linear interpolation in log wavelength) and its median
     flux is > 0. Shape only: divided by its own median, then log10 (non-positive bins are
     clipped to 1e-3 of the median before the log).
  4. PCA over all kept stars of all five fields (mean-subtracted), 5 components. Twin = the
     other star (any field) with the highest cosine similarity in PCA space.
  5. Check against an independent colour: Gaia BP-RP (fetched from ESA's archive by source id).
     SUCCESS RULE (fixed now): the median |BP-RP difference| between each star and its twin is
     less than half the median over random pairs (1,000 random pairs, seed 20261114), AND the
     rank correlation (Spearman) between PC1 and BP-RP is |rho| >= 0.5.
  Also listed, not scored: the nearest field-star twins of WISE 0855 and eps Indi B (the two
  targets that are not saturated), measured the same way at their own moving places.

Output: notes/spectral_twins.json (git-ignored notes) and a printed summary.
Usage: uv run python spectral_twins.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

import catalogs

ROOT = Path(__file__).parent.parent
PACKS = ROOT / "public" / "data" / "packs" / "dr1qr3"
OVER = ROOT / "public" / "data" / "overlays"
FIVE = ["barnard", "w0855", "epsind-b", "rw-aur", "r-dra"]
PIX = 6.15
BAD = 1 | 2
EDGES = np.logspace(math.log10(0.75), math.log10(5.0), 25)
CENTRES = np.sqrt(EDGES[:-1] * EDGES[1:])


def frames_of(slug):
    m = json.loads((PACKS / slug / "manifest.json").read_text())
    n = m["grid"]["size"]
    out = []
    for f in m["frames"]:
        img = np.fromfile(PACKS / slug / f["image"], "<f4").reshape(n, n)
        fl = np.fromfile(PACKS / slug / f["flags"], "u1").reshape(n, n)
        out.append((f, img, fl))
    return n, out


SAT = 1


def flux_at(img, fl, x, y, why=None):
    n = img.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - x, yy - y)
    ap = r <= 2.0
    ann = (r >= 4.0) & (r <= 6.0) & ((fl & BAD) == 0) & np.isfinite(img)
    # Saturated pixels that hold data (off-detector pixels carry stray flags in these packs, #15).
    if why is not None and ((fl[ap] & SAT) > 0)[np.isfinite(img[ap])].any():
        why["sat"] = why.get("sat", 0) + 1
    if (fl[ap] & BAD).any() or not np.isfinite(img[ap]).all() or ann.sum() < 20:
        return None
    return float(img[ap].sum() - ap.sum() * np.median(img[ann]))


def spectrum(points, info=None):
    """points: [(lambda_um, flux)] -> 24-bin log shape, or None."""
    if not points:
        return None
    lam = np.array([p[0] for p in points])
    fx = np.array([p[1] for p in points])
    b = np.digitize(lam, EDGES) - 1
    med = np.full(24, np.nan)
    for k in range(24):
        v = fx[b == k]
        if v.size:
            med[k] = np.median(v)
    ok = np.isfinite(med)
    if ok.sum() < 20:
        return None
    if info is not None:
        info["interpolated"] = int((~ok).sum())
    x = np.log10(CENTRES)
    med = np.interp(x, x[ok], med[ok])
    norm = np.median(med)
    if not norm > 0:
        return None
    return np.log10(np.clip(med / norm, 1e-3, None))


def sources(slug, n):
    d = json.loads((OVER / f"overlay_{slug}.json").read_text().replace("NaN", "null"))
    c = (n - 1) / 2
    rows = d["gaia_dr3"]
    out = []
    for r in rows:
        if r.get("target") or r["G"] is None or r["G"] >= 16:
            continue
        at = r["at_season"]
        pos = {int(s): (c - v[2] / PIX, c + v[3] / PIX) for s, v in at.items()}
        x0, y0 = pos[min(pos)]
        if not (6 <= x0 <= n - 7 and 6 <= y0 <= n - 7):
            continue
        crowded = False
        for o in rows:
            if o is r or o["G"] is None or o["G"] >= r["G"] + 2:
                continue
            v = o["at_season"][str(min(pos))]
            if math.hypot(c - v[2] / PIX - x0, c + v[3] / PIX - y0) < 3:
                crowded = True
                break
        if not crowded:
            out.append(dict(id=r["source_id"], G=r["G"], pos=pos))
    targets = [dict(id="target:" + slug, G=r["G"], pos={int(s): (c - v[2] / PIX, c + v[3] / PIX) for s, v in r["at_season"].items()})
               for r in rows if r.get("target")]
    return out, targets


def measure(slug):
    n, frames = frames_of(slug)
    srcs, targets = sources(slug, n)
    res = []
    for s in srcs + (targets if slug in ("w0855", "epsind-b") else []):
        pts, why, info = [], {}, {}
        for f, img, fl in frames:
            p = s["pos"].get(f["season"])
            if p is None:
                continue
            v = flux_at(img, fl, *p, why)
            if v is not None:
                pts.append((f["lambdaUm"], v))
        sp = spectrum(pts, info)
        if sp is not None:
            res.append(dict(field=slug, id=s["id"], G=s["G"], photos=len(pts), shape=sp, sat=why.get("sat", 0),
                            interpolated=info.get("interpolated", 0), at=s["pos"][min(s["pos"])]))
    return res


def main():
    stars = [s for slug in FIVE for s in measure(slug)]
    field = [s for s in stars if not s["id"].startswith("target:")]
    print(f"{len(field)} field stars kept ({', '.join(f'{k}: {sum(s['field'] == k for s in field)}' for k in FIVE)}), "
          f"{len(stars) - len(field)} targets")
    X = np.array([s["shape"] for s in field])
    mean = X.mean(axis=0)
    _, sv, vt = np.linalg.svd(X - mean, full_matrices=False)
    comps = vt[:5]
    explained = (sv[:5] ** 2 / (sv ** 2).sum()).round(3).tolist()
    Z = (X - mean) @ comps.T
    Zn = Z / np.linalg.norm(Z, axis=1, keepdims=True)
    sim = Zn @ Zn.T
    np.fill_diagonal(sim, -2)
    twin = sim.argmax(axis=1)

    # Independent check: Gaia BP-RP by source id.
    ids = ",".join(s["id"] for s in field)
    rows = catalogs._tap(f"SELECT source_id, bp_rp FROM gaiadr3.gaia_source WHERE source_id IN ({ids})", url=catalogs.GAIA_TAP)
    bprp = {str(r["source_id"]): r["bp_rp"] for r in rows}
    col = np.array([bprp.get(s["id"]) if bprp.get(s["id"]) is not None else np.nan for s in field], float)
    have = np.isfinite(col)
    d_twin = np.abs(col - col[twin])
    d_twin = d_twin[have & np.isfinite(col[twin])]
    rng = np.random.default_rng(20261114)
    idx = np.nonzero(have)[0]
    a, b = rng.choice(idx, 1000), rng.choice(idx, 1000)
    keep = a != b
    d_rand = np.abs(col[a[keep]] - col[b[keep]])
    from scipy.stats import spearmanr
    rho = float(spearmanr(Z[have, 0], col[have]).statistic)
    med_t, med_r = float(np.median(d_twin)), float(np.median(d_rand))
    ok = med_t < 0.5 * med_r and abs(rho) >= 0.5
    print(f"PCA explained (5): {explained}")
    print(f"median |dBP-RP|: twins {med_t:.3f} vs random pairs {med_r:.3f} (ratio {med_t / med_r:.2f}); "
          f"Spearman PC1 vs BP-RP {rho:+.2f} (n={int(have.sum())})  ->  {'PASS' if ok else 'FAIL'} (rule: ratio < 0.5 and |rho| >= 0.5)")

    # Not scored: the two unsaturated targets' nearest field twins.
    tlist = []
    for s in stars:
        if not s["id"].startswith("target:"):
            continue
        z = (s["shape"] - mean) @ comps.T
        zs = z / np.linalg.norm(z)
        cs = Zn @ zs
        top = np.argsort(-cs)[:3]
        tlist.append(dict(target=s["id"], photos=s["photos"], pc=z.round(3).tolist(),
                          twins=[dict(id=field[k]["id"], field=field[k]["field"], G=field[k]["G"], cos=round(float(cs[k]), 3),
                                      bp_rp=None if not np.isfinite(col[k]) else round(float(col[k]), 2)) for k in top]))
        print(s["id"], "PC", z.round(2).tolist(), "nearest:", [(t["id"][-6:], t["field"], t["cos"], t["bp_rp"]) for t in tlist[-1]["twins"]])
    out = dict(method=__doc__.split("Method")[1].split("Output:")[0].strip(), nField=len(field), explained=explained,
               medianTwin=med_t, medianRandom=med_r, spearmanPC1=rho, verdict="PASS" if ok else "FAIL",
               components=comps.round(4).tolist(), lambdaUm=CENTRES.round(4).tolist(), targets=tlist,
               stars=[dict(field=s["field"], id=s["id"], G=s["G"], photos=s["photos"], bp_rp=None if not np.isfinite(col[i]) else float(col[i]),
                           twin=field[twin[i]]["id"], cos=round(float(sim[i, twin[i]]), 3)) for i, s in enumerate(field)])
    (ROOT / "notes" / "spectral_twins.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__" and __import__("sys").argv[1:] != ["--v2"]:
    main()


# ---------------------------------------------------------------- v2: Neural's harder tests

V2_DOC = """v2 (14 Nov 2026, after Neural's review of v1): descriptive, on the same 36 stars; v1's PASS stands
but is "easy" (PC1 is the continuum slope, i.e. temperature, so BP-RP agreement is nearly given).
  - Twins by Euclidean distance in 4 PCs (amplitude kept), beside v1's cosine in 5.
  - Residual tests (what BP-RP can't predict): Gaia DR3 logg_gspphot and CatWISE2020 W1-W2, each
    with its linear trend on BP-RP removed; twin |residual difference| vs random pairs.
  - Held-out bins: PCA fit on 20 bins; the 4 withheld (2 near 2.2-2.5 um, 2 at 4.2-5 um) predicted
    by the twin's; error vs the error using a random star.
  - Bootstrap 95% CIs over stars (2,000 draws, seed 20261114).
  - Field leakage: share of twins in the star's own field vs the share expected from field sizes.
  - Flags reported: stars with any saturated aperture photo, Gaia phot_variable_flag VARIABLE,
    bins interpolated, results by G bin."""


def v2():
    rng = np.random.default_rng(20261114)
    stars = [s for slug in FIVE for s in measure(slug) if not s["id"].startswith("target:")]
    X = np.array([s["shape"] for s in stars])
    n = len(stars)
    ids = ",".join(s["id"] for s in stars)
    rows = catalogs._tap("SELECT source_id, bp_rp, logg_gspphot, phot_variable_flag, ra, dec FROM gaiadr3.gaia_source "
                         f"WHERE source_id IN ({ids})", url=catalogs.GAIA_TAP)
    g = {str(r["source_id"]): r for r in rows}
    bprp = np.array([g[s["id"]]["bp_rp"] if g.get(s["id"]) and g[s["id"]]["bp_rp"] is not None else np.nan for s in stars], float)
    logg = np.array([g[s["id"]]["logg_gspphot"] if g.get(s["id"]) and g[s["id"]]["logg_gspphot"] is not None else np.nan for s in stars], float)
    var = [bool(g.get(s["id"]) and g[s["id"]]["phot_variable_flag"] == "VARIABLE") for s in stars]
    # CatWISE W1-W2 by position (within 3"), one cone per field.
    w12 = np.full(n, np.nan)
    for slug in FIVE:
        m = json.loads((PACKS / slug / "manifest.json").read_text())["grid"]["centre"]
        cw = catalogs.catwise2020(m["ra"], m["dec"], 0.08, w2max=17.0)
        for i, s in enumerate(stars):
            if s["field"] != slug or s["id"] not in g:
                continue
            ra, dec = g[s["id"]]["ra"], g[s["id"]]["dec"]
            best = min(cw, key=lambda c: math.hypot((c["ra"] - ra) * math.cos(math.radians(dec)), c["dec"] - dec), default=None)
            if best and best.get("w1") is not None and math.hypot((best["ra"] - ra) * math.cos(math.radians(dec)), best["dec"] - dec) * 3600 < 3:
                w12[i] = best["w1"] - best["mag"]

    def pca(A, k):
        mu = A.mean(axis=0)
        _, sv, vt = np.linalg.svd(A - mu, full_matrices=False)
        return mu, vt[:k], (sv[:k] ** 2 / (sv ** 2).sum())

    mu, comps, _ = pca(X, 5)
    Z5 = (X - mu) @ comps.T
    Zn = Z5 / np.linalg.norm(Z5, axis=1, keepdims=True)
    cos = Zn @ Zn.T
    np.fill_diagonal(cos, -2)
    twin_cos = cos.argmax(axis=1)
    Z4 = Z5[:, :4]
    dist = np.linalg.norm(Z4[:, None] - Z4[None], axis=2)
    np.fill_diagonal(dist, np.inf)
    twin_euc = dist.argmin(axis=1)

    def residual(y):
        ok = np.isfinite(y) & np.isfinite(bprp)
        if ok.sum() < 8:
            return np.full(n, np.nan)
        a, b = np.polyfit(bprp[ok], y[ok], 1)
        return y - (a * bprp + b)

    def boot_ratio(q, twin):
        """median |q - q[twin]| / median |q_a - q_b| over random pairs, with a bootstrap CI over stars."""
        ok = np.nonzero(np.isfinite(q) & np.isfinite(q[twin]))[0]
        allq = np.nonzero(np.isfinite(q))[0]
        if len(ok) < 8:
            return None
        def one(sel):
            dt = np.abs(q[sel] - q[twin[sel]])
            a, b = rng.choice(allq, 1000), rng.choice(allq, 1000)
            k = a != b
            return float(np.median(dt) / np.median(np.abs(q[a[k]] - q[b[k]])))
        est = one(ok)
        bs = [one(rng.choice(ok, len(ok))) for _ in range(2000)]
        return dict(ratio=round(est, 3), ci95=[round(float(np.percentile(bs, 2.5)), 3), round(float(np.percentile(bs, 97.5)), 3)], n=int(len(ok)))

    out = {}
    for name, twin in (("cosine5", twin_cos), ("euclid4", twin_euc)):
        r = dict(bp_rp=boot_ratio(bprp, twin), logg_resid=boot_ratio(residual(logg), twin), w1w2_resid=boot_ratio(residual(w12), twin))
        same = np.mean([stars[i]["field"] == stars[twin[i]]["field"] for i in range(n)])
        sizes = np.array([sum(s["field"] == f for s in stars) for f in FIVE])
        expect = float(np.sum(sizes * (sizes - 1)) / (n * (n - 1)))
        r["sameField"] = dict(observed=round(float(same), 3), expectedIfNoField=round(expect, 3))
        r["mutualPairs"] = int(sum(twin[twin[i]] == i for i in range(n)) // 2)
        out[name] = r
    # Held-out bins: 2 bins nearest 2.2-2.5 um and the 2 longest (4.2-5 um).
    held = sorted({int(np.argmin(np.abs(CENTRES - 2.25))), int(np.argmin(np.abs(CENTRES - 2.45))), 22, 23})
    keep = [k for k in range(24) if k not in held]
    mu2, c2, _ = pca(X[:, keep], 4)
    Zh = (X[:, keep] - mu2) @ c2.T
    dh = np.linalg.norm(Zh[:, None] - Zh[None], axis=2)
    np.fill_diagonal(dh, np.inf)
    tw = dh.argmin(axis=1)
    err_t = np.abs(X[:, held] - X[tw][:, held]).mean(axis=1)
    rnd = np.array([rng.choice([j for j in range(n) if j != i]) for i in range(n)])
    err_r = np.abs(X[:, held] - X[rnd][:, held]).mean(axis=1)
    bs = []
    for _ in range(2000):
        sel = rng.choice(n, n)
        bs.append(np.median(err_t[sel]) / np.median(err_r[sel]))
    out["heldOutBins"] = dict(bins_um=CENTRES[held].round(3).tolist(), medianErrTwin_dex=round(float(np.median(err_t)), 4),
                              medianErrRandom_dex=round(float(np.median(err_r)), 4),
                              ratio=round(float(np.median(err_t) / np.median(err_r)), 3),
                              ci95=[round(float(np.percentile(bs, 2.5)), 3), round(float(np.percentile(bs, 97.5)), 3)])
    out["flags"] = dict(anySaturatedPhoto=int(sum(s["sat"] > 0 for s in stars)), gaiaVariable=int(sum(var)),
                        interpolatedBins={str(k): int(sum(s["interpolated"] == k for s in stars)) for k in range(5)},
                        byG={lab: int(sum(lo <= s["G"] < hi for s in stars)) for lab, lo, hi in (("<12", 0, 12), ("12-14", 12, 14), ("14-16", 14, 16))},
                        withLogg=int(np.isfinite(logg).sum()), withW1W2=int(np.isfinite(w12).sum()))
    out["doc"] = V2_DOC
    print(json.dumps({k: v for k, v in out.items() if k != "doc"}, indent=1))
    (ROOT / "notes" / "spectral_twins_v2.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__" and __import__("sys").argv[1:] == ["--v2"]:
    v2()
