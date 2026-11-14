"""Photo bundles and precomputed sums for the five's packs: the Watch tab's speed fix.

Opening Watch on R Draconis fetched 1,074 files (11 MB): each of 537 photos is two little files
(.f32 image, .u8 flags), and the "all photos added together" row loaded every photo of all six
colour ranges before anything was chosen (measured 14 Nov). This adds, next to the existing files
(which stay, so nothing else changes):

  bundles/D<d>.bin   every photo of detector d in date order, each as its float32 image then
                     its uint8 flags (byte-identical to the .f32 and .u8 files), so the page
                     fetches one file per colour range, and only when it's played;
  coadds/D<d>.f32    the six "all photos added together" images and their flags, made exactly as
  coadds/D<d>.u8     the page made them (src/data/pack/coadd.ts: mean of finite pixels, OR'd
                     flags), so the row shows at once.

The manifest gains `bundles` and `coadds`; each bundle records its frame order, bytes per frame
and sha256. Every frame's bytes are checked against the manifest's sha256 first.

Usage: python pack_bundles.py [--release dr1qr3] [--targets barnard r-dra ...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

PACKS = Path(__file__).parent.parent / "public" / "data" / "packs"
TARGETS = ["barnard", "w0855", "epsind-b", "rw-aur", "r-dra"]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def frame_bytes(base: Path, f: dict, n: int) -> tuple[bytes, bytes]:
    img = (base / f["image"]).read_bytes()
    fl = (base / f["flags"]).read_bytes()
    if len(img) != 4 * n * n or len(fl) != n * n:
        raise ValueError(f"{f['id']}: unexpected sizes {len(img)}, {len(fl)}")
    # The manifest's sha256 is of the image file (checked here so a bundle never carries a
    # changed photo).
    if sha(img) != f["sha256"] and sha(img + fl) != f["sha256"]:
        raise ValueError(f"{f['id']}: sha256 does not match the manifest")
    return img, fl


def coadd(imgs: list[np.ndarray], flags: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """As src/data/pack/coadd.ts: float64 sum of finite values in order, / count, as float32;
    NaN where no photo covers; flags OR'd."""
    s = np.zeros(imgs[0].shape, np.float64)
    c = np.zeros(imgs[0].shape, np.uint32)
    fo = np.zeros(imgs[0].shape, np.uint8)
    for im, fl in zip(imgs, flags):
        ok = np.isfinite(im)
        s[ok] += im[ok].astype(np.float64)
        c[ok] += 1
        fo |= fl
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(c > 0, s / np.maximum(c, 1), np.nan).astype("<f4")
    return out, fo


def bundle_pack(release: str, target: str) -> dict:
    base = PACKS / release / target
    m = json.loads((base / "manifest.json").read_text())
    n = m["grid"]["size"]
    (base / "bundles").mkdir(exist_ok=True)
    (base / "coadds").mkdir(exist_ok=True)
    bundles, coadds, total = [], [], 0
    for d in range(1, 7):
        # Date order, ties kept in manifest order (as the page's stable sort does).
        frames = sorted((f for f in m["frames"] if f["detector"] == d), key=lambda f: f["mjd"])
        if not frames:
            continue
        parts, imgs, fls = [], [], []
        for f in frames:
            img, fl = frame_bytes(base, f, n)
            parts += [img, fl]
            imgs.append(np.frombuffer(img, "<f4").reshape(n, n))
            fls.append(np.frombuffer(fl, "u1").reshape(n, n))
        blob = b"".join(parts)
        path = f"bundles/D{d}.bin"
        (base / path).write_bytes(blob)
        total += len(blob)
        bundles.append(dict(detector=d, file=path, frameIds=[f["id"] for f in frames],
                            bytesPerFrame=5 * n * n, layout="float32 image, then uint8 flags, per frame",
                            sha256=sha(blob)))
        # The page's coadd uses every frame of the detector in manifest order; the mean is
        # order-independent up to float64 rounding, which float32 output absorbs.
        mf = [f for f in m["frames"] if f["detector"] == d]
        order = {f["id"]: k for k, f in enumerate(frames)}
        ci, cf = coadd([imgs[order[f["id"]]] for f in mf], [fls[order[f["id"]]] for f in mf])
        (base / f"coadds/D{d}.f32").write_bytes(ci.tobytes())
        (base / f"coadds/D{d}.u8").write_bytes(cf.tobytes())
        coadds.append(dict(detector=d, id=f"coadd_D{d}", image=f"coadds/D{d}.f32", flags=f"coadds/D{d}.u8", n=len(mf)))
    m["bundles"] = bundles
    m["coadds"] = coadds
    raw = (base / "manifest.json").read_text()
    # Same compact style as planetes_pack.py writes, so the diff is only the two new fields.
    (base / "manifest.json").write_text(json.dumps(m, separators=(",", ":"), ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""))
    return dict(target=target, frames=len(m["frames"]), bundles=len(bundles), MB=round(total / 1e6, 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default="dr1qr3")
    ap.add_argument("--targets", nargs="*", default=TARGETS)
    a = ap.parse_args()
    for t in a.targets:
        print(bundle_pack(a.release, t))


if __name__ == "__main__":
    main()
