"""Unit tests for the scorer's matching (Physics, 15 Nov: the direction check was scaled twice)."""
import math

import numpy as np

import build_pack as bp
import field_stacks as fs
import season_pairs as sp
import yardstick_score as ys

PA, PB = np.array([30.0, 30.0]), np.array([33.0, 31.0])
TRUE_E, TRUE_N = 12.0, 9.0  # ″, 15″ shift


def cand(e, n, sig=20.0, x=31.5, y=30.5):
    return dict(significance=sig, x=x, y=y, shiftEastNorth=[e, n])


def rot(e, n, deg):
    a = math.radians(deg)  # rotate in the (east, north) plane
    return e * math.cos(a) - n * math.sin(a), e * math.sin(a) + n * math.cos(a)


def test_angle_deg():
    assert abs(ys.angle_deg(0, 1, 1, 0) - 90) < 1e-9
    assert abs(ys.angle_deg(0, 1, 0, -1) - 180) < 1e-9
    assert abs(ys.angle_deg(-1, 1e-9, 1, 1e-9) - 180) < 1e-6  # wraps across ±180


def test_exact_shift_is_found():
    assert ys.matches(cand(TRUE_E, TRUE_N), PA, PB, TRUE_E, TRUE_N)


def test_rotated_45_is_not_found():
    for s in (45, -45):
        assert not ys.matches(cand(*rot(TRUE_E, TRUE_N, s)), PA, PB, TRUE_E, TRUE_N)


def test_rotated_20_is_found():
    for s in (20, -20):
        assert ys.matches(cand(*rot(TRUE_E, TRUE_N, s)), PA, PB, TRUE_E, TRUE_N)


def test_other_cuts():
    assert not ys.matches(cand(TRUE_E, TRUE_N, sig=ys.T), PA, PB, TRUE_E, TRUE_N)  # must be > T
    assert not ys.matches(cand(TRUE_E, TRUE_N, x=40), PA, PB, TRUE_E, TRUE_N)  # off the track
    assert not ys.matches(cand(TRUE_E * 1.4, TRUE_N * 1.4), PA, PB, TRUE_E, TRUE_N)  # 40% too big
    assert ys.matches(cand(TRUE_E * 1.25, TRUE_N * 1.25), PA, PB, TRUE_E, TRUE_N)


def test_sign_convention_matches_the_search():
    # The scorer's true (east, north) from sky positions must agree with how the search turns a
    # pixel shift into shiftEastNorth (east = -dx * PIX, north = +dy * PIX) on the field grid.
    gw = bp.out_grid(150.0, 30.0, fs.SIZE)
    ra_a, de_a = gw.all_pix2world(30.0, 30.0, 0)
    ra_b, de_b = float(ra_a) + 10 / 3600 / math.cos(math.radians(float(de_a))), float(de_a) + 5 / 3600
    pb = np.array(gw.all_world2pix(ra_b, de_b, 0), float)
    dx, dy = pb[0] - 30.0, pb[1] - 30.0
    search_e, search_n = -dx * sp.PIX, dy * sp.PIX
    assert abs(search_e - 10) < 0.2 and abs(search_n - 5) < 0.2, (search_e, search_n)


if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_"):
            v()
    print("all passed")
