"""Minimal SPHEREx Level 2 access: IRSA SIA search and S3 byte-range reads of a small sky box.

Each SPHEREx spectral image is a multi-extension FITS file (~66 MB) in IRSA's public bucket
s3://nasa-irsa-spherex. We read only the headers and the image rows that cover the box,
plus the matching rows of the RICE-compressed FLAGS table.
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
import urllib.request

import aiohttp
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
BLOCK = 2880
SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
# The release is a setting: add new collections here when IRSA publishes them (e.g. DR2).
COLLECTIONS = ["spherex_dr1", "spherex_qr3"]

# Pixel flag policies, by DR1 flag name (bit numbers come from each file's MSKN keywords).
# OUTLIER, SOURCE and FULLSAMPLE are never masked: OUTLIER fires on real moving objects.
STRICT = ["TRANSIENT", "OVERFLOW", "SUR_ERROR", "NONFUNC", "DICHROIC", "MISSING_DATA", "HOT", "COLD",
          "PHANMISS", "NONLINEAR", "PERSIST", "CROSSTALK", "GHOST", "GHOST_FPA", "GHOST_EXT",
          "STREAK", "BLOOM", "SNOWBALL", "HALO"]
DISPLAY = ["NONFUNC", "MISSING_DATA", "HOT", "COLD", "PERSIST", "CROSSTALK", "STREAK"]
SATURATION = ["OVERFLOW", "SUR_ERROR", "BLOOM", "NONLINEAR"]


def sia(collection: str, ra: float, dec: float, timeout: float = 180) -> list[dict]:
    """All Level 2 images in one collection whose footprint contains (ra, dec)."""
    q = urllib.parse.urlencode({"COLLECTION": collection, "POS": f"CIRCLE {ra} {dec} 0.0001",
                                "RESPONSEFORMAT": "VOTABLE"})
    x = urllib.request.urlopen(f"{SIA_URL}?{q}", timeout=timeout).read().decode()
    names = re.findall(r'<FIELD[^>]*name="([^"]+)"', x)
    out = []
    for tr in re.findall(r"<TR>(.*?)</TR>", x, re.S):
        r = dict(zip(names, re.findall(r"<TD>(.*?)</TD>", tr, re.S)))
        if r.get("dataproduct_type", "image") != "image":
            continue
        key = json.loads(r["cloud_access"].replace("&quot;", '"'))["aws"]["key"]
        out.append(dict(
            obs_id=r["obs_id"],
            det=int(r["energy_bandpassname"][-1]),
            t=float(r["t_min"]),
            lam_min=float(r["em_min"]) * 1e6,
            lam_max=float(r["em_max"]) * 1e6,
            url=BUCKET + key,
            release=collection.replace("spherex_", ""),
        ))
    return out


def search(ra: float, dec: float, collections=COLLECTIONS) -> list[dict]:
    rows = []
    for c in collections:
        rows += sia(c, ra, dec)
    # The same exposure can appear in a deep collection too; keep one copy per obs_id+detector.
    seen, uniq = set(), []
    for r in sorted(rows, key=lambda r: r["t"]):
        k = (r["obs_id"], r["det"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    return uniq


def group_passes(rows: list[dict], gap_days: float = 60.0) -> int:
    """Label each exposure with a survey pass: a new pass starts after a gap of more than gap_days."""
    rows.sort(key=lambda r: r["t"])
    p, last = 0, None
    for r in rows:
        if last is not None and r["t"] - last > gap_days:
            p += 1
        r["pass"], last = p, r["t"]
    return p + 1 if rows else 0


def data_bytes(h: fits.Header) -> int:
    n = abs(h["BITPIX"]) // 8
    naxis = h.get("NAXIS", 0)
    if naxis == 0:
        return 0
    for k in range(1, naxis + 1):
        n *= h[f"NAXIS{k}"]
    n += h.get("PCOUNT", 0)
    return -(-n // BLOCK) * BLOCK


class RangeReader:
    def __init__(self, session: aiohttp.ClientSession):
        self.s, self.nreq, self.nbytes = session, 0, 0

    async def get(self, url: str, a: int, b: int) -> bytes:
        """Inclusive byte range, with retries."""
        err = None
        for attempt in range(5):
            try:
                async with self.s.get(url, headers={"Range": f"bytes={a}-{b}"}) as r:
                    if r.status not in (200, 206):
                        raise RuntimeError(f"HTTP {r.status}")
                    d = await r.read()
                    self.nreq += 1
                    self.nbytes += len(d)
                    return d
            except Exception as ex:  # noqa: BLE001 - network errors are retried
                err = ex
                await asyncio.sleep(1 + 2 * attempt)
        raise RuntimeError(f"range failed {url} {a}-{b}: {err!r}")

    async def header(self, url: str, off: int, guess: int = 4) -> tuple[fits.Header, int]:
        buf = b""
        while True:
            chunk = await self.get(url, off + len(buf), off + len(buf) + guess * BLOCK - 1)
            if not chunk:
                raise EOFError(url)
            buf += chunk
            for i in range(0, len(buf), 80):
                if buf[i:i + 8] == b"END     ":
                    hlen = (i // BLOCK + 1) * BLOCK
                    return fits.Header.fromstring(buf[:hlen].decode("ascii")), hlen
            guess *= 2


def _decode_flags(fh: fits.Header, desc: np.ndarray, heap: np.ndarray, heap0: int, nx: int) -> np.ndarray:
    from astropy.io.fits.hdu.compressed._codecs import Rice1  # astropy >= 6

    ci = [fh[f"TTYPE{k}"] for k in range(1, fh["TFIELDS"] + 1)].index("COMPRESSED_DATA")
    sizes = {"J": 4, "K": 8, "E": 4, "D": 8, "B": 1, "I": 2, "L": 1, "A": 1}

    def width(form: str) -> int:
        if "P" in form:
            return 8
        if "Q" in form:
            return 16
        m = re.match(r"(\d*)([A-Z])", form)
        return int(m.group(1) or 1) * sizes[m.group(2)]

    off_b = sum(width(fh[f"TFORM{k}"]) for k in range(1, ci + 1))
    form = fh[f"TFORM{ci + 1}"]
    dt, nb = (">i4", 8) if "P" in form else (">i8", 16)
    pairs = desc[:, off_b:off_b + nb].copy().view(dt).astype(np.int64)
    cnt, hof = pairs[:, 0], pairs[:, 1]
    zv = {fh.get(f"ZNAME{k}"): fh.get(f"ZVAL{k}") for k in range(1, 6)}
    codec = Rice1(blocksize=zv.get("BLOCKSIZE", 32), bytepix=zv.get("BYTEPIX", 4), tilesize=nx)
    rows = [np.asarray(codec.decode(heap[o - heap0:o - heap0 + c])).view(np.int32).reshape(-1)[:nx]
            for o, c in zip(hof, cnt)]
    return np.stack(rows)


async def read_box(rd: RangeReader, row: dict, ra: float, dec: float, half: int) -> dict | None:
    """Read IMAGE and FLAGS for a (2*half)^2 pixel box centred on (ra, dec). None if off the detector."""
    url = row["url"]
    h0, l0 = await rd.header(url, 0, guess=2)
    hi, li = await rd.header(url, l0, guess=30)
    img_off = l0 + li
    w = WCS(hi)
    x, y = (float(v) for v in w.world_to_pixel_values(ra, dec))
    nx, ny = hi["NAXIS1"], hi["NAXIS2"]
    xc, yc = int(round(x)), int(round(y))
    if not (0 <= xc < nx and 0 <= yc < ny):
        return None
    y0, y1 = max(0, yc - half), min(ny, yc + half)
    x0, x1 = max(0, xc - half), min(nx, xc + half)
    flags_off = img_off + data_bytes(hi)
    raw, (fh, lf) = await asyncio.gather(
        rd.get(url, img_off + y0 * nx * 4, img_off + y1 * nx * 4 - 1),
        rd.header(url, flags_off, guess=4),
    )
    img = np.frombuffer(raw, ">f4").reshape(y1 - y0, nx)[:, x0:x1].astype(np.float32)

    fdata = flags_off + lf
    rowlen = fh["NAXIS1"]
    theap = fh.get("THEAP", rowlen * fh["NAXIS2"])
    desc = np.frombuffer(await rd.get(url, fdata + y0 * rowlen, fdata + y1 * rowlen - 1), np.uint8)
    desc = desc.reshape(-1, rowlen)
    # Heap offsets for the rows we need, then one range for that heap span.
    ci = [fh[f"TTYPE{k}"] for k in range(1, fh["TFIELDS"] + 1)].index("COMPRESSED_DATA")
    form = fh[f"TFORM{ci + 1}"]
    dt, nb = (">i4", 8) if "P" in form else (">i8", 16)
    # (offset of the descriptor inside the row is computed in _decode_flags; here we only need the span)
    off_b = 0
    for k in range(1, ci + 1):
        f = fh[f"TFORM{k}"]
        off_b += 8 if "P" in f else 16 if "Q" in f else int(re.match(r"(\d*)", f).group(1) or 1) * {
            "J": 4, "K": 8, "E": 4, "D": 8, "B": 1, "I": 2, "L": 1, "A": 1}[re.sub(r"\d", "", f)[0]]
    pairs = desc[:, off_b:off_b + nb].copy().view(dt).astype(np.int64)
    cnt, hof = pairs[:, 0], pairs[:, 1]
    h_a, h_b = int(hof.min()), int((hof + cnt).max())
    heap = np.frombuffer(await rd.get(url, fdata + theap + h_a, fdata + theap + h_b - 1), np.uint8)
    fl = _decode_flags(fh, desc, heap, h_a, nx)[:, x0:x1]
    bits = {fh[k]: int(k[4:]) for k in fh if k.startswith("MSKN")}
    if not bits:  # older releases name bits with MP_ keywords
        bits = {k[3:]: int(fh[k]) for k in fh if k.startswith("MP_")}
    return dict(row, img=img, fl=fl, bits=bits, x0=x0, y0=y0, wcs=w, xt=x, yt=y,
                mjd=float(hi.get("MJD-AVG", row["t"])), bunit=hi.get("BUNIT", ""), hdr=hi)


async def read_wave(rd: RangeReader, url: str) -> dict:
    """The WCS-WAVE lookup table (the file's last extension, a few kB): wavelength and bandwidth
    in µm on a coarse X/Y pixel grid. Read with one suffix range."""
    tail = b""
    for n in (4, 8, 16):
        async with rd.s.get(url, headers={"Range": f"bytes=-{n * BLOCK}"}) as r:
            tail = await r.read()
            rd.nreq += 1
            rd.nbytes += len(tail)
        for i in range(0, len(tail), BLOCK):
            if tail[i:i + 8] == b"XTENSION" and b"WCS-WAVE" in tail[i:i + 2 * BLOCK]:
                # header ends at the END card
                for j in range(i, len(tail), 80):
                    if tail[j:j + 8] == b"END     ":
                        hend = (j // BLOCK + 1) * BLOCK
                        h = fits.Header.fromstring(tail[i:hend].decode("ascii"))
                        row = tail[hend:hend + h["NAXIS1"]]
                        dims = [int(v) for v in re.findall(r"\d+", h["TDIM3"])]  # (2, nx, ny)
                        nxg = int(re.findall(r"\d+", h["TDIM1"])[0])
                        nyg = int(re.findall(r"\d+", h["TDIM2"])[0])
                        xs = np.frombuffer(row[0:4 * nxg], ">i4").astype(float)
                        ys = np.frombuffer(row[4 * nxg:4 * (nxg + nyg)], ">i4").astype(float)
                        vals = np.frombuffer(row[4 * (nxg + nyg):4 * (nxg + nyg) + 4 * dims[0] * dims[1] * dims[2]], ">f4")
                        vals = vals.reshape(dims[2], dims[1], dims[0])  # [y, x, (wave, bandwidth)]
                        return dict(x=xs, y=ys, vals=vals.astype(float))
    raise RuntimeError(f"no WCS-WAVE in {url}")


def wave_at(tab: dict, x: float, y: float) -> tuple[float, float]:
    """Bilinear interpolation of (wavelength, bandwidth) in µm at 0-based pixel (x, y).
    The table's X/Y are FITS 1-based pixel coordinates."""
    from scipy.interpolate import RegularGridInterpolator

    out = []
    for k in range(tab["vals"].shape[2]):
        f = RegularGridInterpolator((tab["y"], tab["x"]), tab["vals"][:, :, k], bounds_error=False, fill_value=None)
        out.append(float(f([[y + 1, x + 1]])[0]))
    return out[0], out[1]


def mask_of(e: dict, names: list[str]) -> np.ndarray:
    m = 0
    for n in names:
        if n in e["bits"]:
            m |= 1 << e["bits"][n]
    return (e["fl"] & m) != 0
