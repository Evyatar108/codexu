# Phase-4 Multi-Model Plan Review — Synthesis

Reviewers: Claude (Explore agent), Codex (gpt-5.x via codex-exec, `--include-rubric`), Copilot (via copilot-exec, `--include-rubric`). All three reviewed `draft-plan.md` against the live crews v3.23.2 source in the plan worktree.

### Claude Plan Review
- [Medium] Lock-window AC ("scan ran without the lock") not directly verifiable from current seams; specify an observable assertion (instrument withStateFileLock / injected seam; assert no latch-lock acquisition during the scan) rather than a timing claim.
- [Low] US-002 is correctly optional but the plan should explicitly state it does NOT gate the bugfix ACs.

### Codex Plan Review
- [Medium/Feasibility] Lock-window test underspecified + contradictory: module destructures withStateFileLock (member-crash-notifications.js:59) + getMemberHealth (:75) at load; _internal (:384) doesn't expose them. Specify monkeypatch-before-require OR an explicit _internal/arg seam.
- [Medium/Completeness] If US-002 ships, require a listener-delivery test — listener-loop.js:424,432 only delivers when its own sweep returns appended>0; a shared stamp could make the listener skip after a hook sweep touched the stamp.
- [Medium/Completeness] US-003 should explicitly call out the submodule two-commit flow (commit inside ai-developer-toolkit, then parent codexu pointer + root AGENTS.md table).
- [Medium/AC Quality] Restates the lock-window mechanism point.
- Ordering: no issues (serial US-001 → US-002 → US-003 correct). Simplicity: no issues (scan-outside-lock is the smallest fix; raising the timeout / changing lock stealing would be worse).

### Copilot Plan Review
- [Medium/Completeness] Make the in-lock candidate-manifest re-read REQUIRED (not optional): a candidate computed during the scan can be appended after clear-member/resume/intent markers changed; re-read only the candidate manifest under the brief lock before append.
- [Medium/AC Quality] The fail-soft PreToolUse fixture must satisfy unrelated gates (esp. armed listener state) so it proves "sweep error does not deny", not an accidental arm-first block.
- [Low/AC Quality] Prefer the injected-seam/order assertion over a real held-lock fixture (the held-lock fixture risks the 2s timeout + Windows flakiness).
- Feasibility/Ordering/Simplicity: no issues.

### Consensus
- **Lock-window AC mechanism/testability** — Claude (Med) + Codex (Med×2) + Copilot (Low). Strongest consensus; specify a deterministic seam/monkeypatch call-order assertion, ban held-lock 2s fixtures. → F-001.
- **Candidate re-validation under the brief lock** — Copilot (Med, make required) + Codex (suggested revalidating final candidates). The refactor grows the scan→append window, so this is a real correctness preservation. → F-002 (made required).
- **US-002 scope clarity / listener-delivery** — Claude (Low, gating) + Codex (Med, delivery test). → F-004.

### Divergences
- Copilot said the candidate re-read should be REQUIRED; Codex (reviewing the pre-edit draft) said keeping it OPTIONAL "looks adequate." Resolved toward REQUIRED: the two-phase split lengthens the scan→append window (Phase A computes all candidates before Phase B appends), so the intentionally-stopped/cleared/recoverable guards must be re-checked at append time; the re-read is cheap (one readManifest, no CIM). Codex's "optional adequate" reasoning applied to the pre-split immediate-append code, not the new window.

### Recommended Amendments → all applied in iteration 1 (see plan-review-findings.json F-001..F-005, all status=fixed)
1. F-001 — lock-window AC: require a specified deterministic seam/monkeypatch call-order mechanism; ban held-lock 2s fixtures.
2. F-002 — make per-candidate manifest re-validation under the brief lock REQUIRED (re-check guards #1/#2/#3/#5; no getMemberHealth re-run).
3. F-003 — fail-soft AC fixture must satisfy the other PreToolUse gates (armed listener).
4. F-004 — US-002 explicit non-gating + required listener-delivery test if shipped.
5. F-005 — US-003 explicit submodule two-commit flow (impl commits inside ai-developer-toolkit; lead bumps codexu pointer + AGENTS.md table).

### Convergence verdict
All five findings are Medium (no Critical/High). All resolved in one amendment pass. No critical divergences requiring re-planning. Root-cause analysis (lead-only sweep; already-fail-soft; lock held across 555-member CIM scan; two independent process throttles) was confirmed by all three reviewers and the live log. Plan is ready for `/implement-with-ralph --from-plan`.
