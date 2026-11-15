"""Provenance: environment stamps, checksums and atomic writes.

Every output the pipeline writes can be traced to its inputs, code and environment.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any

_TRACKED = ("numpy", "scipy", "astropy", "photutils", "pyvo", "httpx", "pyarrow", "kete")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write to a temp file in the same directory, fsync, then rename over the target."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def atomic_write_json(path: Path, obj: Any) -> None:
    atomic_write_bytes(Path(path), json.dumps(obj, indent=2, sort_keys=True, default=str).encode())


def _git(*args: str) -> str | None:
    try:
        root = Path(__file__).resolve().parents[2]
        out = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=10)
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def environment_stamp() -> dict[str, Any]:
    versions = {}
    for name in _TRACKED:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    lock = Path(__file__).resolve().parents[2] / "uv.lock"
    try:
        import numpy as np

        blas = np.show_config(mode="dicts")["Build Dependencies"]["blas"].get("name")
    except Exception:  # noqa: BLE001 - provenance must never break a run
        blas = None
    return {
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "packages": versions,
        "blas": blas,
        "uv_lock_sha256": sha256_file(lock) if lock.exists() else None,
        "git_commit": _git("rev-parse", "HEAD"),
        "git_dirty": bool(_git("status", "--porcelain")) if _git("rev-parse", "HEAD") else None,
        "threads": {k: os.environ.get(k) for k in
                    ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS")},
    }
