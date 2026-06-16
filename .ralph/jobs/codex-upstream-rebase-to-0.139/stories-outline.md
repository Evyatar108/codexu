# Stories Outline: Codex Upstream Rebase `rust-v0.135.0` → `rust-v0.140.0`

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan`
for PRD generation. **Serial-only** — a rebase is one dependency chain in one worktree; do not
parallelize.*

## US-001: Setup — wrapper worktree, merge drivers, iteration env
**Description:** As the impl session, I want a correctly-staged wrapper worktree so the squash
merge runs in the only layout the submodule builds in.
**Acceptance Criteria:**
- [ ] `gh auth status` checked; ready to `gh auth switch --user Evyatar108` for inner pushes
- [ ] `bash scripts/setup-merge-drivers.sh` run from wrapper root
- [ ] `bash scripts/check_submodule_lag.sh` confirms `latest_stable_tag = rust-v0.140.0`
- [ ] Temporary wrapper worktree created; `external/repos/codex-patched` submodule init'd inside it
- [ ] `scripts/iteration-env.sh` sourced from wrapper root (frozen LTO=off + sccache profile)
**Dependencies:** None
**Estimated complexity:** small

## US-002: Squash merge + conflict resolution (the core)
**Description:** As the impl session, I want `rust-v0.140.0` squash-merged onto `sandbox-patches`
with every fork patch re-anchored, so fork behavior survives upstream refactors.
**Acceptance Criteria:**
- [ ] `git merge --squash FETCH_HEAD` (rust-v0.140.0) applied on `sandbox-patches`
- [ ] **P2 (remote-control 3-layer disable)** re-derived against the +802/−25 rewrite;
      Invariants 8/9/10 hold; 10 `#[ignore]` markers preserved; new remote_control tests audited
- [ ] **P3 (multi-agent tool registration)** re-anchored against the ToolExecutor trait refactor
      (#27304/#27299); plugin-scope-axis gate + D-002 handler registration intact
- [ ] All 8 fork feature gates present in `features/src/lib.rs` alongside the 7 new upstream variants
- [ ] Paste-burst (P10): preserve `Feature::LegacyPasteBurstHeuristic` default `cfg!(windows)` +
      the `core/src/config/mod.rs:2577-2588` compatibility adapter + canonical feature precedence;
      do NOT replant `unwrap_or(true)` (patch-surface §11 + Inv 46)
- [ ] Obsolescence items resolved: `close_agent`→`interrupt_agent` hint updated (P4);
      `cloud-requirements` patch retired/relocated (P8); `${CLAUDE_PLUGIN_ROOT}` call-site re-verified (P18)
- [ ] Every preserved `// SANDBOX PATCH:` marker present; any retired marker documented in `patch-surface.md`
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Phase 5a — workspace cargo-check convergence (HARD GATE)
**Description:** As the impl session, I want `cargo check --workspace` at zero errors before any
push, so rebase debt is resolved locally rather than as a CI long tail.
**Acceptance Criteria:**
- [ ] `cargo check --workspace` exits 0 (zero `error[E…]`, terminal `Finished`), log captured
- [ ] Pre-filed debt-fix areas resolved: tools-registration (`PlannedTools`/`CoreToolRuntime`),
      `config/mod.rs` orphans+new fields, `app-server` ExecParams/type-init, `remote_control`
      type/test drift, `tui` merge-markers/style, `tool_config.rs` (file independent
      `codex-rebase-debt-fix-*` sub-tasks if a cluster is large, resolved serially in this worktree)
- [ ] `cargo test -p codex-cli login_provider` passes (US-013)
- [ ] `cargo test -p codex-stream-diagnostics` privacy canary passes (P17)
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Static audit gates (pre-build)
**Description:** As the impl session, I want the static + silent-drop audits green so no
network-suppression or auth seam silently regressed — before spending build time.
**Acceptance Criteria:**
- [ ] `bash scripts/audit_network_calls.sh`: 0 unpatched / 0 new endpoints / 0 IP / 0 IPC / 0 no_proxy
- [ ] `bash scripts/audit_invariants.sh` green (covers redirect-paths Inv 31)
- [ ] Silent-drop checklist passes (mod-decls, `CoreAuthProvider` re-export chain, `is_copilot`
      routing arm, `codex-copilot` deps, orphaned-`.rs` scan, US-013 login grep set)
- [ ] (Runtime ETW audit deferred to US-005 — it needs the freshly-built release binary)
**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: Release cut (`/publish-sandbox-patch`) + runtime audit + pre-tag smoke
**Description:** As the impl session, I want a tagged, published release of the rebased fork,
audited and smoked against the freshly-built binary.
**Acceptance Criteria:**
- [ ] Suffix bumped in `…/codex-patched/codex-rs/Cargo.toml` (e.g. `0.140.0-copilot-api.1`)
- [ ] Full shipped binary set built via the `/publish-sandbox-patch` command (`codex.exe`,
      `codex-core.exe`, `rg.exe`, `codex-windows-sandbox-setup.exe`, `codex-command-runner.exe`)
      under LLVM/xwin env; stray codex processes killed first
- [ ] Runtime ETW audit (`runtime_audit.ps1 -ExtendedSmoke`, elevated, `-CodexExe` → the
      freshly-built `target/release/codex.exe`): `RESULT: PASS — all contacts in allowlist`
- [ ] Pre-tag live Copilot smoke: `codex.exe --version` + one-shot `exec` returns a real reply
- [ ] Commit + tag in submodule; `sandbox-patches` + `release/<ver>` retention tag pushed to
      `Evyatar108/codex-openai-fork`
**Dependencies:** US-004
**Estimated complexity:** medium

## US-006: Closeout — gitlink, pointer bumps, Phase 5b
**Description:** As the impl session/lead, I want the wrapper + codexu pointers bumped and the CI
(or interim) closeout recorded.
**Acceptance Criteria:**
- [ ] Wrapper gitlink bumped on `gim-home/codex@main` (evmitran_microsoft SAML)
- [ ] codexu submodule pointer bumped, pushed to `origin` (evmitran_microsoft) + `personal` (Evyatar108)
- [ ] `patch-surface.md` refreshed to "Applies to 0.140.0-copilot-api.1"
- [ ] Phase 5b: `invariant-check` green on both legs, OR interim-closeout recorded citing
      `escalate-gim-home-actions-policy` with the cargo-check-workspace log path
**Dependencies:** US-005
**Estimated complexity:** medium

## US-007: Overview bookkeeping
**Description:** As the lead, I want `.ralph-overview/data.json` updated when the rebase ships.
**Acceptance Criteria:**
- [ ] Task `lifecycle` flipped to `merged` only after work is on `origin/main`
- [ ] `shipManifest` added (shippedAt, human summary, commits[]) per AGENTS.md bookkeeping rules
**Dependencies:** US-006
**Estimated complexity:** small
