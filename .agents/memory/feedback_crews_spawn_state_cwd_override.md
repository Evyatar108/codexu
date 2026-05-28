---
name: crews-spawn-state-cwd-override
description: "When spawning crews members from a Bash session whose pwd is a subdirectory of the codexu root, always pass --state-cwd D:/harness-efforts/codexu and --as overview-bookkeeper. The CLI auto-resolves state-cwd from cwd and fails closed when it doesn't match a registered lead."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When spawning crew members via `node <plugin>/tools/crews.js spawn-member ...` from a Bash session in this workspace, the Bash default cwd is `D:\harness-efforts\codexu\codex` (the codex submodule), not the codexu root. The crews CLI auto-resolves `--state-cwd` from cwd and the resulting state-cwd doesn't match the lead `overview-bookkeeper` (which is registered at `D:\harness-efforts\codexu`), producing `SenderNotFoundError: sender "null" not found in crew "ralph-pipeline" at state-cwd "D:\harness-efforts\codexu\codex"`.

**Always pass both flags explicitly when spawning from Bash:**

```
--state-cwd D:/harness-efforts/codexu --as overview-bookkeeper
```

**Why:** Bash sessions default to the codex submodule path on this Windows workspace; PowerShell sessions inherit a different working directory. The cwd discrepancy is harness-level, not a per-spawn quirk.

**How to apply:** Any time you invoke `crews.js spawn-member` (or any other crews CLI subcommand that takes `--state-cwd` / `--as`), include those two flags unless you've already `cd`'d to the codexu root. Saves a turn on the first failed spawn.

Related: [[feedback_crews_listener_rearm_pacing]]
