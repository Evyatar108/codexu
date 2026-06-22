# Pre-release holistic code + security review: raw-codex Happy autoconnect (`feat/remote-session`)

**Reviewer:** `review-autoconnect` (read-only review member, Copilot)
**Date:** 2026-06-22
**Scope:** the complete `remote_session` feature (US-001..009) across both repos.

| Repo | Feature tip | Merge-base (vs release branch) | Diff |
|---|---|---|---|
| WRAPPER (`gim-home/codex`) | `58b9472a0` | `1d1c48b4f` (`origin/main`) | +7396 / -3 over 38 files — the `codex-rs-overlay/codex-happy` crate + launcher + invariant tests + audit scripts + patch-surface docs |
| INNER (`Evyatar108/codex-openai-fork`, `external/repos/codex-patched`) | `7b572a43f` | `834e85408` (`origin/sandbox-patches`) | +507 / -15 over 14 files — the bounded seam: app-server-client resolve/reject, `Feature::RemoteSession`, `app.rs` `happy_tap` tee, `/remote` slash command |

## Verdict: **GO-WITH-FIXES**

No **Critical** and no **reachable High** issues in the shipping feature path. The feature is operator-gated and **default-OFF**; a vanilla codex user is byte-unaffected. The crypto is byte-compatible with `encryption.ts`, the approval double-answer dedup is provably safe, the upstream seam is a pure non-blocking tee, and egress is fully audited (loopback + allowlisted GitHub only).

The single security defect (M1) is in **dormant-but-shipped** code (`onboard.rs`, not yet wired into any runtime path). It is not a blocker for *this* release as wired, but it ships as public API and **must be fixed before the self-onboard follow-up activates it** — and is cheap to fix now (in-tree precedent exists).

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Informational | 2 |

**Must-fix set (the "with-fixes"):**
- **M1** — owner-only permissions on `~/.happy/access.key` (+ dir `0o700`) in `onboard.rs` **before** that module is wired into any runtime path; recommended to land in this release since the insecure writer ships as `pub` API.

**Should-fix (non-blocking):**
- **L1** — add a high safety-cap to the unbounded `happy_tap` channel (convert "unbounded" → "bounded-but-effectively-lossless").

Everything else verified clean — see "What was verified clean" below.

---

## Findings

### M1 — MEDIUM (currently dormant): self-onboard writes E2EE private key + bearer token world-readable on Unix

**File:** `codex-rs-overlay/codex-happy/src/onboard.rs:377-387` (`write_json_atomically`), called by `write_credentials` (`:262-277`), `write_profile` (`:314-323`), `seed_machine_id` (`:329-350`).

```rust
fn write_json_atomically(path: &Path, value: &Value) -> Result<(), OnboardError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)...;          // ~/.happy created 0o755 on Unix
    }
    ...
    fs::write(&tmp, serialized)...;             // tmp + final access.key 0o644 on Unix
    fs::rename(&tmp, path)...;
}
```

**Rationale.** `~/.happy/access.key` holds the session **bearer `token`** and, in dataKey mode, the **X25519 E2EE secret `machineKey`** (`generate_data_key_credentials` -> `CredEncryption::DataKey { machine_key, .. }`, `onboard.rs:247-256`). The `machineKey` is the crux of the whole E2EE identity — leaking it defeats end-to-end encryption (an attacker who reads it can decrypt/impersonate the session); the `token` grants session access. On Unix, `fs::write` honors only the process umask, so the file typically lands **`0o644` (world-readable)** and `~/.happy` **`0o755`**. Any other local user / unprivileged process can then read the private identity.

The TypeScript reference enforces owner-only perms everywhere this matters:
- `packages/happy-wire/src/writeJsonAtomically.ts:51` — `fs.writeFile(tempPath, ..., { mode: 0o600 })`
- `packages/happy-cli/src/configuration.ts:70,73` — `~/.happy` created with `mode: 0o700` + `chmodSync(..., 0o700)`
- `packages/happy-wire/src/applyOwnerOnlyPerms.ts:10` — explicit `fs.chmod(filePath, 0o600)`

**Why MEDIUM, not High:** `onboard.rs` is **not reachable from any runtime path** in this release. `attach.rs::establish` returns `None` (silent vanilla fallback) when creds are absent (`attach.rs:254-256`) and never calls `onboard`; `/remote on` only surfaces an onboarding hint (`slash_dispatch.rs:716-738`, comment: *"the interactive self-onboard is a separate follow-up story"*). The only writers of `~/.happy/*` live in `onboard.rs`, and the only callers of those are `onboard_tests.rs`. So the world-readable write is **latent** — it ships in the binary as `pub` API but is never executed. The overlay otherwise only **reads** an existing `access.key` (written by the TS `happy` with correct `0o600`).

**Concrete fix.** Mirror the in-tree precedent `codex-rs-overlay/codex-copilot/src/auth.rs:458-469` (`write_secret_file`), which already does exactly this:

```rust
let mut options = fs::OpenOptions::new();
options.write(true).create(true).truncate(true);
#[cfg(unix)]
{
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}
let mut file = options.open(&tmp)?;
file.write_all(serialized.as_bytes())?;
```

Apply `0o600` to the temp file for `access.key` (at minimum), and create `~/.happy` with `0o700` on Unix (e.g. `DirBuilder::mode(0o700)`), matching `configuration.ts`. Windows ACLs on the user profile dir already restrict access, so the `#[cfg(unix)]` gate is sufficient (matches the TS, whose numeric modes are Unix-meaningful only).

---

### L1 — LOW (intentional design tradeoff): `happy_tap` tee channel is unbounded; can grow under a wedged-but-alive local server

**Files:** `tui/src/app.rs:592-595` (the `Option<mpsc::UnboundedSender<AppServerEvent>>` field) + `:1238-1247` (the tee); `codex-rs-overlay/codex-happy/src/attach.rs:119` (`mpsc::unbounded_channel`), drained one-at-a-time in the main loop `:193-239` with `send_envelope(...).await` blocking on a per-message `SEND_TIMEOUT = 10s` POST (`attach.rs:485-492`, `session.rs:340-359` is a directly-awaited reqwest POST with no internal queue).

**Rationale.** The TUI->overlay channel is unbounded by design. If the loopback happy-server accepts connections but responds very slowly (e.g. the local daemon is itself wedged on its Dev-Tunnel upstream), each envelope POST blocks up to 10s while the loop holds; meanwhile the TUI keeps pushing `event.clone()` into the unbounded channel, so it can accumulate without a hard cap.

**Why LOW (and partly intentional):**
- **High-frequency events do not POST.** `mapping.rs::map_event` drops every streaming delta (`item/*/delta`) -> `Vec::new()`; only `item/started`, `item/completed`, `turn/started`, `turn/completed` produce an envelope (`mapping.rs:57-122`). So the blocking drain happens only a handful of times per turn, not per token; delta events drain instantly (pure fn, no await).
- **The unboundedness is a deliberate, tested choice.** `happy_seam_invariants.rs::invariant_52_unbounded_tap_is_lossless_and_ordered_under_slow_consumer` explicitly asserts losslessness/ordering under a slow consumer — the authors chose losslessness over a hard cap on purpose.
- **Not remotely exploitable.** The "server" is the operator's own loopback daemon; growth is bounded in practice by turn verbosity (a few MB to tens of MB worst case), degrades to memory pressure only, no crash/corruption.

**Concrete fix (optional, defense-in-depth).** Keep losslessness for the common case but add a large safety valve: either (a) a bounded `mpsc::channel(N)` with a `try_send` drop-oldest policy on overflow (mirroring the existing `PRECONNECT_BUFFER_CAP = 512` philosophy in `attach.rs:75`), or (b) a soft cap that, when exceeded, coalesces/drops the oldest transcript events. Alternatively, document the accepted unbounded-growth risk on the field. Not a release blocker.

---

### L2 — LOW: `expect()` panics on the outbound encrypt paths

**File:** `codex-rs-overlay/codex-happy/src/encryption.rs:130, 176, 217` — `.expect("... seal must not fail")` on `SalsaBox::encrypt`, `XSalsa20Poly1305::encrypt`, `Aes256Gcm::encrypt`.

**Rationale.** AEAD encryption only fails on impossible-in-practice conditions (plaintext exceeding the cipher's size limit, ~64 GiB for GCM). These are **outbound** paths over the session's own content (never remote-attacker-controlled input), so a panic is not remotely triggerable. Even if one fired, it runs on the spawned overlay task (`tokio::spawn` in `maybe_attach`), so a panic aborts only that task — the TUI is unaffected (degrades to no mirroring). **Note:** all `decrypt` paths correctly return `Option`/`None` (no panic) — `encryption.rs:144-157, 185-196, 228-242`. The `agent_state.rs:120,129` `expect()`s are provably unreachable (value is set to `{}` immediately before `as_object_mut`), and `session.rs:592` `slot.lock().unwrap()` cannot poison (the only lock holder is the infallible `take()` + `send()`).

**Concrete fix (optional).** Return `Result`/`Option` from the encrypt helpers for defense-in-depth, or leave as-is with the rationale documented. Not a blocker.

---

### I1 — INFORMATIONAL: remote-control trust boundary (inherited happy model, faithfully replicated)

The inbound control RPCs — `permission` (exec/patch approve/deny), `abort`, `killSession` — arrive on the **plaintext** `rpc-request` Socket.IO channel (`session.rs::handle_rpc_request:751-759`, no decryption), and session **metadata** (cwd path, hostname, OS — `attach.rs::build_metadata:507-519`) is **plaintext JSON** on the wire. This is the documented happy architecture (`packages/happy-cli/AGENTS.md`: *"RPC request params and responses are plaintext Socket.IO payloads; keep encryption on message bodies, metadata, and state fields only"*), faithfully inherited: E2EE protects **content confidentiality** (message bodies + agent state are encrypted — `session.rs:340-380` send, `:628-699` receive), **not** control-channel integrity against a malicious relay. Injection requires the session bearer token (socket auth) or a compromised happy-server; a random network peer cannot inject. This is by-design for the feature (mobile *is* a trusted, E2EE-paired remote driver) and is not a defect in this implementation — surfaced so the operator understands the precise boundary when answering *"can a remote peer bypass approvals / escalate?"*: **no** beyond the intended remote-control capability, and **no double-execution** (see verified-clean #3).

### I2 — INFORMATIONAL: `onboard.rs` ships as dead code

`onboard.rs` (US-003 self-onboarding) is complete, unit-tested, and `pub`-exported (`lib.rs:28`) but invoked by **nothing** at runtime (confirmed by grep across the overlay and the inner TUI). The plan's refinement #1 ("codex self-onboards") is therefore **not yet wired**; `/remote on` without creds surfaces a hint to run `happy` once. This is a documented scope decision (`slash_dispatch.rs:717`), not a bug — but it means M1 and any other onboarding behavior are unexercised in this release. Re-review `onboard.rs` (esp. M1) before the self-onboard follow-up wires it in.

---

## What was verified clean (the GO rationale)

1. **Crypto byte-compat (US-002).** `encryption.rs` matches `packages/happy-cli/src/api/encryption.ts` byte-for-byte across all five primitives: legacy secretbox `nonce(24) || ct`; dataKey AES-256-GCM bundle `version(0) || nonce(12) || ct || tag(16)`; libsodium box bundle `ephPub(32) || nonce(24) || box`; Ed25519 auth challenge; and the `sha512(seed)[0:32]` X25519 quirk. Nonces are fresh per message via `OsRng` (CSPRNG, `encryption.rs:58-60`) — identical to the TS `randomBytes` behavior; random 96-bit GCM nonces under a per-session random data key are safe at session scale and match existing TS production behavior (no new risk). KAT/round-trip tests present (`encryption_tests.rs`).
2. **`dataEncryptionKey: null` fidelity (US-003).** `api.rs:144-176` replicates `api.ts:34-71` exactly: dataKey mode computes-and-discards the sealed key and POSTs `dataEncryptionKey: null`. Correct fidelity (getting this "right" would silently break mobile decryptability) — verified against the live `api.ts`.
3. **Approval double-answer dedup is safe (US-007).** Both the local TUI and the overlay can resolve the same codex approval (overlay sees it via the tee, `attach.rs:168-169`). The in-process app-server treats a response to an already-resolved / unknown `request_id` as a **no-op** (`in_process.rs:288-292` doc: *"sending arbitrary IDs has no effect on app-server state"*; dispatch via `respond_to_server_request` -> `request_id_to_callback.remove`, `outgoing_message.rs`). So **first resolve wins; second is dropped — no double-execution, no panic.** The overlay also self-dedups via `pending_approvals.remove(id)` (`attach.rs:416`). A malformed mobile `permission` defaults to **deny/abort** (`inbound.rs::canonical_decision:318-330` -> `approved=false` => `"abort"`) — fail-safe. On abort/kill, pending approvals are canceled so codex is never left waiting (`attach.rs:437-469`); `killSession` detaches the Happy client **without** killing the in-process codex session (`attach.rs:319-322`).
4. **Bounded seam = pure non-blocking tee (US-005).** `app.rs:1238-1247` clones each event into the tap **before** `handle_app_server_event` — the original event is handled identically (pure tee, no upstream behavior change). `let _ = tap.send(event.clone())` is non-blocking (`UnboundedSender`) and discards send errors — **no panic, no backpressure on the TUI loop**. The "OutputTextDelta without active item" panic class cannot be introduced by a clone-only tee. `/remote on|off` cleanly sets/drops the tap (`event_dispatch.rs:apply_remote_session_toggle`), no double-attach (`if self.happy_tap.is_none()`).
5. **Inbound decrypt is drop-on-failure (US-007).** `decrypt_value` returns `Option`; AEAD auth-failure / tamper / base64 / JSON errors -> `None` -> message dropped (or lossless backfill for in-order), never acting on unauthenticated content (`session.rs:649-699`). No panic.
6. **Fallback + gating (US-008/009).** `Feature::RemoteSession` is `default_enabled: false`, `Stage::Experimental`, covered by `features/src/tests.rs::fork_visibility_features_are_experimental_and_disabled_by_default` and `happy_seam_invariants.rs::invariant_53`. Vanilla path is byte-unaffected (tap is `None` when feature off — `app.rs:1024-1047`). Idempotency: `HAPPY_CURRENT_SESSION_ID` set => `maybe_attach` returns `None` (no double-wrap, `attach.rs:116-128`). Offline/no-creds => silent vanilla within an 8s `CONNECT_BUDGET` (`attach.rs:67, 155-176`) — the establish runs on a background task so the first prompt is never blocked.
7. **Network egress fully audited (US-008).** The only egress is loopback `http://127.0.0.1:<port>` to happy-server (`api.rs`, `session.rs`, `auth.rs`) plus the dormant `onboard.rs` GitHub calls (`github.com`, `api.github.com`). All registered: `scripts/audit_network_calls.sh` `OVERLAY_KNOWN_PATCH_FILES` (+`api/session/onboard/auth.rs`) and `scripts/runtime_audit_allowlist.txt` (`github.com`, `api.github.com`, `devtunnels.ms`, with happy-server documented as loopback-only). `// SANDBOX PATCH:` markers present on every egress + every upstream-canonical seam edit (`app.rs`, `app-server-client/src/lib.rs`, `features/src/lib.rs`, `slash_command.rs`, `slash_dispatch.rs`). No unaudited egress; no direct non-loopback happy-server egress from codex.
8. **Seam invariant tests present.** `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` (invariants 52/53/54/57: unbounded-tap marker + tee-before-handle + lossless-under-slow-consumer + default-off + resolve/reject handle + `/remote` markers) and `happy_wire_drift_guard.rs` (pins the in-repo `@slopus/happy-wire` schemas).

## Out of scope (context only — NOT release blockers)
- codex-invariant-tests invariant-15 `background_completion.rs` (`PreparedBackgroundCompletion` upstream rename) — pre-existing rebase debt.
- `codex-happy` rustfmt debt on the pinned 1.95.0 toolchain — pre-existing.

## Suggested follow-up tasks
- Fix M1 (owner-only perms in `onboard.rs`) — small, in-tree precedent. File as a blocker on the self-onboard wiring story.
- (Optional) L1 safety-cap on the `happy_tap` channel.
