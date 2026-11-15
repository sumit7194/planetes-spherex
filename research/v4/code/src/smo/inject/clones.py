"""Fake movers cloned from real MPC orbits (prereg/YARDSTICK.md §4).

Each clone keeps a real orbit's shape (q, e, i, node, peri) and gets a new perihelion time, which
is the same as drawing a new mean anomaly. Positions are two-body heliocentric (ecliptic J2000,
Sun-centred, as kete's states), seen from SPHEREx's header position with one light-time
iteration. A fake is an invented object, so two-body motion is exact for it by definition; what
must be realistic is its rate, direction and the parallax from SPHEREx's orbit, and those follow.

The numpy Kepler solver here is checked against kete's `propagate_two_body` in a unit test.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

GAUSS_K = 0.01720209895  # rad / day, Gaussian gravitational constant
OBLIQUITY_DEG = 84381.448 / 3600.0  # J2000 mean obliquity, as kete's ecliptic frame
C_AU_PER_DAY = 173.1446326846693


@dataclass
class Orbits:
    """Bound orbits as arrays (angles in radians, q in AU, peri_time in JD TDB)."""
    q: np.ndarray
    e: np.ndarray
    inc: np.ndarray
    node: np.ndarray
    peri: np.ndarray
    peri_time: np.ndarray
    group: np.ndarray

    @classmethod
    def from_mpc(cls, table, max_ecc: float = 0.98) -> "Orbits":
        q = table["peri_dist"].to_numpy(float)
        e = table["ecc"].to_numpy(float)
        ok = np.isfinite(q) & np.isfinite(e) & (q > 0) & (e >= 0) & (e < max_ecc)
        for col in ("incl", "lon_node", "peri_arg", "peri_time"):
            ok &= np.isfinite(table[col].to_numpy(float))
        t = table[ok]
        return cls(q[ok], e[ok], np.radians(t["incl"].to_numpy(float)), np.radians(t["lon_node"].to_numpy(float)),
                   np.radians(t["peri_arg"].to_numpy(float)), t["peri_time"].to_numpy(float),
                   t["group_name"].astype(str).to_numpy())

    @classmethod
    def from_snapshot(cls, path) -> "Orbits":
        """The arrays written by scripts/build_orbit_snapshot.py (bit-identical to from_mpc)."""
        with np.load(path, allow_pickle=False) as z:
            return cls(z["q"], z["e"], z["inc"], z["node"], z["peri"], z["peri_time"], z["group"])

    def __len__(self) -> int:
        return len(self.q)

    def take(self, idx: np.ndarray) -> "Orbits":
        return Orbits(self.q[idx], self.e[idx], self.inc[idx], self.node[idx], self.peri[idx],
                      self.peri_time[idx], self.group[idx])

    @property
    def mean_motion(self) -> np.ndarray:
        a = self.q / (1.0 - self.e)
        return GAUSS_K / a ** 1.5

    def with_mean_anomaly(self, mean_anomaly: np.ndarray, jd: float) -> "Orbits":
        """Clones whose mean anomaly at `jd` is `mean_anomaly` (radians); shape unchanged."""
        out = self.take(np.arange(len(self)))
        out.peri_time = jd - np.asarray(mean_anomaly, float) / self.mean_motion
        return out


def _solve_kepler(m: np.ndarray, e: np.ndarray) -> np.ndarray:
    m = np.mod(m, 2 * np.pi)
    ea = np.where(e < 0.8, m, np.pi * np.ones_like(m))
    for _ in range(50):
        d = (ea - e * np.sin(ea) - m) / (1.0 - e * np.cos(ea))
        ea = ea - d
        if np.max(np.abs(d)) < 1e-14:
            break
    return ea


def helio_equatorial(orb: Orbits, jd: np.ndarray | float) -> np.ndarray:
    """Heliocentric equatorial J2000 positions (N, 3) in AU at `jd` (scalar or per orbit)."""
    a = orb.q / (1.0 - orb.e)
    ea = _solve_kepler(orb.mean_motion * (np.asarray(jd, float) - orb.peri_time), orb.e)
    xp = a * (np.cos(ea) - orb.e)
    yp = a * np.sqrt(1.0 - orb.e ** 2) * np.sin(ea)
    cw, sw = np.cos(orb.peri), np.sin(orb.peri)
    cn, sn = np.cos(orb.node), np.sin(orb.node)
    ci, si = np.cos(orb.inc), np.sin(orb.inc)
    x = (cn * cw - sn * sw * ci) * xp + (-cn * sw - sn * cw * ci) * yp
    y = (sn * cw + cn * sw * ci) * xp + (-sn * sw + cn * cw * ci) * yp
    z = (sw * si) * xp + (cw * si) * yp
    ce, se = np.cos(np.radians(OBLIQUITY_DEG)), np.sin(np.radians(OBLIQUITY_DEG))
    return np.stack([x, ce * y - se * z, se * y + ce * z], axis=-1)


def apparent_radec(orb: Orbits, jd: float, observer_pos: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(ra_deg, dec_deg, r_helio_au, delta_au) seen from a heliocentric equatorial observer position,
    with one light-time iteration (ample for a fake: the second iteration changes < 1 mas)."""
    obs = np.asarray(observer_pos, float)
    pos = helio_equatorial(orb, jd)
    delta = np.linalg.norm(pos - obs, axis=-1)
    pos = helio_equatorial(orb, jd - delta / C_AU_PER_DAY)
    vec = pos - obs
    delta = np.linalg.norm(vec, axis=-1)
    ra = np.degrees(np.arctan2(vec[:, 1], vec[:, 0])) % 360.0
    dec = np.degrees(np.arcsin(np.clip(vec[:, 2] / delta, -1, 1)))
    return ra, dec, np.linalg.norm(pos, axis=-1), delta


def angular_sep_deg(ra1, dec1, ra2, dec2):
    r1, d1, r2, d2 = map(np.radians, (ra1, dec1, ra2, dec2))
    s = np.sin((d2 - d1) / 2) ** 2 + np.cos(d1) * np.cos(d2) * np.sin((r2 - r1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(s, 0, 1))))


def draw_clones_near(orb: Orbits, jd: float, observer_pos: np.ndarray, ra0: float, dec0: float,
                     radius_deg: float, rng: np.random.Generator, want: int,
                     max_rounds: int = 200) -> tuple[Orbits, int]:
    """Clones (uniform new mean anomaly per real orbit, one draw per orbit per round) whose apparent
    position at `jd` is within `radius_deg` of (ra0, dec0). Stops once `want` are found or after
    `max_rounds`; returns the clones and the number of rounds used. Rounds are taken whole, so the
    result does not depend on where inside a round `want` was reached; the caller subsamples."""
    found: list[Orbits] = []
    n_found = 0
    rounds = 0
    while n_found < want and rounds < max_rounds:
        rounds += 1
        clones = orb.with_mean_anomaly(rng.uniform(0, 2 * np.pi, len(orb)), jd)
        ra, dec, _, _ = apparent_radec(clones, jd, observer_pos)
        hit = np.nonzero(angular_sep_deg(ra, dec, ra0, dec0) < radius_deg)[0]
        if len(hit):
            found.append(clones.take(hit))
            n_found += len(hit)
    if not found:
        return orb.take(np.array([], dtype=int)), rounds
    return Orbits(*(np.concatenate([getattr(f, k) for f in found])
                    for k in ("q", "e", "inc", "node", "peri", "peri_time", "group"))), rounds
