# Independent design review convergence

Reviewer: independent `gpt-5.6-sol` xhigh general-purpose subagent.

## Round 1

Verdict: **NO-GO**, two Medium findings.

### M-001 — exact changed artifact was not smoked

The initial edit measurements recorded changed binary hashes, but the canonical
smoke ran after source restoration/reconciliation against a different hash.
That proved build time and restored-artifact runtime separately, not a single
changed build-plus-launch contract.

Fix:

- measurement environment clearing now removes all `CARGO_PROFILE_*`
  overrides;
- measurement uses `-vv` to retain effective rustc argv;
- the measurement wrapper can run the exact-path authenticated smoke before
  source restoration;
- the new convergence run records the changed binary hash in both the
  measurement and its prefixed smoke result, then restores/reconciles source.

### M-002 — plan seed did not integrate predecessor topology

The initial plan proposed a new parallel command even though accepted
predecessor HEAD `2a95dd19` already owns canonical
`verify-core-change.{sh,mjs}` and `measure-build.ps1` tier tooling.

Fix:

- accepted predecessor HEAD is now an explicit branch/rebase prerequisite;
- D-001 extends the canonical verifier with a new `runnable` tier;
- existing `targeted|workspace|executable|publish` semantics stay intact;
- `measure-build.ps1` and predecessor tests are extended rather than
  duplicated.

### Low findings resolved

- All `CARGO_PROFILE_*` overrides are cleared and the convergence run captures
  verbose rustc argv.
- The sccache comparison arm now specifies an isolated directory, dedicated
  server port, cold seed target, second fresh reuse target, changed-core probe,
  advanced-stat deltas, and isolated server shutdown.
- Documentation now states that the final doctor run exited 0 while retaining
  an explicit missing-`rg.exe` warning; successful benign tool smoke did not
  require ripgrep.

## Round 2

Verdict: **GO / converged. No High or Medium findings.**

Verified:

- measured and smoked changed core SHA-256 both equal
  `14bf1df089f856d58bf397e63217b4aab796a72f09a1c26c74ab7ed2c46e6a4f`;
- build through authenticated shell-tool completion is honestly 265.944s;
- authenticated no-tool and shell-tool exits are 0;
- byte/timestamp restoration and nested repository status are clean;
- the implementation seed extends predecessor
  `verify-core-change.{sh,mjs}` / `measure-build.ps1` and preserves existing
  tier semantics.

One Low finding noted stale rollback wording that still described a new
parallel script. It was fixed to remove the `runnable` additions from the
existing verifier/measurement/tests/docs while preserving all prior tier
semantics. Final remaining findings: **none**.
