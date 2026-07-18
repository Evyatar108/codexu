# Implementation Plan: Fast Runnable Codex Development Tier
<!-- ralph-meta {"overviewTaskId":"codex-fast-runnable-dev-build-tier","uiUxJudgment":"not-required"} -->

*Planning-only replacement for rejected commit `9f529afa`. This phase does not
implement, push, tag, release, publish, install, or remove a worktree.*

## 1. Decision

Implement one additive, explicit, default-off `runnable` tier in the Codex
**wrapper repository only**, adjacent to the accepted predecessor's
`scripts/verify-core-change.sh` and `scripts/verify-core-change.mjs` tiers.
The lane builds and smokes the adjacent fork pair:

```text
<target>\dev-small\codex.exe
<target>\dev-small\codex-core.exe
```

It uses the existing `dev-small` Cargo profile, Cargo incremental compilation
on, sccache off, and a short deterministic target owned by the current Codex
wrapper worktree. It is a warm behavior-iteration lane, not a correctness,
optimized-executable, release, publish, install, debugger, or runtime-
performance lane.

There is one implementation PRD with four serial stories in one repository:
`codex` at accepted predecessor commit
`2a95dd19c89fc99492d0e5a25d77cb070fe77da3`. The pinned nested
`external/repos/codex-patched` repository, its gitlink, every Cargo manifest,
and all Rust source remain byte-for-byte unchanged. A later codexu gitlink
update is lead-owned ship ceremony, not a second implementation PRD.

## 2. Frozen evidence and acceptance

The accepted brainstorm verdict is **GO_WARM_LOOP_ONLY**.

| Contract | Metric | Acceptance | Frozen observation |
|---|---|---:|---:|
| Warm no-op | Cargo wall time and rebuilt packages | `<=30s` and zero rebuilt packages | `9.030s` |
| Warm private-core edit | Build start through exact changed launcher `--version` | `<=600s` | `92.963s` (`68.037s` Cargo) |
| Warm high-fanout edit | Build start through exact changed launcher `--version` | `<=600s` | `98.635s` (`74.036s` Cargo) |
| Representative runtime | Exact changed hashes pass authenticated no-tool and benign shell-tool smokes | Functional pass | Pass |
| Post-reconcile no-op | Cargo wall time and rebuilt packages | `<=30s` and zero rebuilt packages | `7.031s` |
| Cold absent target | Build start through launcher `--version` | **No accepted SLO** | `648.476s`, failed original `600s` target |
| Incremental-off private edit | Cargo wall time | Informational | `170.032s` |
| Incremental storage | `dev-small\incremental` | Informational | `5.184-7.286 GiB` |

The implementation must not relabel the cold result as passing, invent a
12-minute or other post-hoc cold SLO, require cold execution as a ship gate,
or claim sccache causality. Cold-start improvement remains a separate
follow-up limitation.

The five contracts remain distinct and never auto-escalate:

1. T1 `targeted`: compile validation for exact packages.
2. T2 `workspace`: mandatory workspace correctness/rebase gate.
3. `runnable`: warm `dev-small` launcher-plus-core behavior iteration.
4. `executable`: existing optimized two-binary output.
5. `publish`: existing release-equivalent four-binary output.

## 3. Provenance and prerequisite

- Codexu planning base: `624f9b1ba51edc54b3ef451e0e5667d4b0a368c5`.
- Canonical brainstorm:
  `.ralph/brainstorms/codex-fast-runnable-dev-build-tier/brainstorm.json`.
- Required Codex wrapper implementation base:
  `2a95dd19c89fc99492d0e5a25d77cb070fe77da3`.
- Required nested source pin at that wrapper base:
  `587a6a8ab8948ff912b1f24a62833b277934302d`.
- Implementation must start from or rebase onto that exact predecessor before
  editing. It must not recreate predecessor infrastructure from an older
  wrapper commit.

## 4. Source-verified wrapper-only feasibility

The accepted predecessor already contains every necessary control seam:

- `scripts/verify-core-change.sh:4-35` requires an explicit tier, protects slow
  tiers, sources `iteration-env.sh`, and delegates to the Node planner.
- `scripts/verify-core-change.mjs:8-65` owns tier parsing and confirmation;
  `:90-132` owns exact Cargo argv; `:347-391` owns target/preflight/next-tier
  plan JSON; `:426-461` owns execution and child exit propagation.
- `scripts/iteration-env.sh:60-100` already clears conflicting Cargo/Rust/sccache
  environment and selects the canonical LLVM toolchain; `:102-143` locates
  xwin/rusty_v8 and preflights free space; `:145-176` owns sccache-specific
  reconciliation. A mode branch can reuse the common toolchain while skipping
  only sccache setup for `runnable`.
- `scripts/measure-build.ps1:229-303` already captures bounded child output and
  kills its own child tree on failure; `:350-474` supplies exclusive metadata
  updates; `:984-1058` obtains canonical plan JSON from the verifier;
  `:1066-1135` validates clean, hash-pinned probe specs; `:1182-1386` applies
  probes and captures Cargo JSON/timings; `:1396-2109` restores exact bytes,
  mtimes, attributes, Git status, and reconciles or narrowly invalidates failed
  artifacts; `:2161-2286` emits compact JSON/CSV and preserves exit semantics.
- `scripts/test_measure_build.ps1` already covers mandatory Windows sharing,
  concurrent drift, restoration, artifact writes, freshness, and failure paths.
- `scripts/test_measure_build_real_cargo.ps1:280-493` already proves real Cargo
  lock behavior, package-scoped invalidation, exact restoration, unrelated
  artifact preservation, and post-recovery freshness.
- The existing nested workspace already defines `[profile.dev-small]` at
  `external/repos/codex-patched/codex-rs/Cargo.toml:543-547`; no profile or
  manifest change is needed.
- Accepted `smoke-candidate.ps1:24-451` already proves the normal adjacent
  launcher path can perform version, authenticated no-tool, and benign shell-
  tool smokes while unsetting `CODEX_CORE_PATH`, bounding the captured process
  tree, hashing binaries/logs, and inventorying adjacent helpers/DLLs.

Therefore the smallest coherent implementation is wrapper-only: extend the
four existing scripts and their existing tests/docs. Do not add a second build
runner, source restoration system, smoke transport, native supervisor, or
nested-source seam.

## 5. Exact public contract

### 5.1 User commands

```bash
# Inspect only; no repository, target, lock, manifest, evidence, or smoke mutation.
# Cargo may update its canonical .global-cache usage bookkeeping.
bash scripts/verify-core-change.sh runnable --print-plan-json

# Explicit slow authorization; build and run the representative smokes.
bash scripts/verify-core-change.sh runnable --confirm-slow

# Explicit owner-verified cleanup; never implicit after a successful build.
bash scripts/verify-core-change.sh runnable --cleanup
```

`runnable` is never inferred from `targeted`, `workspace`, `executable`, or
`publish`. `--confirm-slow` remains required for runnable execution, matching
the predecessor's explicit slow-tier safety. `--cleanup` is mutually exclusive
with `--confirm-slow`, package flags, and build execution. Existing tier flag
rules and exact argv remain unchanged.

For plan inspection and build, the shell wrapper first enumerates the inherited
environment case-insensitively and rejects any caller-supplied
`CARGO_TARGET_DIR` before `iteration-env.sh` can clear it. It then sources
`iteration-env.sh runnable` and delegates to the Node verifier. The shell does
not accept or derive a target, and runnable iteration-env does not export one.
Node remains the sole target-plan authority and injects its derived
`CARGO_TARGET_DIR` only into the delegated PowerShell child environment; the
driver's plan recheck must derive and match the same value.
Cleanup
branches before iteration environment, Cargo metadata, toolchain, config,
free-space, and lockfile preflights; it requires only the shell/Node/PowerShell,
Git, path/owner/PID, and recovery prerequisites needed to restore or delete
safely. Thus a stale `Cargo.lock` or missing build-only tool cannot block the
only owner-verified recovery path.

The Node verifier remains the single plan authority. For a live runnable build
it delegates to the existing `measure-build.ps1`; the PowerShell driver calls
the Node verifier only with `--print-plan-json`, so there is no execution
recursion. Inspection and live build planning obtain metadata with exactly
`cargo metadata --locked --no-deps --format-version 1`; a stale lockfile fails
without rewriting it. Because Cargo 1.97 does not resolve the lockfile on the
`--no-deps` path, runnable inspection also requires a separate
`cargo metadata --locked --offline --format-version 1` resolver check. The
first command remains the exact plan source; the second is only lock/cache
validation and must not mutate the target or use network.

`--print-plan-json` is repository/target side-effect free, not globally
cache-byte-free: Cargo 1.97 may update its normal canonical
`CARGO_HOME\.global-cache` usage bookkeeping during offline metadata. Record
that path and pre/post metadata explicitly, permit no other Cargo-home writes,
and test that wrapper/nested bytes, lockfile, target, evidence, and owner state
remain unchanged. Do not promise a stronger Cargo-global guarantee the pinned
tool cannot provide.

### 5.2 Exact Cargo command and profile

The plan's Cargo argv is exactly:

```text
<cargo.exe> build --locked --profile dev-small -p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex --timings --message-format=json-render-diagnostics
```

The working directory is exactly the real metadata `workspace_root` for
`external/repos/codex-patched/codex-rs`. `measure-build.ps1` must not append a
second message-format argument when the plan already supplies one. Existing
T1/T2/executable/publish argv deep-equality tests remain unchanged.

### 5.3 Deterministic per-worktree target identity

The Node planner derives the target without a registry:

1. Resolve the canonical Codex wrapper Git top-level path.
2. Normalize it for identity as an absolute Windows path with `\` separators,
   no trailing separator, and invariant lowercase.
3. Hash UTF-8 bytes of
   `codex-runnable-target-v1\0<normalized-wrapper-root>` with SHA-256.
4. Use the first 12 lowercase hex characters as `<id>`.
5. Set `CARGO_TARGET_DIR` to exactly `D:\codex-targets\run-<id>`.

The identity intentionally excludes HEAD so the warm cache survives commits,
but the owner/run manifest binds each ready result to HEAD and dirty-state
provenance. The wrapper rejects any inherited `CARGO_TARGET_DIR`; Node derives
the only admitted child value. It rejects reparse components and target/profile/
binary paths whose absolute length reaches 240 characters, preserving MAX_PATH
headroom. Other tiers continue requiring Cargo's canonical workspace target.

### 5.4 Runnable environment

`iteration-env.sh runnable` reuses the existing canonical PATH/toolchain,
xwin, `LIB`, `INCLUDE`, rusty_v8, and jobs setup, then enforces all values
below except `CARGO_TARGET_DIR`; Node injects that one only into the delegated
PowerShell child:

```text
CARGO_INCREMENTAL=1
RUSTC_WRAPPER=<unset>
RUSTC_WORKSPACE_WRAPPER=<unset>
CARGO_BUILD_RUSTC_WRAPPER=<unset>
CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER=<unset>
SCCACHE_*=<unset>
CARGO_PROFILE_*=<unset>
```

All conflicting names are removed case-insensitively before canonical values
are exported or child-injected. Runnable clears every caller profile override and relies on the
checked-in `[profile.dev-small]` definition; polluted `CARGO_PROFILE_*` values
cannot alter opt-level, debug, strip, LTO, codegen, or incremental behavior.
Runnable does not start, stop, query, or reconfigure the sccache server.

Do not pass the inherited environment wholesale to Cargo. Construct the child
environment case-insensitively from a documented allowlist: Windows process
basics (`SystemRoot`, `WINDIR`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`), identity
locations needed by Cargo (`HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`,
`RUSTUP_HOME` when canonical), canonical PATH/LIB/INCLUDE/toolchain values, and
the explicit runnable variables in this section. Cargo supplies its own
build-script variables. Everything else is absent, including generic,
target-suffixed, and crate-prefixed CC/CXX/CFLAGS/CXXFLAGS/AR, CMake/Ninja/NASM,
bindgen, and `AWS_LC_SYS_*`/`AWS_LC_FIPS_SYS_*` overrides. Polluted unknown-key
fixtures prove they do not reach Cargo.

Resolve user-profile, roaming, and local-app-data paths from Windows known
folders before sourcing iteration-env. Reject any inherited
`HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` mismatch, then set their canonical
values and derive xwin, Cargo home, launcher config/token, and rusty_v8 archive
only from that fixed profile. Bind the profile directory identity in plan
provenance.

The only native compiler/linker exceptions are the predecessor's canonical
exports: `CC=clang-cl`, `CXX=clang-cl`, `AR=llvm-lib`, and
`CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=lld-link`. Resolve each through the
controlled PATH and fingerprint it; reject any caller value, alternate path, or
suffixed/crate-specific override.

Record a bounded direct-tool fingerprint before target mutation: canonical
resolved paths, versions, and SHA-256 for Cargo, rustc, `clang-cl`, `lld-link`,
`llvm-lib`, PowerShell, and Git, plus the accepted xwin `LIB`/`INCLUDE` root
identities. Recompute the direct executable hashes after the build epoch. A
changed direct-tool fingerprint versus the prior owner manifest requires full
owner-target cleanup before Cargo; in-epoch drift invalidates the run. Do not
recursively hash/watch the sysroot, LLVM DLL closure, xwin trees, or dependency
caches. Also resolve `cmake.exe`, `nasm.exe`, and `ninja.exe` from the controlled
PATH, record path/version/hash when present and absence otherwise, and reject a
resolution outside canonical allowlisted tool roots. This bounded preflight is
outside the Cargo warm timing.

Sanitize the pinned `v8 149.2.0` build-script inputs as part of the same child
environment. Reject/clear inherited `CCACHE`, `CLANG_BASE_PATH`, `CXXSTDLIB`,
`DENO_TRYBUILD`, `DOCS_RS`, `GN`, `GN_ARGS`, `NINJA`, `RUSTY_V8_MIRROR`,
`RUSTY_V8_SRC_BINDING_PATH`, `SCCACHE`, `V8_FORCE_DEBUG`, `V8_FROM_SOURCE`,
`PYTHON`, `DISABLE_CLANG`, `EXTRA_GN_ARGS`, and `PRINT_GN_ARGS`; remove
inherited `HOST`, `OUT_DIR`, and `CARGO` so Cargo supplies its own values.
Reject/clear inherited `COPILOT_API_HOME` and `CODEX_ENABLE_ANTHROPIC` for the
launcher smokes so auth resolves through the verified default profile path and
config cannot preserve caller-enabled Anthropic behavior.
`RUSTY_V8_ARCHIVE` is the sole exception and must equal the canonical existing
archive derived by iteration-env; any caller value is replaced and the final
path/hash is recorded. Require a regular non-reparse file with reparse-free
ancestry and a canonical final path. Open it before Cargo with a retained read
handle that permits reads but denies write/delete sharing, hash through that
handle before and after every Cargo/smoke epoch, and watch its parent for
identity events. Any open failure, in-epoch event, identity change, or hash
drift fails and requires full owner-target cleanup. If its hash differs from
the prior manifest before a new run, narrow clean pinned `v8` plus its
locked-metadata reverse-dependent closure before Cargo; failure falls back to
owner cleanup. Tests pollute every listed input, attempt same-path and reparse
replacement, and prove the child environment and freshness remain canonical.
Existing iteration mode remains incremental-off/sccache-on and publish mode
remains unchanged. The runnable plan fails before target mutation if Cargo,
Rust, LLVM, xwin, rusty_v8, PowerShell 7, or Git is
unavailable.

The public runnable path also rejects every environment key in the
`VERIFY_CORE_CHANGE_*`, `MEASURE_BUILD_*`, `REAL_CARGO_*`, and `FAKE_*`
test-hook families before plan inspection or live execution. Existing test
scripts may exercise hooks only through their direct test invocation, never
through `verify-core-change.sh runnable`.

Cargo configuration is closed rather than guessed:

- reject caller `CARGO_HOME` and use the normal resolved home;
- require the workspace `.cargo\config.toml` path-aware clean-filter object ID
  to match its tracked `HEAD` blob under canonical `core.autocrlf=true`, while
  recording its separate raw worktree SHA-256 in provenance;
- reject workspace `.cargo\config`, every additional `.cargo\config` or
  `.cargo\config.toml` from workspace ancestors, and both config names beneath
  the resolved Cargo home;
- clear all case variants of `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`,
  `CARGO_BUILD_RUSTFLAGS`, `CARGO_TARGET_*_RUSTFLAGS`, wrapper variables,
  target overrides, and `CARGO_PROFILE_*`.

Because the only admitted Cargo config is the tracked workspace file and it
contains no wrapper/profile override, sccache cannot be re-enabled by hidden
Cargo configuration. Before each Cargo epoch, enumerate the exact admitted and
rejected config paths. Watch each existing candidate directory and the nearest
existing parent of every absent candidate path, filtering events to those exact
config paths and the missing directory chain that could create them. Any
candidate config create, delete, rename, content/size/mtime event, watcher
error, or buffer overflow fails the run, even if a transient file disappears
before reconciliation. Recheck the config inventory and workspace-config hash
after every build/smoke epoch.

Git provenance uses its own sanitized child environment. Clear/reject
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`,
`GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`, and every
`GIT_CONFIG_*`; set `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=NUL`,
`GIT_ATTR_NOSYSTEM=1`, and `GIT_OPTIONAL_LOCKS=0`. Resolve and bind canonical
git-dir, common-dir, worktree, and index paths once, invoke plumbing commands
with explicit `--git-dir`/`--work-tree` plus
`-c core.fsmonitor=false -c core.autocrlf=true`. The explicit normalization
matches the accepted Windows checkout while avoiding caller/system redirection;
raw-byte hashing remains separate. Hash/watch local/worktree config and index
identities. Caller routing or config cannot redirect the provenance repository.

Close attribute/filter indirection as well: resolve
`git rev-parse --git-path info/attributes` (including linked-worktree common
dir), require it absent or empty, and hash/watch its identity; reject
local/worktree config includes, `core.attributesFile`, and every `filter.*`
driver. Require every tracked `.gitattributes` to match its index/HEAD object
before hashing and watch it. Thus path-aware hashing uses only accepted tracked
attributes plus explicit CRLF normalization.

Close ignore indirection too: resolve/hash/watch `git rev-parse --git-path
info/exclude`, reject `core.excludesFile`, and require tracked `.gitignore`
files clean. Inventory `git status --porcelain=v2 -z --ignored=matching
--untracked-files=all`. Reject every ignored path except the predecessor's exact
non-input output roots `docs/implementation/build-perf-artifacts/` in the
wrapper and `codex-rs/target/` in the nested repository; require those roots
reparse-free, record identity/count/size, and never treat them as source. Any
new ignored root/file fails before Cargo.

The planner's exact metadata command remains the required `--locked --no-deps`
form. Separately, lifecycle preflight runs
`cargo metadata --locked --offline --format-version 1` in the sanitized child
environment to prove locked resolution and warm cache availability without
network or target mutation. Missing cache or stale lock fails. Cargo's own
locked build remains responsible for dependency validation; this lane does not
invent archive/tree equivalence checks or recursive dependency-cache watchers.

The aggregate direct-tool/provenance preflight has a 120-second operational
timeout and fails before Cargo on expiry. This is a hang bound, not a new
validated performance SLO. Record command-start-to-version separately so the
operator sees total wait; the accepted warm gates remain Cargo no-op `<=30s`
and changed build-through-version `<=600s`.

### 5.5 Free-space preflight

Before creating or updating the target, query the target volume and require at
least 25 GiB free. This is local preflight only, justified by the observed
15.054 GiB post-cycle target plus headroom. Record free bytes before/after,
total target bytes, profile bytes, and incremental-directory bytes. Do not add
a machine-global quota registry, reservations, generations, receipts, or a
cross-target coordinator.

## 6. Owned target, lifecycle, and freshness

### 6.1 Per-target lock

`measure-build.ps1` opens
`D:\codex-targets\.locks\run-<id>.lock` with read/write access and
`FileShare.None` before reading or changing owner state, Cargo output, or
evidence. The per-target lock is outside the deletable target but keyed by the
same identity; `.locks` itself must be a real, reparse-free directory beneath
the fixed target parent. Lock acquisition is bounded to five seconds and
otherwise fails with a diagnostic; it never waits indefinitely. Build, smoke,
reconciliation, evidence pruning, and cleanup all use this same lock, and
cleanup retains the handle until the target directory has been removed.

The lock defines the supported concurrency boundary: every operation on this
managed target must go through `verify-core-change.sh runnable`. Raw Cargo with
this `CARGO_TARGET_DIR` is unsupported because a wrapper-only process cannot
atomically inherit Cargo's internal build-directory lock after Cargo exits.
Document this prerequisite rather than claiming an unprovable direct-Cargo
exclusion or adding a second lock protocol. Concurrent runnable invocations are
fully serialized; unrelated Cargo targets remain unaffected.

The fixed target parent, `.locks` directory, lock/manifest paths, target root,
and profile/binary control paths must have reparse-free ancestry. Cargo is
allowed to create descendant reparse leaves inside the target (the accepted
build creates `dev-small\gn_root` for rusty_v8). Traversal records but never
follows a descendant reparse; cleanup deletes the link object itself rather
than recursing through its destination.

The full owner manifest is
`D:\codex-targets\.locks\run-<id>.owner.json`, beside the external lock rather
than inside the deletable target. Under the lock, create and flush `pending`
owner state before creating the target directory. If the target exists without
that valid matching external manifest, or its root/control ancestry has a
reparse point, the lane refuses to use or delete it. It never adopts an
arbitrary existing directory.

### 6.2 Owner/provenance manifest

`D:\codex-targets\.locks\run-<id>.owner.json` is a flushed, bounded JSON
document with:

- schema version and target algorithm version;
- target ID and canonical target path;
- canonical wrapper root and its identity hash;
- target volume serial and Windows directory file ID once created;
- operation state: `pending`, `ready`, or `failed`;
- execution phase `pre-cargo|cargo-started|post-cargo|smoking`;
- `targetInvalidated`, precommitted `true` with `cargo-started` immediately
  before process spawn and cleared only by the final atomic `ready` write;
- Cargo root PID/start time once observed, plus the pre-spawn timestamp used for
  conservative recovery when termination occurs before PID persistence;
- creation phase `creating|created`, with the deterministic target path
  precommitted before `CreateDirectory`;
- cleanup phase `attached|detaching|detached`, with the deterministic tombstone
  path and attached target identity precommitted before rename, then tombstone
  volume serial/directory file ID after reconciliation;
- run ID and timestamps;
- wrapper HEAD, wrapper status hash/text, wrapper index digest, wrapper dirty-
  content digest, nested gitlink SHA, nested HEAD, nested index digest, and
  nested dirty-content digest;
- exact Cargo cwd/argv/profile/target and controlled environment;
- Cargo/rustc/PowerShell/Git versions and verifier/driver script hashes;
- launcher/core absolute paths, byte sizes, mtimes, and SHA-256 hashes;
- smoke result summary and compact evidence index;
- failure class/message when state is `failed`;
- only while a controlled probe or recovery is active, a bounded recovery
  journal for its exact declared source paths: original bytes, length, SHA-256,
  mtime, attributes, expected probe hash, and poison metadata. Flush this
  journal before the first source mutation, cap it at 2 MiB, and reject a
  probe that exceeds the cap rather than running without recoverable state.
- mutation kind `none|controlled-probe` and `recoveryJournalRequired`, so an
  ordinary interrupted Cargo run never expects a probe journal.

For each repository, compute the index digest from the complete
`git ls-files --stage -z` byte stream. Parse
`git status --porcelain=v2 -z --untracked-files=all`; for every tracked-dirty
or untracked path, hash the path, file-kind/missing marker, length, and current
bytes. Sort those records by Git path and hash the complete record stream as
the dirty-content digest. This detects same-path edits that leave status text
unchanged. Status text and the optional path/hash audit list are each bounded
to 64 KiB per repository; over-limit state fails closed rather than truncating
provenance. Writes use an owner-verified same-directory temporary file, flush,
and atomic replace. The manifest never contains auth tokens, prompts beyond
the fixed smoke strings, model response content, or unbounded process output.

Do not trust status/stat shortcuts to identify the tracked-dirty set. Enumerate
every tracked index entry and compute its worktree object ID through Git's
path-aware clean-filter hashing, recording one aggregate digest over
`mode,path,index_oid,worktree_oid|missing|submodule`. Any mismatch is included
in the dirty-path content records above. Run Git with repository-local
fsmonitor disabled for these reads. This is read-only and catches a
pre-existing same-size/same-mtime modification even if ordinary status would
report clean; only the aggregate digest and bounded mismatch detail are stored.
In parallel, hash the raw on-disk bytes of every tracked regular file/symlink
into a second path-sorted aggregate digest and compare it at every provenance
boundary. This binds compile inputs such as `include_str!` data whose CRLF/raw
bytes can differ while Git's clean-filter object ID remains unchanged. Retain
the path/raw-hash leaves in a bounded, hashed provenance sidecar under the
external evidence directory (8 MiB cap; overflow fails closed). Before Cargo,
diff against the prior ready sidecar. A raw-changed path that Git reports dirty
with trustworthy newer metadata follows normal Cargo freshness. A raw-only
change hidden by clean filters/stat, or a changed path whose mtime did not
advance, requires narrow clean of its owning package plus locked-metadata
reverse-dependents; unmappable/ambiguous paths require owner-target cleanup.
Declared controlled-probe paths use their existing reconciliation contract.

At initial and final provenance checks, also parse `git ls-files -v -z` for
both repositories. Reject any lowercase assume-unchanged tag and every `S`
skip-worktree tag before Cargo; these index flags can hide worktree content
from status and are not admitted by the runnable lane.

### 6.3 State transitions

1. Under the lock, validate or atomically establish external owner identity.
   Flush `pending` plus creation phase `creating` and the deterministic target
   path before `CreateDirectory`; then capture its volume serial/directory file
   ID and atomically advance to `created` before Cargo. On restart, reconcile
   every boundary: absent path means creation never landed. If state is still
   `creating` and the deterministic directory exists without a pre-recorded
   volume/file ID, refuse to adopt or delete it; report the orphan for manual
   operator resolution. Only a persisted ID can authorize subsequent use or
   cleanup. Mismatch/reparse state likewise fails without adoption or deletion.
2. If a prior valid manifest is `pending`, branch on mutation kind. A controlled
   probe requires its journal, restores/verifies exact source
   bytes/metadata/status, and retains poison on failure. An ordinary
   `mutationKind=none` run requires no journal; after writer quiescence it is
   marked interrupted/invalidated and follows full owner-target cleanup. Never
   smoke either interrupted target.
   If a prior `failed` manifest records incomplete reconciliation or target
   invalidation, do not run an ordinary build or smoke. While holding the same
   owner lock, use one recovery matrix: controlled probe with a complete trusted
   event inventory -> predecessor reconciliation; post-Cargo smoke/evidence
   failure with clean source/config watchers and complete Cargo JSON -> narrow
   clean every non-fresh package reported by Cargo plus its locked-metadata
   workspace reverse-dependents; source/config mutation, watcher failure,
   provenance drift, interruption, malformed/incomplete Cargo output, or any
   ambiguous closure -> owner-verified full target cleanup. Any failed recovery
   also falls back to cleanup.
3. Write and flush `pending` before Cargo starts.
   In the same final pre-spawn write, set execution phase `cargo-started` and
   `targetInvalidated=true`; a crash from this point is recoverably invalidated.
4. Start recursive .NET `FileSystemWatcher` instances for the wrapper and
   nested source roots, plus the exact Cargo-config watchers from section 5.4,
   after the provenance snapshot and before Cargo. For each root, capture
   volume/file ID, retain a read handle that denies delete/rename, and watch its
   parent entry as well as recursive contents. Any unowned create, delete,
   rename, content/size/mtime/root-identity change, watcher error, or internal
   buffer overflow during that epoch writes `failed`.
5. Run the exact Cargo command and parse all JSON lines. Malformed Cargo output,
   nonzero exit, missing build-finished success, or missing adjacent pair writes
   `failed`. A successful exit advances only to `post-cargo`; it does not clear
   invalidation.
6. Re-read HEAD, gitlink, status, index digests, and dirty-content digests. Any
   stale HEAD, staged-state drift, same-path content change, untracked-file
   change, or other dirty-state drift writes `failed`; current files are
   preserved for the user.
7. Hash the exact adjacent pair and run smokes only after the successful build.
8. For a controlled `ProbeSpec`, apply the controlled edit before starting the
   measured watcher epoch. A warm probe requires a prior ready/no-op baseline.
   Require a non-fresh Cargo compiler-artifact event whose normalized
   `executable` is the exact target `codex-core.exe`, and require the measured
   core SHA-256 to differ from the baseline core hash before accepting changed-
   pair smokes. Preserve the changed-pair hashes and smoke evidence, then reuse
   predecessor exact restoration and reconciliation.
   Stop and validate that epoch before the controlled restore. After exact
   content restore, capture fresh provenance. Predeclare the predecessor
   reconciliation's exact source paths and original metadata, then run the
   second watcher epoch across reconciliation, final no-op, and final smokes.
   Its event ledger may exempt only mtime-only transitions on those predeclared
   paths when they match the predecessor's owned poison/restore sequence and
   every original timestamp is restored exactly; an unexpected path, event
   kind, size/content change, missing transition, extra transition, or failed
   restoration writes `failed`. If predecessor narrow-clean/recovery cannot
   safely restore freshness, retain or reapply its poison metadata and mark
   the target invalidated; do not restore a timestamp that could re-bless
   probe-built artifacts. Cargo-config events are never exempt.
   Reconciliation overwrites the same output paths, so rehash the final pair
   and record measured and final hash/smoke sets separately.
9. Write `ready` only after both watcher epochs are clean, the hashes named by
   the ready manifest have passed
   the required smokes, provenance recheck, and any reconciliation. This one
   atomic write clears `targetInvalidated`.

Any failure after Cargo begins, including interruption or a source/config
watcher event, leaves the manifest `failed` with `targetInvalidated=true`.
Before another ordinary build or smoke, apply the same matrix above. Narrow
clean is allowed only when watchers/provenance are clean and the Cargo event
inventory is complete; it covers every non-fresh package plus workspace reverse
dependents, not merely the two requested packages. Every mutation/ambiguous
epoch requires full owner-verified cleanup. If reconciliation/narrow clean
fails, retain invalidation/poison state and require cleanup. This applies even
when an edit is reverted and final source digests match, so a later no-op
cannot re-bless artifacts produced during an untrusted mutation epoch.

Cargo process checks stay within unelevated predecessor-compatible mechanisms;
do not add the prohibited ETW/native-supervisor/elevation machinery. Persist
the pre-spawn time and Cargo root PID/creation time, snapshot the live descendant
closure periodically while Cargo runs, and retain a recursive target watcher
through a two-second post-exit quiescence interval, hashes, smokes, and the
`ready` write. Before post-Cargo acceptance, interrupted recovery, or cleanup,
require the recorded root/current descendants to be gone and reject any live
process created since pre-spawn whose available command line names the managed
target. Unavailable required process data, target mutation after Cargo exit, or
watcher error/overflow blocks mutation/readiness; never kill it.

The pre-spawn invalidation write and PID persistence are separate operations.
If recovery finds `cargo-started` without a persisted root PID, it cannot prove
whether Cargo inherited the target through its environment. Fail closed for
explicit manual operator resolution and do not recover, clean, rename, or
delete the target. A native suspended-create/job-object handoff would close the
gap but is explicitly deferred by scope.

Cargo is expected to join its build-script children before successful exit, as
the accepted predecessor does. A deliberately detached arbitrary process that
both erases ancestry and omits the target from its command line cannot be proven
by an unelevated wrapper and is outside this lane's supported contract; solving
that requires the explicitly deferred native supervisor/ETW security task.
Tests cover live Cargo, live ordinary descendants, target-bearing detached
processes, and post-exit target mutation.

The normal launcher also reads `~\.codex-copilot\config.toml`, which
`--ignore-user-config` does not suppress. First-run bootstrap is not allowed:
require both a pre-existing config and the Copilot token at
`~\.local\share\copilot-api\github_token`; verify only that the token is a
regular non-reparse file and never read, hash, copy, or record it.

The pinned Windows launcher resolves the profile through
`dirs::home_dir()` and unconditionally attempts to remove
`~\.codex\.tmp`; environment-only home redirection cannot isolate it. Stay
wrapper-only and fail closed rather than moving/deleting a real cache: require
that canonical `.tmp` is absent or an empty, owned, non-reparse directory,
create it when absent, then create a uniquely owned sentinel inside it and hold
the sentinel without delete sharing throughout launcher startup. The ignored
`remove_dir_all` attempt fails on the sentinel before the directory can vanish.
Refuse a non-empty pre-existing cache and report this explicit smoke
prerequisite; never clean it on the operator's behalf. Remove only the verified
sentinel afterward and remove the directory only if this run created it and it
is still empty/identity-matched. Snapshot exact-image Codex processes and watch
the directory/parent; concurrent external cache activity fails evidence and is
not cleaned. Eliminating the residual check-to-spawn race would require the
explicitly deferred launcher/native-supervisor seam.

Launch smokes from a separate case-insensitive allowlisted environment rather
than inheriting the build/driver process. Keep only Windows process basics,
canonical identity paths, controlled PATH, and canonical `CODEX_HOME`. Every
other inherited variable is absent, especially `CODEX_CORE_PATH`,
`COPILOT_API_HOME`, `CODEX_ENABLE_ANTHROPIC`, and
`CODEX_ENABLE_MANAGED_HOOKS`.

Do not alter the canonical config. Require a regular, reparse-free UTF-8 file in a
deliberately strict
top-level subset: full-line comments/blank lines; optional
`default_shell = "<absolute existing bash.exe|pwsh.exe|powershell.exe>"`;
optional `auto_load_claude_md`/`style_user_messages` booleans; and remote
session/auto-attach/Anthropic keys only when explicitly `false`. Reject tables,
quoted/dotted keys, escapes outside the admitted string form, duplicates, and
unknown lines rather than approximating TOML. Hold it with a
read/no-write-delete handle during smokes, hash before/after, and fail on
identity/event drift. The pinned core does not consume the launcher's
`default_shell` override and Windows shell detection resolves PowerShell, so
the benign assertion remains the direct exact `Write-Output FAST_TOOL_OK`
command even when an admitted legacy Bash value is present. It must produce the
six-event shape, exit 0, exact output, and final response. This exercises the
normal launcher configuration without modifying it or inventing a provider
transport.

System requirements and cloud-managed layers are intentionally part of the
normal authenticated launcher and must not be bypassed. Resolve the known
ProgramData `config.toml`/`requirements.toml` paths, hash/watch them when
present, and record absence otherwise. Cloud bundle bytes and effective pins
are not locally inspectable through the normal wrapper-only CLI. Do not claim
they are disabled and do not add a cloud/provider transport to inspect them.
They remain normal managed policy; exact JSON event/tool/response assertions
must still pass under the effective environment. A visible managed-policy
change that alters those outcomes fails the smoke; invisible policy execution
is outside this functional build-tier claim.

Also resolve canonical `CODEX_HOME\managed_config.toml`, the legacy layer loaded
after CLI session flags. Hash/hold/watch it when present and validate a strict
simple top-level subset: `project_doc_max_bytes` absent or `0`, and remote
session/auto-attach/control/managed-hooks absent or `false`; reject tables,
duplicates, unknown/complex syntax, or conflicting values. Record absence
otherwise. This controls local legacy state only, not cloud requirements.

Every invocation runs Cargo before smoke, even if a prior `ready` manifest
exists. A changed HEAD or dirty fingerprint invalidates prior readiness; it is
never accepted as current evidence. A no-op is accepted only when Cargo reports
zero rebuilt packages and completes in `<=30s`. Tests inject an edit-and-revert,
a transient external Cargo config, an unexpected reconciliation-time source
event, and a watcher overflow; all must fail even when final inventory or Git
digests equal their initial values. A positive reconciliation fixture proves
that only the exact owned mtime poison/restore sequence is admitted.

The two acceptance `ProbeSpec` values are normative and may not be substituted:

- private-core: `core\src\session_prefix.rs`, original SHA-256
  `f8e9500c865c4ae6a6e1b71742f9c3eaf24597062aead78e390e27313359d66c`,
  replace the sole `None => format!("- {agent_reference}"),` with
  `None => ["- ", agent_reference].concat(),`, expected edited SHA-256
  `22b6b7cd519ba754e69b017d6e09c4b7e1d5a05836e3f60bca81d59ab2fef054`;
- high-fanout: `core\src\config\mod.rs`, original SHA-256
  `eb5bfc443624e876f5948a463f7e30f3c7133b3277d73aeb772126905a0e4a59`,
  replace the sole `    pub fn legacy_sandbox_policy(&self) -> SandboxPolicy {`
  with `    #[inline]\n    pub fn legacy_sandbox_policy(&self) -> SandboxPolicy {`,
  expected edited SHA-256
  `8a00abf165a1144ac9d501225896a14b76136146677016e52350de938e256c15`.

Any original hash or exactly-one replacement mismatch fails; do not choose an
easier alternate edit or update hashes post hoc.

## 7. Real launcher smoke contract

Adapt the accepted smoke-candidate logic into `measure-build.ps1`; do not add a
new transport or core execution path. The child environment removes
`CODEX_CORE_PATH`, and evidence must record that it was absent. Invoke the
normal built launcher by its exact target path.
Set the working directory exactly to the newly created
`<evidence-run>\smoke-cwd` for version and both authenticated runs; never
inherit the caller's cwd. Before launch require it to be an empty, regular,
reparse-free directory, retain a no-delete handle, and watch its parent and
contents through all smokes. Any file creation (including AGENTS/CLAUDE
instructions), replacement, watcher error, or overflow fails.

Required runs, serially, with a 180-second timeout each:

```text
<target>\dev-small\codex.exe --version

<target>\dev-small\codex.exe exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --json -c project_doc_max_bytes=0 "Reply exactly FAST_RUNNABLE_OK. Do not use tools."

<target>\dev-small\codex.exe exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --json -c project_doc_max_bytes=0 "Use the shell tool to run PowerShell Write-Output FAST_TOOL_OK, then reply exactly FAST_TOOL_OK."
```

Acceptance:

- Version output is exactly `codex-cli 0.141.0-copilot-api.3`, the locked
  workspace version at the accepted base, and is included in the warm
  build-through-version clock.
- No-tool JSONL has exactly the accepted four-event shape, one exact
  `FAST_RUNNABLE_OK` agent message, no tool item, no parse error, and one
  `turn.completed`.
- Tool JSONL has exactly the accepted six-event shape, one command start and
  completion for the normalized PowerShell `Write-Output FAST_TOOL_OK`, exit 0,
  exact output, exact final agent message, no parse error, and one
  `turn.completed`.
- A hostile caller cwd containing AGENTS/CLAUDE instructions produces the same
  accepted events because the launched process cwd is the verified-empty
  isolated smoke directory and source-verified `project_doc_max_bytes=0`
  disables all project-document discovery for the smoke only.
- Capture only the process IDs descended from the started launcher. On timeout,
  retain each PID with creation time, revalidate both immediately before
  termination, terminate only still-matching descendants, verify they exited,
  and fail the run. Never kill by process name or stale PID alone.
- Before build and cleanup, query `Win32_Process` and compare normalized
  `ExecutablePath` exactly against target-owned `codex.exe`, `codex-core.exe`,
  and any target-owned helper. If path data is unavailable or a match is alive,
  fail closed; do not kill it.
- Record SHA-256/size/mtime for launcher and core before smoke and recheck after
  smoke. Any replacement or mutation fails.
- Record presence and hashes for adjacent `codex-command-runner.exe`,
  `codex-windows-sandbox-setup.exe`, `rg.exe`, and adjacent DLLs without copying
  them from release/install locations or adding them to the two-binary build.
  Do not add PE/import-closure analysis. An optional helper may be absent, but
  if the normal launcher smoke requires it, the smoke fails with the exact
  missing-helper diagnostic; the lane must not silently weaken sandboxing or
  substitute another binary.

Model/network latency after the version run is functional evidence only; it is
not charged to the `<=600s` warm build-through-version SLO.

## 8. Cleanup, retention, and rollback

`runnable --cleanup`:

1. derives the exact target from the current canonical wrapper root;
2. acquires the same external per-target lock and retains it through target
   deletion;
3. bypasses all build-only preflights and retains the owner lock through target
   detachment and deletion;
4. verifies reparse-free containment, target ID, owner root/hash, and the
   external owner manifest;
5. refuses cleanup while exact-path target processes or any recorded/possible
   interrupted Cargo writer tree is alive, or required process inspection is
   unavailable;
6. if the manifest has a recovery journal, first restore and verify its exact
   source bytes/status using the predecessor mechanism but retain/reapply poison
   metadata until detachment succeeds; on failure, retain the journal, poison
   metadata, target, and manifest and refuse cleanup;
7. atomically records cleanup phase `detaching`, deterministic tombstone path,
   and the attached target identity before rename. Rename the target, then
   reconcile and record the tombstone identity as `detached`.
   A crash is resolved from IDs and paths: matching target only means rename
   did not land; matching tombstone with original absent means it landed;
   ambiguous/mismatched state fails without adoption or deletion.
   Rename/identity/manifest failure keeps or reapplies poison metadata and does
   not clear the journal;
8. once detachment is durable, restore and verify original source metadata,
   clear the recovery journal, and revoke manifest ownership of the original
   target path. Any reappeared original path is unowned and must never be
   adopted or deleted by this manifest;
9. deletes only the exact ID-matched tombstone while the external owner
   manifest remains intact, enumerating descendant reparse entries without
   following them and deleting each link object as a leaf;
10. after the tombstone is confirmed absent and no recovery
   journal remains,
   removes the external owner manifest
   and then releases the retained lock file for future reuse;
11. reports and preserves the external owner manifest on any partial deletion
   failure so a later owner-verified cleanup can retry. If a prior cleanup
   detached or removed the target but was interrupted, the next cleanup uses
   only the recorded tombstone identity; it never treats a replacement at the
   original path as owned.

It never accepts an arbitrary path, glob, process name, release target,
installed binary path, or another worktree's target. No automatic cleanup runs
on success. Most persisted-identity `pending` states and partial cleanup are
recoverable under owner verification. The two explicitly unprovable gaps—
created target without persisted file ID, and `cargo-started` without persisted
root PID—are excluded: they remain fail-closed/manual and every generic
recovery/cleanup path must refuse them.

Per-target evidence is bounded outside the watched/deletable build tree under
`D:\codex-targets\.evidence\run-<id>` to the newest eight run directories and
64 MiB total. Each stdout/stderr/JSONL file is capped at 2 MiB with an explicit
overflow failure; compact run JSON, CSV, binary hashes, and Cargo timing hashes
are retained. Smoke redirection writes only there. Pruning runs under the owner
lock and only inside the reparse-free identity-derived evidence directory.
There is no global quota state.

Rollback first runs successful recovery/owner-verified `runnable --cleanup`
while the implementation still exists, verifies target/tombstone absence and
preserves bounded external evidence, and only then reverts the four serial
wrapper commits. Never remove cleanup support before resolving its state.
T1/T2/executable/publish behavior, nested source/gitlink, release targets, and
installed binaries remain unchanged throughout.

## 9. Release/publish preservation

Before the first implementation commit, record SHA-256 for:

- `.github/workflows/publish-npm.yml`;
- `.claude/commands/publish-sandbox-patch.md`;
- `.claude/commands/rebase-upstream.md`;
- `external/repos/codex-patched/codex-rs/Cargo.toml`;
- the nested gitlink and nested HEAD.

After every story and at final acceptance, assert the bytes/hashes and gitlink
are identical to predecessor `2a95dd19`. Existing exact executable/publish argv
tests must remain deep-equal. No story may edit release profile values,
publish packaging, vendor layout, versioning, tags, workflows, or install
scripts.

## 10. Four-story serial implementation

### US-001 - Add the explicit runnable plan and environment

Extend `verify-core-change.sh`, `verify-core-change.mjs`, and
`iteration-env.sh` only. Add the explicit tier/flags, deterministic target,
exact Cargo plan, runnable environment, free-space/MAX_PATH preflight, plan JSON,
and a deterministic fail-closed message for live execution/cleanup until the
runner is completed. Preserve all predecessor tiers and release/publish bytes.
Extend existing Node/shell environment tests. This commit is plan-inspection
complete and does not call a driver that cannot yet accept `runnable`.

Planned commit: `feat(build): add explicit runnable dev plan`

### US-002 - Add owned target lifecycle and freshness

Extend `measure-build.ps1` and its existing unit/real-Cargo tests with the
per-target lock, owner manifest, pending/failed transitions plus the reserved
ready schema, source
provenance/drift checks, bounded source-mutation watcher, exact-path PID checks,
owner-verified cleanup, bounded local evidence, and free-space/size reporting.
Exercise the state machine through fake/real Cargo tests, but keep the public
live tier disabled until US-003 supplies the required smoke-to-ready binding.
Reuse predecessor probe, restoration, reconciliation, narrow-clean, Cargo JSON,
and evidence helpers.

Planned commit: `feat(build): own runnable target lifecycle`

### US-003 - Add normal launcher runtime smoke

Extend `measure-build.ps1` and its existing tests by adapting the accepted
smoke-candidate semantics: adjacent pair, `CODEX_CORE_PATH` absent, version,
authenticated no-tool, benign shell-tool, binary hashes, bounded process tree,
adjacent helper/DLL inventory, smoke summary, and the only final
`ready` transition. Complete the small Node/shell
delegation added as a plan-only stub in US-001 and enable live build/cleanup
only after the full smoke-bound lifecycle is present. Do not add custom
provider, transport, launcher overlay, or direct-core path.

Planned commit: `test(build): smoke runnable launcher pair`

### US-004 - Lock tests, evidence, and documentation

Complete existing Node/PowerShell/real-Cargo tests; run the representative warm
private/high-fanout/no-op acceptance; record bounded compact evidence; update
existing build-performance and developer workflow documentation; assert release
and publish inputs byte-unchanged. Do not add a cold SLO or rerun cold as a
required gate.

Planned commit: `docs(build): document warm runnable tier`

## 11. Validation matrix

Fast deterministic validation after each applicable story:

```bash
bash -n scripts/verify-core-change.sh scripts/iteration-env.sh
node --test scripts/test_verify_core_change.mjs
bash scripts/test_iteration_env_sccache_path.sh
pwsh -NoProfile -File scripts/test_measure_build.ps1
pwsh -NoProfile -File scripts/test_measure_build_real_cargo.ps1
```

Plan-contract checks:

- `runnable --print-plan-json` leaves repository, target, evidence, and owner
  state unchanged and reports the exact argv, target, profile,
  incremental/sccache policy, prerequisite failures, and the permitted
  Cargo-global bookkeeping observation.
- Locked metadata fails on stale `Cargo.lock` without modifying it.
- Existing T1/T2/executable/publish plan JSON and argv are unchanged.
- Unsupported platform live execution/cleanup fails before mutation; logical
  plan inspection remains deterministic.
- Target hash is stable for one worktree and distinct for two worktrees.
- Caller target overrides, unsafe paths, reparse paths, long paths, low disk,
  malformed/unowned manifests, and concurrent locks fail closed.
- A case-insensitive inherited `CARGO_TARGET_DIR` is rejected by the shell
  before iteration-env clearing; Node alone derives the exact target.
- Polluted case variants of `CARGO_PROFILE_*` are cleared/rejected and cannot
  change the checked-in `dev-small` profile.
- Public runnable rejects every predecessor test-hook environment family;
  direct test fixtures cannot redirect production metadata, Cargo, timing, or
  reconciliation.
- Additional Cargo config, a dirty tracked workspace config, configured
  wrappers/profile overrides, `CARGO_HOME`, assume-unchanged, and skip-worktree
  flags all fail before Cargo.

Lifecycle/failure fixtures:

- prior pending becomes failed/interrupted and old binaries are not smoked;
- interrupted controlled probes recover from the flushed bounded journal; a
  missing, oversized, corrupt, or unverifiable journal retains poison state and
  blocks build, smoke, cleanup deletion, and manifest removal;
- stale HEAD, changed gitlink, dirty-state drift, malformed Cargo JSON,
  nonzero Cargo, missing pair, binary replacement, smoke timeout, and failed
  reconciliation end failed and never ready;
- an edit-and-revert during either watcher epoch and a watcher-buffer overflow
  fail even if final Git/content digests match the initial snapshot;
- every post-Cargo failure sets `targetInvalidated`; subsequent ordinary use is
  blocked until owner-locked reconciliation/narrow invalidation or cleanup;
- exact source bytes/status restore on success and failure; metadata restores
  exactly when safe, while failed invalidation retains/reapplies predecessor
  poison metadata and blocks target reuse until recovery reconciliation or
  owner-verified cleanup;
- real Cargo lock/reconciliation tests preserve unrelated artifacts;
- cleanup refuses unowned targets, reparse/path swaps, exact-path live PIDs,
  unavailable PID paths, and other worktrees; owned cleanup succeeds;
- cleanup restores and verifies any recovery journal before target deletion and
  never erases the last recovery record while source metadata remains poisoned;
- concurrent runnable invocations serialize on the owner lock; tests and docs
  reject unsupported raw Cargo use of the reserved managed target rather than
  claiming atomic inheritance of Cargo's internal lock;
- crash-boundary tests cover precommitted `creating` and `detaching` states;
  detached identity and rename/reappearance races never delete a competing
  writer's newly created original directory;
- every pre-detachment cleanup failure retains/reapplies poison metadata and
  the recovery journal, so a failed rename cannot make probe artifacts appear
  fresh;
- build-generated descendant links such as `dev-small\gn_root` are not followed
  and do not make later no-op or owner-verified cleanup unusable;
- controlled warm probes require the exact non-fresh core executable event and
  a core hash different from the pre-probe baseline;
- evidence caps and owner-scoped pruning are enforced.

Final live acceptance, serially on the implementation worktree:

1. Warm no-op: Cargo `<=30s`, zero rebuilt packages.
2. Private-core controlled probe: build start through exact changed launcher
   version `<=600s`; full no-tool and tool smokes pass; restoration and
   reconciliation pass.
3. Post-reconcile no-op: Cargo `<=30s`, zero rebuilt packages.
4. High-fanout controlled probe: build start through exact changed launcher
   version `<=600s`; full no-tool and tool smokes pass; restoration and
   reconciliation pass.
5. Release/publish byte hashes, nested gitlink, and nested HEAD equal the
   predecessor snapshots.
6. Wrapper worktree is clean after tests and evidence is within bounds.

Cold absent-target execution is optional diagnostic evidence only. If run, it
must be reported against the historical failed original target: observed
`648.476s`, original threshold `600s`, verdict fail, validated cold SLO null.

## 12. Explicitly deferred or prohibited scope

Delete from this task and do not implement:

- nested-source, gitlink, Cargo manifest/profile, or Rust changes;
- launcher overlays or direct-core smoke modes;
- native supervisors, stagers, bootstrap binaries, or compressed/BCL loaders;
- elevation, AppContainer, ACL, or capability frameworks;
- brokers, coordinators, nonces, cross-process guard/sentinel protocols, or
  custom child protocols (the local held owner marker above is only a
  filesystem delete blocker);
- custom provider TCP/SSE bridges, continuation protocols, or request parsers;
- machine-global quota registries, reservations, generations, or receipts;
- ETW, PE-closure, image-loader, or DLL staging systems;
- release, publish, packaging, installation, tag, or version changes.

Any future need for those mechanisms requires a separate evidence-backed
security/design task. This plan neither pre-approves nor partially scaffolds
them.

## 13. Definition of done

- One wrapper-only PRD and exactly four serial stories land from predecessor
  `2a95dd19`.
- Exact `dev-small` launcher/core Cargo argv and deterministic target are
  enforced.
- Warm private/high-fanout build-through-version is `<=600s`; warm and post-
  reconcile no-op are `<=30s` with zero rebuilt packages.
- Normal authenticated no-tool and benign shell-tool smokes pass through exact
  `codex.exe`; `CODEX_CORE_PATH` is absent.
- Cold remains a failed `648.476s` observation with no validated SLO.
- Target ownership, interruption, drift, cleanup, disk, process, provenance,
  hash, and bounded evidence rules fail closed.
- T1/T2/executable/publish and release/publish inputs are unchanged.
- Independent code and documentation review report no Medium-or-higher
  findings before merge.
