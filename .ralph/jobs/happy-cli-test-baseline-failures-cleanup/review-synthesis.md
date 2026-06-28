# Phase 4 — Multi-model plan review synthesis

Three reviewers ran on the draft plan: **Claude** (Explore/opus-4.8), **Codex** (codex-exec,
effort high), **Copilot** (copilot-exec, effort high). Raw outputs: `codex-plan-review.txt`,
`copilot-plan-review.txt`, and the Claude findings embedded below. Findings manifest with
resolutions: `plan-review-findings.json` (15 findings, all addressed in the rewrite).

## Consensus (flagged by 2+ reviewers)

- **[High] Cluster-D Option-A setup-gating is unimplementable (codex + claude + copilot — UNANIMOUS).**
  Integration files read the env at module load (`currentIntegrationEnv.ts:8-13` throws when unset;
  `daemon.integration.test.ts:57` reads top-level), and `daemon.integration.test.ts:244`
  `Daemon Fan-Out` is ungated — a graceful setup would make it ERROR, not skip. → **Resolved by
  pivoting to Option B (config-level project gating in `vitest.config.ts`, `RUN_INTEGRATION=1`
  opt-in).** Verified against source by the planner before rewriting.
- **[High/Medium] AC1/AC6 under-specified (codex + copilot).** Needed concrete artifact paths and a
  concrete unavailable-env representation. → AC1 names `isolated-baseline.out` +
  `rebaseline-clusters.md`; AC6 rewritten for project gating with both verification directions.

## Divergences (single-reviewer, all accepted)

- **[High, claude] AC4 lacked the drift-vs-product masking safeguard** for sessionScanner/codexCommand → added.
- **[High, codex] AC6 conflicted with code shape** → rewritten for Option B.
- **[Medium, codex] US-000 ordering** (own Phase 0; all depend on it) → fixed in decomposition.
- **[Medium, codex] root `environments.ts` edit unnecessary** → dropped (read-only).
- **[Medium, codex] AC5 subjective / AC8 no threshold** → AC5 evidence-required; AC8 capped ≤5 = table rows.
- **[Medium, claude] AC7 not anchored to unloaded** → anchored to AC1 condition.
- **[Medium, claude] Option B simpler than A** → adopted.
- **[Low, claude] cluster-D load-vs-prereq nuance** → LOAD CAVEAT + AC1 record a persisting D as a real prereq gap.

## Claude review (verbatim findings — not otherwise on disk)

- [High, Completeness] daemon.integration.test.ts:244 `Daemon Fan-Out Integration` is ungated; a graceful
  setup makes it a test-level ERROR not a skip → AC6 ↔ Out-of-Scope contradiction; cluster-D file list
  omits daemon.integration.test.ts. (Resolved: Option B omits the whole project by default.)
- [High, Criteria Quality] AC4 lacked the AC3 test-drift-vs-product-fix safeguard for sessionScanner
  (`length 3 vs 2`) + codexCommand → masking risk. (Resolved.)
- [Medium, Criteria Quality] AC7 not anchored to the unloaded/isolated condition AC1 mandates. (Resolved.)
- [Medium, Simplicity] Option B (unit hard gate; integration opt-in) is simpler, mirrors CI
  (cli-smoke-test.yml never runs vitest), and sidesteps the ungated-Fan-Out problem. (Adopted.)
- [Low, Feasibility] Cluster-D `status null` is at least as consistent with a missing DB/toolchain
  prereq as a load-kill; Story 0/AC1 should treat a persisting isolated D-failure as a confirmed
  prereq gap. (Resolved.)
- Confirmed accurate: all file:line anchors (runClaude.ts:724, session.ts:163, apiSession.test.ts:215/270,
  environments.ts:357, AGENTS.md L39-L42, both hoisted mockSession doubles, module-scope await in the
  setup file, softened seed at integrationEnvironment.ts:52), the triage, and Story-0-first ordering.

## Net effect on the plan

The single most consequential change was the **Option A → Option B pivot**, which simultaneously
resolves the unanimous High (F-001), the AC6/Out-of-Scope contradiction (F-002), the missing-consumer
completeness gap (F-003), the unnecessary-`environments.ts`-edit simplicity concern (F-009), and the
AC6 specificity gap (F-005). The remaining findings tightened acceptance criteria for autonomous
verifiability (named artifacts, evidence requirements, count thresholds, unloaded anchoring) and added
the masking safeguard to AC4.
