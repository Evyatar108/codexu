# Review findings

## Initial brainstorm review

### Round 1 - REVISE

1. **Medium:** the first changed-core measurement had not proved that the
   changed executable itself ran. Fixed by capturing measured binary hashes and
   running exact-path launcher/core smokes before source restoration.
2. **Medium:** the initial plan duplicated predecessor tooling. Fixed by making
   the recommended direction explicitly extend
   `scripts/verify-core-change.{sh,mjs}`, its measurement driver, tests, and
   documentation.

### Round 2 - CLEAN

The initial review found no remaining Medium-or-higher issues. One Low rollback
wording issue was corrected before commit
`fd88110b496df7498319d9bc354eea5a34806160`.

## Independent audit supplied after the initial commit

### Audit verdict - REVISE

1. **Measurement provenance:** the committed driver always added `-vv`, while
   the 70.040s and 75.037s headline runs did not. Required one parameterized
   script, exact-script reruns, a script SHA-256, and exact command/environment
   manifests.
2. **SLO ambiguity:** the prior 619.039s cold artifact/launch result exceeded
   600s. Required separate warm-loop and cold-start contracts.
3. **Disk attribution:** the reported 2.094 GiB was whole-target growth, not an
   incremental-directory measurement. Required direct directory sizing and an
   incremental-off control.
4. **Evidence size:** the initial commit retained Cargo JSONL, timing HTML, and
   verbose logs and was not navigable. Required external raw evidence with
   hashes and a bounded repository footprint.

### Corrections

- `measure-candidate.ps1` now accepts `normal|very-verbose`; every final
  headline run used normal verbosity and script SHA-256
  `49e9dd12d5112bc374ef01755cfcf07af68be22d4d4a17e95e247091a157ac48`.
- Nine compact manifests record exact Cargo argv, controlled/cleared
  environment, revisions, sizes, binary hashes, raw paths/hashes, and smoke
  outcomes.
- Warm changed-core build-through-version is 92.963s private / 98.635s
  high-fanout and passes the 600s warm SLO.
- Incremental-on cold build-through-version is 648.476s. The canonical verdict
  is GO for warm loop only; cold fails the original 600s target and has no
  validated SLO.
- Arm B measured `CARGO_INCREMENTAL=0`: private edit 170.032s versus 68.037s
  with incremental on.
- Direct directory sizing attributes 5.184 GiB cold and 7.286 GiB after cycles
  to Arm A's incremental directory; Arm B was exactly zero.
- Raw Cargo artifacts moved to
  `D:\codex-targets\frdbt-evidence\audit-20260716-v2`. The committed aggregate
  manifest independently verifies path, bytes, and SHA-256.
- Legacy Cargo JSONL, timing HTML, verbose logs, duplicated smoke output, and
  old run JSON were removed from the repository.

### Additional correction found during the audit rerun

The first revised cold rerun exposed a timezone-kind bug in the derived
build-through-smoke calculation: in-memory measurement timestamps were strings,
while `ConvertFrom-Json` had converted smoke timestamps to UTC `DateTime`
objects. A plain `[DateTime]` cast interpreted the former as local time and
added seven hours. The driver now normalizes both through `DateTimeOffset` with
round-trip semantics. The invalid run, target, smoke output, and raw artifacts
were removed, and all canonical runs use the corrected script hash above.

## Follow-up independent review

### Round 1 - REVISE

1. **Medium:** measurement provenance omitted the PowerShell executable,
   version, culture/timezone, and full driver process invocation even though
   the scripts use PowerShell 7 features and had already exposed a
   timestamp-kind sensitivity.
2. **Medium:** smoke acceptance used exit code only and had no timeout. A wrong
   model response, absent tool execution, or a hung process could pass or retain
   executable locks.

### Round 1 corrections

- The measurement driver records `[Environment]::ProcessPath`, process command
  line/argv, effective driver argv, PowerShell version/edition/platform/OS,
  culture/UI culture, and timezone in every run manifest. All nine scenarios
  were rerun through the resulting script hash above under PowerShell 7.4.17.
- The smoke driver enforces a 180-second bound, tracks the exact captured
  process tree, and terminates only those PIDs on timeout.
- Version output must match the expected Codex version shape. Authenticated
  JSONL must contain the exact response and no command execution. Tool JSONL
  must contain a completed exit-0 `Write-Output FAST_TOOL_OK` command,
  `FAST_TOOL_OK` aggregated output, exactly one matching final agent message,
  and a completed turn.
- Four smoke-bearing scenarios passed all semantic checks; zero timed out.

### Round 2 - REVISE

1. **Medium:** semantic validation still allowed extra events/commands and
   substring matches rather than proving one exact action.
2. **Medium:** timeout cleanup ignored failed tree termination and then called
   an unbounded `WaitForExit()`.

### Round 2 corrections

- No-tool acceptance now requires exactly four ordered, whitelisted events.
  Any tool, item, or error event beyond the single exact agent completion
  fails.
- Tool acceptance now requires exactly six ordered, whitelisted events; one
  normalized `C:\Program Files\PowerShell\7\pwsh.exe -Command 'Write-Output
  FAST_TOOL_OK'` start/completion pair; exact normalized `FAST_TOOL_OK` output;
  exactly one matching agent message; and one completed turn.
- Timeout cleanup has no unbounded wait. It verifies tree termination and the
  root handle through bounded waits, records all three booleans, and rejects
  the smoke unless termination is verified.
- A one-second forced-timeout preflight timed out all three probes, verified
  root/tree termination for each, and left zero target processes.
- All nine canonical scenarios were rerun after the final smoke driver change.
  The final smoke script SHA-256 is
  `5651946f60324e494fa5053affd1ef1d63cbe4a22a5b2d05353f9ce8064137cc`;
  four smoke-bearing scenarios have zero semantic, timeout, or termination
  failures.

### Round 3 - REVISE

1. **Medium:** one prose sentence retained the prior “about 54 seconds”
   incremental saving even though the final rerun measured 101.995 seconds.

### Round 3 correction

The sentence now says about 102 seconds and matches the manifests, structured
brainstorm, experiment design, and surrounding exact calculation.

### Round 4 - CLEAN

The independent reviewer verified script hashes, JSON/manifests, timing
arithmetic, target histories, storage attribution, exact four/six-event smoke
whitelists, bounded termination, binary freshness, raw/retained evidence
counts, artifact shape, plan seed, and unchanged publish gates. No
Medium-or-higher findings remain.

### Round 5 - REVISE

1. **Medium:** the 720-second cold budget was introduced after observing the
   648.476-second result, so labeling it PASS or making it an acceptance gate
   was not evidence-backed.

### Round 5 correction

Cold start is now reported only as a 648.476-second observation that fails the
original 600-second target. No cold SLO is claimed. GO remains limited to the
warm loop, and cold-start improvement is a non-blocking follow-up limitation.

### Round 6 - REVISE

1. **Medium:** `raw-evidence-manifest.json` recorded the retained summary's
   LF-buffer byte length rather than the size of the CRLF-translated file on
   disk. Its SHA-256 was correct, but the stated byte count was 102,122 while
   the actual file was 104,524 bytes.

### Round 6 correction

The summarizer now records `summary_path.stat().st_size` after writing.
Regeneration updated the summary/manifest hashes, repository provenance, and
bounded repository footprint.

### Round 7 - CLEAN

The independent reviewer verified the corrected cold verdict throughout the
brainstorm and plan seed, confirmed the 720-second figure exists only as a
rejected finding, and checked all retained/external hashes, actual byte counts,
arithmetic, provenance, and footprint. No Medium-or-higher findings remain.
