"""Anonymous access to the public SPHEREx Quick Release bucket on AWS Open Data.

No credentials are used or needed (see SECURITY.md).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import cached_property

import httpx

BUCKET_URL = "https://nasa-irsa-spherex.s3.amazonaws.com"
_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
# level2_2025W30_1B_0001_1D1_spx_l2b-v20-2025-262.fits
_KEY_RE = re.compile(
    r"level2_(?P<period>\d{4}W\d{2}_\d[A-Z])_(?P<obs>\d{4})_(?P<exp>\d)D(?P<det>\d)_spx_(?P<proc>[^/]+)\.fits$"
)


@dataclass(frozen=True)
class L2Key:
    key: str
    size: int | None = None

    @cached_property
    def _m(self) -> re.Match:
        m = _KEY_RE.search(self.key)
        if m is None:
            raise ValueError(f"not a SPHEREx L2 key: {self.key}")
        return m

    @property
    def period(self) -> str:
        return self._m["period"]

    @property
    def obs(self) -> int:
        return int(self._m["obs"])

    @property
    def exposure(self) -> int:
        """Exposure number within the observation (1-4)."""
        return int(self._m["exp"])

    @property
    def detector(self) -> int:
        return int(self._m["det"])

    @property
    def obsid(self) -> str:
        return f"{self.period}_{self._m['obs']}_{self.exposure}"

    @property
    def url(self) -> str:
        return f"{BUCKET_URL}/{self.key}"


def list_prefixes(client: httpx.Client, prefix: str) -> list[str]:
    """Immediate sub-prefixes ("folders") under a prefix."""
    out: list[str] = []
    token = None
    while True:
        params = {"list-type": "2", "prefix": prefix, "delimiter": "/"}
        if token:
            params["continuation-token"] = token
        root = ET.fromstring(client.get(BUCKET_URL + "/", params=params).raise_for_status().content)
        out += [e.text for e in root.findall("s3:CommonPrefixes/s3:Prefix", _NS)]
        if root.findtext("s3:IsTruncated", namespaces=_NS) != "true":
            return out
        token = root.findtext("s3:NextContinuationToken", namespaces=_NS)


def list_keys(client: httpx.Client, prefix: str) -> list[L2Key]:
    """All L2 spectral-image keys under a prefix, with sizes, following pagination."""
    out: list[L2Key] = []
    token = None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if token:
            params["continuation-token"] = token
        root = ET.fromstring(client.get(BUCKET_URL + "/", params=params).raise_for_status().content)
        for c in root.findall("s3:Contents", _NS):
            k = c.findtext("s3:Key", namespaces=_NS)
            if k and _KEY_RE.search(k):
                out.append(L2Key(k, int(c.findtext("s3:Size", namespaces=_NS))))
        if root.findtext("s3:IsTruncated", namespaces=_NS) != "true":
            return out
        token = root.findtext("s3:NextContinuationToken", namespaces=_NS)


def period_processing_prefix(client: httpx.Client, period: str, release: str = "qr2") -> str:
    """The single processing-version folder inside a planning period, e.g. .../l2b-v20-2025-262/."""
    subs = list_prefixes(client, f"{release}/level2/{period}/")
    if len(subs) != 1:
        raise RuntimeError(f"expected one processing folder in {period}, found {subs}")
    return subs[0]
