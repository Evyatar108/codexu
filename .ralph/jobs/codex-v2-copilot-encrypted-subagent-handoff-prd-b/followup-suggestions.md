# Follow-up Task Suggestions

Plugin version: v5.64.0

## Candidate: codex-reconcile-launcher-config-docs
- Scope: codex
- Recommended phase: plan
- Estimated size: S
- Rationale: A high-severity docs finding confirms that active guidance still directs users to an ignored `default_model` setting. The independently recorded rejection of an out-of-scope `verify.md` edit corroborates that adjacent launcher-config documentation was intentionally left behind; reconcile the architecture, endpoint mapping, and verifier inventory with the six-field launcher configuration now documented in the warm developer-guide surface.
- Source: wont_fix_finding — F-006 (docs-review-findings.json) (member: n/a)
  > docs/implementation/architecture.md still says the launcher emits `-c model=<default_model>`, and docs/implementation/model-endpoint-mapping.md still tells users to set `default_model` in `~/.codex-copilot/config.toml`. The current launcher deliberately neither reads nor emits that setting, while the developer guide changed in this diff to use `~/.codex/config.toml::model`; the documented launcher setting is therefore silently ineffective.
- Suggested prompt (plan):
  ```
  Update docs/implementation/architecture.md, docs/implementation/model-endpoint-mapping.md, and .claude/commands/verify.md to match current launcher behavior. Remove claims that default_model is read or emitted, direct model selection to ~/.codex/config.toml::model or --model, and reconcile each SandboxConfig inventory with the six fields already documented in docs/workflows/developer-guide.md. Add focused documentation scans or checks that prevent these inventories from drifting again.
  ```

## Candidate: codex-evaluate-inline-v2-handoff-invariants
- Scope: codex
- Recommended phase: brainstorm
- Estimated size: M
- Rationale: The implementation deliberately kept the V2 handoff invariant in the wrapper overlay to reduce upstream conflict surface. Revisit whether a nested or upstreamable counterpart could improve ownership and rebase diagnostics without sacrificing that isolation; if not, make the rejection and maintenance boundary explicit.
- Source: rejected_trailer — commit 7c0b978f942fac3aa748396d437618eaf321892e trailer Rejected (member: n/a)
  > Rejected: inline nested invariant | wrapper overlay avoids upstream conflict surface
- Suggested prompt (brainstorm):
  ```
  Evaluate the long-term home for provider-aware V2 handoff and exact-wait invariants. Compare the current wrapper-overlay test with an inline nested-source test, an upstreamable behavioral test, or a hybrid. Optimize for rebase conflict avoidance, local ownership, failure diagnostics, and preservation of the read-only nested-source workflow; conclude with a recommended boundary and migration trigger.
  ```
