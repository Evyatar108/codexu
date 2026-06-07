Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis — ralph-orchestration copilot-exec `--read-only` submodule snapshot cost

**Overview task:** ralph-copilot-exec-readonly-submodule-snapshot-cost
**Problem (verified):** `copilot-exec.mjs --read-only` calls `captureSnapshot(cwd)` (worktree-snapshot.mjs L337). The main tree uses a cheap `git status` fast-path (only dirty files are byte-read), but `findNestedRepoRoots` (L311) discovers each initialized submodule and feeds it to `captureManifest` (L267), which `readFileSync`s EVERY non-zone file into a `Map<rel,{bytes:Buffer}>` held for the whole run, then re-walks at revert. In codexu the submodules are `codex/` (multi-GB Rust) + `ai-developer-toolkit/` (the plugin-edit zone). Two concurrent Copilot read-only lenses exhaust memory → the 2026-06-06 member deaths. The Codex lens (no guard) stayed healthy; a partial brainstorm skipping the Copilot lens succeeded.

**Hard correctness constraint (all lenses agree):** the guard exists because a 2026-05-28 read-only review edited 16 files under `ai-developer-toolkit/`, and the parent `git status` only sees the gitlink, not inner files. Any fix that simply stops looking inside `ai-developer-toolkit/` removes the safety property — it is a regression, not an optimization. Pre-existing operator WIP (dirty + staged) must still survive byte-for-byte.

**Live empirical note:** this brainstorm's own Copilot read-only lens ran clean from a worktree with UNINITIALIZED submodules → `findNestedRepoRoots` found nothing → no manifest blowup. That directly supports D-004 and confirms the cost is gated on submodule-init state.

---

### D-001: Per-submodule git fast-path for nested repos (+ findNestedRepoRoots de-dup)
- Contributing lenses: [codex, copilot, devils-advocate]  (3/3 — consensus primary)
- Why this might work: Treat each initialized submodule exactly like the parent repo — use its OWN `git ls-files -z` / `ls-files --stage -z` / `status --porcelain -z -uall`, restore clean tracked files from the submodule's HEAD/index blobs at revert, and only byte-capture pre-existing dirty + untracked files. Reduces nested-repo memory from whole-tree to dirty-file scale while KEEPING the out-of-zone write protection for `ai-developer-toolkit/`. Also fix `findNestedRepoRoots` to stop descending once a `.git` boundary is found (or de-dup roots) so nested-within-nested repos under `codex/external/repos/...` aren't byte-read twice.
- Risks / friction: Nested-repo restore must be exact for clean / dirty-unstaged / partially-staged / staged-deletion / rename / mode-bit cases — the main tree already preserves index entries (L366-374, L576); nested repos need the equivalent. `git status -uall` does NOT see gitignored files (today's `captureManifest` does) → narrows ignored-file coverage; must be an explicit contract decision, not accidental. A large dirty BINARY in a submodule still costs heap unless dirty bytes are spilled.
- Cheapest validation: fixture parent repo w/ 2 submodules (codex-like clean large + ai-developer-toolkit-like target); seed clean/dirty/partially-staged/untracked/ignored/deleted files in the target; run copilot-exec --read-only with a stub child that edits each out-of-zone file; assert exit 3 + exact restoration + no full-tree Buffer capture of the clean large submodule.
- Disconfirming observation: a nested repo with pre-existing dirty/staged/untracked content cannot be restored byte-for-byte using only the git-status snapshot model → would force a dirty-byte spill anyway.

### D-002: Protected-zone scoping — skip out-of-protection submodules (notably codex/) by policy
- Contributing lenses: [codex, copilot]  (devils-advocate: partial — RED FLAG if applied naively)
- Why this might work: Snapshot only the declared plugin-edit zone (`ai-developer-toolkit/`) and treat `codex/` as read-only-by-policy (it is NOT the plugin-edit zone), pruning the multi-GB walk entirely. Cheapest peak-memory win; one-line-ish scope change. Pairs with a loud sentinel warning when a heavy nested repo is intentionally skipped.
- Risks / friction: Hinges on the product contract question "protect the WHOLE cwd vs protect KNOWN high-risk edit zones." Devil's Advocate red flag: skipping the WRONG submodule (i.e. `ai-developer-toolkit/`) reintroduces exactly the 16-file-edit incident. If real read-only failures write outside the declared zone, this creates false confidence. Inferring the protected zone from allowWritePaths/outputFile may be fragile.
- Cheapest validation: snapshot only `ai-developer-toolkit/`, skip `codex/`, measure peak memory, inject an out-of-zone edit inside `ai-developer-toolkit/` and confirm exit 3 + revert still fire.
- Disconfirming observation: a Copilot read-only lens that writes outside `ai-developer-toolkit/` into another initialized nested repo would go unreverted under the product contract.

### D-003: Hash/object-id detection + spill-to-disk for pre-run dirty bytes
- Contributing lenses: [codex, copilot, devils-advocate]  (3/3 — but all warn hash-only ≠ restore)
- Why this might work: Keep the broad whole-cwd contract but stop holding full file contents in heap. Store content hashes / git object-ids in memory; restore CLEAN tracked files from HEAD/index blobs at revert; persist pre-run DIRTY/untracked bytes outside the JS heap (spill to a temp/staging dir, or `git hash-object -w` into the object store) so they can be written back exactly.
- Risks / friction: Hashes are DETECTION, not RESTORATION — a dirty submodule file's exact pre-run bytes may not exist in git's object DB, so a digest alone cannot write them back (all 3 lenses flag this). Objectizing dirty content risks object-DB pollution + LFS/smudge surprises; sidecar spill needs crash-safe cleanup in an allowed dir; without partial-index tests a naive `git restore` corrupts staged-vs-unstaged. Doesn't avoid the second post-run walk unless candidate generation is status-based.
- Cheapest validation: a dirty unstaged BINARY in `ai-developer-toolkit/` with bytes not in HEAD/index; snapshot via the hash/spill strategy; mutate during a stub run; assert post-revert file is byte-identical and index unchanged. If only a digest was stored and it can't pass → it's not a revert guard.
- Disconfirming observation: if peak memory stays dominated by enumeration, or spill artifacts leak after a killed child, the operational pain isn't solved cleanly.

### D-004: Disposable read-only lens workspace (architectural reframe)
- Contributing lenses: [devils-advocate]  (+ live empirical support from this run)
- Why this might work: Reframe — live snapshot/revert is inherently a TOCTOU + concurrency compromise. Run read-only lenses in a throwaway git worktree / sparse / COW copy with submodules left UNINITIALIZED by default, initializing only the paths the lens actually needs. Accidental writes are discarded by deleting the disposable workspace instead of reverting the operator's live tree. This run is a working example: the Copilot lens ran safely from an uninitialized-submodule worktree.
- Risks / friction: Copying a multi-GB repo is worse than today UNLESS it's a git worktree / sparse checkout / COW clone. A disposable workspace may miss generated artifacts, initialized submodule contents, or local WIP the lens was meant to review. Copilot has no `--add-dir`, so prompts must carry explicit absolute paths or the lens cwd must be chosen carefully. Larger scope than D-001/D-002.
- Cheapest validation: prototype a lens mode that creates a disposable wrapper worktree under the Ralph job dir (submodules uninitialized), runs a stub Copilot that writes to `ai-developer-toolkit/`, then deletes the workspace; assert the canonical codexu + ai-developer-toolkit trees are unchanged, output non-empty on success, and setup time < current captureSnapshot on initialized submodules.
- Disconfirming observation: if real lenses require initialized submodule contents under cwd to do their job, the disposable-uninitialized approach degrades the lens's usefulness.

---

## Cross-cutting: defense-in-depth resource budget (complement, not a standalone direction)
All lenses note a byte/file cap is only SAFE if it fails-closed BEFORE the Copilot child launches and emits a DISTINCT diagnostic. A soft cap that logs-and-skips the rest of the tree is silent under-protection (especially if `codex/` consumes the budget before `ai-developer-toolkit/` is captured). Best layered onto D-001/D-003 as a backstop, not as the primary fix.

## Related sub-issue (orthogonal to heap, real): 0-byte-output + exit-3
`openSync(--output,"w")` truncates the output to 0 bytes BEFORE snapshot/child; a killed/empty child can leave a 0-byte output, and the violation contract emits exit 3 only via the stderr sentinel. Memory exhaustion makes this more likely but does not cause it. Decide whether to fix in the same task (e.g. write a diagnostic body / distinct status sidecar) or split it out.

## Recommendation
**D-001** is the consensus primary: it is the only direction all three lenses endorse as the *safe* primary fix — it eliminates the clean-file byte blowup while preserving the guard's core guarantee, and it includes the cheap `findNestedRepoRoots` de-dup. Layer the fail-closed resource budget (above) as defense-in-depth. **D-004 (disposable workspace)** is the strongest *longer-term* architecture and is worth a follow-up, but carries more scope + "lens may need submodule contents" risk. D-002 alone is a regression risk (skip-wrong-submodule); D-003 is heavier and reduces to "spill dirty bytes" which D-001 already needs for binaries.

## Open questions to carry into planning
1. Contract: protect the WHOLE cwd, or only KNOWN high-risk edit zones? (sets the D-001/D-002 boundary)
2. Are gitignored files inside submodules in protection scope? (`git status -uall` won't see them; current `captureManifest` does)
3. Fix the 0-byte-output / exit-3 robustness sub-issue in this task or split it out?
4. Restore-fidelity requirements for nested-repo dirty / partially-staged / renamed / mode-bit files.
