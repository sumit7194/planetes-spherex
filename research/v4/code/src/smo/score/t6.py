"""T6 scoring core (prereg/METHOD_V6.md: V6-1 "T6", "T6 additions", the T6 notes and rules).

Pure functions on already-loaded visits, so the unit tests can check them on inputs whose answer is
known. scripts/t6_score.py does the file handling.

* Null events: a null visit's passing candidates, minus those matched to its guard fakes and, in
  N-far, minus those within 1.5 px of a kete-predicted known asteroid (that area is subtracted from
  the denominator; YARDSTICK §7).
* Rate bands: slow (<= 1 px per exposure step) and fast; each band gets FAR0 / 2.
* Operating threshold per band (YARDSTICK §7, "Agreement"): the threshold from N-far and N-scramble
  pooled; the two nulls' false-alarm counts at it are compared with the exact conditional Poisson test
  (given the total, the N-far count is binomial with p = area_far / (area_far + area_scr)). At
  p < 0.01 they disagree, and the operating threshold is the own FAR0 / 2 threshold of whichever null
  has the higher rate at the pooled threshold.
* Storage floor (The Bridge's review): N-tier runs store only passing candidates with score >= 3.
  When a null has no more stored events above the floor than its FAR budget allows, its true threshold
  may lie below 3, where nothing was stored; the threshold is then the floor itself, labelled
  "FAR-limited by storage floor" (FAR <= FAR0 still holds). Completeness uses the same threshold, so
  injection candidates below 3 never count.
* GPD cross-check: a generalised Pareto fit (location 0) to a null's scores above u = 4, inverted at
  the band's FAR. "Threshold unstable" if it differs from the empirical threshold by more than the
  half-width of the empirical threshold's 68% null-bootstrap interval.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import stats

from smo.score.yardstick import MATCH_ARCSEC, _logistic_fit, _sep_arcsec, m_at, match

FAR0 = 0.1
BANDS = ("slow", "fast")
SLOW_PX = 1.0
PX_ARCSEC = 6.15
STEP_S = 129.0
AGREE_P = 0.01
GPD_U = 4.0
GPD_MIN_EXCEED = 20
STORE_FLOOR = 3.0  # SMO_STORE_MIN_SCORE of the T6 runs


def band_of(c: dict) -> str:
    """Rate band of a candidate: v_xi, v_eta in arcsec/s, so the rate per exposure step in px."""
    return "slow" if np.hypot(c["v_xi"], c["v_eta"]) * STEP_S / PX_ARCSEC <= SLOW_PX else "fast"


@dataclass
class NullVisit:
    """One null visit (or pseudo-visit) after the removals: its events (score, band) and effective area."""
    vid: str
    area: float  # deg^2, after subtracting known-asteroid discs
    events: list[tuple[float, str]] = field(default_factory=list)
    n_known_removed: int = 0


def null_visit(vid: str, cands: list[dict], guard_truth: list[dict], area_deg2: float,
               known: list[dict] | None = None) -> NullVisit:
    ok = [c for c in cands if c["passes"]]
    if guard_truth:
        _, used = match(ok, guard_truth)
        ok = [c for i, c in enumerate(ok) if i not in used]
    area, n_rm = area_deg2, 0
    if known:
        kra = np.array([o["ra_t0"] for o in known])
        kdec = np.array([o["dec_t0"] for o in known])
        keep = []
        for c in ok:
            if np.min(_sep_arcsec(c["ra"], c["dec"], kra, kdec)) <= MATCH_ARCSEC:
                n_rm += 1
            else:
                keep.append(c)
        ok = keep
        area -= len(known) * np.pi * (MATCH_ARCSEC / 3600.0) ** 2
    return NullVisit(vid, float(area), [(float(c["score"]), band_of(c)) for c in ok], n_rm)


def band_scores(visits: list[NullVisit], band: str) -> np.ndarray:
    return np.array([s for v in visits for s, b in v.events if b == band], float)


def threshold(scores: np.ndarray, area: float, far: float, floor: float = STORE_FLOOR) -> float:
    """Smallest t >= floor with (events above t) / area <= far: the (floor(far x area) + 1)-th highest
    stored score, or the storage floor when too few events were stored to reach the FAR budget."""
    s = np.sort(np.asarray(scores, float))
    s = s[s >= floor][::-1]
    k = int(np.floor(far * area))
    return float(s[k]) if k < len(s) else float(floor)


def floor_limited(scores: np.ndarray, area: float, far: float, floor: float = STORE_FLOOR) -> bool:
    return int(np.floor(far * area)) >= int(np.sum(np.asarray(scores, float) >= floor))


def agreement_p(k_far: int, a_far: float, k_scr: int, a_scr: float) -> float:
    n = k_far + k_scr
    return float(stats.binomtest(k_far, n, a_far / (a_far + a_scr)).pvalue) if n else 1.0


def operating_thresholds(far_v: list[NullVisit], scr_v: list[NullVisit], far0: float = FAR0) -> dict:
    a_far, a_scr = sum(v.area for v in far_v), sum(v.area for v in scr_v)
    out = {}
    for band in BANDS:
        f, s = band_scores(far_v, band), band_scores(scr_v, band)
        per = far0 / len(BANDS)
        t_pool = threshold(np.concatenate([f, s]), a_far + a_scr, per)
        t_far, t_scr = threshold(f, a_far, per), threshold(s, a_scr, per)
        k_far, k_scr = int(np.sum(f > t_pool)), int(np.sum(s > t_pool))
        p = agreement_p(k_far, a_far, k_scr, a_scr)
        if p < AGREE_P:
            src = "N-far" if k_far / a_far >= k_scr / a_scr else "N-scramble"
            t, lim = (t_far, floor_limited(f, a_far, per)) if src == "N-far" else (t_scr, floor_limited(s, a_scr, per))
            src = f"{src} (nulls disagree)"
        else:
            src, t, lim = "pooled", t_pool, floor_limited(np.concatenate([f, s]), a_far + a_scr, per)
        out[band] = {"t": t, "source": src, "t_pool": t_pool, "t_far": t_far, "t_scr": t_scr,
                     "k_far": k_far, "k_scr": k_scr, "area_far": a_far, "area_scr": a_scr, "agreement_p": p,
                     "floor_limited": bool(lim), "label": "FAR-limited by storage floor" if lim else ""}
    return out


def gpd_threshold(scores: np.ndarray, area: float, far: float, u: float = GPD_U) -> dict:
    y = np.asarray(scores, float)
    y = y[y > u] - u
    if len(y) < GPD_MIN_EXCEED:
        return {"t": None, "n_exceed": int(len(y)), "note": f"fewer than {GPD_MIN_EXCEED} scores above u"}
    c, _, scale = stats.genpareto.fit(y, floc=0)
    q = far * area / len(y)
    if q >= 1:
        return {"t": None, "n_exceed": int(len(y)), "shape": float(c), "scale": float(scale), "note": "FAR reached below u"}
    return {"t": float(u + stats.genpareto.isf(q, c, 0, scale)), "n_exceed": int(len(y)), "shape": float(c), "scale": float(scale)}


def operating_null(far_v: list[NullVisit], scr_v: list[NullVisit], src: str) -> tuple[list[NullVisit], float]:
    """The null set behind an operating threshold, for the GPD cross-check."""
    if src.startswith("N-far"):
        return far_v, sum(v.area for v in far_v)
    if src.startswith("N-scramble"):
        return scr_v, sum(v.area for v in scr_v)
    return far_v + scr_v, sum(v.area for v in far_v + scr_v)


def recovery(inj_visits, thr: dict) -> tuple[np.ndarray, np.ndarray]:
    """(m_ref, recovered) over every denominator fake, a candidate counting if it passes and its score
    exceeds its own band's threshold."""
    m, r = [], []
    for v in inj_visits:
        ok = [c for c in v.cands if c["passes"] and c["score"] > thr[band_of(c)]["t"]]
        pairs, _ = match(ok, v.truth)
        m += [t["m_ref"] for t in v.truth]
        r += [j in pairs for j in range(len(v.truth))]
    return np.array(m, float), np.array(r, bool)


def fake_bootstrap_dm50(m: np.ndarray, r_a: np.ndarray, r_b: np.ndarray, n_boot: int, seed: int = 0) -> list[float]:
    """Paired fake bootstrap of m50(b) - m50(a): both methods saw the same fakes (same seeds), so the
    same resample of fakes serves both. Reported only; the T6 margin is the null bootstrap's."""
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n_boot):
        i = rng.integers(0, len(m), len(m))
        out.append(m50_point(m[i], r_b[i]) - m50_point(m[i], r_a[i]))
    return out


def m50_point(m: np.ndarray, r: np.ndarray) -> float:
    if r.sum() < 5:
        return float("nan")
    return m_at(0.5, *_logistic_fit(m, r))


def null_bootstrap(far_by: dict, scr_by: dict, inj_by: dict, n_boot: int, seed: int = 0) -> dict:
    """Paired null bootstrap: the same resample of N-far and N-scramble visits for every method.
    far_by / scr_by: {method: [NullVisit]} aligned by index; inj_by: {method: injection visits}.
    Returns, per method, the bootstrap thresholds per band and m50s, and the paired m50 differences."""
    methods = list(far_by)
    nf, ns = len(far_by[methods[0]]), len(scr_by[methods[0]])
    for m in methods:
        assert len(far_by[m]) == nf and len(scr_by[m]) == ns
        assert [v.vid for v in far_by[m]] == [v.vid for v in far_by[methods[0]]]
        assert [v.vid for v in scr_by[m]] == [v.vid for v in scr_by[methods[0]]]
    rng = np.random.default_rng(seed)
    out = {m: {"t": {b: [] for b in BANDS}, "m50": []} for m in methods}
    for _ in range(n_boot):
        i, j = rng.integers(0, nf, nf), rng.integers(0, ns, ns)
        for m in methods:
            th = operating_thresholds([far_by[m][k] for k in i], [scr_by[m][k] for k in j])
            for b in BANDS:
                out[m]["t"][b].append(th[b]["t"])
            out[m]["m50"].append(m50_point(*recovery(inj_by[m], th)))
    return out


def half_width68(x) -> float:
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    if len(x) < 2:
        return float("nan")
    lo, hi = np.percentile(x, [16, 84])
    return float((hi - lo) / 2)


def completeness_curve(m: np.ndarray, r: np.ndarray):
    cmax, m0, w = _logistic_fit(m, r)
    return lambda mm: cmax / (1 + np.exp((np.asarray(mm, float) - m0) / w))
