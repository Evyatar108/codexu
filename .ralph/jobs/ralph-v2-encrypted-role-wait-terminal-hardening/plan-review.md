### Primary Plan Review

The primary lane raised six High findings:

- **Source-job lifecycle:** US-005 and future installed-host ACs cannot remain in the source PRD. A deliberately blocked, lead-owned story prevents a clean Ralph terminal deliverable.
- **Repository boundary:** the codexu job-local runner is outside the `ai-developer-toolkit` target repository and cannot be an implementation edit in this single-repository job.
- **Release ordering:** installed acceptance requires the corrected candidate to be integrated, pushed, verified, and installed first; tagging and codexu pointer closeout follow the installed gate.
- **Divergent publication base:** candidate `4100a48d` and toolkit `main` are not fast-forward related, so the plan needs a lead-owned reconciliation and revalidation step before publication.
- **Installed-runner contract:** the deferred handoff does not yet specify exact V1/V2 forcing, selected-surface proof, installed/published provenance, stable evidence naming, command records, or fail-closed conditions.
- **Artifact contract:** coarse output labels do not objectively identify each dispatch site's required files, formats, freshness, provenance, and validators.

### Codex Host-Lane Review

The Codex host lane independently emphasized implementation-contract precision:

- **High:** replace coarse artifact prose with structured per-site metadata such as required path keys, formats/schemas, freshness rules, and validators.
- **Medium:** make toolkit checkout initialization explicit and verify `4100a48d^{commit}` before creating the candidate worktree.
- **High:** resolve whether V1 fan-out gains a plaintext role marker or whether marker-preservation claims are narrowed to single delegation; the current plan's V1 marker and byte-preservation requirements conflict.
- **High:** prove preservation of failed evidence with a pre-run SHA-256 manifest, not only distinct filenames.
- **Medium:** map the no-inline-fallback requirement to exact generated artifacts and prohibited clauses with static negative assertions.

This lane agreed that installed acceptance should be deferred, but did not itself object to representing that deferred work as US-005. That omission conflicts with the source-job terminal-state evidence raised by the other lanes and the user's explicit boundary.

### Copilot Host-Lane Review

The Copilot host lane raised four findings:

- **High:** the proposed codexu-root `--parallel` handoff cannot create the required exact-base toolkit worktree through a single repository root; the source run must target the dedicated `ai-developer-toolkit` worktree directly.
- **High:** US-005 has no viable deferred lifecycle because a terminal-complete Ralph job will not later resume it; move it to a separate prerequisite-gated lead procedure.
- **High:** AC-22 and AC-23 are not verifiable by the source implementation run and belong in the external acceptance handoff.
- **Medium:** AC-7 needs a dispatch-site inventory mapping every required artifact path to its validator.

### Consensus

All lanes are independent perspectives produced under the same classification-derived exact model; their agreement is evidentiary convergence, not cross-model diversity.

- The Ralph source job must terminate after candidate-local implementation, generation, documentation, tests, review convergence, and a local implementation commit for US-001 through US-004.
- Final installed V1/V2 acceptance must remain documented but must be a **separate lead-owned gate/handoff**, not US-005, not a prerequisite-blocked source story, and not a future-host source AC.
- Candidate-local toolkit source work must be separated from lead-owned reconciliation, remote publication, install refresh, installed telemetry, tagging, and codexu pointer/version-table sequencing.
- The job-local codexu runner and its evidence are external acceptance assets, not files the toolkit source job may modify or commit.
- Every generated delegation site needs an explicit artifact/result contract with child provenance, nonblank/schema validation, and stale/pre-existing artifact rejection.
- Installed acceptance must force and prove V1 and V2 separately and preserve admissible provenance and old failed evidence.

### Divergences

- The primary lane alone identified the inverted publish/install order and the non-fast-forward reconciliation between `4100a48d` and current toolkit `main`.
- The Codex lane alone identified the V1 fan-out marker contradiction and demanded exact static assertions for every no-inline-fallback clause.
- The Copilot lane alone tied the invalid `--parallel` command to `decompose-plan`'s one-repository-root behavior and Ralph's terminal no-op-on-resume behavior.
- Artifact underspecification was High in the primary and Codex lanes but Medium in the Copilot lane; the synthesis keeps High because it affects every generated site's implementability and objective verification.
- The Codex lane accepted deferred installed sequencing in principle, whereas the primary and Copilot lanes required removing the deferred story from the source job. The explicit user requirement resolves this in favor of a separate lead-owned gate.

### Recommended Amendments

1. Remove US-005, the `installed-v1-v2-acceptance` cluster, and AC-22/AC-23 from the source PRD. Add a non-story **Lead-Owned Installed V1/V2 Gate/Handoff** section that records the prerequisite and acceptance procedure without making it implementer-owned or terminal-blocking.
2. Replace the codexu-root `--parallel` handoff with one source invocation targeting an initialized, absolute `ai-developer-toolkit` repository/worktree based on `4100a48d`; verify the commit and `48e63c0c` ancestry first. Mark the job-local runner as read-only reference during source implementation.
3. Add a source-of-truth dispatch matrix to `PROSE_SITE_INVENTORY` (or equivalent structured metadata): site/role, required output and artifact paths, format/schema, nonblank rule, freshness/run attribution, owning child, and validator. Pin every row in generator and telemetry tests.
4. Resolve V1 semantics explicitly: either add markers to fan-out and test the changed bytes, or narrow marker-preservation claims to sites that already emit the marker. Add per-generated-file negative assertions for prohibited parent-inline fallback clauses.
5. Make the lead-owned sequence explicit: reconcile the candidate with current toolkit `main`; review conflicts; regenerate and rerun affected tests; integrate on the publication branch; push and verify `origin`/`gim-home` SHAs; refresh the real installed Copilot/Codex copies; then run forced V1 and V2 installed acceptance. Tag and update the codexu pointer/version table only after that gate passes.
6. Define exact forced V1/V2 commands/configuration, selected-tool-surface assertions, installed manifest/version plus published-SHA attribution, intact V2 inline-table argv verification, fail-closed exit conditions, command/session/artifact records, and stable non-overwriting run IDs/schema.
7. Hash all named failed-evidence files before the lead-owned gate and verify the manifest afterward. Source-checkout output must be clearly distinguished from admissible installed-host evidence.
