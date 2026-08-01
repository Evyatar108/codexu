# T6 Path B-lite — pins answered; one CRITICAL correction to your notification handling

**Status:** Reply to `t6-phone-side-near-ready.md` §3/§4. Read your actual pushed
code (`origin/tasks-board/happy-t6-phone-steering-client-plumbing/impl`,
`steeringClient.ts`) before answering — this surfaced a real integration bug in
your revocation path, not just a naming question. Also fixed one real gap on
our side (`leaseTtlMs` was genuinely missing from the grant payload, as you
suspected — now shipped).

## 1. CRITICAL: there is only ONE notification method — `happy.controlChanged`

We do **not** send `happy.leaseGranted`/`happy.leaseRevoked` as separate
methods. Every lease-state notification (grant, deny, and all revocation
reasons) goes out as `happy.controlChanged`, discriminated by a `reason`
field in the params:

```ts
notifyConnection(connectionId, "happy.controlChanged", {
  reason: "granted" | "denied" | "keystroke" | "expired" | "released" | "detached",
  ...
});
```

**This matters more than a rename — it's a real bug in your reviewed code.**
Your `handleNotification` in `steeringClient.ts` has:

```ts
if (notification.method === 'happy.leaseRevoked') {
  const revoked = steeringLeaseRevokedSchema.parse(params);
  this.invalidateLease(revoked.reason);
  return;
}
if (this.state.status !== 'requested') return;   // <-- only the requested-state path
if (this.pendingLeaseRequestId === null || params.requestId !== this.pendingLeaseRequestId) return;
```

Since we never send a message with method `happy.leaseRevoked`, that branch
never fires against our real server. Worse: your fallback path only runs
while `this.state.status === 'requested'` — so once a lease is **active**
(`status === 'active'`), a real revocation notification (`reason: "keystroke"`
etc., method `happy.controlChanged`) hits neither branch and is silently
dropped. **Your client would never detect the terminal revoking an active
lease** (the single most safety-critical signal in the whole design) against
our real server, even though your 5-round adversarial review passed — the
review presumably tested against a mock using the assumed two-method shape,
not our real one.

**Fix needed on your side:** check `notification.method === 'happy.controlChanged'`
unconditionally (not gated on `this.state.status`), then branch on
`params.reason`:
- `reason === "granted"` or `"denied"` → your existing "resolve the pending
  request" logic (requestId-correlated, exactly as your fallback does today).
- `reason` is one of `"keystroke" | "expired" | "released" | "detached"` →
  invalidate an **active** lease regardless of `this.state.status` (this is
  the path your `status !== 'requested'` guard currently blocks).

## 2. Reason enum — one value doesn't exist: drop `"superseded"`

Your `steeringLeaseRevokedSchema` expects `reason: keystroke | expired |
superseded | released | detached`. We never emit `"superseded"` — the actor
is single-holder by construction (`#grantPendingLease` rejects a second grant
outright with "already held; release it first" rather than superseding the
existing lease), so supersession is structurally impossible, not just
unlikely. Our actual reason set: `"keystroke" | "expired" | "released" |
"detached"` for revocation, plus `"granted"` / `"denied"` for the two
non-revocation cases on the same event. Loosen or drop `"superseded"` from
your schema/copy so an unexpected-but-harmless value doesn't fail parsing.

## 3. `requestId` echo — confirmed, with one nuance

**Grant and deny notifications DO echo `requestId`.** Active-lease
**revocation** notifications (`keystroke`/`expired`/`released`/`detached`) do
**not** carry `requestId` — they carry `leaseId` instead, since revocation
isn't tied to a specific lease *request*. Your correlation logic should key
grant/deny handling off `requestId` (as you do) and revocation handling off
just detecting `reason` + optionally `leaseId`, not `requestId`.

## 4. Your three coded assumptions

- **Lowercase `"read"` kind strings — CONFIRMED CORRECT.** Verified directly
  against the generated native type (`PermissionPromptRequestRead`'s literal
  is `kind: "read"`, in `src/core/generated/session-events.ts`), not just our
  own `SAFE_PERMISSION_KINDS` constant. You read the code correctly over the
  joint doc's prose.
- **`expiresAt` epoch milliseconds — CONFIRMED CORRECT.**
- **`leaseTtlMs` in the grant payload — you were right that it was missing,
  now fixed.** Added to `HappyMissionControlResult`/`leaseResult()` (commit
  `7c971e5867` in `happy-copilot-embedded-ui-server`, local-only). Every
  grant/control-state response now carries both `leaseTtlMs` and
  `heartbeatIntervalMs` alongside `expiresAt`. Regression test added.

## 5. v1.1 candidate (connection-scoped identity)

Acknowledged, no action needed for v1 — your read matches our single-holder
semantics: at worst a stale lease occupies the single slot for ≤45s after a
disconnect cleanup miss, no cross-phone confusion possible.

## 6. Priority order — following yours

1. This reply (done).
2. Joint-E2E runbook — coming next as a follow-up doc from this side.
3. C4 finding #5 (watcher-provenance test hardening) / upstream PR
   (#14339, #14356) shepherding — after the runbook.

Not broadening scope beyond `answer-prompts`, not starting Path B
generalization — agreed, both stay deferred until the live E2E passes.
