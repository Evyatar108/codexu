# Plan Review: Fast Runnable Codex Development Tier

Review model: `gpt-5.6-sol`

Reasoning effort: `xhigh`

Scope: fresh independent review of the wrapper-only replacement plan; no
implementation.

## Round 1

Result: **4 Medium findings**

1. **Dirty-state status text missed same-path edits.**
   - Fix: provenance now hashes the complete index stream plus bounded,
     path-sorted content records for every tracked-dirty and untracked path.
     Readiness compares those digests, not only Git status text.
2. **Probe reconciliation could replace the binaries that were smoked.**
   - Fix: preserve changed-pair evidence separately, then after restoration and
     reconciliation rehash the final pair, pass post-reconcile no-op freshness,
     and rerun all required smokes before writing final readiness.
3. **An in-target lock could not remain open while deleting its directory.**
   - Fix: the per-target lock now lives in the fixed reparse-free
     `D:\codex-targets\.locks` directory and remains held through target
     deletion. It is serialization only, not global ownership/quota state.
4. **Physical DLL resolution would reject Windows API-set contracts.**
   - Fix: `api-ms-win-*` and `ext-ms-win-*` imports are recorded as virtual
     OS-resolved contracts; only unresolved concrete imports fail.

## Round 2

Result: **3 Medium findings**

1. **Serial stories depended on later-story implementation.**
   - Fix: US-001 now supports complete plan inspection but rejects live
     execution deterministically. US-002 implements/tests lifecycle internals
     without public enablement. US-003 adds required smokes and only then
     enables live build/cleanup delegation.
2. **Interrupted creation/cleanup could orphan a manifestless target.**
   - Fix: the full owner manifest now lives beside the external per-target
     lock, is flushed before target creation, survives partial deletion, and is
     removed only after the target is confirmed absent.
3. **Final digests missed an edit-and-revert race during Cargo.**
   - Fix: bounded recursive source watchers span each build/smoke epoch; any
     event, watcher error, or overflow fails. Controlled probes use separate
     measured and post-restore epochs. Tests inject edit-revert and overflow.

## Round 3

Result: **1 High and 2 Medium findings**

1. **Rejecting every descendant reparse made accepted rusty_v8 targets
   unusable.**
   - Fix: only target/control ancestry must be reparse-free. Build-generated
     descendant links such as `dev-small\gn_root` are recorded, never followed,
     and deleted as link leaves.
2. **Caller `CARGO_PROFILE_*` values could override exact `dev-small`.**
   - Fix: runnable clears every case variant of `CARGO_PROFILE_*` and adds
     polluted-environment fixtures while relying on checked-in profile bytes.
3. **Probe acceptance did not positively prove a rebuilt core executable.**
   - Fix: warm probes require a ready/no-op baseline, a non-fresh Cargo event
     for exact target `codex-core.exe`, and a measured core hash different from
     baseline before changed-pair smokes count.

## Round 4

Result: **4 Medium findings**

1. **Public execution inherited predecessor test-hook overrides.**
   - Fix: public runnable rejects all `VERIFY_CORE_CHANGE_*`,
     `MEASURE_BUILD_*`, `REAL_CARGO_*`, and `FAKE_*` families before planning.
2. **Environment cleanup did not close external Cargo configuration.**
   - Fix: admit only the clean tracked workspace `.cargo\config.toml`; reject
     `CARGO_HOME` plus ancestor/home configs, clear all relevant environment
     families, and recheck inventory/hash after each epoch.
3. **Plan inspection used unlocked Cargo metadata.**
   - Fix: inspection and live planning use
     `cargo metadata --locked --no-deps --format-version 1`, with a stale-lock
     no-mutation fixture.
4. **Assume-unchanged/skip-worktree could hide source from provenance.**
   - Fix: initial/final checks reject lowercase assume-unchanged tags and `S`
     skip-worktree tags from `git ls-files -v -z` in both repositories.

## Round 5

Result: **1 High and 1 Medium finding**

1. **Reconciliation's owned mtime poison/restore triggered its own watcher.**
   - Fix: the second epoch now predeclares the predecessor's exact paths and
     original metadata. It exempts only the exact mtime-only poison/restore
     sequence with complete restoration; every other event fails.
2. **Transient external Cargo configuration escaped before/after checks.**
   - Fix: each Cargo epoch watches every exact admitted/rejected config path,
     including absent-directory creation from its nearest existing parent.
     Any candidate event, watcher error, or overflow fails.

## Round 6

Result: **1 High finding**

1. **Failure restoration could re-bless stale probe artifacts.**
   - Fix: if predecessor reconciliation/narrow invalidation cannot safely
     restore freshness, retain or reapply poison metadata and persist an
     invalidated failed target. Ordinary reuse is blocked until owner-locked
     recovery reconciliation or owner-verified cleanup succeeds.

## Round 7

Result: **1 Medium finding**

1. **Cleanup could erase recovery state while source metadata stayed poisoned.**
   - Fix: the bounded atomic owner manifest now carries a <=2 MiB recovery
     journal, flushed before controlled mutation. Startup and cleanup must
     restore and verify exact source bytes/metadata/status before removing the
     journal, target, or manifest; failed recovery retains poison state.

## Round 8

Result: **2 Medium findings**

1. **Build-only preflights could block cleanup/recovery.**
   - Fix: cleanup now branches before iteration-env, Cargo metadata/toolchain,
     config, free-space, and lockfile checks, retaining only prerequisites
     needed for owner/PID/recovery-safe deletion.
2. **The wrapper lock did not exclude direct Cargo target writers.**
   - Fix: `measure-build.ps1` now plans a source-compatible `LockFileEx` adapter
     for Cargo's exact `.cargo-lock`, held across smokes/readiness and cleanup,
     with bidirectional real-Cargo exclusion tests and atomic cleanup detachment.

## Round 9

Result: **3 Medium findings**

1. **Cargo-to-adapter lock handoff could admit another writer.**
   - Fix: a target watcher now spans Cargo and adapter acquisition; any
     post-exit handoff mutation/error/overflow fails, with a winning-racer test.
2. **A replacement original target could inherit old manifest ownership.**
   - Fix: persist volume/file IDs and an atomic detached phase. Detachment
     revokes original-path ownership; retries address only the exact tombstone.
3. **Failed detachment could re-bless probe artifacts.**
   - Fix: recovery cleanup keeps/reapplies poison metadata and retains its
     journal through every pre-detachment failure. Exact metadata returns only
     after durable detachment.

## Round 10

Result: **2 Medium findings**

1. **`FileSystemWatcher` could not prove Cargo lock-handoff ordering.**
   - Fix: remove the unprovable adapter/handoff guarantee. The supported
     concurrency boundary is the existing per-target runnable owner lock; raw
     Cargo use of the reserved target is an explicit unsupported prerequisite.
2. **Create/rename identity gaps were not crash-recoverable.**
   - Fix: precommit `creating` before creation and `detaching` with target
     identity/tombstone path before rename. Recovery reconciles each path/ID
     combination before completing or refusing the transition.

## Round 11

Result: **1 Medium finding**

1. **Story text retained the removed Cargo-lock requirement.**
   - Fix: US-002 cleanup now consistently requires only the per-target runnable
     owner lock.

## Round 12

Result: **2 Medium findings**

1. **Iteration-env clearing could hide caller target drift.**
   - Fix: shell now rejects inherited `CARGO_TARGET_DIR` case-insensitively
     before sourcing iteration-env; Node remains sole target derivation.
2. **Mutation-epoch failure could leave contaminated outputs reusable.**
   - Fix: every post-Cargo failure sets `targetInvalidated`; ordinary reuse is
     blocked until owner-locked reconciliation/narrow invalidation or cleanup.

## Round 13

Result: **4 Medium findings**

1. **Interrupted Cargo lacked durable invalidation state.**
   - Fix: precommit `cargo-started` plus `targetInvalidated=true` immediately
     before spawn; only final atomic readiness clears it.
2. **Git stat/fsmonitor shortcuts could hide tracked modifications.**
   - Fix: path-aware hash every tracked worktree entry against its index object
     with fsmonitor disabled; store aggregate digest plus bounded mismatch data.
3. **Node target authority conflicted with iteration-env export order.**
   - Fix: runnable iteration-env no longer exports a target; Node injects its
     derived value only into PowerShell and the driver rechecks it.
4. **Invalidated recovery options disagreed.**
   - Fix: authoritative transitions now distinguish controlled reconciliation,
     exact-package narrow clean, and cleanup fallback.

## Round 14

Result: **3 Medium findings**

1. **Interrupted Cargo descendants could outlive the owner lock.**
   - Fix: persist pre-spawn/PID identity and fail recovery/cleanup until the
     recorded or conservative possible-writer tree is verifiably quiescent.
2. **Iteration-env still claimed target authority.**
   - Fix: remove target from iteration-env enforcement; Node alone injects it.
3. **Recovery paths still disagreed.**
   - Fix: one explicit matrix now maps controlled probes to reconciliation,
     other post-Cargo failures to exact-package narrow clean, and ambiguity or
     recovery failure to cleanup.

## Round 15

Result: **3 Medium findings**

1. **Package-only cleanup could preserve contaminated dependencies.**
   - Fix: narrow clean is now limited to clean, complete event epochs and covers
     every rebuilt package plus reverse-dependents; mutation/ambiguity cleans the
     full owner target.
2. **Interrupted-writer detection missed arbitrary build descendants.**
   - Fix: persist a bounded cumulative process-start/snapshot descendant ledger,
     including exited intermediates; uncertainty blocks mutation.
3. **Pinned V8 build-changing environment remained inherited.**
   - Fix: sanitize the complete v8 149.2.0 input list and admit only the
     canonical hashed archive.

## Round 16

Result: **2 Medium findings**

1. **Same-path rusty_v8 archive replacement escaped freshness.**
   - Fix: bind/watch pre/post archive hashes; prior drift cleans v8 plus reverse
     dependents, while in-epoch drift invalidates the full owner target.
2. **Story retained obsolete pair-only recovery wording.**
   - Fix: US-002 now references the one complete recovery matrix.

## Round 17

Result: **1 High and 2 Medium findings**

1. **Process-start ledger was infeasible unelevated and violated deferred scope.**
   - Fix: remove it. Use periodic live-tree snapshots, target-bearing process
     checks, and target watcher/quiescence; explicitly defer undetectable
     ancestry-erasing detached writers to the native-supervision task.
2. **Successful Cargo descendants were not checked before readiness.**
   - Fix: require quiescent root/descendants and retain target watcher through
     post-exit hashes, smokes, and ready write.
3. **Archive watcher allowed reparse-target bypass.**
   - Fix: require regular/reparse-free canonical archive and retain a
     read/no-write-delete handle across the epoch.

## Round 18

Result: **4 Medium findings**

1. **Git-clean-filter provenance omitted raw compile-input bytes.**
   - Fix: add aggregate raw hashes for every tracked regular file/symlink.
2. **Interrupted creation could adopt an unowned deterministic target.**
   - Fix: an existing `creating` target without pre-recorded file identity is
     never adopted or deleted and requires manual operator resolution.
3. **Target watcher conflicted with smoke evidence writes.**
   - Fix: evidence moves to identity-derived external `.evidence\run-<id>`.
4. **US-002 depended on US-003 smoke implementation.**
   - Fix: move all smoke-dependent readiness/probe criteria into US-003.

## Round 19

Result: **4 Medium findings**

1. **Ordinary interruption incorrectly required a probe journal.**
   - Fix: persist mutation kind; journal-free ordinary interruption full-cleans
     after quiescence, while controlled probes require restoration journals.
2. **US-002 still owned smoke-bound readiness.**
   - Fix: US-002 reserves but does not exercise ready/smoke fields; US-003 owns
     smoke summary and final ready transition.
3. **Raw provenance drift could still yield a stale no-op.**
   - Fix: retain bounded raw path/hash leaves; raw-only or preserved-mtime
     changes clean owning packages/reverse-dependents before Cargo.
4. **Creation-gap recovery promise contradicted no-adoption.**
   - Fix: acceptance now explicitly defines fail-closed manual resolution for
     the unavoidable pre-identity gap.

## Round 20

Result: **2 Medium findings**

1. **Pre-PID Cargo interruption could not prove writer quiescence.**
   - Fix: `cargo-started` without persisted PID is an explicit fail-closed
     manual-resolution state with no target mutation.
2. **External toolchain drift could re-bless stale artifacts.**
   - Fix: raw fingerprint Cargo/rustc/sysroot, LLVM closure, and xwin LIB/INCLUDE;
     prior drift full-cleans and in-epoch drift invalidates.

## Round 21

Result: **4 Medium findings**

1. **Toolchain edit-and-revert escaped pre/post hashes.**
   - Fix: recursive watchers cover every fingerprint root through readiness.
2. **Generic cleanup contradicted manual missing-PID state.**
   - Fix: explicitly exclude both unprovable identity gaps from all generic
     recovery/cleanup.
3. **US-001 required US-002 toolchain lifecycle.**
   - Fix: move fingerprint lifecycle acceptance into US-002.
4. **Launcher config could alter the required smoke.**
   - Fix: strictly validate/hold/watch its non-invasive subset and select exact
     accepted Bash-vs-PowerShell tool command; reject remote feature enablement.

## Round 22

Result: **3 Medium findings**

1. **Absent launcher config would trigger bootstrap mutation/prompt.**
   - Fix: require pre-existing validated config and token; never read token.
2. **Bash expectation disagreed with pinned core shell behavior.**
   - Fix: retain exact Windows PowerShell expectation; legacy launcher
     `default_shell` is validated but does not select acceptance.
3. **Recursive watchers missed watched-root replacement/revert.**
   - Fix: bind root file IDs, retain no-delete handles, and watch parent entries.

## Round 23

Result: **1 Medium finding**

1. **Plan decomposition still assigned `ready` to US-002.**
   - Fix: US-002 owns pending/failed plus reserved schema; US-003 owns the only
     final ready transition.

## Round 24

Result: **1 Medium finding**

1. **Authenticated smoke inherited auth/provider overrides.**
   - Fix: reject/clear `COPILOT_API_HOME` and `CODEX_ENABLE_ANTHROPIC`, binding
     auth to the verified default token path and Copilot provider behavior.

## Round 25

Result: **2 Medium findings**

1. **Native AWS-LC build inputs were outside environment/freshness control.**
   - Fix: construct Cargo env from an allowlist, stripping all native override
     families; resolve/fingerprint controlled cmake/nasm/ninja.
2. **Launcher smoke cwd was unspecified.**
   - Fix: pin cwd to isolated `<target>\dev-small` and add hostile-caller-cwd
     coverage.

## Round 26

Result: **2 Medium findings**

1. **Persistent profile cwd was not instruction-isolated.**
   - Fix: use a new verified-empty watched external smoke cwd.
2. **Native environment absence contradicted canonical LLVM exports.**
   - Fix: explicitly allow only canonical clang-cl/llvm-lib/lld-link values and
     reject every alternate/suffixed override.

## Round 27

Result: **3 Medium findings**

1. **Smoke cwd remained vulnerable to ancestor project instructions.**
   - Fix: both execs set source-verified `project_doc_max_bytes=0`.
2. **Caller-controlled HOME could redirect build inputs.**
   - Fix: derive canonical Windows known-folder identity, reject inherited
     mismatch, and derive all home inputs from it.
3. **Rollback removed cleanup before using it.**
   - Fix: cleanup/recovery and verification now precede commit reversion.

## Round 28

Result: **3 Medium findings**

1. **Git provenance remained caller-redirectable.**
   - Fix: sanitize Git routing/config, bind explicit repository/index identities,
     and hash/watch local config inputs.
2. **Dependency source trees lacked freshness protection.**
   - Fix: offline locked inventory, registry checksum/Git revision validation,
     raw hashes, identities, handles, and watchers.
3. **Performance probe definitions were not frozen.**
   - Fix: make exact accepted paths/replacements/original+edited hashes normative.

## Round 29

Result: **1 High and 1 Medium finding**

1. **Registry verification required absent `.cargo-checksum.json`.**
   - Fix: verify lock checksum of cached `.crate` plus streaming equality of
     extracted source to archive entries.
2. **System/cloud managed smoke layers were uncontrolled.**
   - Fix: preserve policy, hash/watch local ProgramData layers, force only
     last-layer docs/remote-off controls, and bind acceptance to exact outcomes.

## Round 30

Result: **4 Medium findings**

1. **Legacy managed config could override smoke isolation after CLI flags.**
   - Fix: hash/watch/strictly validate the post-CLI managed layer.
2. **Valid Cargo Git caches appeared dirty from `.cargo-ok`.**
   - Fix: validate and exempt only exact empty markers while binding tracked and
     recursive submodule revisions.
3. **Mandatory preflight left total user wait unbounded.**
   - Fix: add a 120-second operational hang timeout and record total latency,
     without inventing a new validated SLO.
4. **US-002 depended on US-003 readiness.**
   - Fix: US-002 tests watcher primitives to a synthetic terminal boundary;
     US-003 owns through-ready integration.

## Round 31

Result: **2 Medium findings**

1. **No-deps metadata could not validate Cargo.lock.**
   - Fix: preserve exact no-deps planning command and add an offline resolving
     metadata check solely for lock/cache validation.
2. **Smoke inherited CODEX_HOME and managed-hook overrides.**
   - Fix: separate allowlisted smoke env, canonical CODEX_HOME, all override
     variables absent, and last-layer managed-hooks false.

## Round 32

Result: **1 Medium finding**

1. **Managed requirements could repin smoke-prohibited features true.**
   - Fix: run effective post-requirement feature-state preflight immediately
     before each exec and fail any true remote/managed-hooks pin.

## Round 33

Result: **1 Medium finding**

1. **Features-list preflight could not observe exec's cloud requirements.**
   - Fix: remove the false hermetic guarantee and extra preflight. Preserve
     normal managed policy, make only functional outcome claims, and add no
     prohibited cloud/provider inspection path.

## Round 34

Result: **1 High and 1 Medium finding**

1. **Sanitized Git removed accepted CRLF normalization.**
   - Fix: explicitly set canonical Windows `core.autocrlf=true` while retaining
     separate raw-byte provenance.
2. **Story retained stale remote-off override wording.**
   - Fix: US-003 now claims only project-doc isolation and local-config checks.

## Round 35

Result: **1 High and 1 Medium finding**

1. **CRLF workspace config could never byte-match the LF blob.**
   - Fix: compare its canonical clean-filter object ID and retain raw hash
     separately.
2. **Stories retained later-story watcher/documentation obligations.**
   - Fix: US-001 emits Git paths only; US-002 owns runtime watchers/tests; US-004
     owns user documentation.

## Round 36

Result: **2 Medium findings**

1. **Git attribute/filter indirection could spoof clean-filter provenance.**
   - Fix: reject config includes/attributesFile/filter drivers and require
     info/attributes absent/empty and watched.
2. **US-003 omitted target watcher ownership through readiness.**
   - Fix: explicitly retain target watcher and writer-quiescence guard through
     the final ready write.

## Round 37

Result: **2 Medium findings**

1. **Linked-worktree attributes and dirty tracked attributes bypassed closure.**
   - Fix: resolve canonical git-path info/attributes and require all tracked
     attributes clean/watched.
2. **Ignored files and ignore-rule sources escaped provenance.**
   - Fix: bind exclude sources, require tracked ignores clean, inventory ignored
     paths, and allow only two exact predecessor non-input output roots.

## Round 38

Result: **2 Medium findings**

1. **Authenticated smokes deleted the real Codex `.tmp` cache.**
   - Fix: use an isolated owner-verified home with config/policy copies and a
     token hard link; canonical auth remains via explicit COPILOT_API_HOME.
2. **Print-plan's offline metadata updated Cargo global bookkeeping.**
   - Fix: narrow side-effect-free claim to repository/target state and record
     `.global-cache` as the sole permitted Cargo-global mutation.

Status: **PENDING ROUND 39**

## Round 39

Result: **1 High, 2 Medium findings**

1. **HOME/USERPROFILE cannot isolate the launcher's fixed-profile `.tmp`
   deletion on Windows.**
   - Fix: remove false home isolation; fail closed on non-empty cache and use
     a held owner sentinel to make the launcher's ignored deletion fail safely.
2. **The command comment still denied all Cargo mutation.**
   - Fix: explicitly permit only observed `.global-cache` bookkeeping.
3. **Version acceptance was only syntactic.**
   - Fix: require exact accepted-base version
     `codex-cli 0.141.0-copilot-api.3`.

Status: **PENDING ROUND 40**

## Round 40

Result: **2 Medium findings**

1. **The owner delete-blocker conflicted with the blanket sentinel
   prohibition.**
   - Fix: narrow the prohibition to cross-process guard/sentinel protocols and
     explicitly permit the local held owner marker.
2. **PE/import-closure analysis violated the wrapper-only scope.**
   - Fix: remove `llvm-readobj` and import resolution; retain only adjacent
     helper/DLL inventory plus functional launcher smoke.

Status: **PENDING ROUND 41**

## Round 41

Result: **1 Medium finding**

1. **US-003 decomposition retained stale DLL import-resolution wording.**
   - Fix: replace it with adjacent helper/DLL presence-and-hash inventory only.

Status: **PENDING ROUND 42**

## Round 42

Result: **2 Medium findings**

1. **Timeout cleanup used PID without creation-time revalidation.**
   - Fix: persist/revalidate PID plus creation time before descendant-only
     termination.
2. **Recursive toolchain/dependency closure became an unvalidated subsystem.**
   - Fix: reduce to bounded direct-tool hashes/root identities and offline
     locked-resolution proof; remove recursive sysroot/xwin/cache closure.

Status: **PENDING ROUND 43**

## Round 43

Result: **CLEAN (no Medium+ findings)**

The independent reviewer found no remaining actionable Medium, High, or
Critical findings after the wrapper-only scope reduction and safety fixes.

Status: **CLEAN**

## Round 44 - final audit follow-up

Result: **1 Medium finding**

1. **Config validation rejected benign unknown/legacy launcher and managed
   fields.**
   - Fix: parse standards-compliant TOML via controlled Python stdlib
     `tomllib`; accept unrelated/legacy fields and reject only enumerated values
     that conflict with runnable smoke invariants. Preserve raw-byte
     hash/lock/provenance and add accept/reject/drift fixtures.

Status: **PENDING ROUND 45**

## Round 45

Result: **CLEAN (no Medium+ findings)**

The independent reviewer found no remaining Medium, High, or Critical issues
in the real-TOML, conflict-only config validation follow-up.

Status: **CLEAN**
