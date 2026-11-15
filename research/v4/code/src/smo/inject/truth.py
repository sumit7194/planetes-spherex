"""Sealed injection truth (prereg/YARDSTICK.md §4, PREREG §5).

Truth tables are written once by the injection step, under `cache/truth/`, and fingerprinted with
SHA-256. Only the scoring step (`smo.score`) reads them, and it checks the fingerprint first.
Method code (`smo.detect`) must never import this module; a unit test enforces that.
"""

from __future__ import annotations

import json
from pathlib import Path

from smo.provenance import atomic_write_bytes, sha256_bytes


def truth_path(cache: Path, patch: str, pass_no: int, visit: str) -> Path:
    return cache / "truth" / patch / f"pass{pass_no}" / f"{visit}.json"


def seal(path: Path, record: dict) -> str:
    data = json.dumps(record, sort_keys=True, indent=1).encode()
    atomic_write_bytes(path, data)
    return sha256_bytes(data)


def unseal(path: Path, sha256: str) -> dict:
    data = path.read_bytes()
    got = sha256_bytes(data)
    if got != sha256:
        raise ValueError(f"truth file {path} fingerprint {got} does not match sealed {sha256}")
    return json.loads(data)
