# Plan Review Findings (Phase 4 — rubber-duck independent critique)

Reviewer: rubber-duck agent (independent design critique). No Critical findings. All findings below
were ADOPTED into plan.md / stories-outline.md.

## High
- **H-1 Platform injection incomplete (host-native `path.delimiter`/`join`).** The resolver must
  select `path.win32` vs `path.posix` from the injected `platform` so Windows-shaped tests pass on a
  POSIX CI host and vice-versa. ADOPTED: resolver uses `platform === "win32" ? win32 : posix` for
  `.delimiter` + `.join`; added cross-host multi-entry PATH tests.

## Medium
- **M-2 Windows normalization gaps.** PATHEXT entries without a leading dot (`CMD;EXE`), quoted PATH
  dirs (`"C:\..."`), lowercase `pathext`/plain-object env case-sensitivity, and `command`-already-
  has-extension double-append (`codex.cmd.exe`). ADOPTED: case-insensitive env-key lookup, strip
  surrounding quotes from PATH entries, normalize PATHEXT entries (prepend `.`), and include the
  bare-name (`""`) extension so an already-suffixed command matches exactly; tests added for
  `PATHEXT:"CMD"` and quoted PATH dirs.
- **M-3 Empty-PATH-component / cwd semantics.** `filter(Boolean)` drops empty components which on
  POSIX mean cwd; dropping `cwd` removes the old login-shell behavior. ADOPTED: cwd/empty-component
  lookup is **intentionally excluded** (documented); the plan no longer claims full `command -v`
  parity — it says "PATH-dir executable scan".
- **M-4 Story 2 must address detection + execution precisely.** The live smoke's `codexAvailable()`
  uses `where/which` (finds `codex.cmd` on the repro box; only a `.ps1`-only install slips), and the
  failing `spawnSync("codex", …)` already passes the prompt on **stdin** (`input: smokePrompt`) with
  metachar-free argv. ADOPTED: Story 2 core = add `shell:true` to that spawn (no argv re-parse
  hazard); optional hardening = reuse the new `commandOnPath` for `codexAvailable()` to also catch
  `.ps1`-only installs. Removed the overstated quoting-hazard framing.

## Low
- **L-5 Strengthen the no-bash regression guard.** Use a regex
  `spawn(?:Sync)?\s*\(\s*["']bash["']` and assert no `command -v` (exact-string match is too narrow).
  ADOPTED.
- **L-6 Don't overstate "zero bash at runtime".** `engineSpawnCommand` still spawns `bash` for
  explicit `.sh` engine-override scripts. ADOPTED: release/AGENTS wording reworded to "the default
  command-on-PATH preflight no longer depends on bash; explicit `.sh` engine overrides still use
  bash."

## Reviewer's direct answers (condensed)
1. Resolver directionally correct for the verified npm `codex.cmd`/`codex.ps1` case; the gaps above
   were the material ones. POSIX symlinks are fine (`statSync` follows them).
2. Test matrix needed the added edge cases; no-bash guard strengthened beyond exact-string match.
3. Dropping login-shell PATH augmentation is acceptable/desirable — preflight should reflect the
   inherited env a Node child actually uses; document the `CODEX_EXEC_SCRIPT` escape hatch.
4. Bundling Story 2 is sound; prefer the precise `shell:true`-with-stdin launch (prompt already on
   stdin) and also harden `codexAvailable()`.
5. Release scope complete; only adjustment is the wording in L-6.
