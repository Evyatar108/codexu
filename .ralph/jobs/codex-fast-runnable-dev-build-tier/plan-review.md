# Plan Review: Fast Runnable Codex Development Tier

Review model: `gpt-5.6-sol`

Reasoning effort: `xhigh`

Scope: independent planning review only; no implementation.

## Round 1

Result: **5 Medium-or-higher findings**

1. **High - reconciliation failure conflicted with cleanup rules.**
   - The draft retained the probe journal through reconciliation, made public
     cleanup refuse a journal, and also required cleanup on reconciliation
     failure.
   - Fix: reconciliation failure now leaves the target non-ready and retains
     the journal. Explicit recovery owns owner-verified invalidation and a full
     rerun. Public cleanup refuses unrecovered journal state.

2. **High - Cargo configuration policy could admit noncanonical inputs.**
   - The draft attempted partial TOML-key rejection and omitted hidden
     configuration families.
   - Fix: remove the new TOML parser. On the controlled host, allow only the
     pinned workspace `.cargo\config.toml` at its exact SHA-256 and reject every
     other workspace-ancestor or `CARGO_HOME` config. Recheck the candidate set
     and hash after execution.

3. **Medium - recursive executor boundary trusted spoofable internal
   environment.**
   - Fix: public Node execution delegates once to PowerShell; PowerShell calls
     Node only with `--print-plan-json`, which cannot execute. Runnable ignores
     caller metadata injection and requires real locked Cargo metadata. No
     recursive execution marker remains.

4. **Medium - `iteration-env.sh` was omitted despite repository guidance and
   stale tier wording.**
   - Fix: add an explicit runnable mode that reuses canonical LLVM/xwin/V8
     setup while selecting incremental-on/sccache-off. Preserve default mode
     behavior and update its tier guidance/tests.

5. **Medium - implementation decomposition was disproportionate.**
   - Fix: retain one wrapper PRD and four serial stories, but use three
     independently reviewable implementation commits instead of one monolith.
     Reduce the speculative file sweep and add files only when grep proves a
     tier-list/test dependency.

## Round 2

Result: **1 High and 4 Medium findings**

1. **High - Cargo config hashing/environment policy rejected the accepted
   Windows checkout and could be bypassed by environment configuration.**
   - Fix: use a normalized-LF identity hash while recording accepted raw LF and
     CRLF hashes. Add case-insensitive protected-variable cleanup/allowlisting
     and restore the canonical release LTO/codegen values required by the
     repository's frozen iteration contract.

2. **Medium - measured public flags and artifacts were incomplete.**
   - Fix: define exact public-to-PowerShell mapping for probe/scenario/run/budget
     flags; add the two accepted tracked probe JSON files and the
     iteration-environment test to the implementation file plan.

3. **Medium - runnable budgets were descriptive rather than executable.**
   - Fix: `runnable-warm` now automatically enforces build start through exact
     version smoke. `runnable-noop` automatically enforces Cargo wall time plus
     zero rebuilt packages. Both metrics are added to compact evidence.

4. **Medium - cleanup did not resist target path replacement.**
   - Fix: persist volume/file identity, re-walk reparse-free components, rename
     to a same-parent tombstone, revalidate identity and nested entries, then
     delete. Add junction/path-swap fixtures.

5. **Medium - interrupted-state transitions lacked a flushed process ledger.**
   - Fix: flush each suspended root's PID/creation/image/role/Job assignment
     before resume; classify stale `building` under an acquired lock as
     `interrupted`; require explicit recovery and verify the ledger.

## Round 3

Result: **5 Medium findings**

1. **Medium - launcher smoke inputs were not controlled.**
   - Fix: parse existing launcher config with Python `tomllib`, require exact
     PowerShell 7/default-shell and disabled CLAUDE.md/Anthropic/remote options,
     resolve the actual `COPILOT_API_HOME` token root, and record only redacted
     config/token provenance.

2. **Medium - warm acceptance could run against an absent cold target.**
   - Fix: require an owner-matching population transaction plus a successful
     zero-package `runnable-noop` before any `runnable-warm` run. Population is
     diagnostic with no SLO. Add durable `budget-failed` state.

3. **Medium - cleanup lacked crash-recoverable transitions.**
   - Fix: add `transaction.json`, flushed cleanup intent/tombstone states, and
     idempotent resume rules with injected-crash tests.

4. **Medium - quota checks raced across distinct worktrees.**
   - Fix: add a target-root quota lock and durable logical space reservations;
     conservatively reclaim only provably stale reservations.

5. **Medium - required edit-budget/conflict metadata was missing.**
   - Fix: record considered seams, chosen wrapper placement, bounded
     production/test/docs line budget, zero upstream-canonical edit budget, and
     wrapper integration/re-conflict probabilities.

## Round 4

Result: **1 High and 5 Medium findings**

1. **High - cleanup still had a reparse TOCTOU window.**
   - Fix: add a focused handle-relative deletion helper that opens entries
     no-follow, rejects reparse entries, verifies per-entry identity, and
     deletes through handles rather than recursive paths.

2. **Medium - Job assignment had an unjournaled creation gap.**
   - Fix: create child processes with `STARTUPINFOEX` and
     `PROC_THREAD_ATTRIBUTE_JOB_LIST`, then flush the suspended root ledger
     before resume.

3. **Medium - post-delete cleanup crash could not finalize.**
   - Fix: when flushed state is `cleanup-renamed` with matching identity, both
     original and tombstone absent is verified prior deletion and cleanup
     finalizes idempotently.

4. **Medium - nondefault `COPILOT_API_HOME` contradicted launcher bootstrap.**
   - Fix: reject nondefault roots for acceptance rather than adding a launcher
     source change.

5. **Medium - absent Anthropic config preserved ambient opt-in.**
   - Fix: require canonical launcher config and force
     `CODEX_ENABLE_ANTHROPIC=off` in the smoke child.

6. **Medium - simple public examples lacked required scenario/run IDs.**
   - Fix: define deterministic operation-specific synthesized scenarios and
     safe UTC/nonce run-ID prefixes whenever public flags omit them.

## Round 5

Result: **2 High and 4 Medium findings**

1. **High - probe source writes were not crash-atomic.**
   - Fix: apply/restore through flushed same-directory temporary files and
     atomic replacement; recovery accepts only complete original/edited hashes
     under the pinned parent identity. Add kill-boundary fixtures.

2. **High - recovery target invalidation bypassed hardened cleanup.**
   - Fix: recovery uses the same private handle-relative, reparse-safe,
     crash-journaled deletion state machine while retaining the probe journal.

3. **Medium - target identity was not held stable during Cargo.**
   - Fix: hold no-follow target-root and target handles denying delete sharing
     through build and smoke; revalidate identities before/after.

4. **Medium - fixed run IDs could overwrite retained evidence.**
   - Fix: acceptance examples use generated UTC/nonce IDs; explicit IDs require
     atomic create-new reservations and collisions fail without truncation.

5. **Medium - frozen probe specs omitted complete schema values.**
   - Fix: embed both complete schema-v1 path/hash/Base64 objects in the plan and
     require byte-for-byte tracked copies.

6. **Medium - tool smoke drifted from the accepted driver.**
   - Fix: restore the accepted PowerShell prompt and normalized outer
     `pwsh.exe -Command 'Write-Output FAST_TOOL_OK'` shape.

## Round 6

Result: **1 High and 5 Medium findings**

1. **High - probe recovery still rejected legitimate atomic-replace identity
   change.**
   - Fix: accept exact original/edited hashes under the pinned parent/no-reparse
     identity even when the file ID changed; continue to reject third-party
     bytes, parent drift, or reparse drift.

2. **Medium - smoke model was not explicit.**
   - Fix: pin and record `--model gpt-5.6-sol`.

3. **Medium - ignored config/rules did not suppress project instructions.**
   - Fix: pass `-c project_doc_max_bytes=0` and add parent/cwd project-doc
     isolation fixtures.

4. **Medium - artifact hashes could race replacement before execution.**
   - Fix: retain no-write/no-delete handles for `dev-small`, `codex.exe`, and
     `codex-core.exe` from handle-based hashing through each process exit.

5. **Medium - Cargo/tool identities and build environment remained
   under-specified.**
   - Fix: invoke canonical absolute Cargo, set absolute rustc, pin LLVM tool
     paths, and enumerate the complete protected build-environment value rules.

6. **Medium - handle-relative deletion lacked an implementable seam.**
   - Fix: specify `remove-owned-runnable-target.ps1` with parent-handle-relative
     `NtCreateFile`, handle-disposition deletion, and a barriered child-name
     swap fixture.

## Round 7

Result: **1 High and 4 Medium findings**

1. **High - atomic probe replacement could overwrite a concurrent edit or
   strand unjournaled temporary state.**
   - Fix: journal temp/backup/conflict names before creation, use
     `ReplaceFileW` with a displaced backup as the compare-and-swap check,
     preserve/restore unexpected bytes, and classify every crash-state file
     combination.

2. **Medium - ambient runnable mode could alter non-runnable tiers.**
   - Fix: the shell discards inherited mode, selects runnable only from the
     exact tier positional, forces the predecessor default otherwise, and tests
     hostile ambient values.

3. **Medium - proxy inheritance contradicted the credential boundary.**
   - Fix: measured Cargo is offline, all proxy variables are stripped, and
     locked dependency fetch is an explicit prerequisite.

4. **Medium - tool and Cargo-config hashes had a replacement TOCTOU.**
   - Fix: pin absolute rustup/Cargo/rustc/LLVM identities and retain
     no-write/no-delete tool/config handles through final evidence.

5. **Medium - a target could be created on a filesystem unsupported by safe
   cleanup.**
   - Fix: require NTFS and pass a pre-owner sentinel capability test for stable
     IDs, relative open, rename, and handle disposition deletion.

## Round 8

Result: **2 High and 4 Medium findings**

1. **High - concurrent source drift could bless stale/mixed binaries.**
   - Fix: add recursive source watchers, baseline-plus-journal snapshots,
     `source-drift` non-ready state, exact restored baseline, and a final
     zero-rebuild stabilization gate before ready.

2. **High - cleanup enumeration did not capture pre-open identity.**
   - Fix: enumerate file ID/attributes/reparse tag from the held directory
     handle and require the parent-relative opened handle to match before
     deletion.

3. **Medium - launcher config/default shell retained a smoke TOCTOU.**
   - Fix: hold config/parent and the canonical hashed PowerShell executable
     no-write/no-delete throughout smokes; add post-preflight swap fixtures.

4. **Medium - quota state could traverse a swapped/reparse directory.**
   - Fix: create/open quota control state relative to the held target-root
     handle, pin identities, and update lock/reservations handle-relatively.

5. **Medium - cleanup was not provably idempotent after owner removal.**
   - Fix: retain a flushed terminal cleanup receipt and accept matching absent
     target/owner/reservation state as idempotent success.

6. **Medium - non-Windows public behavior was unspecified.**
   - Fix: define deterministic unsupported plan JSON and fail execution,
     recovery, and cleanup before mutation; test injected win32/linux/darwin.

## Round 9

Result: **2 High and 6 Medium findings**

1. **High - transient Cargo config injection outside source watchers remained
   possible.**
   - Fix: continuously watch every candidate config parent/Cargo-home location
     with non-overlapping double-buffered drain/rescan barriers.

2. **High - coordinator executables remained PATH-resolved and mutable.**
   - Fix: resolve bash/pwsh/node/git/py/python from accepted roots, record and
     hold absolute identities, and invoke only those files.

3. **Medium - post-replace probe races could displace concurrent canonical
   bytes.**
   - Fix: distinguish pre/post-replace races; leave post-replace concurrent
     bytes canonical and preserve owned/displaced versions separately.

4. **Medium - source watcher topology/order lacked a final barrier.**
   - Fix: use one wrapper-root watcher covering nested source, canonical
     sequence normalization, double-buffered drain/rescan, and a final ready
     barrier.

5. **Medium - successful roots did not require descendant drainage.**
   - Fix: add per-root child jobs, bounded `ActiveProcesses==0`, and final
     transaction-job zero-active gate.

6. **Medium - isolated smoke state lacked ownership/cleanup.**
   - Fix: add journaled owner-pinned NTFS CODEX_HOME/TEMP scratch, 1 GiB cap,
     bounded evidence copy, and hardened recovery/cleanup.

7. **Medium - non-Windows logical plan contradicted resolved absolute argv.**
   - Fix: separate `logical-unsupported` tool templates from
     `resolved-windows` execution plans.

8. **Medium - one transaction/smoke commit and four-story shape was
   disproportionate.**
   - Fix: split one PRD into six serial stories and five reviewable commits:
     plan/environment, transaction/source, target lifecycle, smokes/evidence,
     and docs, followed by live acceptance.

## Round 10

Result: **1 High and 5 Medium findings**

1. **High - live model smokes could execute unexpected tools before JSONL
   rejection.**
   - Fix: add a source-verified launcher smoke policy that replaces forced
     danger-full-access with read-only/never, loads isolated default-deny
     execpolicy rules, permits only the exact sentinel command, and requires
     adversarial zero-spawn/zero-write proof before live model use.

2. **Medium - isolated smoke still deleted real user `.codex\.tmp`.**
   - Fix: bounded fork-owned launcher overlay seam makes curated cleanup honor
     `CODEX_HOME`; a real-profile sentinel must remain unchanged.

3. **Medium - shared auth cache could create IDs or refresh/write tokens.**
   - Fix: require existing IDs and a cached token valid beyond 900 seconds,
     hold auth files/parent read-only, and fail rather than refresh.

4. **Medium - coordinator pinning began after a PATH-selected Bash/utility
   bootstrap.**
   - Fix: acceptance invokes fixed absolute Git Bash; builtins/fixed siblings
     reach pinned PowerShell before any caller-PATH utility.

5. **Medium - interrupted scratch recovery contradicted cleanup refusal.**
   - Fix: recovery exclusively owns interrupted scratch; cleanup handles only
     terminal `scratch-cleanup-pending` state with matching receipt.

6. **Medium - rollback still referenced three commits.**
   - Fix: rollback names the verified five-commit feature range plus any
     bounded review-fix commits.

## Round 11

Result: **1 High and 3 Medium findings**

1. **High - current execpolicy cannot provide default-deny/exact-full-argv
   semantics.**
   - Fix: remove execpolicy as the load-bearing gate. The fork-owned launcher
     becomes an owner-pinned `pwsh.exe` shell guard: deny-all spawns no payload;
     exact-sentinel validates full argv/cwd before invoking only held pwsh.
     Smoke mode also forces read-only/never and adversarial zero-payload/
     zero-write proof.

2. **Medium - Git-common control paths were not identity-pinned.**
   - Fix: resolve/create the full control tree handle-relatively, pin identities,
     and open lock/manifests/evidence/scratch only through held parents.

3. **Medium - launcher temp cleanup bypassed hardened ownership.**
   - Fix: skip launcher curated-cache cleanup only in smoke driver/guard mode;
     the transaction resets/deletes scratch with the hardened primitive.

4. **Medium - launcher Rust tests were not in validation.**
   - Fix: add targeted `just test -p codex-copilot-launcher`, followed after
     all tests by scoped `just fix` and `just fmt`.

## Round 12

Result: **1 High and 1 Medium finding**

1. **High - unified exec/model-supplied shell could bypass the launcher guard.**
   - Fix: smoke mode forces `features.unified_exec=false`, puts the held guard
     first in sanitized PATH and as default shell, and tests legacy-shell plus
     explicit alternate-shell bypass attempts before live model use.

2. **Medium - launcher Rust validation lacked frozen environment and review
   questioned command ordering.**
   - Fix: source `iteration-env.sh` for targeted `just` commands and explicitly
     follow `codex-rs/AGENTS.md`: tests first, then scoped fix/format without
     retesting; T2 is the post-format compile gate.

## Round 13

Result: **2 High and 2 Medium findings**

1. **High - bootstrap trust began after interpreter/startup injection.**
   - Fix: add canonical absolute no-profile PowerShell trampoline, clear Bash/
     Node/Python/Git injection variables in a minimal `ProcessStartInfo`
     environment, pin tools, then launch Bash `--noprofile --norc`.

2. **High - guard compared the displayed sentinel, not post-UTF8-rewrite argv.**
   - Fix: freeze the actual newline-prefixed PowerShell script argv, disable
     login shells, and test the end-to-end legacy rewrite/guard path.

3. **Medium - Cargo retained inherited PATH/ComSpec helper resolution.**
   - Fix: construct canonical PATH/ComSpec/PATHEXT/TEMP from pinned tools and
     owner scratch, and reject Job Object descendant images outside pinned
     tools or owned target build scripts.

4. **Medium - early commits activated runnable before safety dependencies
   landed.**
   - Fix: commits 1-3 remain plan-only with `implementationReady:false`; commit
     4 flips one activation gate only after all safety and guard tests exist.

## Round 14

Result: **2 High and 2 Medium findings**

1. **High - exact guard argv omitted runtime `-NoProfile`.**
   - Fix: freeze and test
     `[guard, -NoProfile, -Command, UTF8-prefix-plus-sentinel]`.

2. **High - activation/live-evidence commit ordering was inconsistent.**
   - Fix: use six commits: smokes stay inert in commit 4; deterministic fixture
     commit 5 activates; live acceptance then lands docs/evidence in commit 6.

3. **Medium - end snapshots could miss short-lived child images.**
   - Fix: associate Job Objects with completion ports, persist every
     start/exit, retain process query handles, and fail unresolved starts.

4. **Medium - Python could still import customization hooks.**
   - Fix: invoke held Python only with `-I -S` and add hostile customization
     fixtures.

## Round 15

Result: **2 High and 2 Medium findings**

1. **High - guard text still referenced the pre-rewrite sentinel shape.**
   - Fix: every guard rule now references the exact four-element
     `[guard,-NoProfile,-Command,UTF8-prefix+sentinel]` vector and cwd.

2. **High - PowerShell could execute .NET startup injection before sanitizing.**
   - Fix: add fixed native `cmd.exe /D` bootstrap that clears
     DOTNET/COREHOST/COMPlus/PSModule injection before no-profile PowerShell.

3. **Medium - completion-port PIDs could exit before image capture.**
   - Fix: pre-arm kernel-process ETW, correlate with Job notifications, and fail
     lost/unmatched events without recording command lines.

4. **Medium - story/commit boundaries still contradicted the inert-through-4
   and docs-in-6 sequence.**
   - Fix: US-001 states inert through US-004; US-005 is deterministic
     safety+activation only; US-006 owns live evidence and guidance.

## Round 16

Result: **2 High findings**

1. **High - clearing PSModulePath lets PowerShell reconstruct user module
   roots.**
   - Fix: set PSModulePath explicitly to held trusted machine roots and test a
     hostile user autoload module marker.

2. **High - pinned git.exe still consumed mutable/executable config.**
   - Fix: suppress system/global config, hold/hash local/worktree config,
     reject includes, disable fsmonitor/hooks/ext-diff/textconv, and add helper/
     mutation fixtures.

## Round 17

Result: **2 High and 1 Medium findings**

1. **High - launcher smoke guard was specified but not fully wired to each
   smoke launch.**
   - Fix: define sealed per-smoke role/policy/path/cwd/vector mappings, validate
     them against held owner state, and keep direct launcher environment
     dispatch compile-time disabled until the US-005 activation commit.

2. **High - kernel-process ETW could start after a root process had already
   escaped observation.**
   - Fix: arm ETW and the Job completion port before root `CreateProcess`;
     assignment remains atomic and lost/unmatched events fail the run.

3. **Medium - pinned Git still admitted executable filters through config or
   attributes.**
   - Fix: suppress system/global attributes, hold repository attributes, reject
     filter/attribute/diff/merge helper configuration and active filter
     attributes, and add zero-helper-execution fixtures.

## Round 18

Result: **4 High and 3 Medium findings**

1. **High - read-only permission mode did not activate the Windows sandbox.**
   - Fix: force `windows.sandbox="unelevated"`, assert effective
     `RestrictedToken`, and require a deterministic outside-scratch denial
     fixture before live model use.

2. **High - the model-visible tool surface was not sealed.**
   - Fix: source verification proved a bounded nested seam necessary. Add a
     fork-exclusive core selector with two tiny marked call sites so no-tool
     advertises zero tools and tool smoke advertises only guarded legacy shell,
     independent of MCP/plugin/dynamic/model config. Split implementation into
     nested PRD A plus wrapper PRD B.

3. **High - native .NET startup sanitization omitted `COR_*`/`CORECLR_*`.**
   - Fix: clear both families case-insensitively before PowerShell and add a
     profiler-marker fixture.

4. **Medium - login-shell policy used the wrong TOML path.**
   - Fix: use source-verified top-level `allow_login_shell=false` and snapshot
     the effective shell schema/argv.

5. **Medium - Git-common `info/attributes` remained mutable.**
   - Fix: resolve/hold/hash it when present, watch its parent when absent, and
     fail transient creation/edit/replace/delete.

6. **High - held executable files could still be redirected by parent rename.**
   - Fix: hold no-delete handles on every canonical executable parent component
     and add pre-`CreateProcess` parent-swap barriers.

7. **Medium - non-target process-visible paths had no MAX_PATH budget.**
   - Fix: derive fixed `runTag` names and precompute/bound all executable/cwd/
     control/evidence/temp/home/guard/probe paths and command blocks before any
     mutation.

## Round 19

Result: **2 High and 2 Medium findings**

1. **High - tool-policy selection still occurred after MCP/plugin/auth/tool
   discovery side effects.**
   - Fix: move the gate to the first line of `session/turn.rs::built_tools` and
     construct the sealed router before any manager access or normal tool
     assembly. The nested seam is now one helper plus three tiny marked call
     sites.

2. **High - proposed implementation worktrees exceeded the plan's path bound.**
   - Fix: use fixed short roots `.worktrees\run` and `.worktrees\frdbt`; record
     measured accepted-pin maximums (239/237 nested, 114 wrapper), recompute
     after file additions, and reject any checkout path above 240.

3. **Medium - ignored untracked source inputs could disappear from provenance.**
   - Fix: seal/watch repository and Git-common ignore sources, reject
     `core.excludesFile`, suppress global excludes, and hash ignored plus
     non-ignored untracked files independently of status output.

4. **Medium - wrapper publication could reference an unreachable local-only
   nested SHA.**
   - Fix: require lead-owned nested merge/push and fresh-fetch reachability
     verification before wrapper merge/push, then parent codexu.

## Round 20

Result: **1 High and 1 Medium finding**

1. **High - `built_tools` was still after configured thread/session
   initialization.**
   - Fix: replace the narrow router-only seam with a typed provider-only smoke
     capsule dispatched at the first `exec::run_main` branch, before config
     layers, cloud bundles, exec policy, telemetry, state/environment managers,
     or thread/session construction. It uses only sealed in-memory provider
     inputs and adds hostile-config process-marker tests.

2. **Medium - normal `ShellCommandHandler` ran hooks and apply-patch
   interception before the launcher guard.**
   - Fix: advertise a dedicated smoke-only handler that validates the complete
     semantic payload first, bypasses normal hooks/permissions/interception,
     and reuses only low-level restricted-token PowerShell rewrite/spawn
     through the guard.

## Round 21

Result: **2 High and 3 Medium findings**

1. **High - standalone nested worktree did not resolve the wrapper overlay
   workspace member.**
   - Fix: create the wrapper worktree first and use its initialized
     `external/repos/codex-patched` checkout for PRD A. Require Cargo metadata,
     canonical workspace-member containment, and a recomputed `<=240` path
     maximum before editing.

2. **High - mutable copied guard and adjacent DLL planting could bypass the
   sentinel.**
   - Fix: remove the scratch executable copy. The capsule direct-spawns the
     same held target launcher in one-use guard role. Journal/temporarily seal
     launcher and PowerShell search directories, hold adjacent/imported files,
     test create/replace denial, and restore exact ACLs after success/recovery.

3. **Medium - model-generated tool call ID was specified as an exact
   pre-known value.**
   - Fix: reuse one `ModelClientSession`, accept one unique nonempty generated
     ID, and echo that same ID in `FunctionCallOutput`; reject missing,
     duplicate, caller-selected, or changed IDs.

4. **Medium - exact model metadata and provider request limits were not
   implementable without extra `/models`/retry traffic.**
   - Fix: freeze complete `capsule-model-info-v1` metadata for
     `gpt-5.6-sol`, never call `/models`, set request/stream retries to zero,
     and disable websocket/prewarm/fallback and credential refresh.

5. **Medium - core was incorrectly assigned exec-owned canonical JSONL.**
   - Fix: core returns a typed transcript; a bounded `codex-exec` adapter owns
     canonical four/six-event rendering through existing event types.

## Round 22

Result: **1 High and 1 Medium finding**

1. **High - mutating a shared PowerShell-directory ACL was neither globally
   serialized nor safely recoverable across worktrees.**
   - Fix: mutate only the target-local `dev-small` ACL under its existing
     target lock/journal. Never mutate the shared PowerShell ACL; require it to
     already deny the smoke token write/create/delete/ACL-owner access, hold
     imported/adjacent files, and fail if mutation probes are not denied.

2. **Medium - the plan pinned only the requested model, not backend-selected
   server model.**
   - Fix: require exactly one matching
     `ResponseEvent::ServerModel("gpt-5.6-sol")` per provider request and fail
     absence, alias/mismatch, or model change across the tool continuation.

## Round 23

Result: **3 Medium findings**

1. **Medium - duplicate identical server-model observations are valid.**
   - Fix: require at least one observation per request, deduplicate identical
     header/SSE values, and fail only missing, conflicting, mismatched, or
     cross-request-changed values.

2. **Medium - frozen model metadata lacked exact serialized fields/hash.**
   - Fix: embed the complete minified `capsule-model-info-v1` fixture and
     SHA-256, plus the exact base-instruction hash and explicit internal
     fallback flag. Tests compare serialized bytes and hashes.

3. **Medium - implementation metadata preflight omitted the locked/offline
   boundary.**
   - Fix: require
     `cargo metadata --locked --offline --no-deps --format-version 1` under the
     sealed tool environment.

## Round 24

Result: **1 High and 3 Medium findings**

1. **High - canonical metadata bytes were incorrectly specified as
   `ModelInfo` serde output despite skipped null fields.**
   - Fix: define a dedicated no-skip `RunnableModelInfoFixtureV1` canonical
     descriptor with the frozen bytes/hash, map every field explicitly into
     `ModelInfo`, and assert the full mapping plus internal fallback flag.

2. **Medium - exact second-request conversation input was undefined.**
   - Fix: freeze request two as original input plus every authoritative
     completed request-one item in order plus the matching
     `FunctionCallOutput`; reuse the same session and assert serialized input.

3. **Medium - provider raw-event multiplicities/handling were not frozen.**
   - Fix: define accepted counts/reconciliation/bounds for every
     `ResponseEvent`, make done items authoritative, reconcile deltas/added
     items, and fail extras/conflicts/overflow/post-terminal events.

4. **Medium - required core integration/full-suite validation was missing.**
   - Fix: add `core/tests/suite/runnable_smoke.rs` and require complete
     `just test` after targeted tests, with operator approval, before
     fix/format and the T2 gate.

## Round 25

Result: **1 High and 3 Medium findings**

1. **High - fail-closed raw-event policy was impossible after the existing SSE
   parser had already dropped/materialized unknown/unbounded data.**
   - Fix: add an opt-in strict codex-api HTTP stream path with a custom
     pre-allocation incremental SSE decoder, explicit line/event/count/total
     caps, and unknown/malformed/truncated failure. Normal parser behavior is
     unchanged.

2. **Medium - runtime SHA-256 had no direct crate dependency/helper.**
   - Fix: export a general raw-byte SHA-256 helper from `codex-config`'s
     existing fingerprint/`sha2` implementation and use it without config
     loading or manifest changes.

3. **Medium - executable story AC omitted fixture/request/event wire
   invariants.**
   - Fix: add exact descriptor mapping/hash, request-two composition,
     plain-string `FunctionCallOutput` body, strict event reconciliation, and
     hash-helper ACs to N-US-001.

4. **Medium - core integration test lacked suite registration.**
   - Fix: include `core/tests/suite/mod.rs` registration in files, AC, and test
     scope.

## Round 26

Result: **3 Medium findings**

1. **Medium - request-two context lacked per-item/body limits.**
   - Fix: cap authoritative items at 8192 serialized UTF-8 bytes,
     request-one completed context at 32768 bytes, and full request-two input
     at 65536 bytes; reject oversize reasoning before tool action.

2. **Medium - two-request sticky routing was omitted.**
   - Fix: require one nonempty `x-codex-turn-state` from request one and exact
     replay on request two in the same `ModelClientSession`, with integration
     assertions.

3. **Medium - waiting for EOF to detect post-terminal events contradicts HTTP
   stream semantics.**
   - Fix: validate every event already buffered with `Completed`, reject
     same-buffer extras, then cancel/drop the body without waiting for EOF.
     Test both a pending server and same-chunk extra event.

## Round 27

Result: **3 Medium findings**

1. **Medium - redirects bypassed the one/two-request cap.**
   - Fix: use a dedicated no-redirect client, reject every 3xx, retain the
     trusted Copilot origin allowlist, and count/test zero redirect follow-up.

2. **Medium - response stream identity/order was unbound.**
   - Fix: strict raw parsing requires created-first/completed-last with one
     matching nonempty response ID and rejects duplicates/mismatch/out-of-order
     items.

3. **Medium - sticky turn-state was unbounded.**
   - Fix: accept only one `1..1024`-byte visible-ASCII/header-safe value, replay
     it exactly, and reject missing/invalid/oversized/conflicting/changed state.

## Round 28

Result: **1 Medium finding**

1. **Medium - the complete outbound request bodies and application headers
   were not frozen.**
   - Fix: freeze every `ResponsesApiRequest` field for deny-all,
     exact-sentinel request one, and its continuation; add the exact strict
     sentinel function schema and serde omission rules; define the complete
     Copilot application header allowlist plus dynamic-value relationships;
     disable compression and reject normal core cache/metadata/trace/beta/
     session/thread/attestation/timing extras; require exact body/header
     assertions in deterministic transport tests and redacted live hashes.

## Round 29

Result: **4 Medium findings**

1. **Medium - continuation bodies still admitted optional namespace/metadata.**
   - Fix: reject `FunctionCall.namespace` and every admitted
     `ResponseItem.metadata`; freeze literal minified deny-all, sentinel, and
     fixture-continuation request bytes including bounded reasoning context.

2. **Medium - header values and compression behavior remained ambiguous.**
   - Fix: add the exact value/predicate matrix, override
     `Accept: text/event-stream`, disable every reqwest decoder, send no
     `Accept-Encoding`, reject response encoding, and test the production
     builder rather than only a fake transport.

3. **Medium - non-success transport handling was unbounded.**
   - Fix: accept only HTTP 200 plus strict SSE media type, cap and discard
     non-success bodies at 16 KiB, and add 204/401/403/429/5xx/media/oversized
     error fixtures.

4. **Medium - the single nested story/commit was too broad.**
   - Fix: explicitly evaluate and reject overlay placement with source-backed
     dependency/cycle/publication reasons, then split PRD A into a strict
     transport/parser story and a capsule/dispatch story. The plan now has two
     PRDs, eight stories, and eight reviewable commits.

## Round 30

Result: **3 Medium findings**

1. **Medium - the two-story nested split was not propagated to final scope and
   closeout.**
   - Fix: update acceptance, out-of-scope, open-question, final story AC, ship,
     and rollback text to name N-US-001 plus N-US-002 and two nested plus six
     wrapper commits.

2. **Medium - literal request bytes depended on unstable JSON object order.**
   - Fix: recursively lexicographically sort every JSON object before minified
     wire serialization, rewrite all literal fixtures in canonical order, and
     require identical targeted/workspace bytes and hashes.

3. **Medium - the 16 KiB error cap could not distinguish exact limit from
   overflow.**
   - Fix: retain at most 16 KiB but read one additional byte, with exact-limit
     and limit+1 chunked fixtures.

## Round 31

Result: **4 Medium findings**

1. **Medium - N-US-002 still named the original base instead of N-US-001.**
   - Fix: require N-US-002 to start from the reviewed N-US-001 tip and verify
     that tip's merge-base remains the accepted nested base.

2. **Medium - one-use guard nonce consumption was environment-only.**
   - Fix: add an owner-pinned atomic nonce-record state machine bound to
     transaction and process/file/vector identities, with locked transitions,
     fail-closed replay/concurrency/crash handling, and hash-only evidence.

3. **Medium - strict SSE framing semantics were incomplete.**
   - Fix: freeze BOM/CR/LF/CRLF, field multiplicity, comments, id/retry/unknown
     fields, event/type agreement, limits, cross-chunk behavior, EOF, and every
     post-terminal byte; add adversarial fixtures.

4. **Medium - the production HTTP endpoint was not exact.**
   - Fix: freeze `https://api.githubcopilot.com/responses`, implicit 443, exact
     path, and no userinfo/query/fragment/trailing slash/alternate encoding;
     constrain test overrides and assert the production final URL.

## Round 32

Result: **3 Medium findings**

1. **Medium - N-US-001/N-US-002 starting points were reversed.**
   - Fix: restore N-US-001 to accepted base `587a6a8...`; require N-US-002 to
     start from the reviewed N-US-001 tip and verify its merge-base.

2. **Medium - nested N-US-002 owned wrapper nonce responsibilities.**
   - Fix: N-US-002 now owns only the versioned schema and injected core-side
     transitions; US-004 owns transaction issuance/driver/guard integration;
     US-005 owns end-to-end activation fixtures.

3. **Medium - nonce recovery omitted both terminal branches and payload-spawn
   crash boundaries.**
   - Fix: define `consumed-no-guard` and `consumed`, make neither imply ready,
     and specify idempotent recovery/removal for partial, nonterminal, and
     terminal records before/after terminal flush and payload spawn.

## Round 33

Result: **3 Medium findings**

1. **Medium - source-drift had no executable acknowledgement/recovery path.**
   - Fix: add stable-provenance inspection plus exact hash acknowledgement,
     archived evidence, full target invalidation, and complete no-SLO rebuild
     with stale/new-event failure fixtures.

2. **Medium - worktree closeout could orphan its path-derived target.**
   - Fix: require evidence finalization then verified cleanup/receipt before
     worktree removal; add owner-record-authenticated orphan cleanup that never
     accepts a caller path.

3. **Medium - N-US-001 patch markers/registration ownership was ambiguous.**
   - Fix: N-US-001 owns `SANDBOX PATCH` markers and enforcing replant tests;
     US-004's gitlink integration commit owns wrapper patch-surface §14/§15
     registration for both nested commits.

## Round 34

Result: **1 High and 2 Medium findings**

1. **High - build descendants could forge writable authority state.**
   - Fix: make control/quota/evidence/target-owner/nonce authority
     medium-integrity no-write-up, run every build/smoke descendant under a
     low-integrity restricted token with only target/scratch writes, and broker
     nonce transitions through coordinator-authenticated client process IDs.
     Add hostile ACL/delete/rename/reparse/forgery tests.

2. **Medium - ETW trace sessions were not crash-recoverable.**
   - Fix: journal exact session name/GUID/provider/start/running/stopped state;
     authenticate/drain/stop only that session on closeout/recovery, invalidate
     on loss, and test every crash boundary plus unrelated sessions.

3. **Medium - the exact six-event tool JSONL was not enumerated.**
   - Fix: freeze complete four-line and six-line newline-terminated byte
     snapshots with fixed thread/item IDs, command/output/status, and zero
     usage, constructed through existing typed exec events.

## Round 35

Result: **2 High and 2 Medium findings**

1. **High - low integrity did not prevent credential reads or network egress.**
   - Fix: move build descendants to no-network per-run AppContainer capability
     SIDs with exact ACL leases and isolated profile/Cargo homes; put
     authenticated smoke under separate exact-read ACLs plus dynamic WFP
     provider-only egress and a no-network sentinel token.

2. **High - source-tree reparses could escape the watched provenance root.**
   - Fix: recursively reject every source file/directory reparse and
     multi-hardlinked source file, recording identities/link counts and testing
     external-target mutation.

3. **Medium - target-local authority shared a Cargo-writable parent.**
   - Fix: remove all target-local authority; Git-common owner state alone pins
     target parent/volume/file identities. Any target marker is diagnostic only.

4. **Medium - nonce clients did not authenticate the pipe broker.**
   - Fix: random first-instance local-only pipe with restrictive capability
     DACL; broker authenticates client PID and clients authenticate coordinator
     PID/creation/image before trusting an acknowledgement.

## Round 36

Result: **4 Medium findings**

1. **Medium - WFP allow/deny mechanics were not executable.**
   - Fix: freeze exact AppContainer package/application conditions at
     `ALE_AUTH_CONNECT_V4/V6`, per-address TCP/443 permits above a same-sublayer
     catch-all block, one atomic transaction plus post-commit attestation before
     child resume, and dynamic-session/journal crash removal.

2. **Medium - AppContainer profiles and concurrent ACL leases lacked a complete
   lifecycle.**
   - Fix: freeze profile/token APIs and package/capability SID schema; add one
     machine-global baseline-plus-live-lease registry with
     `prepared/applied/removing/removed` states, exact additive ACE
     reconciliation, concurrent/crash recovery, profile deletion, and final
     source/security rescan before ready.

3. **Medium - lowbox clients might be unable to authenticate the broker
   process.**
   - Fix: pass an inherited `PROCESS_QUERY_LIMITED_INFORMATION`-only
     coordinator handle through explicit handle lists; verify server PID,
     creation time, and image through that handle; strip it from the sentinel
     payload. Add PID-reuse, access-denied, wrong-handle, and spoof tests.

4. **Medium - new security infrastructure was hidden inside oversized
   stories/commits.**
   - Fix: expand to two PRDs, ten stories, and ten commits. Add dedicated
     serial `US-CAP-001` capability/ACL and `US-NET-001` WFP/broker integration
     stories, helpers/C# modules, dependencies, rollback entries, evidence, and
     activation tests.

## Round 37

Result: **2 High and 3 Medium findings**

1. **High - a WFP block scoped to package plus core image left other images in
   the network-capable package unblocked.**
   - Fix: keep exact worker-package+`codex-core.exe` permit filters, but make
     the lower-weight same-sublayer catch-all worker-package-wide. Other images,
     protocols, addresses, and ports now match the block.

2. **High - the stated medium coordinator could not install WFP or rewrite
   protected tool/system ACLs.**
   - Fix: authenticated smoke and WFP-bearing recovery require an already-
     elevated coordinator and never auto-elevate or install a service. Tool/
     LLVM/Windows ACLs are verification-only and must have pre-existing
     AppContainer/all-applications RX; only operator-owned `WRITE_DAC` objects
     may receive leases. Authority files keep an explicit medium label.

3. **Medium - worker, model, and sentinel AppContainer identities conflicted.**
   - Fix: define two exact per-run profiles: `.worker` with zero-capability
     build/version tokens and an `internetClient` model token, and `.sentinel`
     with a distinct package SID and zero-capability scratch-only token. Give
     each independent leases/profile cleanup.

4. **Medium - target-root-local ACL registries did not serialize shared
   objects across alternate target roots.**
   - Fix: move the single operator-global registry/lock to canonical
     `%LOCALAPPDATA%\CodexRunnableSecurity\v1\`, outside every caller-selected
     target root.

5. **Medium - activation commit numbering conflicted.**
   - Fix: wrapper commit 5 lands WFP/broker/launcher integration disabled;
     wrapper commit 7, US-005, atomically flips both activation gates.

## Round 38

Result: **2 High and 3 Medium findings**

1. **High - dynamic WFP permits and kill-on-close Jobs had an unordered
   coordinator-crash race.**
   - Initial fix considered persistent blocks plus dynamic permits, but a fresh
     source investigation found a smaller fail-closed seam: locked reqwest
     0.12.28 already supports TLS over Windows named pipes. The final fix removes
     WFP entirely: all child profiles have zero network capability; the strict
     client uses a fallible no-fallback named-pipe transport; and the coordinator
     alone opens a bounded pinned-provider TCP bridge. Coordinator/pipe death
     closes egress immediately without firewall state.

2. **High - low-integrity AppContainers could not safely write an ordinary
   medium target, and merely lowering it exposed same-user low-IL tampering.**
   - Fix: require same-operator elevation for every runnable mutation; use
     stable per-target build/model/sentinel profiles; seal target/scratch with
     low labels and protected inherited SYSTEM/Administrators/exact-package
     DACLs plus restrictive `OWNER RIGHTS`; model is target-read-only. Verify
     existing/new descendants and deny unrelated same-user low-IL processes.

3. **Medium - alternate-credential elevation could split owner profiles and
   recovery state.**
   - Fix: derive one expected non-group user SID from matching held worktree/
     Git-common owners, resolve/verify that SID's profile/LocalAppData, persist
     it, and require every elevated token to match. Reject alternate credentials.

4. **Medium - operator-global lease names could collide across targets.**
   - Fix: include `targetId` in target and per-run model/sentinel lease names.

5. **Medium - broker principal and profile capability sets conflicted.**
   - Fix: use the exact model package SID on both nonce/provider pipe DACLs and
     freeze all three profile creation capability sets to zero; provider access
     is only through the coordinator pipe bridge.

## Round 39

Result: **2 High and 3 Medium findings**

1. **High - lowbox named-pipe SACL/access/instance rights were incomplete.**
   - Fix: freeze low mandatory SACL, protected SYSTEM/Administrators/exact-model
     package DACLs, reqwest GR/GW/synchronize versus narrower nonce masks,
     byte/remote flags, exact one/two pre-created server slots, max instances,
     `ERROR_PIPE_BUSY` extra-instance tests, and inherited-handle server auth.

2. **High - intentional Cargo-home junctions contradicted reparse-rejecting
   scratch cleanup.**
   - Fix: journal each projection's tag/substitute/target identity; cleanup
     opens/unlinks the junction itself no-follow before the normal
     reparse-rejecting recursive walk. Unknown/swapped links preserve scratch.

3. **Medium - provider connection cardinality said both one and up to two.**
   - Fix: freeze one canonical destination with at most two sequential
     authenticated pipe/TCP/TLS connections; the capsule independently enforces
     exactly one or two HTTP requests.

4. **Medium - authorization scheme encoding was not frozen.**
   - Fix: strict headers copy the held source `build_session_headers` sensitive
     value byte-for-byte with no transformation. Non-secret tests compare it
     without printing.

5. **Medium - implementation budget still described three helpers.**
   - Fix: reconcile the budget to five PowerShell helpers, two C# modules, the
     named-pipe nested seam, and proportional production/test/doc line ranges.

## Round 40

Result: **2 High and 2 Medium findings**

1. **High - a model-profile core could not directly create the distinct
   sentinel-profile guard/PowerShell chain.**
   - Fix: make sentinel execution coordinator-owned. N-US-002 validates and
     freezes argv, then sends one authenticated `spawn-guard` request; the
     coordinator creates the held launcher under the sentinel token/Job and
     passes the query handle. Guard consumes the nonce and strips handles before
     PowerShell. Nonce pipe DACLs are role-specific for model versus sentinel.

2. **High - sentinel rights did not permit its target cwd/launcher.**
   - Fix: move payload cwd to sentinel scratch and grant sentinel only target-
     directory traverse plus exact launcher RX, PowerShell/system RX, and
     sentinel-scratch RW. It receives no core/other-target read or target write.

3. **Medium - side-effect-free plan JSON conflicted with mandatory real Cargo
   metadata and scratch.**
   - Fix: plan JSON records `metadata.status:not-run-plan-only` plus frozen
     logical expectations. Real offline metadata runs only after an elevated
     mutating invocation owns profiles/leases/scratch and must match.

4. **Medium - the model package unnecessarily received `github_token`.**
   - Fix: lease/open only fresh `copilot_token`, `device_id`, and `machine_id`;
     build headers directly from those held inputs. `github_token` receives no
     model ACE and is never opened.

## Round 41

Result: **1 High and 2 Medium findings**

1. **High - guard/query-handle ownership still implied driver-to-guard
   inheritance despite coordinator-owned cross-profile spawn.**
   - Fix: driver passes its query handle only to core. Coordinator passes a
     separate duplicate directly to the sentinel-profile guard; guard strips it
     before PowerShell. Initial launcher never sets guard role; only the
     coordinator-created launcher does.

2. **Medium - model package still received launcher-config access.**
   - Fix: coordinator alone holds/parses launcher config and seals a selected-
     setting digest into the broker record. Model gets only target binaries plus
     cached Copilot token/device/machine inputs and recomputes no config hash.

3. **Medium - root watcher could classify coordinator Git-common writes as
   source drift.**
   - Fix: when Git-common is inside the watched root, exclude only the exact
     held authority subtree from source snapshots and allow its events solely
     when path/sequence/hash match flushed coordinator journal operations. All
     other `.git` events fail.

## Round 42

Result: **4 Medium findings**

1. **Medium - US-NET-001 still described one query handle shared through
   driver/core/guard.**
   - Fix: driver receives one duplicate and may pass it only to core;
     coordinator creates a separate duplicate directly for sentinel guard;
     guard strips it before PowerShell.

2. **Medium - launcher file ownership omitted guard/handle/spawn behavior.**
   - Fix: keep the same two launcher files but explicitly assign smoke-only
     policy to `config.rs` and driver/guard validation, query-handle handling,
     exact sentinel spawn, and temp-cleanup suppression to `main.rs`, all marked
     and tested as `SANDBOX PATCH`.

3. **Medium - shared Cargo cache projections lacked continuous external-
   mutation detection.**
   - Fix: add non-overlapping recursive cache-root watchers, held identities/
     security, ETW-observed-file snapshots, and drain/rescan barriers. Any
     event/overflow/drift fails; the lane-local package lock is not considered
     external exclusion.

4. **Medium - nested amendment guard omitted N-US-001 files.**
   - Fix: enumerate the strict decoder/export, fallible login named-pipe builder,
     core client selection, then the N-US-002 exec/core seams and tests as the
     complete allowed nested scope.

## Round 43

Result: **1 Medium finding**

1. **Medium - coordinator-owned sentinel spawn lacked a result channel back to
   core.**
   - Fix: keep core's authenticated broker request open; coordinator owns
     bounded stdout/stderr capture pipes, validates guard/PowerShell identities,
     exit and exact bytes, flushes `pending -> ready -> delivered|failed`, and
     returns one length-prefixed nonce-bound result envelope. Core ACKs and only
     then constructs `FunctionCallOutput`. Overflow/broken-pipe/nonzero/crash
     paths are non-retryable and non-ready.

## Round 44

Result: **1 Medium finding**

1. **Medium - sentinel result/ACK framing and commit ordering were not exact.**
   - Fix: freeze four-byte LE length plus <=16 KiB canonical sorted UTF-8 JSON;
     RESULT carries exact correlations/identities/exit/Base64 streams/hashes,
     ACK binds the result hash, broker flushes `delivered`, then DELIVERED binds
     result+ACK hashes. Core constructs output only after validating that post-
     flush confirmation. Malformed/partial/extra/trailing frames fail.

## Round 45

Result: **1 High and 2 Medium findings**

1. **High - Git-common scratch under an in-root primary checkout produced
   non-journaled child writes that the source watcher must reject.**
   - Fix: keep authoritative scratch journals in Git-common but move all
     lowbox-writable build/CODEX_HOME/TEMP scratch to the held target root under
     `.codex-runnable-scratch`, outside the source tree/watcher.

2. **Medium - result JSON and total frame both claimed a 16 KiB maximum.**
   - Fix: cap JSON payload at 16,380 bytes and four-byte-prefixed total frame at
     16,384 bytes in both artifacts.

3. **Medium - story pipe DACL text omitted sentinel access to nonce pipe.**
   - Fix: provider DACL remains exact-model; nonce DACL explicitly grants the
     narrower mask separately to model driver/core and sentinel guard packages.

## Round 46

Result: **1 High and 2 Medium findings**

1. **High - controlled host tool roots lacked AppContainer RX and the plan
   forbade fixing them.**
   - Fix: all runnable mutations are already elevated, so exact held
     `.rustup`/Cargo/xwin/V8/Git/PowerShell/LLVM paths now receive
     target-lifetime RX/traverse-only ACEs through the global recoverable lease
     state machine when needed. Windows/System32 remains unmodified/pre-readable.

2. **Medium - changed-probe smoke ordering conflicted with restored-source
   wording.**
   - Fix: changed binaries are hashed/smoked and evidenced while source is
     baseline-plus-probe; then source restores, canonical reconcile runs, and
     final zero-package no-op stabilizes. Ordinary non-probe smokes follow the
     canonical build.

3. **Medium - reqwest path-only provider pipe could not perform local server PID
   attestation.**
   - Fix: reserve inherited-handle server authentication for the custom nonce
     pipe. Provider pipe trust is pre-created saturated instances plus
     end-to-end TLS to the canonical origin; no provider server-PID claim.

## Round 47

Result: **1 High and 2 Medium findings**

1. **High - host-tool leases included PowerShell while another contract forbade
   PowerShell ACL mutation.**
   - Fix: recoverable leases cover exact rustup/Cargo/xwin/V8/Git/LLVM paths
     only. Shared PowerShell and Windows/System32 remain immutable prerequisites
     with pre-existing AppContainer RX and denied package write/ACL rights.

2. **Medium - model and sentinel shared one smoke temp root.**
   - Fix: split model `codex-home`/`temp` from sentinel `temp`; sentinel uses its
     own cwd/TEMP/TMP and receives no model-scratch access.

3. **Medium - AppContainer named-pipe namespace was unspecified.**
   - Fix: freeze exact `\\.\pipe\LOCAL\codex-runnable-...-nonce|provider`
     names, character/length/owner binding, and tests rejecting ordinary,
     remote, alternate, or caller-controlled namespaces.

## Round 48

Result: **1 Medium finding**

1. **Medium - changed `codex-login` transport builder lacked targeted test/fix
   commands.**
   - Fix: add `just test -p codex-login runnable_named_pipe` to targeted gates
     and `just fix -p codex-login` before final format, reflected in N-US-001.

## Round 49

Result: **1 High finding**

1. **High - mutable worktree bootstrap could execute elevated before source
   drift protection.**
   - Fix: make `--print-elevated-command` a non-elevated, side-effect-free
     emitter for one immutable inline cmd/PowerShell encoded launcher. The
     launcher validates identity, pins and hashes the complete executable
     bootstrap closure, writes pessimistic state, snapshots provenance, and
     arms the recursive watcher before any repository byte executes. Runnable
     mutation examples now emit then paste that exact command; worktree files
     are never elevated entry points. Add edit-and-restore race coverage.

## Round 50

Result: **2 High, 1 Medium findings**

1. **High - the mutable emitter controlled both encoded payload and expected
   hashes.**
   - Fix: emitter now outputs canonical request data only. Fixed verifier and
     bootstrap-v1 payload bytes/hashes plus accepted wrapper commit are explicit
     independent implementation-review outputs and operator-supplied trust
     anchors. Bootstrap derives closure blobs from that immutable commit and
     ignores request trust claims.
2. **High - provenance/Git parsing preceded watcher activation and Git
   pinning.**
   - Fix: bootstrap pins the explicit worktree root and arms the recursive
     watcher first, then pins trusted Git/config, resolves accepted commit/
     Git-common, verifies the closure, and reads provenance under the active
     watcher.
3. **Medium - non-elevated usage rule omitted the request emitter.**
   - Fix: allow non-elevated `--print-plan-json` and
     `--print-elevated-request-json`; neither mutates or emits executable code.

## Round 51

Result: **3 High, 1 Medium findings**

1. **High - invalid trailing arguments after `pwsh -EncodedCommand`.**
   - Fix: fixed cmd verifier supplies syntax-restricted fields through exact
     environment variables; `-EncodedCommand` has no trailing arguments. The
     verifier validates/clears fields and invokes authenticated bootstrap bytes
     in-process with typed parameters.
2. **High - opaque emitter data could substitute a destructive valid
   operation.**
   - Fix: remove runnable mutation request emission entirely. Independent
     implementation closeout records one exact human-readable template per
     allowed operation; the operator visibly chooses it and only substitutes
     its named typed fields.
3. **High - watcher/handle handoff across PowerShell/Bash/Node was undefined.**
   - Fix: the original encoded PowerShell process remains the sole lifetime
     coordinator. It loads held verified PowerShell bytes in the same runspace;
     Bash/Node are bounded workers without authority handles or mutation
     ownership.
4. **Medium - target lease ordering contradicted watcher-first bootstrap.**
   - Fix: arm the source watcher first, then verify accepted closure/lock and
     apply the journaled build lease before source mutation or child creation.

## Round 52

Result: **2 High, 1 Medium findings**

1. **High - generic substitutable `Operation` contradicted fixed
   per-operation templates.**
   - Fix: remove generic operation field. Each exact reviewed template
     hard-codes one operation literal and exposes only its typed fields.
2. **High - worktree-root selection was omitted before watcher arming,
   especially for orphan cleanup.**
   - Fix: every normal template requires an operator-visible absolute
     `WorktreeRoot`. `cleanup-orphan` separately requires absent recorded
     worktree plus explicit Git-common/target/owner fields and runs entirely in
     encoded bootstrap code without repository execution.
3. **Medium - undefined standalone `probe` operation conflicted with
   acceptance mapping.**
   - Fix: remove it. Probe acceptance uses hard-coded
     `authenticated-build` with validated `ProbeSpec`.

## Round 53

Result: **1 Medium finding**

1. **Medium - orphan cleanup both forbade Git and required Git worktree
   authorization.**
   - Fix: orphan cleanup executes no repository scripts/source, but may invoke
     the pinned trusted Git executable with sealed config solely for
     `--git-dir <GitCommonRoot> worktree list --porcelain`.

## Round 54

Result: **1 High finding**

1. **High - PowerShell image initialization preceded native-load isolation.**
   - Fix: add a minimal reproducible statically linked native Windows security
     supervisor, independently hash-reviewed and staged in an admin-owned
     protected ProgramData path. It sets trusted cwd/minimal environment and
     child image-load mitigations before fixed PowerShell creation, arms and
     retains watcher/lock/closure handles, streams verified script bytes, and
     remains the lifetime security coordinator.

## Round 55

Result: **3 High, 2 Medium findings**

1. **High - supervisor's own DLL isolation began after image initialization.**
   - Fix: static CRT/panic-abort build with PE dependent-load System32 flag,
     frozen KnownDLL/System32 import allowlist, empty delay-import table, and PE/
     dumpbin evidence.
2. **High - native/PowerShell lock, Job, ETW, and broker ownership conflicted.**
   - Fix: native supervisor exclusively owns transaction lock, source/cache
     watchers, ETW, Jobs, process creation, and provider bridge. PowerShell is
     Cargo/source/evidence executor through typed journal/spawn IPC only.
3. **High - protected staging lacked a pre-existing trusted stager.**
   - Fix: define frozen OS-only stager-v1 using absolute System32 cmd/certutil/
     icacls, copy-without-execution, operator-known digest verification,
     protected ACL validation, and atomic same-parent rename.
4. **Medium - cache watchers armed after lease application and referenced
   nonexistent file ETW.**
   - Fix: arm source then all shared cache/tool watchers before any lease;
     enumerate watched Cargo inputs from plan/provenance, not process ETW.
5. **Medium - elevated operation matrices were deferred.**
   - Fix: freeze all eleven native subcommands now, with exact compiled
     scenario/probe/budget/confirmation and per-command substitutable fields.

## Round 56

Result: **2 High, 2 Medium findings**

1. **High - path-based staging could not establish a no-follow trust
   boundary.**
   - Fix: OS-only reviewed Windows PowerShell stager uses inline framework
     P/Invoke, handle-relative no-follow ProgramData creation, held candidate
     copy+hash, ACL/integrity verification, and handle-relative atomic rename
     without executing candidate/worktree code.
2. **High - LocalAppData ACL registry parent was path-swappable.**
   - Fix: move authority to admin-owned protected
     `%ProgramData%\CodexRunnableSecurity\v1\operators\<sid-hash>\`, with every
     operation relative to pinned handles and no inherited write/DELETE_CHILD.
3. **Medium - stale build/authenticated-build names and incomplete recovery
   sequences conflicted with native operations.**
   - Fix: use exact frozen native subcommands everywhere; recovery now compiles
     target invalidation, complete build, all required smokes, reconciliation,
     and final no-op with no cold SLO.
4. **Medium - stories still required removed provider-broker C# file.**
   - Fix: native supervisor owns provider/nonce broker mechanics;
     `manage-runnable-smoke-network.ps1` is IPC adapter/tests only.

## Round 57

Result: **2 High, 3 Medium findings**

1. **High - stories retained path-based stager mechanics.**
   - Fix: align stories to the reviewed System32 Windows-PowerShell inline
     P/Invoke stager with handle-relative no-follow copy/hash/ACL/rename.
2. **High - PowerShell helper ownership contradicted native handle ownership.**
   - Fix: native supervisor exclusively owns all authoritative filesystem,
     AppContainer/ACL, process, broker, and cleanup handles/mutations.
     PowerShell helpers are typed orchestration/IPC adapters and fixtures.
3. **Medium - PE proof omitted transitive imports/forwarders/dynamic loads.**
   - Fix: no_std/no_main/NODEFAULTLIB supervisor; recursively validate direct,
     transitive, and forwarded imports, forbid delay/dynamic loader APIs, and
     require Microsoft-signed KnownDLL/System32 closure at stage/run time.
4. **Medium - orphan cleanup fields conflicted with recovery syntax.**
   - Fix: exact native template now requires recorded worktree root, Git-common
     root, target ID, and owner hash, all owner-record matched.
5. **Medium - stories still claimed two C# modules.**
   - Fix: remove all C# implementation ownership and inventory; native
     supervisor owns capability and provider security mechanics.

## Round 58

Result: **1 High, 2 Medium findings**

1. **High - launcher guard directly spawned PowerShell despite native-only
   process authority.**
   - Fix: guard only validates nonce/vector and sends authenticated
     `spawn-sentinel-payload`; native coordinator alone creates PowerShell under
     sentinel token/Job/capture pipes.
2. **Medium - orphan cleanup omitted common accepted-wrapper commit.**
   - Fix: exact syntax now includes self hash and expected wrapper commit plus
     all four orphan authority fields.
3. **Medium - executable closure still mentioned removed C# sources.**
   - Fix: closure now enumerates PowerShell/native helpers only; no C# inventory
     remains.

## Round 59

Result: **1 High, 1 Medium findings**

1. **High - launcher/capsule still directly created core/PowerShell despite
   native-only process authority.**
   - Fix: native coordinator creates driver, core, guard, and sentinel
     PowerShell. Driver/guard/capsule only validate and send authenticated
     typed spawn requests; none calls `CreateProcess`.
2. **Medium - orphan story rejected the two root authorization inputs required
   by the exact template.**
   - Fix: story now accepts recorded worktree/Git-common roots as pinned,
     owner-record-matched discovery inputs while still forbidding any
     caller-supplied target path.

## Round 60

Result: **2 High findings**

1. **High - PE closure had no trusted pre-execution verifier/evidence.**
   - Fix: reviewed OS-only inline stager parses held candidate PE bytes,
     recursively resolves direct/transitive/forwarded System32 dependencies,
     verifies signatures/forbidden loaders before rename/execution, and emits a
     protected deterministic closure manifest required at closeout.
2. **High - residual text still let driver/guard spawn core/PowerShell.**
   - Fix: align every section: driver sends `spawn-core`, guard sends
     `spawn-sentinel-payload`, and native coordinator alone calls
     `CreateProcess`.

## Round 61

Result: **2 High, 1 Medium findings**

1. **High - PowerShell still directly started Git Bash.**
   - Fix: native parent creates every worker. Bash runs bounded `--emit-env`,
     spawns nothing, and returns environment; native then creates Node/Cargo/
     Git/Python workers on PowerShell IPC requests.
2. **High - PE proof omitted API-set and activation-context/SxS loader
   resolution.**
   - Fix: recursively resolve pinned API-set schema, forwarders, manifests/SxS,
     forbid candidate assemblies/redirection/bound/delay/dynamic loaders, bind
     closure to OS build, and verify PEB modules at native entry.
3. **Medium - privileged stager lacked an exact frozen operation interface.**
   - Fix: freeze one `stage-bootstrap` operation with exactly candidate-path
     Base64, candidate SHA, and operator SID; require exact cmd/Windows
     PowerShell encoded invocation and stager digest in closeout.

## Round 62

Result: **2 High, 1 Medium findings**

1. **High - native-only spawn language incorrectly forbade Cargo's required
   descendants.**
   - Fix: native owns every wrapper-root spawn; orchestration children never
     spawn. Cargo/rustc/linker/approved build scripts may create only
     Job+ETW-observed pinned toolchain/target descendants.
2. **High - candidate PE TLS callbacks could run before entrypoint checks.**
   - Fix: no_std candidate must have no TLS directory/callback; trusted stager
     parses/rejects TLS surface before staging/execution.
3. **Medium - nested transition story still described direct record
   interface.**
   - Fix: nested code uses injected authenticated broker-client requests only;
     tests fake broker replies, never record access.

## Round 63

Result: **1 High finding**

1. **High - elevated PowerShell executor could bypass native-only mutation/
   spawn authority.**
   - Fix: add fourth zero-capability executor AppContainer. Native creates
     PowerShell with executor lowbox token, child-process-restricted mitigation,
     no source/target/authority/network ACL, executor-scratch-only write, and
     explicit IPC handles. All useful operations remain native validated.

## Round 64

Result: **3 High findings**

1. **High - orchestration workers had no confinement assignment.**
   - Fix: add inspector AppContainer; PowerShell/Bash/Node/orchestration Python
     run child-process-prohibited executor lowbox from streamed bytes, Git runs
     read-only inspector lowbox, Cargo runs build lowbox.
2. **High - stable package SID ACLs were reusable by same-user processes.**
   - Fix: stable package SIDs receive no data ACL. Generate per-run secret role
     capability SIDs, split public source/tool read from secret target-write/
     credential/scratch rights, hide secrets, remove every ACE after drain, and
     leave target Admin/SYSTEM-only between runs.
3. **High - direct supervisor execution allowed pre-entry injection.**
   - Fix: every operation uses reviewed OS-only launcher-v1, which verifies the
     staged closure/OS/ACL/IFEO state and creates native supervisor with
     STARTUPINFOEX image-load/extension-point/dynamic-code mitigations active
     before initialization.

## Round 65

Result: **2 High and 5 Medium findings**

1. **High - secret capability SIDs remained exposed through operator-readable
   lease/ACL surfaces.**
   - Fix: make the ProgramData capability registry SYSTEM/Administrators-only;
     raw secret values live only there and in locked native memory. Sensitive
     target/scratch/credential capabilities appear only on admin-owned objects
     denying non-elevated `READ_CONTROL`; user-owned credentials receive no ACE
     and are copied through held handles into an ephemeral admin-owned capsule.
     Operator-readable evidence carries only keyed opaque labels/hashes.
2. **High - user-removable Git-common control state could fork or erase
   authority between runs through parent `DELETE_CHILD`.**
   - Fix: move lock/owner/journals/evidence to protected admin-owned ProgramData
     keyed by pinned Git-common repository identity. Git-common may contain
     only a non-authoritative locator/receipt whose deletion cannot authorize,
     erase, or fork state.
3. **Medium - residual lease text still recorded package-SID ACEs.**
   - Fix: all data leases record per-run role-capability SID ACEs; stable
     package SIDs receive no data ACL. Package SID use remains only for process/
     pipe peer identity where explicitly required.
4. **Medium - launcher environment sanitization occurred after Windows
   PowerShell initialization.**
   - Fix: each frozen launcher-v1 cmd prefix clears managed/runtime/profiler and
     PowerShell injection variables with cmd builtins before PowerShell starts,
     then sets only syntax-restricted fields.
5. **Medium - initial PEB verification did not enforce later dynamic module
   loads.**
   - Fix: after the first-instruction PEB check and before other APIs, register
     DLL notifications plus protected PID-bound Kernel-Image ETW; every later
     image must match the held signed closure or terminate non-ready.
6. **Medium - executor filesystem rights omitted Bash/Node/Python
   installations.**
   - Fix: exact held Bash/Node/Python installation/runtime roots receive
     read/execute/traverse-only executor role-capability leases when
     pre-existing access is absent; scripts remain coordinator-streamed and no
     repository/source filesystem input is granted.
7. **Medium - cleanup confirmation semantics conflicted with the generic
   runnable requirement.**
   - Fix: `--confirm-slow` is mandatory and accepted only for build/probe and
     recovery. Cleanup and orphan cleanup do not build, reject the flag, and
     expose no confirmation field.

## Round 66

Result: **2 High and 4 Medium findings**

1. **High - public probe/scenario/budget fields contradicted frozen native
   templates.**
   - Fix: remove all caller/environment substitutions except optional validated
     run ID. Probe, scenario, budget, authentication, and confirmation are
     derived solely from the selected native subcommand.
2. **High - credential capsule discovery/location was writable or could fall
   back to user auth.**
   - Fix: create an admin-owned `smoke\credential-capsule` sibling outside all
     model-writable roots, hold its identities with delete/write sharing denied,
     inject a sealed child-only `COPILOT_API_HOME` plus query handle, reject
     every fallback, and remove the ACE/handle-wipe after drain.
3. **Medium - external Git-common was not actually watched.**
   - Fix: arm the worktree watcher first, open/lock `.git` and `commondir`,
     then arm one non-overlapping external Git-common watcher before any further
     Git-admin read or Git invocation. In-root Git-common remains under the
     source watcher; both domains share the barrier sequence.
4. **Medium - pipe operator ownership implicitly allowed `WRITE_DAC`.**
   - Fix: set pipe owner/group to Administrators, add restrictive
     `OWNER RIGHTS`, omit operator trustee rights, and test same-user ACL/owner
     mutation denial.
5. **Medium - story target tests retained stable package data rights.**
   - Fix: require exact per-run role-capability target/scratch ACEs and
     explicitly assert no stable package-SID data ACE.
6. **Medium - closeout still verified a Git-common cleanup receipt.**
   - Fix: verify only the protected ProgramData receipt through authenticated
     supervisor output; Git-common receipts are non-authoritative diagnostics.

## Round 67

Result: **1 High and 3 Medium findings**

1. **High - large untracked inline stager/launcher programs exceeded cmd limits
   and were unauditable.**
   - Fix: track seed/full-stager/launcher sources. Deterministically encode only
     a BCL-only `<=2800`-character seed whose full expanded cmd is tested
     `<=7900`; it executes no candidate bytes and hash-stages full scripts into
     protected ProgramData. Full stager/launcher then use short protected
     `-File` invocations, with all source/artifact hashes recorded.
2. **Medium - quota authority remained under caller-selected target root.**
   - Fix: move quota lock/reservations to admin-only ProgramData keyed by held
     NTFS volume identity and target-root identity/path hash. No authoritative
     quota file lives below targetRoot.
3. **Medium - pipe DACLs still granted stable package-SID data rights.**
   - Fix: add distinct per-run provider/model-nonce/sentinel-nonce capability
     SIDs to pipe DACLs. Stable package SIDs remain authenticated peer identity
     only and receive no pipe data ACE.
4. **Medium - generic scenario mapping conflicted with frozen subcommands.**
   - Fix: make the section-1 operation matrix authoritative for exact scenario
     and default run-ID prefix; remove generic build/auth/recovery buckets.

## Round 68

Result: **1 High and 3 Medium findings**

1. **High - driver could not pass its process-local coordinator handle to a
   coordinator-created core.**
   - Fix: coordinator retains the source handle and injects separate query-only
     duplicates directly into driver, core, and guard at each suspended
     `CreateProcess`; no child may duplicate/pass it onward.
2. **Medium - root-scoped quota locks over-admitted different roots on one
   volume.**
   - Fix: use one ProgramData quota lock/registry per held NTFS volume; each
     reservation stores its root identity/path hash.
3. **Medium - explicit target-root override was absent from launcher field
   matrices.**
   - Fix: add optional operator-visible `TargetRoot` to every normal
     target-bearing template, default it to `D:\codex-targets`, clear ambient
     input, and validate it before mutation. Orphan cleanup remains owner-
     record-derived.
4. **Medium - public and compiled confirmation contracts conflicted.**
   - Fix: runnable rejects `--confirm-slow`; choosing one exact reviewed
     non-substitutable operation template is the explicit authorization.
     Existing executable/publish confirmation remains unchanged.

## Round 69

Result: **1 High and 3 Medium findings**

1. **High - TLS-blind coordinator could not classify semantic terminal EOF.**
   - Fix: strict core sends a nonce-bound request/response/body-hash
     `provider-terminal` message only after terminal plus same-buffer
     validation; coordinator flushes/ACKs then closes. Pre-ACK EOF fails and
     post-ACK coordinator close succeeds.
2. **Medium - query-handle non-transferability was asserted but unenforced.**
   - Fix: driver/core/guard start child-process-prohibited, receive separate
     coordinator-injected handles, clear inheritance, attest/derive session,
     then close before normal handling. Add duplicate/inherited-child tests.
3. **Medium - runnable job-count override had no authorized template field.**
   - Fix: freeze runnable `CARGO_BUILD_JOBS=8`, reject/clear ambient override,
     and preserve predecessor override behavior only for other modes.
4. **Medium - transaction/quota/lease lock ordering was undefined.**
   - Fix: own transaction outermost; quota and lease locks nonblocking, brief,
     and never overlapping. Stale pruning snapshots under quota, probes foreign
     transaction/PID after release, then revalidates. Add barriered multi-root/
     multi-volume admission-cleanup tests.

## Round 70

Result: **3 Medium findings**

1. **Medium - valid provider EOF could race the terminal ACK.**
   - Fix: coordinator latches pre-ACK EOF for two seconds; strict core validates
     clean terminal+EOF and sends `transportEof:true`. Matching bounded ACK
     succeeds; partial/pre-terminal/no-ACK EOF fails.
2. **Medium - clearing inheritance did not detect in-process query-handle
   duplicates.**
   - Fix: driver/core/guard close then wait at a ready gate; elevated
     coordinator enumerates each target handle table and opens the gate only
     when zero coordinator-process references remain. Unsupported query or a
     deliberate retained duplicate fails.
3. **Medium - stale quota reservations lacked a foreign transaction-lock
   locator.**
   - Fix: persist repository ID, protected ProgramData-relative lock locator,
     lock file identity/generation, owner digest, and PID/creation; pruning
     resolves only that protected relative path and revalidates all fields.

## Round 71

Result: **4 Medium findings**

1. **Medium - terminal claim still raced provider EOF.**
   - Fix: split claim from final. Coordinator returns `ack-close` while open or
     a flushed nonce-bound `EOF_PENDING` challenge when EOF raced; core then
     performs exactly one bounded clean-EOF read and sends one challenge-bound
     final. Test every claim/EOF ordering.
2. **Medium - nested core-side terminal/handle protocols lacked a PRD-A
   owner.**
   - Fix: N-US-001 owns terminal disposition/body hash/one-shot EOF primitive;
     N-US-002 owns core broker claim/challenge/final plus startup attestation/
     ready-gate requests. Wrapper US-NET consumes those landed protocols and
     owns only coordinator/launcher integration.
3. **Medium - post-gate coordinator `OpenProcess` denial was not exact.**
   - Fix: set coordinator process owner/group Administrators and a protected
     SYSTEM/Administrators-only DACL with restrictive OWNER RIGHTS; AccessCheck
     and live post-gate lowbox query/duplicate opens must fail.
4. **Medium - quota generations/schema remained ambiguous and story-incomplete.**
   - Fix: define `codex-runnable-quota/v1` with explicit random reservation/
     owner generations, record sequence, all IDs/digests, transaction/PID,
     bytes/state, protected lock locator/identity, and revalidate every
     canonical field/hash around the foreign-lock probe.

## Round 72

Result: **4 Medium findings**

1. **Medium - plan retained stale narrow N-US-002 ownership.**
   - Fix: N-US-001 owns terminal disposition/EOF primitive; N-US-002 owns every
     nested core/exec attestation, transition, terminal, and RESULT protocol;
     US-NET owns protected coordinator/launcher integration only.
2. **Medium - quota state had no exact values or crash semantics.**
   - Fix: freeze JSON field types and
     `prepared -> reserved -> releasing -> removed`; prepared/reserved count
     bytes, removed is retained zero-byte receipt, sequence increments per
     flush+rename, unknown/regressed states block, and test every edge.
3. **Medium - rustup resolution conflicted with empty isolated RUSTUP_HOME.**
   - Fix: before isolation, use one bounded no-network child with held canonical
     operator rustup home to resolve/pin Cargo/rustc; actual children use empty
     scratch RUSTUP_HOME and absolute tools only.
4. **Medium - process-object DACLs were applied after creation.**
   - Fix: launcher/coordinator supply explicit protected Administrators/SYSTEM
     process/thread security descriptors in every CreateProcess security
     attributes, verify at first instruction, and test pre-DACL race denial.

## Round 73

Result: **1 High and 1 Medium finding**

1. **High - one retained removed reservation file blocked later generations and
   contradicted absent-reservation cleanup.**
   - Fix: split create-new `live\<targetId>.json` from generation-keyed
     `receipts\<targetId>\<generation>.json`. Live advances
     prepared/reserved/releasing; durable removed receipt binds final live hash,
     then exact live deletion is flushed. Receipt+live resumes deletion and
     receipt-only is idempotent without blocking next live generation.
2. **Medium - N-US-002 still omitted nested RESULT/ACK/DELIVERED while US-NET
   retained core validation.**
   - Fix: N-US-002 owns/tests all nested framing, ACK/DELIVERED validation and
     output gate. US-NET consumes that contract and owns only coordinator
     capture/persistence/result delivery/crash integration.

## Round 74

Result: **1 High and 1 Medium finding**

1. **High - cleanup assumed a live reservation after successful finalization
   had deleted it.**
   - Fix: owner binds the last removed receipt. Cleanup records either
     `already-released` (no live + exact receipt; no quota transition) or
     `live-generation` (matching live; finalize receipt then delete live).
     Conflicts fail before target rename and both branches have crash fixtures.
2. **Medium - US-NET retained stale nested-client ownership wording.**
   - Fix: N-US-002 owns every nested broker client/frame/ACK/DELIVERED/output
     gate. US-NET owns coordinator persistence/capture/delivery plus launcher
     driver/guard integration only.

## Round 75

Result: **2 Medium findings**

1. **Medium - guard chain recursively spawned a second guard.**
   - Fix: core exact-sentinel path validates vector/cwd and sends one
     `spawn-guard`; coordinator creates exactly one guard; that guard validates
     nonce/role/vector and sends only `spawn-sentinel-payload`.
2. **Medium - launcher `main.rs` retained nested result validation ownership.**
   - Fix: limit launcher overlay to driver/guard attestation, handle
     stripping, and `spawn-core`/`spawn-sentinel-payload` requests. N-US-002
     retains RESULT/ACK/DELIVERED validation.

## Round 76

Result: **1 High and 2 Medium findings**

1. **High - BCL-only seed could not implement no-follow identity-safe staging.**
   - Fix: permit a frozen minimal native allowlist in tracked seed source and
     deterministically raw-deflate it into a fixed BCL loader. Regenerate/
     import-audit byte-exact and require full cmd `<=7900`; runtime executes
     only the reviewed embedded artifact.
2. **Medium - private `build_session_headers` was outside accessible/allowed
   scope.**
   - Fix: use existing public production `CopilotHeaderSource` with held inputs
     and one stable session UUID across continuation requests; copy only
     Authorization and make no `auth.rs` visibility edit.
3. **Medium - N-US-001 terminal hash lacked a dependency available in its
   commit.**
   - Fix: add only `sha2.workspace = true` to `codex-api/Cargo.toml`, compute
     incrementally in strict decoder, and require no lockfile/profile change.

## Round 77

Result: **4 Medium findings**

1. **Medium - scope still claimed zero Cargo manifests.**
   - Fix: record exactly one `codex-api/Cargo.toml` workspace dependency line
     and zero profile/lockfile changes.
2. **Medium - session header matrix treated fresh session ID as held input.**
   - Fix: machine/device IDs are held; `vscode-sessionid` is one fresh
     `CopilotHeaderSource` UUID reused across both requests.
3. **Medium - credential/sentinel capability paragraph was truncated.**
   - Fix: restore sentinel subject and exact model drain -> ACE removal ->
     held-handle truncate/delete -> parent flush sequencing.
4. **Medium - US-006 omitted exact accepted warm/incremental baseline values.**
   - Fix: freeze `9.030`, `92.963`, `98.635`, `170.032`, and
     `5.184-7.286 GiB` alongside cold failure/no-SLO.

## Round 78

Result: **CLEAN - no Medium+ findings.**
