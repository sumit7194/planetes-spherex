"""Physics' render unit test (PLAN §8, 15 Nov): a rendered fake's pixel sum × Ω × 1e6 equals the
input F_ν (Jy) to < 0.5%, before noise. One real photo, read through the helper (extra=1)."""
import asyncio, sys
import aiohttp, numpy as np
import inject_io as io, helper_client as hc
sys.path.insert(0, "/Users/sumit/Github/SphereXVision/runs/qr3/wt/src")
from smo.inject.render import FrameFake, SMEAR_STEPS, pixel_solid_angle_sr, inject  # noqa: E402

URL = "https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2026W15_2A/l2b-v27-2026-240/6/level2_2026W15_2A_0692_1D6_spx_l2b-v27-2026-240.fits"

async def main():
    async with aiohttp.ClientSession() as s:
        row = dict(url=URL, t=0)
        # Any sky point on the photo: its centre pixel's position, via a first small read.
        from astropy.io import fits
        from astropy.wcs import WCS
        e0 = await hc.native(s, row, 0, 0, 5, extra=False) if False else None
        import spherex as sx
        rd = sx.RangeReader(s)
        h0, l0 = await rd.header(URL, 0, guess=2)
        hi, _ = await rd.header(URL, l0, guess=30)
        ra, dec = WCS(hi).all_pix2world(1020, 1020, 0)
        e = await hc.native(s, row, float(ra), float(dec), 20, extra=True)
        hdr, planes = await io.psf_for(s, e)
    cut = io.cutout_from(e, hdr, planes)
    omega = pixel_solid_angle_sr(cut)
    fnu_jy = 1e-3  # 1 mJy
    flux_img = fnu_jy * 1e-6 / omega
    ny, nx = cut.shape
    xs = np.full((1, SMEAR_STEPS), nx / 2 + 0.3); ys = np.full((1, SMEAR_STEPS), ny / 2 - 0.2)
    fake = FrameFake(0, xs[0], ys[0], float(flux_img))
    # Before noise: render with a zero variance slope, so no photon noise is drawn.
    out, rec = inject(cut, [fake], np.random.default_rng(1), slope=0.0)
    added = (out.image.astype(np.float64) - cut.image.astype(np.float64))
    finite = np.isfinite(added)
    print("finite pixels", int(finite.sum()), "of", added.size)
    got_jy = rec["added_total"] * omega * 1e6  # the renderer's own sum of what it added, before noise
    print("image-difference sum over finite pixels, Jy:", np.nansum(added) * omega * 1e6)
    print("omega sr", omega, "input Jy", fnu_jy, "recovered Jy", got_jy, "ratio", got_jy / fnu_jy)
    assert abs(got_jy / fnu_jy - 1) < 0.005, got_jy / fnu_jy
    print("render unit test passed")

asyncio.run(main())
