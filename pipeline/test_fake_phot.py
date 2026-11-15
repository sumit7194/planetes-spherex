"""Unit tests for fake_phot (Physics' tests, PLAN §8, 15 Nov)."""
import numpy as np

import fake_phot as fp


def test_nu_minus_two_gives_wise_zero_point():
    # On WISE's own system (Physics' decision (b), 15 Nov: CALSPEC level × WISE_OVER_CALSPEC, as
    # yardstick_inject does with W2_SYSTEM=wise), F_ν ∝ ν⁻² set to W2 = m must give
    # ≈ 171.787 × 10^(-0.4 m) Jy at λ_iso 4.6028 µm. Plain CALSPEC misses by 2.6% (PLAN §8).
    import yardstick_inject as yi
    lam = np.linspace(2.0, 6.5, 20000)
    fnu = lam ** 2
    for m in (12.0, 15.0, 18.0):
        s = fp.scale_to_w2(lam, fnu, m) * yi.WISE_OVER_CALSPEC
        got = float(np.interp(fp.W2_ISO_UM, lam, fnu * s))
        want = fp.W2_ZP_JY * 10 ** (-0.4 * m)
        assert abs(got / want - 1) < 0.002, (m, got, want)


def test_vega_is_zero():
    lv, fv = fp.vega()
    assert abs(fp.scale_to_w2(lv, fv, 0.0) - 1.0) < 1e-9


def test_band_average_of_flat_spectrum():
    lam = np.linspace(0.5, 6, 1000)
    assert abs(fp.band_fnu_jy(lam, np.full_like(lam, 2.5), 3.0, 0.05) - 2.5) < 1e-12


if __name__ == "__main__":
    test_nu_minus_two_gives_wise_zero_point()
    test_vega_is_zero()
    test_band_average_of_flat_spectrum()
    lam = np.linspace(2.0, 6.5, 20000)
    import yardstick_inject as yi
    s = fp.scale_to_w2(lam, lam ** 2, 15.0) * yi.WISE_OVER_CALSPEC
    print("nu^-2 at W2=15:", float(np.interp(fp.W2_ISO_UM, lam, lam ** 2 * s)), "vs", fp.W2_ZP_JY * 10 ** -6)
    import json
    print(json.dumps(fp.family_colours(), indent=1))
    print("all passed")
