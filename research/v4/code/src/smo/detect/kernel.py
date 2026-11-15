"""Bridge to the Rust track-search kernel (rust/stackkern), with the Python reference as fallback.

The kernel reproduces `smo.detect.v0._stack` and the two searches built on it (grid argmax per
seed; local sub-pixel argmax per candidate) to floating-point rounding; the unit test
`test_kernel_matches_python_reference` checks values to 1e-9 and identical chosen indices on real
and synthetic frames. It is used only if its binary exists and SMO_RUST is not "0".

File layout (little endian): magic u32 0x534B4E31 ("SKN1"), mode u32, n_frames u32, then per frame
ny u32, nx u32, dx, dy, tau, s, p (f64), cx[10], cy[10] (f64), spline coefficients ny*nx (f64,
scipy spline_filter order 3, mode 'nearest'), finite-mask ny*nx (f64 0/1). Mode 0: n_seeds u64,
n_motions u64, seeds (xi, eta, t) f64, motions (vxi, veta) f64. Mode 1: n_cands u64, n_pos u64,
n_rate u64, candidates (axi, aeta, vxi, veta) f64, position offsets f64, rate offsets f64.
Output: per seed or candidate, (best nu f64, index u64).
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np

BINARY = Path(__file__).resolve().parents[3] / "rust" / "stackkern" / "target" / "release" / "stackkern"
MAGIC = 0x534B4E31


def available() -> bool:
    return os.environ.get("SMO_RUST", "1") != "0" and BINARY.exists()


def _frames_bytes(maps, tau) -> bytes:
    parts = []
    for fm, t in zip(maps, tau, strict=True):
        fm._prepare()
        ny, nx = fm.z.shape
        parts.append(np.array([ny, nx], "<u4").tobytes())
        parts.append(np.array([fm.dx, fm.dy, t, fm.pmap.s, fm.pmap.p], "<f8").tobytes())
        parts.append(np.asarray(fm.pmap.cx, "<f8").tobytes())
        parts.append(np.asarray(fm.pmap.cy, "<f8").tobytes())
        parts.append(np.ascontiguousarray(fm._coef, "<f8").tobytes())
        parts.append(np.ascontiguousarray(fm._m, "<f8").tobytes())
    return b"".join(parts)


def _run(header: bytes, frames: bytes, body: bytes, n_out: int) -> tuple[np.ndarray, np.ndarray]:
    threads = os.environ.get("SMO_KERNEL_THREADS", "1")
    with tempfile.TemporaryDirectory(prefix="stackkern_") as d:
        fin, fout = Path(d) / "in.bin", Path(d) / "out.bin"
        fin.write_bytes(header + frames + body)
        subprocess.run([str(BINARY), str(fin), str(fout), threads], check=True)
        raw = np.frombuffer(fout.read_bytes(), dtype=np.dtype([("v", "<f8"), ("k", "<u8")]))
    if len(raw) != n_out:
        raise RuntimeError(f"stackkern returned {len(raw)} rows, expected {n_out}")
    return raw["v"].astype(np.float64), raw["k"].astype(np.int64)


def grid_best(maps, tau, seeds: np.ndarray, motions: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    header = np.array([MAGIC, 0, len(maps)], "<u4").tobytes()
    body = (np.array([len(seeds), len(motions)], "<u8").tobytes()
            + np.ascontiguousarray(seeds, "<f8").tobytes() + np.ascontiguousarray(motions, "<f8").tobytes())
    return _run(header, _frames_bytes(maps, tau), body, len(seeds))


def local_best(maps, tau, cands: np.ndarray, pos: np.ndarray, rate: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    header = np.array([MAGIC, 1, len(maps)], "<u4").tobytes()
    body = (np.array([len(cands), len(pos), len(rate)], "<u8").tobytes()
            + np.ascontiguousarray(cands, "<f8").tobytes() + np.ascontiguousarray(pos, "<f8").tobytes()
            + np.ascontiguousarray(rate, "<f8").tobytes())
    return _run(header, _frames_bytes(maps, tau), body, len(cands))
