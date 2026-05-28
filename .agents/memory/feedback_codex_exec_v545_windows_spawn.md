---
name: codex-exec-v545-windows-spawn
description: "ralph-orchestration v5.45.0 codex-exec.mjs port loses shell:true → Node spawn() can't find codex.cmd on Windows; use CODEX_EXEC_SCRIPT env var to fall back to v5.44 bash wrapper."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5e5566f2-32df-463a-9379-6e0b89fe6260
---

In ralph-orchestration plugin v5.45.0 the `codex-exec.sh` was ported to a Node-based `src/codex-exec.mjs`. The port's `spawn("codex", args, { env, stdio })` call (line ~63) is missing `shell: true`. On Windows with patched Node (>=20.4 / >=22.4 — CVE-2024-27980 fix), Node no longer auto-resolves `.cmd`/`.bat` files via PATHEXT without `shell: true`, so `spawn("codex")` fails with `ENOENT` even when `codex.cmd` is on PATH (e.g. `C:\Users\<user>\AppData\Roaming\npm\codex.cmd`).

**Symptom in ralph.sh output:**
```
Error: failed to spawn codex: spawn codex ENOENT
  [warn] iteration engine (codex) exited with code 1
```

All iterations exit in ~800ms with status:error. Same node, same codex install, same PATH — only the Node port regressed.

**Workaround (works):** ralph.mjs `resolveEngineScript` honors a `CODEX_EXEC_SCRIPT` env var that overrides the default `<plugin>/codex-exec.sh`. Point it at the v5.44 bash wrapper, which pipes to `codex exec - ...` via shell (shell handles .cmd lookup):

```bash
CODEX_EXEC_SCRIPT='C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.44.0/codex-exec.sh' \
  bash <plugin>/5.45.0/ralph.sh --job-dir <jd> --work-dir <wd> N
```

The v5.44 codex-exec.sh accepts the same flag set (`--prompt`, `--output`, `--effort`, `--text`, `--section`) that v5.45 ralph.mjs sends, and sources its own `path-utils.sh` from the v5.44 directory.

**Why:** v5.44 used `... | codex exec - ...` (shell-piped — shell resolves .cmd). v5.45 ported to Node `spawn("codex", ...)` without `shell: true`, hitting the CVE-2024-27980 patch behavior.

**Why this hasn't bitten everyone:** copilot.exe (a true .exe) spawns fine. Only the codex .cmd path regressed. Recent successful jobs that used iterationEngine=codex (e.g. `plugin-scope-agents` on 2026-05-26) may have predated v5.45 install — verify plugin version vs run time before assuming codex is fine.

**Upstream fix:** add `shell: true` to the spawn call in v5.45 `src/codex-exec.mjs` at line ~63 (and consider quoting arg values since shell:true changes arg parsing). File against ai-developer-toolkit ralph-orchestration plugin.

**How to apply:** Any time spawning ralph.sh with iterationEngine=codex on this Windows host while plugin is v5.45.x and the upstream fix hasn't shipped, prefix the bash invocation with `CODEX_EXEC_SCRIPT=...v5.44.0/codex-exec.sh`. See also: [[crews-spawn-state-cwd-override]] for similar env-override pattern.
