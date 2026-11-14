"""Bit-identity: the cloud helper's boxes against Physics' own reader (smo.data.exposure), before
any injection uses the helper (yardstick plan, section 7; Physics, 14 Nov late).

Runs in Physics' environment (it imports smo), so it reads the helper with httpx and decodes the
'PLN2' answer inline. For each photo (one DR1, one QR3, one at a detector edge):
  - Physics' fetch_cutout at a full-frame pixel (cx, cy), half H (box 2H+1 wide);
  - the helper's /v1/native?extra=1 at the same pixel's sky position, half H+2 (box covers it);
  - IMAGE, FLAGS, VARIANCE and ZODI compared on Physics' box, exactly (NaN = NaN);
  - the FLAGS header compared card by card; the image header's WCS cards likewise;
  - the helper's /v1/psf bytes compared byte for byte with the photo's PSF extension, read by
    Physics' range reader, and the ePSF planes Physics would use decoded from both.
Cutouts are cached under pipeline/cache/smo_identity (git-ignored), not in SphereXVision.

Usage: /Users/sumit/Github/SphereXVision/runs/qr3/wt/.venv/bin/python pipeline/smo_identity.py
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

sys.path.insert(0, "/Users/sumit/Github/SphereXVision/runs/qr3/wt/src")
from smo.data.exposure import _walk, fetch_cutout  # noqa: E402
from smo.data.fitsrange import RangeReader, read_planes  # noqa: E402
from smo.data.qr3 import read_epsf  # noqa: E402
from smo.data.s3 import L2Key  # noqa: E402

HELPER = "https://planetes-live.planetes.workers.dev"
CACHE = Path(__file__).parent / "cache" / "smo_identity"
H = 20
PICKS = [
    ("DR1 centre", "dr1/level2/2026W15_2A/l2b-v27-2026-240/6/level2_2026W15_2A_0692_1D6_spx_l2b-v27-2026-240.fits", 1020.0, 1020.0),
    ("QR3 centre", "qr3/level2/2026W21_2A/l2b-v27-2026-268/2/level2_2026W21_2A_0001_2D2_spx_l2b-v27-2026-268.fits", 1020.0, 1020.0),
    ("DR1 edge", "dr1/level2/2026W15_2A/l2b-v27-2026-240/6/level2_2026W15_2A_0692_1D6_spx_l2b-v27-2026-240.fits", 6.0, 1500.0),
]


def decode(buf: bytes) -> dict:
    assert buf[:4] == b"PLN2", buf[:4]
    j = struct.unpack("<I", buf[4:8])[0]
    m = json.loads(buf[8:8 + j])
    n = m["w"] * m["h"]
    shape = (m["h"], m["w"])
    arr = lambda k, dt: np.frombuffer(buf, dt, n, 8 + j + 4 * k * n).reshape(shape)  # noqa: E731
    return dict(meta=m, image=arr(0, "<f4"), flags=arr(1, "<i4"), variance=arr(2, "<f4"), zodi=arr(3, "<f4"))


class BytesRR:
    """Physics' RangeReader interface over the helper's PSF bytes, placed at the file offset."""

    def __init__(self, data: bytes, start: int):
        self.data, self.start = data, start

    def read(self, a: int, b: int) -> bytes:
        return self.data[a - self.start: b - self.start]


def get(c: httpx.Client, url: str, **params) -> httpx.Response:
    """The helper, with retries (it answers 503 now and then while the null run is busy)."""
    import time
    for attempt in range(6):
        r = c.get(url, params=params)
        if r.status_code < 500:
            r.raise_for_status()
            return r
        time.sleep(2 * (attempt + 1))
    r.raise_for_status()
    return r


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    ok_all = True
    # Physics' settings (14 Nov): an inactivity timeout and a pool larger than the reader's 8
    # parallel chunks; with neither, a dead read on the 4 MB EPSF waited forever.
    with httpx.Client(timeout=httpx.Timeout(60, pool=60), limits=httpx.Limits(max_connections=32),
                      follow_redirects=True) as c:
        for name, key, cx, cy in PICKS:
            import time as _t
            t0 = _t.time()
            step = lambda what: print(f"  [{name}] {what} {_t.time() - t0:.1f}s", flush=True)  # noqa: E731
            k = L2Key(key)
            cut, _ = fetch_cutout(c, k, cx, cy, H, CACHE)
            step("Physics cutout")
            ra, dec = (float(v) for v in WCS(cut.image_header).pixel_to_world_values(cx, cy))
            r = get(c, f"{HELPER}/v1/native", key=key, ra=f"{ra:.8f}", dec=f"{dec:.8f}", half=str(H + 2), extra="1")
            hb = decode(r.content)
            step("helper box")
            hx0, hy0 = hb["meta"]["x0"], hb["meta"]["y0"]
            ny, nx = cut.shape
            sl = (slice(cut.y0 - hy0, cut.y0 - hy0 + ny), slice(cut.x0 - hx0, cut.x0 - hx0 + nx))
            res = {}
            for arr in ("image", "variance", "zodi"):
                a, b = getattr(cut, arr), hb[arr][sl]
                res[arr] = a.shape == b.shape and np.array_equal(a.astype("<f4"), b, equal_nan=True)
            res["flags"] = np.array_equal(cut.flags.astype(np.int64), hb["flags"][sl].astype(np.int64))
            fh = fits.Header.fromstring(hb["meta"]["flagsHeader"])
            res["flags header"] = all(fh.get(kk) == cut.flags_header.get(kk) for kk in cut.flags_header if kk not in ("", "COMMENT", "HISTORY"))
            wh = fits.Header.fromstring(hb["meta"]["header"])
            wcs_keys = [kk for kk in wh if kk.startswith(("CRPIX", "CRVAL", "CD", "PC", "CTYPE", "A_", "B_", "AP_", "BP_", "CDELT", "LONPOLE", "LATPOLE"))]
            res["wcs cards"] = bool(wcs_keys) and all(wh[kk] == cut.image_header.get(kk) for kk in wcs_keys)
            # The PSF extension: helper bytes vs the photo's own bytes, then the planes.
            rr = RangeReader(c, k.url)
            hdus = _walk(rr)
            step("HDU walk")
            ph = hdus[5]
            direct = rr.read(ph.header_start, ph.data_start + ph.data_size)
            step("PSF direct read")
            p = get(c, f"{HELPER}/v1/psf", key=key)
            step("PSF helper read")
            pj = struct.unpack("<I", p.content[4:8])[0]
            pbytes = p.content[8 + pj:]
            res["psf bytes"] = pbytes[: len(direct)] == direct
            fake = BytesRR(pbytes, ph.header_start)
            if ph.name == "EPSF":
                _, pl_h = read_epsf(fake, ph)
                _, pl_d = read_epsf(rr, ph)
            else:
                ks = sorted(cut.psf_planes)
                pl_h, pl_d = read_planes(fake, ph, ks), read_planes(rr, ph, ks)
            res["psf planes"] = sorted(pl_h) == sorted(pl_d) and all(np.array_equal(pl_h[i], pl_d[i]) for i in pl_d)
            res["psf planes used"] = all(np.array_equal(cut.psf_planes[i], pl_h[i]) for i in cut.psf_planes)
            ok = all(res.values())
            ok_all &= ok
            print(f"{name}: {key.split('/')[-1]}  box {cut.shape} at ({cut.x0},{cut.y0}), version {hdus[0].header.get('VERSION')}, psf {ph.name}")
            print("   " + ", ".join(f"{kk} {'same' if v else 'DIFFERENT'}" for kk, v in res.items()), flush=True)
    print("ALL IDENTICAL" if ok_all else "SOME DIFFERENCES")


if __name__ == "__main__":
    main()
