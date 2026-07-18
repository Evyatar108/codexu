# Stories Outline: Fast Runnable Codex Development Tier

*Two serial PRDs, ten stories, and ten planned implementation commits:
one bounded `codex-patched` strict transport story, one provider-only smoke
capsule story, then eight Codex-wrapper stories with one native cmd bootstrap,
five focused PowerShell IPC/executor helpers, one native Rust security
supervisor, two launcher
overlay seams, and one nested gitlink bump. No parent-codexu implementation
PRD.*

## N-US-001: Add the bounded runnable response stream

**Description:** As a maintainer, I want an opt-in fail-closed Responses
transport so runnable smokes cannot inherit normal request mutation or
unbounded parser behavior.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Start from nested source
  `587a6a8ab8948ff912b1f24a62833b277934302d`.
- [ ] Add one isolated strict `codex-api` response-stream module/export and one
  opt-in `codex-core` client method; normal clients/parsers remain unchanged.
- [ ] Mark every upstream-canonical export/call seam `SANDBOX PATCH`, add
  enforcing replant/unchanged-normal-path tests, and report the exact §14
  invariant plus §15 rebase-replant registration text for US-NET-001's wrapper
  gitlink integration commit.
- [ ] Document why wrapper-owned `codex-copilot` and a new overlay crate were
  rejected: both duplicate/cycle Responses event semantics and invert the
  nested-before-gitlink publication order.
- [ ] Use a dedicated production reqwest builder with trusted Copilot origin,
  no redirects, no gzip/brotli/deflate/zstd decoders, no `Accept-Encoding`,
  and rejection of every response `Content-Encoding`.
- [ ] In sealed runnable mode only, build that client fallibly with reqwest
  0.12.28 `windows_named_pipe`, `no_proxy`, and no ordinary-network fallback;
  pipe/builder errors fail before request. Normal clients remain unchanged.
- [ ] Disable WebSocket/prewarm/fallback before strict dispatch. TLS/SNI/
  certificate validation stays end-to-end over the pipe against the canonical
  Copilot origin; deterministic pipe fixtures prove no DNS/TCP/proxy path is
  attempted and add no dependency.
- [ ] Production URL is exactly
  `https://api.githubcopilot.com/responses` with implicit 443 and no userinfo,
  query, fragment, trailing slash, or alternate encoding; test overrides may
  replace only scheme/authority and retain exact `/responses`.
- [ ] Emit only the plan's exact application-header names/value matrix,
  including `Accept: text/event-stream`; request two may add only validated
  `x-codex-turn-state`. Tests exercise the production builder, not a
  test-only approximation.
- [ ] Authorization comes through the existing public production
  `CopilotHeaderSource`, built from held cached inputs plus one fresh stable
  session UUID reused across both requests. Copy only its sensitive
  `Authorization` `HeaderValue` byte-for-byte; strict code adds/removes no
  scheme/whitespace. Non-secret fixtures compare without logging, and no
  private `build_session_headers` export/visibility edit is allowed.
- [ ] Accept only HTTP 200 with parsed media type `text/event-stream` and at
  most `charset=utf-8`; retain at most 16 KiB from non-success bodies but read
  one extra byte to detect overflow, retain no body text, and cover exact-limit,
  limit+1, 3xx/401/403/429/5xx/204/wrong-media fixtures.
- [ ] Add opt-in strict pre-allocation SSE decoding with 64 KiB line, 128 KiB
  event, 256 event, and 1 MiB request caps; unknown/malformed/truncated/
  overflow input fails.
- [ ] Freeze SSE framing: no BOM/bare CR; LF/CRLF allowed; exactly one
  `event:` plus one `data:` and a blank delimiter; reject duplicate/multiple/
  unknown/id/retry/no-colon fields and `[DONE]`; bounded comments are ignored;
  event name equals JSON `type`; partial or any buffered post-terminal byte
  fails. Cross-chunk fixtures split CRLF, UTF-8, fields, JSON, and delimiters.
- [ ] Bind one nonempty response ID from first `created` through terminal
  `completed`; reject duplicates, mismatch, out-of-order, and same-buffer
  post-terminal events before returning mapped events.
- [ ] Extract one `x-codex-turn-state` under the 1..1024 visible-ASCII contract
  and expose exact replay plus a terminal disposition containing response ID,
  body hash/count, terminal sequence, and a one-shot bounded clean-EOF read
  primitive. Tests cover claim-before-EOF, EOF-before-claim, and EOF racing the
  claim without embedding coordinator/broker state in codex-api.
- [ ] Add only `sha2.workspace = true` to `codex-api/Cargo.toml` and compute the
  terminal body hash incrementally in the strict decoder; the dependency is
  already workspace/lockfile-resolved, so Cargo.lock and profiles are unchanged.
- [ ] Deterministic tests assert exact header sets/value relationships,
  status/media/encoding gates, bounded error handling, request counts, raw
  event ordering, terminal cancellation, and unchanged normal transport.
- [ ] Targeted `codex-login` named-pipe builder tests and scoped
  `just fix -p codex-login` are included alongside codex-api/core validation.
- [ ] No Cargo manifest change beyond that one codex-api workspace dependency,
  and no profile/lockfile or unrelated nested source changes.

**Dependencies:** None

**Planned commit:** `feat(api): add bounded runnable response stream`

**Estimated complexity:** medium

## N-US-002: Add the nested isolated runnable smoke session

**Description:** As a maintainer, I want an internal provider-only session so
real model smokes cannot initialize or invoke configured local capabilities.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Start from the reviewed N-US-001 tip; verify its merge-base is nested
  source `587a6a8ab8948ff912b1f24a62833b277934302d`.
- [ ] Add one core smoke-capsule module, one exec adapter module, the named
  early `exec::run_main` dispatch, core export, and optional low-level exec
  visibility/refactor; mark every seam `SANDBOX PATCH` with replant tests.
- [ ] Parse/validate mode and exact allowed CLI shape from the sealed environment
  in the first exec branch, before normal config/cloud/policy/auth/telemetry/
  state/environment/thread/session construction.
- [ ] Construct only the minimum in-memory provider auth client, model client,
  prompt, response stream, cancellation, and one optional tool-result
  continuation; never enter normal managers, instructions, dynamic tools,
  workers, routers, or lifecycle hooks.
- [ ] Freeze the exact allowed exec CLI plus a compile-time smoke-only base
  instruction hash; any extra option or external instruction source fails
  before provider I/O.
- [ ] Freeze complete `capsule-model-info-v1` metadata for exact
  `gpt-5.6-sol` as the exact hashed no-skip
  `RunnableModelInfoFixtureV1`; explicitly map/assert every `ModelInfo` field,
  never call `/models`, set provider request/stream retries to zero, and
  disable websocket/prewarm/fallback and credential refresh.
- [ ] Require one or more matching `ResponseEvent::ServerModel` observations
  for every provider request, deduplicate identical header/SSE values, and fail
  absence, conflict/mismatch, or model change across the tool continuation.
- [ ] `deny-all` returns zero complete model-visible tool specs/handlers.
- [ ] `exact-sentinel` registers only a private smoke-specific function
  schema/handler that
  validates exact command/cwd/options before hooks, implicit permissions, exec
  policy, or apply-patch interception, then uses only the low-level PowerShell
  rewrite to freeze argv and submits one authenticated coordinator
  `spawn-guard` request; model code never creates a sentinel-profile child and
  accepts tool output only from the authenticated broker result envelope.
- [ ] The two-request tool turn reuses one `ModelClientSession`, captures one
  unique nonempty model call ID, and echoes it exactly in
  `FunctionCallOutput`; missing/duplicate/changed IDs fail closed.
- [ ] Define the versioned nonce-record schema and implement the nested
  core-side `driver-claimed -> core-claimed -> guard-issued`, deny-all
  `core-claimed -> consumed-no-guard`, terminal-claim/EOF-challenge/final, and
  startup handle-attestation/ready-gate requests behind one injected broker-
  client interface; nested code never opens the record.
  Unit tests inject broker replies representing issuer/guard-consumer states
  and cover replay, replacement, expiry, parent identity, every claim/EOF
  ordering, retained query-handle denial, and crash boundaries;
  wrapper record/broker/driver/guard integration is deferred to US-NET-001.
- [ ] Own nested RESULT/ACK/DELIVERED framing and validation: four-byte LE plus
  canonical JSON bounds, exact correlations/Base64/hashes, ACK/result binding,
  post-flush DELIVERED binding, malformed/trailing/crash rejection, and no
  FunctionCallOutput before valid DELIVERED. Tests use injected broker frames;
  persistence/coordinator capture remains US-NET.
- [ ] Freeze request two as original input plus every authoritative completed
  request-one item in original order plus exactly
  `FunctionCallOutputPayload { body: Text("FAST_TOOL_OK"), success: Some(true) }`
  (`metadata=None`), whose wire `output` is the plain string
  `"FAST_TOOL_OK"`; fixture tests include request-one reasoning items.
- [ ] Construct and snapshot complete `ResponsesApiRequest` JSON for deny-all,
  exact-sentinel request one, and its continuation: exact model/instructions/
  input/tools/tool-choice, `parallel_tool_calls=false`, `reasoning=null`,
  `store=false`, `stream=true`, `include=[]`, and omitted None-valued
  service-tier/cache/text/client-metadata fields. The sentinel advertises
  only the plan's exact strict `shell` schema; compare the three literal
  minified fixture byte strings.
- [ ] Recursively sort every JSON object key before wire serialization and
  prove targeted-package and workspace-feature-unified tests produce identical
  fixture bytes/hashes.
- [ ] Before continuation reject `FunctionCall.namespace` and every admitted
  item's `ResponseItem.metadata`; preserve only bounded reasoning continuity
  fields, and prove the fixture request-two bytes contain no optional metadata.
- [ ] Use only N-US-001's production client/header builder; capsule code cannot
  append normal core metadata/cache/trace/beta/session/thread/attestation/
  timing fields or headers.
- [ ] Core returns a typed transcript only; the exec adapter emits the canonical
  existing event types and exact accepted four/six-event JSONL; typed-event
  tests compare the plan's complete newline-terminated bytes with fixed thread/
  item IDs, command/output/status, and zero usage.
- [ ] Consume only N-US-001's strict transport and freeze every accepted
  `ResponseEvent` multiplicity/reconciliation rule before tool action.
- [ ] Bound each authoritative completed item to 8192 serialized UTF-8 bytes,
  request-one completed items to 32768 bytes, and request-two `Prompt.input` to
  65536 bytes; oversize reasoning/tool context fails before sentinel execution.
- [ ] Capture N-US-001's validated `x-codex-turn-state` on request one and
  replay it exactly on request two in the same session.
- [ ] Export a unit-tested raw-byte SHA-256 helper from the existing
  `codex-config` fingerprint module; add no manifest dependency.
- [ ] Complete tool-schema snapshots and hostile system/cloud/user config fixtures
  prove zero configured processes, markers, mutations, prompt injection, or
  unguarded children; all non-provider constructor/invocation counters stay
  zero.
- [ ] Add required `core/tests/suite/runnable_smoke.rs` integration coverage;
  register it in `core/tests/suite/mod.rs`;
  after targeted core/exec tests pass, run repository-mandated complete
  `just test` with operator approval before fix/format.
- [ ] No Cargo manifest/profile or unrelated nested source changes.

**Dependencies:** N-US-001

**Planned commit:** `feat(core): add isolated runnable smoke session`

**Estimated complexity:** medium

## US-001: Add the explicit runnable plan and isolated target

**Description:** As a Codex developer, I want an explicit warm runnable tier
with a dedicated per-worktree target so I can run the changed launcher/core
pair without weakening correctness or publish gates.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `runnable` is accepted beside
  `targeted|workspace|executable|publish`; no tier is implicit.
- [ ] T1/T2 never escalate and existing executable/T4 plans remain exact.
- [ ] Non-Windows runnable plan inspection is deterministic and side-effect
  free as `planKind=logical-unsupported` with unresolved tool templates;
  build/recovery/cleanup fail before environment/control-state mutation, while
  other tiers are unchanged.
- [ ] Runnable rejects `--confirm-slow`; selecting one exact reviewed
  per-operation launcher template is the explicit slow-operation authorization.
  Existing executable/publish confirmation behavior remains unchanged.
- [ ] Every runnable mutation requires a full elevated administrator token
  whose token user SID matches the held worktree/Git-common owner and canonical
  profile; alternate credentials/non-elevated use fail before mutation and the
  lane never invokes UAC. Plan inspection remains non-elevated.
- [ ] The shell discards ambient `CODEX_ITERATION_MODE`, selects runnable only
  for the exact runnable tier, and forces the predecessor default for all other
  tiers; unknown direct-source modes fail.
- [ ] Runnable mutation accepts no opaque worktree-emitted request. The fixed
  protected native `runnable-bootstrap-v1.exe`, its SHA-256/staging ACL,
  accepted wrapper commit, reviewed `launcher-v1`, and exact per-operation templates come from the
  independent implementation review/terminal record. Each template fixes one
  visible subcommand and permits only its named syntax-restricted fields. The
  frozen set is `build-version`, `authenticated-smoke`, `populate`,
  `prewarm-noop`, `private-warm`, `high-warm`, `post-noop`,
  `recover-interrupted`, `recover-source-drift`, `cleanup`, and
  `cleanup-orphan`; every normal target-bearing template includes mandatory
  `WorktreeRoot`, optional explicit `TargetRoot` (default `D:\codex-targets`),
  and only its documented extras. Ambient target-root input is cleared;
  scenario/probe/budget/authentication are compiled constants.
- [ ] Native supervisor is `no_std`/`no_main`, `panic=abort`,
  `/NODEFAULTLIB`, and dependent-load System32 policy. Recursive PE evidence
  resolves direct/transitive/forwarded imports through pinned API-set namespace
  and activation-context/SxS policy to Microsoft-signed system files, proves no
  candidate TLS directory/callback or assembly/redirection/bound/delay/
  dynamic-loader surface, binds the closure to the OS build, and rejects any
  other dependency before execution. At first instruction it verifies the PEB
  set, then registers DLL notifications and protected Kernel-Image ETW before
  other APIs; every later image load must match the held signed closure, and
  loss/overflow/unmatched images terminate non-ready.
- [ ] Track/audit seed-stager, full stager, and launcher PowerShell sources, but
  never execute a worktree copy elevated. Deterministically encode only the
  seed-stager with a frozen minimal no-follow/identity/ACL/hash-copy native
  allowlist. Deterministically raw-deflate its reviewed source into a fixed BCL
  loader, regenerate byte-exact with pinned Node/zlib settings, and test the
  full cmd `<=7900` against the 8191-character cap. It stages reviewed scripts
  into protected ProgramData and executes none before hash/identity proof.
- [ ] Invoke protected `stager-v1.ps1` by a short exact `-File` template. It
  streams the native candidate through held handles while hashing, recursively
  parses direct/transitive/forwarded PE/API-set/SxS dependencies, verifies
  Microsoft signatures and forbidden-loader absence, emits the closure
  manifest, applies protected ACLs, and renames by handle. Candidate/worktree
  code never establishes its own trust boundary.
- [ ] Every operation uses an exact reviewed protected `launcher-v1.ps1`
  `-File` template, never direct EXE/worktree-script execution. Its cmd prefix clears managed/profiler/
  PowerShell injection variables before Windows PowerShell initializes and
  sets only syntax-restricted template fields. Launcher verifies staged handle/hash/ACL/closure/
  OS binding and IFEO/AppCompat state, then creates native supervisor with
  pre-entry image-load/extension-point/dynamic-code mitigations, System32 cwd,
  minimal environment, held EXE/parent handles, and explicit protected
  Administrators/SYSTEM process/thread security descriptors supplied at
  creation rather than repaired later.
- [ ] Every normal template requires an operator-visible absolute
  `WorktreeRoot`, pinned before watcher arming. The `cleanup-orphan` template
  alone accepts absent `RecordedWorktreeRoot` plus explicit Git-common root,
  target ID, and owner-record hash; it runs entirely in approved bootstrap code
  without repository script/source execution or a fictitious source watcher,
  using pinned trusted Git with sealed config only for `worktree list
  --porcelain`.
- [ ] Before invoking Git, parsing provenance, or executing any repository
  byte, the native supervisor validates privilege/self hash/protected staging,
  pins the explicit worktree
  root, and arms its recursive watcher. It then pins trusted Git/config,
  resolves the operator-approved commit, pins every parent/file in that
  commit's complete executable closure with write/delete/rename sharing
  denied, verifies held files against accepted blobs, writes pessimistic state,
  and snapshots provenance under the active watcher.
- [ ] Before PowerShell image creation, native bootstrap sets trusted cwd,
  minimal environment/PATH, `SetDefaultDllDirectories`/empty DLL directory,
  and `STARTUPINFOEX` image-load mitigations; fixed no-profile PowerShell gets
  only explicit pipe handles and an embedded loader. Hostile cwd/PATH DLLs,
  profiler variables, or user modules cannot execute pre-verifier.
- [ ] Native supervisor retains root/closure/lock/watcher handles and sequence
  for life. It streams verified PowerShell bytes over a bounded pipe;
  PowerShell remains Cargo/source/evidence executor and journals mutations over
  duplex IPC, while Bash/Node receive no authority handles and never spawn
  children. Parent death fails closed.
- [ ] Native parent launches Git Bash `--noprofile --norc` in bounded
  `--emit-env` mode; shell sources iteration env, emits one NUL-delimited
  record, and spawns nothing. PowerShell validates it and asks native parent to
  create Node/Cargo/Git/Python/all wrapper-owned roots. No orchestration child
  calls `CreateProcess`; Cargo/rustc/linker/approved build scripts may create
  only Job+ETW-observed pinned toolchain/target descendants.
- [ ] Native bootstrap sets trusted machine-only `PSModulePath`; hostile user
  module autoload cannot run.
- [ ] Native bootstrap case-insensitively clears
  `DOTNET_*`/`COREHOST_*`/`COMPlus_*`/`COR_*`/`CORECLR_*`; a hostile profiler
  marker cannot run before PowerShell sanitization.
- [ ] Resolved Windows Cargo argv invokes the canonical non-reparse absolute
  `rustup which cargo` result, sets the recorded absolute rustc, and uses
  `--locked --profile dev-small`, `codex-cli/codex-core`, and
  `codex-copilot-launcher/codex`.
- [ ] Before isolated environment construction, one bounded no-network
  tool-resolution child uses the held canonical operator `.rustup` home and
  exact rustup to resolve/pin Cargo/rustc. Actual metadata/build/smoke children
  use empty scratch `RUSTUP_HOME` and only those absolute files; no rustup proxy
  runs after isolation.
- [ ] `iteration-env.sh` adds a runnable mode while its existing default mode
  remains unchanged.
- [ ] Runnable mode keeps the canonical LLVM/xwin/V8 setup, enables
  incremental, disables sccache/wrappers without touching the shared server,
  freezes `CARGO_BUILD_JOBS=8` with no runnable override, and clears inherited
  profile/compiler/linker/target/job-count option injection. Other modes keep
  predecessor override behavior.
- [ ] Runnable mode restores canonical
  `CARGO_PROFILE_RELEASE_LTO=off` and
  `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16` after case-insensitive cleanup.
- [ ] The complete protected build-environment allowlist has explicit value
  rules; it rejects surviving noncanonical
  Cargo/rustc/profile/target/compiler/linker/wrapper variables.
- [ ] Build PATH/ComSpec/PATHEXT/TEMP are constructed from pinned tools and
  owner scratch rather than inherited; descendant images outside pinned tools
  or the owned target fail.
- [ ] Plan JSON freezes the required no-network AppContainer identities,
  isolated homes, exact source/tool/cache RX roots, target/scratch RW roots,
  ACL lease registry, and recovery states; execution remains inert until
  US-CAP-001 implements and proves them.
- [ ] Rustup, Cargo, rustc, clang-cl, llvm-lib, and lld-link use held recorded
  absolute path/version/hash identities; PATH-shadow or mid-run swap fixtures
  cannot redirect them.
- [ ] Git Bash, PowerShell, Node, Git, the Python launcher, and Python 3.11 are
  likewise resolved from accepted roots, held, recorded, and invoked only by
  absolute path.
- [ ] Every executable launch holds no-delete handles on each canonical parent
  component; barriered parent rename/replace cannot redirect `CreateProcess`.
- [ ] Git system/global config is suppressed; held local/worktree config rejects
  includes, filters, attribute overrides, and executable fsmonitor/hook/diff
  helpers; held repository attributes and Git-common `info/attributes` have no
  active filter; held Git-common `info/exclude`, repository ignores, and empty
  global excludes cannot hide inputs, and transient creation/mutation fails.
- [ ] Untracked provenance includes both ignored and non-ignored files without
  relying on `git status` completeness.
- [ ] No-follow enumeration rejects every source-tree reparse and multiply
  hardlinked source file; tracked/untracked/ignored external-link targets and
  mid-build external mutations cannot bypass watchers/provenance.
- [ ] Measured Cargo is offline; proxy variables and credentials are stripped,
  and locked dependencies are a pre-run prerequisite.
- [ ] A real Cargo sentinel-wrapper fixture proves configured rustc wrappers
  are neutralized by explicit empty child overrides.
- [ ] Runnable rejects any Cargo config candidate except the pinned workspace
  config at normalized-LF SHA-256
  `b8ae1cea341beb2d4a3c8fb81f97a96f4aee1fd53f769c57f140dfe949806a80`;
  both LF and accepted Windows CRLF raw hashes are recorded.
- [ ] Every possible config-parent/Cargo-home path is continuously watched with
  non-overlapping sequenced drain barriers; transient create/delete fails.
- [ ] Plan-only JSON records `metadata.status=not-run-plan-only` and frozen
  logical workspace/package/bin expectations without Cargo/scratch. After an
  elevated mutating invocation owns profiles/leases/scratch, real
  `cargo metadata --locked --offline --no-deps --format-version 1` must match;
  caller metadata injection cannot select runnable execution.
- [ ] Only optional `--run-id` is caller-supplied and maps to the existing
  PowerShell transaction parameter. Probe/scenario/budget/authentication/
  authentication values are compiled into the chosen native subcommand and have
  no public flag or environment substitution.
- [ ] Target identity is stable per wrapper worktree, distinct across
  worktrees, and pinned to one owner-verified root.
- [ ] Complete target path is `<=80` characters.
- [ ] Before mutation, every process-visible cwd/executable/control/evidence/
  temp/home/guard/probe path and command/environment block satisfies the plan's
  Windows length bounds; filesystem run names use a fixed hash tag.
- [ ] Plan JSON defines exact artifacts, owner/control/evidence roots, and
  operations without adding a parallel executor.
- [ ] `implementationReady=false` keeps build/recovery/cleanup inert through
  US-004, including US-CAP-001 and US-NET-001; only plan inspection is exposed.

**Dependencies:** N-US-002; accepted predecessor HEAD `2a95dd19...`

**Planned commit:** `feat(build): add isolated runnable plan`

**Estimated complexity:** medium

## US-CAP-001: Add recoverable capability and ACL leases

**Description:** As a maintainer, I want every runnable child confined by a
recoverable AppContainer and exact concurrent ACL lease so build/smoke access
cannot inherit operator authority.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Keep AppContainer/profile/ACL lease APIs and all authoritative
  descriptor mutation in `scripts/runnable-bootstrap-v1.rs`.
  `scripts/manage-runnable-capability.ps1` is only the typed executor-side IPC
  adapter and fixture surface; do not duplicate the lifecycle in PowerShell/C#.
- [ ] Create stable user-scoped `CodexRunnable.<targetId>.executor`,
  `.inspector`, `.build`, `.model`, and `.sentinel` profiles with `CreateAppContainerProfile`,
  derive/verify all package SIDs, and retain them only for owned target lifetime.
- [ ] Freeze profile creation capabilities to none. Stable package SIDs receive
  no data ACL. Native generates per-run 256-bit role capability SIDs, splits
  source/tool read from secret target-write/credential/scratch capabilities,
  supplies the exact set through `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`,
  stores raw values only in locked memory/admin-only ProgramData with no
  operator read ACE, emits only keyed opaque role labels and hashes to normal
  evidence, blocks token queries, and removes ACEs after drain. Any capability
  identity visible on an operator-readable source/tool ACL is read-only and
  non-secret; target-write/scratch-write/credential identities appear only on
  admin-owned objects that deny non-elevated `READ_CONTROL`.
- [ ] Executor receives only executor-scratch RW plus system PowerShell and
  exact pinned Bash/Node/Python installation/runtime RX, no source/target/
  authority/network, and child-process creation
  is prohibited. Inspector receives source/non-authority Git RX only and also
  cannot create children. Build receives source/cache/tool RX plus target/build-scratch RW. Native
  copies held/hash-verified Copilot token/device/machine bytes into an
  admin-owned per-run `smoke\credential-capsule` sibling outside all
  model-writable roots, without leasing the user-owned originals. Supervisor
  seals child `COPILOT_API_HOME` plus a query-only directory handle to that
  exact identity; launcher rejects default/profile/ambient fallback. Model
  receives target/capsule RX and model-scratch RW only during smoke; held
  handles/DACL deny capsule write/delete/replace, then native removes its ACE
  and handle-wipes it after drain. Launcher config remains coordinator-only.
  Sentinel receives held PowerShell/system plus exact target-launcher RX,
  target-directory traverse, and sentinel-scratch RW only; no core/other-target
  read or target write. Isolated homes expose no other credentials/config.
- [ ] For exact held `.rustup`/Cargo/xwin/V8/Git/LLVM/Bash/Node/Python paths lacking
  effective role-token RX, use the same elevated global baseline-plus-live-lease
  state machine to add per-run RX/traverse-only capability ACEs and restore them
  after Job drain. Never grant write/delete/ACL/owner rights. Windows/System32 and the
  shared PowerShell installation remain unmodified and must already be
  readable; drift/restore failure is a prerequisite failure.
- [ ] Isolated Cargo home exposes only exact read-only journaled cache
  projections. Native supervisor arms non-overlapping recursive watchers on
  canonical shared cache/tool roots before any lease or projection and holds
  them through child drain; any event, overflow, identity/security drift, or
  post-drain mismatch fails even if bytes are restored. A lane-local lock is
  not treated as external-writer exclusion.
- [ ] Store operator-global protected state under
  `%ProgramData%\CodexRunnableSecurity\v1\operators\<operator-sid-hash>\`,
  independent of caller-selectable target roots, with one `lease.lock`,
  immutable per-object baselines, and `<targetId>-<runTag>` executor/
  inspector/build/model/sentinel leases. Stable package SIDs receive no data
  ACE. Open/create every
  Administrators-owned protected component relative to pinned ProgramData
  handles with only SYSTEM/Administrators full and no operator/package/
  capability read ACE; forbid LocalAppData/caller roots and parent
  `DELETE_CHILD` authority.
- [ ] Each lease is durably
  `prepared -> applied -> removing -> removed`, recording canonical object
  identity, exact baseline SDDL, per-run role-capability SID ACEs, live lease IDs, and profile
  identity before mutation.
- [ ] Under the global lock, current ACL must equal baseline plus exactly all
  registered live leases. Apply/remove only this run's exact ACEs and verify
  baseline plus remaining leases; never restore a stale whole descriptor.
- [ ] Concurrent leases on the same mutable source/cache/scratch object coexist; crashes
  before/after every transition remove only a dead run after its Jobs/provider-
  bridge drain.
  Unknown ACL/profile/SID drift remains non-ready and is preserved.
- [ ] Arm the immutable bootstrap's source watcher first; after accepted
  closure/lock verification and before source mutation/children,
  apply/reconcile all per-run role-capability leases. Journal and match any
  watched-root security event. Remove executor/inspector/build/model/sentinel
  leases after Job/ETW/provider-bridge drain; between runs target is Admin/
  SYSTEM only, and owner-verified cleanup deletes all five
  profiles only during owner-verified cleanup.
- [ ] Seal target/scratch with low mandatory labels and protected inheritable
  DACLs: SYSTEM/Administrators full, exact per-run secret capability rights
  (stable package SIDs get none), no user/Users/
  Everyone write, and `OWNER RIGHTS` without data-write/`WRITE_DAC`/
  `WRITE_OWNER`. Model is target-RX only. Verify every existing descendant and
  inherited new output; same-user unrelated low-IL processes remain denied.
- [ ] Every runnable mutation requires a same-operator full elevated token and
  never invokes UAC. Derive the expected non-group user SID from matching held
  worktree/Git-common owners, resolve/verify that SID's profile/LocalAppData,
  and reject alternate credentials. Authority files remain explicit medium-
  label/admin-only protected DACL and every descendant remains lowbox.
- [ ] Public build/recovery/cleanup remains blocked by
  `implementationReady:false`.

**Dependencies:** US-001

**Planned commit:** `feat(build): add recoverable runnable capability leases`

**Estimated complexity:** large

## US-002: Harden the runnable transaction and source recovery

**Description:** As a build-performance maintainer, I want the canonical
measurement transaction to own process lifetime, source stability, probe
recovery, and restored-source reconciliation.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `measure-build.ps1` remains the sole Cargo/source/evidence executor.
- [ ] Node delegates runnable execution once; PowerShell requests only
  plan-only Node JSON, so there is no recursive execution marker.
- [ ] One protected ProgramData OS-exclusive lock keyed by pinned Git-common
  repository identity is held across owner validation, build,
  hashes, all smokes, evidence, restoration, reconciliation, no-op, and final
  manifest.
- [ ] Recursive source watchers plus exact provenance snapshots allow only
  journaled probe transitions; any other event/overflow becomes
  `source-drift` and prevents ready.
- [ ] The worktree watcher arms first; held `.git`/`commondir` discovery then
  pins Git-common and arms one non-overlapping external Git-common watcher
  before any further Git-admin read or Git invocation. In-root Git-common uses
  the existing source watcher. Both domains share the same sequenced
  drain/rescan barrier.
- [ ] The protected native supervisor remains the sole security coordinator and
  retains bootstrap-closure/root/lock/watcher handles, provenance, sequence,
  and pessimistic manifest through finalization. It streams verified scripts to
  the mitigated PowerShell executor and authorizes journaled mutations over
  bounded duplex IPC; Bash/Node are workers with no authority handles.
  Edit-and-restore races never execute elevated repository markers and always
  fail closed.
- [ ] ProgramData authority/evidence never needs a source-watcher exclusion.
  Git-common remains watched; only an optional non-authoritative locator/
  receipt may be an exact journaled coordinator write, while every other
  `.git` event fails. Deleting/replacing the locator cannot fork authority.
- [ ] `--recover-source-drift` requires a plan-inspected exact stable provenance
  SHA acknowledgement, archives drift evidence, invalidates the whole owned
  target, and performs a complete rebuild/smokes/no-op with no cold SLO.
  Wrong/stale acknowledgement or any new event remains non-ready.
- [ ] Cargo and smoke roots are assigned before resume to the transaction and
  per-root kill-on-close Job Objects.
- [ ] A non-ready manifest is atomically written/flushed before journal,
  source, Cargo, or target mutation.
- [ ] Every suspended Cargo/smoke root is flushed to the durable process ledger
  with PID, creation time, image path, role, and Job Object assignment before
  resume.
- [ ] Process creation uses `PROC_THREAD_ATTRIBUTE_JOB_LIST`, eliminating the
  create-to-assign gap; crash fixtures cover creation, ledger flush, and resume
  boundaries.
- [ ] Every nominal root requires bounded per-root
  `ActiveProcesses == 0`; a non-draining descendant tree is terminated and the
  run is non-ready.
- [ ] Pre-armed kernel-process ETW and Job completion events are reconciled so
  short-lived descendant image identities cannot escape the allowlist; loss or
  unmatched PIDs fail.
- [ ] ETW start/running/stopped name/GUID/provider state is flushed in the
  transaction journal; recovery authenticates/stops only the exact orphan,
  never a similarly named session, and crash fixtures cover every start/drain/
  stop boundary.
- [ ] Acquiring the lock beside stale `building` state classifies it as
  `interrupted` and requires explicit recovery.
- [ ] Ordinary builds reject running exact-path target launcher/core processes,
  ignore same-named other paths, and never kill by name.
- [ ] Existing byte-safe probes retain exact changed binary hashes.
- [ ] A flushed recovery journal records exact original/edited state and file
  identity before probe mutation.
- [ ] Probe apply/restore writes and flushes same-directory temporaries and
  uses `ReplaceFileW` with a journaled displaced backup; kill tests prove no
  partial source bytes or unclassified orphan files.
- [ ] The displaced backup is the compare-and-swap check; barriered concurrent
  edits are classified as pre/post-replace races; concurrent canonical bytes
  are preserved and never overwritten by owned recovery.
- [ ] Recovery accepts exact original/edited content under the pinned parent
  after atomic-replacement file-ID change, preserves third-party bytes or
  parent/reparse drift, invalidates the owned target when needed, and performs
  a complete rerun with no cold SLO.
- [ ] Recovery invalidation uses the same handle-relative, reparse-safe,
  crash-journaled deletion state machine as cleanup.
- [ ] Reconciliation failure leaves target non-ready and journal retained;
  public cleanup refuses it and explicit recovery owns invalidation/rerun.
- [ ] Successful restoration reconciles through the same runnable command,
  then a final no-op rebuilds zero packages within 30 seconds Cargo wall time.

**Dependencies:** US-CAP-001

**Planned commit:** `feat(build): harden runnable transaction and source recovery`

**Estimated complexity:** large

## US-003: Add the owner-verified target lifecycle

**Description:** As a maintainer, I want quota admission and cleanup to be
owner-pinned, crash-recoverable, and unable to traverse a swapped path.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Default target root is short local fixed-drive NTFS
  `D:\codex-targets`; other hosts require an explicit safe NTFS root.
- [ ] Before owner/reservation/target creation, a disposable sentinel proves
  persistent identities, parent-relative no-follow open, same-parent rename,
  and handle-disposition deletion.
- [ ] New targets require 20 GiB free; warm targets require 8 GiB free.
- [ ] One protected ProgramData quota lock per held NTFS volume plus durable
  reservations containing target-root identity/path hashes prevent concurrent
  worktrees under different roots from consuming the same volume free-space
  allowance.
- [ ] Quota directories, lock, and reservations are admin-only and
  opened/updated relative to held ProgramData handles; target root/volume
  identities are independently pinned and no authoritative quota state lives
  below the caller-selected root.
- [ ] Reservation schema `codex-runnable-quota/v1` records random
  reservation/owner generations, monotonic record sequence, state, volume/
  root/target/repository IDs, owner digest, transaction ID, PID/creation time,
  reserved bytes, protected relative lock locator, and held lock identity;
  owner generation equals the owner record and transaction ID is the lock
  generation. Freeze field types and separate live
  `prepared -> reserved -> releasing` from generation-keyed retained `removed`
  receipts. Prepared/reserved/releasing live files count full bytes; after a
  durable removed receipt binds the final live hash, delete/flush only that
  live file so a later generation can create-new. Receipt+live crash resumes
  deletion; receipt-only is idempotent; unknown/regressed/mismatched state
  blocks admission and tests cover every flush/rename/delete edge.
- [ ] Locking is nonblocking and ordered: own transaction outermost; volume
  quota and operator lease locks are brief and never overlap; no transaction
  lock is acquired under a global lock. Stale quota pruning snapshots under
  quota including the complete canonical record/hash and every schema field;
  it probes only that protected relative lock after release, then revalidates
  every field/hash/generation/sequence under quota. Absolute/caller
  locators fail. Barriered multi-root/multi-volume admission-cleanup
  tests prove no deadlock or over-admission.
- [ ] Protected ProgramData control tree, transaction lock, manifests, evidence,
  and authoritative scratch journal are opened relative to held no-reparse
  parent identities; lowbox-writable scratch remains under the held target. A
  lock-parent swap cannot fork state.
- [ ] Authority/control/quota/evidence records are explicit
  medium-integrity no-write-up objects with no descendant write/delete/rename/
  ACL-owner rights; no authoritative copy lives under the writable target or
  user-removable Git-common, and target identity comes only from the protected
  ProgramData owner record.
- [ ] Cleanup deletes only the owner-pinned target and retains protected ProgramData
  evidence.
- [ ] Cleanup revalidates reparse-free components and persisted volume/file
  identity, renames to a same-parent tombstone, revalidates, and rejects
  junction/path-swap or nested-reparse attacks.
- [ ] Tombstone contents are opened through parent-handle-relative
  `NtCreateFile`, inspected no-follow, matched against file ID/attributes
  captured by handle-based enumeration, and deleted by handle disposition; no
  path-based recursive deletion is used.
- [ ] Cleanup intent and tombstone identity are flushed before/after rename;
  rerunning cleanup safely resumes injected crashes at each transition,
  including both paths absent after completed deletion.
- [ ] Cleanup records `already-released` when owner-bound removed receipt exists
  and no live quota record, or `live-generation` for one matching live record.
  The first branch performs no quota transition; the second finalizes receipt
  then deletes live. Conflicts fail before rename; crash fixtures cover both.
- [ ] A retained terminal cleanup receipt makes absent
  target/owner/live-reservation state idempotently provable while the
  generation-keyed quota receipt remains retained.
- [ ] Recovery-only orphan cleanup accepts recorded worktree root, Git-common
  root, target ID, and matching owner-record hash only as pinned discovery/
  authorization inputs after the recorded worktree is absent and no longer
  registered. Both roots must byte-match the owner record; no caller target
  path is accepted. Recreated roots, live processes, or ownership mismatch fail
  before the identical deletion/receipt path.

**Dependencies:** US-002

**Planned commit:** `feat(build): add owned runnable target lifecycle`

**Estimated complexity:** large

## US-NET-001: Add the authenticated smoke network boundary

**Description:** As a maintainer, I want authenticated smokes mediated by one
attested coordinator-owned provider bridge so zero-network lowbox children
cannot forge authority or reach any other endpoint.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Consume the already-landed N-US-001 terminal disposition and N-US-002
  core broker/attestation protocols without adding nested code in PRD B.
  US-NET owns wrapper coordinator state, pipe/handle-table enforcement, and
  launcher driver/guard integration only.
- [ ] Keep provider/nonce pipe, socket, attestation, quota, and byte-copy
  ownership in `scripts/runnable-bootstrap-v1.rs`; do not duplicate it in
  PowerShell/C#. `scripts/manage-runnable-smoke-network.ps1` is only the typed
  executor-side coordinator-IPC adapter and deterministic fixture surface.
- [ ] Record the locally validated N-US-002 tip (including N-US-001) as
  `external/repos/codex-patched` and register both nested commits' marked seams,
  invariants, enforcing tests, and rebase-replant notes in
  `docs/implementation/patch-surface.md` §14/§15 in this commit.
- [ ] Add only the two source-verified launcher overlay seams: sealed
  read-only/never smoke config with Windows `unelevated`,
  `allow_login_shell=false`, `unified_exec=false`; and smoke-only suppression
  of real `~\.codex\.tmp` cleanup. In those same two files, own the smoke-only
  driver/guard role validation, query-handle receipt/stripping, and exact
  authenticated sentinel spawn-request construction/guard validation, not
  nested RESULT/ACK/DELIVERED validation. The guard never
  calls `CreateProcess`; native coordinator alone spawns PowerShell. Mark/test
  every branch as `SANDBOX PATCH`.
- [ ] Create the explicitly medium-label/owner-DACL nonce record/broker and implement
  coordinator persistence/capture/delivery, issuer/driver/guard integration,
  and terminal cleanup. N-US-002 owns all nested core/exec broker clients,
  framing, ACK/DELIVERED validation, and output gating.
- [ ] The random nonce pipe is first-instance/local-only with narrow distinct
  per-run model-nonce capability access for driver/core and sentinel-nonce
  capability access for guard, plus
  mutual client identity checks against PID, creation time, image, parent
  chain, role, and Job/ETW membership.
- [ ] Coordinator retains its source process handle and injects separate
  inheritable `PROCESS_QUERY_LIMITED_INFORMATION` duplicates directly into
  each coordinator-owned driver, core, and guard
  `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`; none may duplicate/pass it onward and
  all three start child-process-prohibited, clear handle inheritance, validate
  coordinator identity/derive the broker session, and close the handle before
  a coordinator session-ready gate. Coordinator enumerates each target handle
  table and opens the gate only when zero references to its process object
  remain; unsupported query or a held self-duplicate fails. Guard excludes it
  from PowerShell. Nonce clients require pipe server PID =
  `GetProcessId(handle)` and query creation time/image through that handle.
- [ ] Launcher supplies coordinator and coordinator supplies every child with
  creation-time Administrators owner/group and protected SYSTEM/
  Administrators-only process/thread DACL, restrictive `OWNER RIGHTS`, and no
  operator/package/capability ACE; native first instruction verifies it.
  Non-elevated operator and every lowbox token fail `OpenProcess` query/
  duplicate AccessCheck; after ready-gate release, live hostile opens still
  fail.
- [ ] Tests reject PID reuse, inaccessible/closed/wrong-access handles,
  spoofed/extra/remote pipe servers, mismatched package/client processes, and
  replay/concurrent transition attempts; a deliberate self-duplicate fixture
  blocks the ready gate and fails, inherited-child attempts are prevented, and
  no general process-query ACL is granted.
- [ ] Executor/inspector/build/model/sentinel profiles all have zero network capability;
  executor/inspector plus model driver/core and sentinel guard have child-
  process creation prohibited. Direct
  TCP/UDP/DNS/WinHTTP/loopback/LAN fixtures fail.
- [ ] Create a separate random first-instance local-only provider pipe with DACL
  limited to coordinator plus per-run model-provider-pipe capability.
  Authenticate the client as the exact stable model package SID and held
  `codex-core.exe` PID/creation/image/Job member.
- [ ] Both nonce/provider names use exactly the AppContainer-accessible
  `\\.\pipe\LOCAL\codex-runnable-<targetId>-<runTag>-<64hex>-<role>`
  namespace; reject ordinary/remote/alternate/caller-controlled names and prove
  zero-capability clients can open only the sealed LOCAL instances.
- [ ] Resolve only canonical `api.githubcopilot.com` on the coordinator, pin
  addresses, and open at most two sequential coordinator-owned TCP connections
  to pinned addresses on port 443. Never accept child destination/proxy input.
- [ ] Blindly bridge pipe bytes to TCP so TLS/SNI/certificate validation stays
  in the child. Bound at most two sequential authenticated connections, 4 MiB
  per direction per connection, and transaction timeout; the capsule separately
  enforces one/two HTTP requests. Core sends a nonce-bound terminal claim after
  strict terminal/same-buffer validation. Coordinator either flushes
  `ack-close`, or if EOF raced, flushes a two-second `EOF_PENDING` challenge;
  core then performs exactly one bounded read and sends a challenge-bound final
  only for clean EOF. Every claim/EOF/challenge/final ordering is tested.
  Pre-terminal/partial EOF, excess/third connection/address drift or ACK
  loss/replay/mismatch fails; post-ACK coordinator close succeeds.
- [ ] N-US-001's strict client selects reqwest `windows_named_pipe` with
  `no_proxy`, redirects/decoders/WebSocket/prewarm/fallback disabled, and no
  normal-network fallback on any error. Normal transport remains unchanged.
- [ ] Coordinator crash closes pipe/TCP while model has no alternate egress;
  recovery proves provider pipe/socket and model Job drained before leases.
- [ ] Both provider and nonce pipes have byte mode, remote-client rejection,
  low mandatory SACL, Administrators owner/group, restrictive `OWNER RIGHTS`,
  protected SYSTEM/Administrators DACL with no operator trustee, and exact
  client masks. Non-elevated same-user `WRITE_DAC`/owner-change tests fail and
  stable package SIDs receive no pipe data ACE. Provider grants only the
  per-run model-provider-pipe capability reqwest GR/GW/synchronize; nonce
  grants narrower data/read-control/synchronize separately to per-run model-
  nonce and sentinel-nonce capabilities.
- [ ] Pre-create/hold exactly one deny-all or two exact-sentinel provider server
  instances with matching `nMaxInstances` before child resume. All slots stay
  occupied by the coordinator; extra-instance creation fails `ERROR_PIPE_BUSY`.
- [ ] Provider reqwest is path-only and does not claim local server-PID
  attestation; trust is the saturated pre-created instances plus end-to-end TLS
  to the canonical provider. Inherited-handle server authentication applies
  only to the custom nonce pipe.
- [ ] Explicitly reject inherited connected sockets because they bypass
  connect-time policy, hand Winsock to the child, and do not fit reqwest's
  public connector.
- [ ] The exact PowerShell sentinel uses a separate no-network scratch-only
  token. The coordinator alone starts the held target launcher in guard role
  under that token/Job with sentinel-scratch cwd and the query handle; guard
  strips provider/query handles before PowerShell.
- [ ] Coordinator creates bounded stdout/stderr capture pipes, passes only write
  ends guard-to-PowerShell, caps each stream at 4 KiB, JSON payload at 16,380
  bytes, and four-byte-prefixed frame at 16,384 bytes,
  authenticates guard/payload exits/Job drain, and returns one length-prefixed
  nonce-bound result envelope to the waiting core request.
- [ ] Result state is `none -> pending -> ready -> delivered|failed`; require
  exit 0, exact `FAST_TOOL_OK\r\n`, empty stderr, hashes/counts, core ACK,
  durable broker `delivered` flush, and non-retryable crash semantics from
  pending onward.
- [ ] Consume N-US-002's frozen four-byte-LE/canonical-JSON result framing.
  Wrapper coordinator creates bounded RESULT, validates the nested ACK, flushes
  DELIVERED binding result+ACK hashes, and tests persistence/capture/crash
  edges. Nested frame/DELIVERED validation is already landed and no nested code
  changes in this story.
- [ ] Public execution and launcher smoke dispatch remain compile-time disabled
  through this commit.

**Dependencies:** N-US-002, US-003

**Planned commit:** `feat(build): add authenticated runnable smoke boundary`

**Estimated complexity:** large

## US-004: Add exact smokes and retained evidence

**Description:** As a Codex developer, I want the exact built launcher/core
pair exercised with isolated controlled smokes and durable bounded evidence.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Warm budget execution requires an owner-matching prewarm plus successful
  zero-package `runnable-noop`; absent-target population is diagnostic only and
  has no cold SLO.
- [ ] A warm budget miss records `budget-failed` and never becomes ready.
- [ ] Add `scripts/smoke-runnable-tier.ps1` from the accepted brainstorm driver.
- [ ] Each successful build passes exact adjacent launcher `--version` with
  `CODEX_CORE_PATH` unset before becoming ready.
- [ ] Controlled acceptance explicitly pins `--model gpt-5.6-sol`, passes
  the frozen no-override exec CLI, and accepts only the exact four-event
  no-tool JSONL and one-command/six-event `pwsh ... FAST_TOOL_OK` JSONL.
- [ ] Effective config resolves to Windows `RestrictedToken`; a deterministic
  outside-scratch write is denied before live model execution.
- [ ] Each allowlist-rebuilt smoke environment has a fixed mapping: version is
  isolated driver with no policy, no-tool is isolated driver/`deny-all`, and
  tool is isolated driver/`exact-sentinel`; all include canonical guard,
  held real PowerShell, exact cwd, and expected-vector identities.
- [ ] The initial model launcher validates sealed driver values against the
  broker, sends one authenticated `spawn-core` request, and never calls
  `CreateProcess` or sets guard role. Native coordinator alone creates core.
  Only the coordinator-created sentinel
  launcher receives/validates guard role and nonce before PowerShell; inherited,
  replayed, unknown, or mismatched combinations fail.
- [ ] Recovery handles partial, nonterminal, and either terminal nonce branch
  idempotently after Job/provider-bridge drain. Evidence stores only nonce
  hash/state.
- [ ] N-US-002 makes no-tool advertise exactly zero tools and tool smoke exactly
  the dedicated pre-hook sentinel handler, independent of
  MCP/plugin/hook/skill/dynamic/model config.
- [ ] Guard deny-all spawns no payload; exact-sentinel requires the frozen full
  post-UTF8-rewrite argv and sentinel-scratch cwd, with login shells disabled,
  before a coordinator-owned cross-profile guard requests native coordinator
  to invoke only the held real PowerShell command; guard never calls
  `CreateProcess`.
- [ ] Core emits `FunctionCallOutput` and the six-event transcript only after
  validating RESULT, sending ACK, and validating broker's post-flush DELIVERED
  confirmation; overflow, broken pipe, timeout, nonzero, extra child, malformed
  framing, or result-delivery crash leaves non-ready and cannot retry the guard.
- [ ] Adversarial legacy-shell, explicit alternate-shell, and apply-patch
  fixtures prove zero untrusted payload spawn and zero file mutation before any
  live model smoke.
- [ ] Timeout cleanup terminates only the captured per-root job and verifies
  bounded zero-descendant exit.
- [ ] Missing/non-interactive auth is a prerequisite failure; no login,
  bootstrap, token content, or credential-derived data is used.
- [ ] `dev-small`, launcher, core, and PowerShell inputs are held no-write/
  no-delete through smokes. The coordinator alone holds/validates launcher
  config and seals only its selected-setting digest to children.
- [ ] The target-local launcher search directory is ACL-sealed under its target
  lock/journal and restored after success/interruption; the shared PowerShell
  ACL is never mutated and must already deny the smoke token write/create/
  delete/ACL-owner access. Imported/adjacent files are inventoried/held and
  mutation fixtures are denied.
- [ ] Owner-pinned per-run NTFS `CODEX_HOME`/`TEMP` scratch is journaled,
  capped, and deleted through the hardened primitive after bounded evidence
  copy; recovery exclusively owns interrupted scratch, while cleanup handles
  terminal scratch-cleanup-pending state only.
- [ ] Model uses only `smoke\model\codex-home` and `smoke\model\temp`; sentinel
  uses only separate `smoke\sentinel\temp` for cwd/TEMP/TMP and has no model-
  scratch access.
- [ ] Cargo-home cache junction projections are individually journaled and
  cleaned no-follow by exact reparse tag/substitute/target identity before the
  ordinary reparse-rejecting recursive walk; unknown/swapped junctions preserve
  scratch and fail recovery.
- [ ] Launcher curated-cache cleanup is skipped only in smoke driver/guard mode
  and remains unchanged normally; the transaction owns scratch cleanup and a
  real-user `~\.codex\.tmp` sentinel remains unchanged.
- [ ] Imported DLLs and optional helper availability are recorded without
  claiming publish completeness.
- [ ] Smoke preflight parses existing launcher config with `tomllib`, requires
  exact pwsh/default-shell plus disabled CLAUDE.md/Anthropic/remote settings,
  rejects ambient/operator nondefault `COPILOT_API_HOME`, then requires the
  child-only value/held handle to equal the sealed credential-capsule identity
  with no fallback. It forces `CODEX_ENABLE_ANTHROPIC=off` and records only
  redacted provenance.
- [ ] Launcher config/parent and the exact PowerShell executable are held
  no-write/no-delete through smokes; barriered post-preflight swaps fail.
- [ ] Cached `copilot_token` plus device/machine IDs are present; expiry exceeds
  900 seconds, and exactly those three files/parent are held read-only so
  refresh/creation cannot occur. `github_token` receives no model ACE and is
  never opened.
- [ ] Ambient provider keys are stripped and parent/cwd project instruction
  fixtures cannot change the sentinel contract.
**Dependencies:** US-NET-001

**Planned commit:** `feat(build): add exact runnable smokes and evidence`

**Estimated complexity:** large

## US-005: Prove deterministic safety and activate the lane

**Description:** As a maintainer, I want the complete hostile-path fixture
matrix green before the public runnable execution gate can activate.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Existing Node/PowerShell/real-Cargo suites cover exact plans,
  environment isolation, configured-wrapper neutralization, Cargo-config
  boundary, target identity, root pinning, quota/MAX_PATH, owner mismatch,
  lock contention, Job Object termination, interrupted recovery, exact-path
  process checks, root quota reservations, cleanup/path-swap/crash recovery,
  recovery invalidation, source-drift watchers/snapshots, atomic Job assignment,
  target/artifact-handle stability, absolute held tool/config identity and
  executable-parent swap/PATH shadowing,
  offline/proxy isolation, quota-control no-follow identity, filesystem
  capability rejection, model isolation, held launcher-config/PowerShell
  identity, project-doc isolation, atomic probe replacement/concurrent-edit recovery,
  coordinator executable pinning, non-overlapping watcher drain barriers,
  per-root descendant drainage, owned scratch cleanup, unsupported-platform
  logical plans, Git filter/attributes/textconv zero-helper execution,
  transient `info/attributes`, .NET profiler bootstrap isolation, all-path
  length budgets, immutable inline elevated bootstrap, full bootstrap-closure
  pin/hash, pre-repository watcher arming, edit-and-restore races, exact
  zero/shell-only tool schemas, RestrictedToken denial,
  timeout, hash drift, and unchanged existing tiers.
- [ ] End-to-end nonce fixtures cover concurrent guard consumers, replay,
  wrong parent/image, replacement/expiry, deny-all terminal, and crashes
  immediately before/after each terminal flush and payload spawn; no crash
  state can authorize a retry or escape Job Object cleanup.
- [ ] Hostile build scripts and smoke children cannot modify/delete/rename/
  hardlink/reparse/change ACL-owner on any authority record or forge broker
  transitions; all identities, hashes, ACLs, and markers remain exact.
- [ ] Hostile build scripts cannot read profile credentials or open
  TCP/UDP/DNS/WinHTTP sockets; authenticated smoke cannot reach
  loopback/LAN/DNS/any endpoint directly, and provider-bridge/ACL lease crash
  recovery removes only the exact run's state.
- [ ] AppContainer tests cover stable executor/inspector/build/model/sentinel profile create/
  derive/token/delete APIs, exact zero-capability creation
  capabilities, stable-profile plus per-run secret-capability lease
  reconciliation, between-run Admin/SYSTEM-only target state, and every
  `prepared/applied/removing/removed` interruption without stale-descriptor
  restoration.
- [ ] Target tests prove the low label, protected inherited Admin/SYSTEM/
  exact per-run role-capability/OWNER-RIGHTS DACL, no stable package-SID data
  ACE, one-time existing-tree seal, new-output inheritance, model RX-only
  access, and denial to unrelated same-user low-IL processes.
- [ ] Provider-bridge tests assert exact model-package/core pipe client,
  coordinator-only pinned provider TCP/443, no destination/proxy input, TLS
  opacity, 4 MiB/time/request caps, no normal-network fallback, direct-network
  denial, crash/EOF closure, and unrelated-process pipe denial.
- [ ] Pipe tests cover inherited query-only coordinator-handle success, no
  general lowbox process-query ACL, PID reuse, denied/closed/wrong handle,
  spoofed server, extra instance, role-specific per-run model/sentinel pipe-
  capability DACLs plus stable package peer-identity checks,
  coordinator-owned cross-profile guard spawn, PowerShell handle stripping,
  creation-time pre-DACL race denial, post-gate lowbox `OpenProcess` denial,
  capture overflow/broken pipe/nonzero/extra child, and ready/ACK crash points.
- [ ] `just test -p codex-copilot-launcher` passes before live acceptance;
  scoped `just fix -p codex-copilot-launcher` and `just fmt` run after tests,
  then T2 is the post-format compile gate; Rust commands source the frozen
  iteration environment and tests are not rerun after fix/format.
- [ ] Probe fixtures cover success, Cargo failure, hard kill,
  atomic-replace-before-journal recovery, third-party recovery conflict,
  reconciliation failure, and evidence survival.
- [ ] Cleanup fixtures barrier-swap a child name between enumeration and open;
  enumerated and opened file IDs/attributes must match before any deletion.
- [ ] CI remains deterministic: no real long Codex build, network,
  authentication, or arbitrary target deletion.
- [ ] The two accepted probe specs are tracked under
  `docs/implementation/build-perf-artifacts/` with the complete frozen
  schema-v1 path/hash/Base64 values from the plan.
- [ ] The single `implementationReady=true` change occurs only in this story
  after all deterministic and targeted Rust gates above pass.
- [ ] The launcher smoke-environment dispatch constant is enabled only in this
  story, atomically with `implementationReady=true`.

**Dependencies:** US-CAP-001, US-002, US-003, US-NET-001, US-004

**Planned commit:** `test(build): prove runnable safety and activate lane`

**Estimated complexity:** medium

## US-006: Prove warm acceptance and converge reviews

**Description:** As the Codex maintainer, I want controlled warm evidence and
clean code/docs reviews before accepting local wrapper commits.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Real trusted-trampoline `workspace` verification passes; plan JSON is not
  a substitute.
- [ ] Compact baseline freezes accepted warm observations: no-op `9.030s`,
  private build-through-version `92.963s`, and high-fanout
  build-through-version `98.635s`.
- [ ] Private changed-core build-through-version completes `<=600s`.
- [ ] High-fanout changed-core build-through-version completes `<=600s`.
- [ ] Exact changed hashes pass version, no-tool, and benign shell-tool smokes.
- [ ] Post-reconcile no-op Cargo wall time completes `<=30s` and rebuilds zero
  packages; version-smoke duration is reported separately.
- [ ] Cold `648.476s` remains a failed original target with no cold SLO and no
  routine cold rerun.
- [ ] Baseline also freezes incremental-off private edit `170.032s` and
  incremental storage cost `5.184-7.286 GiB`; these are evidence/limitation
  values, not new acceptance SLOs.
- [ ] Source restoration, target ownership, lock/Job Object state, disk sizes,
  provenance, and raw-evidence hashes are recorded.
- [ ] Raw evidence remains outside the target/worktree for the retention window.
- [ ] Independent implementation closeout records the exact fixed one-line
  per-operation native templates, reproducible native source/build command,
  staged bootstrap-v1 EXE SHA-256/protected ACL/identity plus loader-complete
  PE closure manifest, accepted wrapper commit, tracked seed/full-stager/
  launcher sources and hashes, exact seed encoded command with measured
  `<=7900` cmd length, protected stager/launcher paths and exact short `-File`
  invocations/field matrices, and each native field matrix. No
  worktree path emits or overrides operations or trust anchors.
- [ ] After evidence finalization and before lead worktree removal, run
  owner-verified cleanup and verify the retained protected ProgramData
  `cleanup-complete` receipt through authenticated supervisor output; any
  Git-common receipt is non-authoritative diagnostics only;
  exercise receipt/owner-authenticated orphan cleanup as the interrupted
  closeout fallback.
- [ ] Only the named N-US-001 strict transport/parser seams, N-US-002
  provider-only capsule/handler entry seams, their tip gitlink, and two launcher
  overlays changed; no other nested source, Cargo profile/manifest beyond
  N-US-001's one `codex-api` sha2 workspace-dependency line,
  release/publish command, vendor layout, install, tag, release, or push.
- [ ] Baseline records those exact warm/incremental values/storage and
  `cold observed=648.476`, `original target=600`, `verdict=fail`,
  `coldSlo=null`.
- [ ] Docs keep T1, T2, runnable, optimized executable, and T4 distinct; label
  `dev-small` as non-debug/non-runtime/non-publish fidelity; preserve sccache
  and cold-limit honesty.
- [ ] Only proven tier-list/test surfaces change; no speculative runbook or
  workflow sweep.
- [ ] Independent `gpt-5.6-sol` `xhigh` code review converges with no
  Critical/High/Medium findings.
- [ ] Independent `gpt-5.6-sol` `xhigh` docs review converges clean.
- [ ] Implementation uses two reviewable nested commits plus eight reviewable
  wrapper commits, with bounded review-fix commits if needed.
- [ ] Lead closeout pushes and fresh-fetch verifies the nested SHA before any
  wrapper remote can reference its gitlink, then pushes wrapper remotes before
  parent codexu.
- [ ] Parent codexu gitlink and overview closeout remain later lead-owned work.

**Dependencies:** US-005

**Planned commit:** `docs(build): record runnable acceptance contract`

**Estimated complexity:** medium
