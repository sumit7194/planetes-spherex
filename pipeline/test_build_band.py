"""The homepage band's pass rule (Physics, 14 Nov), on synthetic cells, so it can't drift.

Run: uv run --with pytest --with numpy pytest test_build_band.py -q
"""

import numpy as np

from build_band import passes_by_week, survey_line

WEEKS = 76
META = {"weeks": [{"startMjd": 60800 + 7 * k, "endMjd": 60807 + 7 * k} for k in range(WEEKS)]}


def run(*cells):
    """Each cell is the list of weeks it was photographed in; returns final passes per cell."""
    cov = np.zeros((WEEKS, len(cells)), bool)
    for p, ks in enumerate(cells):
        cov[list(ks), p] = True
    return passes_by_week(META, cov)


def test_never_photographed_is_zero():
    assert run([])[-1, 0] == 0


def test_gap_over_60_days_starts_a_new_pass():
    pw = run([0, 1, 30, 31, 60])  # gaps of 203 and 203 days
    assert list(pw[[0, 29, 30, 59, 60], 0]) == [1, 1, 2, 2, 3]


def test_gap_of_exactly_60_days_or_less_is_the_same_pass():
    # 8 weeks = 56 days (same pass); 9 weeks = 63 days (new pass)
    assert run([0, 8])[-1, 0] == 1
    assert run([0, 9])[-1, 0] == 2


def test_short_continuous_run_is_one_pass():
    assert run(range(0, 21))[-1, 0] == 1  # 140 days, never > 182


def test_polar_cell_counts_one_pass_per_six_months():
    pw = run(range(WEEKS))  # watched every week (near an ecliptic pole)
    mid = np.array([(w["startMjd"] + w["endMjd"]) / 2 for w in META["weeks"]])
    expect = 1 + ((mid - mid[0]) // 182.6).astype(int)
    assert (pw[:, 0] == expect).all()
    assert pw[-1, 0] == 3  # 525 days -> passes 1, 2, 3
    assert pw[26, 0] == 1 and pw[27, 0] == 2  # 182 d vs 189 d


def test_passes_never_go_down():
    pw = run([0, 1, 30, 31, 60], range(WEEKS), [5, 40])
    assert (np.diff(pw, axis=0) >= 0).all()


def fr(a, b, c):
    return {1: {"fraction": a}, 2: {"fraction": b}, 3: {"fraction": c}}


def test_survey_line_today():
    assert survey_line(fr(1.0, 1.0, 0.9616)) == (
        "In the data released so far (DR1 + QR3): the whole sky photographed twice, "
        "and over 96% of it a third time.")


def test_whole_sky_needs_99_percent():
    assert survey_line(fr(0.985, 0.2, 0)) == "In the data released so far (DR1 + QR3): 98% of the sky photographed once."
    assert survey_line(fr(0.99, 0.2, 0)) == (
        "In the data released so far (DR1 + QR3): the whole sky photographed once, and over 20% of it twice.")


def test_survey_line_edges():
    assert survey_line(fr(1, 1, 1)) == "In the data released so far (DR1 + QR3): the whole sky photographed three times."
    assert survey_line(fr(1, 0.005, 0)) == "In the data released so far (DR1 + QR3): the whole sky photographed once."
    assert "under 1%" in survey_line(fr(0.002, 0, 0))
