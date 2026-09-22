#!/usr/bin/env python3
"""Compare a rebuilt Cybermancy GM QOL runtime package to a qualified candidate."""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--qualified", type=Path, required=True)
    parser.add_argument("--rebuilt", type=Path, required=True)
    args = parser.parse_args()

    repo = args.repo.resolve()
    qualified = args.qualified.resolve()
    rebuilt = args.rebuilt.resolve()

    with zipfile.ZipFile(qualified) as qz, zipfile.ZipFile(rebuilt) as rz:
        qnames = qz.namelist()
        rnames = rz.namelist()

        if qnames != rnames:
            qset, rset = set(qnames), set(rnames)
            raise ValueError(
                "Runtime ZIP member lists differ; "
                f"missing={sorted(qset-rset)} extra={sorted(rset-qset)}"
            )

        differences = []
        for name in qnames:
            qbytes = qz.read(name)
            rbytes = rz.read(name)
            if qbytes != rbytes:
                differences.append(
                    {
                        "path": name,
                        "qualifiedSha256": hashlib.sha256(qbytes).hexdigest(),
                        "rebuiltSha256": hashlib.sha256(rbytes).hexdigest(),
                        "qualifiedSize": len(qbytes),
                        "rebuiltSize": len(rbytes),
                    }
                )

    if differences:
        raise ValueError(
            "Rebuilt runtime differs from qualified runtime: "
            + ", ".join(record["path"] for record in differences)
        )

    qualified_hash = sha256(qualified)
    rebuilt_hash = sha256(rebuilt)
    if qualified_hash != rebuilt_hash:
        raise ValueError(
            "Deterministic runtime archives must be byte-identical: "
            f"qualified={qualified_hash} rebuilt={rebuilt_hash}"
        )

    report = {
        "status": "PASS",
        "qualifiedSha256": qualified_hash,
        "rebuiltSha256": rebuilt_hash,
        "zipMemberCount": len(qnames),
        "byteIdenticalMemberCount": len(qnames),
        "forbiddenDifferenceCount": 0,
        "archiveByteIdentical": True,
        "releasePolicy": {
            "publishExactQualifiedArchive": True,
            "freshRebuildMustBeByteIdentical": True,
        },
    }

    out = repo / "build" / "release" / "runtime-equivalence.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
