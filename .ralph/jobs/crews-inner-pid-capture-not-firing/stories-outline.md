# Stories Outline: Crews Inner PID Capture Not Firing

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add capture trace and diagnostics
**Description:** As a crews maintainer, I want durable capture traces and a diagnostic classifier so that missing `inner.pid` failures identify one concrete failure axis instead of requiring manual process archaeology.
**Acceptance Criteria:**
- [ ] `inner-pid-capture.trace.jsonl` records capture script path, launcher read attempts, capture process start/failure, match attempts, write success/failure, timeout, and exit code.
- [ ] A diagnostic command accepts member identity or member directory and emits JSON with a single primary classification, including `capture-died-without-trace` for started capture processes that disappear without `inner.pid` or an exit trace row.
- [ ] The diagnostic can show live child candidates for a launcher PID and whether they match the engine predicate.
- [ ] Before US-002 begins, the diagnostic is run against a freshly reproduced failing member and the classification is recorded; contradictory evidence pauses the structural refactor.
- [ ] Existing missing-`inner.pid` fallback behavior remains unchanged.
- [ ] Relevant crews unit tests pass.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Move capture startup into the launcher
**Description:** As a crews operator, I want capture lifetime owned by the member launcher so that Copilot spawned members reliably write `inner.pid` even when the lead-side tool process exits quickly.
**Acceptance Criteria:**
- [ ] The launcher starts the hidden capture process after writing `launcher.pid` and before invoking the engine.
- [ ] Non-live launcher tests assert the ordering: `launcher.pid` write, then capture process start, then inline engine invocation.
- [ ] The interactive engine remains launched inline via `& copilot ...` / `& claude ...`.
- [ ] `inner.pid` payload includes numeric PID, parseable `startedAt`, image name, and v1.10.0 capture marker.
- [ ] A hard stop routes through `hardTerminateMemberByInnerPid()` and records `launcherPwsh.fate === "exited-naturally"` in the passing live smoke.
- [ ] Unit tests guard against using `Start-Process` for the interactive engine.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Improve hard-stop fallback visibility
**Description:** As a lead, I want stop-member output to explain missing-inner-pid fallback so that I know when a placeholder tab may remain and how to close it.
**Acceptance Criteria:**
- [ ] Slash output for hard stop includes a fallback note when `terminatedPids.refusedReason === "inner-pid-missing"`.
- [ ] CLI JSON output remains machine-readable and preserves `terminatedPids`.
- [ ] Formatter/parity tests cover the fallback note.
**Dependencies:** US-002
**Estimated complexity:** small

## US-004: Update live smokes, docs, and version metadata
**Description:** As a maintainer, I want tests and release metadata aligned with the new capture ownership so that future changes do not regress Copilot hard-stop behavior.
**Acceptance Criteria:**
- [ ] Existing gated `pwsh.exe` stand-in live test still passes or is updated with equivalent coverage.
- [ ] New real-Copilot gated live smoke verifies a real `copilot.exe` capture and clean hard stop.
- [ ] `CHANGELOG.md`, `AGENTS.md`, `.claude-plugin\plugin.json`, and marketplace metadata reflect v1.10.0.
- [ ] Non-live crews tests pass.
**Dependencies:** US-002, US-003
**Estimated complexity:** medium
