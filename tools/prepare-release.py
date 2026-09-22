#!/usr/bin/env python3
"""Validate and stage an exact manually qualified Cybermancy GM QOL release."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def daggerheart_minor(version: str) -> tuple[int, int] | None:
    parts = version.split(".")
    if len(parts) < 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--control", type=Path, required=True)
    args = parser.parse_args()

    repo = args.repo.resolve()
    control_path = (
        (repo / args.control).resolve()
        if not args.control.is_absolute()
        else args.control.resolve()
    )

    control = json.loads(control_path.read_text(encoding="utf-8"))
    module = json.loads((repo / "module.json").read_text(encoding="utf-8"))
    runtime = json.loads(
        (repo / "build" / "release" / "runtime-package.json").read_text(
            encoding="utf-8"
        )
    )
    equivalence = json.loads(
        (repo / "build" / "release" / "runtime-equivalence.json").read_text(
            encoding="utf-8"
        )
    )

    version = str(control.get("version") or "")
    tag = str(control.get("tag") or "")

    if control.get("publish") is not True:
        raise ValueError("release control must explicitly set publish=true")
    if version != module.get("version"):
        raise ValueError(
            f"release version {version} != module version {module.get('version')}"
        )
    if tag != f"v{version}":
        raise ValueError(f"release tag must be v{version}, got {tag}")

    qualification = control.get("qualification") or {}
    if qualification.get("status") != "PASS":
        raise ValueError("manual clean-install qualification PASS is required")

    target = control.get("runtime") or {}
    if str(target.get("foundryCore")) != "13":
        raise ValueError("release-control Foundry target must be major version 13")
    if str(target.get("system")) != "daggerheart":
        raise ValueError("release-control system must be daggerheart")

    tested_versions = [str(v) for v in target.get("systemVersions", [])]
    tested_minors = {daggerheart_minor(v) for v in tested_versions}
    if (1, 2) not in tested_minors or (1, 9) not in tested_minors:
        raise ValueError(
            "clean-install qualification must include Daggerheart 1.2.x and 1.9.x"
        )
    for parsed in tested_minors:
        if parsed is None or parsed[0] != 1 or not 2 <= parsed[1] <= 9:
            raise ValueError(
                "all qualified Daggerheart versions must fall within 1.2 through 1.9"
            )

    expected_hash = str(control.get("qualifiedRuntimeSha256") or "")
    if len(expected_hash) != 64:
        raise ValueError("qualifiedRuntimeSha256 must be a SHA-256 digest")
    if not control.get("qualifiedWorkflowRunId"):
        raise ValueError("qualifiedWorkflowRunId is required")
    if not control.get("qualifiedArtifactName"):
        raise ValueError("qualifiedArtifactName is required")

    if runtime.get("status") != "PASS":
        raise ValueError("fresh runtime rebuild is not PASS")
    if equivalence.get("status") != "PASS":
        raise ValueError("fresh rebuild did not pass runtime equivalence validation")
    if equivalence.get("archiveByteIdentical") is not True:
        raise ValueError("fresh rebuild is not byte-identical to qualified runtime")
    if equivalence.get("qualifiedSha256") != expected_hash:
        raise ValueError(
            "downloaded qualified artifact hash differs from release control"
        )

    archive_name = f"cybermancy-gm-qol-v{version}.zip"
    archive = repo / "release" / archive_name
    if not archive.is_file():
        raise ValueError(f"qualified runtime archive missing: {archive}")

    actual_hash = sha256(archive)
    if actual_hash != expected_hash:
        raise ValueError(
            "published archive must be exact qualified candidate: "
            f"expected {expected_hash}, got {actual_hash}"
        )

    expected_manifest = (
        "https://github.com/knightweaver/cybermancy-gm-qol/"
        "releases/latest/download/module.json"
    )
    expected_download = (
        "https://github.com/knightweaver/cybermancy-gm-qol/"
        f"releases/download/{tag}/{archive_name}"
    )

    if module.get("manifest") != expected_manifest:
        raise ValueError(
            f"module.json manifest URL mismatch: {module.get('manifest')}"
        )
    if module.get("download") != expected_download:
        raise ValueError(
            f"module.json download URL mismatch: {module.get('download')}"
        )

    foundry = module.get("compatibility") or {}
    if foundry != {"minimum": "13", "verified": "13", "maximum": "13"}:
        raise ValueError("module Foundry compatibility must be exactly 13/13/13")

    systems = module.get("relationships", {}).get("systems", [])
    daggerheart = next(
        (entry for entry in systems if entry.get("id") == "daggerheart"),
        None,
    )
    expected_dh = {"minimum": "1.2", "verified": "1.9", "maximum": "1.9"}
    if not daggerheart or daggerheart.get("compatibility") != expected_dh:
        raise ValueError(
            "module Daggerheart compatibility must be exactly 1.2/1.9/1.9"
        )

    release_dir = repo / "release"
    release_module = release_dir / "module.json"
    shutil.copy2(repo / "module.json", release_module)

    checksums = {
        archive_name: sha256(archive),
        "module.json": sha256(release_module),
    }
    (release_dir / "SHA256SUMS.txt").write_text(
        "".join(
            f"{digest}  {name}\n"
            for name, digest in sorted(checksums.items())
        ),
        encoding="utf-8",
    )

    summary = {
        "status": "READY_TO_PUBLISH",
        "version": version,
        "tag": tag,
        "qualifiedRuntimeSha256": expected_hash,
        "publishedArchiveIsExactQualifiedRuntime": True,
        "freshRebuildByteIdentical": True,
        "releaseAssets": [
            archive_name,
            "module.json",
            "SHA256SUMS.txt",
        ],
        "foundryCompatibility": "13",
        "daggerheartCompatibility": "1.2-1.9",
        "qualifiedDaggerheartVersions": tested_versions,
        "manifestUrl": expected_manifest,
        "downloadUrl": expected_download,
    }

    report = repo / "build" / "release" / "prepublish.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
