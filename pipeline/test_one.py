"""Smoke test: read one exposure's box, flags and wavelength at the target. Compare with astropy."""

import asyncio
import sys

import aiohttp
import numpy as np
from astropy.io import fits

from spherex import RangeReader, read_box, read_wave, wave_at

URL = ("https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2025W19_1B/l2b-v27-2026-197/3/"
       "level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits")
RA, DEC = 133.760052, -7.242598


async def main():
    async with aiohttp.ClientSession() as s:
        rd = RangeReader(s)
        e = await read_box(rd, dict(url=URL, det=3, t=0.0), RA, DEC, 20)
        tab = await read_wave(rd, URL)
        lam, bw = wave_at(tab, e["xt"], e["yt"])
        print("box", e["img"].shape, "x,y", round(e["xt"], 2), round(e["yt"], 2), "lam", round(lam, 4), "bw", round(bw, 4))
        print("wave grid x", tab["x"][:3], "...", tab["x"][-1], "y", tab["y"][:3], "...", tab["y"][-1])
        print("flag names", sorted(e["bits"], key=e["bits"].get)[:40])
        print("requests", rd.nreq, "MB", round(rd.nbytes / 1e6, 2))
    if "--astropy" in sys.argv:
        with fits.open(URL, use_fsspec=True, fsspec_kwargs={"block_size": 2**20}) as h:
            y0, x0 = e["y0"], e["x0"]
            ny, nx = e["img"].shape
            a = h["IMAGE"].section[y0:y0 + ny, x0:x0 + nx]
            f = h["FLAGS"].section[y0:y0 + ny, x0:x0 + nx]
            print("IMAGE equal:", np.array_equal(a, e["img"], equal_nan=True), "FLAGS equal:", np.array_equal(f, e["fl"]))


asyncio.run(main())
