import hashlib
import json
from pathlib import Path


EVIDENCE = Path(__file__).resolve().parent
RUNS = EVIDENCE / "runs"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compact_cargo(cargo: dict) -> dict:
    return {
        "parseErrors": cargo["parseErrors"],
        "rebuiltPackageCount": cargo["rebuiltPackageCount"],
        "rebuiltWorkspacePackageCount": len(cargo["rebuiltWorkspacePackages"]),
        "rebuiltTargetCount": cargo["rebuiltTargetCount"],
        "rebuiltExecutables": cargo["rebuiltExecutables"],
        "buildFinished": cargo["buildFinished"],
    }


def compact_target(target: dict) -> dict:
    result = {}
    for name in ("target", "profile", "incremental", "deps", "build", "fingerprint"):
        before = target["before"][name]
        after = target["after"][name]
        result[name] = {
            "path": after["path"],
            "beforeBytes": before["bytes"],
            "afterBytes": after["bytes"],
            "deltaBytes": after["bytes"] - before["bytes"],
            "beforeFiles": before["files"],
            "afterFiles": after["files"],
            "deltaFiles": after["files"] - before["files"],
        }
    return result


def compact_smoke(smoke: dict | None) -> dict | None:
    if smoke is None:
        return None
    return {
        "resultPath": smoke["resultPath"],
        "resultSha256": smoke["resultSha256"],
        "binaries": smoke["binaries"],
        "runs": [
            {
                "name": run["name"],
                "startedAt": run["startedAt"],
                "wallSeconds": run["wallSeconds"],
                "exitCode": run["exitCode"],
                "timeoutSeconds": run["timeoutSeconds"],
                "timedOut": run["timedOut"],
                "treeTerminationVerified": run["treeTerminationVerified"],
                "rootHandleExited": run["rootHandleExited"],
                "terminationVerified": run["terminationVerified"],
                "semantic": run["semantic"],
                "semanticResult": run["semanticResult"],
                "accepted": run["accepted"],
            }
            for run in smoke["runs"]
        ],
    }


def compact_run(raw: dict) -> dict:
    smoke = raw.get("smoke")
    measured = raw["measured"]
    reconciliation = raw.get("reconciliation")
    return {
        "runId": raw["runId"],
        "script": raw["script"],
        "invocation": raw["invocation"],
        "repository": raw["repository"],
        "candidate": raw["candidate"],
        "target": compact_target(raw["target"]),
        "probe": raw.get("probe"),
        "measured": {
            "startedAt": measured["startedAt"],
            "finishedAt": measured["finishedAt"],
            "wallSeconds": measured["wallSeconds"],
            "exitCode": measured["exitCode"],
            "cwd": measured["cwd"],
            "argv": measured["argv"],
            "cargo": compact_cargo(measured["cargo"]),
        },
        "smoke": compact_smoke(smoke),
        "endToEnd": raw.get("endToEnd"),
        "reconciliation": (
            {
                "startedAt": reconciliation["startedAt"],
                "finishedAt": reconciliation["finishedAt"],
                "wallSeconds": reconciliation["wallSeconds"],
                "exitCode": reconciliation["exitCode"],
                "cargo": compact_cargo(reconciliation["cargo"]),
            }
            if reconciliation
            else None
        ),
        "binaries": raw["binaries"],
        "rawEvidenceRoot": raw["rawEvidence"]["root"],
    }


run_documents = [
    json.loads(path.read_text(encoding="utf-8-sig"))
    for path in sorted(RUNS.glob("*.json"))
]

summary = {
    "schemaVersion": 2,
    "runs": [compact_run(raw) for raw in run_documents],
}

raw_files = []
for raw in run_documents:
    phases = [raw["measured"], raw.get("reconciliation")]
    for phase in (phase for phase in phases if phase):
        for kind, artifact in phase["rawArtifacts"].items():
            if not artifact:
                continue
            path = Path(artifact["path"])
            actual_hash = sha256(path) if path.exists() else None
            raw_files.append(
                {
                    "runId": raw["runId"],
                    "phase": phase["phase"],
                    "kind": kind,
                    **artifact,
                    "exists": path.exists(),
                    "hashVerified": actual_hash == artifact["sha256"],
                }
            )

roots = sorted({raw["rawEvidence"]["root"] for raw in run_documents})
script_hashes = sorted({raw["script"]["sha256"] for raw in run_documents})
raw_manifest = {
    "schemaVersion": 1,
    "policy": {
        "storage": "External to git; committed manifests retain absolute paths, byte counts, and SHA-256.",
        "integrity": "Treat a raw artifact as valid only when its current SHA-256 equals this manifest.",
        "retention": "Retain until the implementation plan is accepted or 2026-08-15, whichever is later.",
    },
    "roots": roots,
    "measurementScriptSha256": script_hashes,
    "fileCount": len(raw_files),
    "totalBytes": sum(item["bytes"] for item in raw_files),
    "allPresent": all(item["exists"] for item in raw_files),
    "allHashesVerified": all(item["hashVerified"] for item in raw_files),
    "files": raw_files,
}

(EVIDENCE / "measurement-summary.json").write_text(
    json.dumps(summary, indent=2) + "\n",
    encoding="utf-8",
)
(EVIDENCE / "raw-evidence-manifest.json").write_text(
    json.dumps(raw_manifest, indent=2) + "\n",
    encoding="utf-8",
)
print(EVIDENCE / "measurement-summary.json")
print(EVIDENCE / "raw-evidence-manifest.json")
