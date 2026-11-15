"""Scoring for the yardstick (prereg/YARDSTICK.md §6, §7, §10). The only reader of sealed truth.

* Matching: one-to-one, greedy by candidate score, within MATCH_ARCSEC of a truth position at the
  visit's reference time.
* Completeness denominator: fakes on unflagged pixels in >= 2 frames of the visit. Masked or
  missed area stays in it, so masking cannot raise completeness.
* Threshold: the score above which at most FAR0 x area-visits candidates of a null pass.
* m50, m90: from a 3-parameter logistic, c(m) = c_max / (1 + exp((m - m0) / w)), fitted by
  binomial maximum likelihood; bootstrap intervals over fakes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

from smo.inject.truth import unseal

MATCH_ARCSEC = 1.5 * 6.15
FAR_PRIMARY, FAR_SECONDARY = 0.1, 1.0


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return float(c - h), float(c + h)


def _sep_arcsec(ra1, dec1, ra2, dec2):
    r1, d1, r2, d2 = map(np.radians, (ra1, dec1, ra2, dec2))
    s = np.sin((d2 - d1) / 2) ** 2 + np.cos(d1) * np.cos(d2) * np.sin((r2 - r1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(s, 0, 1)))) * 3600.0


def match(cands: list[dict], truth: list[dict], radius_arcsec: float = MATCH_ARCSEC) -> tuple[dict[int, int], set[int]]:
    """Greedy one-to-one by descending score. Returns ({truth index: candidate index}, matched candidates)."""
    order = sorted(range(len(cands)), key=lambda i: -cands[i]["score"])
    free = set(range(len(truth)))
    pairs: dict[int, int] = {}
    if not truth:
        return pairs, set()
    tra = np.array([t["ra_t0"] for t in truth])
    tdec = np.array([t["dec_t0"] for t in truth])
    for i in order:
        if not free:
            break
        idx = np.array(sorted(free))
        d = _sep_arcsec(cands[i]["ra"], cands[i]["dec"], tra[idx], tdec[idx])
        j = int(np.argmin(d))
        if d[j] <= radius_arcsec:
            pairs[int(idx[j])] = i
            free.discard(int(idx[j]))
    return pairs, set(pairs.values())


@dataclass
class VisitResult:
    visit: str
    area_deg2: float
    cands: list[dict]
    truth: list[dict]  # fakes in the denominator only


def load_visit(path: Path, area_deg2: float) -> VisitResult:
    rec = json.loads(Path(path).read_text())
    truth = []
    if "truth" in rec:
        t = unseal(Path(rec["truth"]["path"]), rec["truth"]["sha256"])
        truth = [f for f in t["fakes"] if "skipped" not in f and f["n_valid_frames"] >= 2]
    return VisitResult(rec["visit"], area_deg2, rec["candidates"], truth)


def passing(cands: list[dict], threshold: float) -> list[dict]:
    return [c for c in cands if c["passes"] and c["score"] > threshold]


def threshold_at_far(null_visits: list[VisitResult], far: float, exclude_matched: bool = True) -> tuple[float, int, float]:
    """Smallest threshold t such that (passing null candidates with score > t) / area-visits <= far.
    Candidates matched to companion (guard) fakes are removed first. Returns (t, n_false, area)."""
    scores, area = [], 0.0
    for v in null_visits:
        area += v.area_deg2
        ok = [c for c in v.cands if c["passes"]]
        if exclude_matched and v.truth:
            _, used = match(ok, v.truth)
            ok = [c for i, c in enumerate(ok) if i not in used]
        scores += [c["score"] for c in ok]
    s = np.sort(np.array(scores))[::-1]
    k = int(np.floor(far * area))
    t = float(s[k]) if k < len(s) else float("-inf")
    return t, int(np.sum(s > t)), area


def recovered(visits: list[VisitResult], threshold: float) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """(m_ref, recovered flag, truth records) over every denominator fake of the visits."""
    m, r, recs = [], [], []
    for v in visits:
        pairs, _ = match(passing(v.cands, threshold), v.truth)
        for j, t in enumerate(v.truth):
            m.append(t["m_ref"])
            r.append(j in pairs)
            recs.append(t)
    return np.array(m), np.array(r, bool), recs


def completeness_bins(m: np.ndarray, r: np.ndarray, lo=15.5, hi=21.0, width=0.25) -> list[dict]:
    out = []
    for a in np.arange(lo, hi, width):
        sel = (m >= a) & (m < a + width)
        n, k = int(sel.sum()), int(r[sel].sum())
        lo_ci, hi_ci = wilson(k, n)
        out.append({"m_lo": float(a), "m_hi": float(a + width), "n": n, "k": k,
                    "c": (k / n) if n else float("nan"), "ci95": [lo_ci, hi_ci]})
    return out


def _logistic_fit(m: np.ndarray, r: np.ndarray) -> tuple[float, float, float]:
    def nll(p):
        cmax = 1 / (1 + np.exp(-p[0]))
        c = cmax / (1 + np.exp((m - p[1]) / np.exp(p[2])))
        c = np.clip(c, 1e-12, 1 - 1e-12)
        return -np.sum(np.where(r, np.log(c), np.log(1 - c)))
    best = None
    lo, hi = np.quantile(m, [0.02, 0.98])  # starting points span the data, whatever the axis
    w0 = max((hi - lo) / 20.0, 1e-3)
    for m0 in np.linspace(lo, hi, 11):
        res = minimize(nll, [3.0, m0, np.log(w0)], method="Nelder-Mead", options={"xatol": 1e-6, "fatol": 1e-9, "maxiter": 4000})
        if best is None or res.fun < best.fun:
            best = res
    p = best.x
    return float(1 / (1 + np.exp(-p[0]))), float(p[1]), float(np.exp(p[2]))


def m_at(level: float, cmax: float, m0: float, w: float) -> float:
    """Magnitude where c(m) = level; NaN ("not reached") if the plateau is below the level."""
    if cmax <= level:
        return float("nan")
    return float(m0 + w * np.log(cmax / level - 1.0))


def m50_m90(m: np.ndarray, r: np.ndarray, n_boot: int = 500, seed: int = 0) -> dict:
    cmax, m0, w = _logistic_fit(m, r)
    out = {"c_max": cmax, "m0": m0, "w": w, "m50": m_at(0.5, cmax, m0, w), "m90": m_at(0.9, cmax, m0, w),
           "n": int(len(m)), "k": int(r.sum())}
    rng = np.random.default_rng(seed)
    b50, b90 = [], []
    for _ in range(n_boot):
        i = rng.integers(0, len(m), len(m))
        c, a, ww = _logistic_fit(m[i], r[i])
        b50.append(m_at(0.5, c, a, ww))
        b90.append(m_at(0.9, c, a, ww))
    for name, b in (("m50", b50), ("m90", b90)):
        b = np.array(b)
        fin = b[np.isfinite(b)]
        out[f"{name}_ci68"] = [float(np.percentile(fin, 16)), float(np.percentile(fin, 84))] if len(fin) else [float("nan")] * 2
        out[f"{name}_reached_fraction"] = float(len(fin) / len(b))
    return out
