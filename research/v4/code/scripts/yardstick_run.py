"""Run v0 over one patch for the yardstick (prereg/YARDSTICK.md).

  maps    <patch> <manifest> <ra> <dec> [workers]
          Uninjected scene fit and significance map for every frame -> cache/<method>maps/<patch>/.
          The method is SMO_METHOD (v0 default, or v1: smo.methods.v1).
  detect  <patch> <manifest> <ra> <dec> <pass|real> [workers] [visit ...]
          One task per visit. "real": the visit as observed. A pass number: fakes injected into
          that visit only (context un-injected), truth sealed under cache/truth/, the visit's
          frames refitted and searched. Candidates -> runs/yardstick/<patch>/<real|passN>/<visit>.json.

A cached map is reused only if its code commit and config hash match the current ones, so stale
results are never mixed in. Workers use one maths thread each.
"""

from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
os.environ.setdefault("RAYON_NUM_THREADS", "1")

import hashlib  # noqa: E402
import json  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import warnings  # noqa: E402
from concurrent.futures import ProcessPoolExecutor, as_completed  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
GAIA_RADIUS = 0.75
METHOD = os.environ.get("SMO_METHOD", "v0")  # v0; v1 (smo.methods.v1 maps); v2 (v1 maps + smo.detect.v2); v3 (v2, convolution scoring); v4; v6 (smo.detect.v6)
if METHOD not in ("v0", "v1", "v2", "v3", "v4", "v6"):
    raise SystemExit(f"unknown SMO_METHOD {METHOD!r}")
MAP_METHOD = "v1" if METHOD in ("v1", "v2", "v3", "v4", "v6") else "v0"
V4_SUPPRESS_PX = 1.5  # method v4: track-level suppression radius (chosen on D; prereg/METHOD_V4.md)
SOLVER = os.environ.get("SMO_SOLVER", "superlu")  # "cholmod": smo.scene.cholmod (CHOLMOD via cholespy), development only
if SOLVER == "cholmod":
    from smo.linalg import cholmod as _cholmod

    _cholmod.install()
elif SOLVER != "superlu":
    raise SystemExit(f"unknown SMO_SOLVER {SOLVER!r}")
warnings.filterwarnings("ignore", module="astropy")


def config_hash(patch: str | None = None, map_method: str | None = None) -> str:
    """Settings that change a frame map (for v1 also its static lists and PSF floor, by checksum)."""
    from smo.provenance import sha256_file
    from smo.scene import pipeline

    keys = {"STAMP_HALF": pipeline.STAMP_HALF, "GAIA_RADIUS": GAIA_RADIUS}
    if (map_method or MAP_METHOD) == "v1":
        keys["method"] = "v1"
        keys["psf_floor"] = sha256_file(CACHE / "v1" / "psf_floor.json")
        if patch is not None:
            keys["static"] = sha256_file(CACHE / "v1" / patch / "static.json")
    return hashlib.sha256(json.dumps(keys, sort_keys=True).encode()).hexdigest()[:16]


MAP_SOURCES = ("scene/*.py", "data/*.py", "catalogs/__init__.py", "catalogs/gaia.py", "catalogs/sources.py",
               "detect/maps.py")  # exactly the files a v0 frame map depends on
DETECT_SOURCES = ("detect/*.py", "inject/*.py")


def _source_hash(globs) -> str:
    h = hashlib.sha256()
    for g in globs:
        for py in sorted((ROOT / "src" / "smo").glob(g)):
            h.update(py.relative_to(ROOT).as_posix().encode())
            h.update(py.read_bytes())
    return h.hexdigest()[:16]


def code_commit(map_method: str | None = None) -> str:
    """SHA-256 over the source files that determine a frame map (scene fit, data layer, catalogues,
    map module), so an unrelated change does not invalidate cached maps and a relevant one does."""
    extra = ("methods/v1.py", "catalogs/stack.py") if (map_method or MAP_METHOD) == "v1" else ()
    return _source_hash(MAP_SOURCES + extra)


# ----------------------------------------------------------------------------- maps

def _map_path(patch: str, frame_path: str, map_method: str | None = None) -> Path:
    return CACHE / f"{map_method or MAP_METHOD}maps" / patch / (Path(frame_path).stem + ".npz")


def _save_map(path: Path, fm, valid_px: int, omega: float, stamp: dict) -> None:
    from smo.provenance import atomic_write_bytes
    import io

    buf = io.BytesIO()
    np.savez_compressed(buf, z=fm.z, dx=fm.dx, dy=fm.dy, scale=fm.scale, cx=fm.pmap.cx, cy=fm.pmap.cy,
                        ci=fm.pmap.ci, ce=fm.pmap.ce, s=fm.pmap.s, p=fm.pmap.p, gaia_xy=fm.gaia_xy,
                        meta=np.array(json.dumps({**fm.meta, **stamp, "valid_px": valid_px, "omega_sr": omega})))
    atomic_write_bytes(path, buf.getvalue())


def load_map(patch: str, frame, stamp: dict | None = None, map_method: str | None = None):
    from smo.detect.maps import FrameMap, PlaneMap

    path = _map_path(patch, frame.path, map_method)
    if not path.exists():
        return None
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        if stamp and (meta.get("config") != stamp["config"] or meta.get("commit") != stamp["commit"]):
            return None
        pm = PlaneMap(z["cx"], z["cy"], z["ci"], z["ce"], float(z["s"]), float(z["p"]))
        return FrameMap(frame, z["z"], float(z["dx"]), float(z["dy"]), float(z["scale"]), pm, None,
                        z["gaia_xy"], meta)


def _fit_frame(cut, frame, centre, plane, keep_fit: bool, patch: str):
    from smo.detect.maps import frame_map

    if MAP_METHOD == "v1":
        from smo.methods import v1

        if "v1ref" not in _WORKER:
            _WORKER["v1ref"] = (v1.static_reference(CACHE, patch), v1.psf_floor(CACHE))
        static, eps = _WORKER["v1ref"]
        fit = v1.fit_cutout_v1(cut, CACHE, frame.visit, static, eps, centre, GAIA_RADIUS)
    else:
        from smo.scene.pipeline import fit_cutout

        fit = fit_cutout(cut, CACHE, gaia_center=centre, gaia_radius_deg=GAIA_RADIUS)
    return frame_map(fit, frame, plane, keep_fit=keep_fit), fit


def _map_task(patch, frame, centre, stamp):
    from smo.data.exposure import load_cutout
    from smo.detect.maps import Plane
    from smo.inject.render import pixel_solid_angle_sr

    t = time.time()
    cut = load_cutout(Path(frame.path))
    fm, fit = _fit_frame(cut, frame, centre, Plane(*centre), keep_fit=False, patch=patch)
    _save_map(_map_path(patch, frame.path), fm, int(fit.inp.valid.sum()), pixel_solid_angle_sr(cut), stamp)
    return frame.path, time.time() - t, fm.meta


def cmd_maps(patch, manifest, centre, workers):
    from smo.data.patch import frames_from_manifest

    frames = frames_from_manifest(manifest, CACHE / "patch" / f"{patch}_frames.json")
    stamp = {"config": config_hash(patch), "commit": code_commit(), "method": METHOD, "solver": SOLVER}
    todo = [f for f in frames if load_map(patch, f, stamp) is None]
    print(f"{patch}: {len(frames)} frames, {len(todo)} to fit, config {stamp['config']} commit {stamp['commit'][:10]}", flush=True)
    fails, t0 = [], time.time()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_map_task, patch, f, centre, stamp): f for f in todo}
        for i, fu in enumerate(as_completed(futs), 1):
            try:
                _, dt, meta = fu.result()
            except Exception as e:  # noqa: BLE001 - recorded and reported, never silently replaced
                fails.append({"frame": futs[fu].path, "error": repr(e)})
            if i % 20 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)} fitted, {time.time() - t0:.0f}s, {len(fails)} failed", flush=True)
    out = ROOT / "runs" / "yardstick" / patch / ("" if METHOD == "v0" else METHOD) / "maps_failures.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"stamp": stamp, "failures": fails}, indent=1))
    print("failures:", len(fails), "->", out)


# ----------------------------------------------------------------------------- detect

_WORKER: dict = {}


def _context(patch, frames_by_visit, stamp):
    """Uninjected frame maps of every visit. For v2 these come from the v0 (Gaia-only) maps: the
    time-rule statistic needs static sources visible in the context, whereas v1 maps subtract the
    stack sources of the opposite half, and the two halves' lists differ, so a static source fitted
    away in context but not in the target visit would look like a transient (FINDINGS)."""
    if "maps" not in _WORKER:
        mm = "v0" if METHOD in ("v2", "v3", "v4", "v6") else MAP_METHOD
        st = {"config": config_hash(patch, mm), "commit": code_commit(mm)} if mm != MAP_METHOD else stamp
        maps = {}
        for v, fs in frames_by_visit.items():
            ms = [load_map(patch, f, st, mm) for f in fs]
            maps[v] = [m for m in ms if m is not None]
            if METHOD == "v6":
                from smo.detect.v6 import normalise

                maps[v] = [normalise(m) for m in maps[v]]
        _WORKER["maps"] = maps
    return _WORKER["maps"]


def _orbits():
    if "orbits" not in _WORKER:
        from smo.inject.clones import Orbits

        # The compact snapshot (scripts/build_orbit_snapshot.py): loading the full MPC table here
        # peaked at ~6.7 GB per worker. Arrays are identical (checked against sealed truth).
        _WORKER["orbits"] = Orbits.from_snapshot(CACHE / "ephem" / "mpc_orbits_snapshot.npz")
    return _WORKER["orbits"]


def _plan_here(patch, centre, frames, pass_no, want):
    from smo.inject.plan import plan_visit

    return plan_visit(patch, centre, frames, _orbits(), pass_no, CACHE, want=want)


def _plan(patch, centre, frames, pass_no, want):
    """The injection plan. With SMO_PLAN_SUBPROCESS=1 the same call runs in a short-lived child process, for
    memory only: the clone search's ~1.2 GB of temporaries stayed in a worker's footprint after it returned
    (measured on D-5, 30 Oct), and the orbit table is not held by the worker. Same code and inputs, so the
    plan is identical (checked: prereg/V_LOOK_1.md A4)."""
    if os.environ.get("SMO_PLAN_SUBPROCESS") != "1":
        return _plan_here(patch, centre, frames, pass_no, want)
    import multiprocessing

    with ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn")) as ex:
        return ex.submit(_plan_here, patch, centre, frames, pass_no, want).result()


def _detect_task(patch, centre, visit, frames_by_visit, mode, stamp, target_frames=None, exclude=()):
    """One target: a real visit, or (N-scramble) a pseudo-visit given as `target_frames` (Frames with
    the pseudo-visit id and visit-like times) whose contributing real visits are `exclude`d from the
    static context. Pseudo-visit frames are fitted as their real selves, then relabelled."""
    from smo.data.exposure import load_cutout
    from smo.detect.v0 import Plane, detect_visit, split_context
    from smo.provenance import atomic_write_json

    t = time.time()
    plane = Plane(*centre)
    maps = {v: m for v, m in _context(patch, frames_by_visit, stamp).items() if v not in set(exclude)}
    frames = target_frames if target_frames is not None else frames_by_visit[visit]
    real_of = {f.path: f for fs in frames_by_visit.values() for f in fs}
    base_of = {m.frame.path: m for ms in _context(patch, frames_by_visit, stamp).values() for m in ms}
    rec = {"patch": patch, "visit": visit, "mode": mode, "stamp": stamp, "frames": [f.path for f in frames]}
    cuts = {f.path: load_cutout(Path(f.path)) for f in frames}
    if exclude:
        rec["contributors"] = list(exclude)
    if mode != "real":
        from smo.inject.plan import noise_rng
        from smo.inject.render import inject
        from smo.inject.truth import seal, truth_path

        pass_no, want = injection_mode(mode)
        plan = _plan(patch, centre, frames, pass_no, want)
        inj = {}
        for f in frames:
            base = base_of.get(f.path)
            scale, dx, dy = (base.scale, base.dx, base.dy) if base is not None else (1.0, 0.0, 0.0)
            cuts[f.path], inj[f.path] = inject(cuts[f.path], plan.per_frame[f.path], noise_rng(plan, f.path), scale, dx, dy)
        tp = truth_path(CACHE, patch, pass_no, visit)
        rec["truth"] = {"path": str(tp), "sha256": seal(tp, {"seed": plan.seed, "t0": plan.t0, "fakes": plan.truth,
                                                            "clone_rounds": plan.clone_rounds, "inject": inj})}
    fallbacks0 = _cholmod.FALLBACKS if SOLVER == "cholmod" else 0
    target = []
    for f in frames:
        try:
            # Only v0/v2 use the exact refit; v3 and v4 score on the maps, so the fit (with its
            # factorisation, ~1 GB per frame for v1 fits) is not kept. Output unchanged.
            needs_fit = METHOD in ("v0", "v1", "v2")
            fm, _ = _fit_frame(cuts[f.path], real_of[f.path], centre, plane, keep_fit=needs_fit, patch=patch)
            fm.frame = f  # a pseudo-visit frame keeps its own label and times for detection
            target.append(fm)
        except Exception as e:  # noqa: BLE001
            rec.setdefault("fit_failures", []).append({"frame": f.path, "error": repr(e)})
    maps[visit] = target
    if SOLVER == "cholmod":
        rec["solver_fallbacks"] = _cholmod.FALLBACKS - fallbacks0  # fits that fell back to SuperLU
    tgt, ctx = split_context(maps, visit)
    if METHOD == "v6":
        from smo.detect.v6 import detect_visit_v6
        from smo.scene.psf import EPSFGrid, psf_kind

        epsfs = {p: EPSFGrid(c.psf_planes, c.psf_header, c.x0, c.y0, pixel_response=psf_kind(c.meta["version"]) == "optical")
                 for p, c in cuts.items()}
        rec["candidates"] = detect_visit_v6(tgt, ctx, plane, cuts, epsfs) if tgt else []
    elif METHOD in ("v2", "v3", "v4"):
        from smo.detect.v2 import detect_visit_v2

        screen = os.environ.get("SMO_SCREEN", "1") != "0" and METHOD == "v2"
        rec["screen"] = screen
        rec["candidates"] = detect_visit_v2(tgt, ctx, plane, screen=screen, exact=(METHOD == "v2"),
                                            suppress_px=V4_SUPPRESS_PX if METHOD == "v4" else None) if tgt else []
    else:
        rec["candidates"] = detect_visit(tgt, ctx, plane) if tgt else []
    rec["seconds"] = time.time() - t
    n_all, n_pass = len(rec["candidates"]), sum(c["passes"] for c in rec["candidates"])
    keep_min = os.environ.get("SMO_STORE_MIN_SCORE")
    if keep_min is not None:
        # Storage only (disk): keep passing candidates with score >= the floor, record the totals.
        # Every threshold scored from such a run must lie above the floor (prereg/METHOD_V6.md, T6).
        rec["candidates"] = [c for c in rec["candidates"] if c["passes"] and c["score"] >= float(keep_min)]
        rec["stored"] = {"rule": f"passes and score >= {float(keep_min)}", "n_candidates_total": n_all, "n_passing_total": n_pass}
    out = run_dir(patch, mode) / f"{visit}.json"
    atomic_write_json(out, rec)
    return (visit, rec["seconds"], n_all, n_pass,
            len(rec.get("fit_failures", [])), rec.get("solver_fallbacks", 0))


def eval_set(mode: str, subset: bool) -> str:
    """The evaluation set a run belongs to. A visit subset must be named (SMO_SET, e.g. q0, q123); a
    full run is named by its leaf. One directory holds one set (smo.score.evalsets)."""
    name = os.environ.get("SMO_SET")
    if subset and not name:
        raise SystemExit("a run on a visit subset needs SMO_SET (e.g. q0, q123): one directory holds one evaluation set")
    return name or _leaf(mode)


def _leaf(mode: str) -> str:
    return "real" if mode == "real" else (mode if mode.startswith(("guard", "scramble")) else f"pass{mode}")


def run_dir(patch: str, mode: str) -> Path:
    """runs/yardstick/<patch>/<method label>/<leaf>[_<set>]. The set suffix is omitted for a full run
    and for q0 (the legacy name of D-5's first development null)."""
    label = METHOD if os.environ.get("SMO_SCREEN", "1") != "0" else f"{METHOD}_noscreen"
    if SOLVER != "superlu":
        label += f"_{SOLVER}"
    leaf = _leaf(mode)
    name = os.environ.get("SMO_SET")
    if name and name not in (leaf, "q0"):
        leaf = f"{leaf}_{name}"
    sub = leaf if METHOD == "v0" else f"{label}/{leaf}"
    return ROOT / "runs" / "yardstick" / patch / sub


GUARD_PER_AREA_VISIT = 1  # YARDSTICK §7: dead-pipeline guard companion stream
GUARD_PASS_OFFSET = 1000  # guard seeds never coincide with injection-pass seeds


def injection_mode(mode: str) -> tuple[int, int]:
    """(pass number for seeds and truth paths, fakes per area-visit) for an injection mode:
    "<N>" is injection pass N (30 per area-visit); "guard<N>" is guard stream N (1 per area-visit)."""
    from smo.inject.plan import MAX_PER_AREA_VISIT

    if mode.startswith("scramble_guard"):
        return GUARD_PASS_OFFSET + int(mode[len("scramble_guard"):]), GUARD_PER_AREA_VISIT
    if mode.startswith("guard"):
        return GUARD_PASS_OFFSET + int(mode[5:]), GUARD_PER_AREA_VISIT
    return int(mode), MAX_PER_AREA_VISIT


STEP_DAYS = 129.0 / 86400.0
PASS_GAP_DAYS = 60.0


def pseudo_visits(patch: str, frames_by_visit: dict) -> dict:
    """N-scramble (YARDSTICK §7): pseudo-visits from frames of different real visits of the same
    detector pair and the same survey pass (visits clustered in time, a new pass after any gap of
    more than PASS_GAP_DAYS), exposure k taken from a distinct
    visit for slot k, with visit-like times (slot k at T0 + (k - 1) x 129 s). Seeded by patch.
    Returns {pseudo id: (frames, contributing visits)}; pseudo-visits with < 2 filled slots dropped."""
    import hashlib

    from smo.data.patch import PARTNER, Frame

    starts = sorted((min(f.mjd_avg for f in fs), v) for v, fs in frames_by_visit.items())
    pass_of, n_pass, last = {}, 0, None
    for t, v in starts:
        if last is not None and t - last > PASS_GAP_DAYS:
            n_pass += 1
        pass_of[v], last = n_pass, t
    groups: dict = {}
    for v, fs in frames_by_visit.items():
        pair = min(fs[0].detector, PARTNER[fs[0].detector])
        groups.setdefault((pair, pass_of[v]), []).append(v)
    seed = int.from_bytes(hashlib.sha256(f"{patch}|scramble".encode()).digest()[:8], "little")
    rng = np.random.default_rng(seed)
    out = {}
    for (pair, half), vs in sorted(groups.items()):
        vs = [str(v) for v in rng.permutation(sorted(vs))]
        n = 0
        while vs:
            slots, used = [], []
            for k in (1, 2, 3, 4):
                pick = next((v for v in vs if v not in used and any(f.exposure == k for f in frames_by_visit[v])), None)
                if pick is None:
                    continue
                used.append(pick)
                slots.append((k, [f for f in frames_by_visit[pick] if f.exposure == k]))
            for v in used:
                vs.remove(v)
            if len(slots) < 2:
                break
            pid = f"S{pair}P{half}_{n:03d}"
            t0 = slots[0][1][0].mjd_avg
            fr = []
            for k, fs in slots:
                for f in fs:
                    half_len = (f.mjd_end - f.mjd_beg) / 2
                    tk = t0 + (k - 1) * STEP_DAYS
                    fr.append(Frame(f.path, pid, k, f.detector, tk - half_len, tk, tk + half_len))
            out[pid] = (sorted(fr, key=lambda f: (f.exposure, f.detector)), used)
            n += 1
    return out


def check_frozen(patch: str) -> None:
    """Runs on N, NC, V or T patches must use a frozen method whose file hashes all still match."""
    if patch.startswith("D-"):
        return
    if SOLVER != "superlu":
        raise SystemExit(f"solver {SOLVER} is development-only until adopted (FINDINGS)")
    rec = ROOT / "prereg" / f"method_{METHOD}.json"
    if not rec.exists():
        raise SystemExit(f"{patch} is not a development patch: only a frozen method may run on it (no {rec.name})")
    from smo.provenance import sha256_file

    record = json.loads(rec.read_text())
    frozen = record["files"]
    bad = [f for f, h in frozen.items() if not (ROOT / f).exists() or sha256_file(ROOT / f) != h]
    if METHOD == "v4" and record.get("settings", {}).get("track_suppress_px") != V4_SUPPRESS_PX:
        bad.append(f"track_suppress_px {V4_SUPPRESS_PX} != frozen {record.get('settings', {}).get('track_suppress_px')}")
    if bad:
        raise SystemExit(f"method {METHOD} no longer matches its freeze record: {bad}")


def cmd_detect(patch, manifest, centre, mode, workers, only):
    from smo.data.patch import by_visit, frames_from_manifest

    check_frozen(patch)
    frames = frames_from_manifest(manifest, CACHE / "patch" / f"{patch}_frames.json")
    fbv = by_visit(frames)
    stamp = {"config": config_hash(patch), "commit": code_commit(), "method": METHOD, "solver": SOLVER}
    # v3 refits its target frames and reads only v0 maps (context); it needs no stored v1 maps.
    missing = [] if METHOD in ("v3", "v4", "v6") else [f.path for f in frames if load_map(patch, f, stamp) is None]
    stamp["detect_code"] = _source_hash(DETECT_SOURCES)
    from smo.detect import kernel

    stamp["rust_kernel"] = kernel.available()
    if METHOD in ("v2", "v3", "v4", "v6"):
        st0 = {"config": config_hash(patch, "v0"), "commit": code_commit("v0")}
        missing += [f.path for f in frames if load_map(patch, f, st0, "v0") is None]
    if missing and os.environ.get("SMO_ALLOW_MAP_FAILURES") == "1":
        # T6 rule (prereg/METHOD_V6.md, 27 Oct): frames whose v0 fit failed in the maps step, as recorded in
        # maps_failures.json, are absent from every method's static context; as targets they are refitted
        # and drop again, so their visits leave both methods' nulls. Any other missing map still refuses.
        mf = ROOT / "runs/yardstick" / patch / "maps_failures.json"
        failed = {r["frame"] for r in json.loads(mf.read_text())["failures"]} if mf.exists() else set()
        tolerated = [p for p in missing if p in failed]
        missing = [p for p in missing if p not in failed]
        print(f"{len(tolerated)} frames without a v0 map (fit failed in the maps step) tolerated: {tolerated}", flush=True)
    if missing:
        raise SystemExit(f"{len(missing)} frame maps missing or stale; run `maps` first (v2 needs v0 and v1 maps, v3 v0 maps)")
    if MAP_METHOD == "v1" and not (CACHE / "v1" / patch / "static.json").exists():
        raise SystemExit(f"no static lists for {patch}: run scripts/v1_static.py first")
    if mode.startswith("scramble"):
        ps = pseudo_visits(patch, fbv)
        targets = {pid: (fr, used) for pid, (fr, used) in ps.items() if not only or pid in only}
    else:
        targets = {v: (None, ()) for v in (only or list(fbv))}
    visits = list(targets)
    from smo.score.evalsets import write_manifest

    write_manifest(run_dir(patch, mode), eval_set(mode, bool(only)), visits)  # refuses a directory holding another set
    print(f"{patch} {mode}: {len(visits)} {'pseudo-visits' if mode.startswith('scramble') else 'visits'} -> {run_dir(patch, mode)}", flush=True)
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_detect_task, patch, centre, v, fbv, mode, stamp, targets[v][0], tuple(targets[v][1])): v for v in visits}
        for i, fu in enumerate(as_completed(futs), 1):
            try:
                v, dt, n, npass, nfail, nfb = fu.result()
                extra = (f", {nfail} FRAMES DROPPED (fit failed)" if nfail else "") + (f", {nfb} solver fallbacks" if nfb else "")
                print(f"  {i}/{len(visits)} {v}: {n} candidates, {npass} passing{extra}, {dt:.0f}s ({time.time() - t0:.0f}s total)", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"  {i}/{len(visits)} {futs[fu]}: FAILED {e!r}", flush=True)


def main():
    cmd, patch, manifest, ra, dec = sys.argv[1], sys.argv[2], Path(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
    if cmd == "maps":
        cmd_maps(patch, manifest, (ra, dec), int(sys.argv[6]) if len(sys.argv) > 6 else 4)
    elif cmd == "detect":
        mode = sys.argv[6]
        workers = int(sys.argv[7]) if len(sys.argv) > 7 else 4
        cmd_detect(patch, manifest, (ra, dec), mode, workers, sys.argv[8:])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
