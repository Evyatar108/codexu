# Stories Outline: Fast Runnable Codex Development Tier

*One wrapper-only PRD, four serial stories, four planned commits. No nested
source, gitlink, Cargo, launcher-overlay, release, publish, install, or codexu
implementation story.*

## US-001: Add the explicit runnable plan and environment

**Description:** As a Codex developer, I want one explicit warm runnable tier
with a deterministic short target so I can build the changed launcher/core pair
without changing any correctness or release tier.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Start from Codex wrapper predecessor
  `2a95dd19c89fc99492d0e5a25d77cb070fe77da3` with nested pin
  `587a6a8ab8948ff912b1f24a62833b277934302d` unchanged.
- [ ] Extend only `scripts/verify-core-change.sh`,
  `scripts/verify-core-change.mjs`, `scripts/iteration-env.sh`, and their
  existing tests for this story.
- [ ] Add explicit `runnable --print-plan-json`, `runnable --confirm-slow`, and
  mutually exclusive `runnable --cleanup`; no implicit tier escalation.
- [ ] Exact Cargo argv is `cargo build --locked --profile dev-small -p
  codex-cli --bin codex-core -p codex-copilot-launcher --bin codex --timings
  --message-format=json-render-diagnostics`.
- [ ] Derive `D:\codex-targets\run-<12hex>` from SHA-256 of the normalized
  canonical wrapper root; reject caller drift, reparse components, and paths
  reaching 240 characters.
- [ ] Before sourcing iteration-env, reject any case-insensitive inherited
  `CARGO_TARGET_DIR`; Node alone derives the target, so clearing cannot hide
  caller drift.
- [ ] Runnable enforces incremental on, sccache and wrappers unset, canonical
  LLVM/xwin/rusty_v8 setup, all `CARGO_PROFILE_*` overrides unset, and 25 GiB
  free; existing iteration and publish modes are unchanged.
- [ ] Reject/clear every pinned-v8 build input (`CCACHE`, clang/C++ overrides,
  trybuild/docs/GN/Ninja/source/mirror/binding/Python/debug variables); Cargo
  supplies HOST/OUT_DIR/CARGO, and only the canonical hashed
  `RUSTY_V8_ARCHIVE` is admitted.
- [ ] Runnable iteration-env does not derive/export the target. Node injects
  its canonical target only into the PowerShell child, whose plan recheck must
  match it.
- [ ] Construct Cargo's child environment from a case-insensitive allowlist
  rather than inheritance. Admit only canonical `CC=clang-cl`, `CXX=clang-cl`,
  `AR=llvm-lib`, and target linker `lld-link`; all other native compiler/flags,
  CMake/Ninja/NASM, bindgen, and AWS-LC override families are absent.
- [ ] Resolve Windows known-folder profile/app-data paths independently, reject
  inherited identity-path drift, and derive every home-based build/auth input
  only from the canonical profile identity.
- [ ] Node remains plan authority. Plan inspection is complete, while live
  execution/cleanup fails with a deterministic not-yet-enabled diagnostic
  until the smoke-bound runner is completed in US-003.
- [ ] Use `cargo metadata --locked --no-deps --format-version 1`; stale
  `Cargo.lock` also requires a separate offline resolving metadata check because
  Cargo 1.97 no-deps does not consult it; neither command rewrites bytes.
- [ ] Define print-plan side effects honestly: no repository/target/owner/
  evidence writes, while canonical Cargo `.global-cache` usage bookkeeping is
  recorded as the sole permitted global mutation.
- [ ] Public runnable rejects `VERIFY_CORE_CHANGE_*`, `MEASURE_BUILD_*`,
  `REAL_CARGO_*`, and `FAKE_*` test-hook environment families.
- [ ] Admit only the clean tracked workspace `.cargo\config.toml`; reject
  `CARGO_HOME`, Cargo config in ancestors/home, hidden wrapper/profile inputs,
  and all assume-unchanged/skip-worktree index entries.
- [ ] Sanitize all Git routing/config variables; bind explicit canonical
  git-dir/common-dir/worktree/index, force accepted Windows
  `core.autocrlf=true`, and emit exact local config/index paths for US-002;
  runtime hash/watch is not part of this story.
- [ ] T1/T2/executable/publish exact argv and flag tests remain deep-equal.
- [ ] Release/publish files and nested gitlink/HEAD remain byte-identical.

**Dependencies:** None

**Planned commit:** `feat(build): add explicit runnable dev plan`

## US-002: Add owned target lifecycle and freshness

**Description:** As a maintainer, I want each runnable target to have exclusive
ownership and fail-closed provenance so interruption or concurrent work cannot
bless stale binaries or delete another worktree's cache.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Extend only existing `scripts/measure-build.ps1` and its existing
  PowerShell/real-Cargo tests for production behavior.
- [ ] Acquire external per-target
  `D:\codex-targets\.locks\run-<id>.lock` with `FileShare.None` before owner
  state, Cargo output, evidence, or cleanup; fail after five seconds and retain
  the lock through target deletion.
- [ ] Define the owner lock as the supported concurrency boundary: concurrent
  runnable invocations serialize, while tests encode the raw-Cargo reserved-
  target diagnostic instead of claiming atomic inheritance of Cargo's internal
  post-exit lock. User-facing documentation belongs to US-004.
- [ ] Keep the full owner manifest beside that lock, flush pending ownership
  before target creation, retain ownership through deletion, and remove it only
  after the target is confirmed absent. Persisted-identity interruption is
  recoverable; the unavoidable create-before-ID crash gap fails closed for
  explicit manual operator resolution and never adopts/deletes the directory.
- [ ] Maintain one bounded atomic owner manifest whose schema supports
  `pending|ready|failed`; US-002 exercises only pending/failed and reserves
  ready/smoke fields for US-003. It records
  target/root identity, run timestamps, wrapper/nested HEAD, index digests,
  content hashes for every dirty/untracked path, exact command/environment/tool
  versions, script hashes, binary hashes, and bounded failures.
- [ ] Consume US-001's exact Git paths/settings and hash/watch local/worktree
  config plus index identities in the lifecycle driver.
- [ ] Reject Git config includes, `core.attributesFile`, and `filter.*`; require
  canonical `git --git-path info/attributes` absent/empty and watched, and
  require tracked `.gitattributes` clean.
- [ ] Bind canonical info/exclude, reject `core.excludesFile`, require tracked
  `.gitignore` clean, and inventory ignored paths. Allow only the two exact
  predecessor non-input output roots; any other ignored content fails.
- [ ] Record bounded path/version/hash provenance for direct build tools and
  xwin root identities; recheck direct executable hashes after build. Do not
  recursively fingerprint sysroot, LLVM DLL, xwin, or dependency-cache trees.
- [ ] Resolve and fingerprint controlled-path cmake/nasm/ninja when present,
  record absence otherwise, and reject resolution outside canonical tool roots.
- [ ] Atomically precommit execution phase `cargo-started` and
  `targetInvalidated=true` immediately before Cargo spawn; interruption,
  and post-Cargo failures remain invalidated; US-003 owns the final ready write.
- [ ] Before any controlled source mutation, flush a <=2 MiB recovery journal
  inside that manifest with the exact original bytes/hash/mtime/attributes and
  expected probe state. Interrupted recovery and cleanup restore/verify it
  before removing the journal or owner manifest; corrupt/oversized/unrestorable
  journals fail closed with poison state retained.
- [ ] Persist `mutationKind`/`recoveryJournalRequired`. Ordinary interrupted
  builds require no journal and full-clean after writer quiescence; controlled
  probes require their journal.
- [ ] A prior pending state becomes failed/interrupted; stale HEAD, changed
  gitlink, index drift, same-path dirty-content drift, untracked drift,
  malformed Cargo JSON, failed build, missing pair, or reconciliation failure
  never becomes ready.
- [ ] Hash every tracked worktree entry through Git's path-aware clean filters
  and compare its object ID with the index, with fsmonitor disabled; status/stat
  shortcuts cannot hide a pre-existing tracked modification.
- [ ] Also aggregate raw on-disk hashes for every tracked regular file/symlink,
  with <=8 MiB path/hash leaves in external evidence. Raw-only or
  non-advancing-mtime changes clean their owning package plus reverse
  dependents; ambiguous mapping full-cleans before Cargo.
- [ ] Use one recovery matrix: trusted controlled probe -> reconciliation;
  clean-watcher post-Cargo smoke/evidence failure with complete Cargo JSON ->
  narrow clean every non-fresh package plus locked-metadata reverse-dependents;
  mutation, watcher/provenance failure, interruption, incomplete events, or
  ambiguity -> full owner-verified cleanup. If recovery cannot safely restore freshness,
  retain or reapply predecessor poison metadata and mark the target invalid.
  Never restore an mtime that could re-bless probe artifacts.
- [ ] Observe wrapper/nested source mutations recursively during each
  build/reconciliation epoch; any unowned event, watcher error, or buffer overflow
  fails. Reconciliation admits only its predeclared, exactly restored
  mtime-only poison/restore transitions. Edit-and-revert and unexpected-event
  fixtures fail even when final digests match the start.
- [ ] Every failure after Cargo starts records `targetInvalidated=true`.
  Ordinary reuse follows the single recovery matrix: controlled reconciliation,
  complete non-fresh-package plus reverse-dependent narrow clean only for
  trusted epochs, otherwise owner-verified cleanup.
- [ ] Watch every admitted/rejected Cargo-config path, including creation under
  absent `.cargo` directories, throughout each Cargo epoch. Transient config
  events, watcher errors, changed inventory/hash, or hidden-index drift fail
  before readiness.
- [ ] Use separate offline locked full metadata only to prove locked resolution
  and warm cache availability. Cargo's locked build owns dependency validation;
  add no archive/tree equivalence or recursive dependency-cache subsystem.
- [ ] Bind the canonical `RUSTY_V8_ARCHIVE` hash into freshness and watch/hash
  it through a retained read/no-write-delete handle on a regular file with
  reparse-free ancestry. Prior drift cleans pinned v8 plus reverse dependents;
  in-epoch identity/hash drift requires full owner-target cleanup.
- [ ] Bound aggregate preflight to 120 seconds as a fail-closed hang timeout and
  record total command-start-to-version separately; do not call it a validated
  performance SLO.
- [ ] Reuse predecessor byte-safe probe apply/restore, metadata restoration,
  Git-status verification, reconciliation, narrow Cargo clean, timing capture,
  and real-Cargo lock tests; add no duplicate restoration engine.
- [ ] Query exact `ExecutablePath` for target-owned processes; refuse build or
  cleanup when a matching PID is alive or path inspection is unavailable;
  never kill by process name.
- [ ] Persist Cargo pre-spawn time and root PID/creation time. Interrupted
  recovery uses periodic live-descendant snapshots, target-bearing process
  checks, and a target watcher through post-exit quiescence. Missing
  identity, mutation, or watcher failure blocks mutation; no ETW/native
  supervisor/elevation is added.
- [ ] `cargo-started` without a persisted root PID is an explicit fail-closed
  manual-resolution gap: never recover/clean/rename/delete because environment-
  inherited target ownership cannot be proven without prohibited native spawn.
- [ ] Cleanup accepts no arbitrary path, verifies owner/containment/reparse
  safety, bypasses build-only metadata/toolchain/free-space preflights, and
  atomically detaches/deletes only the current worktree's target under owner
  lock. Rename/reappearance races fail closed.
- [ ] Precommit `creating` before target creation and `detaching` plus target
  identity/tombstone path before rename. Crash recovery reconciles every
  absent/target-only/tombstone-only/mismatch boundary from persisted volume
  serial and directory file IDs. An existing target with no pre-recorded ID is
  never adopted/deleted. After detachment, revoke original-path ownership;
  retries delete only the ID-matched tombstone.
- [ ] During recovery cleanup, restore source bytes/status but keep poison
  metadata and the journal until detachment is durable. Every pre-detachment
  failure reapplies poison; only then restore exact metadata and clear recovery.
- [ ] Require reparse-free control ancestry, but allow build-generated
  descendant links such as `dev-small\gn_root`; never follow them and delete
  link objects as leaves during cleanup.
- [ ] Require 25 GiB free and record before/after free space and target/profile/
  incremental sizes; add no machine-global quota registry.
- [ ] Retain newest eight per-target runs and at most 64 MiB, with 2 MiB per
  output file under identity-derived `D:\codex-targets\.evidence\run-<id>`;
  production smoke output is added in US-003 and never mutates the watched
  build target.
- [ ] Exercise the lifecycle through existing fake/real Cargo tests but keep the
  public live runnable tier disabled until US-003 adds the required smokes.

**Dependencies:** US-001

**Planned commit:** `feat(build): own runnable target lifecycle`

## US-003: Add the normal launcher runtime smoke

**Description:** As a developer, I want the exact changed `codex.exe` to prove
version, authenticated response, and benign shell-tool behavior through the
normal launcher path before the target is ready.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Adapt accepted `smoke-candidate.ps1` logic into existing
  `measure-build.ps1`; do not add another production script or execution path.
- [ ] Complete Node/shell delegation and enable public runnable build/cleanup
  only after all smoke-to-ready and cleanup contracts are implemented.
- [ ] Fill the reserved smoke summary and transition `pending` to `ready` only
  after required hashes, smokes, provenance, and reconciliation pass.
- [ ] Every enabled run invokes Cargo before smoke. No-op acceptance is
  `<=30s` with zero rebuilt packages.
- [ ] Probe runs record changed-pair hashes/smokes separately; after
  reconciliation, rehash the final pair, pass post-reconcile no-op freshness,
  and rerun all required smokes before final hashes can become ready.
- [ ] A warm probe starts from a ready/no-op baseline, emits a non-fresh Cargo
  artifact for exact target `codex-core.exe`, and changes the core SHA-256 from
  baseline before changed-pair smoke evidence is accepted.
- [ ] Freeze the exact accepted probe paths, sole replacements, and original/
  edited hashes from the plan; any mismatch fails and no substitute edit counts.
- [ ] Unset `CODEX_CORE_PATH` in the child environment and invoke exact
  `<target>\dev-small\codex.exe` with normal `exec --ephemeral
  --skip-git-repo-check --ignore-user-config --ignore-rules --json`.
- [ ] Run every smoke in a new verified-empty, reparse-free
  `<evidence-run>\smoke-cwd` held/watched against file creation; hostile caller
  cwd or stale instruction files cannot affect event acceptance. Both execs
  pass the source-verified project-doc isolation override.
- [ ] Require pre-existing valid-TOML `~\.codex-copilot\config.toml` and an existing
  regular non-reparse Copilot token (never read/recorded), so bootstrap cannot
  mutate or prompt. Parse real TOML using controlled Python 3.11+ stdlib
  `tomllib`; accept unrelated, quoted/dotted/table, and ignored legacy fields.
  Reject inherited `COPILOT_API_HOME`/`CODEX_ENABLE_ANTHROPIC` and only parsed
  true values for local remote/auto-attach/Anthropic enablement. Hold/watch/hash
  exact raw config bytes and expect pinned-core Windows PowerShell even when a
  legacy launcher `default_shell` names Bash.
- [ ] Source-account for the launcher's fixed-profile `.codex\.tmp` deletion:
  refuse non-empty pre-existing cache state, create/hold an exclusive
  owner-sentinel in an otherwise empty canonical directory so removal fails,
  and clean only the sentinel plus a run-created still-empty directory.
- [ ] Build smoke environment from a separate allowlist with canonical
  `CODEX_HOME`; omit all other `CODEX_*`/auth overrides. Use only the
  project-doc isolation override; do not claim cloud-managed features are off.
- [ ] Preserve normal system/cloud-managed policy. Hash/watch known local
  ProgramData config/requirements; enforce exact outcome assertions with
  project-doc isolation, and fail rather than bypass a visible managed conflict.
  Cloud pins are not claimed disabled and no provider transport is added.
- [ ] Hash/hold/watch legacy `CODEX_HOME\managed_config.toml`, which loads after
  CLI flags; parse real TOML and accept unrelated/legacy managed fields. Reject
  only nonzero project-doc max or true remote-session, remote-auto-attach,
  remote-control, or managed-hooks feature values; scope this to local legacy
  state only.
- [ ] US-003 integration keeps every source/config/direct-tool/archive
  watcher plus the recursive target watcher/writer-quiescence guard active
  through the actual final ready write.
- [ ] Version is exactly `codex-cli 0.141.0-copilot-api.3` and closes the timed
  warm metric.
- [ ] Authenticated no-tool JSONL has exactly the accepted four-event shape and
  exact `FAST_RUNNABLE_OK` response with no tool/error item.
- [ ] Benign shell-tool JSONL has exactly the accepted six-event shape, one
  normalized PowerShell `Write-Output FAST_TOOL_OK` command start/completion,
  exit 0, exact output, and exact final response.
- [ ] Each smoke has a 180-second timeout; capture/terminate/verify only the
  descendants of the started launcher, never unrelated process names.
- [ ] Config fixtures accept benign unknown/table/quoted/dotted fields and
  ignored legacy keys in launcher and managed TOML, reject only the enumerated
  conflicting values, reject invalid TOML, leave other-type behavior to the
  real consumer/smoke, and prove any accepted-field byte change during smoke
  still fails hash/watch provenance.
- [ ] Hash launcher/core before and after smoke; replacement or mutation fails.
- [ ] Record presence/hashes of adjacent command-runner, sandbox-setup, rg, and
  adjacent DLLs without PE/import-closure analysis. Never copy release helpers
  or weaken normal sandbox behavior.
- [ ] Full smoke is functional acceptance outside the `<=600s` build-through-
  version clock.
- [ ] No provider transport, direct-core mode, launcher overlay, nested source,
  broker, supervisor, elevation, or security subsystem is added.

**Dependencies:** US-002

**Planned commit:** `test(build): smoke runnable launcher pair`

## US-004: Lock tests, evidence, and documentation

**Description:** As a maintainer, I want deterministic tests, bounded evidence,
and exact contract documentation so the warm-only lane cannot drift into a
cold, correctness, or release claim.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Extend existing verifier, iteration-env, measure-build, and real-Cargo
  tests for target identity, mode isolation, lifecycle, concurrency, stale/
  dirty/interrupted failure, exact-path PID checks, cleanup, evidence caps,
  smokes, and release preservation.
- [ ] Run `bash -n`, Node tests, iteration-env tests, measure-build tests, and
  real-Cargo reconciliation tests; no Rust test/build is required because no
  Rust/Cargo/nested file changes.
- [ ] Warm no-op and post-reconcile no-op each pass `<=30s` with zero rebuilt
  packages.
- [ ] Private-core and high-fanout controlled probes each pass build start
  through exact changed launcher version `<=600s`, plus full normal launcher
  no-tool and benign tool smokes.
- [ ] Preserve exact source bytes/metadata/status after controlled probes and
  leave the wrapper worktree clean.
- [ ] Update existing build-performance/developer workflow docs and compact
  baseline evidence only; no unbounded raw evidence is committed.
- [ ] Report cold `648.476s` as failure against original `600s`, with validated
  cold SLO `null`; do not add a 12-minute or other cold acceptance.
- [ ] Assert release/publish files, nested gitlink/HEAD, and existing optimized
  executable/publish argv are byte-for-byte unchanged from predecessor.
- [ ] Verify rollback ordering: resolve recovery and run owner cleanup while the
  implementation exists, confirm target/tombstone absence while retaining
  bounded evidence, then revert the four wrapper commits.
- [ ] Independent code/docs review converges with no Medium-or-higher finding.

**Dependencies:** US-003

**Planned commit:** `docs(build): document warm runnable tier`
