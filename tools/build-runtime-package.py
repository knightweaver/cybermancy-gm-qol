#!/usr/bin/env python3
"""Build a deterministic Cybermancy GM QOL Foundry runtime-candidate ZIP."""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

FIXED_DT = (1980, 1, 1, 0, 0, 0)
RUNTIME_FILES = (
    "module.json",
    "README.md",
    "scripts/main.js",
    "scripts/bundle.js",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    args = parser.parse_args()
    repo = args.repo.resolve()

    manifest_path = repo / "module.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if manifest.get("type") != "module":
        raise ValueError("module.json type must be module")
    if manifest.get("id") != "cybermancy-gm-qol":
        raise ValueError("module.json id must be cybermancy-gm-qol")

    version = str(manifest.get("version") or "")
    if not version:
        raise ValueError("module.json version is required")

    rel_map: dict[str, Path] = {}
    for rel in RUNTIME_FILES:
        candidate = repo / rel
        if not candidate.is_file():
            raise ValueError(f"Required runtime file missing: {rel}")
        rel_map[rel] = candidate

    for rel in manifest.get("esmodules", []):
        if rel not in rel_map:
            raise ValueError(
                f"Declared esmodule is not included in the runtime package: {rel}"
            )

    release_dir = repo / "release"
    release_dir.mkdir(parents=True, exist_ok=True)
    archive = release_dir / f"cybermancy-gm-qol-v{version}.zip"

    with zipfile.ZipFile(
        archive,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as zf:
        for rel in sorted(rel_map):
            file_path = rel_map[rel]
            info = zipfile.ZipInfo(rel, FIXED_DT)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zf.writestr(info, file_path.read_bytes())

    digest = sha256(archive)
    report_dir = repo / "build" / "release"
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "PASS",
        "moduleId": "cybermancy-gm-qol",
        "moduleVersion": version,
        "archive": archive.name,
        "archiveSha256": digest,
        "runtimeFileCount": len(rel_map),
        "runtimeFiles": sorted(rel_map),
        "canonical": False,
        "purpose": "clean-install Foundry runtime qualification candidate",
    }
    (report_dir / "runtime-package.json").write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
