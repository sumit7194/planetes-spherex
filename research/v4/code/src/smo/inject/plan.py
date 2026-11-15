"""Plan one injection pass into one target visit (prereg/YARDSTICK.md §4).

Only the target visit's frames receive fakes; every other visit of the patch, which forms the
static context, stays un-injected. Seeds derive from (patch, target visit, pass), so every method
sees bit-identical injected frames. Separate random streams drive the clone draw, the per-fake
photometry and the photon noise, so changing one cannot shift another.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord

from smo.data.calib import spectral_wcs
from smo.data.exposure import Cutout, load_cutout
from smo.data.flags import FIT_REJECT, bit_map, mask_for
from smo.data.patch import Frame
from smo.ephem.known import observer_state
from smo.inject.clones import Orbits, apparent_radec, draw_clones_near
from smo.inject.render import FrameFake, SMEAR_STEPS, pixel_solid_angle_sr
from smo.inject.spectra import draw_photometry, frame_fluxes_jy, spectral_shape

M_REF_RANGE = (15.5, 21.0)
MAX_PER_AREA_VISIT = 30
MIN_SEP_PX = 10.0
PIXEL_ARCSEC = 6.15
SELECT_RADIUS_DEG = 0.75  # covers a 1 deg^2 square cutout (half-diagonal 0.707 deg)


def seed_for(patch: str, visit: str, pass_no: int) -> int:
    h = hashlib.sha256(f"{patch}|{visit}|{pass_no}".encode()).digest()
    return int.from_bytes(h[:8], "little")


@dataclass
class VisitPlan:
    patch: str
    visit: str
    pass_no: int
    seed: int
    t0: float  # MJD, mean of the frames' MJD-AVG
    frames: list[Frame]
    per_frame: dict[str, list[FrameFake]] = field(default_factory=dict)  # frame path -> fakes
    truth: list[dict] = field(default_factory=list)
    clone_rounds: int = 0


def _helio_observer(cut: Cutout) -> np.ndarray:
    return np.array(observer_state(cut.image_header).pos.as_equatorial.raw)


def _pixels(cut: Cutout, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x, y = cut.wcs().world_to_pixel(SkyCoord(np.asarray(ra) * u.deg, np.asarray(dec) * u.deg))
    return np.asarray(x, float), np.asarray(y, float)


def plan_visit(patch: str, centre: tuple[float, float], frames: list[Frame], orbits: Orbits,
               pass_no: int, cache: Path, want: int = MAX_PER_AREA_VISIT,
               max_rounds: int = 200) -> VisitPlan:
    """Fakes are drawn in a circle of SELECT_RADIUS_DEG, at `want` per deg^2 of that circle, so the
    density inside the (smaller, rotated) square cutout is at most `want` per area-visit."""
    visit = frames[0].visit
    seed = seed_for(patch, visit, pass_no)
    s_clone, s_phot, _s_noise = np.random.SeedSequence(seed).spawn(3)
    rng_c, rng_p = np.random.default_rng(s_clone), np.random.default_rng(s_phot)
    t0 = float(np.mean([f.mjd_avg for f in frames]))
    cuts = {f.path: load_cutout(Path(f.path)) for f in frames}
    first = cuts[frames[0].path]
    obs0 = _helio_observer(first)
    jd0 = t0 + 2400000.5
    cap = int(round(want * np.pi * SELECT_RADIUS_DEG ** 2))  # 30 -> 53 (as before), 1 -> 2
    clones, rounds = draw_clones_near(orbits, jd0, obs0, centre[0], centre[1], SELECT_RADIUS_DEG,
                                      rng_c, cap, max_rounds=max_rounds)
    plan = VisitPlan(patch, visit, pass_no, seed, t0, frames, {f.path: [] for f in frames}, [], rounds)
    if len(clones) == 0:
        return plan

    # Random order, then greedy minimum separation at t0, then the cap.
    order = rng_c.permutation(len(clones))
    clones = clones.take(order)
    ra0, dec0, r0, d0 = apparent_radec(clones, jd0, obs0)
    keep: list[int] = []
    for k in range(len(clones)):
        if len(keep) >= cap:
            break
        if keep:
            sep = SkyCoord(ra0[k] * u.deg, dec0[k] * u.deg).separation(
                SkyCoord(ra0[keep] * u.deg, dec0[keep] * u.deg)).arcsec
            if np.min(sep) < MIN_SEP_PX * PIXEL_ARCSEC:
                continue
        keep.append(k)
    clones = clones.take(np.array(keep))
    ra0, dec0, r0, d0 = ra0[keep], dec0[keep], r0[keep], d0[keep]
    jd_rate = jd0 + 1.0 / 24.0
    ra1, dec1, _, _ = apparent_radec(clones, jd_rate, obs0)
    rate_arcsec_per_s = SkyCoord(ra0 * u.deg, dec0 * u.deg).separation(SkyCoord(ra1 * u.deg, dec1 * u.deg)).arcsec / 3600.0

    # Geometry in every frame.
    geo = {}
    for f in frames:
        cut = cuts[f.path]
        obs = _helio_observer(cut)
        ny, nx = cut.shape
        rej, _ = mask_for(cut.flags, bit_map(cut.flags_header), FIT_REJECT)
        ts = np.linspace(f.mjd_beg, f.mjd_end, SMEAR_STEPS)
        xs, ys = [], []
        for t in ts:
            ra, dec, _, _ = apparent_radec(clones, t + 2400000.5, obs)
            x, y = _pixels(cut, ra, dec)
            xs.append(x)
            ys.append(y)
        xs, ys = np.array(xs).T, np.array(ys).T  # (n_fakes, steps)
        xm, ym = xs[:, SMEAR_STEPS // 2], ys[:, SMEAR_STEPS // 2]
        ixm, iym = np.rint(xm).astype(int), np.rint(ym).astype(int)
        inside = (ixm >= 0) & (ixm < nx) & (iym >= 0) & (iym < ny)
        valid = np.zeros(len(clones), bool)
        valid[inside] = ~rej[iym[inside], ixm[inside]]
        cw, _, cw_sha = spectral_wcs(cache, f.detector)
        wl = np.full(len(clones), np.nan)
        wl[inside] = cw[iym[inside] + cut.y0, ixm[inside] + cut.x0]
        geo[f.path] = {"xs": xs, "ys": ys, "inside": inside, "valid": valid, "wl": wl,
                       "obs": obs, "omega": pixel_solid_angle_sr(cut)}

    # Photometry per fake, and the per-frame flux.
    for k in range(len(clones)):
        phot = draw_photometry(rng_p)
        m_ref = float(rng_p.uniform(*M_REF_RANGE))
        on = [f for f in frames if geo[f.path]["inside"][k]]
        rec = {"fake_id": k, "ra_t0": float(ra0[k]), "dec_t0": float(dec0[k]), "m_ref": m_ref,
               "cls": phot.cls, "pv": phot.pv, "lc_amp": phot.lc_amp_mag, "lc_period_h": phot.lc_period_h,
               "group": str(clones.group[k]), "r_au": float(r0[k]), "delta_au": float(d0[k]),
               "rate_arcsec_per_s": float(rate_arcsec_per_s[k]),
               "n_valid_frames": int(sum(geo[f.path]["valid"][k] for f in frames)),
               "n_valid_times": len({f.exposure for f in frames if geo[f.path]["valid"][k]}),
               "frames": {}}
        if not any(f.is_short for f in on):
            rec["skipped"] = "no short-wavelength frame contains it"
            plan.truth.append(rec)
            continue
        wl = np.array([geo[f.path]["wl"][k] for f in on])
        sun2obj = apparent_helio_at(clones, k, t0)
        shape = spectral_shape(phot, sun2obj, geo[on[0].path]["obs"], wl)
        lc = phot.lightcurve(np.array([f.mjd_avg for f in on]))
        jy = frame_fluxes_jy(m_ref, shape, np.array([f.is_short for f in on]), lc)
        for f, fj, w in zip(on, jy, wl, strict=True):
            g = geo[f.path]
            flux_img = fj * 1e-6 / g["omega"]
            plan.per_frame[f.path].append(FrameFake(k, g["xs"][k], g["ys"][k], float(flux_img)))
            rec["frames"][f.path] = {"jy": float(fj), "wavelength_um": float(w), "valid": bool(g["valid"][k]),
                                     "x_mid": float(g["xs"][k, SMEAR_STEPS // 2]),
                                     "y_mid": float(g["ys"][k, SMEAR_STEPS // 2])}
        plan.truth.append(rec)
    return plan


def apparent_helio_at(clones: Orbits, k: int, mjd: float) -> np.ndarray:
    from smo.inject.clones import helio_equatorial

    return helio_equatorial(clones.take(np.array([k])), mjd + 2400000.5)[0]


def noise_rng(plan: VisitPlan, frame_path: str) -> np.random.Generator:
    """Photon-noise stream for one frame of a plan, independent of every other stream."""
    _, _, s_noise = np.random.SeedSequence(plan.seed).spawn(3)
    h = int.from_bytes(hashlib.sha256(Path(frame_path).name.encode()).digest()[:4], "little")
    return np.random.default_rng(np.random.SeedSequence([int(s_noise.generate_state(1)[0]), h]))
