"""Read parts of remote, uncompressed FITS files with HTTP range requests.

SPHEREx L2 files are plain FITS of fixed size, so a cutout needs only the rows it covers,
and the whole 70 MB file never has to be downloaded. The HDU layout is discovered by walking
headers, never assumed, and is checked against the expected extension names.
"""

from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import httpx
import numpy as np
from astropy.io import fits

BLOCK = 2880
_END = b"END" + b" " * 77


@dataclass(frozen=True)
class HDUInfo:
    index: int
    name: str | None
    header: fits.Header
    header_start: int
    data_start: int
    data_size: int

    @property
    def shape(self) -> tuple[int, ...]:
        """numpy order (slowest axis first)."""
        n = self.header.get("NAXIS", 0)
        return tuple(self.header[f"NAXIS{k}"] for k in range(n, 0, -1))

    @property
    def dtype(self) -> np.dtype:
        return {8: np.dtype(">u1"), 16: np.dtype(">i2"), 32: np.dtype(">i4"),
                -32: np.dtype(">f4"), -64: np.dtype(">f8")}[self.header["BITPIX"]]


class RangeReader:
    """Byte-range reads with retries. One instance per remote file."""

    def __init__(self, client: httpx.Client, url: str, retries: int = 5,
                 parallel: int = 8, chunk: int = 2 << 20):
        self.client, self.url, self.retries = client, url, retries
        self.parallel, self.chunk = parallel, chunk
        self._lock = threading.Lock()
        self.bytes_read = 0
        self.requests = 0
        self._size: int | None = None

    def read(self, start: int, stop: int) -> bytes:
        """Bytes [start, stop). Large reads are split into chunks fetched concurrently and
        reassembled in order, which returns exactly the same bytes as one request."""
        if stop - start > 2 * self.chunk:
            edges = list(range(start, stop, self.chunk)) + [stop]
            with ThreadPoolExecutor(max_workers=self.parallel) as pool:
                parts = list(pool.map(lambda ab: self._read_one(*ab), zip(edges[:-1], edges[1:], strict=True)))
            return b"".join(parts)
        return self._read_one(start, stop)

    def _read_one(self, start: int, stop: int) -> bytes:
        if stop <= start:
            return b""
        delay = 1.0
        for attempt in range(self.retries):
            try:
                r = self.client.get(self.url, headers={"Range": f"bytes={start}-{stop - 1}"})
                if r.status_code == 206 and len(r.content) == stop - start:
                    with self._lock:
                        self.bytes_read += len(r.content)
                        self.requests += 1
                    return r.content
                raise httpx.HTTPError(f"status {r.status_code}, got {len(r.content)} bytes")
            except httpx.HTTPError:
                if attempt == self.retries - 1:
                    raise
                time.sleep(delay)
                delay *= 2
        raise AssertionError("unreachable")

    def size(self) -> int:
        if self._size is None:
            delay = 1.0
            for attempt in range(self.retries):
                try:
                    self._size = int(self.client.head(self.url).raise_for_status().headers["content-length"])
                    break
                except httpx.HTTPError:
                    if attempt == self.retries - 1:
                        raise
                    time.sleep(delay)
                    delay *= 2
        return self._size


def _read_header(rr: RangeReader, start: int) -> tuple[fits.Header, int]:
    buf = b""
    total = rr.size()
    while True:
        if start + len(buf) >= total:
            raise ValueError(f"no END card found in header starting at byte {start}")
        buf += rr.read(start + len(buf), min(total, start + len(buf) + 4 * BLOCK))
        for k in range(0, len(buf) - 79, 80):
            if buf[k:k + 80] == _END:
                hlen = math.ceil((k + 80) / BLOCK) * BLOCK
                return fits.Header.fromstring(buf[:hlen].decode("ascii")), hlen


def walk_hdus(rr: RangeReader, expected: tuple[str | None, ...] | None = None) -> list[HDUInfo]:
    total = rr.size()
    pos, i, out = 0, 0, []
    while pos < total:
        h, hlen = _read_header(rr, pos)
        naxis = h.get("NAXIS", 0)
        n = math.prod(h[f"NAXIS{k}"] for k in range(1, naxis + 1)) if naxis else 0
        dsize = (n * abs(h.get("BITPIX", 8)) // 8 + h.get("PCOUNT", 0)) * h.get("GCOUNT", 1) if naxis else 0
        out.append(HDUInfo(i, h.get("EXTNAME"), h, pos, pos + hlen, dsize))
        pos += hlen + math.ceil(dsize / BLOCK) * BLOCK
        i += 1
    if pos != total:
        raise ValueError(f"HDU walk ended at {pos}, file size {total}")
    if expected is not None:
        names = tuple(x.name for x in out)
        if names != expected:
            raise ValueError(f"unexpected HDU layout {names}, expected {expected}")
    return out


def read_rows(rr: RangeReader, hdu: HDUInfo, y0: int, y1: int) -> np.ndarray:
    """Rows y0..y1-1 (numpy order, full width) of a 2-D image HDU, as native-endian array."""
    ny, nx = hdu.shape
    if not (0 <= y0 < y1 <= ny):
        raise ValueError(f"rows {y0}:{y1} outside 0:{ny}")
    item = hdu.dtype.itemsize
    raw = rr.read(hdu.data_start + y0 * nx * item, hdu.data_start + y1 * nx * item)
    return np.frombuffer(raw, dtype=hdu.dtype).reshape(y1 - y0, nx).astype(hdu.dtype.newbyteorder("="))


def read_planes(rr: RangeReader, hdu: HDUInfo, planes: list[int]) -> dict[int, np.ndarray]:
    """Selected planes of a 3-D cube HDU, fetched as contiguous runs."""
    nz, ny, nx = hdu.shape
    item = hdu.dtype.itemsize
    plane_bytes = ny * nx * item
    out: dict[int, np.ndarray] = {}
    ps = sorted(set(planes))
    runs, run = [], [ps[0]]
    for p in ps[1:]:
        if p == run[-1] + 1:
            run.append(p)
        else:
            runs.append(run)
            run = [p]
    runs.append(run)
    for run in runs:
        raw = rr.read(hdu.data_start + run[0] * plane_bytes, hdu.data_start + (run[-1] + 1) * plane_bytes)
        arr = np.frombuffer(raw, dtype=hdu.dtype).reshape(len(run), ny, nx).astype(hdu.dtype.newbyteorder("="))
        for j, p in enumerate(run):
            if not 0 <= p < nz:
                raise ValueError(f"plane {p} outside 0:{nz}")
            out[p] = arr[j]
    return out


def read_table(rr: RangeReader, hdu: HDUInfo) -> fits.BinTableHDU:
    """A binary-table HDU, read whole."""
    return _bintable(hdu, rr.read(hdu.data_start, hdu.data_start + hdu.data_size))


def _bintable(hdu: HDUInfo, raw: bytes) -> fits.BinTableHDU:
    pad = raw + b"\0" * (math.ceil(len(raw) / BLOCK) * BLOCK - len(raw))
    return fits.BinTableHDU.fromstring(hdu.header.tostring().encode() + pad)
