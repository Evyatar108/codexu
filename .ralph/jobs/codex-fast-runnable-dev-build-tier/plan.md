# Implementation Plan: Fast Runnable Codex Development Tier
<!-- ralph-meta {"overviewTaskId":"codex-fast-runnable-dev-build-tier","uiUxJudgment":"not-required"} -->

*Planning-only deliverable. This phase does not implement, publish, install,
tag, release, push, or remove a worktree.*

Plan provenance:

- Codexu plan worktree:
  `C:\efforts\codexu\.ralph\jobs\codex-fast-runnable-dev-build-tier\worktree\plan`
- Plan branch: `ralph/plan-codex-fast-runnable-dev-build-tier`
- Codexu base: `624f9b1ba51edc54b3ef451e0e5667d4b0a368c5`
- Canonical brainstorm:
  `.ralph/brainstorms/codex-fast-runnable-dev-build-tier/brainstorm.json`
- Accepted predecessor Codex wrapper HEAD:
  `2a95dd19c89fc99492d0e5a25d77cb070fe77da3`
- Accepted patched-source pin:
  `587a6a8ab8948ff912b1f24a62833b277934302d`

## 1. Decision

Implement one additive, explicit, default-off `runnable` lane beside the
accepted predecessor's `verify-core-change` tiers. It builds and runs the
adjacent fork pair:

```text
codex.exe
codex-core.exe
```

with the existing `dev-small` profile, incremental compilation enabled,
sccache disabled for the child build, and a short target dedicated to the
current Codex wrapper worktree.

The lane is for **warm behavior iteration only**. It is not:

- T1 targeted correctness verification;
- T2 workspace correctness verification or the rebase Phase 5a hard gate;
- the optimized `executable` tier;
- T4 publish-equivalent output;
- a source-debugger build;
- a runtime-performance benchmark;
- coverage of normal user-config/plugin/hook/session initialization (the
  smoke-only capsule intentionally bypasses it; T1/T2 remain required);
- an installation or publication path.

The implementation is split across the Codex wrapper and its pinned
`codex-patched` nested repository. Source review proved one bounded early exec
seam necessary: normal exec bootstrap loads configured services and normal
session/tool setup can run configured managers and hooks before shell spawn, so
launcher config alone cannot make either smoke isolated. The nested change is
a bounded fork-exclusive **runnable smoke capsule** dispatched before normal
config/session bootstrap; the wrapper adds two bounded launcher-overlay edits
and one gitlink bump. The only Cargo-manifest edit is
`codex-api/Cargo.toml: sha2.workspace = true` for N-US-001's incremental
terminal body hash; the dependency is already workspace/lockfile-resolved.
No Cargo profile, release profile, publish command, vendor layout, lockfile, or
installed binary changes.

## 2. Frozen Evidence and Acceptance

The accepted verdict is **GO WARM LOOP ONLY**.

| Contract | Metric | Acceptance | Frozen result | Disposition |
|---|---|---:|---:|---|
| Warm no-op | Cargo wall time, zero rebuilt packages | `<=30s` | `9.030s` | Pass |
| Warm private core edit | Build start through exact changed launcher `--version` | `<=600s` | `92.963s` (`68.037s` Cargo) | Pass |
| Warm high-fanout core edit | Build start through exact changed launcher `--version` | `<=600s` | `98.635s` (`74.036s` Cargo) | Pass |
| Warm representative behavior | Exact changed hashes pass no-tool and benign shell-tool turns | Functional | Pass | Required |
| Post-restore no-op | Cargo wall time, zero rebuilt packages | `<=30s` | `7.031s` | Pass |
| Cold target | Absent target through launcher `--version` | Original `<=600s` target | `648.476s` | **Fail** |
| Incremental-off private edit | Cargo wall time | Informational | `170.032s` | Reject as default |
| Incremental storage | `dev-small\incremental` bytes | Informational/quota input | `5.184-7.286 GiB` | Accepted cost |

The implementation must not:

- claim a universal `<=10m` runnable build;
- treat `648.476s` as passing;
- invent a replacement cold SLO or a post-hoc 12-minute acceptance;
- require a routine cold rerun;
- charge model/network latency to the warm build SLO;
- claim sccache causality, because every accepted arm disabled sccache.

Cold-start improvement remains a separate follow-up limitation.

## 3. Source-Verified Predecessor Seams

At `2a95dd19...`, the wrapper already owns the required infrastructure:

- `scripts/verify-core-change.sh`
  - requires explicit tier selection;
  - sources `scripts/iteration-env.sh` for iteration tiers;
  - delegates to the Node verifier.
- `scripts/verify-core-change.mjs`
  - parses `targeted|workspace|executable|publish`;
  - builds exact Cargo plans from real metadata;
  - preserves child exit codes.
- `scripts/measure-build.ps1`
  - obtains the command from verifier plan JSON;
  - records JSON/CSV/Cargo timing evidence;
  - applies byte-safe probe edits under exclusive file handles;
  - restores bytes, timestamps, attributes, and Git cleanliness;
  - reconciles restored-source artifacts and invalidates failed results.
- Existing Node, PowerShell, real-Cargo, CI, baseline, and documentation tests
  enforce the tier hierarchy and probe safety.

The implementation extends these files. It does not add another top-level build
tool, another measurement engine, or a second source-restoration algorithm.

Two predecessor details need bounded extension:

1. `iteration-env.sh` currently describes optimized `executable` as runnable
   T3 and always enables sccache/incremental-off. Add a `runnable` mode while
   preserving its existing default behavior byte-for-byte.
2. In `measure-build.ps1`, the message-format option is appended
   unconditionally. Make that append conditional so the exact runnable plan
   contains one message-format option, not two.

### Placement decision and conflict budget

Seams considered:

1. **Chosen:** extend the wrapper shell/Node/PowerShell verifier, its
   tests/evidence, and two bounded fork-owned launcher overlay files:
   `codex-copilot-launcher/src/config.rs` for smoke-safe policy and
   `src/main.rs` for early sealed driver/guard role validation, query-handle
   receipt/stripping, coordinator-created guard PowerShell spawn, and
   `CODEX_HOME`-scoped temp cleanup. Each branch is smoke-only and marked/tested
   as `SANDBOX PATCH`.
2. **Chosen, source-verified necessary:** add a typed fork-exclusive runnable
   smoke capsule in `codex-patched`. Parse/validate it at the first exec entry
   branch and dispatch before config layers, cloud bundles, exec policy,
   telemetry, state/environment managers, or normal thread/session setup. The
   capsule constructs only a sealed in-memory provider/model request and a
   private response loop. `deny-all` has zero model-visible tools.
   `exact-sentinel` has one private handler that validates the complete semantic
   payload before any normal hook, implicit permission, apply-patch
   interception, or shell handler, then reuses only the low-level sandboxed
   PowerShell rewrite/spawn path through the launcher guard.
3. **Overlay-first evaluated and rejected for this seam:** `codex-core`
   already depends on wrapper-owned `codex-copilot`, but moving the strict
   Responses decoder there would either duplicate `codex-api::ResponseEvent`
   wire semantics behind a neutral mapping or create a Cargo cycle. It would
   also require a wrapper-overlay commit before the nested capsule, inverting
   the required nested-gitlink publication order. A new overlay crate adds
   workspace/dependency manifest edits and the same mapping problem. Prefer
   new isolated files in `codex-api`, `core`, and `exec` with only marked
   call/export seams, consistent with the repository's second placement tier.
   Keep the strict transport/parser and capsule/dispatch as two separate
   nested commits for reviewability.
4. **Rejected:** add a second runnable build/measurement command, because it
   would duplicate locking, probe restoration, and evidence.
5. **Rejected:** modify normal thread/session/router semantics. The smoke-only
   early branch is smaller and leaves the production path byte-for-byte.
6. **Rejected:** direct-core or launcher-only acceptance, because neither
   exercises the adjacent shipped fork pair.

Bounded implementation budget:

- 1 minimal native Rust security supervisor, 1 cmd plan-entry shim, 5 focused
  PowerShell IPC/executor helpers, and 2 small tracked probe JSON files;
- approximately 2,500-4,500 production lines across native supervisor and
  wrapper scripts/helpers;
- approximately 1,800-3,200 deterministic/real-Cargo/security test lines;
- approximately 250-450 synchronized documentation/evidence lines;
- 2 bounded fork-owned launcher overlay Rust files;
- nested commit A1: 1 strict bounded codex-api stream module/export, 1 fallible
  named-pipe reqwest builder, 1 core strict-client method, and one
  `codex-api/Cargo.toml` workspace-dependency line, approximately 240-420
  production lines;
- nested commit A2: 1 core smoke module, 1 exec adapter module, 1 early
  dispatch seam, 1 config hashing utility export, and at most 1 low-level exec
  visibility/refactor seam, approximately 210-390 production lines;
- 1 nested gitlink bump;
- 1 Cargo manifest line; 0 Cargo profile or lockfile changes.

Re-conflict probability:

- **upstream-canonical:** medium-low for one early exec branch, isolated
  core/exec modules, one opt-in codex-api parser path, one core-client seam,
  and narrow utility/exec exports;
- **Codex wrapper rebase:** low, because files are fork-owned;
- **nested Codex rebase:** low, with exact invariant/replant tests and
  `SANDBOX PATCH` markers;
- **same-branch integration:** medium, because verifier/measurement/guidance
  are shared with other build/cache/publish work. Serialize those tasks.

## 4. Public Tier Contract

The public verifier accepts five explicit names:

```powershell
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd targeted --package codex-core
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd workspace
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd runnable --print-plan-json
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd executable --confirm-slow
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd publish --confirm-slow
```

Runnable plan inspection:

```powershell
# No build: inspect exact argv, target, environment, evidence, and smoke plan.
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd runnable --print-plan-json
```

Runnable mutation does not consume opaque worktree-emitted request data.
Instead, the operator selects one separately reviewed exact template whose
operation literal is hard-coded and not a substitution field:

```powershell
# These literals come from the independent implementation review/terminal
# record, never from a worktree command.
$BootstrapV1Exe = '<protected-absolute-bootstrap-v1-exe>'
$BootstrapV1Sha256 = '<operator-known-64-lowercase-hex>'
$AcceptedWrapperCommit = '<operator-approved-40-lowercase-hex>'
$LauncherV1Path = '<protected-absolute-launcher-v1-ps1>'
$LauncherV1Sha256 = '<operator-known-launcher-v1-sha256>'

# The exact reviewed `private-warm` launcher-v1 template hard-codes that
# subcommand and passes only bootstrap path/hash, accepted commit, WorktreeRoot,
# and optional RunId through syntax-restricted environment fields to fixed
# System32 Windows PowerShell `-File` on that protected reviewed script. It
# never invokes a worktree script or the EXE directly from this shell.
```

The complete frozen operation/field matrix is:

| Native subcommand | Compiled scenario/probe/budget/auth mode | Substitutable operation fields |
|---|---|---|
| `build-version` | `runnable-build-version` / no probe / `none` / none | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `authenticated-smoke` | `runnable-authenticated-smoke` + exact no-tool/benign shell-tool / no probe / `none` / authenticated | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `populate` | `runnable-populate` / no probe / `none` / none | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `prewarm-noop` | `runnable-prewarm-noop` / no probe / `runnable-noop` / none | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `private-warm` | `runnable-private-core-edit` / frozen private probe / `runnable-warm` / authenticated | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `high-warm` | `runnable-high-fanout-edit` / frozen high probe / `runnable-warm` / authenticated | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `post-noop` | `runnable-post-reconcile-noop` / no probe / `runnable-noop` / none | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `recover-interrupted` | `runnable-recover-interrupted` + target invalidation/complete build/version/authenticated smokes/reconciliation/final no-op / no probe / no cold SLO / authenticated | `WorktreeRoot`, optional `TargetRoot`, optional `RunId` |
| `recover-source-drift` | `runnable-recover-source-drift` + acknowledged invalidation/complete build/version/authenticated smokes/reconciliation/final no-op / no probe / no cold SLO / authenticated | `WorktreeRoot`, optional `TargetRoot`, `AckSourceSha256`, optional `RunId` |
| `cleanup` | `runnable-cleanup` / no build | `WorktreeRoot`, optional `TargetRoot` |
| `cleanup-orphan` | `runnable-cleanup-orphan` / no build | `RecordedWorktreeRoot`, `GitCommonRoot`, `TargetId`, `OwnerRecordSha256` |

Every row also requires the common non-operation fields `SelfSha256` and
`ExpectedWrapperCommit`. Probe/scenario/budget/authentication are
not public substitutions. For normal templates, `WorktreeRoot` is mandatory,
absolute, operator-visible, and opened/pinned before watcher arming.
`TargetRoot` is optional only as an explicit template field, defaults to
`D:\codex-targets`, is never inherited from ambient environment, and must pass
the section-6 NTFS/identity/path limits before any mutation. Orphan
cleanup requires the recorded worktree to be absent, executes entirely inside
the approved bootstrap (no repository scripts/source), pins the explicit
Git-common/authority roots, and invokes pinned trusted Git with sealed config
only for `worktree list --porcelain`; it therefore does not claim a source
watcher for a nonexistent tree. No template exposes an `Operation` field.

`runnable-bootstrap-v1.exe` is a minimal statically linked native Windows
security supervisor built reproducibly from
`scripts/runnable-bootstrap-v1.rs` as `#![no_std]`/`#![no_main]` with pinned
rustc, `panic=abort`, `/NODEFAULTLIB`, custom entrypoint, and linker
`/DEPENDENTLOADFLAG:0x800`. Its direct imports are frozen raw Windows APIs; the
delay-import table is empty and imports of `LoadLibrary*`, `LdrLoadDll`,
`GetProcAddress`, CLR/CRT/runtime DLLs, or plugin loaders are forbidden.
The candidate PE TLS directory must be absent (no static TLS callbacks), so no
candidate callback can run before the native entrypoint module check.
Deterministic PE parsing recursively resolves direct imports, transitive
imports, and forwarders using the pinned host's actual API-set namespace
(`apisetschema.dll`) and activation-context/SxS policy. The candidate must have
no embedded/external dependent-assembly manifest, private assembly, DLL
redirection file, bound import, or side-by-side probe; `/MANIFEST:NO` and tests
enforce that. API-set contracts resolve to their host DLLs, forwarders recurse,
and every resulting image must be an exact Microsoft-signed
KnownDLL/System32/WinSxS system component opened no-follow. The closure manifest
is bound to Windows build/revision and activation-context inputs; OS drift
requires restaging. Stage-time identities/hashes/signatures are recorded, and
the supervisor's first instruction enumerates PEB-loaded modules and requires
an exact match before any worktree/child action. Before calling any API beyond
the raw `ntdll` registration/query set used for that check, it registers
`LdrRegisterDllNotification` and starts a protected Kernel-Image ETW trace
bound to its own PID. Each later image notification is synchronously matched
to the frozen signed closure and held file identity before the operation may
continue; loss/overflow, a load before monitor arming, or any unmatched image
terminates the Job and leaves the transaction non-ready. Any unresolved,
unexpected, non-system, unsigned, delay-loaded, redirected, or dynamic
dependency rejects the supervisor.

After independent review, its exact bytes/hash are staged outside the repository at
`%ProgramData%\CodexRunnable\bootstrap-v1\<sha256>\` with owner
`Administrators`, protected DACL (`SYSTEM`/`Administrators` full; exact operator
SID read/execute only), medium integrity, and no inherited write ACE. This is
created through held no-follow parent handles; the entire `CodexRunnable`
subtree has the same admin-owned protected boundary, so a non-elevated
same-user process cannot rename/delete a trusted child via writable-parent
`DELETE_CHILD`. This is not a service, PATH install, or release artifact.

The auditable sources `scripts/runnable-seed-stager-v1.ps1`,
`scripts/runnable-stager-v1.ps1`, and `scripts/runnable-launcher-v1.ps1` are
tracked, tested, and hash-pinned, but no worktree copy is ever executed
elevated. Independent implementation review deterministically minifies/
encodes only the deliberately small `seed-stager-v1` source and records its
exact command bytes/hash. The audited seed source may use only a frozen minimal
native allowlist (`CreateFileW`/relative NT open, handle identity/reparse
queries, hash-copy, security descriptor/ACL, flush/rename, and close); it has no
PE parser or operation dispatch. `verify-core-change.mjs` deterministically
minifies and raw-deflate-compresses the reviewed UTF-8 source with pinned Node/
zlib settings, embeds it in one fixed BCL decompressor/`ScriptBlock` loader,
then UTF-16-Base64 encodes that loader. Tests regenerate byte-for-byte, assert
the Win32 import allowlist, and require the complete expanded cmd template
`<=7900` despite the 8191 cap. Runtime executes only that reviewed embedded
artifact, never worktree source. It opens every ProgramData/input component
no-follow, holds identities, hash-copies exact reviewed stager/launcher bytes
into a hash-addressed directory created with a protected Administrators/SYSTEM
descriptor, and verifies owner/DACL/integrity/file identities. Source
redirection is not trusted: only matching bytes survive and no candidate byte
executes before protected staging. The fixed OS ProgramData parent must have
its standard non-user-`DELETE_CHILD` descriptor or the seed fails. The exact cmd wrapper clears
managed/profiler/PowerShell injection, invokes fixed Windows PowerShell 5.1
`-NoProfile -NonInteractive -EncodedCommand <seed-base64>`, and is measured at
`<=7900` characters (hard `cmd.exe` cap remains 8191). A deterministic test
fails if source regeneration, quoting, or substituted fields exceed that
bound. Its only fields are Base64 absolute `StagerSourcePath` and
`LauncherSourcePath`, their two 64-lowercase-hex reviewed hashes, and canonical
`OperatorSid`; it accepts no bootstrap candidate or operation.

The protected staged `stager-v1.ps1` is then invoked by a short exact
System32-cmd/Windows-PowerShell `-ExecutionPolicy Bypass -File
<protected-stager>` template after the same pre-PowerShell environment clear.
It opens ProgramData and every existing component no-follow, validates
identities/owners/ACLs, and opens the native supervisor candidate no-follow
with write/delete sharing denied. It streams bytes to a held temporary handle
while hashing, compares the operator-known digest, and parses held PE import/
delay/TLS/forwarder/manifest/load-config tables. It rejects TLS callbacks,
resolves pinned API-set and activation-context/SxS policy, opens every system
dependency no-follow, verifies Microsoft signatures/KnownDLL identity and
forbidden dynamic-loader absence, then emits the deterministic OS-bound closure
manifest. It flushes, applies/verifies protected owner/DACL/integrity, stores
the manifest, and renames by handle to the hash-addressed final name. It never
executes candidate/worktree code or re-resolves a pinned path.
`stager-v1` has one operation, `stage-bootstrap`, with only Base64 absolute
`CandidatePath`, `CandidateSha256`, and `OperatorSid` fields. Its protected
script path/hash and exact short invocation are independent review outputs.

Every runnable operation is launched by a corresponding frozen invocation of
the protected staged `launcher-v1.ps1`, never by direct EXE or worktree-script
invocation. Each short template uses fixed System32 cmd/Windows PowerShell
`-ExecutionPolicy Bypass -File`, no profile, System32 cwd, and a minimal
environment. The fixed cmd prefix
clears all managed/runtime/profiler and PowerShell injection variables with
cmd builtins before Windows PowerShell initializes, then sets only the
template's syntax-restricted fields; inherited-variable fixtures fail if any
value or startup side effect survives. It opens the protected
staged EXE and closure manifest no-follow, verifies path/file ID/hash/ACL/
signers/OS-build binding, checks exact-image IFEO/AppCompat/extension-point
injection state is absent, constructs the hard-coded subcommand plus only that
row's typed fields, and calls `CreateProcess` with `STARTUPINFOEX` mitigations
active before image initialization: prefer System32, prohibit remote/low-label
images, disable extension points, prohibit dynamic code, and explicit inherited
handles. Its `lpProcessAttributes`/`lpThreadAttributes` carry absolute
protected security descriptors from creation: owner/group Administrators,
SYSTEM/Administrators full, restrictive `OWNER RIGHTS`, and no operator/
package/capability ACE. Thus no default-DACL query window exists. It uses the staged directory as no input cwd (child cwd is System32)
and holds the EXE/parent handles through startup. The launcher protected script
SHA-256/path, exact short quoting, and per-operation
environment field matrix are independent
review outputs. Any closure/OS/IFEO/AppCompat/ACL drift requires restaging or
fails closed.

The native process verifies
its opened image identity/hash/path and every typed operation/field
combination and binds the operation
to the approved wrapper commit. No worktree code runs before it.
At its first instruction it verifies the creation-time owner/group and
protected DACL on its real process/thread objects. Before every child
`CreateProcess`, it supplies the same explicit protected process/thread
security-descriptor shape; it never creates then repairs a default DACL.
AccessCheck under the linked non-elevated
operator token and each lowbox token must deny `OpenProcess` query/duplicate
rights. Children authenticate only through coordinator-injected handles and
the sealed broker session; after the zero-reference ready gate, hostile
lowbox `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_DUP_HANDLE)`
attempts must remain denied.

Before creating PowerShell, the native supervisor changes cwd to held
`System32`, constructs a minimal environment/PATH, clears managed/runtime
injection, calls `SetDefaultDllDirectories`/`SetDllDirectoryW` for itself, and
uses `STARTUPINFOEX` process-mitigation policy for the child:
prefer-System32, prohibit remote images, prohibit low-label images, and an
explicit handle list. It then starts fixed no-profile PowerShell from the held
machine installation. Thus DLL/native dependency selection is constrained
before PowerShell image initialization, not by PowerShell after startup.

Implementation closeout reports the native source/build command, staged EXE
SHA-256, full pre-execution recursive PE closure manifest/evidence, accepted
wrapper commit, protected staging ACL/identity, seed-stager source/hash/exact
encoded command plus measured cmd length,
protected `stager-v1.ps1` source/hash/path/exact invocation/three-field matrix,
protected `launcher-v1.ps1` source/hash/path/exact
per-operation invocations/matrices, every native subcommand template, and the
human-readable field matrix. The
operator chooses the template matching the intended operation; there is no
generic opaque-request template.

Rules:

1. No tier is implicit.
2. T1 `targeted`, T2 `workspace`, `runnable`, optimized `executable`, and T4
   `publish` remain separate contracts.
3. T1/T2 never escalate to a binary-producing tier.
4. `runnable` never escalates to optimized `executable` or `publish`.
5. Runnable has no public confirmation flag and rejects `--confirm-slow`.
   Selecting/pasting one exact independently reviewed per-operation launcher
   template is the explicit slow-operation authorization; it cannot be
   switched to another operation by a field. Existing executable/publish
   `--confirm-slow` behavior remains unchanged.
   Every runnable mutation (build/probe, recovery, cleanup, or orphan cleanup)
   requires an already-full-elevated administrator token whose token user SID
   equals the recorded operator SID; the lane never invokes UAC. Non-elevated
   runnable use is limited to `--print-plan-json`.
6. `--authenticated-smoke`, `--recover-interrupted`,
   `--recover-source-drift`, `--ack-source-sha256`, and `--cleanup` are
   runnable-only. The acknowledgement is required only with source-drift
   recovery and must be exactly 64 lowercase hex. Conflicting actions fail
   with usage exit 2.
   Native `cleanup-orphan` additionally requires exact
   `--recorded-worktree-root`, `--git-common-root`, `--target-id`, and
   `--owner-record-sha256`, is mutually exclusive with every build/recovery
   action, and follows the recovery-only contract in section 7.
   Provider-bridge-bearing recovery additionally requires pipe/socket/Job
   drainage before any profile/ACL/target cleanup.
7. Runnable accepts only optional `--run-id` from this family; Node validates
   and maps it to `-RunId`. Probe spec, scenario, budget class,
   authentication are derived solely from the selected
   frozen native subcommand and have no public flags or environment
   substitutions. Runnable budgets are enforced automatically; there is no
   public opt-out or separate `--enforce-budget` flag.
8. Existing targeted/workspace/executable/publish plan snapshots and execution
   paths remain regression-tested.
9. Wrapper commits 1-6 keep `runnable` plan-inspection-only with
   `implementationReady:false`; build, recovery, and cleanup fail before
   mutation. Wrapper commit 7 atomically enables the public execution gate and
   launcher smoke dispatch only after transaction, source recovery, target
   lifecycle, capability/ACL lifecycle, provider bridge/broker boundary, smoke guard, and
   deterministic safety fixtures all exist.

`runnable` is a Windows-only execution contract. On non-Windows hosts,
`runnable --print-plan-json` remains deterministic and side-effect-free,
returning `planKind:"logical-unsupported"`, the frozen
profile/packages/bins, logical argv template with `<absolute-cargo.exe>`, and
`platform.required:"win32"`/`platform.supported:false`; it does not claim a
resolved Cargo/rustc/tool/target identity. Windows execution planning returns
the distinct `planKind:"resolved-windows"` only after those identities resolve.
Runnable build, recovery, and cleanup exit with a stable unsupported-platform
prerequisite error before sourcing the iteration environment, opening control
state, or mutating files. Other tiers keep their existing cross-platform
behavior. Node tests inject `win32`, `linux`, and `darwin` platform values.

Windows runnable mutation never begins through a worktree file or opaque
worktree-emitted request. The operator selects an independently reviewed exact
per-operation `launcher-v1 -> runnable-bootstrap-v1.exe` template and supplies
its human-readable typed fields, operator-known launcher/EXE SHA-256 values,
and accepted wrapper commit SHA. None comes from a worktree emitter. The
reviewed OS launcher is the canonical elevated entry and creates the protected
native supervisor with pre-entry mitigations. Before starting task PowerShell or parsing/
executing any repository byte, it:

1. validates the full same-operator elevated token, opens/pins the explicit
   worktree-root argument no-follow, and arms the recursive source watcher
   immediately, before invoking Git or parsing HEAD/index/diff/provenance;
2. reads the held `.git` indirection and, when linked, held `commondir` file
   under a drain/rescan barrier, opens every Git-admin/common path component
   no-follow with write/delete sharing denied, and arms one recursive
   Git-common watcher before any other Git-admin read or Git invocation. When
   Git-common is already inside the watched worktree, the source watcher covers
   it and no overlapping watcher is added. It then resolves/pins the accepted
   absolute Git executable and parents, suppresses system/global config and all
   helper execution, and verifies the operator-approved commit/source blobs
   while both required watcher domains are active;
3. opens the transaction lock and every component of ProgramData authority and
   exact bootstrap-closure paths no-follow with write/delete/rename sharing
   denied;
4. derives and verifies raw SHA-256 from the complete executable closure in
   the accepted commit
   (`verify-core-change.{cmd,ps1,sh,mjs}`, `iteration-env.sh`,
   `measure-build.ps1`, runnable PowerShell/native helper sources, probe specs, and
   any transitively loaded repository script/module), compares each held
   worktree file to its accepted blob, and rejects an unmanifested executable
   input;
5. writes the pessimistic manifest and takes HEAD/index/diff/untracked
   provenance through the pinned Git/config boundary with the watcher overlap/
   drain/rescan barrier;
6. creates/verifies the stable zero-capability executor AppContainer profile,
   a per-run executor scratch lease, and a lowbox token with no source/target/
   authority access; then sets trusted cwd/DLL policy and creates fixed
   PowerShell 7 with that token, a minimal environment, `-NoLogo -NoProfile -NonInteractive
   -EncodedCommand <embedded-loader>`, no trailing arguments, an explicit
   inherited-handle list, `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`, and
   `STARTUPINFOEX` image-load plus child-process-restricted mitigations before
   the child image initializes; and
7. streams the already-held verified `verify-core-change.ps1`,
   `measure-build.ps1`, and helper bytes over a bounded inherited pipe to the
   embedded loader, which evaluates them without reopening worktree paths.

Steps 1-6 govern build, recovery, and cleanup while the worktree exists.
`cleanup-orphan` is the narrow exception: its hard-coded launcher-v1/native template requires the
recorded worktree path to be absent, pins explicit Git-common/authority/target
roots, validates the owner-record hash, and runs only native supervisor cleanup
code plus the pinned trusted Git executable with sealed config solely for
`--git-dir <GitCommonRoot> worktree list --porcelain`. It never executes
repository scripts/source bytes and does not pretend to arm a watcher on an
absent source tree.

The native supervisor is the single lifetime security coordinator and sole
owner of authoritative filesystem/security mutation. It retains
the root/closure/lock/watcher handles and sequence through finalization.
PowerShell remains the sole Cargo/source/evidence executor, but every
authoritative journal transition, probe replacement/restoration, target/
authority create/delete/rename, AppContainer/profile/ACL lease operation,
evidence-authority write, and wrapper-owned root process spawn uses a bounded duplex
pipe request to the native parent; the parent validates operation/sequence/
path/hash against its held state before ACK, then observes the resulting
watcher event before COMMIT. PowerShell receives only the script-input and
coordinator IPC handles; Bash/Node receive no watcher/lock/authority handles
and return bounded plan/calculation results to PowerShell. No child adopts or
reopens security handles. PowerShell owns orchestration, Cargo timing, result
interpretation, and evidence content generation, not privileged handle
mechanics. Native-parent death closes Jobs/pipes and makes
the run non-ready.

The PowerShell executor is never elevated: it runs as the executor AppContainer
lowbox with child-process creation prohibited, zero network capabilities, and
no source, target, Git-common, registry, credential, or authority ACL. It can
write only its bounded per-run executor scratch and can communicate only over
the explicit coordinator pipes. Even malicious verified PowerShell code cannot
spawn or directly mutate protected state; all useful operations require native
IPC validation.

The native supervisor constructs the PowerShell child environment from a
minimal allowlist and clears all `DOTNET_*`, `COREHOST_*`, `COMPlus_*`,
`COR_*`, `CORECLR_*`, PowerShell startup/dependency injection, `BASH_ENV`,
`ENV`, `SHELLOPTS`,
`BASHOPTS`, `CDPATH`, `GLOBIGNORE`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONHOME`,
`PYTHONPATH`, `PYTHONSTARTUP`, and every ambient `GIT_*` injection before
PowerShell image creation. It sets `PSModulePath` only to held machine roots and
PATH only to pinned tool directories. PowerShell requests a native-parent
spawn of fixed Git Bash with `--noprofile --norc` in runnable `--emit-env`
mode; Bash sources the verified iteration environment, emits one bounded
NUL-delimited environment record, and spawns nothing. PowerShell validates that
record, then requests native-parent spawns for fixed Node, Cargo, Git, Python,
and every other worker. No PowerShell/Bash/Node path calls `CreateProcess`.
PowerShell, Bash, Node, and orchestration-only Python run under the executor
lowbox from coordinator-streamed verified code/input; Git runs under inspector
lowbox with source/non-authority-Git read only; Cargo runs under build lowbox.
After native creates the Cargo root atomically in the Jobs, Cargo/rustc/linker/
approved build scripts may create only the expected toolchain/build-script
descendants; Job+ETW image policy at section 7 observes and rejects every other
descendant. This toolchain exception does not permit orchestration children to
spawn.
Hostile cwd/PATH DLLs, user modules, profiles, autoload modules, and mixed-case
profiler variables must not execute.

The shell shim remains the cross-platform parser; the PowerShell trampoline is
the confined transaction executor; the reviewed OS launcher plus protected
native supervisor is the only canonical elevated runnable chain. For runnable execution:

1. the trampoline/shell apply the non-Windows runnable gate above;
2. on Windows native parent starts shell `--emit-env`; the shell discards
   inherited `CODEX_ITERATION_MODE`, selects `runnable` only for the fixed
   native subcommand, sources `iteration-env.sh`, emits bounded environment,
   and spawns nothing;
3. native parent starts Node with that validated environment; Node parses and
   validates the reconstructed public CLI, rejecting malformed/unknown tiers
   before any execution;
4. Node returns bounded plan data to the coordinator; it never delegates or
   owns mutation;
5. coordinator-loaded `measure-build.ps1` requests Node plan JSON using
   `--print-plan-json`, which is
   plan-only and cannot execute Cargo;
6. PowerShell remains the sole build/restore/evidence executor while the
   native parent remains the sole security/lock/watcher coordinator.

There is no recursive execution marker or caller-supplied metadata projection.
For runnable planning, `VERIFY_CORE_CHANGE_METADATA_JSON` is ignored and plan
JSON records `metadata.status:"not-run-plan-only"` plus the frozen logical
workspace/package/bin expectations; plan inspection never executes Cargo or
creates an isolated home. After an elevated mutating invocation owns its lock,
profiles, leases, and scratch, real
`cargo metadata --locked --offline --no-deps --format-version 1` is required
before build/source mutation and must match those expectations. Existing test
injection remains test-only and cannot select runnable execution.
Directly sourcing `iteration-env.sh` rejects unknown mode values. Hostile
ambient `CODEX_ITERATION_MODE=runnable` must not change targeted, workspace,
executable, or publish plan/execution snapshots.

Node derives the exact scenario shown in the frozen native operation matrix in
section 1, with the default run ID
`<exact-scenario>-<UTC>-<nonce>`. It does not collapse operations into generic
build/authenticated/recovery labels. Only optional `--run-id` may override the synthesized run ID after safe
identifier validation. There is no public scenario/probe/budget override.
Thus every documented command maps deterministically to the predecessor
executor's required `Scenario` and `RunId`.

## 5. Exact Build and Environment Contract

Run from the patched Codex workspace:

```text
<absolute-cargo.exe> build --locked --profile dev-small \
  -p codex-cli --bin codex-core \
  -p codex-copilot-launcher --bin codex \
  --timings --message-format=json-render-diagnostics
```

Before constructing the isolated runnable environment, derive and hold the
operator's canonical `.rustup` home/profile identity, resolve an absolute
`rustup.exe`, canonicalize it, require a regular non-reparse file, and record
path/version/SHA-256. In one bounded no-network tool-resolution child, set
`RUSTUP_HOME` only to that held canonical home and
`RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`, then invoke exact rustup to
resolve `<absolute-cargo.exe>` and `<absolute-rustc.exe>`. Canonicalize them, require regular
non-reparse files under the selected `stable-x86_64-pc-windows-msvc`
toolchain, record path/version/SHA-256, set `RUSTC=<absolute-rustc.exe>`, and
invoke Cargo only by the recorded absolute path. Hold no-write/no-delete
handles for rustup, Cargo, and rustc from validation through final evidence,
hash through those handles, and hold no-delete handles on every canonical
parent component from accepted installation root to executable so path-based
`CreateProcess` cannot be redirected by a parent rename. Re-resolve and compare
before final evidence. After resolution, actual metadata/build/smoke children
replace `RUSTUP_HOME` with empty owner scratch and invoke only the held absolute
Cargo/rustc files; they never run a rustup proxy. A changed toolchain path,
parent identity, or hash fails the run.

Coordinator trust is pinned before plan/execution work. Resolve the already
running Git Bash image plus PowerShell 7, Node, Git, the Windows Python
launcher, its selected Python 3.11 interpreter, and `just` from accepted canonical
installation roots rather than caller PATH. Require regular non-reparse files,
record path/version/SHA-256, hold no-write/no-delete handles through final
evidence, hold no-delete handles for every canonical parent component, and use
only those absolute paths for every child invocation.
Python's `sys.executable` must equal the held interpreter before `tomllib` is
used. Invoke it only as `<absolute-python.exe> -I -S ...`, so environment,
user-site, `sitecustomize`, and `usercustomize` cannot inject code.
PATH-shadow, hostile customization fixtures, or mid-run executable replacement
fails; there is no fallback to a newly resolved binary.

This parent-chain rule applies to every path-based executable launch, including
the just-built launcher/core and held real PowerShell used by the guard.
Barrier fixtures rename or replace an executable parent after validation and
before `CreateProcess`; the held chain must prevent redirection or fail closed.

Git provenance uses a sealed configuration boundary. The trampoline sets
`GIT_CONFIG_NOSYSTEM=1`, points global config to a held owner-created empty
file, clears every other `GIT_*` injection, and invokes only absolute Git with
fixed overrides disabling `core.fsmonitor`, hooks, optional locks, external
diff, and text conversion. Hold/hash the wrapper `.git` indirection, common
`config`, and worktree `config.worktree` when present; reject `include`/
`includeIf`, `filter.*`, `diff.*.command`, `diff.*.textconv`,
`merge.*.driver`, `core.attributesFile`, and `core.excludesFile` directives and
any additional config origin. Set `GIT_ATTR_NOSYSTEM=1`, point global
attributes and excludes at held owner-created empty files, and use a held empty
`XDG_CONFIG_HOME`. Hold/hash every repository `.gitattributes`/`.gitignore` and
reject any active `filter` attribute before provenance. Resolve
`git rev-parse --git-path info/attributes`; hold/hash it when present and hold
and watch its parent for absent-file creation, edits, replacement, or deletion
through the final Git command. Apply the same hold/absent-file watch to
`git rev-parse --git-path info/exclude`. Diff/status commands use
`--no-ext-diff --no-textconv` where applicable. Config/attribute creation or
mutation, or an executable fsmonitor/filter/diff/helper attempt, is
`source-drift` and fails.

Expected pair:

```text
<target>\dev-small\codex.exe
<target>\dev-small\codex-core.exe
```

Direct core execution is diagnostic only. Launcher-only output is not runnable.

### Runnable iteration environment

Add `CODEX_ITERATION_MODE=runnable` support to `scripts/iteration-env.sh`.
Default/unspecified mode remains the predecessor's frozen optimized iteration
profile. Runnable mode reuses its existing LLVM/xwin/V8 discovery and tool
preflight, but:

- sets `CARGO_INCREMENTAL=1`;
- sets `CARGO_BUILD_JOBS=8` unconditionally for runnable and rejects/clears any
  ambient override; other iteration modes retain predecessor override behavior;
- clears all case variants of `SCCACHE_*`;
- clears `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER`,
  `CARGO_BUILD_RUSTC_WRAPPER`, and
  `CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER`;
- exports those four wrapper variables as explicit empty strings for the Cargo
  child;
- does not start, stop, reset, inspect, or clear the shared sccache
  server/cache;
- clears inherited `CARGO_PROFILE_*`, then restores the repository-canonical
  `CARGO_PROFILE_RELEASE_LTO=off` and
  `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16` required by the frozen iteration
  contract;
- clears `RUSTFLAGS`,
  `CARGO_ENCODED_RUSTFLAGS`, compiler/linker/target-dir overrides, and
  `CL`/`_CL_`/`LINK`/`_LINK_` option injection;
- sets only the existing canonical LLVM/xwin/V8 values and the derived target;
- pins `CC`, `CXX`, `AR`, and
  `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER` to canonical absolute files
  under `C:\Program Files\LLVM\bin`, recording path/version/SHA-256 and holding
  no-write/no-delete file handles plus no-delete handles on each canonical
  parent component through Cargo and final evidence.

Build-affecting environment handling is case-insensitive. Reject any surviving
non-allowlisted Cargo/rustc/profile/target/compiler/linker/wrapper variable
after cleanup. The complete protected allowlist and value rules are:

| Variable | Runnable value |
|---|---|
| `RUSTUP_TOOLCHAIN` | exact `stable-x86_64-pc-windows-msvc` |
| `RUSTC` | canonical absolute `rustup which rustc` result |
| `CARGO_TARGET_DIR` | canonical owned short target |
| `CARGO_INCREMENTAL` | `1` |
| `CARGO_NET_OFFLINE` | `true`; measured transactions never fetch |
| `CARGO_BUILD_JOBS` | exact `8`; runnable has no override field |
| `CARGO_PROFILE_RELEASE_LTO` | `off` |
| `CARGO_PROFILE_RELEASE_CODEGEN_UNITS` | `16` |
| `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER`, `CARGO_BUILD_RUSTC_WRAPPER`, `CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER` | explicit empty strings |
| `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`, `CL`, `_CL_`, `LINK`, `_LINK_` | absent |
| `CC`, `CXX`, `AR`, `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER` | canonical absolute LLVM files |
| `LIB`, `INCLUDE` | exact xwin-derived strings from the predecessor |
| `RUSTY_V8_ARCHIVE` | exact version-derived archive path |
| `CARGO_HOME` | owner scratch `cargo-home` containing no config/credentials and only pinned no-write registry/git cache projections |
| `RUSTUP_HOME` | owner scratch empty root; Cargo/rustc are invoked by held absolute toolchain paths |
| `PATH` | constructed only from held rust-toolchain, LLVM, Git, PowerShell, Python, Node, System32, and Windows directories in fixed order; no caller entries |
| `ComSpec` | held `%SystemRoot%\System32\cmd.exe` |
| `PATHEXT` | canonical `.COM;.EXE;.BAT;.CMD` |
| `TEMP`, `TMP` | owner-pinned per-run build scratch |
| `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA` | isolated owner-pinned build scratch roots with no profile junctions |
| `SystemRoot`, `WINDIR`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramData`, `NUMBER_OF_PROCESSORS` | canonical host values resolved by the trusted trampoline, not copied from caller text |

No other `CARGO_*`, `RUST*`, `SCCACHE_*`, compiler/linker injection, profile,
target, wrapper, or toolchain-selection variable reaches the Cargo child.
All case variants of `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`,
provider credentials, and API keys are stripped from the build child. Required
locked dependencies must be fetched before the measured transaction.
Credentials never reach the build child. Compact
evidence records the allowlist, removed keys, canonical values, and redacted
hashes where specified.

Every process observed in the transaction/per-root Job Objects must have a
canonical image in the pinned tool manifest or be an owner-target build-script
executable under the exact Cargo target. An image resolved from caller PATH,
user temp, or another worktree makes the run non-ready. Fixtures shadow common
helper names and spawn an unexpected helper to prove both PATH construction and
descendant-image rejection.

The parent caller is not mutated because the public shell command runs in its
own process. A real tiny Cargo fixture with a configured sentinel rustc wrapper
must prove that explicit empty wrapper variables prevent wrapper invocation.
If the installed Cargo does not honor that behavior, stop and amend the plan.

### Cargo configuration boundary

Avoid a new TOML parser. Before metadata/build, enumerate the exact Cargo
configuration candidate files Cargo can read from the workspace and its
ancestors plus resolved `CARGO_HOME`:

```text
.cargo\config.toml
.cargo\config
```

For the accepted source pin, the only allowed existing candidate is:

```text
external\repos\codex-patched\codex-rs\.cargo\config.toml
normalized-LF SHA-256
b8ae1cea341beb2d4a3c8fb81f97a96f4aee1fd53f769c57f140dfe949806a80

accepted raw checkout forms:
LF   b8ae1cea341beb2d4a3c8fb81f97a96f4aee1fd53f769c57f140dfe949806a80
CRLF adc1b9fa038d4bca7d7cbae2139f8e22d7a8e9956ec4f723956055350ed07e2b
```

It contains only the pinned Windows target rustflags. Fail before Cargo if:

- any other workspace-ancestor or `CARGO_HOME` config exists;
- the allowed config's CRLF/CR-normalized-to-LF hash differs;
- a candidate appears, disappears, or changes between preflight and final
  evidence.

Open the accepted config with no write/delete sharing before hashing and retain
that handle through metadata, Cargo, smokes, restoration, reconciliation, and
final evidence. Hash through the held handle. Parent-directory no-reparse
identity is pinned as well. Config replacement/edit attempts must fail or make
the transaction non-ready; pre/post path hashes alone are insufficient.

For every other possible config candidate, hold/watch the exact `.cargo`
directory when it exists; when absent, hold/watch its nearest existing ancestor
for creation of the missing path components. Hold/watch resolved `CARGO_HOME`
for `config` or `config.toml` creation. These non-overlapping directory
notifications remain armed for the full transaction. Any candidate creation,
rename, deletion, watcher overflow, or identity drift is `source-drift`, even
if the path later disappears. Before and after metadata/Cargo, create and
after metadata/Cargo, use double-buffered overlapped reads: arm the successor
request before cancelling/draining the predecessor, process monotonically
sequenced events, rescan candidate paths/identities, and acknowledge a barrier
only when the overlapping buffers and rescan are clean. The final ready
transition performs the same drain while coverage remains continuously armed.

This strict controlled-host boundary excludes hidden `include`, source
replacement, patch, profile, target-links, runner, linker, wrapper, or `[env]`
configuration without duplicating Cargo's TOML merge logic. A future source
pin/config change requires explicit plan and evidence review. Evidence records
both raw bytes/hash and normalized-LF bytes/hash so Git checkout line-ending
policy is visible without rejecting the accepted Windows checkout.

## 6. Target Identity, MAX_PATH, Quota, and Ownership

Target-root selection:

1. Use absolute `CODEX_RUNNABLE_TARGET_ROOT` only when launcher-v1 maps the
   reviewed template's explicit optional `TargetRoot` field. Clear/reject any
   ambient inherited value.
2. Otherwise use `D:\codex-targets` only when `D:` is local, fixed, writable,
   non-reparse, and NTFS.
3. Otherwise fail and require an explicit short local fixed-drive root.

Reject relative, UNC, network, removable, symlink/junction/reparse-backed,
non-NTFS, repo-contained, release/install, and canonical Cargo target paths.

Before creating an owner manifest, quota reservation, or target directory,
run a capability probe under the candidate root. A unique tiny sentinel tree
must demonstrate stable volume/file IDs, parent-handle-relative `NtCreateFile`
with no-follow semantics, same-parent rename, and
`FileDispositionInfoEx` handle deletion. Remove the sentinel through the tested
handle path. Any unsupported API, unstable identity, denied operation, or
sentinel cleanup failure rejects the root; a large target is never created on
a volume the public cleanup cannot safely service.

Derive:

```text
targetId = first 16 lowercase hex characters of SHA-256(
  normalized canonical Codex wrapper worktree root
  + NUL
  + normalized git common directory
)
target = <targetRoot>\runnable-<targetId>
```

The ID deliberately excludes HEAD so the worktree stays warm across commits.
For filesystem names derive
`runTag = first 16 lowercase hex characters of SHA-256(runId)`; retain the full
validated run ID only inside manifests/evidence.
Require:

- target root length `<=60`;
- complete target path length `<=80`;
- new/empty target free space `>=20 GiB`;
- existing warm target free space `>=8 GiB`.

Before creating control, owner, reservation, target, scratch, or evidence
state, compute every path and command line that will be visible to cmd,
PowerShell, Bash, Node, Git, Python, Cargo, rustc, launcher, core, guard, or
cleanup. Require each filesystem path (including cwd, executable parent chain,
control/evidence files, `build-temp`, `CODEX_HOME`, `TEMP`/`TMP`, guard, and
probe paths) to be `<=240` characters, each `cmd.exe` command line to be
`<=8191`, and each direct `CreateProcess` command/environment block to be
within its Windows limit. Process-created directories reserve at least 20
characters below 240 for descendants. Any violation is a prerequisite failure
before mutation; long-path prefixes are not used to waive this contract.
The only inline payload is seed-stager and its complete expanded cmd template
must be `<=7900`; full stager and launcher use protected short `-File` paths.

The fixed short implementation roots in section 14 are part of the contract.
At the accepted pins, tracked-file maximums are 114 characters for wrapper
files and 237 for the initialized nested checkout inside the wrapper worktree.
The standalone nested layout is rejected as unbuildable. Recompute with `git ls-files`
after adding files and reject either PRD if any checkout path exceeds 240.

Always report free bytes and total/profile/incremental/deps/build/fingerprint
bytes before and after. Never auto-delete to satisfy quota.

Untracked provenance is ignore-independent. Hash the union of normal untracked
and ignored untracked files (or an equivalent no-follow filesystem
enumeration), excluding only Git control files and the separately hashed nested
gitlink/checkout. Never infer completeness from `git status` or
`--exclude-standard` alone. The held `.gitignore`, `info/exclude`, empty global
exclude, and source watchers make transient ignore-rule changes fail closed. Never auto-delete to satisfy quota.

Before provenance or Cargo, recursively enumerate the wrapper and nested
source trees no-follow from held roots. Reject every file or directory reparse
point (tracked, untracked, ignored, submodule interior, junction, symlink,
mount point, or unknown tag) and every regular source file with hard-link count
greater than one. The nested checkout's normal `.git` indirection file is
parsed/held as Git control metadata, not followed as a source link. Record
volume/file IDs and link counts in provenance. This ensures every Cargo input
is physically inside the watched roots; no external target can mutate without
a watcher/provenance event. Fixtures cover tracked/untracked/ignored file
symlinks, directory junctions, mount points, hardlinks, external-target
mutation during the build, and reparse creation after preflight.

Control state lives outside the deletable target:

```text
%ProgramData%\CodexRunnableState\v1\repositories\<repository-id>\<targetId>\
  owner.json
  transaction.lock
  transaction.json
  latest.json
  probe-recovery.json
  scratch\<runTag>.json
  evidence\<runTag>.*

%ProgramData%\CodexRunnableState\v1\volumes\<volume-id>\quota\
  quota.lock
  live\<targetId>.json
  receipts\<targetId>\<reservationGeneration>.json

<targetRoot>\.codex-runnable-scratch\<targetId>\<runTag>\
  executor-temp\
  build-temp\
  smoke\credential-capsule\
  smoke\model\codex-home\
  smoke\model\temp\
  smoke\sentinel\temp\
```

Resolve and pin the Git common directory with inspector Git, derive
`repository-id` from its held volume/file identity plus accepted repository
identity, then open/create the admin-owned protected ProgramData state tree
relative to held no-follow parents. The non-elevated operator has no read,
write, delete, `READ_CONTROL`, or parent `DELETE_CHILD` rights there.
Open `transaction.lock`, owner/manifests, evidence, and the authoritative
scratch journal only relative to those held control-directory handles. Open
the non-authoritative writable scratch container relative to the held target-
root scratch parent; its identity/path is bound by the ProgramData journal.
`executor-temp`, `build-temp`, model `codex-home`/`temp`, and sentinel `temp` are distinct
low-integrity children there, outside the source watcher root. Reject reparses or identity drift and
retain the control-parent handles through finalization/cleanup. Git-common may
contain only an optional non-authoritative locator/receipt; its deletion or
replacement never forks authority. A swapped ProgramData control parent must
not create a second lock or redirect state.

Authority records must also be unreadable and unwritable by untrusted Cargo
build scripts or smoke descendants running as the same user. Before any child
starts, set and verify an explicit medium-integrity no-write-up label plus an
admin-only protected DACL (`SYSTEM`/`Administrators` full, no operator SID or
package/capability ACE) on the ProgramData control tree, operator-global
capability registry, evidence, and transaction/owner/nonce records. Secret
capability SIDs exist only in that protected registry and in supervisor
memory, never in operator-readable lease/manifest/evidence fields. No
authoritative record lives below the Cargo-writable target. Any runnable
mutation, whether build, recovery, cleanup, or orphan cleanup, must
already run under a full elevated administrator token for the same operator
SID recorded in the owner manifest and canonical operator profile; otherwise
it fails before mutation and never invokes UAC. Plan inspection stays
non-elevated and side-effect-free. Reject alternate-credential elevation,
different token user SID, profile-root mismatch, or owner SID drift. Authority
files are explicitly created with a medium integrity label and owner DACL, but
all later mutation/recovery still requires the same full elevated operator.
Every build/smoke descendant remains lowbox and receives no coordinator token
or authority handle.

Derive the expected operator SID before first mutation from the held worktree
root and Git-common directory owners; both must be the same non-group user SID.
Resolve that SID's profile/LocalAppData through Windows profile APIs, require
the directory owner to match, and print these identities in plan JSON. The
elevated token user must equal that derived SID. Persist it in the first owner
record; all later runs compare token, profile, worktree, Git-common, and owner
record. A repository owned by a group/service/other SID is unsupported until
ownership is repaired explicitly.

Use five stable per-target user-scoped AppContainer profiles, retained for the
warm target's lifetime and deleted only by owner-verified target cleanup:

- `CodexRunnable.<targetId>.executor`, created with zero capability SIDs, runs
  only the coordinator-fed PowerShell transaction executor with child-process
  creation prohibited;
- `CodexRunnable.<targetId>.inspector`, created with zero network capability,
  runs only pinned Git provenance/config reads with child-process creation
  prohibited;
- `CodexRunnable.<targetId>.build`, created with zero capability SIDs, runs
  Cargo/rustc/build scripts and exact version smoke;
- `CodexRunnable.<targetId>.model`, created with zero capability SIDs, runs only
  the authenticated driver/launcher/`codex-core.exe` chain and reaches the
  provider only through the coordinator's authenticated named-pipe bridge;
  driver/core receive child-process-prohibited mitigation;
- `CodexRunnable.<targetId>.sentinel`, created with zero capability SIDs, runs
  only the exact launcher guard/PowerShell sentinel; guard receives child-
  process-prohibited mitigation and coordinator alone creates PowerShell.

Create each profile with `CreateAppContainerProfile` using zero registered
capabilities and derive/verify its package SID. Package SIDs receive **no data
ACLs**. For each run, native supervisor generates cryptographically random
256-bit role capability SIDs and supplies the exact role set through
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`; source/tool-read and
target-write/credential/scratch/provider-pipe/model-nonce/sentinel-nonce
capabilities are distinct. Read-only source/
tool capability identities may appear only on operator-readable objects whose
contents that operator can already read; they confer no mutation or credential
authority. In particular, target-write, scratch-write, and credential
capability identities never appear on an operator-readable object, and their
admin-owned target/authority DACLs deny the non-elevated operator
`READ_CONTROL`. Secret capability values exist only in locked native memory and
admin-protected lease records whose tree grants no operator-SID read ACE;
the coordinator process's exact protected Administrators/SYSTEM-only DACL and
each child process DACL deny non-elevated query/duplicate access. Operator-readable evidence
contains only keyed opaque role labels and descriptor/lease hashes, never a
capability SID or derivation input. Remove every per-run capability ACE after
Job drain. Tests must
source-verify arbitrary per-launch capability SIDs are honored by the selected
Windows APIs; if not, amend the design before implementation. Journal all five
profile names, package SIDs, hashed capability identities, token
integrity/restriction facts, and lifecycle; never persist raw secret
capabilities in normal evidence.

Under one operator-global ACL-registry lock, journal and add only each run's
exact capability-SID lease ACEs, never a stable package-SID ACE. The executor
role receives only per-run executor-
scratch modify; system PowerShell/runtime must already be RX, and it receives
no source/target/authority/config/credential access. Bash/Node/Python
orchestration workers run in the same executor lowbox from coordinator-streamed
verified scripts. Their exact pinned Bash/Node/Python installation and runtime
dependency roots receive per-run executor read/execute/traverse capability
ACEs (or must already grant equivalent access), with no write/create/delete/
ACL-owner rights; no script or repository filesystem input is granted. The
inspector receives
read/traverse only on exact source and non-authority Git-common inputs, with no
write/credential/target access. The build role capabilities receive read/execute/traverse on the
reparse-free source, exact locked per-user Cargo registry/git cache, held
tool/runtime roots, read/write on the owned target, and per-run build scratch.
The supervisor opens the exact cached Copilot token/device/machine files
no-follow under held owner/profile roots, verifies their identities/hashes,
then copies only their required bytes into the admin-owned per-run
`smoke\credential-capsule` sibling. It is outside every model-writable root:
protected parent/file DACLs grant only SYSTEM/Administrators full and the
secret model-credential capability read/traverse, while held handles deny
write/delete/replace sharing. Originals receive no lease ACE. The model role
receives target-binary read, credential-capsule read, and model-scratch write
only during authenticated smoke; the secret credential capability appears
only on that admin-owned unreadable capsule and is removed before handle-
relative wipe. Exact order is: drain model Job/provider pipe, prove zero model
handles/processes, remove the credential capability ACE under `lease.lock`,
truncate/delete each capsule file through the supervisor's held parent/file
handles, flush the parent, then mark scratch cleanup complete. Launcher config
and its parent remain coordinator-only. The sentinel role capabilities receive held
PowerShell/system runtime plus the exact held target launcher read/execute,
target-directory traverse only, and sentinel-scratch write only during the
tool smoke; it receives no core/other-target read or target write. Toolchain/
LLVM/user tool caches on the controlled host (`.rustup`, `.cargo`, `.xwin`,
Rusty V8, Git, and LLVM exact held paths) receive per-run,
read/execute/traverse-only per-run role-capability ACEs through the same elevated, global,
baseline-plus-live-lease state machine when held-token `AccessCheck` shows
pre-existing access is absent. Journal exact object identities/SDDL, add no
write/delete/ACL/owner rights, reconcile concurrent leases, and restore only at
the same run after Job drain. Windows/System32 and other OS
roots are never modified and must already grant effective read/execute.
The shared PowerShell installation is likewise never ACL-mutated and must
already grant the exact executor and sentinel per-run capability tokens
read/execute while denying write/create/delete/ACL-owner access.
Unknown security drift or inability to read/change/restore an exact required
host object is an environment prerequisite failure. Other profile paths,
credentials, ProgramData control, and authority records receive no child ACE. Unsupported
AppContainer/access behavior fails without falling back to a coordinator
token.

The operator-global protected registry, shared across every target-root choice,
is:

```text
%ProgramData%\CodexRunnableSecurity\v1\operators\<operator-sid-hash>\
  lease.lock
  baselines\<object-id>.json
  leases\<targetId>-<runTag>-executor.json
  leases\<targetId>-<runTag>-inspector.json
  leases\<targetId>-<runTag>-build.json
  leases\<targetId>-<runTag>-model.json
  leases\<targetId>-<runTag>-sentinel.json
```

The staged native supervisor creates/opens this tree handle-relatively from a
pinned no-follow ProgramData handle. Every component is Administrators-owned
with protected SYSTEM/Administrators full and no operator-SID/package/
capability ACE, no inherited write/`DELETE_CHILD`, and medium integrity. All lock/
baseline/lease opens, writes, flushes, and renames are relative to held
directory handles with volume/file identity checks. `%LOCALAPPDATA%` and every
caller-selected root are explicitly forbidden for registry authority, so a
non-elevated same-user process cannot fork the lock/state by swapping a parent.

Each lease has `prepared -> applied -> removing -> removed`. Under
`lease.lock`, before mutation, record/flush canonical object identity, exact
baseline SDDL, exact additive ACEs for one per-run role-capability SID, and all
live lease IDs.
The current descriptor must equal baseline plus exactly the registered live
leases. Apply and verify only the new ACEs, flush `applied`, then release the
lock. The native supervisor pins the worktree root and arms the source watcher
first. After Git-common/lock/accepted-closure/tool-root verification, it arms
non-overlapping recursive watchers on every shared Cargo/tool cache root before
any ACL lease. Only then, before source mutation or child process, the
coordinator creates/reconciles all per-run executor/inspector/build leases. Any watched-root
security event from that lease must match its flushed ACL journal entry;
otherwise it is source/cache drift. The
per-run executor/inspector/build/model/sentinel leases are removed after final
no-op and Job/ETW/provider-bridge drainage. Between runs the persistent target
has only protected SYSTEM/Administrators authority and no package/capability
ACE. Cleanup verifies baseline with zero live leases, deletes all five profiles,
and only then completes its receipt. Recovery removes interrupted per-run
leases in the same order but preserves the baseline target/profile set for the
next warm run. Unknown descriptor drift,
missing baseline, unregistered ACE, profile/SID mismatch, or inability to
remove an exact lease stays non-ready and never restores a stale whole
descriptor over concurrent leases.

The persistent Cargo target and all writable scratch roots use a protected,
inheritable DACL plus low mandatory label: `SYSTEM` and `Administrators` full;
exact per-run executor scratch capability modify only on executor scratch;
exact secret build target-write capability modify on target/build scratch;
exact secret model or sentinel scratch capability modify only on its own
scratch; secret model target-read capability read/execute on built binaries;
secret sentinel target-read capability traverse on the held target chain plus
read/execute on exact `codex.exe` only; and an inheritable `OWNER RIGHTS` ACE
that omits data write,
`WRITE_DAC`, and `WRITE_OWNER`, suppressing implicit creator-owner control.
No user/Users/Everyone write ACE is present. The elevated same-operator
coordinator uses the Administrators ACE; unrelated same-user low-integrity
processes lack the package SID and cannot write or retake the DACL. Seal an
existing target tree once when the stable profiles and baseline target are created,
verify every descendant inherited the exact descriptor, and rely on inheritance
for subsequent Cargo outputs; any drift fails before reuse. The model role
never receives target write access.

The child `CARGO_HOME` is a no-config/no-credentials scratch directory with
only coordinator-created, identity-pinned, read-only junction projections for
the exact canonical registry/git cache roots plus a local writable package
lock. `RUSTUP_HOME` and all profile variables point to isolated scratch;
held absolute Cargo/rustc paths avoid rustup/profile discovery. Projection
targets are held, hash/provenance checked, and covered by the ACL lease; any
write attempt or target/identity change fails. The native supervisor already
armed one recursive `ReadDirectoryChangesW` watcher per non-overlapping
canonical shared cache/tool root before lease application or projection. Any
event, overflow, root identity change, or post-drain mismatch fails the run
even if bytes are later restored. Hold root handles, snapshot root
security/identity plus the exact files identified by plan/provenance
enumeration as Cargo inputs, and use the
same overlap/drain/rescan barrier through final child exit. The local package
lock coordinates only this lane and is not treated as protection from external
cache writers. Direct TCP/UDP/DNS/WinHTTP
fixtures from hostile build scripts must receive network-denied errors while
the real locked offline build succeeds.

Authenticated model/tool smokes use the zero-network model profile plus
per-run secret credential/target/scratch capability leases. The strict nested client uses reqwest 0.12.28's
Windows named-pipe transport, not TCP, DNS, proxy, WebSocket, or a fallback
client. TLS remains end-to-end in the child over the pipe, so SNI and
certificate validation still use the canonical
`api.githubcopilot.com` origin while the coordinator sees only TLS ciphertext.
The model AppContainer has zero network capabilities; direct TCP/UDP/DNS/
WinHTTP/loopback/LAN fixtures must all fail.

The native security coordinator creates and owns a separate random
first-instance local-only provider
pipe with a DACL limited to itself and the per-run model-provider-pipe
capability SID. It separately authenticates the client token's stable exact
model package SID plus process identity. It resolves
only canonical `api.githubcopilot.com`, pins the exact address set, opens one
TCP connection per accepted pipe connection to a selected pinned address on
port 443, authenticates the pipe
client as the exact held `codex-core.exe` PID/creation/image/Job member, and
blindly copies bytes between pipe and socket. It never accepts scheme, host,
port, address, or proxy data from the child. Allow at most two sequential
authenticated pipe/TCP/TLS connections for the whole smoke (the strict capsule
independently enforces exactly one or two HTTP requests), with 4 MiB per
direction per connection including handshake overhead and the transaction
timeout. A third connection, excess bytes, client mismatch, address drift, or
native-coordinator death closes both ends and fails the smoke. Because the
bridge sees TLS ciphertext, it never infers semantic completion from transport
EOF. After strict core validates a terminal event plus all same-buffer bytes,
it sends an authenticated nonce-bound `provider-terminal-claim` with request
index, response ID, plaintext body hash/count, and terminal sequence. If the
transport is still open, the coordinator flushes `ack-close`, replies with its
hash, then closes that connection; only then may core cancel/drop the body. If
transport EOF arrived first or races before that decision, the coordinator
latches `eof-pending`, flushes a nonce-bound `EOF_PENDING` challenge, starts a
two-second deadline, and keeps the separate nonce broker alive. Core performs
exactly one bounded body read: only clean EOF with no post-terminal bytes may
produce `provider-terminal-final` binding the challenge and
`transportEof:true`. Matching final ACK before deadline converts pending EOF
to success. EOF without terminal/with partial or extra bytes yields no valid
final and fails. The
child has no alternate egress, so crash ordering is fail closed without
persistent firewall state.

Freeze pipe object security. Both nonce and provider pipes use byte mode,
`PIPE_REJECT_REMOTE_CLIENTS`, low mandatory label
`S:(ML;;NW;;;LW)`, owner/group both set to Administrators, a restrictive
`OWNER RIGHTS` ACE with no data/`WRITE_DAC`/`WRITE_OWNER` rights, and
SYSTEM/Administrators full access. The non-elevated operator SID is neither
owner nor an ACE trustee. Stable package SIDs receive no pipe data ACE. The
provider pipe grants only the per-run model-provider-pipe capability. The
nonce pipe grants narrow access to the distinct per-run model-nonce
(driver/core) and sentinel-nonce (guard) capabilities, while the broker still
requires the expected stable package SID as authenticated peer identity. The
provider pipe's capability ACE grants exactly the
`GENERIC_READ|GENERIC_WRITE|SYNCHRONIZE` access reqwest/Tokio requests, with no
`DELETE`, `WRITE_DAC`, or `WRITE_OWNER`; the nonce client uses the narrower
explicit data-read/data-write/read-control/synchronize mask. Enable and verify
the required SACL privilege before creation. For deny-all create and hold one
server instance; for exact-sentinel create and hold exactly two instances
before resuming the model root, with `nMaxInstances` equal to that count and
`FILE_FLAG_FIRST_PIPE_INSTANCE` on the first. All slots remain owned by the
coordinator, so the generic-write client cannot create an extra instance;
tests require `ERROR_PIPE_BUSY` for that attempt. Only the custom nonce client
authenticates its local pipe server through the inherited coordinator handle.
The reqwest provider connector exposes only a path, so provider-pipe trust is
instead the pre-created saturated instances plus end-to-end TLS validation of
the canonical provider; it never claims `GetNamedPipeServerProcessId`.

N-US-001 adds only the opt-in fallible named-pipe reqwest builder/selection:
`.windows_named_pipe(<sealed-pipe>)`, `.no_proxy()`, redirects/decoders disabled,
WebSocket/prewarm/fallback disabled, and no ordinary-network fallback on any
builder or pipe error. The existing normal reqwest client remains unchanged.
Locked reqwest 0.12.28, Tokio, TLS, and Windows pipe APIs already provide the
seam; add no dependency. An inherited connected socket is explicitly rejected:
it can bypass connect-time policy, gives the child a Winsock handle, and
reqwest cannot consume it without bespoke pooling.

The exact PowerShell payload uses the separate zero-capability sentinel
package and inherits neither provider-pipe nor coordinator-query handle. Its
sentinel-profile launcher guard does receive one coordinator-query handle from
the coordinator, authenticates the payload-spawn request, then strips the
handle; native coordinator alone spawns PowerShell.

Children request nonce transitions through a transaction-scoped named-pipe
broker owned by the coordinator rather than opening the nonce file. The pipe
accepts low-integrity clients but the broker uses
`GetNamedPipeClientProcessId` plus the Job/ETW ledger to require the exact
expected PID, creation time, image, parent chain, mode, and current state
before it writes/flushed the held nonce record. A build-script process cannot
impersonate the driver/core/guard even if it discovers pipe/nonce text.
The pipe name contains a random 256-bit component and is created before any
child with `FILE_FLAG_FIRST_PIPE_INSTANCE`, `PIPE_REJECT_REMOTE_CLIENTS`, and
the role-specific model/sentinel DACL described above. Each client
calls `GetNamedPipeServerProcessId` and verifies the sealed coordinator PID,
creation time, and canonical image before trusting an acknowledgement. The
coordinator retains the source handle and creates separate inheritable
`PROCESS_QUERY_LIMITED_INFORMATION`-only duplicates directly for each
coordinator-owned suspended driver, core, and sentinel-profile guard through
that process's `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. Guard excludes its
duplicate from the PowerShell payload. Their sealed first branch immediately
clears `HANDLE_FLAG_INHERIT`, validates coordinator PID/creation/image once,
derives the authenticated broker session, closes the query handle, and blocks
on a session-ready gate before normal handling. Child-process-prohibited
mitigation is active before each image starts. After each close notification,
the elevated coordinator queries that target process's handle table
(`ProcessHandleInformation`/equivalent), duplicates candidate process handles
for identity comparison, and requires zero remaining references to the
coordinator process object before opening the gate. Query loss/unsupported
enumeration or any retained self-duplicate fails the Job. Clients require the pipe
server PID to equal
`GetProcessId(handle)` and use the inherited handle for process creation time
and image verification, requiring no general lowbox process-query ACL. The
broker likewise authenticates the client. Pipe-name collision, server PID
reuse, closed/wrong-access handle, remote access, extra instance, or broker
mismatch fails closed.
Hostile same-user tests attempt `WRITE_DAC`/owner change through every pipe
handle/name and must receive access denied while authenticated client I/O
still succeeds.

Both pipe names use the AppContainer-accessible local namespace exactly:
`\\.\pipe\LOCAL\codex-runnable-<targetId>-<runTag>-<64hex>-nonce` and
`...-provider`. Components are lowercase ASCII, length-bounded, sealed in the
owner record, and rejected if they contain separators, alternate namespace,
remote prefix, or caller text. Tests prove ordinary `\\.\pipe\...` names are
rejected and the zero-capability AppContainer can open only the exact
`LOCAL`-namespace instances.
Preflight and post-run tests run hostile build scripts and smoke children that
attempt write/delete/rename/hardlink/reparse/ACL/owner changes against every
authority parent/file and forge broker transitions; every attempt must be
denied, identities/hashes/ACLs must remain exact, and no marker may appear.

The protected ProgramData owner is authoritative and pins one exact target path, worktree
root, git common directory, source root, profile, packages/bins, and creation
time plus target-parent/target volume and file identities. No target-local
marker can authorize reuse or deletion; if a non-authoritative diagnostic
marker is emitted, descendants may mutate it and any mismatch merely makes the
run non-ready. A different requested root fails until successful
owner-verified cleanup removes the ProgramData registry.

### Protected root-scoped quota reservation

The per-worktree transaction lock prevents target corruption but not two
different worktrees from simultaneously consuming the same volume. Before
each build, acquire the protected ProgramData
`volumes\<volume-id>\quota\quota.lock`, where `volume-id` binds the held NTFS
volume serial/GUID. This one lock covers every target root on that volume;
each reservation additionally stores `root-id`, which binds the held
target-root volume/file identity plus canonical path hash. Treat stale entries
conservatively using the two-pass protocol below, then:

- calculate free bytes minus other live logical reservations;
- require/reserve 20 GiB for a new target or 8 GiB for a warm target;
- atomically write/flush schema `codex-runnable-quota/v1` with a random
  256-bit `reservationGeneration`, monotonic `recordSequence`, state,
  volume/root/target/repository IDs, random 256-bit `ownerGeneration` plus
  owner digest, transaction ID, PID/creation time, reserved bytes, the
  validated ProgramData-relative target-control/`transaction.lock` locator,
  and that lock's held volume/file identity. `ownerGeneration` is created in
  and must equal the authoritative owner record; transaction ID is the lock
  generation. No unnamed generic generation field exists;
- release the quota lock while the build runs;
- reacquire it to finalize the live reservation into a generation-keyed
  retained removed receipt after finalization.

The canonical v1 JSON types are frozen: `schema`/state/relative locator are
UTF-8 strings; all IDs/digests/generations are fixed lowercase hex;
`recordSequence`, reserved bytes, volume serial, PID, process-creation FILETIME,
and lock file-ID components are bounded unsigned integers; the relative
locator is normalized segments with no root/`.`/`..`. Live and receipt states
are deliberately separate:

```text
live\<targetId>.json: prepared -> reserved -> releasing
receipts\<targetId>\<reservationGeneration>.json: removed
```

Under volume lock, admission writes create-new `prepared` sequence 1 with the
full reservation and flushes file+parent, then atomically rewrites/flushed
`reserved` sequence 2 before releasing the lock. Both `prepared` and
`reserved` count their full bytes. Normal release or stale pruning rewrites/
flushes live state `releasing` sequence 3, then create-new writes/flushed the
generation-keyed receipt with state `removed`, sequence 4, final live-record
hash, and removal proof. Only after that receipt and parent are durable does it
delete the exact live file by handle and flush the live parent. Valid removed
receipts count zero and remain until evidence retention expires; their unique
generation path never blocks a later create-new live target record. A crash
leaving both receipt and matching releasing live record is recovered by
deleting only that exact live record; receipt-only is idempotent success.
After live deletion, atomically update the authoritative owner record with
`lastReservationGeneration` and the removed-receipt hash; cleanup uses that
binding rather than assuming a live reservation still exists.
Every rewrite uses temp+flush+same-parent rename+parent flush and increments
exactly one sequence. Unknown, skipped, duplicate, malformed, or regressed live
state/sequence, or a malformed/mismatched receipt for that live generation, is
conservative live usage and blocks admission. Crash fixtures cover before/
after every live/receipt flush/rename/delete; recovery may advance only the
recorded next edge after the same owner/transaction/lock/PID proof.

An interrupted transaction leaves a conservative reservation. Recovery or
owner-verified cleanup reclaims it under the volume lock. Reservations coordinate
admission only; they do not preallocate or delete disk. Distinct worktrees may
still build concurrently when aggregate free space satisfies their live
reservations.

Create/open the quota registry relative to the same held no-follow ProgramData
authority root as transaction state, with admin-only protected DACL and no
operator/package/capability ACE. Independently hold/pin the target-root and
volume identities used in its key, reject reparses, and write/flush/rename
reservation records only through relative ProgramData handles. Never place an
authoritative quota file below caller-selected targetRoot. ProgramData
registry or root/volume identity drift fails admission and cleanup.

Lock order is fixed and every acquisition is nonblocking:

1. acquire/hold only this target's transaction lock as the outer lock;
2. acquire the volume quota lock briefly to snapshot/count or add/remove this
   reservation, then release it before any operator lease operation;
3. acquire the operator-global `lease.lock` briefly to reconcile/apply/remove
   ACL leases, then release it before reacquiring quota.

No two global locks may overlap, no code acquires any transaction lock while
holding quota/lease lock, and all busy locks fail immediately with no wait or
steal. Stale-reservation pruning is two-pass: snapshot the complete canonical
record bytes/hash, `reservationGeneration`, `recordSequence`,
`ownerGeneration`/digest, transaction ID, lock identity, repository/root/
volume/target IDs, PID/creation, bytes, and state under volume lock; release it;
probe the candidate's foreign
transaction lock with an immediate `FileShare.None` open and verify recorded
PID/creation death. Resolve the foreign lock only beneath the held ProgramData
authority root from the recorded relative locator; require repository/owner/
lock identity and transaction/owner generations to match before/after the probe, never accept an
absolute/caller path. Close the probe; reacquire volume lock and prune only if
every recorded field, canonical hash, and generation/sequence are unchanged.
Holding the caller's own
transaction during that nonblocking foreign probe is allowed; two mutual
probes both fail busy rather than deadlock. Barriered tests cover two roots on
one volume, two volumes sharing one operator lease registry, simultaneous
admission/cleanup, crashes at every release boundary, and prove no nested
global lock or over-admission.

## 7. Concurrency and Interruption Safety

Extend `measure-build.ps1`; do not create a second executor.

Before PowerShell creation or target/source mutation, the native supervisor
opens `transaction.lock` with an exclusive OS-backed handle (`FileShare.None`)
and holds it through:

- owner validation;
- pessimistic manifest write;
- metadata and build;
- binary hashing and all smokes;
- compact/raw evidence copy;
- probe restoration and reconciliation;
- final no-op and manifest finalization.

Concurrent use fails immediately. It does not wait, steal a lock, or kill a
process.

The protected native supervisor pins the explicit wrapper worktree root and arms
its recursive `ReadDirectoryChangesW` watcher before invoking Git,
reading HEAD/index/diff, enumerating untracked content, or parsing/executing any
worktree byte. It opens/locks the watched `.git` indirection/`commondir`
metadata and pins Git-common no-follow; when Git-common is external, it arms a
second non-overlapping recursive watcher there before any further Git-admin
read or Git invocation. When Git-common is inside the worktree, the first
watcher covers it. It then pins the trusted Git executable/config boundary,
resolves the accepted commit/Git-common identity, verifies the executable
closure, and performs the initial wrapper/patched-source HEAD, index-diff,
worktree-diff, and untracked path/content snapshot under the active watcher.
The watcher already covers the nested patched-source root, so no overlapping
watcher is allowed. The same native supervisor continues as the security
coordinator with those held handles, snapshot, watcher, monotonic sequence, and
pessimistic manifest; no child adopts, inherits, reopens, or replaces them.
Normalize each event to a canonical relative path. The only allowed
source-tree events are the exact journaled probe temporary/backup/conflict/
source transitions. Any other path event, watcher overflow, provenance
mismatch, bootstrap-closure handle/hash drift, or early watcher termination
sets `source-drift`, preserves evidence, and prevents `ready`. At every
Cargo/smoke boundary, the current snapshot must equal the baseline plus the one
journal-described probe state; after restoration it must equal the baseline
exactly. Boundaries and `ready` use the same double-buffered
overlap/drain/rescan barrier as Cargo-config watchers so no queued event can be
accepted after publication.

ProgramData authority/evidence is outside source content and never needs a
watcher exclusion. Git-common remains a watched/pinned repository input; both
watcher domains share one monotonic sequence and overlap/drain/rescan barrier.
An
optional locator/receipt there is non-authoritative and may be written only as
an exact journaled coordinator operation. Any other `.git` event is
source/control drift. Authority integrity remains covered by ProgramData
parent handles, protected DACLs, hashes, and transaction lock even if a user
with `DELETE_CHILD` on Git-common deletes or replaces that locator.

After validating or creating the target, hold no-follow directory handles for
the target root and exact target with delete sharing denied through Cargo,
hashing, and all smokes. Persist and revalidate their volume/file identities
before and after Cargo. This prevents either path from being renamed or
replaced with a junction during the transaction.

Before any root `CreateProcess`, the native supervisor pre-arms a private real-time
`Microsoft-Windows-Kernel-Process` ETW session, creates the kill-on-close
transaction and per-root Job Objects, and associates both jobs with an I/O
completion port. PowerShell sends a typed spawn request over coordinator IPC;
only then may the native supervisor create a Cargo/smoke root with
`STARTUPINFOEX` plus `PROC_THREAD_ATTRIBUTE_JOB_LIST`, so the process belongs
atomically to both the transaction job and a fresh per-root child job at
creation; it is also created suspended. After
creation, flush the root ledger entry and only then resume its primary thread.
There is no create-to-assign gap. Job inheritance covers
rustc/linker/launcher/core descendants. Closing or killing the native supervisor terminates only that captured process
tree. PowerShell never owns or duplicates Job/ETW handles.

ETW ownership is crash-journaled. Before `StartTrace`, flush
`etw-starting` with unique exact session name
`CodexRunnable-<targetId>-<runTag>`, a generated session GUID, provider GUID/
keywords/level, coordinator PID/creation time, and real-time/no-file mode.
After successful enable/consumer attach, flush `etw-running`. Normal closeout
drains the consumer, reconciles all Job events, calls `ControlTrace(...STOP)`
for that exact name/GUID, verifies it is gone, and flushes `etw-stopped`
before `ready`.

Recovery authenticates only the exact journaled name/GUID/properties; it
queries and stops that session idempotently, never prefix-matches or touches an
unjournaled/unrelated session. A crash after `StartTrace` but before
`etw-running`, any stale exact session, consumer loss, or inability to prove a
complete final drain makes the run non-ready, stops the authenticated session,
invalidates the target, and requires the existing complete recovery rebuild.
Name collision without matching journal identity fails closed. Fixtures cover
crash before/after start, before/after `etw-running`, during each root, after
final drain before stop, after stop before journal flush, idempotent recovery,
and an unrelated similarly named session that must remain untouched.

After each nominal root exit, query the per-root job until
`ActiveProcesses == 0` within a bounded 30-second drain, record every observed
PID/creation/image/exit, and only then close the child job and continue. A
non-draining tree is terminated through that child job and makes the
transaction non-ready. Readiness additionally requires the transaction job to
report zero active processes after the final smoke/no-op root. No successful
root may leave descendants to be killed only by coordinator shutdown.

Persist every Job `NEW_PROCESS`/exit notification
and correlate it with ETW process-start/stop events by PID, creation timestamp,
and parent chain. Retain query handles when possible, but ETW is the durable
image source for children that exit before `OpenProcess`. Record only canonical
image identity and timing, never command lines/environment. Lost ETW events,
unmatched Job PIDs, or unavailable trace capability fail before `ready`. Final
drain reconciles ETW, completion-port starts/exits, live Job membership, and the
ledger so short-lived descendants cannot evade the image allowlist.

Before Cargo, reject a running process whose canonical image path is the exact
target `codex.exe` or `codex-core.exe`. Record PID, creation time, and image
path. Ignore same-named binaries at other paths and never kill by process name.

Atomically write and flush `latest.json` as `state:"building"` before a probe
journal, source edit, Cargo, or target mutation. Success can transition to
`ready`; failures remain non-ready:

```text
build-failed
smoke-failed
budget-failed
source-drift
interrupted
reconciliation-required
```

Only an owner-matching `ready` manifest can be reported as runnable.

`latest.json` and a matching `transaction.json` record transaction ID,
operation, coordinator PID/creation time/command line, and a process ledger.
Each Cargo or smoke root is created suspended; before resume, append and flush
its role, PID, creation time, canonical image path, and Job Object assignment.
Update exit state after completion. Descendant snapshots from the Job Object
are appended when available.

State transitions:

| Observed state under acquired lock | Action |
|---|---|
| no manifest / completed non-ready | start a new full transaction |
| `ready` with matching owner/hashes | build may rerun; never skip requested work |
| stale `building` | atomically classify `interrupted`, fail, require explicit recovery |
| `interrupted` | fail unless `--recover-interrupted` |
| `reconciliation-required` or active journal | fail unless `--recover-interrupted` |
| `budget-failed` with no journal | rerun a complete requested transaction |
| `source-drift` without active journal | fail unless `--recover-source-drift --ack-source-sha256 <hash>` |

Because the exclusive lock is available, a stale `building` coordinator no
longer owns the transaction. Recovery still verifies every flushed process
ledger entry before touching source or target state.

### Durable probe recovery

Reuse the predecessor's byte-safe `ProbeSpec` application and restoration.
Before applying a controlled probe, write and flush `probe-recovery.json` with:

- canonical path, parent-directory identity, and observed file identity;
- original bytes/hash, edited hash, timestamp, and attributes;
- owner/target/run IDs;
- unique same-directory replacement, displaced-backup, and conflict-copy names,
  with expected hashes and `prepared` state, before any of those files exist.

Probe apply and restore become crash-atomic extensions of the predecessor:

1. verify the exact current hash and no-reparse parent/path through a
   no-write/no-delete handle;
2. write complete replacement bytes to a unique same-directory temporary using
   write-through mode and `Flush(true)`;
3. close the validation handle and use `ReplaceFileW` with the journaled backup
   path so the displaced destination bytes are preserved atomically;
4. immediately reopen the destination no-write/no-delete, verify the complete
   expected hash, and verify that the displaced backup is exactly the
   pre-replace expected hash;
5. treat the backup hash as the compare-and-swap check:
   - unexpected displaced backup with the owned expected destination is a
     pre-replace race; archive the owned destination, atomically restore the
     displaced concurrent bytes to the canonical path, and fail;
   - expected displaced backup with an unexpected current destination is a
     post-replace race; leave the concurrent current bytes at the canonical
     path, preserve the displaced and owned versions separately, and fail;
   - any other combination is ambiguous; leave current canonical bytes in
     place, preserve every known version, and fail;
   all three set `reconciliation-required`;
6. update and flush journal state plus replacement/backup identities.

A hard kill therefore leaves complete original or complete edited bytes, never
an in-place partial write, and never silently discards a concurrent edit.
Recovery classifies all journaled destination/temp/backup combinations:
pre-replace temporaries with their expected hash are removed; a completed
replace is accepted only when destination and displaced-backup hashes form the
expected original/edited pair; an unexpected displaced/current hash is
classified with the pre/post-race rules above and concurrent canonical bytes
are never displaced by owned recovery; unknown files are never deleted. File identity
may legitimately change across atomic replacement, so recovery trusts the
pinned parent identity, no-reparse path, exact hash pair, and preserved
displaced bytes rather than requiring the old file ID. Restoration uses the
same replace-with-backup compare-and-swap pattern, then restores timestamp,
attributes, and Git state. Keep the journal and all unresolved conflict copies
until restored-source reconciliation, final no-op, and evidence finalization
succeed.

`--recover-interrupted` acquires the same lock and:

1. verifies recorded transaction processes are gone using PID, creation time,
   and image path;
2. restores journaled bytes only when the pinned parent identity and
   no-reparse path still hold and current content is the exact edited or
   original hash; a changed file ID is accepted after atomic replacement;
3. preserves and fails on third-party bytes, parent-identity drift, or reparse
   drift;
4. archives the non-ready manifest;
5. invalidates stale target artifacts through the same private
   handle-relative, reparse-safe, crash-journaled deletion state machine used
   by cleanup, while retaining the probe journal and recovery operation;
6. reruns the complete canonical build, exact version plus authenticated
   no-tool/tool smokes, restored-source reconciliation, and a final
   zero-rebuild no-op.

Recovery never blesses prior binaries. The exceptional cold rebuild has no SLO.
Recovery-specific crash/path-swap fixtures cover every invalidation state.

`--recover-source-drift` is the executable acknowledgement path for watcher
events or overflow with no active probe journal. Under the same lock it:

1. verifies recorded processes are gone and archives the drift manifest plus
   watcher/ETW/provenance evidence outside target/worktree;
2. computes the complete source/config provenance snapshot, drains continuously
   armed watchers, waits the existing stabilization interval, recomputes it,
   and requires byte-identical snapshots with no events/overflow;
3. prints that canonical provenance SHA-256 during plan inspection and requires
   `--ack-source-sha256` to match it exactly during recovery;
4. invalidates the entire owned target through the same cleanup journal,
   preserving the archived drift evidence;
5. starts a new complete canonical build, all smokes, restored-source
   reconciliation, and no-op stabilization. This is an exceptional full/cold
   rebuild with no cold SLO.

The acknowledgement never blesses prior artifacts or suppresses an event.
Any new event, overflow, hash change, journal, owner mismatch, or failed
invalidation leaves `source-drift` non-ready and requires a fresh inspected
hash. Fixtures cover concurrent edits before/after acknowledgement, overflow,
stable exact acknowledgement, stale/wrong acknowledgement, archive failure,
and interruption during invalidation/full rebuild.

If restored-source reconciliation fails, leave the target non-ready and retain
the journal. Do not invoke public cleanup while a journal exists. The next
explicit recovery performs the owner-verified invalidation and full rerun. This
keeps cleanup and recovery idempotent and avoids deleting audit state midway
through a failed restoration transaction.

### Cleanup

`runnable --cleanup`:

- acquires the same exclusive lock;
- requires the authoritative ProgramData owner manifest and matching persisted
  target-parent/target volume/file identities;
- refuses an active journal or non-recovered interrupted transaction;
- rejects live recorded or exact-target processes;
- records one quota branch in `cleanup-prepared`: `already-released` requires
  no live record plus the owner-bound exact generation-keyed removed receipt/
  hash; `live-generation` requires the one matching live record and no
  conflicting receipt. Missing/mismatched/different-generation combinations
  fail before target rename;
- archives the latest compact manifest;
- re-walks every target path component immediately before deletion and rejects
  any reparse point;
- verifies the target directory's persisted Windows volume serial/file ID;
- atomically renames the target within the same parent to a unique cleanup
  tombstone, then reopens the tombstone without following reparse points and
  re-verifies identity;
- invokes a private handle-relative deletion helper that opens every entry with
  parent-handle-relative `NtCreateFile` with open-reparse-point/no-follow
  semantics, rejects every unjournaled reparse entry, verifies per-entry
  volume/file identity, and deletes through handle disposition APIs rather than
  path-based recursive deletion;
- deletes only that verified tombstone;
- removes the owner registry only after deletion succeeds;
- retains protected ProgramData evidence for the retention window.

The private deletion implementation lives in the native supervisor.
`scripts/remove-owned-runnable-target.ps1` is only the typed
`measure-build.ps1` IPC adapter and deterministic fixture surface; it never
holds deletion/authority handles. After owner checks, the native supervisor keeps the verified
tombstone-parent handle open, enumerates each child with
`GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` or equivalent
handle-based directory query to capture its name, attributes, reparse tag, and
file ID, then opens that name relative to the same parent handle with
`NtCreateFile`
(`RootDirectory=<held parent>`, `FILE_OPEN_REPARSE_POINT`,
`FILE_OPEN_FOR_BACKUP_INTENT`, no-follow semantics), queries attributes and
volume/file identity from the returned handle, and requires the enumerated and
opened identity/attribute tuple to match. It recursively opens directories the
same way and removes entries only by
`SetFileInformationByHandle(FileDispositionInfoEx)` with POSIX/delete flags
after children are gone. It never reopens a fully qualified child path for
deletion. Unsupported NT/handle-disposition behavior fails cleanup without
falling back to `Remove-Item`, `Directory.Delete`, or another path-recursive
API.

The only allowed cleanup reparse entries are the coordinator-created Cargo-home
cache projection junctions recorded in that scratch journal. Before recursion,
open each projection itself no-follow, require exact
`IO_REPARSE_TAG_MOUNT_POINT`, stored print/substitute names, held target
volume/file identity, parent/name, and lease ID, then delete only the junction
object by handle without traversing it. Remove all journaled projections first;
the remaining recursive walk rejects every reparse. Target cleanup receives no
projection allowlist. Unknown/missing/swapped projections fail closed and
preserve the scratch for recovery.

It never deletes a canonical/release target, installed binary, shared sccache
directory, arbitrary caller path, or another worktree's target.

Cleanup is itself journaled in `transaction.json`. Before rename, atomically
write/flush `cleanup-prepared` with original path/identity and the unique
tombstone path. After rename, atomically write/flush `cleanup-renamed` before
deletion. Re-running `--cleanup` under both locks:

- resumes deletion only when the tombstone identity matches;
- retries the rename only when the original identity still matches and no
  tombstone exists;
- treats both paths absent as successful prior deletion only when the flushed
  state is `cleanup-renamed` with the matching owner/tombstone identity;
- fails closed when both paths exist, when both are absent from
  `cleanup-prepared`, when neither path matches, or when any reparse entry
  appears.

After verified deletion (or verified post-delete resume), write and flush a
terminal `cleanup-complete` receipt in protected ProgramData control state containing the
owner/target/tombstone/reservation identities and their expected absence.
For `already-released`, reverify no live record and the exact owner-bound
removed receipt; do not create or transition quota state. For
`live-generation`, advance that exact live record to `releasing`, create/flush
its generation-keyed removed receipt, delete/flush the live record, and update
the owner binding. Update/flush the cleanup receipt, then remove
the owner registry while retaining the receipt for the evidence-retention
window. Re-running cleanup treats a matching terminal receipt plus absent
target/live reservation and owner registry as idempotent
success; partial absence must match the recorded next transition before cleanup
continues. Injected-crash fixtures cover before rename, after rename, during
deletion, both quota branches, after live deletion, and before/after owner removal.

Normal ship closeout must finalize/copy retained evidence first, then run
owner-verified `runnable --cleanup` and verify `cleanup-complete` before the
implementation worktree is removed. The receipt is retained in ProgramData
control/evidence state outside the worktree.

For an already-missing worktree, expose a recovery-only
launcher-v1/native template:
`cleanup-orphan --recorded-worktree-root <absolute-recorded-root>
--git-common-root <absolute-git-common-root> --target-id <id>
--owner-record-sha256 <hash> --self-sha256 <bootstrap-hash>
--expected-wrapper-commit <approved-wrapper-sha>`. It never builds and is
accepted only when the pinned supplied Git-common root derives the same
protected ProgramData repository registry and matches the owner
registry, `git worktree list --porcelain` has no live registration for the
supplied recorded canonical worktree root, that root is absent, the supplied
hash matches the ProgramData owner record, no active journal/process exists, and
the owner-recorded target-parent/target
volume/file identities still match. It then uses the identical journaled
handle-relative deletion/reservation/receipt path above. The two supplied roots
are discovery/authorization inputs only and must byte-match the owner record;
no caller-supplied target path is accepted. Missing/mismatched ownership fails closed. Tests cover
normal pre-removal cleanup, stale Git worktree registration, path recreation,
wrong receipt/hash, live process, and successful orphan cleanup.

## 8. Provenance, Hashes, and Smoke Contract

Before and after each Cargo phase, require and record:

- wrapper and patched-source HEAD;
- binary index diff hash, binary worktree diff hash, and untracked path/content
  hash;
- allowed Cargo config path/hash;
- canonical roots, target ID, profile, packages/bins, argv;
- environment set/unset lists;
- Cargo/rustc/LLVM/PowerShell versions;
- target size breakdown.

Snapshots must remain baseline-plus-journal during a probe and return to the
exact baseline after restoration. In a probe run, hash/smoke the changed
binaries while source is exactly baseline-plus-journaled probe, then copy their
evidence before restoration. After restoration, reconcile with the canonical
build and run the final zero-package no-op; those restored binaries need only
the version smoke unless the selected non-probe acceptance explicitly requests
authenticated smokes. In an ordinary non-probe run, smokes follow the canonical
build directly. Any source watcher event or snapshot drift fails even if a
later hash happens to return to baseline.

After Cargo, record exact launcher/core path, size, mtime, and SHA-256. Open
the `dev-small` directory, `codex.exe`, and `codex-core.exe` with read access
and no write/delete sharing before hashing; retain those handles throughout
each launch, then re-hash through the held handles. Any change is non-ready.
Before smoke, journal the exact security descriptor and complete adjacent-file
inventory for the target-local `dev-small` directory. Through an
already-authorized handle, temporarily deny new write/create/delete/ACL-owner
opens while retaining read/execute, hold every existing adjacent file named by
the PE import/search inventory, and restore/verify that exact descriptor in
`finally` or interrupted recovery. This target-local seal is covered by the
existing target lock and journal.

Never mutate the shared real-PowerShell installation ACL. Instead require its
canonical directory/security descriptor to deny the smoke token
write/create/delete/`WRITE_DAC`/`WRITE_OWNER`, hold the executable and every
adjacent imported/search file no-write/no-delete, and fail before provider I/O
if a deterministic create/replace probe is not access-denied. A barriered
launcher/guard replacement, new adjacent DLL/helper, or DLL replacement in
either search root must be denied or fail the smoke.

Add one wrapper helper:

```text
scripts/smoke-runnable-tier.ps1
```

Derive it from the accepted brainstorm smoke driver. Every probe:

- executes exact `<target>\dev-small\codex.exe`;
- uses `<target>\dev-small` as cwd;
- requires adjacent `codex-core.exe`;
- removes `CODEX_CORE_PATH`;
- enforces a 180-second timeout;
- captures root/descendant PIDs;
- terminates only the captured exact process tree on timeout;
- verifies bounded exit and binary hashes;
- writes ignored raw stdout/stderr plus compact semantic evidence.

Mandatory after every successful build:

```text
<exact-launcher> --version
```

Require exit 0 and `^codex-cli\s+\S+$`.

Controlled acceptance additionally runs:

```text
<exact-launcher> exec \
  --ephemeral \
  --skip-git-repo-check \
  --ignore-user-config \
  --ignore-rules \
  --color never \
  --model gpt-5.6-sol \
  --json \
  "Reply exactly FAST_RUNNABLE_OK. Do not use tools."
```

Require exactly:

```text
thread.started
turn.started
item.completed:agent_message("FAST_RUNNABLE_OK")
turn.completed
```

The smoke-only exec adapter fixes `thread_id="runnable-smoke-v1"`, item IDs in
emission order, and zero-valued `Usage`; provider token counts are evidence
metadata, not JSONL acceptance. The exact no-tool UTF-8 JSONL bytes are:

```jsonl
{"type":"thread.started","thread_id":"runnable-smoke-v1"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"FAST_RUNNABLE_OK"}}
{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}
```

Then:

```text
<exact-launcher> exec \
  --ephemeral \
  --skip-git-repo-check \
  --ignore-user-config \
  --ignore-rules \
  --color never \
  --model gpt-5.6-sol \
  --json \
  "Use the shell tool to run PowerShell Write-Output FAST_TOOL_OK, then reply exactly FAST_TOOL_OK."
```

Require exactly one command execution, exit 0, output `FAST_TOOL_OK`, exact
final message, and no extra item/tool/error events. Preserve the accepted smoke
driver's displayed outer PowerShell 7 shape:

```text
pwsh.exe -Command 'Write-Output FAST_TOOL_OK'
```

The exact tool UTF-8 JSONL bytes, including CRLF in captured PowerShell output,
are:

```jsonl
{"type":"thread.started","thread_id":"runnable-smoke-v1"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"pwsh.exe -Command 'Write-Output FAST_TOOL_OK'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"pwsh.exe -Command 'Write-Output FAST_TOOL_OK'","aggregated_output":"FAST_TOOL_OK\r\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"FAST_TOOL_OK"}}
{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}
```

Deterministic exec tests construct existing typed event structs and compare
the complete newline-terminated four-line and six-line byte streams. Live
acceptance rejects different order, count, IDs, fields, command, output line
ending, status, usage, or any extra stdout JSON/non-JSON byte.

The guard validates the actual post-rewrite argv, not the displayed event:

```text
<held-target>\dev-small\codex.exe   # one-use guard role
-NoProfile
-Command
try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
Write-Output FAST_TOOL_OK
```

The final two lines are one script argument separated by `\n`. Smoke mode also
forces the source-verified top-level `allow_login_shell=false`; login-shell
requests and any
extra flag/argument/cwd fail. A deterministic end-to-end fixture runs the
guard through the same legacy-shell rewrite path and freezes the full argv
before any live model use. Do not substitute a newly nested PowerShell command
without fresh reviewed evidence.

Live model execution is forbidden until a pre-payload-spawn gate passes. Do not
rely on current execpolicy unmatched-command behavior. The fork-owned launcher
overlay accepts `CODEX_RUNNABLE_SMOKE_POLICY=deny-all|exact-sentinel` only for
the exact exec shape below and otherwise fails. In smoke driver mode it does
not append its normal forced `danger-full-access` or any `-c` override. Instead
it seals read-only permissions, `approval_policy=never`, web/remote off,
`WindowsSandboxLevel::RestrictedToken`, unified-exec off, and
`allow_login_shell=false` into the capsule contract. The private handler
addresses the same held target `codex.exe` directly in guard role; it never
copies/resolves a mutable scratch executable or a user-configured shell.

The wrapper launches by direct argument array, never a command string, and
freezes this exact logical shape (only the final prompt differs by tracked
probe spec):

```text
<target>\dev-small\codex.exe exec --ephemeral --ignore-user-config
  --ignore-rules --skip-git-repo-check --color never --json
  --model gpt-5.6-sol <exact-single-prompt-argument>
```

The early capsule validates the parsed `Cli` against this shape and the sealed
prompt hash. Extra images, cwd/add-dir, profile, OSS/provider, output-schema,
resume, approval bypass, sandbox, config override, or other CLI state fails
before provider I/O. The launcher injects the fixed read-only/
RestrictedToken policy internally rather than accepting it from the CLI.

Wrapper commit 5 lands the parser/guard functions with smoke environment
dispatch compile-time disabled; unit tests call those functions directly.
Wrapper commit 7 flips
the launcher dispatch activation constant in the same commit as
`implementationReady:true`, so no direct launcher invocation can reach smoke
mode prematurely.

The native coordinator creates the first launcher invocation as `driver`.
After validating sealed driver state, the launcher sends one authenticated
`spawn-core` request; the native coordinator creates `codex-core` with the
sealed one-use guard nonce. The driver never calls `CreateProcess`. The capsule
never enters guard role itself:

- `deny-all`: reject every argv and spawn no payload process;
- `exact-sentinel`: require the exact four-element post-rewrite vector above
  and exact sentinel-scratch cwd in core, then send one authenticated
  `spawn-guard` request. The coordinator alone creates exactly one held target
  launcher in guard role under the sentinel AppContainer token/Job, passes the
  query-only coordinator handle explicitly, and that guard consumes/validates
  role/nonce/vector before sending one authenticated `spawn-sentinel-payload`
  request. The native coordinator alone creates the held real PowerShell
  executable under the same sentinel token/Job with that vector and
  coordinator-owned capture pipes. Model-package and guard processes never
  create a sentinel payload child.

The nonce is backed by an owner-pinned create-new record under the existing
transaction control root, not by environment text alone. The record stores a
random 256-bit nonce, run/transaction ID, mode, expiry, canonical target and
guard path/file identities and hashes, expected vector/cwd hashes, and a
transaction issuer PID/creation time/image identity, and a durable state
machine:

```text
issued -> driver-claimed -> core-claimed -> consumed-no-guard
                                   \
                                    -> guard-issued -> consumed
```

The low-integrity driver/core/guard never opens or writes that record. Each
sends one transition request over the transaction-scoped coordinator broker.
The broker authenticates the pipe client PID against creation time, image,
parent chain, and Job/ETW ledger, then takes an exclusive byte-range lock on
its held, medium-integrity non-reparse record, validates all state/mode/path/
vector bindings, writes the authenticated process identity, flushes, and
advances exactly one state. Immediately before the one allowed guard spawn,
core requests `guard-issued`; the guard requests `consumed`, and the broker
flushes it before acknowledging permission to spawn the payload. Concurrent
consumers race at the broker/state lock; only the transition winner receives
success. A consumed, expired, missing, replaced, partial, unauthenticated, or
out-of-order request fails closed. Broker shutdown or pipe loss is a hard
non-ready failure, never permission to continue.

`consumed-no-guard` and `consumed` are both terminal authorization states, not
proof of a ready run. `deny-all` flushes `consumed-no-guard` and can never
issue a guard. Exact-sentinel flushes `consumed` before payload spawn; the
existing suspended-process/ledger/Job protocol then governs that spawn.
Crashes immediately before a terminal flush leave a nonterminal record and
crashes immediately after a terminal flush, before or after payload spawn,
leave a terminal record but still a non-ready run.

Core keeps its authenticated `spawn-guard` broker request open for the
coordinator-owned result. Before guard spawn the coordinator creates bounded
anonymous stdout/stderr pipes, retains only their read ends, and passes only
the write ends through the sentinel guard's explicit handle list. Guard passes
those two handles, and no provider/query/authority handle, to PowerShell. Cap
each stream at 4 KiB, each JSON payload at 16,380 bytes, and the four-byte-
prefixed frame at 16,384 bytes; overflow,
truncation, broken pipe, timeout, extra inherited handle, nonzero exit, or any
extra Job descendant fails.

The nonce record carries a separate result state
`none -> pending -> ready -> delivered` (or terminal `failed`) beside the
one-use authorization state. Flush `pending` before guard spawn. After
guard/PowerShell exit and Job drain, authenticate recorded PIDs/creation times/
images, require exit 0, stdout exactly `FAST_TOOL_OK\r\n`, and empty stderr,
then flush `ready` with hashes/counts. Return one length-prefixed canonical
result envelope. Every broker message is exactly a four-byte unsigned
little-endian payload length followed by recursively-key-sorted minified UTF-8
JSON with no newline/trailing byte, payload length `<=16380`, and total framed
length `<=16384`. `RESULT` contains
exact `type`, version, run/transaction IDs, nonce SHA-256, call ID, guard/
payload identities, exit code, standard padded Base64 stdout/stderr, byte
counts/SHA-256, and `truncated:false`. Core validates every field and sends an
exact framed `ACK` binding those IDs plus result-envelope SHA-256. The broker
validates ACK, writes/flushes `delivered` with ACK hash/time, then sends an exact
framed `DELIVERED` confirmation binding result and ACK hashes. Only after core
validates that post-flush confirmation may it construct/emit
`FunctionCallOutput`. Reject zero/oversize/partial/multiple/interleaved frames,
invalid UTF-8/JSON/Base64/hex, unknown/duplicate fields, wrong correlation,
trailing bytes, or missing confirmation. A crash/loss from `pending` onward is
non-retryable, leaves the run non-ready, and is cleaned only after Job/pipe
drainage.

Recovery always drains the transaction Job Objects and capture pipes first. It treats
unparseable/partial records as invalid, marks nonterminal records expired, and
never reopens either terminal branch. It then records final observed
state/hash, removes partial, nonterminal, `consumed-no-guard`, and `consumed`
records idempotently through the existing handle-relative cleanup path, and
leaves the run non-ready unless normal success finalization had already
completed. Evidence retains authorization/result state, result byte counts/hashes, and
nonce SHA-256, never the nonce or duplicate output bytes. Deterministic tests
cover capture overflow/broken-pipe/nonzero/extra-child/result-ack crashes plus
all prior transitions.

Story ownership is split: N-US-001 owns strict transport terminal disposition/
body hash and the one-shot clean-EOF primitive. N-US-002 defines the versioned
record schema and implements/tests every nested core/exec broker client:
startup handle attestation/ready gate, `driver-claimed -> core-claimed ->
guard-issued`, `core-claimed -> consumed-no-guard`, provider terminal claim/
EOF challenge/final, and sentinel RESULT/ACK/DELIVERED validation. Wrapper
US-NET-001 implements only the protected coordinator record/broker, issuer,
handle-table gate, provider bridge, launcher driver/guard client integration,
terminal cleanup, and launcher integration. US-005 owns end-to-end
concurrent/replay/crash/forgery activation fixtures.

The inherited policy selects a typed internal `RunnableSmokeMode` parsed
directly from the sealed environment in the first branch of
`exec::run_main`, before normal config/cloud/policy/auth/telemetry/state/
environment/thread/session construction. Unknown/incomplete values or any
non-frozen CLI option fail before dispatch. The mode is not a TOML/user option
and can only remove capability.

Smoke mode creates a provider-only request/response capsule:

- read only sealed provider/launcher-setting digest/token-input provenance, model slug, timeout,
  mode, nonce, prompt, cwd, and expected sentinel payload;
- build the minimum provider auth client, `ModelProviderInfo`, `ModelInfo`,
  `ModelClient`, prompt, response stream, cancellation, and at most one
  tool-result continuation in memory; deterministic tests inject an in-process
  fake transport/auth dependency without weakening the production provider
  allowlist, while live smoke uses only the already-held fresh cached Copilot
  token plus device/machine ID inputs; `github_token` is neither leased nor
  opened by the model package;
- deserialize a dedicated, versioned `RunnableModelInfoFixtureV1` descriptor
  for exact `gpt-5.6-sol`, then explicitly map every descriptor field into
  `ModelInfo`; freeze descriptor bytes/hash and mapping assertions, never call
  `/models`, and fail if the requested slug differs;
- use one compile-time smoke-only base-instruction string whose SHA-256 is
  frozen in tests/evidence; do not load normal/user/project instructions;
- cap provider traffic at one request for `deny-all` and two requests for
  `exact-sentinel` (initial call plus one tool-result continuation), disable
  credential refresh, set provider request/stream retries to zero, disable
  websocket/prewarm/fallback, and fail on retry, compaction,
  parallel/duplicate tool calls, or any non-whitelisted event;
- reuse one `ModelClientSession` across the two exact-sentinel requests;
  capture one unique nonempty model-generated call ID, echo that same ID in the
  `FunctionCallOutput`, and reject caller-selected, duplicate, missing, or
  changed IDs;
- require one or more `ResponseEvent::ServerModel` observations per provider
  request, deduplicate identical header/SSE observations, and require every
  distinct value to equal `gpt-5.6-sol`; absence, alias/conflict/mismatch, or a
  model change between the tool-call and continuation fails. Record only the
  deduplicated exact returned model slug;
- return a typed core transcript only; the `codex-exec` adapter owns canonical
  `thread.started`/`turn.started`/item/`turn.completed` JSONL emission through
  its existing event types, preserving the accepted four/six-event contract;
- never enter normal config layers, general auth/login bootstrap, MCP, plugin, skill, extension,
  environment manager, exec-policy, hook, telemetry, state-db/rollout,
  thread/session manager, external instruction, memory, dynamic-tool,
  worker/subagent, collaboration, compression-worker, or lifecycle paths.

Raw provider-event acceptance is frozen per request:

- the capsule selects a new opt-in `StrictResponseStreamPolicy`; normal callers
  retain the existing parser. The strict HTTP path reads response byte chunks
  through a custom incremental SSE decoder before building event strings,
  enforcing UTF-8 plus `64 KiB` line, `128 KiB` event, `256` event, and `1 MiB`
  total-body caps. Unknown event names, malformed known JSON, truncated final
  events, or cap overflow return an error before any tool action;
- SSE grammar is exact: reject a UTF-8 BOM and bare CR; accept LF or CRLF even
  when split across chunks; require each dispatched event to contain exactly
  one lowercase `event:` field and exactly one `data:` field followed by one
  blank line. Strip at most one ASCII space after the colon. Reject duplicate
  fields, multiple data lines, empty/no-colon fields, leading whitespace,
  `id:`, `retry:`, unknown fields, and `[DONE]`. Comment lines beginning `:`
  are allowed only before terminal, ignored semantically, and still count
  toward line/event/body caps. The `event` value must be visible ASCII and
  byte-equal the decoded JSON object's nonempty `type`. The `64 KiB` line cap
  excludes its terminator; the `128 KiB` event cap includes all field/comment
  bytes and delimiters from the first line through the blank line; the `1 MiB`
  cap counts every response-body byte. EOF with a partial line/event fails.
  After the terminal event's blank line, any already-buffered byte, including
  whitespace, comment, partial UTF-8, or partial next event, fails before body
  cancellation. Fixtures split every token, CRLF pair, UTF-8 sequence, and
  blank delimiter across chunk boundaries and cover every rejected field and
  post-terminal partial-byte case;
- strict transport uses a dedicated reqwest client with
  `redirect::Policy::none()`, accepts only the trusted HTTPS Copilot origin,
  rejects every 3xx, and never follows a redirect; request-count assertions
  include redirects;
- production requests target exactly
  `https://api.githubcopilot.com/responses`: scheme `https`, lowercase host
  `api.githubcopilot.com`, implicit default port 443, path `/responses`, and no
  userinfo, query, fragment, trailing slash, or alternate percent-encoding.
  Build this URL from the already-trusted exact Copilot base only through an
  explicit path assignment, not general URL join. The injected test transport
  may replace only scheme/authority under `cfg(test)`; it must still observe
  exact path `/responses` with no query/userinfo/fragment. Production-builder
  tests assert the final parsed URL before send;
- accept only HTTP `200` with exactly one `Content-Type` whose parsed media
  type is `text/event-stream` and whose only permitted parameter is
  case-insensitive `charset=utf-8`. Missing/duplicate/wrong content type,
  `204`, every non-success, and any response `Content-Encoding` fail before
  SSE parsing or tool action. For non-200 responses retain at most `16 KiB`
  only to classify the status but read one additional byte to distinguish an
  exact-limit body from overflow; cancel/drop after that probe, never retain
  body text, and report `http-status` or `http-error-body-overflow`; fixtures cover
  `401`, `403`, `429`, `500`, `503`, wrong/missing media type, and oversized
  chunked error bodies at exactly `16 KiB` and `16 KiB + 1`;
- the strict decoder validates raw response identity before mapping:
  `response.created` must be first with one nonempty response ID,
  `response.completed` must be terminal with the same ID, and duplicates,
  mismatch, completion-before-created, or items outside that interval fail;

- exactly one `Created` and one terminal `Completed` with nonempty response ID;
- one or more `ServerModel` observations, deduplicated as specified above;
- zero or more `RateLimits`/`ModelsEtag` observations, counted but not used;
- zero or more identical `ServerReasoningIncluded` values; conflicting values
  fail;
- `ModelVerifications` must be absent/empty; nonempty verification fails;
- `TurnModerationMetadata` may be present and is counted but cannot alter
  prompt/tool/output acceptance;
- `OutputItemDone` is authoritative. `OutputItemAdded` is advisory and must
  reconcile to a later done item. Text/tool/reasoning deltas and reasoning-part
  events are bounded to 64 KiB total per request, never acted on, and must
  reconcile to the authoritative done item/call ID/arguments;
- each authoritative completed `ResponseItem` must serialize to `<=8192`
  UTF-8 bytes, request-one completed items total `<=32768` bytes, and complete
  request-two `Prompt.input` `<=65536` bytes. Reject oversize reasoning/tool
  context before sentinel execution; metadata truncation is not treated as
  enforcement;
- no-tool request: optional completed reasoning items plus exactly one final
  agent message `FAST_RUNNABLE_OK`, with no function/custom/local-shell/other
  item;
- tool request one: optional completed reasoning items plus exactly one
  matching `FunctionCall`, with no agent/custom/local-shell/other item;
- tool request two: original user input plus every authoritative completed item
  from request one in original order plus
  `FunctionCallOutputPayload { body: Text("FAST_TOOL_OK"), success: Some(true) }`
  with the captured call ID and `metadata=None`. Its wire `output` is the plain
  string `"FAST_TOOL_OK"`, never content items. Optional completed reasoning
  items plus exactly one final agent message `FAST_TOOL_OK`, with no further
  tool call;
- any duplicate authoritative item, extra terminal, overflow, non-whitelisted
  item, or transport retry fails.

The strict path must capture one nonempty `x-codex-turn-state` from request one
into the same `ModelClientSession`: `1..1024` bytes, `HeaderValue::to_str()`
valid, and every byte visible ASCII `0x21..0x7e`. Replay it byte-for-byte on
request two; missing, oversized/invalid, duplicate-conflicting, or changed
state fails. For terminal handling,
the decoder drains and validates every complete event already present in the
same received chunk/buffer as `Completed`; an extra same-buffer event fails.
When `Completed` is the last buffered event, send
`provider-terminal-claim`. On `ack-close`, validate its hash then cancel/drop.
On `EOF_PENDING`, perform exactly one bounded read and require clean EOF before
sending the challenge-bound final; no second claim/final or ordering switch is
accepted. EOF alone is never semantic proof. Tests cover claim-before-EOF,
EOF-before-claim, EOF-between-claim-and-response, valid final, pre-terminal/
partial EOF, deadline expiry, duplicate/out-of-order/lost/replayed challenges
or ACKs, a server that remains pending after terminal, and a same-chunk extra
event.

Tests freeze the exact serialized second-request `Prompt.input` and assert the
returned `FunctionCall` and echoed `FunctionCallOutput` share the captured ID.

The strict capsule bypasses the normal Responses request builder and freezes
the complete outbound envelope:

| Field | Request 1 | Tool continuation |
|---|---|---|
| `model` | `gpt-5.6-sol` | same |
| `instructions` | exact hashed smoke-only base string | same |
| `input` | exact single user message | original + authoritative done items + exact output above |
| `tools` | `[]` for deny-all; exact one-schema array for exact-sentinel | `[]` |
| `tool_choice` | `none` or `required`, matching mode | `none` |
| `parallel_tool_calls` | `false` | `false` |
| `reasoning` | `null` | `null` |
| `store` / `stream` | `false` / `true` | same |
| `include` | `[]` | `[]` |
| `service_tier` / `prompt_cache_key` / `text` / `client_metadata` | `None`, therefore omitted by current serde attributes | same |

The exact one-element `tools` array is:

```json
[{"description":"Run the fixed PowerShell sentinel.","name":"shell","parameters":{"additionalProperties":false,"properties":{"command":{"enum":["Write-Output FAST_TOOL_OK"],"type":"string"}},"required":["command"],"type":"object"},"strict":true,"type":"function"}]
```

Before wire transmission, convert the typed request to JSON and recursively
sort every object key lexicographically, including `serde_json::Value` tool
schemas and any nested reasoning content. Serialize that canonical value as
minified UTF-8 with no newline. This removes `serde_json` map-order drift when
workspace feature unification changes. The exact request-one bytes are:

```json
{"include":[],"input":[{"content":[{"text":"Reply exactly FAST_RUNNABLE_OK. Do not use tools.","type":"input_text"}],"role":"user","type":"message"}],"instructions":"You are a deterministic runnable-build smoke. Follow the single user request exactly. Use only advertised tools. Do not add commentary.","model":"gpt-5.6-sol","parallel_tool_calls":false,"reasoning":null,"store":false,"stream":true,"tool_choice":"none","tools":[]}
```

```json
{"include":[],"input":[{"content":[{"text":"Use the shell tool to run PowerShell Write-Output FAST_TOOL_OK, then reply exactly FAST_TOOL_OK.","type":"input_text"}],"role":"user","type":"message"}],"instructions":"You are a deterministic runnable-build smoke. Follow the single user request exactly. Use only advertised tools. Do not add commentary.","model":"gpt-5.6-sol","parallel_tool_calls":false,"reasoning":null,"store":false,"stream":true,"tool_choice":"required","tools":[{"description":"Run the fixed PowerShell sentinel.","name":"shell","parameters":{"additionalProperties":false,"properties":{"command":{"enum":["Write-Output FAST_TOOL_OK"],"type":"string"}},"required":["command"],"type":"object"},"strict":true,"type":"function"}]}
```

Before continuation, reject non-`None` `FunctionCall.namespace` and
`ResponseItem.metadata` on every admitted item. Preserve only bounded
provider reasoning summary/content/encrypted-content fields needed for
continuity. The fixed fixture uses call ID `call_fixture_123`, reasoning
encrypted content `fixture_reasoning`, and these exact minified request-two
bytes:

```json
{"include":[],"input":[{"content":[{"text":"Use the shell tool to run PowerShell Write-Output FAST_TOOL_OK, then reply exactly FAST_TOOL_OK.","type":"input_text"}],"role":"user","type":"message"},{"encrypted_content":"fixture_reasoning","summary":[],"type":"reasoning"},{"arguments":"{\"command\":\"Write-Output FAST_TOOL_OK\"}","call_id":"call_fixture_123","name":"shell","type":"function_call"},{"call_id":"call_fixture_123","output":"FAST_TOOL_OK","type":"function_call_output"}],"instructions":"You are a deterministic runnable-build smoke. Follow the single user request exactly. Use only advertised tools. Do not add commentary.","model":"gpt-5.6-sol","parallel_tool_calls":false,"reasoning":null,"store":false,"stream":true,"tool_choice":"none","tools":[]}
```

Tests compare literal UTF-8 bytes from the production serializer for all three
bodies in both targeted-package and workspace-feature-unified test runs and
require identical hashes. Live request two is dynamic only in accepted bounded reasoning and the
captured call ID; compact evidence records body SHA-256 and field counts only,
never prompt/reasoning/tool contents.

Before reqwest-generated `Host` and `Content-Length`, the complete
application header-name allowlist is:

```text
authorization
content-type
accept
copilot-integration-id
editor-version
editor-plugin-version
user-agent
openai-intent
x-github-api-version
x-vscode-user-agent-library-version
vscode-machineid
vscode-sessionid
x-codex-copilot-device-id
x-initiator
x-interaction-type
x-interaction-id
x-request-id
x-agent-task-id
```

Request two adds only `x-codex-turn-state`. Values are frozen as follows:

| Header | Exact value/predicate |
|---|---|
| `authorization` | sensitive nonempty `Bearer ...` from the held fresh token |
| `content-type` | `application/json` |
| `accept` | `text/event-stream` (override the header source's JSON default) |
| `copilot-integration-id` | `vscode-chat` |
| `editor-version` | `vscode/1.110.1` |
| `editor-plugin-version` | `copilot-chat/0.38.2` |
| `user-agent` | `GitHubCopilotChat/0.38.2` |
| `openai-intent` | `conversation-agent` |
| `x-github-api-version` | `2025-10-01` |
| `x-vscode-user-agent-library-version` | `electron-fetch` |
| `vscode-machineid` / `x-codex-copilot-device-id` | exact held nonempty preflight values |
| `vscode-sessionid` | one fresh UUID created by `CopilotHeaderSource` and reused exactly across both continuation requests |
| `x-initiator` / `x-interaction-type` | `user` / `conversation-user` |
| `x-interaction-id` / `x-request-id` / `x-agent-task-id` | one fresh UUID shared within a request and distinct across requests |
| `x-codex-turn-state` | absent on request one; exact validated request-one response value on request two |

Authorization stays sensitive and is never recorded. Build the production
client with redirects disabled plus reqwest gzip/brotli/deflate/zstd decoders
disabled; send no `Accept-Encoding` and reject any response
`Content-Encoding`. Reject every other application header, including trace,
beta, installation/session/thread/client metadata, cache, attestation,
subagent, timing, and compatibility headers. Tests exercise the actual
production client/header builder, then assert exact names/values and complete
JSON bodies at the server.
The authorization row is authoritative only through source-builder equality:
construct the existing public `CopilotHeaderSource` production path from the
held cached auth/device/machine inputs and one fresh stable session UUID reused
for both continuation requests. Materialize its production headers and copy
only the sensitive `Authorization` `HeaderValue` byte-for-byte into the strict
allowlist; do not call or export private `build_session_headers`. The strict
path must not add/remove a scheme prefix, suffix, or whitespace. A non-secret
fixture compares the strict value with that same public source output and
asserts the session ID is stable across both requests; tests/evidence never
print it. No `auth.rs` visibility edit is planned.

`RunnableModelInfoFixtureV1` (evidence name `capsule-model-info-v1`) is a
dedicated canonical descriptor, not `ModelInfo`'s serde representation. Its
own serde struct has no skipped fields, so explicit `null` values are stable.
Its exact minified UTF-8 JSON with no trailing newline is:

```json
{"slug":"gpt-5.6-sol","display_name":"gpt-5.6-sol","description":"Runnable smoke-only metadata","default_reasoning_level":null,"supported_reasoning_levels":[],"shell_type":"shell_command","visibility":"list","supported_in_api":true,"priority":50,"additional_speed_tiers":[],"service_tiers":[],"default_service_tier":null,"availability_nux":null,"upgrade":null,"base_instructions":"You are a deterministic runnable-build smoke. Follow the single user request exactly. Use only advertised tools. Do not add commentary.","model_messages":null,"supports_reasoning_summaries":false,"default_reasoning_summary":"auto","support_verbosity":false,"default_verbosity":null,"apply_patch_tool_type":null,"web_search_tool_type":"text","truncation_policy":{"mode":"bytes","limit":10000},"supports_parallel_tool_calls":false,"supports_image_detail_original":false,"context_window":128000,"max_context_window":128000,"auto_compact_token_limit":null,"comp_hash":null,"effective_context_window_percent":95,"experimental_supported_tools":[],"input_modalities":["text"],"supports_search_tool":false,"wire_route":"provider_default","use_responses_lite":false,"auto_review_model_override":null,"tool_mode":null,"multi_agent_version":null}
```

Its SHA-256 is
`6af1c15a47b7c52724418953e41454f6a1e217ae949b7dedea7097f9ba4792b4`;
the exact base-instruction UTF-8 SHA-256 is
`a9861031b88643b362be306241f7ea2db0b23addbe38adc462fb5732685d20de`.
Tests serialize the descriptor and compare exact bytes/hashes, map it into
`ModelInfo`, and assert every resulting field. This avoids `ModelInfo`'s
`skip_serializing_if` behavior while making field/default drift explicit. The
struct-only `used_fallback_model_metadata` field is set/asserted `false`.
Runtime recomputation uses a general
`codex_config::sha256_hex_bytes(&[u8])` export factored from
`config/src/fingerprint.rs`, which already owns the workspace `sha2`
dependency. Unit vectors cover empty/ASCII/UTF-8 bytes; the helper loads no
configuration and adds no manifest dependency.

`deny-all` sends an empty complete tool schema. `exact-sentinel` advertises one
private smoke-only function schema and handles it inside the capsule, not
normal `ShellCommandHandler` or `ToolRouter`. The handler first validates the
complete parsed tool payload: exact function name, unique nonempty captured
call ID, command text, cwd, no alternate shell, login mode, timeout override,
environment, additional
permissions, duplicate call, or extra field. It does not call
`intercept_apply_patch`, implicit-permission logic, normal exec policy, or
`ToolOrchestrator` hooks. After validation it reuses only the low-level legacy PowerShell rewrite to
freeze the expected argv, then submits the authenticated `spawn-guard` broker
request. The coordinator creates the held target launcher under the sentinel
profile; the guard consumes the nonce and requests the native coordinator to
spawn PowerShell from sentinel scratch into coordinator-owned capture pipes.
Core accepts only the broker's
authenticated exact result envelope before emitting tool output. The typed
transcript preserves the accepted displayed command; `codex-exec` renders the
six-event JSONL contract.

Complete tool-schema snapshots and end-to-end hostile-config tests cover system/
cloud/user MCP, plugins, hooks, skills, extensions, dynamic tools, external
instructions, alternate shell, and apply-patch-shaped payloads. They assert no
configured process, marker, file mutation, prompt injection, or unguarded child
occurs before/during the model turn; normal-path constructor/invocation counters
remain zero. The isolated `CODEX_HOME` and
`--ignore-rules` remain defense in depth. If the capsule cannot prove this on
the accepted source pin, stop and amend rather than run the model.

Before live model use, targeted config tests must prove the injected
`windows.sandbox="unelevated"` resolves to
`WindowsSandboxLevel::RestrictedToken`, and a deterministic restricted-token
fixture must receive access denied when writing outside its allowed scratch.
Disabled/elevated/parse-failure results fail closed; `sandbox_mode="read-only"`
alone is not treated as an active Windows sandbox.

`gpt-5.6-sol` is a required controlled-smoke prerequisite, not a floating
default. Record the exact model argument. Fail before launch if it is absent or
changed.

Each transaction creates owner-pinned smoke scratch under:

```text
<targetRoot>\.codex-runnable-scratch\<targetId>\<runTag>\
  executor-temp\
  build-temp\
  smoke\credential-capsule\
  smoke\model\codex-home\
  smoke\model\temp\
  smoke\sentinel\temp\
```

Require local NTFS, no reparses, matching target/run/transaction ownership, and
at least 1 GiB free before creation. Build children use `build-temp`.
The restricted PowerShell executor uses only `executor-temp`.
`smoke\credential-capsule` is an admin-owned protected sibling, not a child of
any model-writable directory.
The authoritative scratch owner/journal remains under protected ProgramData; no
authority file is stored in the lowbox-writable scratch tree.
Model children set `CODEX_HOME` to `smoke\model\codex-home` and `TEMP`/`TMP` to
`smoke\model\temp`. Sentinel guard/PowerShell use only
`smoke\sentinel\temp` as cwd and `TEMP`/`TMP`, and receive no model scratch
access. Do not inherit another temp root. Journal scratch
creation before smokes, cap its observed size at 1 GiB, copy only the bounded
stdout/stderr and semantic records into retained evidence, then delete scratch
through the same owner-verified handle-relative primitive as target cleanup.
Interrupted scratch is owned exclusively by `--recover-interrupted`; public
cleanup continues to refuse an active transaction/probe/scratch journal.
Public cleanup may remove terminal `scratch-cleanup-pending` state only after
the transaction is non-active and the retained scratch owner/receipt matches.
Unknown/mismatched scratch is preserved and fails closed. Scratch is never a
retained credential/cache artifact.

In smoke driver/guard mode the launcher skips its existing path-recursive
curated-cache cleanup entirely. The transaction resets owner-pinned scratch
before launch and deletes it afterward through the hardened primitive. Normal
launcher behavior is unchanged when smoke policy is absent. A real-profile
sentinel under the user's `~\.codex\.tmp` must remain byte-identical.

The smoke child environment is rebuilt from an allowlist rather than inherited:

- `SystemRoot`, `WINDIR`, `ComSpec`, `PATH`, `PATHEXT`, `TEMP`, and `TMP`;
- the isolated `CODEX_HOME`;
- the launcher's default Copilot token-root inputs described below;
- `CODEX_ENABLE_ANTHROPIC=off`;
- `RUST_LOG=error`.

The transaction injects sealed owner-manifest values, never caller values:

| Launch | Internal environment |
|---|---|
| version | `CODEX_RUNNABLE_ISOLATED_LAUNCH=1`, role `driver`, policy absent |
| no-tool exec | isolated launch, role `driver`, policy `deny-all` |
| tool exec | isolated launch, role `driver`, policy `exact-sentinel` |

All three include canonical guard path/hash, real PowerShell path/hash, exact
smoke cwd, and expected-vector hash. Exec smokes additionally include sealed
capsule version, nonce, prompt hash, exact model, timeout, coordinator-validated
launcher-setting digest, held three-file token-input identity, and the built-in
trusted Copilot provider ID/base URL; the tool smoke includes the exact
function schema/payload hash.
The initial launcher validates driver values against sealed environment plus
broker record, sends authenticated `spawn-core`, and never sets guard role or
calls `CreateProcess`. Only the
coordinator-created sentinel-profile launcher receives role `guard`; it
validates that role/nonce/vector against the broker before sending
`spawn-sentinel-payload`; native coordinator creates PowerShell. Both reject
absent, inherited, mismatched, duplicate, expired, or
unknown modes. The capsule recomputes prompt/model/tool hashes before provider
I/O; coordinator-only config provenance is not exposed to it.

Strip `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, provider/base-url overrides, and
the parent repository's `CODEX_HOME`. Fixtures must prove ambient OpenAI and
Anthropic credentials are stripped and that parent/cwd `AGENTS.md` or
`CLAUDE.md` files cannot affect the sentinel because the capsule has no
project-instruction loader.

The smoke preflight requires existing non-interactive Copilot setup:

- `~/.codex-copilot/config.toml` exists, parses with Python 3.11 `tomllib`,
  is opened with no write/delete sharing, and its parent no-reparse identity is
  held through every smoke;
- `default_shell` resolves to the exact PowerShell 7 executable used by the
  sentinel command; canonicalize/hash that executable, hold it no-write/
  no-delete through every smoke, and put only its pinned parent ahead of the
  fixed system PATH entries used by the smoke child;
- `auto_load_claude_md=false`;
- `enable_anthropic`, `enable_remote_session`, and
  `enable_remote_auto_attach` are false or absent;
- `style_user_messages` may vary because it is TUI-only, but its selected value
  is recorded;
- ambient/operator `COPILOT_API_HOME` is absent or resolves exactly to the
  default `~/.local/share/copilot-api`; any other input is rejected. After
  held-file preflight and capsule creation, the supervisor sets the model
  child's `COPILOT_API_HOME` to the sealed absolute
  `smoke\credential-capsule` path and passes its held query-only directory
  handle to the driver. Launcher selection must equal that owner-recorded
  path/identity; no profile/default/ambient fallback is allowed in the child;
- `device_id`, `machine_id`, and `copilot_token` all already exist; IDs parse,
  and the cached Copilot token parses with
  `expires_at > now + 900s`, so no creation or refresh is required;
- hold the auth parent plus only those three files with read-only/no-write/
  no-delete sharing through every smoke; any attempted write/refresh fails the
  smoke. The supervisor copies their required bytes through held handles into
  the admin-owned per-run credential capsule, and only that capsule receives
  the secret model-credential capability; the three user-owned originals
  receive no capability ACE. `github_token` is never opened or copied;
- `pwsh` resolves to PowerShell 7.

It never logs in, bootstraps, prints token contents, or records
credential-derived values. Compact evidence contains only config path/raw
SHA-256 hashed through the held handle, the redacted selected launcher values
above, exact PowerShell path/version/SHA-256, token-root path/source, and token
file existence/size for those three files plus redacted token-expiry margin. It never records token
contents or credential hashes. The smoke child explicitly sets
`CODEX_ENABLE_ANTHROPIC=off` even when the launcher setting is absent, defeating
an ambient opt-in. Unknown or noncanonical behavior-changing launcher settings
fail before launch. Missing/expired auth is a prerequisite failure, not a
build-SLO failure.

Config or PowerShell path/edit/swap attempts after preflight must be denied or
fail the smoke; fixtures barrier both replacements before launcher consumption.
Additional fixtures make the model delete/replace/write the capsule and unset/
redirect `COPILOT_API_HOME`; protected DACL/held handles deny mutation and the
launcher rejects every fallback or path/identity mismatch. After model Job/
provider drain, native code removes the credential ACE and wipes capsule files
handle-relatively before marking the scratch journal complete.

Use the already-required LLVM toolchain's `llvm-readobj --coff-imports` to
record imported DLL names plus adjacent DLL/helper inventory. Missing optional
publish helpers warn; they do not fail this narrow smoke or imply vendor
completeness.

## 9. Measurement and Evidence

Extend the predecessor's measurement shape:

- add `runnable` to `-Tier`;
- add `runnable-warm`: automatically enforce `<=600s` from Cargo/build start
  through successful exact-path version smoke; do not reuse predecessor
  Cargo-only `$wallSeconds` for this budget;
- add `runnable-noop`: automatically enforce `<=30s` Cargo wall time and zero
  rebuilt packages, while reporting version-smoke time separately;
- preserve existing CSV columns and omitted-tier `executable` compatibility;
- preserve existing probe and restoration logic;
- append message format only when the plan does not already contain one.

The JSON/CSV schema adds `cargoWallSeconds`,
`buildThroughVersionSeconds`, `budget.metric`, and `budget.enforced`. Existing
budget classes retain their predecessor opt-in behavior; runnable budget
classes are mandatory when selected.

Probe sequence:

1. acquire owner lock and write non-ready manifest;
2. snapshot provenance and Cargo config boundary;
3. write/flush recovery journal;
4. apply predecessor byte-safe private or high-fanout probe;
5. run exact build, hash pair, version smoke, and selected authenticated smokes;
6. copy changed-artifact compact/raw evidence outside the target;
7. restore exact source in the predecessor `finally`;
8. reconcile restored source through the same runnable command;
9. run final no-op and require zero packages plus `<=30s` Cargo wall time;
10. finalize evidence, remove journal, mark ready, release lock.

Warm acceptance uses these complete frozen schema-v1 probes at source pin
`587a6a8ab8948ff912b1f24a62833b277934302d`; implementation copies them
byte-for-byte into the two tracked
JSON files:

```json
{
  "schemaVersion": 1,
  "repositoryRoot": "external/repos/codex-patched",
  "files": [{
    "path": "codex-rs/core/src/session_prefix.rs",
    "expectedOriginalSha256": "f8e9500c865c4ae6a6e1b71742f9c3eaf24597062aead78e390e27313359d66c",
    "expectedEditedSha256": "22b6b7cd519ba754e69b017d6e09c4b7e1d5a05836e3f60bca81d59ab2fef054",
    "findBase64": "ICAgICAgICBOb25lID0+IGZvcm1hdCEoIi0ge2FnZW50X3JlZmVyZW5jZX0iKSw=",
    "replaceBase64": "ICAgICAgICBOb25lID0+IFsiLSAiLCBhZ2VudF9yZWZlcmVuY2VdLmNvbmNhdCgpLA=="
  }]
}
```

```json
{
  "schemaVersion": 1,
  "repositoryRoot": "external/repos/codex-patched",
  "files": [{
    "path": "codex-rs/core/src/config/mod.rs",
    "expectedOriginalSha256": "eb5bfc443624e876f5948a463f7e30f3c7133b3277d73aeb772126905a0e4a59",
    "expectedEditedSha256": "8a00abf165a1144ac9d501225896a14b76136146677016e52350de938e256c15",
    "findBase64": "ICAgIHB1YiBmbiBsZWdhY3lfc2FuZGJveF9wb2xpY3koJnNlbGYpIC0+IFNhbmRib3hQb2xpY3kgew==",
    "replaceBase64": "ICAgICNbaW5saW5lXQogICAgcHViIGZuIGxlZ2FjeV9zYW5kYm94X3BvbGljeSgmc2VsZikgLT4gU2FuZGJveFBvbGljeSB7"
  }]
}
```

The private edit changes format-to-concat. The high-fanout edit inserts
`#[inline]`; its replacement intentionally preserves the accepted working-tree
line-ending result. A path/hash/uniqueness mismatch fails before mutation and
requires plan/evidence review; do not regenerate locally.

Tracked compact evidence updates
`docs/implementation/build-perf-baseline.json` with:

- `9.030`, `68.037`, `74.036`, `92.963`, `98.635`;
- cold observed `648.476`, original target `600`, verdict `fail`,
  `coldSlo:null`;
- incremental-off `170.032`;
- incremental storage `5.184-7.286 GiB`;
- accepted measurement/smoke script hashes;
- provenance and raw-evidence manifest hashes.

Raw implementation evidence lives outside the target and disposable worktree:

```text
%ProgramData%\CodexRunnableState\v1\repositories\<repository-id>\
  <targetId>\evidence\<runTag>.*
```

Retain it until 14 days after implementation ships. Retain the accepted
brainstorm raw evidence at
`D:\codex-targets\frdbt-evidence\audit-20260716-v2` until 2026-08-15 or plan
acceptance, whichever is later.

Never commit credentials, token/cache files, environment secrets, or arbitrary
model/tool content. Only compact sentinel semantics, hashes, counts, and
provenance are tracked.

Accepted brainstorm driver identities:

```text
measurement script SHA-256
49e9dd12d5112bc374ef01755cfcf07af68be22d4d4a17e95e247091a157ac48

smoke script SHA-256
5651946f60324e494fa5053affd1ef1d63cbe4a22a5b2d05353f9ce8064137cc
```

## 10. Files, Repository Split, and Commits

Two serial implementation repositories are required.

```text
PRD A repository: C:\efforts\codexu\codex\external\repos\codex-patched
Worktree:          C:\efforts\codexu\codex\.worktrees\frdbt\external\repos\codex-patched
Branch:            ralph/codex-fast-runnable-dev-build-tier-core
Base:              587a6a8ab8948ff912b1f24a62833b277934302d

PRD B repository: C:\efforts\codexu\codex
Worktree:          C:\efforts\codexu\codex\.worktrees\frdbt
Branch:            ralph/codex-fast-runnable-dev-build-tier
Base:              2a95dd19c89fc99492d0e5a25d77cb070fe77da3
```

The nested checkout deliberately lives at its normal submodule location inside
the wrapper worktree. This is a source-verified exception to the usual
standalone submodule-worktree placement: `codex-rs/Cargo.toml` has workspace
members under `../../../../codex-rs-overlay`, so a standalone
`codex-patched\.worktrees\...` checkout is unbuildable. The co-located checkout
resolves the wrapper worktree's overlay and remains repository-isolated for the
nested commit.

Expected nested new/modified files:

**N-US-001 / strict transport commit**

1. `codex-api/Cargo.toml` (add only `sha2.workspace = true`; existing workspace
   dependency, no lockfile change)
2. `codex-api/src/sse/runnable_responses.rs` plus the narrow adjacent module
   export (strict bounded decoder/status/media/encoding policy; normal parser
   unchanged; local incremental terminal body hash)
3. `login/src/auth/default_client.rs` and `core/src/client.rs` (one fallible
   opt-in reqwest 0.12.28 Windows named-pipe client/strict response-stream
   selection with no ordinary-network fallback; normal clients/`stream`
   unchanged)
4. Adjacent strict-transport/hash tests in `codex-api` and `core`

**N-US-002 / capsule commit**

5. `exec/src/lib.rs` (first-branch sealed-mode detection and early adapter
   dispatch)
6. `exec/src/runnable_smoke.rs` (sealed environment/exact CLI validation,
   core invocation, and canonical existing-event JSONL rendering)
7. `core/src/runnable_smoke.rs` (typed provider-only request/response loop,
   complete zero/one tool schemas, private exact sentinel handler, and typed
   transcript)
8. `core/src/lib.rs` (single smoke entry/transcript export)
9. `config/src/fingerprint.rs` and `config/src/lib.rs` (export/test one
   general raw-byte SHA-256 helper using the crate's existing `sha2`
   dependency; no config loading and no manifest edit)
10. `core/src/exec.rs` (only if needed: marked visibility/refactor seam for the
   existing RestrictedToken sandbox request/execute primitive)
11. Adjacent `runnable_smoke` unit tests in `core`, `exec`, and `config`, plus
   `core/tests/suite/runnable_smoke.rs` and its explicit
   `core/tests/suite/mod.rs` registration (complete schema,
   hostile-config/process-marker, exact CLI, provider fixture, exact second
   request, tool-result, raw-event multiplicities, timeout, and
   zero-normal-constructor coverage)

Expected wrapper new files:

11. `scripts/runnable-bootstrap-v1.rs` (minimal statically linked native
    security supervisor source; staged EXE is evidence, not committed)
12. `scripts/runnable-seed-stager-v1.ps1` (small deterministically encoded
    bootstrap source; exact encoded artifact is independently reviewed and
    must keep the full cmd template `<=7900`)
13. `scripts/runnable-stager-v1.ps1` (full protected PE/closure stager source)
14. `scripts/runnable-launcher-v1.ps1` (protected per-operation launcher source)
15. `scripts/verify-core-change.cmd`
16. `scripts/verify-core-change.ps1`
17. `scripts/smoke-runnable-tier.ps1`
18. `scripts/remove-owned-runnable-target.ps1`
19. `scripts/manage-runnable-capability.ps1`
20. `scripts/manage-runnable-smoke-network.ps1`
21. `docs/implementation/build-perf-artifacts/runnable-private-probe.json`
22. `docs/implementation/build-perf-artifacts/runnable-high-probe.json`

Expected wrapper modified implementation/test files:

23. `scripts/verify-core-change.sh`
24. `scripts/verify-core-change.mjs`
25. `scripts/iteration-env.sh`
26. `scripts/measure-build.ps1`
27. `codex-rs-overlay/codex-copilot-launcher/src/config.rs`
28. `codex-rs-overlay/codex-copilot-launcher/src/main.rs`
29. `scripts/test_verify_core_change.mjs`
30. `scripts/test_measure_build.ps1`
31. `scripts/test_measure_build_real_cargo.ps1`
32. `scripts/test_iteration_env_sccache_path.sh`
33. `docs/implementation/build-perf-baseline.json`
34. `external/repos/codex-patched` (gitlink bump to PRD A tip)
35. `docs/implementation/patch-surface.md` (US-NET-001 integration:
    register N-US-001/N-US-002 §14 invariants/tests and §15 replant notes)

Expected synchronized guidance:

36. `CLAUDE.md`
37. `AGENTS.override.md`
38. `docs/implementation/build-perf.md`

Modify `.github/workflows/invariant-check.yml`, rebase/publish commands, or
other runbooks only if an implementation grep proves they enumerate the tier
list or omit an existing test invocation. Do not broaden the file set
speculatively.

Use two PRDs with ten serial stories and ten reviewable commits:

1. **PRD A / nested:** `feat(api): add bounded runnable response stream`
   - opt-in strict Responses transport/parser, exact status/media/encoding/
     redirect/body caps, complete body/header envelope assertions, fallible
     reqwest Windows named-pipe selection with no network fallback, and one
     core client method plus terminal disposition/body hash and one-shot clean-
     EOF read primitive. Mark every upstream seam and ship enforcing replant
     tests plus exact patch-registration text. Normal transport/parser behavior
     remains unchanged.
2. **PRD A / nested:** `feat(core): add isolated runnable smoke session`
   - early exec dispatch, typed provider-only request loop, zero-tool schema,
     private pre-hook exact sentinel handler, core startup handle-attestation/
     ready-gate broker requests, provider terminal claim/challenge/final
     protocol, nested RESULT/ACK/DELIVERED framing/validation, and hostile-
     config/process-marker tests. Start from the reviewed commit 1 tip (whose merge-base remains
     `587a6a8...`), never as a sibling commit from the base. Commit both nested
     stories and validate in `codex-patched` first.
3. **PRD B / wrapper:** `feat(build): add isolated runnable plan`
   - tier/platform parsing, runnable iteration mode, pinned coordinator/tool
     environment, exact argv/config boundary, target identity/ownership,
     tracked seed/full-stager/launcher sources with deterministic hash/length
     tests, CLI-to-PowerShell mapping, plan/environment tests; execution
     remains explicitly inert.
4. `feat(build): add recoverable runnable capability leases`
   - dedicated AppContainer/profile/token creation, package/capability SID
     schema, operator-global ACL lease registry, exact baseline-plus-live-lease
     reconciliation, isolated homes, and crash recovery; public execution
     remains inert.
5. `feat(build): harden runnable transaction and source recovery`
   - transaction/per-root Job Objects, process ledger/drain, source/config
     watchers, provenance barriers, replace-with-backup probe recovery, tests;
     public execution remains inert.
6. `feat(build): add owned runnable target lifecycle`
   - quota reservations, filesystem capability gate, cleanup receipt,
     handle-relative identity-matched deletion, crash/swap tests; public
     execution remains inert.
7. `feat(build): add authenticated runnable smoke boundary`
   - bump the nested gitlink to PRD A's second commit; add bounded launcher
     overlay smoke policy/CODEX_HOME cleanup seams, authenticated nonce broker,
     wrapper-side query-handle/handle-table enforcement, zero-network
     AppContainer, named-pipe/TLS provider bridge consuming the landed nested
     terminal protocol, crash recovery, and patch-surface §14/§15 registration;
     public execution remains inert.
8. `feat(build): add exact runnable smokes and evidence`
   - owner-pinned smoke scratch, exact version/no-tool/tool smokes, held inputs,
     frozen tracked probe specs, bounded JSONL/stdout/stderr, and compact/raw
     evidence plumbing; public execution remains inert.
9. `test(build): prove runnable safety and activate lane`
   - cross-cutting hostile bootstrap/tool/config/path/process/cleanup fixtures,
     real-Cargo fixtures, targeted launcher tests, then the single
     `implementationReady:true` flip.
10. `docs(build): record runnable acceptance contract`
   - compact baseline, synchronized guidance, live warm acceptance evidence.

Review-fix commits may follow. Both PRD A commits must land locally before PRD
B's smoke commit records their tip gitlink. Do not drive both repositories through one
`implement-with-ralph` invocation; run two serial implementation jobs. Parent
codexu gitlink/bookkeeping is a later lead-owned commit, not either PRD.

Any nested edit beyond N-US-001's named strict decoder/export, fallible login
named-pipe builder, core client selection, or N-US-002's named early exec
dispatch, isolated core/exec modules, core export, optional low-level exec
visibility/refactor, and enforcing tests requires a plan amendment.

The two listed `codex-rs-overlay/codex-copilot-launcher` files are the planned
fork-owned exception, source-verified against the accepted launcher:
`config.rs` currently forces `danger-full-access`, and `main.rs` currently
owns startup/spawn/temp cleanup. Limit `config.rs` to the sealed policy branch;
limit `main.rs` to driver/guard validation, query-handle handling, exact
`spawn-core`/`spawn-sentinel-payload` request construction and handle stripping
(never `CreateProcess` or nested RESULT/ACK/DELIVERED validation),
and real `~\.codex\.tmp` suppression. Mark both
changes `SANDBOX PATCH`, extend their
existing crate tests, update `docs/implementation/patch-surface.md` with
upstream replant notes, and enforce the overlay result through the existing
wrapper invariant path. They do not create a nested-repo commit or gitlink
phase by themselves.

## 11. Stories

### N-US-001 - Add the bounded runnable response stream

In `codex-patched`, add an opt-in strict Responses transport/parser and core
client method with exact production header construction, status/media/encoding
gates, no redirects/compression, bounded non-success bodies, bounded raw SSE,
response identity/order, turn-state extraction, a fallible zero-fallback
reqwest Windows named-pipe client for sealed mode, and deterministic tests.
Normal clients/parsers remain unchanged. Mark each upstream export/call seam
`SANDBOX PATCH`, enforce it with replant/normal-path tests, and hand the exact
§14 invariant/test plus §15 replant registration delta to US-NET-001, which records
it in wrapper `patch-surface.md` with the gitlink.

### N-US-002 - Add the nested isolated runnable smoke session

In `codex-patched`, add the first-branch exec dispatch, typed provider-only
request/response capsule, and private pre-hook sentinel handler. Validate mode
and exact CLI shape before normal config/service/thread/session initialization;
never enter the normal instruction/router/hook path. Freeze complete tool
schemas and hostile-config process-marker tests proving no-tool has zero tools
and exact-sentinel can reach only the launcher guard. Update the wrapper
patch-surface invariant/replant note when PRD B records the gitlink.

### US-001 - Add the explicit runnable plan and isolated target

Add the fifth explicit tier, runnable iteration mode, exact `dev-small`
launcher/core plan, strict Cargo-config boundary, short per-worktree target,
quota/MAX_PATH rules, owner schema, and non-regression tests. It does not add a
second executor.

### US-CAP-001 - Add recoverable capability and ACL leases

Add the dedicated AppContainer profile/token lifecycle, package/capability SID
schema, isolated build/smoke homes, operator-global baseline-plus-live-lease ACL
registry, exact `prepared/applied/removing/removed` recovery, and source/
security-descriptor verification. Public runnable execution remains inert.

### US-002 - Harden the runnable transaction and source recovery

Extend the measurement transaction with the worktree lock, Job Object,
pessimistic manifests, exact-path process checks, source/config watchers,
durable replace-with-backup probe journal, recovery, and restored-source
stabilization. Reuse predecessor probe application/restoration/reconciliation.

### US-003 - Add the owner-verified target lifecycle

Add the NTFS capability gate, protected ProgramData quota state keyed to held
root/volume identity, durable reservations,
owner-pinned target, crash-journaled cleanup receipt, and identity-matched
parent-relative deletion without path-recursive fallback.

### US-NET-001 - Add the authenticated smoke network boundary

Bump the nested gitlink, register both nested patch surfaces, add the bounded
launcher overlay seams, coordinator nonce broker, inherited query-only process
handle authentication, zero-network model AppContainer, fallible reqwest
named-pipe transport, and bounded coordinator-owned provider bridge. Public
runnable execution remains inert.

### US-004 - Add exact smokes and retained evidence

Add owner-pinned scratch, binary/input handles, exact version/no-tool/tool
smokes, bounded process-tree drainage, frozen probe specs, and compact/raw
evidence without claiming publish completeness.

### US-005 - Prove deterministic safety and activate the lane

Cover environment isolation, configured wrapper neutralization, target
identity, owner/lock/interruption, cleanup blast radius, timeout process trees,
hash drift, Cargo-config boundary, evidence retention, and unchanged
T1/T2/executable/T4 behavior. Enable both aligned activation gates in one commit
only after these fixtures and targeted Rust validation are green.

### US-006 - Prove warm acceptance and converge reviews

Run the real T2 gate, private/high-fanout/no-op warm acceptance, exact smokes,
source restoration, retained evidence verification, and independent code/docs
review-fix convergence. Then commit compact baseline/live evidence and update
only proven guidance surfaces with cold, sccache, and tier honesty.

N-US-001 then N-US-002 complete first in the same nested PRD. The eight wrapper
stories then remain serial because they share the verifier, measurement driver,
target lifecycle, tests, gitlink, and guidance.

## 12. Test and Validation Matrix

Deterministic coverage:

| Area | Required result |
|---|---|
| Parsing | no/unknown tier fails; runnable rejects `--confirm-slow` and exact template selection is the non-substitutable operation authorization; executable/publish behavior is unchanged |
| Platform | linux/darwin plan is side-effect-free unsupported; execution/recovery/cleanup fail pre-mutation |
| Isolation | T1/T2 do not build binaries; runnable does not publish |
| Existing tiers | targeted/workspace/executable/publish plans unchanged |
| Ambient mode | hostile inherited runnable/unknown mode cannot alter non-runnable tiers |
| Elevated bootstrap | tracked seed/full-stager/launcher sources regenerate exact reviewed hashes; only the minimal seed is inline and its complete cmd is `<=7900`; it hash-stages protected scripts that are then invoked by short `-File` templates; protected native supervisor/hash/ACL, exact per-operation templates, and accepted commit come from independent review; launcher cmd clears managed/profiler/PowerShell injection before Windows PowerShell initialization; trusted cwd/minimal environment/image-load mitigations precede child initialization; watcher arms before Git/provenance; native coordinator retains handles; accepted closure is blob-verified before repository execution; DLL hijack, operation-substitution, and edit-and-restore races fail closed |
| Supervisor image closure | first-instruction PEB verification plus pre-operation DLL notifications and Kernel-Image ETW bind every later supervisor module load to the held signed closure; pre-arm load, loss/overflow, or unmatched image terminates non-ready |
| Runnable plan | exact profile/packages/bins/locked/timings/message format |
| Environment | complete allowlist only; incremental on; sccache/wrappers off; parent unchanged |
| Tool identity | rustup/Cargo/rustc/LLVM use held absolute non-reparse files; PATH or mid-run swap fixtures cannot redirect them |
| Executable parent identity | every executable parent chain is held no-delete; barriered parent rename/replace cannot redirect `CreateProcess` |
| Build helpers | canonical PATH/ComSpec and descendant-image allowlist reject caller/temp helper shadowing |
| Coordinator identity | bash/pwsh/node/git/py/python use held absolute accepted-root files; PATH/swap fixtures fail |
| Bootstrap identity | no-profile absolute PowerShell clears interpreter/Git injection before fixed no-profile Bash; hostile startup/PATH fixtures do not run |
| .NET bootstrap | mixed-case DOTNET/COREHOST/COMPlus/COR/CORECLR profiler/startup injection is cleared before PowerShell; no marker runs |
| PowerShell modules | PSModulePath contains trusted machine roots only; hostile user autoload module does not run |
| Git config | system/global config/attributes/excludes suppressed; held local config, repository attrs/ignores, `info/attributes`, and `info/exclude` have no includes/filters/helpers; transient creation/mutation and zero-helper fixtures fail |
| Untracked provenance | ignored and non-ignored regular files are both hashed; an ignored Rust/build input cannot disappear from evidence |
| Cargo config | normalized pinned hash accepts LF/CRLF; external/drift rejected |
| Cargo config stability | held accepted config plus watched candidate parents reject transient create/edit/replace/delete |
| Target | stable per worktree, distinct across worktrees, short safe root |
| MAX_PATH | every process-visible cwd/executable/control/evidence/temp/home/guard/probe path and command block is precomputed within stated bounds before mutation |
| Filesystem capability | non-NTFS/unsupported handle-delete root fails before owner/target creation |
| Target stability | no-follow root/target handles deny rename/delete during build |
| Quota | new `<20 GiB` and warm `<8 GiB` fail without deletion |
| Quota path safety | admin-only ProgramData quota directories/locks/reservations are keyed to held volume/root identity; caller-root deletion/junction swap cannot erase or fork admission state |
| Lock ordering | own transaction is outermost; volume quota and operator lease locks never overlap; foreign transaction probes occur only outside global locks and fail immediately; barriered same-volume/different-volume admission+cleanup cannot deadlock or over-admit |
| Owner/lock | mismatch/concurrency/alternate pinned root fail closed |
| Control tree | admin-only ProgramData authority/control components are held relative/non-reparse and keyed by pinned Git-common identity; Git-common locator deletion cannot fork state |
| Job Object | hard-killed fixture leaves no assigned descendants |
| Job assignment | crash at create/ledger/resume boundaries leaves no unconfined child |
| Child drain | successful root cannot proceed until per-root and final transaction active count is zero |
| Child audit | pre-armed ETW plus Job completion events capture short-lived images; loss/unmatched PID fails |
| Manifest | interruption/non-ready state never blesses prior binaries |
| Source drift | non-probe concurrent edit or watcher overflow becomes non-ready; restored snapshot plus final zero-rebuild pass required |
| Source links | every source reparse or multi-hardlinked file is rejected; external target mutation cannot evade watches |
| Recovery | exact original/edited hash under pinned parent restores/full-reruns even after atomic-replace file-ID change; third-party drift preserved |
| Recovery invalidation | uses the same journaled handle-relative deletion primitive |
| Cleanup | deletes one owned target; rejects arbitrary/release/install paths |
| Cleanup swap | target junction/path swap, nested reparse, and barriered child-name swap between enumeration/open are rejected |
| Cleanup crash | before/after rename/delete/reservation/owner removal resumes idempotently from retained receipt |
| Coordinator privilege | every runnable mutation requires full elevation under the exact worktree/Git-common owner SID/profile; alternate credentials and non-elevated mutation fail pre-state |
| Process-object ACL | launcher/coordinator supply protected Administrators/SYSTEM process+thread descriptors at suspended creation; first-instruction verification and pre-DACL/post-gate hostile OpenProcess fixtures deny operator/lowbox query or duplicate rights |
| Authority isolation | non-elevated operator and low-integrity descendants cannot read secret capability records or mutate explicitly medium-label control/quota/evidence/owner/nonce state or forge broker transitions |
| AppContainer lifecycle | exact create/derive/token/delete APIs, stable executor/inspector/build/model/sentinel profiles/package SIDs, zero registered capabilities, per-run secret role capabilities, and between-run Admin/SYSTEM-only target are verified |
| ACL lease lifecycle | global baseline-plus-live-lease reconciliation survives concurrent runs and every `prepared/applied/removing/removed` crash without stale descriptor restore |
| Host-tool ACL | exact held rustup/Cargo/xwin/V8/Git/LLVM/Bash/Node/Python paths receive recoverable RX-only role-capability leases only when needed; OS/PowerShell roots remain unmodified/pre-accessible |
| Shared Cargo cache | read-only projections plus non-overlapping recursive watchers/ETW-observed-file snapshots reject every external event, overflow, or identity/security drift through child drain |
| Target integrity | low-label protected DACL grants only Admin/SYSTEM and exact per-run secret role capabilities, never stable package data rights; between runs no role ACE remains; creator-owner is suppressed and model target access is RX-only |
| Build capability | build profile reads only exact leased source/cache/tool roots, writes target/scratch only, and has no profile credentials or network; sentinel is separate scratch-only |
| Smoke egress | executor/inspector/build/model/sentinel profiles have zero network capability; executor/inspector additionally prohibit child creation; only authenticated core may open exact local provider pipe while coordinator alone opens pinned provider TCP/443 |
| Provider bridge | reqwest named-pipe TLS, exact client PID/image/package, one pinned destination with at most two sequential connections, byte/time caps, capsule request-count enforcement, and no network fallback fail closed on EOF/crash |
| Broker identity | first-instance local nonce/provider pipes plus inherited query-only coordinator handle mutually verify model/sentinel roles; PID reuse, denied handle, spoof/replay, extra instance, and payload handle inheritance fail |
| ETW recovery | exact journaled name/GUID is drained/stopped or recovery invalidates/full-reruns; unrelated sessions remain untouched |
| Version | exact adjacent pair, `CODEX_CORE_PATH` unset, held artifact handles deny replacement |
| Guard/DLL race | capsule requests native coordinator to create the held target launcher (no scratch copy); neither capsule nor launcher calls `CreateProcess`; target-local ACL seal restores after success/interruption, shared PowerShell ACL is never mutated and must already deny writes, and adjacent DLL/helper create/replace is denied |
| Auth response | explicit `gpt-5.6-sol`; exact four-event sentinel only |
| Server model | each request has >=1 observation; identical header/SSE values dedupe to `gpt-5.6-sol`; missing/conflict/mismatch/change fails |
| Auth isolation | pre-existing IDs/token with >900s expiry stay read-only; ambient providers/project docs cannot alter run |
| Smoke input stability | launcher config/parent and pinned pwsh handles deny post-preflight edit/swap |
| Smoke scratch | owned NTFS CODEX_HOME/TEMP is capped, crash-recoverable, and removed without touching evidence |
| Smoke pre-spawn gate | adversarial shell/apply-patch requests spawn/write zero; only exact sentinel argv is permitted |
| Smoke session capsule | typed mode and exact CLI are validated at exec entry before normal config/service/thread/session initialization; hostile MCP/plugin/hook/skill/extension/instruction config starts nothing and injects nothing |
| Smoke tool surface | no-tool advertises zero complete tool specs; tool smoke advertises only the dedicated sentinel handler under hostile config/model inputs |
| Sentinel handler | exact payload is rejected before normal shell hooks/permissions/apply-patch; only coordinator-owned model-to-sentinel cross-profile guard spawn can run from sentinel scratch |
| Sentinel result | coordinator-only bounded capture, exact LE-length/canonical-JSON RESULT→ACK→post-flush DELIVERED protocol, exit/stdout/stderr, and crash/framing tests gate FunctionCallOutput |
| Provider bounds | strict SSE caps, <=8192-byte authoritative items, <=65536-byte request-two input, and malformed/overflow fixtures fail before tool action |
| Provider identity | redirect disabled/3xx rejected; created-first/completed-last use one matching nonempty response ID |
| Sticky/terminal | 1..1024 visible-ASCII turn-state replays exactly; pending-after-terminal succeeds by cancellation, same-buffer extra event fails |
| Windows sandbox | smoke config resolves unelevated to RestrictedToken; deterministic outside-scratch write is denied before live model use |
| Launcher user state | isolated CODEX_HOME cleanup leaves real user `.codex\.tmp` sentinel unchanged |
| Tool response | exact newline-terminated one-command/six-event byte snapshot only |
| Timeout | captured tree terminated; no name-based kill |
| Probe | exact changed hashes retained; source restored |
| Atomic probe | kills during temp/write/replace leave classified journaled files and complete source bytes |
| Probe concurrency | barriered pre/post-replace races preserve concurrent canonical bytes and all owned versions, then fail closed |
| Reconcile | success then zero-package no-op; failure requires recovery |
| Evidence | cleanup/worktree removal does not remove retained raw evidence |
| Evidence collision | repeated explicit run ID fails without overwrite |
| Baseline | cold remains failed original target with `coldSlo:null` |
| Budget | warm uses build-through-version; no-op uses Cargo wall + zero packages |

Fast local commands:

```powershell
$env:CODEX_PINNED_JUST = '<absolute-just.exe>'
& 'C:\Program Files\Git\bin\bash.exe' -lc `
  'source scripts/iteration-env.sh && cd external/repos/codex-patched/codex-rs && "$CODEX_PINNED_JUST" test -p codex-api runnable_smoke && "$CODEX_PINNED_JUST" test -p codex-login runnable_named_pipe && "$CODEX_PINNED_JUST" test -p codex-config sha256_hex_bytes && "$CODEX_PINNED_JUST" test -p codex-core runnable_smoke && "$CODEX_PINNED_JUST" test -p codex-exec runnable_smoke'
& 'C:\Program Files\Git\bin\bash.exe' -lc `
  'source scripts/iteration-env.sh && cd external/repos/codex-patched/codex-rs && "$CODEX_PINNED_JUST" test -p codex-copilot-launcher'
& 'C:\Program Files\Git\bin\bash.exe' -lc `
  'source scripts/iteration-env.sh && cd external/repos/codex-patched/codex-rs && "$CODEX_PINNED_JUST" test'
& <absolute-node.exe> --test scripts/test_verify_core_change.mjs
& <absolute-pwsh.exe> -NoProfile -File scripts/test_measure_build.ps1
& <absolute-pwsh.exe> -NoProfile -File scripts/test_measure_build_real_cargo.ps1
& 'C:\Program Files\Git\bin\bash.exe' scripts/test_iteration_env_sccache_path.sh
& 'C:\Program Files\Git\bin\bash.exe' -lc `
  'source scripts/iteration-env.sh && cd external/repos/codex-patched/codex-rs && "$CODEX_PINNED_JUST" fix -p codex-api && "$CODEX_PINNED_JUST" fix -p codex-login && "$CODEX_PINNED_JUST" fix -p codex-config && "$CODEX_PINNED_JUST" fix -p codex-core && "$CODEX_PINNED_JUST" fix -p codex-exec && "$CODEX_PINNED_JUST" fix -p codex-copilot-launcher && "$CODEX_PINNED_JUST" fmt'
& <absolute-git.exe> diff --check
```

This order is intentional per `codex-rs/AGENTS.md`: run targeted tests,
including the required core integration test, then the complete `just test`
suite (operator approval is a PRD-A prerequisite), then scoped `just fix` and
`just fmt`, and do not rerun tests after fix/format. The mandatory T2 workspace
check below is the post-format compile gate. All Rust command groups source the
canonical frozen iteration environment.

Mandatory T2 gate before implementation acceptance:

```powershell
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd workspace
```

Plan inspection:

```powershell
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd targeted --package codex-core --print-plan-json
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd workspace --print-plan-json
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd runnable --print-plan-json
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd executable --print-plan-json
& 'C:\Windows\System32\cmd.exe' /D /V:OFF /C scripts\verify-core-change.cmd publish --print-plan-json
```

Live warm acceptance prerequisites:

- controlled Windows host;
- accepted predecessor/source pin;
- trusted `C:\Program Files\Git\bin\bash.exe` entry;
- PowerShell 7 plus identity-pinned rustup/LLVM/xwin/V8/Cargo/rustc inputs;
- locked Cargo dependencies already fetched; measured builds are offline;
- safe short NTFS fixed-drive target that passes the handle-API capability
  probe and disk quota;
- permission to start the private kernel-process ETW session; no lossy fallback;
- existing non-interactive Copilot setup with device/machine IDs, a cached
  Copilot token valid for more than 900 seconds, and `gpt-5.6-sol` available;
- no competing runnable transaction for the worktree.

Warm budget runs additionally require a verified prewarm:

1. If the canonical target is absent, run one explicit population transaction
   with budget class `none`. Record it as a cold diagnostic; it is not
   acceptance and has no SLO.
2. Run canonical `runnable-noop` and require zero rebuilt packages plus
   `<=30s` Cargo wall time.
3. Only then permit `runnable-warm` private/high-fanout acceptance against that
   owner-matching target.

The warm preflight records the prewarm/no-op run IDs and rejects a missing,
different-owner, non-ready, or unverified target. A warm budget miss writes
`budget-failed`; it never rewrites the cold limitation or becomes `ready`.

Select the independently reviewed exact native subcommand template for each row
below and substitute only `WorktreeRoot`, optional `TargetRoot`, and optional
`RunId`. Template selection itself authorizes that exact operation and also
fixes staged supervisor hash/path and accepted wrapper
commit:

| Run | Native subcommand | Scenario | Probe spec | Budget |
|---|---|---|---|---|
| absent-target diagnostic | `populate` | `runnable-populate` | empty | `none` |
| mandatory qualification | `prewarm-noop` | `runnable-prewarm-noop` | empty | `runnable-noop` |
| private edit acceptance | `private-warm` | `runnable-private-core-edit` | frozen private probe | `runnable-warm` |
| high-fanout acceptance | `high-warm` | `runnable-high-fanout-edit` | frozen high probe | `runnable-warm` |
| post-reconcile no-op | `post-noop` | `runnable-post-reconcile-noop` | empty | `runnable-noop` |

No worktree command generates these templates or their fields. The operator
chooses the visibly named row/template; the bootstrap rejects any additional,
missing, cross-operation, or schema-invalid field.

Acceptance examples intentionally omit `--run-id`; Node generates unique
UTC/nonce IDs. An explicit run ID is allowed only when an atomic create-new
evidence reservation succeeds. Existing raw or compact artifacts are never
truncated or overwritten on collision.

Acceptance:

- private and high-fanout build-through-version each `<=600s`;
- exact changed hashes pass version/no-tool/tool smokes;
- final no-op Cargo wall time `<=30s` with zero rebuilt packages;
- exact source restoration and clean nested repository;
- valid owner/lock/provenance/raw-evidence hashes;
- no cold rerun;
- only the named N-US-001 strict transport/parser seams, N-US-002
  provider-only smoke capsule/handler seams, and two launcher overlay seams;
  no other source/release/publish/install/tag/push change.

## 13. Review-Fix Convergence

Planning review:

- independent `gpt-5.6-sol` `xhigh` reviewer;
- fix every Critical/High/Medium finding;
- repeat until clean;
- record rounds in
  `.ralph/jobs/codex-fast-runnable-dev-build-tier/plan-review.md`.

Implementation Phase 5a:

- independent `gpt-5.6-sol` `xhigh` code review over the complete nested and
  wrapper diffs, including the core smoke capsule/handler, launcher overlays,
  predecessor, brainstorm, plan, tests, gitlink, and compact evidence;
- focus on target containment, lock/Job Object behavior, cleanup blast radius,
  environment isolation, exact hashes, process-tree timeout, journal recovery,
  credentials, and unchanged tier/publish contracts;
- fix and repeat until no Critical/High/Medium findings.

Implementation Phase 5b:

- independent `gpt-5.6-sol` `xhigh` docs review over changed Markdown/JSON;
- cross-check commands, tier names, SLOs, frozen values, limitations,
  prerequisites, cleanup, and publish statements;
- fix and repeat until clean.

## 14. Dependencies and Prerequisites

Hard prerequisites:

1. Implement from accepted predecessor `2a95dd19...` or an explicitly accepted
   safety-only descendant.
2. Start PRD A from patched source
   `587a6a8ab8948ff912b1f24a62833b277934302d`; an upstream rebase requires
   probe/hash, tool-seam, and Cargo-config review before implementation.
3. Initialize nested submodules and pass:

   ```powershell
   <absolute-cargo.exe> metadata --locked --offline --no-deps --format-version 1
   ```

4. Live acceptance requires the controlled Windows build/auth/toolchain/disk
   prerequisites in section 12.
5. Reproducibly build and independently review the minimal native supervisor,
   stage its accepted bytes outside the repository under the protected
   hash-addressed ACL using reviewed stager-v1, and obtain its SHA/closure plus
   reviewed seed-stager encoded artifact/length, protected stager-v1 and
   launcher-v1 source digests/paths/exact short invocations, per-operation
   templates, and accepted wrapper commit from the implementation terminal record.
   Visibly choose the intended operation and use that fixed template in an
   already-elevated administrator shell under the exact
   held worktree/Git-common owner SID/profile. Never invoke a worktree file
   from the elevated shell; the lane never invokes UAC or installs a service.
   Exact held
   rustup/Cargo/xwin/V8/Git/LLVM paths must support recoverable RX-only lease/
   restore when needed; Windows/System32 and the shared PowerShell installation
   must already grant effective AppContainer read/execute.
6. PRD A requires operator approval for the repository-mandated complete
   `just test` suite after targeted/core integration tests pass.
7. Serialize with other Codex build-tier/cache/publish changes.

Implementation worktrees:

```powershell
git -C C:\efforts\codexu\codex worktree add `
  C:\efforts\codexu\codex\.worktrees\frdbt `
  -b ralph/codex-fast-runnable-dev-build-tier `
  2a95dd19c89fc99492d0e5a25d77cb070fe77da3

git -C C:\efforts\codexu\codex\.worktrees\frdbt `
  submodule update --init --recursive

git -C C:\efforts\codexu\codex\.worktrees\frdbt\external\repos\codex-patched `
  switch -c ralph/codex-fast-runnable-dev-build-tier-core `
  587a6a8ab8948ff912b1f24a62833b277934302d
```

Before editing, run Cargo metadata from that co-located nested checkout and
assert every workspace member canonicalizes inside either its nested
`codex-rs` tree or the same wrapper worktree's `codex-rs-overlay`; remeasure
the longest checkout path and require `<=240` (current source-verified maximum
for the nested-inside-wrapper layout: `237`). Commit and validate PRD A first.
PRD B commits 1-4 must explicitly avoid staging the modified submodule pointer;
PRD B commit 5 records the already-checked-out PRD A tip SHA with the
launcher/smoke seam. No remote push is required for local
implementation/review.

Ship order is lead-owned and mandatory: merge the reviewed two-commit PRD A tip into
the canonical patched-source branch (`sandbox-patches` unless the repository's
documented ship procedure selects its accepted successor), push it to the
configured canonical patched-source remote(s), and verify the exact SHA is
reachable from a fresh fetch. Only then may the lead merge/push PRD B to every
configured wrapper remote. Finally update/push the parent codexu gitlink and
bookkeeping. A wrapper remote must never reference an unreachable nested SHA.
After retained evidence is finalized/copied outside the worktree and before
removing the implementation worktree, the lead must run owner-verified
`runnable --cleanup` and verify the protected ProgramData
`cleanup-complete` receipt through the authenticated supervisor result. Any
Git-common receipt is non-authoritative diagnostics only. If
the worktree vanished first, use only the owner-record-authenticated orphan
cleanup path; never delete the target by path.

No parent-codexu implementation PRD is created. After the Codex wrapper work is
accepted, the lead separately handles wrapper merge/push, parent gitlink, and
overview bookkeeping.

## 15. Rollback

1. While the feature exists, run owner-verified `runnable --cleanup` for each
   intentionally retired target; recover interrupted transactions first.
2. Revert the verified eight wrapper commits in reverse order (docs/live
   evidence, safety activation, exact smokes/evidence, provider bridge/broker and launcher
   integration, target lifecycle, transaction/source recovery, capability/ACL
   lifecycle, plan/environment), plus bounded review-fix commits if present.
3. After no wrapper commit references them, revert the nested smoke-session
   commit and strict-transport commit in reverse order, plus bounded review-fix
   commits.
4. Run predecessor deterministic tests, real T2 workspace verification, and
   `git diff --check`.
5. Do not delete canonical/release targets, installed binaries, shared
   sccache, or retained audit evidence.
6. Revert any later parent-codexu gitlink commit separately.
7. Keep the cold-failure evidence; rollback does not make it pass.

Because both changes are additive and the wrapper records one explicit nested
gitlink, rollback restores predecessor T1/T2/executable/publish behavior
without changing release/publish state.

## 16. Out of Scope

- cold-start optimization or a cold SLO;
- sccache causality or mixed cache experiments;
- global/shared mutable targets;
- incremental-off default;
- new Cargo profiles;
- debug symbols/source-debugger tier;
- release LTO/codegen changes;
- feature pruning, crate splitting, or upstream-canonical/nested Rust changes
  beyond the named strict transport/parser, typed smoke capsule, dedicated
  handler, and marked entry seams;
- helper packaging/vendor-layout changes;
- installation, publish, tag, release, or push;
- replacement of T1/T2/executable/T4;
- any third implementation repository.

## 17. Open Questions

None. Any implementation-time need beyond the named N-US-001 strict transport
seam, N-US-002 nested smoke-session seam, and two launcher overlay seams, or
any release/publish change, requires a plan amendment rather than implicit
scope expansion.
