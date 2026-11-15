"""Known solar-system objects in a SPHEREx exposure, predicted with kete from SPHEREx's own position.

* Observer: the spacecraft position and velocity in each IMAGE header (X_SC.. VZ_SC, geocentric,
  km and km/s, assumed ICRF/J2000 equatorial), added to Earth's heliocentric state from kete's
  SPICE kernels. `check_observer_frame` compares this against kete's independently reconstructed
  SPHEREx ephemeris, which tests the frame assumption.
* Objects: MPC orbits (kete.mpc), propagated with kete's n-body integrator, with light-time
  correction, checked against the exposure's polygon footprint.
* kete's Rust core uses a thread pool sized by RAYON_NUM_THREADS. Callers set it before import,
  so the pipeline never takes cores that other jobs on the machine hold.
"""

from __future__ import annotations

import numpy as np
from astropy.io import fits

import kete

AU_KM = 149_597_870.7
DAY_S = 86_400.0


def exposure_time(h: fits.Header) -> kete.Time:
    return kete.Time.from_mjd(float(h["MJD-AVG"]), scaling="utc")


def observer_state(h: fits.Header) -> kete.State:
    if h.get("XYZ_SC_SYSTEM", "GEOCENTER") != "GEOCENTER":
        raise ValueError(f"unexpected spacecraft frame {h.get('XYZ_SC_SYSTEM')}")
    t = exposure_time(h)
    earth = kete.spice.get_state("Earth", t.jd, frame=kete.Frames.Equatorial)
    sc_pos = np.array([h["X_SC"], h["Y_SC"], h["Z_SC"]], dtype=float) / AU_KM
    sc_vel = np.array([h["VX_SC"], h["VY_SC"], h["VZ_SC"]], dtype=float) * DAY_S / AU_KM
    pos = np.array(earth.pos.as_equatorial.raw) + sc_pos
    vel = np.array(earth.vel.as_equatorial.raw) + sc_vel
    return kete.State("SPHEREx", t.jd, kete.Vector(list(pos), kete.Frames.Equatorial),
                      kete.Vector(list(vel), kete.Frames.Equatorial), kete.Frames.Equatorial)


def check_observer_frame(h: fits.Header) -> float:
    """Distance in km between the header-based position and kete's reconstructed SPHEREx state."""
    import kete.spherex

    obs = observer_state(h)
    ref = kete.spice.get_state("spherex", obs.jd, frame=kete.Frames.Equatorial)
    a = np.array(obs.pos.as_equatorial.raw)
    b = np.array(ref.pos.as_equatorial.raw)
    return float(np.linalg.norm(a - b) * AU_KM)


def footprint(wcs, ny: int, nx: int, observer: kete.State) -> kete.PolygonFOV:
    xs = [-0.5, nx - 0.5, nx - 0.5, -0.5]
    ys = [-0.5, -0.5, ny - 0.5, ny - 0.5]
    sky = wcs.pixel_to_world(xs, ys)
    corners = [kete.Vector.from_ra_dec(float(c.ra.deg), float(c.dec.deg)) for c in sky]
    return kete.PolygonFOV(corners, observer)


def load_orbits(kind: str = "all"):
    url = {"all": None, "nea": "https://minorplanetcenter.net/Extended_Files/nea_extended.json.gz"}[kind]
    orbits = kete.mpc.fetch_known_orbit_data(url) if url else kete.mpc.fetch_known_orbit_data()
    return orbits, kete.conversion.table_to_states(orbits)


def states_at_epoch(states, jd: float, cache_dir):
    """All states n-body propagated to one epoch (TDB JD), cached as kete's own parquet format."""
    from pathlib import Path

    path = Path(cache_dir) / "ephem" / f"mpc_states_jd{jd:.1f}.parquet"
    if path.exists():
        return list(kete.SimultaneousStates.load_parquet(str(path)).states)
    out = kete.propagate_n_body(states, jd)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.parquet")
    kete.SimultaneousStates(out).save_parquet(str(tmp))
    tmp.replace(path)
    return list(out)


def predict(fovs: list, orbits, states) -> list[dict]:
    """Objects visible in each FOV, with RA/Dec, rates and HG V magnitudes."""
    # Numbered objects are integers in the MPC table but strings in kete states: key by str.
    h_of = dict(zip(orbits["desig"].astype(str), orbits["h_mag"].astype(float), strict=True))
    g_of = dict(zip(orbits["desig"].astype(str), orbits["g_phase"].astype(float), strict=True)) if "g_phase" in orbits else {}
    vis = kete.fov_state_check(states, fovs)
    out = []
    for sim in vis:
        obs = sim.fov.observer
        sun2obs = np.array(obs.pos.as_ecliptic.raw)
        for st, (ra, dec, dra, ddec) in zip(sim.states, sim.ra_dec_with_rates, strict=True):
            sun2obj = np.array(st.pos.as_ecliptic.raw)
            h_mag = h_of.get(str(st.desig), np.nan)
            g = g_of.get(str(st.desig), np.nan)
            g = g if np.isfinite(g) else 0.15
            v = kete.flux.hg_apparent_mag(list(sun2obj), list(sun2obs), h_mag, g) if np.isfinite(h_mag) else np.nan
            out.append({"desig": st.desig, "ra": float(ra), "dec": float(dec), "dra_deg_per_day": float(dra),
                        "ddec_deg_per_day": float(ddec), "v_mag": float(v), "h_mag": h_mag,
                        "r_au": float(np.linalg.norm(sun2obj)), "delta_au": float(np.linalg.norm(sun2obj - sun2obs)),
                        "fov_jd": float(sim.fov.observer.jd)})
    return out
