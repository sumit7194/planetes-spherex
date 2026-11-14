"""Walk the HDUs of one SPHEREx Level 2 file with byte-range reads and print the layout.

Usage: uv run python probe.py [URL]
"""

import asyncio
import sys

import aiohttp

from spherex import BLOCK, RangeReader, data_bytes

URL = sys.argv[1] if len(sys.argv) > 1 else (
    "https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2025W19_1B/l2b-v27-2026-197/3/"
    "level2_2025W19_1B_0116_1D3_spx_l2b-v27-2026-197.fits"
)


async def main():
    async with aiohttp.ClientSession() as s:
        rd = RangeReader(s)
        off = 0
        for i in range(10):
            try:
                h, hl = await rd.header(URL, off)
            except Exception as ex:  # past the end of the file
                print("end", off, repr(ex)[:80])
                break
            name = h.get("EXTNAME", "PRIMARY")
            n = data_bytes(h)
            print(i, name, h.get("XTENSION"), "hdr@", off, "data@", off + hl, "bytes", n,
                  [h.get(f"NAXIS{k}") for k in range(1, h.get("NAXIS", 0) + 1)])
            if name in ("IMAGE", "WCS-WAVE"):
                for k in h:
                    if any(t in k for t in ("CTYPE", "PS", "PV", "WAVE", "CUNIT", "TTYPE", "TFORM", "TDIM", "CRPIX", "CRVAL", "CDELT")):
                        print("   ", k, "=", h[k])
            off += hl + n
        print("requests", rd.nreq, "bytes", rd.nbytes, "block", BLOCK)


asyncio.run(main())
