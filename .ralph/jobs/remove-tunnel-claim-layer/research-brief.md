# Research Brief — WS1: Skip refreshTunnelClaim Roundtrip

## Researcher Findings

- **`refreshClaim.ts` (current state):**
  - `MIN_REFRESH_INTERVAL_MS = 12_000` at line 5.
  - `refreshTunnelClaimOnce(...)` at lines 56–82: `ensureFreshConnectToken` → wait for min interval → POST `/pair/complete` → `validateFreshClaim(body.machine.tunnelClaim)` → return.
  - `validateFreshClaim` at lines 34–54: re-parses envelope/payload manually (duplicates `parseTunnelClaimPayload`); enforces `iat`/`exp` sanity, `payload.exp - payload.iat <= 3600`, and `exp > now-30`.
  - Per-machine queue (`queues`, lines 7, 84–94) serializes concurrent callers on one machine.
- **`parseTunnelClaimPayload`** (`packages/happy-app/sources/auth/pairing.ts:202-206`):
  - Returns `{ sub?, iat?, exp?, jti?, accountId? }` (all `unknown`).
  - **Throws** on invalid envelope (`Invalid tunnel claim envelope`). Does NOT return null.
  - `exp` is in **Unix seconds**, not ms (matches `refreshClaim.ts:48` comparison to `Math.floor(Date.now() / 1000)`).
- **`AuthCredentials.tunnelClaim`** (`packages/happy-app/sources/auth/tokenStorage.ts:14`): required `string` (not optional).
- **Test infrastructure** (`packages/happy-app/sources/sync/refreshClaim.test.ts`):
  - vitest with `vi.mock('@/auth/connectTokenRefresh', ...)` and `global.fetch = vi.fn(...)`.
  - `makeCredentials()` factory at lines 14–23.
  - Date mocking via `vi.spyOn(Date, 'now').mockReturnValue(...)` (line 96).
  - **BUT: file is severely stale** — see "Critical findings" below.
- **CLAUDE.md sync invariant ("Session/machine-scoped network calls")** (`packages/happy-app/CLAUDE.md`, scope-builder paragraph): mandates `apiSocket.forSession(sid)` / `apiSocket.forMachine(mid)` / `apiSocket.forPrimaryMachine()` for **session/machine-scoped** calls. `refreshClaim.ts` is auth-level (not session-scoped); the POST to `${credentials.tunnelUrl}/pair/complete` is not covered by this invariant. **WS1 does not require apiSocket changes.**
- **Plan document** (`plans/realtime-sync-perf.md:80-103`): describes WS1 exactly as in the user task. Single-commit, 30–45 min estimate. Does NOT mention `jti` replay protection — see Codex findings.
- **Validation doc target** (`docs/validation/devtunnels-boox-result.md:161-202`): "Realtime sync perf (deferred)" subsection lists three pain points to mark resolved.
- **Test command verification:** `pnpm --filter '{packages/happy-app}' exec vitest run sources/sync/refreshClaim.test.ts` is correct (package.json:12 has `"test": "vitest"`, vitest.config.mts:15 auto-discovers `sources/**/*.{spec,test}.{ts,tsx}`).

## Architect Analysis

- **Call chain:** `refreshTunnelClaim` is called only from `machineAuth.ts:65-72` (`getMachineAuthHeaders`), which itself is called from `tunnelFetch()`. Upstream callers include `fetchSessions`, `apiSocket.forSession.request(...)`, `apiPush.*`, socket reconnect handshake. No caller depends on side effects beyond the returned claim string.
- **Downstream consumers of the returned claim:** HTTP `X-Codexu-Authorization: tunnel <claim>` header, Socket.IO handshake auth payload. A cached-but-fresh claim and a freshly-issued claim are functionally identical to a consumer — **but see Critical finding #1 (jti replay)**.
- **Safety window (60s vs 120s):** Existing `validateFreshClaim` allows 30s clock skew (refreshClaim.ts:48: `payload.exp <= Math.floor(Date.now() / 1000) - 30`). 60s is enough to cover that 30s plus most network/use latency. 120s is more conservative. Recommend **60s** unless operator wants more margin.
- **Precedence with `MIN_REFRESH_INTERVAL_MS`:** Cheap check first — parse + expiry check (local), then the 12s rate-limit (only matters on the actual fetch path). Malformed claim → wrap parse in try/catch and fall through to fetch.
- **Where to put `SAFETY_WINDOW_S`:** As a top-level `const` next to `MIN_REFRESH_INTERVAL_MS` in `refreshClaim.ts`. Recommend **`export`** so the new test can reference it (avoid magic numbers in tests).
- **Docs to update:** `plans/realtime-sync-perf.md` (mark WS1 done in WS1 section + pre-flight checklist), `docs/validation/devtunnels-boox-result.md` "Realtime sync perf (deferred)" subsection (remove the "Slow first-load on foreground" bullet). `packages/happy-app/CLAUDE.md` does not currently document refresh behavior; not required to update.

## Codex Research

- **Endorses the integration point:** top of `refreshTunnelClaimOnce(...)` in `refreshClaim.ts`, before `ensureFreshConnectToken` (or at least before the MIN_REFRESH_INTERVAL_MS wait). Use `parseTunnelClaimPayload(credentials.tunnelClaim)`, guard `typeof exp === 'number'`, return cached when `exp - now > SAFETY_WINDOW_S`. Catch parse errors and fall through.
- **Suggests `SAFETY_WINDOW_S = 90`** as a middle-ground default.
- **Critical concern #1 — server-side `jti` replay protection (architectural blocker for WS1 as-stated).** See verified findings below.
- **Critical concern #2 — test file is stale**, current baseline shows 6 failed / 5 passed against current refreshClaim.ts. See verified findings below.
- **Persistence gap:** `refreshTunnelClaim` returns a new claim but `machineAuth.ts` does not persist it back to `TokenStorage`. So even without the jti issue, after the first true refresh post-pairing, the cached `credentials.tunnelClaim` in storage stays stale — only the in-memory `getMachineAuthHeaders` path sees the new value. WS1's expiry-skip path reads `credentials.tunnelClaim` (the persisted/in-memory copy). If the persisted value is the originally-paired claim and the original is now expired, the skip never fires, and you're back to today's behavior. (Copilot independently flagged this.)
- **Module-load side effects when importing from pairing.ts:** `parseTunnelClaimPayload` is exported from `packages/happy-app/sources/auth/pairing.ts`, which also imports `expo-web-browser` and `tunnelProvider`. `pairing.test.ts` mocks those; `refreshClaim.test.ts` does not. The new test importing `SAFETY_WINDOW_S` (from refreshClaim.ts) is fine — but if WS1 imports `parseTunnelClaimPayload` from pairing.ts at module load, the refreshClaim test runner may now pull pairing.ts and its expo deps. Either (a) mock those in refreshClaim.test.ts, or (b) move/copy `parseTunnelClaimPayload` into a dependency-free module.

## Copilot Research

- Independently confirms the integration point, suggests **`SAFETY_WINDOW_S = 90`** (matches Codex).
- Independently flags **the persistence gap**: "fresh claims are not currently persisted back anywhere obvious. `refreshTunnelClaim(...)` returns the new string, but `machineAuth.ts` does not write it back ... a pure 'check `credentials.tunnelClaim` and skip' change helps while the originally stored claim is still fresh, but may stop helping after the first true refresh."
- Independently flags **branch drift in the test file**: "refreshClaim.test.ts still references the old `/pair/status` / `X-Tunnel-Connect` flow, while current implementation and server docs use `/pair/complete` and `X-Tunnel-Authorization`."
- Confirms `parseTunnelClaimPayload` returns fields as `unknown`, so skip logic must guard `typeof payload.exp === 'number'`.

## Critical Findings (verified directly by orchestrator)

### Finding A — Server-side `jti` replay protection blocks claim reuse (BLOCKER for WS1 as-stated)

- `packages/happy-server/sources/app/api/routes/pairRoutes.ts:39-47` — `buildTunnelClaimPayload` always sets `jti: randomUUID()` on every minted claim.
- `packages/happy-server/sources/app/api/auth/tunnelClaim.ts:118-135` — `verifyHappyEnvelope` records every seen `jti` and rejects a second presentation with `reason: 'tunnel_claim_replayed'` until the claim's `exp` has passed.
- **Today's behavior is consistent:** every `tunnelFetch` triggers a fresh `/pair/complete` → fresh `jti` → server accepts. That's why the current flow works despite the replay protection. WS1's whole point is to stop that fresh refresh — but then the same claim (same `jti`) goes out twice, and the second request fails with `tunnel_claim_replayed`.
- **WS1 as drafted cannot work without coordinated server changes.** Options (require operator decision):
  - **(A) Server-side change too:** Stop minting `jti` on tunnel claims (or stop enforcing replay rejection in `verifyHappyEnvelope` for claims still inside their `exp`). Out-of-scope expansion: extra `packages/happy-server/...` edits, plus updates to `tunnelClaim.ts` tests (`__resetTunnelClaimReplayCacheForTests` and any spec that asserts replay rejection).
  - **(B) Drop WS1 entirely** and proceed to WS2/WS3 which don't have this conflict.
  - **(C) Different optimization:** keep server semantics, but reduce client work some other way (e.g., parallelize/batch the fetch — not what the plan describes).

### Finding B — refreshClaim.test.ts is already broken at baseline

`refreshClaim.test.ts` references contracts from before the `/pair/complete` consolidation:
- Line 45: asserts `fetch` was called with `'https://machine.example.test/pair/status'` — current code calls `/pair/complete`.
- Line 46: asserts header `'X-Tunnel-Connect': 'connect-jwt'` — current code sends `'X-Tunnel-Authorization': 'tunnel ${connectToken}'`.
- Response-shape stubs at lines 38–41, 98–101, 117–121, 126–130, 137–143: use `{ status: 'authorized', machines: [...] }` — current code expects `{ machine: { machineId, tunnelClaim } }` (singular `machine`, not array `machines`).
- Codex ran the test command on baseline (`pnpm --filter '{packages/happy-app}' exec vitest run sources/sync/refreshClaim.test.ts`) and reported **6 failed, 5 passed**.
- **Acceptance criterion "existing refreshClaim tests stay green" is not currently achievable.** WS1 must either (a) leave the file as-is and have a failing baseline + 1 new green test, (b) repair the stale tests as part of WS1 (scope expansion), or (c) replace the file with a fresh suite matching current `refreshClaim.ts` (larger scope expansion).

### Finding C — Persistence gap limits WS1's real-world benefit

- `refreshTunnelClaim` returns the fresh claim, but no caller (including `getMachineAuthHeaders` at machineAuth.ts:65-72) writes it back to `TokenStorage` or mutates `credentials.tunnelClaim` on the in-memory object.
- WS1's skip path inspects `credentials.tunnelClaim` — the original paired claim if no one persisted a refresh. After ~1 hour, that original expires, the skip never fires, and we're back to today's per-request POST.
- To capture the full perf win the plan describes (foreground fan-out 6×~2.5s → 1×~2.5s + 5×~0.5s), a companion change is needed: when `refreshTunnelClaimOnce` actually refreshes, persist the new claim into the in-memory `credentials` (and/or `TokenStorage.updateMachineCredentials(...)`).
- Scope: this is a small additional edit in `refreshClaim.ts` (and possibly machineAuth.ts), not a separate workstream. But it's not in the user's task description — needs operator confirmation.

## Consolidated File List

**Files to modify (WS1 client-side, minimum scope):**
- `packages/happy-app/sources/sync/refreshClaim.ts` — add `SAFETY_WINDOW_S` constant + parse-and-skip logic at top of `refreshTunnelClaimOnce`.
- `packages/happy-app/sources/sync/refreshClaim.test.ts` — add one new test (and possibly repair pre-existing stale tests; see Finding B).

**Files referenced/read for understanding (no edits):**
- `packages/happy-app/sources/auth/pairing.ts` (lines 202-206 — `parseTunnelClaimPayload`)
- `packages/happy-app/sources/auth/machineAuth.ts:38-72`
- `packages/happy-app/sources/auth/tokenStorage.ts:11-23`
- `packages/happy-app/CLAUDE.md` (sync invariants paragraph)

**Files potentially affected by scope expansion options:**
- `packages/happy-server/sources/app/api/routes/pairRoutes.ts` (Finding A option A — stop emitting jti)
- `packages/happy-server/sources/app/api/auth/tunnelClaim.ts` (Finding A option A — drop replay enforcement)
- `packages/happy-app/sources/auth/tokenStorage.ts` (Finding C — persistence write-back)

**Docs to update:**
- `plans/realtime-sync-perf.md` (lines 80–103: §Workstream 1; line 197 pre-flight checklist; line 178 risk summary row)
- `docs/validation/devtunnels-boox-result.md` (lines 161–202: "Realtime sync perf (deferred)" subsection)

**Test command (verified):**
```
pnpm --filter '{packages/happy-app}' exec vitest run sources/sync/refreshClaim.test.ts 2>&1 | tee /tmp/codexu-ws1.log
```

**Cross-package typecheck:** `pnpm typecheck` at repo root (or per-package `pnpm --filter '{packages/<pkg>}' build` for each of happy-server, happy-cli, happy-agent, happy-wire, happy-app).
