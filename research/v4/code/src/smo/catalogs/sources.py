"""Source lists for the scene fit (copied from scripts/day0_blur_test.py, which stays unchanged so
earlier results remain reproducible)."""

from __future__ import annotations

import numpy as np


def merge_close(x, y, gflux, min_sep=1.0):
    """Union sources closer than min_sep px; merged position is the G-flux-weighted mean."""
    n = len(x)
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    order = np.argsort(x)
    for a_i in range(n):
        a = order[a_i]
        for b in order[a_i + 1:]:
            if x[b] - x[a] >= min_sep:
                break
            if (x[a] - x[b]) ** 2 + (y[a] - y[b]) ** 2 < min_sep ** 2:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[rb] = ra
    roots = np.array([find(i) for i in range(n)])
    uniq, inv = np.unique(roots, return_inverse=True)
    w = np.bincount(inv, gflux)
    mx = np.bincount(inv, gflux * x) / w
    my = np.bincount(inv, gflux * y) / w
    return mx, my, w, len(x) - len(uniq)
