"""Score the first V look (prereg/V_LOOK_1.md): frozen v4 on V-1, V-2 and V-3.

Order, so that no V output can move a threshold:
1. The N-tier thresholds are rebuilt from the T6 null files (scripts/t6_score.load_nulls, the same kept visit set as
   T6, N-4 and N-6 left out as guard-void). The primary pair must equal T6's stored v4 thresholds exactly, or the
   scorer stops. The secondary pair (FAR 1.0) comes from the same rule. Both are written out before any V file is read.
2. V injection passes 0 and 1: every denominator fake (smo.score.t6.recovery's rule), recovered at each operating
   point; m50 and m90 with the fake bootstrap, the patch bootstrap and the N-null threshold bootstrap; per detector
   pair; fast movers; completeness by distance to the nearest Gaia G < 16 source and by rate.
3. Per-patch FAR from each V patch's scramble_guard0 run, and its guard (reported only).
4. The real runs: passing candidates above the primary thresholds, matched to known asteroids; the rest listed as
   unexplained, flagged "possibly variable" on a catalogued or stacked static source.
5. --realism: the Q3 gate on the V pool (a separate V look): yardstick_realism.measure_patch on each V patch's pass 0,
   recovery at the primary thresholds, the Y3 gate with its sensitivity variants; D pool quoted; D+V pooled reported.

Usage: uv run python scripts/v_look_score.py --check        (inputs only, by file presence; reads no candidate)
       uv run python scripts/v_look_score.py                (items 1-5 and 7 of V_LOOK_1; refuses on incomplete inputs)
       uv run --extra ephem python scripts/v_look_score.py --realism [workers]   (item 6)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

PATCHES = ("V-1", "V-2", "V-3")
PASSES = (0, 1)
METHOD = "v4"
LEAVES = ("real", *(f"pass{k}" for k in PASSES), "scramble_guard0")
FAR_PRIMARY, FAR_SECONDARY = 0.1, 1.0
N_BOOT = 500
MIN_FIT = 20  # fewer fakes than this in a subset: no logistic fit, the count is reported
PARTNER = {1: 4, 2: 5, 3: 6, 4: 1, 5: 2, 6: 3}
GAIA_BINS = (0.0, 2.0, 5.0, 10.0, np.inf)  # px to the nearest Gaia G < 16 source (YARDSTICK §6 maps); bins (lo, hi]
RATE_BINS = (0.0, 0.25, 1.0, np.inf)  # px per exposure step; bins (lo, hi], the first includes 0
FAST_MIN_N = 100
OUT = ROOT / "runs/yardstick/V_LOOK_1"
T6 = json.loads((ROOT / "runs/yardstick/T6/t6_result.json").read_text())
VOID = tuple(T6["guard_void_patches"])  # N-4, N-6


def run_dir(patch, leaf):
    return ROOT / "runs/yardstick" / patch / METHOD / leaf


def _centres() -> dict:
    import csv

    with open(ROOT / "prereg/patches.csv") as fh:
        return {r["patch"]: (float(r["ra"]), float(r["dec"])) for r in csv.DictReader(fh)}


def _step_tag(patch, leaf):
    return f"{patch}_{METHOD}_{leaf.removeprefix('pass')}"


def check_inputs() -> list[str]:
    """Every registered step has finished (its queue marker exists) and every input file is present. Visits that failed
    inside a finished step are not a refusal: they are handled by the registered rules (V_LOOK_1, amendment A1)."""
    problems = []
    for p in PATCHES:
        rf = ROOT / "runs/yardstick" / p / "refetch.json"
        if not rf.exists():
            problems.append(f"{p}: no refetch.json")
        else:
            r = json.loads(rf.read_text())
            if r["verified"] != r["n"] or r["mismatches"] or r["failures"]:
                problems.append(f"{p}: refetch verified {r['verified']}/{r['n']}")
        for f in (ROOT / "runs/yardstick" / p / "areas.json", ROOT / "runs/yardstick" / p / "known.json",
                  ROOT / "cache/v1" / p / "static.json", ROOT / "cache/patch" / f"{p}_frames.json"):
            if not f.exists():
                problems.append(f"{p}: no {f.relative_to(ROOT)}")
        for leaf in LEAVES:
            if not (run_dir(p, leaf) / "_set.json").exists() or not (ROOT / "runs/v_done" / _step_tag(p, leaf)).exists():
                problems.append(f"{p}/{leaf}: step not finished")
    return problems


REGISTERED_CRASH = "FAILED AssertionError('zone interpolation weights do not sum to 1')"  # METHOD_V6 note 2


def gaps() -> dict:
    """{patch/leaf: [visits in the manifest with no output]} (failed targets). A gap is accepted only if the step's log
    records the registered injection crash for it (V_LOOK_1 A2); any other cause (a killed worker, a full disk) refuses,
    so the target is re-run instead."""
    import re

    from smo.score.evalsets import visit_files_with_gaps

    out = {}
    for p in PATCHES:
        for leaf in LEAVES:
            missing = visit_files_with_gaps(run_dir(p, leaf), leaf)[1]
            if missing:
                log = (ROOT / "runs" / f"v_{p}_{METHOD}_{leaf.removeprefix('pass')}.log").read_text()
                why = {m.group(1): m.group(2) for m in re.finditer(r"^\s+\d+/\d+ (\S+): (FAILED .*)$", log, re.M)}
                bad = [v for v in missing if why.get(v) != REGISTERED_CRASH]
                if bad:
                    raise SystemExit(f"{p}/{leaf}: targets missing for an unregistered reason, re-run them: "
                                     f"{[(v, why.get(v, 'no FAILED line')) for v in bad]}")
            out[f"{p}/{leaf}"] = missing
    return out


def n_tier_thresholds():
    """(far, scr, thr_primary, thr_secondary): v4's kept N-tier null visits and both operating points."""
    import t6_score
    from smo.score import t6

    kept, _, _, _, _ = t6_score.load_nulls()
    far = [v for v in kept["N-far"][METHOD] if v.vid.split("/")[0] not in VOID]
    scr = [v for v in kept["N-scramble"][METHOD] if v.vid.split("/")[0] not in VOID]
    del kept
    thr1 = t6.operating_thresholds(far, scr, FAR_PRIMARY)
    for b in t6.BANDS:
        if thr1[b]["t"] != T6["thresholds"][METHOD][b]["t"]:
            raise SystemExit(f"rebuilt {b} threshold {thr1[b]['t']!r} differs from T6's {T6['thresholds'][METHOD][b]['t']!r}")
    thr2 = t6.operating_thresholds(far, scr, FAR_SECONDARY)
    return far, scr, thr1, thr2


def _det(path) -> int:
    return int(Path(path).name.split("_D")[1][0])


def _exposure(path) -> int:
    return int(Path(path).name.split("_")[3])


def _pair(frames) -> int:
    d = _det(frames[0])
    return min(d, PARTNER[d])


def load_injection():
    """Every pass visit (slimmed exactly as T6's loader) with (patch, pair); failed targets regenerated (A1)."""
    import t6_score
    from smo.data.patch import Frame, by_visit
    from smo.inject.clones import Orbits
    from smo.inject.plan import plan_visit
    from smo.score.evalsets import visit_files_with_gaps
    from smo.score.yardstick import VisitResult

    from smo.inject.truth import unseal

    visits, meta, dropped, failed = [], [], [], []
    orbits, centres, gp = None, _centres(), gaps()
    for p in PATCHES:
        fbv = by_visit([Frame(**r) for r in json.loads((ROOT / "cache/patch" / f"{p}_frames.json").read_text())])
        for k in PASSES:
            ok_files = visit_files_with_gaps(run_dir(p, f"pass{k}"), f"pass{k}")[0]
            for f in ok_files:
                rec = json.loads(f.read_text())
                if rec.get("fit_failures"):
                    dropped.append(f"{p}/pass{k}/{rec['visit']}")
                visits.append(t6_score._slim_visit(t6_score._slim(rec), 1.0))
                meta.append((p, _pair(rec["frames"])))
            if gp[f"{p}/pass{k}"]:
                if orbits is None:
                    orbits = Orbits.from_snapshot(ROOT / "cache/ephem/mpc_orbits_snapshot.npz")
                # A2: first, regenerating a sealed visit of the same patch and pass must give its sealed truth exactly.
                ref = json.loads(ok_files[0].read_text())
                sealed = unseal(Path(ref["truth"]["path"]), ref["truth"]["sha256"])
                regen = plan_visit(p, centres[p], fbv[ref["visit"]], orbits, k, ROOT / "cache")
                key = lambda ts: [(round(t["ra_t0"], 10), round(t["dec_t0"], 10), round(t["m_ref"], 10)) for t in ts]  # noqa: E731
                if regen.seed != sealed["seed"] or key(regen.truth) != key(sealed["fakes"]):
                    raise SystemExit(f"{p}/pass{k}: regenerating {ref['visit']} does not give its sealed truth")
            for vis in gp[f"{p}/pass{k}"]:
                # A1: the target failed, so no truth was sealed; the same plan is regenerated (same seed, same orbits
                # snapshot) and its denominator fakes count as misses.
                plan = plan_visit(p, centres[p], fbv[vis], orbits, k, ROOT / "cache")
                truth = [t for t in plan.truth if "skipped" not in t and t["n_valid_frames"] >= 2]
                visits.append(VisitResult(vis, 1.0, [], truth))
                meta.append((p, _pair([fr.path for fr in fbv[vis]])))
                failed.append({"visit": f"{p}/pass{k}/{vis}", "fakes_counted_as_misses": len(truth)})
    return visits, meta, dropped, failed


def rendered_rate_px(t, areas, wcs_cache) -> float | None:
    """A fake's rate as rendered: sky motion between its first and last valid exposure on one detector (the detector
    whose valid frames span the most exposures), per 129 s exposure step, in 6.15 arcsec pixels. None if it spans one exposure."""
    import t6_score
    from smo.score import t6
    from smo.score.yardstick import _sep_arcsec

    by_det: dict = {}
    for fp, fr in t.get("frames", {}).items():
        if fr.get("valid"):
            by_det.setdefault(_det(fp), []).append((_exposure(fp), fp, fr))
    if not by_det:
        return None
    fs = sorted(max(by_det.values(), key=lambda v: (max(e for e, _, _ in v) - min(e for e, _, _ in v), len(v))))
    (e0, f0, r0), (e1, f1, r1) = fs[0], fs[-1]
    if e1 == e0:
        return None
    a = t6_score._frame_wcs(areas, Path(f0).stem, wcs_cache).pixel_to_world_values(r0["x_mid"], r0["y_mid"])
    b = t6_score._frame_wcs(areas, Path(f1).stem, wcs_cache).pixel_to_world_values(r1["x_mid"], r1["y_mid"])
    return float(_sep_arcsec(float(a[0]), float(a[1]), np.array([float(b[0])]), np.array([float(b[1])]))[0]) / (e1 - e0) / t6.PX_ARCSEC


def fake_table(visits, meta, thr, rates=None):
    """Per denominator fake: patch, pair, m_ref, rate (px per step, as rendered; the truth field's rate where only one
    exposure is valid), ra, dec, recovered at thr. Built in the same order as smo.score.t6.recovery, which is asserted
    to agree."""
    import t6_score
    from smo.score import t6
    from smo.score.yardstick import match

    areas = {p: t6_score._areas(p) for p in PATCHES} if rates is None else None
    wcs_cache: dict = {}
    rows, n = [], 0
    for v, (p, pair) in zip(visits, meta, strict=True):
        ok = [c for c in v.cands if c["passes"] and c["score"] > thr[t6.band_of(c)]["t"]]
        pairs, _ = match(ok, v.truth)
        for j, t in enumerate(v.truth):
            if rates is None:
                rr = rendered_rate_px(t, areas[p], wcs_cache)
                rate, src = (rr, "rendered") if rr is not None else (t["rate_arcsec_per_s"] * t6.STEP_S / t6.PX_ARCSEC, "truth field")
            else:
                rate, src = rates[n]
            rows.append({"patch": p, "pair": pair, "m_ref": t["m_ref"], "ra": t["ra_t0"], "dec": t["dec_t0"],
                         "rate_px": rate, "rate_from": src, "rec": j in pairs})
            n += 1
    m, r = t6.recovery(visits, thr)
    if not (np.array_equal(m, [x["m_ref"] for x in rows]) and np.array_equal(r, [x["rec"] for x in rows])):
        raise SystemExit("fake table disagrees with smo.score.t6.recovery")
    return rows


def gaia_distance_px(rows):
    """Distance from each fake's t0 position to the nearest Gaia DR3 source with G < 16 (catalogue positions
    propagated to each patch's median visit time), in 6.15 arcsec pixels."""
    import astropy.units as u
    from astropy.coordinates import SkyCoord

    from smo.catalogs import gaia
    from smo.score import t6

    out = np.full(len(rows), np.inf)
    centres = _centres()
    for p in PATCHES:
        idx = [i for i, r in enumerate(rows) if r["patch"] == p]
        if not idx:
            continue
        g = gaia.cone(*centres[p], 0.75, ROOT / "cache")
        known = json.loads((ROOT / "runs/yardstick" / p / "known.json").read_text())
        mjd = float(np.median([v["t0"] for v in known["visits"].values()])) if known["visits"] else 61000.0
        ra, dec = gaia.propagate(g, mjd)
        gm = np.asarray(g["phot_g_mean_mag"].to_numpy(zero_copy_only=False), float)
        sel = np.isfinite(gm) & (gm < 16)
        cat = SkyCoord(ra[sel] * u.deg, dec[sel] * u.deg)
        fk = SkyCoord([rows[i]["ra"] for i in idx] * u.deg, [rows[i]["dec"] for i in idx] * u.deg)
        _, sep, _ = fk.match_to_catalog_sky(cat)
        out[idx] = sep.arcsec / t6.PX_ARCSEC
    return out


def threshold_bootstrap(far, scr) -> dict:
    """{far0: [per-resample thresholds]} for both operating points, from N-tier visits only: seed 0 and the draw order of
    t6.null_bootstrap, so at FAR 0.1 these are T6's own v4 bootstrap. Checked against T6 before any V file is read: the
    threshold half-widths, and the D-1 m50 half-width propagated through t6.recovery, both exactly."""
    import t6_score
    from smo.score import t6

    out = {}
    for far0 in (FAR_PRIMARY, FAR_SECONDARY):
        rng = np.random.default_rng(0)
        out[far0] = []
        for _ in range(N_BOOT):
            i, j = rng.integers(0, len(far), len(far)), rng.integers(0, len(scr), len(scr))
            out[far0].append(t6.operating_thresholds([far[k] for k in i], [scr[k] for k in j], far0))
    for bd in t6.BANDS:
        hw = t6.half_width68([th[bd]["t"] for th in out[FAR_PRIMARY]])
        if hw != T6["gpd"][METHOD][bd]["boot_half_width68"]:
            raise SystemExit(f"threshold bootstrap {bd} half-width {hw!r} differs from T6's")
    d1 = t6_score.d1_injection(METHOD)
    hw = t6.half_width68([t6.m50_point(*t6.recovery(d1, th)) for th in out[FAR_PRIMARY]])
    del d1
    if hw != T6["completeness"][METHOD]["null_boot_half_width68"]:
        raise SystemExit(f"D-1 m50 null-bootstrap half-width {hw!r} differs from T6's")
    return out


def fit(m, r, n_boot=N_BOOT) -> dict:
    """yardstick.m50_m90, or the counts alone when the subset is too small to fit."""
    from smo.score.yardstick import m50_m90

    if len(m) < MIN_FIT or r.sum() < 5:
        return {"n": int(len(m)), "k": int(r.sum()), "note": "too few fakes or recoveries to fit; no m50"}
    return m50_m90(m, r, n_boot)


def ci68(b) -> dict:
    b = np.asarray(b, float)
    fin = b[np.isfinite(b)]
    return {"ci68": [float(np.percentile(fin, 16)), float(np.percentile(fin, 84))] if len(fin) else None,
            "reached_fraction": float(len(fin) / len(b)) if len(b) else None}


def binned(x, edges, m, r):
    from smo.score import t6
    from smo.score.yardstick import wilson

    out = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        s = ((x >= lo) if lo == 0.0 else (x > lo)) & (x <= hi)
        n, k = int(s.sum()), int(r[s].sum())
        out.append({"lo": float(lo), "hi": float(hi), "closed": "(lo, hi]" if lo > 0 else "[lo, hi]", "n": n, "k": k,
                    "c": k / n if n else None, "wilson95": list(wilson(k, n)) if n else None,
                    "m50_point": t6.m50_point(m[s], r[s]) if n >= 50 else None})
    return out


def headline(visits, meta, boot_thr, thr, gaia_px, rates=None):
    from smo.score import t6
    from smo.score.yardstick import completeness_bins, m_at

    rows = fake_table(visits, meta, thr, rates)
    m = np.array([x["m_ref"] for x in rows])
    r = np.array([x["rec"] for x in rows], bool)
    pid = np.array([x["patch"] for x in rows])
    pair = np.array([x["pair"] for x in rows])
    rate = np.array([x["rate_px"] for x in rows])
    fast = rate > 1.0
    subsets = {"all": np.ones(len(m), bool), **{f"D{q}/D{PARTNER[q]}": pair == q for q in (1, 2, 3)},
               **{p: pid == p for p in PATCHES}}
    if fast.sum() >= FAST_MIN_N:
        subsets["fast"] = fast
    out = {"all": fit(m, r), "bins": completeness_bins(m, r),
           "per_pair": {k: {**fit(m[s], r[s]), "bins": completeness_bins(m[s], r[s])} for k, s in subsets.items() if k.startswith("D")},
           "per_patch": {p: fit(m[pid == p], r[pid == p]) for p in PATCHES},
           "fast_movers": ({"n": int(fast.sum()), **fit(m[fast], r[fast])} if fast.sum() >= FAST_MIN_N else
                           {"n": int(fast.sum()), "note": f"fewer than {FAST_MIN_N} fakes above 1 px per step; no m50 "
                                                          "(the dedicated NEO set of YARDSTICK §6 is not added: V_LOOK_1 A1)"}),
           "by_rate_px_per_step": binned(rate, RATE_BINS, m, r), "by_gaia_g16_distance_px": binned(gaia_px, GAIA_BINS, m, r),
           "rate_from_counts": {k: sum(1 for x in rows if x["rate_from"] == k) for k in ("rendered", "truth field")}}

    def m50_m90_point(mm, rr):
        if len(mm) < MIN_FIT or rr.sum() < 5:
            return float("nan"), float("nan")
        c, a, w = t6._logistic_fit(mm, rr)
        return m_at(0.5, c, a, w), m_at(0.9, c, a, w)

    # Patch bootstrap (3 patches: crude, reported as such), for every subset.
    rng = np.random.default_rng(1)
    pb = {k: ([], []) for k in subsets}
    for _ in range(N_BOOT):
        i = np.concatenate([np.flatnonzero(pid == q) for q in rng.choice(PATCHES, len(PATCHES), replace=True)])
        for k, s in subsets.items():
            if k in PATCHES:
                continue
            a, b = m50_m90_point(m[i][s[i]], r[i][s[i]])
            pb[k][0].append(a)
            pb[k][1].append(b)
    # Threshold bootstrap (Y3 item 6): the N-tier resamples drawn and checked before any V file was read.
    tb, mb = {bd: [] for bd in t6.BANDS}, {k: ([], []) for k in subsets}
    for th in boot_thr:
        for bd in t6.BANDS:
            tb[bd].append(th[bd]["t"])
        mm, rr = t6.recovery(visits, th)
        for k, s in subsets.items():
            a, b = m50_m90_point(mm[s], rr[s])
            mb[k][0].append(a)
            mb[k][1].append(b)
    out["threshold_boot_t"] = {bd: {**ci68(tb[bd]), "half_width68": t6.half_width68(tb[bd])} for bd in t6.BANDS}
    intervals = {k: {**({} if k in PATCHES else {"patch_boot_m50": ci68(pb[k][0]), "patch_boot_m90": ci68(pb[k][1])}),
                     "threshold_boot_m50": ci68(mb[k][0]), "threshold_boot_m90": ci68(mb[k][1])} for k in subsets}
    out["all"].update(intervals["all"])
    for k in subsets:
        if k.startswith("D"):
            out["per_pair"][k].update(intervals[k])
        elif k in PATCHES:
            out["per_patch"][k].update(intervals[k])
        elif k == "fast":
            out["fast_movers"].update(intervals[k])
    return out, rows, t6.completeness_curve(m, r)


def per_patch_far(thr, curve, fake_pos):
    """Each V patch's N-scramble FAR at the primary thresholds (guard-fake matches removed; pseudo-visits with a dropped
    frame and failed pseudo-visits left out and listed, with the lost area where a record exists), the exact Poisson 95%
    interval, the deciding reading of A1, T6's sensitivity lines, and the guard (reported only)."""
    from scipy import stats

    import t6_score
    from smo.inject.truth import unseal
    from smo.score import t6
    from smo.score.evalsets import visit_files_with_gaps
    from smo.score.yardstick import _sep_arcsec, match

    def bounds(k, area):
        lo = stats.chi2.ppf(0.025, 2 * k) / 2 if k else 0.0
        return [lo / area, stats.chi2.ppf(0.975, 2 * (k + 1)) / 2 / area] if area else None

    def power80(area):
        """The true FAR at which this patch fails the A1 rule with 80% probability (events needed: the smallest k whose
        Poisson lower bound exceeds 2 FAR0)."""
        from scipy.optimize import brentq

        k = next(k for k in range(1, 10000) if stats.chi2.ppf(0.025, 2 * k) / 2 / area > 2 * FAR_PRIMARY)
        return {"events_to_fail": k, "far_for_80pct": float(brentq(lambda lam: stats.poisson.sf(k - 1, lam * area) - 0.8, 1e-6, 1e3))}

    out, gp = {}, gaps()
    pooled_k, pooled_area, pooled_near = 0, 0.0, 0
    for p in PATCHES:
        areas = t6_score._areas(p)
        wcs_cache: dict = {}
        k, area, gone, gone_area, gone_events, guard, near = 0, 0.0, [], 0.0, 0, [], 0
        for f in visit_files_with_gaps(run_dir(p, "scramble_guard0"), "scramble_guard0")[0]:
            rec = t6_score._slim(json.loads(f.read_text()))
            vr = t6_score._slim_visit(rec)
            nv = t6.null_visit(f"{p}/{rec['visit']}", rec["candidates"], vr.truth, t6_score._visit_area(rec, areas))
            above = [(s, b) for s, b in nv.events if s > thr[b]["t"]]
            if rec.get("fit_failures"):
                gone.append(rec["visit"])
                gone_area += nv.area
                gone_events += len(above)
                continue
            k += len(above)
            area += nv.area
            guard.append(vr)
            # T6 sensitivity line: events within 1.5 px plus 3 steps of their own motion of any guard fake's per-frame
            # injected position (guard fakes are not coherent movers in a pseudo-visit).
            t = unseal(Path(rec["truth"]["path"]), rec["truth"]["sha256"])
            pos = []
            for fk in t["fakes"]:
                for fp, fr in fk.get("frames", {}).items():
                    pos.append(t6_score._frame_wcs(areas, Path(fp).stem, wcs_cache).pixel_to_world_values(fr["x_mid"], fr["y_mid"]))
            pos = np.array(pos, float).reshape(-1, 2)
            ok = [c for c in rec["candidates"] if c["passes"]]
            _, used = match(ok, vr.truth) if vr.truth else ({}, set())
            for c in [c for i, c in enumerate(ok) if i not in used]:  # the surviving events only
                if c["score"] > thr[t6.band_of(c)]["t"] and len(pos):
                    rad = t6.MATCH_ARCSEC + np.hypot(c["v_xi"], c["v_eta"]) * 3 * t6.STEP_S
                    near += int(np.min(_sep_arcsec(c["ra"], c["dec"], pos[:, 0], pos[:, 1])) <= rad)
        far_v = k / area if area else float("nan")
        ci = bounds(k, area)
        lo_rate = ci[0] if ci else float("nan")
        pooled_k, pooled_area, pooled_near = pooled_k + k, pooled_area + area, pooled_near + near
        out[p] = {"events": k, "area_deg2_visits": area, "far": far_v, "far_poisson95": ci,
                  "power_of_a1_rule": power80(area) if area else None,
                  "expected_at_far0": FAR_PRIMARY * area,
                  "counts": bool(area and lo_rate <= 2 * FAR_PRIMARY),  # A1: fails only on evidence that FAR > 2 FAR0
                  "point_estimate_within_2x": bool(far_v <= 2 * FAR_PRIMARY),
                  "within_two_sided": bool(FAR_PRIMARY / 2 <= far_v <= 2 * FAR_PRIMARY),
                  "events_near_guard_fakes": near, "events_not_near_guard_fakes": k - near,
                  "dropped_frame_pseudo_visits": gone, "dropped_frame_area": gone_area, "dropped_frame_events_above": gone_events,
                  "failed_pseudo_visits": gp[f"{p}/scramble_guard0"],
                  "guard_reported_only": t6_score.guard_check(guard, thr, curve),
                  "possibly_variable_chance_rate": fake_pos.get(p)}
        out[p]["readings_disagree"] = out[p]["counts"] != out[p]["point_estimate_within_2x"]
    out["V-pooled"] = {"events": pooled_k, "area_deg2_visits": pooled_area, "far": pooled_k / pooled_area if pooled_area else None,
                       "far_poisson95": bounds(pooled_k, pooled_area), "events_near_guard_fakes": pooled_near,
                       "note": "reported only; the per-patch rule decides"}
    return out


def _flagger(p):
    """f(ra, dec) -> (on_gaia, on_static): within 1.5 px of any Gaia DR3 source or of the patch's v1 static lists."""
    from smo.catalogs import gaia
    from smo.score import t6
    from smo.score.yardstick import _sep_arcsec

    st = _static_positions(json.loads((ROOT / "cache/v1" / p / "static.json").read_text()))
    g = gaia.cone(*_centres()[p], 0.75, ROOT / "cache")
    gra, gdec = np.asarray(g["ra"].to_numpy(), float), np.asarray(g["dec"].to_numpy(), float)

    def f(ra, dec):
        on_g = bool(len(gra)) and float(np.min(_sep_arcsec(ra, dec, gra, gdec))) <= t6.MATCH_ARCSEC
        on_s = bool(len(st)) and float(np.min(_sep_arcsec(ra, dec, st[:, 0], st[:, 1]))) <= t6.MATCH_ARCSEC
        return on_g, on_s
    return f


def flag_chance(rows) -> dict:
    """The fraction of fake t0 positions (placed at random on the sky) that the "possibly variable" flag would mark."""
    out = {}
    for p in PATCHES:
        f = _flagger(p)
        fl = [f(x["ra"], x["dec"]) for x in rows if x["patch"] == p]
        if fl:
            out[p] = {"n": len(fl), "either": float(np.mean([a or b for a, b in fl])), "gaia": float(np.mean([a for a, _ in fl])),
                      "static": float(np.mean([b for _, b in fl]))}
    return out


def real_output(thr):
    """The search's real output at the primary thresholds: recovered known asteroids and unexplained candidates."""
    import t6_score
    from smo.score import t6
    from smo.score.evalsets import visit_files_with_gaps
    from smo.score.yardstick import match

    out, gp = {}, gaps()
    for p in PATCHES:
        known = json.loads((ROOT / "runs/yardstick" / p / "known.json").read_text())["visits"]
        flag = _flagger(p)
        rec_k, unexpl, n_known, dropped = [], [], 0, []
        for f in visit_files_with_gaps(run_dir(p, "real"), "real")[0]:
            rec = t6_score._slim(json.loads(f.read_text()))
            if rec.get("fit_failures"):
                dropped.append(rec["visit"])
            ok = [c for c in rec["candidates"] if c["passes"] and c["score"] > thr[t6.band_of(c)]["t"]]
            objs = known.get(rec["visit"], {}).get("objects", [])
            n_known += len(objs)
            pairs, used = match(ok, objs)
            for j, i in pairs.items():
                rec_k.append({"visit": rec["visit"], "desig": objs[j]["desig"], "v_mag": objs[j]["v_mag"],
                              "score": ok[i]["score"], "band": t6.band_of(ok[i])})
            for i, c in enumerate(ok):
                if i in used:
                    continue
                on_g, on_s = flag(c["ra"], c["dec"])
                unexpl.append({"visit": rec["visit"], "ra": c["ra"], "dec": c["dec"], "score": c["score"], "band": t6.band_of(c),
                               "rate_px_per_step": float(np.hypot(c["v_xi"], c["v_eta"]) * t6.STEP_S / t6.PX_ARCSEC),
                               "possibly_variable": on_g or on_s, "on_gaia": on_g, "on_static_list": on_s})
        failed = gp[f"{p}/real"]
        out[p] = {"known_in_visits": n_known, "known_recovered": len(rec_k), "recovered": rec_k, "unexplained": unexpl,
                  "dropped_frame_visits": dropped, "failed_visits": failed,
                  "known_in_failed_visits": sum(len(known.get(v, {}).get("objects", [])) for v in failed)}
    return out


def _static_positions(static: dict) -> np.ndarray:
    """(ra, dec) of every source in a v1 static-list file (cache/v1/<patch>/static.json, both halves' lists)."""
    pts = [np.column_stack([lst["ra"], lst["dec"]]) for lst in static["lists"].values() if len(lst["ra"])]
    return np.concatenate(pts).astype(float) if pts else np.zeros((0, 2))


def score():
    OUT.mkdir(parents=True, exist_ok=True)
    far, scr, thr1, thr2 = n_tier_thresholds()
    (OUT / "thresholds.json").write_text(json.dumps({"primary_far0.1": thr1, "secondary_far1.0": thr2}, indent=1, default=float))
    print(f"thresholds written before any V file is read: primary slow {thr1['slow']['t']:.3f} fast {thr1['fast']['t']:.3f}; "
          f"secondary slow {thr2['slow']['t']:.3f} fast {thr2['fast']['t']:.3f}", flush=True)
    boot = threshold_bootstrap(far, scr)
    print("threshold bootstrap drawn and matched to T6 (thresholds and D-1 m50) before any V file is read", flush=True)
    visits, meta, dropped, failed = load_injection()
    rows0 = fake_table(visits, meta, thr1)
    rates = [(x["rate_px"], x["rate_from"]) for x in rows0]
    gpx = gaia_distance_px(rows0)
    result = {"registration": "prereg/V_LOOK_1.md", "method": METHOD, "patches": PATCHES, "passes": PASSES,
              "caveats": {"t6_verdict": T6["verdict"], "gpd_v4": T6["gpd"][METHOD],
                          "nulls": "N-1..N-11 without guard-void N-4, N-6; crowded NC-1, NC-2 not in the null (Sumit, 30 Oct)",
                          "lookalike_controls": "not run (YARDSTICK §8 not implemented); no claim on the §8 ceilings",
                          "fast_movers": "the dedicated NEO injection set (YARDSTICK §6) is not added"},
              "injection_dropped_frame_visits": dropped, "injection_failed_targets": failed, "failed_visits": gaps(),
              "thresholds": {"primary": thr1, "secondary": thr2}}
    res1, _, curve = headline(visits, meta, boot[FAR_PRIMARY], thr1, gpx, rates)
    print(f"primary: m50 {res1['all'].get('m50', float('nan')):.3f} (fakes 68% {res1['all'].get('m50_ci68')}; thresholds 68% "
          f"{res1['all']['threshold_boot_m50']}; patches 68% {res1['all']['patch_boot_m50']}), n {res1['all']['n']}", flush=True)
    res2, _, _ = headline(visits, meta, boot[FAR_SECONDARY], thr2, gpx, rates)
    result["primary_far0.1"], result["secondary_far1.0"] = res1, res2
    result["per_patch_far"] = per_patch_far(thr1, curve, flag_chance(rows0))
    result["counts"] = all(x["counts"] for p, x in result["per_patch_far"].items() if p in PATCHES)
    result["far_readings_disagree"] = [p for p in PATCHES if result["per_patch_far"][p]["readings_disagree"]]
    result["real_output"] = real_output(thr1)
    (OUT / "v_look_result.json").write_text(json.dumps(result, indent=1, default=float))
    for p in PATCHES:
        x, ro = result["per_patch_far"][p], result["real_output"][p]
        print(f"{p}: FAR {x['far']:.3f} ({x['events']} events / {x['area_deg2_visits']:.1f} deg2-visits, Poisson 95% "
              f"{x['far_poisson95']}), {'counts' if x['counts'] else 'DOES NOT COUNT'}{' (point-estimate reading disagrees)' if x['readings_disagree'] else ''}; near guard fakes {x['events_near_guard_fakes']}; "
              f"known recovered {ro['known_recovered']}/{ro['known_in_visits']}; unexplained {len(ro['unexplained'])}")
    print(f"V result counts (no patch with Poisson lower bound above {2 * FAR_PRIMARY}): {result['counts']}  ->  {OUT / 'v_look_result.json'}")


def realism(workers: int):
    import yardstick_realism as R

    from smo.score import t6
    from smo.score.yardstick import load_visit, match

    thr = json.loads((OUT / "thresholds.json").read_text())["primary_far0.1"]
    centres = _centres()
    rows, fit_failures = [], {}
    for p in PATCHES:
        meas, fails = R.measure_patch(p, centres[p], METHOD, workers, cache_dir=OUT / "realism_cache" / p)
        fit_failures[p] = fails
        known = json.loads((ROOT / "runs/yardstick" / p / "known.json").read_text())["visits"]
        rec = {}
        for vis in sorted({r["visit"] for r in meas}):
            v = load_visit(run_dir(p, "pass0") / f"{vis}.json", 1.0)
            ok = [c for c in v.cands if c["passes"] and c["score"] > thr[t6.band_of(c)]["t"]]
            pairs, used = match(ok, v.truth)
            for j, t in enumerate(v.truth):
                rec[("fake", vis, t["fake_id"])] = j in pairs
            objs = known.get(vis, {}).get("objects", [])
            kp, _ = match([c for i, c in enumerate(ok) if i not in used], objs)
            for j, o in enumerate(objs):
                rec[("known", vis, o["desig"])] = j in kp
        rows += [{**r, "recovered": rec[(r["kind"], r["visit"], r["id"])]} for r in meas]
    vt = OUT / "realism_table_v_pool.json"
    vt.write_text(json.dumps({"thresholds": {b: thr[b]["t"] for b in thr}, "rows": rows}))
    names = ["PRIMARY (exclude static >= 2, weighted)", "sensitivity: cut 1.5", "sensitivity: cut 1.0",
             "sensitivity: static-subtracted axis", "sensitivity: unweighted"]
    res = [R.gate(vt), R.gate(vt, static_cut=1.5, n_boot=300), R.gate(vt, static_cut=1.0, n_boot=300),
           R.gate(vt, axis="subtracted", n_boot=300), R.gate(vt, weighted=False, n_boot=300)]
    d_table = ROOT / "runs/yardstick/T6/realism_table_v4.json"  # D-1 rows at the same thresholds (T6)
    pooled = OUT / "realism_table_dv_pooled.json"
    pooled.write_text(json.dumps({"rows": json.loads(d_table.read_text())["rows"] + rows}))
    out = {"v_pool": dict(zip(names, res, strict=True)),
           "d_pool_quoted_from_t6": json.loads((ROOT / "runs/yardstick/T6/t6_result.json").read_text())["realism_D_pool"][METHOD],
           "dv_pooled_v4_recovery_reported": R.gate(pooled),
           "note": "the plain-v0 method-free check is not run (no v0 runs on V)",
           "frame_fit_failures": fit_failures, "pass0_failed_targets_not_measured": {p: gaps()[f"{p}/pass0"] for p in PATCHES}}
    (OUT / "realism_v_pool.json").write_text(json.dumps(out, indent=1, default=float))
    for n, r in zip(names, res, strict=True):
        print(f"{n:42s} fakes {r['n_fake']:4d} known {r['n_known']:4d}  dm {r['dm']:+.3f}  90% [{r['ci90'][0]:+.3f}, "
              f"{r['ci90'][1]:+.3f}]  {'PASS' if r['pass'] else 'FAIL'}{'  (at grid edge)' if r['at_grid_edge'] else ''}")


def main():
    problems = check_inputs()
    if "--check" in sys.argv:
        print("\n".join(problems) if problems else "V look inputs complete")
        return
    if problems:
        raise SystemExit("V look inputs incomplete; a partial V look is never scored:\n" + "\n".join(problems))
    if "--realism" in sys.argv:
        i = sys.argv.index("--realism")
        realism(int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 3)
    else:
        score()


if __name__ == "__main__":
    main()
