"""Evaluation-set manifests: one run directory holds exactly one evaluation set.

A run directory (e.g. runs/yardstick/D-5/v6/real) carries `_set.json`: {"set": name, "visits": [...]}.
Scorers read visit files only through `visit_files`, which refuses a directory without a manifest,
a directory holding visit files the manifest does not list (two sets mixed by a glob), and missing
files (an incomplete run). On 26 Oct 2026 a glob pooled D-5 quarters 1-3 into the quarter-0 null;
this makes that impossible to repeat silently (prereg/METHOD_V6.md).
"""

from __future__ import annotations

import json
from pathlib import Path

MANIFEST = "_set.json"


def write_manifest(directory: Path, name: str, visits: list[str]) -> None:
    directory = Path(directory)
    path = directory / MANIFEST
    want = {"set": name, "visits": sorted(set(visits))}
    if path.exists():
        have = json.loads(path.read_text())
        if have["set"] != name or have["visits"] != want["visits"]:
            raise ValueError(f"{directory} already holds set {have['set']!r} ({len(have['visits'])} visits); "
                             f"refusing to write set {name!r} ({len(want['visits'])} visits) into it")
        return
    directory.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(want, indent=1))


def visit_files_with_gaps(directory: Path, expect: str) -> tuple[list[Path], list[str]]:
    """Like visit_files, but a set with missing visit files (targets that failed) is returned with the
    missing visit ids listed, for scorers whose rules exclude such visits explicitly (T6). A wrong set
    name or files outside the set are still refused."""
    directory = Path(directory)
    path = directory / MANIFEST
    if not path.exists():
        raise FileNotFoundError(f"{directory} has no {MANIFEST}: refusing to score an unlabelled directory")
    man = json.loads(path.read_text())
    if man["set"] != expect:
        raise ValueError(f"{directory} holds set {man['set']!r}, not {expect!r}")
    listed = set(man["visits"])
    present = {p.stem for p in directory.glob("*.json") if p.name != MANIFEST}
    extra = sorted(present - listed)
    if extra:
        raise ValueError(f"{directory}: {len(extra)} visit files not in set {man['set']!r} (e.g. {extra[:3]})")
    return [directory / f"{v}.json" for v in sorted(listed & present)], sorted(listed - present)


def visit_files(directory: Path, expect: str | None = None) -> list[Path]:
    """The visit files of the one set in `directory`, in visit order. `expect`: the set name the
    caller means to score; a different manifest name is refused."""
    directory = Path(directory)
    path = directory / MANIFEST
    if not path.exists():
        raise FileNotFoundError(f"{directory} has no {MANIFEST}: refusing to score an unlabelled directory")
    man = json.loads(path.read_text())
    if expect is not None and man["set"] != expect:
        raise ValueError(f"{directory} holds set {man['set']!r}, not {expect!r}")
    listed = set(man["visits"])
    present = {p.stem for p in directory.glob("*.json") if p.name != MANIFEST}
    extra, missing = sorted(present - listed), sorted(listed - present)
    if extra:
        raise ValueError(f"{directory}: {len(extra)} visit files not in set {man['set']!r} (e.g. {extra[:3]})")
    if missing:
        raise ValueError(f"{directory}: set {man['set']!r} is incomplete, {len(missing)} visits missing (e.g. {missing[:3]})")
    return [directory / f"{v}.json" for v in sorted(listed)]
