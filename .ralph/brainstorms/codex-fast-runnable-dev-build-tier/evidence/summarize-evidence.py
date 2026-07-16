import json
from pathlib import Path


EVIDENCE = Path(__file__).resolve().parent


def cargo_summary(path: Path | None) -> dict | None:
    if path is None or not path.exists():
        return None

    rebuilt_packages: set[str] = set()
    rebuilt_target_count = 0
    rebuilt_executables: list[str] = []
    build_finished = None
    parse_errors = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            parse_errors += 1
            continue
        if event.get("reason") == "compiler-artifact" and not event.get("fresh", False):
            package_id = event.get("package_id")
            if package_id:
                rebuilt_packages.add(package_id)
            rebuilt_target_count += 1
            executable = event.get("executable")
            if executable:
                rebuilt_executables.append(executable)
        elif event.get("reason") == "build-finished":
            build_finished = event

    return {
        "file": path.name,
        "parseErrors": parse_errors,
        "rebuiltPackageCount": len(rebuilt_packages),
        "rebuiltWorkspacePackages": sorted(
            package_id
            for package_id in rebuilt_packages
            if "path+file:///C:/efforts/codexu/" in package_id
        ),
        "rebuiltTargetCount": rebuilt_target_count,
        "rebuiltExecutables": sorted(rebuilt_executables),
        "buildFinished": build_finished,
    }


def load_measurement(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    measured = raw["measured"]
    reconciliation = raw.get("reconciliation")
    measured_stdout = EVIDENCE / measured["stdout"]
    reconciliation_stdout = (
        EVIDENCE / reconciliation["stdout"] if reconciliation else None
    )
    changed_smoke_name = raw.get("changedArtifactSmoke")
    changed_smoke_path = EVIDENCE / changed_smoke_name if changed_smoke_name else None
    return {
        "runId": raw["runId"],
        "candidate": raw["candidate"],
        "repository": raw["repository"],
        "target": raw["target"],
        "probe": raw.get("probe"),
        "changedArtifactSmoke": (
            json.loads(changed_smoke_path.read_text(encoding="utf-8-sig"))
            if changed_smoke_path and changed_smoke_path.exists()
            else None
        ),
        "measured": {
            **measured,
            "cargo": cargo_summary(measured_stdout),
        },
        "reconciliation": (
            {
                **reconciliation,
                "cargo": cargo_summary(reconciliation_stdout),
            }
            if reconciliation
            else None
        ),
        "binaries": raw["binaries"],
    }


measurements = [
    load_measurement(path)
    for path in sorted(EVIDENCE.glob("a-*.json"))
    if not path.name.endswith(".manifest.json")
    and not path.name.endswith(".changed-smoke-results.json")
]

smoke_path = EVIDENCE / "smoke-results.json"
smoke = (
    json.loads(smoke_path.read_text(encoding="utf-8-sig"))
    if smoke_path.exists()
    else None
)

summary = {
    "schemaVersion": 1,
    "measurements": measurements,
    "smoke": smoke,
}

output_path = EVIDENCE / "measurement-summary.json"
output_path.write_text(
    json.dumps(summary, indent=2) + "\n",
    encoding="utf-8",
)
print(output_path)
