---
overviewTaskId: codex-native-orchestration-crews-replacement-feasibility
---

## Direction
D-001 — Rehost crews codex members inside happy-cli runCodex; one daemon owns coordination files (no locks) AND push-injects mail into each member's conversation; daemon stream-parses member output to enforce protocol server-side; ZERO crews Node hooks. Honors the operator's override (no Stop turn-veto — injection IS the read), conditional on member rehost.

## Goal
A codex-only crew with ZERO crews `.codex-plugin` Node hooks: members run as happy-cli runCodex sessions (not native codex tabs), so the daemon owns mailbox/cursor/review/crash state (killing EPERM/LockTimeout), push-injects mail via mcpNotificationConsumer→MessageQueue2 (read as a turn, no veto), and parses each member's output stream to keep kind-tag/identity/crash enforcement server-side. Soft gate accepted.

## Scope
### In Scope
- Rehost members from native `codex` tabs (crews/hooks/actors.js buildLauncherCommand `& codex`) into happy-cli runCodex.
- Daemon owns consume+cursor+review+crash; member is pure-IPC (single-accessor kills reader-rename EPERM pre-tool-use.js:583).
- Inject mail RUNNING/IDLE/OFFLINE (mcpNotificationConsumer, recovery.ts).
- Drop ALL crews Node hooks; move kind-tag/body-canonical/identity/crash to daemon stream-parse.
### Out of Scope
- Mid-turn preemption (durable-mailbox-channel-wake.md:66). Cross-engine (Claude/Copilot) members. Hard turn-veto. central happy-server (per-daemon only).

## Criteria
- Rehosted member receives injected mail at RUNNING/IDLE/OFFLINE; ZERO crews Node hooks; ZERO EPERM/LockTimeout under load; kind-tag/identity/crash enforced daemon-side; daemon-SPOF recovery without loss.

## Context
PARTIAL/GO. Lenses: native codex tabs lack MessageQueue2 — injection needs rehost. Ferry survives (not a veto). Round 2 @00e52a13 superseded. Residual: ferry + wake emitter + recovery. SPOF + Windows lifecycle priced. D-002 fallback if rehost too costly.
