"""Realism gate on a D patch (prereg/YARDSTICK.md §5, §10): fakes against known asteroids on a shared
measured-flux axis. Development only (D pool): the registered per-method gate needs the V pool.

Measured axis (§5), the same for both: forced photometry on the plain Gaia scene fit (v0), the
exact point significance at the object's position in each frame of the visit, combined as the linear
stack nu_forced = sum / sqrt(N); m_meas = -2.5 log10(nu_forced). Known asteroids are measured on the
uninjected frames at their kete positions; fakes on frames re-injected exactly as in the run
(same seeds; the regenerated truth must equal the sealed truth, which is checked).

Recovery: a method's passing candidates above its development thresholds (FAR 1.0, rate-band
split, from the D-5 quarter-0 null), matched first to fakes, then to known asteroids.
TOST: fake completeness against m_meas is fitted with the 3-parameter logistic; known-asteroid
recovery is fitted with that curve shifted by dm (binomial maximum likelihood), and the 90% interval
of dm comes from 1,000 bootstrap resamples of the known asteroids. Pass if it lies inside +-0.2 mag.

Usage: uv run --extra ephem python scripts/yardstick_realism.py <method dir, e.g. v3> [workers]

measure_patch(patch, centre, method, workers) runs the same measurement on another patch's pass 0 (the first V look's
V-pool gate, prereg/V_LOOK_1.md item 6); D-1 stays the default and its path is unchanged.
"""

from __future__ import annotations

import json
import os
import sys
import warnings
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_v, "1")

import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
CENTRE = (28.6722, 10.8662)
warnings.filterwarnings("ignore")
_W: dict = {"patch": "D-1", "centre": CENTRE, "truth_dir": "v3"}  # the patch measured (set per worker)
sys.path.insert(0, str(ROOT / "scripts"))


def _visit_task(visit):
    import astropy.units as u
    from astropy.coordinates import SkyCoord

    from smo.data.exposure import load_cutout
    from smo.data.patch import Frame, by_visit
    from smo.inject.clones import Orbits
    from smo.inject.plan import noise_rng, plan_visit
    from smo.inject.render import inject
    from smo.inject.truth import unseal
    from smo.scene.pipeline import fit_cutout

    patch, centre = _W["patch"], _W["centre"]
    fbv = by_visit([Frame(**r) for r in json.loads((CACHE / "patch" / f"{patch}_frames.json").read_text())])
    frames = fbv[visit]
    known = json.loads((ROOT / "runs/yardstick" / patch / "known.json").read_text())["visits"].get(visit, {"objects": []})
    rec = json.loads((ROOT / "runs/yardstick" / patch / _W["truth_dir"] / "pass0" / f"{visit}.json").read_text())
    sealed = unseal(Path(rec["truth"]["path"]), rec["truth"]["sha256"])
    if "orbits" not in _W:
        _W["orbits"] = Orbits.from_snapshot(CACHE / "ephem" / "mpc_orbits_snapshot.npz")  # not the 6.7 GB MPC load
    plan = plan_visit(patch, centre, frames, _W["orbits"], 0, CACHE)
    regen = [(round(t["ra_t0"], 10), round(t["dec_t0"], 10), round(t["m_ref"], 10)) for t in plan.truth]
    orig = [(round(t["ra_t0"], 10), round(t["dec_t0"], 10), round(t["m_ref"], 10)) for t in sealed["fakes"]]
    if regen != orig or plan.seed != sealed["seed"]:
        raise AssertionError(f"{visit}: regenerated injection truth differs from the sealed truth")
    k_snr = {o["desig"]: [] for o in known["objects"]}
    f_snr = {t["fake_id"]: [] for t in plan.truth}
    fit_failures = []
    for f in frames:
        cut = load_cutout(Path(f.path))
        try:
            fit = fit_cutout(cut, CACHE, gaia_center=centre, gaia_radius_deg=0.75)
        except Exception as e:  # noqa: BLE001 - the frame's forced photometry is dropped and recorded (T6 rule)
            fit_failures.append({"frame": f.path, "fit": "plain", "error": repr(e)})
            continue
        sol, sys_ = fit.sol, fit.system
        ny, nx = cut.shape
        if known["objects"]:
            dt = f.mjd_avg - known["t0"]
            ra = np.array([o["ra_t0"] + o["dra_cosdec_deg_per_day"] * dt / np.cos(np.radians(o["dec_t0"])) for o in known["objects"]])
            dec = np.array([o["dec_t0"] + o["ddec_deg_per_day"] * dt for o in known["objects"]])
            x, y = cut.wcs().world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
            ok = (x > 6) & (x < nx - 7) & (y > 6) & (y < ny - 7)
            if ok.any():
                snr, _ = sys_.point_snr(np.asarray(x)[ok], np.asarray(y)[ok], sol.dx, sol.dy, sol.scale)
                for o, s in zip([o for o, k in zip(known["objects"], ok, strict=True) if k], snr, strict=True):
                    if np.isfinite(s):
                        k_snr[o["desig"]].append((f.exposure, float(s)))
        # The same frame with the run's injections (v0 base map parameters, as the run used).
        fk = plan.per_frame[f.path]
        if fk:
            scale, dx, dy = sealed["inject"][f.path]["scale"], sealed["inject"][f.path]["dx"], sealed["inject"][f.path]["dy"]
            icut, _ = inject(cut, fk, noise_rng(plan, f.path), scale, dx, dy)
            try:
                ifit = fit_cutout(icut, CACHE, gaia_center=centre, gaia_radius_deg=0.75)
            except Exception as e:  # noqa: BLE001 - as above
                fit_failures.append({"frame": f.path, "fit": "injected", "error": repr(e)})
                continue
            truth_f = [(t["fake_id"], t["frames"][f.path]) for t in plan.truth if f.path in t.get("frames", {})]
            xs = np.array([v["x_mid"] for _, v in truth_f])
            ys = np.array([v["y_mid"] for _, v in truth_f])
            ok = (xs > 6) & (xs < nx - 7) & (ys > 6) & (ys < ny - 7)
            if ok.any():
                snr, _ = ifit.system.point_snr(xs[ok], ys[ok], ifit.sol.dx, ifit.sol.dy, ifit.sol.scale)
                for (fid, _), s in zip([t for t, k in zip(truth_f, ok, strict=True) if k], snr, strict=True):
                    if np.isfinite(s):
                        f_snr[fid].append((f.exposure, float(s)))
    # Static statistic at each object's t0 position (plain-Gaia v0 maps of every other visit).
    import yardstick_run as Y
    from smo.detect.maps import Plane
    from smo.detect.v0 import _static_median
    from smo.inject.spectra import FakePhotometry, spectral_shape

    if "ctx" not in _W:
        _W["ctx"] = {v: [m for m in (Y.load_map(patch, f, map_method="v0") for f in fs) if m is not None] for v, fs in fbv.items()}
    ctx = {v: m for v, m in _W["ctx"].items() if v != visit}
    pl = Plane(*centre)
    pos_k = np.array([pl.from_sky(o["ra_t0"], o["dec_t0"]) for o in known["objects"]]).reshape(-1, 2)
    pos_f = np.array([pl.from_sky(t["ra_t0"], t["dec_t0"]) for t in plan.truth]).reshape(-1, 2)
    st_k = _static_median(ctx, pos_k) if len(pos_k) else []
    st_f = _static_median(ctx, pos_f) if len(pos_f) else []
    # Each fake's predicted V from its own spectral model (Y3 step 2), normalised to its m_ref.
    v_fake = {}
    for t in plan.truth:
        short = [fr["wavelength_um"] for fp, fr in t.get("frames", {}).items() if int(Path(fp).name.split("_D")[1][0]) in (1, 2, 3)]
        if not short:
            continue
        r, d = t["r_au"], t["delta_au"]
        cth = np.clip((r * r + 1.0 - d * d) / (2 * r), -1, 1)
        sun2obj, sun2obs = np.array([r * cth, r * np.sqrt(1 - cth * cth), 0.0]), np.array([1.0, 0.0, 0.0])
        ph = FakePhotometry(t["cls"], t["pv"], 0.0, 10.0, 0.0)
        sh = spectral_shape(ph, sun2obj, sun2obs, np.array([0.55] + short))
        v_fake[t["fake_id"]] = float(t["m_ref"] - 2.5 * np.log10(sh[0] / np.mean(sh[1:])))
    extra = {"known_static": {o["desig"]: float(x) for o, x in zip(known["objects"], st_k, strict=True)},
             "fake_static": {t["fake_id"]: float(x) for t, x in zip(plan.truth, st_f, strict=True)},
             "fake_v": v_fake, "fit_failures": fit_failures}
    return visit, k_snr, f_snr, extra


def _forced(lst):
    if len(lst) < 2 or len({e for e, _ in lst}) < 2:
        return None
    v = np.array([s for _, s in lst])
    return float(v.sum() / np.sqrt(len(v)))


def measure(method: str, workers: int) -> Path:
    """Phase 1: forced photometry, static statistics and fake V for every object; saved per object."""
    import yardstick_devcompare as D
    from smo.data.patch import Frame, by_visit
    from smo.score.evalsets import visit_files
    from smo.score.yardstick import load_visit, match

    null = [load_visit(p, D.area_of("D-5", p)) for p in visit_files(ROOT / "runs/yardstick/D-5" / method / "real", expect="q0")]
    thr, _ = D.thresholds(null, "base", True, 1.0)
    fbv = by_visit([Frame(**r) for r in json.loads((CACHE / "patch" / "D-1_frames.json").read_text())])
    with ProcessPoolExecutor(max_workers=workers) as pool:
        res = list(pool.map(_visit_task, sorted(fbv)))
    known = json.loads((ROOT / "runs/yardstick/D-1/known.json").read_text())["visits"]
    rows = []
    for visit, k_snr, f_snr, extra in res:
        v = load_visit(ROOT / "runs/yardstick/D-1" / method / "pass0" / f"{visit}.json", 1.0)
        ok = [c for c in v.cands if c["passes"] and c["score"] > thr["slow" if D.rate_px(c) <= D.SLOW_PX else "fast"]]
        pairs, used = match(ok, v.truth)
        rest = [c for i, c in enumerate(ok) if i not in used]
        for j, t in enumerate(v.truth):
            rows.append({"kind": "fake", "visit": visit, "id": t["fake_id"], "nu": _forced(f_snr.get(t["fake_id"], [])),
                         "static": extra["fake_static"].get(t["fake_id"]), "v": extra["fake_v"].get(t["fake_id"]),
                         "m_ref": t["m_ref"], "recovered": j in pairs})
        objs = known.get(visit, {}).get("objects", [])
        kp, _ = match(rest, objs)
        for j, o in enumerate(objs):
            rows.append({"kind": "known", "visit": visit, "id": o["desig"], "nu": _forced(k_snr.get(o["desig"], [])),
                         "static": extra["known_static"].get(o["desig"]), "v": o["v_mag"], "recovered": j in kp})
    out = ROOT / "runs/yardstick/D-1" / method / "realism_table.json"
    out.write_text(json.dumps({"thresholds": thr, "rows": rows}))
    return out


def _init_patch(patch, centre, truth_dir):
    _W.update({"patch": patch, "centre": tuple(centre), "truth_dir": truth_dir})


def measure_patch(patch: str, centre, method: str, workers: int, cache_dir: Path | None = None,
                  visits: list[str] | None = None) -> tuple[list[dict], list[dict]]:
    """Phase 1 on another patch's pass 0: per object, forced nu, static statistic and V, keyed by (kind, visit, id),
    and the frames whose fit failed (their forced photometry dropped). Recovery is not set here; the caller decides it
    at its own thresholds.

    cache_dir: each visit's result is pickled there as it finishes, and visits already there are not measured again,
    so a stopped run resumes per visit. A visit's result depends only on that visit (its own plan seed, frames and
    the other visits' stored maps), so the rows are the same either way. visits: measure only these (tests).
    Pickle, not JSON, so floats and types come back exactly; the cache holds only files this function wrote."""
    import pickle
    from concurrent.futures import as_completed

    from smo.data.patch import Frame, by_visit
    from smo.score.evalsets import visit_files_with_gaps
    from smo.score.yardstick import load_visit

    fbv = by_visit([Frame(**r) for r in json.loads((CACHE / "patch" / f"{patch}_frames.json").read_text())])
    done = {f.stem for f in visit_files_with_gaps(ROOT / "runs/yardstick" / patch / method / "pass0", "pass0")[0]}  # failed targets: none
    todo = sorted(v for v in fbv if v in done and (visits is None or v in visits))
    got = {}
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        for v in todo:
            if (cache_dir / f"{v}.pkl").exists():
                try:
                    r = pickle.loads((cache_dir / f"{v}.pkl").read_bytes())
                except Exception as e:  # noqa: BLE001 - a damaged file (a crash mid-write) is measured again
                    print(f"{patch}: {v} cache unreadable ({e!r}); measuring it again", flush=True)
                    continue
                if r[0] == v:
                    got[v] = r
        print(f"{patch}: {len(got)} of {len(todo)} visits from the cache", flush=True)
    with ProcessPoolExecutor(max_workers=workers, initializer=_init_patch, initargs=(patch, centre, method)) as pool:
        futs = [pool.submit(_visit_task, v) for v in todo if v not in got]
        for fut in as_completed(futs):
            r = fut.result()
            got[r[0]] = r
            if cache_dir is not None:
                tmp = cache_dir / f"{r[0]}.tmp"
                with open(tmp, "wb") as fh:  # on disk before the rename, so a crash can't leave a short file
                    fh.write(pickle.dumps(r))
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, cache_dir / f"{r[0]}.pkl")
            print(f"{patch}: {len(got)} of {len(todo)} visits measured", flush=True)
    res = [got[v] for v in todo]
    known = json.loads((ROOT / "runs/yardstick" / patch / "known.json").read_text())["visits"]
    rows, failures = [], []
    for visit, k_snr, f_snr, extra in res:
        failures += extra["fit_failures"]
        v = load_visit(ROOT / "runs/yardstick" / patch / method / "pass0" / f"{visit}.json", 1.0)
        for t in v.truth:
            rows.append({"kind": "fake", "patch": patch, "visit": visit, "id": t["fake_id"], "nu": _forced(f_snr.get(t["fake_id"], [])),
                         "static": extra["fake_static"].get(t["fake_id"]), "v": extra["fake_v"].get(t["fake_id"]), "m_ref": t["m_ref"]})
        for o in known.get(visit, {}).get("objects", []):
            rows.append({"kind": "known", "patch": patch, "visit": visit, "id": o["desig"], "nu": _forced(k_snr.get(o["desig"], [])),
                         "static": extra["known_static"].get(o["desig"]), "v": o["v_mag"]})
    return rows, failures


def gate(table: Path, static_cut: float = 2.0, axis: str = "forced", weighted: bool = True, n_boot: int = 1000) -> dict:
    """Phase 2: the Y3 gate from the measured table."""
    from smo.score.yardstick import _logistic_fit

    rows = json.loads(table.read_text())["rows"]
    def keep(r):
        if r["nu"] is None or r["static"] is None or not np.isfinite(r["static"]):
            return False
        if axis == "forced" and r["static"] >= static_cut:
            return False
        x = r["nu"] - (r["static"] if axis == "subtracted" else 0.0)
        return x > 0.5 and r["v"] is not None and np.isfinite(r["v"])
    F = [r for r in rows if r["kind"] == "fake" and keep(r)]
    K = [r for r in rows if r["kind"] == "known" and keep(r)]
    xm = lambda r: -2.5 * np.log10(r["nu"] - (r["static"] if axis == "subtracted" else 0.0))  # noqa: E731
    fv, kv = np.array([r["v"] for r in F]), np.array([r["v"] for r in K])
    lo, hi = max(fv.min(), kv.min()), min(fv.max(), kv.max())
    K = [r for r, v in zip(K, kv, strict=True) if lo <= v <= hi]
    kv = np.array([r["v"] for r in K])
    edges = np.arange(np.floor(lo * 4) / 4, hi + 0.25, 0.25)
    hk, _ = np.histogram(kv, edges)
    hf, _ = np.histogram(fv, edges)
    sm = lambda h: np.convolve(h.astype(float), np.ones(3) / 3, mode="same")  # noqa: E731
    ratio = np.where(sm(hf) > 0, sm(hk) / np.maximum(sm(hf), 1e-12), 0.0)
    idx = np.clip(np.digitize(fv, edges) - 1, 0, len(ratio) - 1)
    w = np.where((fv >= lo) & (fv <= hi), ratio[idx], 0.0) if weighted else np.ones(len(fv))
    fm, fr = np.array([xm(r) for r in F]), np.array([r["recovered"] for r in F], bool)
    km, kr = np.array([xm(r) for r in K]), np.array([r["recovered"] for r in K], bool)

    def fit_fake(m, r, ww):
        # Weighted binomial likelihood (importance weights on the fakes), started from the unweighted fit.
        from scipy.optimize import minimize

        def nll(p):
            cmax = 1 / (1 + np.exp(-p[0]))
            c = np.clip(cmax / (1 + np.exp((m - p[1]) / np.exp(p[2]))), 1e-12, 1 - 1e-12)
            return -np.sum(ww * np.where(r, np.log(c), np.log(1 - c)))
        start = _logistic_fit(m, r)
        res = minimize(nll, [np.log(start[0] / max(1 - start[0], 1e-6)), start[1], np.log(start[2])], method="Nelder-Mead",
                       options={"xatol": 1e-7, "fatol": 1e-10, "maxiter": 6000})
        return 1 / (1 + np.exp(-res.x[0])), res.x[1], np.exp(res.x[2])

    def dm_of(cm, m0, wd, m, r):
        grid = np.linspace(-1.5, 1.5, 1201)
        ll = [np.sum(np.where(r, np.log(np.clip(cm / (1 + np.exp((m - (m0 + d)) / wd)), 1e-12, 1)),
                              np.log(np.clip(1 - cm / (1 + np.exp((m - (m0 + d)) / wd)), 1e-12, 1)))) for d in grid]
        return float(grid[int(np.argmax(ll))])

    cm, m0, wd = fit_fake(fm, fr, w)
    dm = dm_of(cm, m0, wd, km, kr)
    rng = np.random.default_rng(0)
    boot = []
    for _ in range(n_boot):
        i = rng.integers(0, len(fm), len(fm))
        j = rng.integers(0, len(km), len(km))
        c2, a2, w2 = fit_fake(fm[i], fr[i], w[i])
        boot.append(dm_of(c2, a2, w2, km[j], kr[j]))
    lo90, hi90 = np.percentile(boot, [5, 95])
    edge = bool(abs(dm) >= 1.49 or lo90 <= -1.49 or hi90 >= 1.49)
    return {"static_cut": static_cut, "axis": axis, "weighted": weighted, "n_fake": len(F), "n_known": len(K),
            "fake_curve": [float(cm), float(m0), float(wd)], "dm": dm, "ci90": [float(lo90), float(hi90)],
            "pass": bool(lo90 > -0.2 and hi90 < 0.2 and not edge), "at_grid_edge": edge}


def main():
    method = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    table = ROOT / "runs/yardstick/D-1" / method / "realism_table.json"
    if "--reuse" not in sys.argv or not table.exists():
        table = measure(method, workers)
    results = [gate(table)]  # primary
    for cut in (1.5, 1.0):
        results.append(gate(table, static_cut=cut, n_boot=300))
    results.append(gate(table, axis="subtracted", n_boot=300))
    results.append(gate(table, weighted=False, n_boot=300))
    names = ["PRIMARY (exclude static >= 2, weighted)", "sensitivity: cut 1.5", "sensitivity: cut 1.0",
             "sensitivity: static-subtracted axis", "sensitivity: unweighted"]
    for n, r in zip(names, results, strict=True):
        print(f"{n:42s} fakes {r['n_fake']:4d} known {r['n_known']:4d}  dm {r['dm']:+.3f}  90% [{r['ci90'][0]:+.3f}, {r['ci90'][1]:+.3f}]  "
              f"{'PASS' if r['pass'] else 'FAIL'}{'  (at grid edge)' if r['at_grid_edge'] else ''}")
    (table.parent / "realism_y3_dpool.json").write_text(json.dumps(dict(zip(names, results, strict=True)), indent=1))
    print("D pool only: this is a development reading, not the registered V-pool gate.")


if __name__ == "__main__":
    main()
