# Research Brief: Native-codex inject endpoint feasibility

*Inputs to plan.md. Verified file:line citations 2026-06-28.*

## Codex inject substrate (in-process, fork-owned)
| Primitive | Location | Signature / role |
|---|---|---|
| steer | `codex-rs/core/src/session/inject.rs:19-35` | `inject_if_running(&self, Vec<ResponseItem>) -> Result<(),Vec<ResponseItem>>` — into active turn |
| wake | `inject.rs:45-129` | `try_start_turn_if_idle(self:&Arc<Self>, input) -> Result<(),TryStartTurnIfIdleError>` |
| idle helper | `core/src/tasks/mod.rs:575-613` | `maybe_start_turn_for_pending_work(&Arc<Self>)` |
| enqueue | `core/src/session/input_queue.rs:96-117` | `enqueue_mailbox_communication`; `trigger_turn` field |
| seam | `tui/src/app.rs:1236-1246` | AppServerEvent clone → happy_tap; gate `Feature::RemoteSession` :1243-1244 |
| feature | `features/src/lib.rs:173-177` | RemoteSession default-off; add LoopbackInject |

## Overlay consumer (fork): `codex-rs-overlay/codex-happy/src/`
- `lib.rs:1-18` owns attach/remote_on/mapping/inbound. `attach.rs:458-499` requires ~/.happy + SessionClient (not reusable). `mapping.rs:52-88` + `inbound.rs:111-135` — protocol via AppServerEvent TurnStarted/Completed, ItemStarted/Completed.

## happy-cli daemon substrate (~80% shipped)
- mailbox `src/agentComms/mailbox.ts` durable inbox + cursor + history; lock today because 2 writers (F-007). router/recovery/ingestHandler/peer*/spawnApproval present. Daemon `daemon/run.ts startDaemon()`; control Fastify `daemon/controlServer.ts:66,291,391` with `/agent-comms/send`. Sole-writer ⇒ drop lock.

## crews hooks to drop
- `hooks/{pre-tool-use,post-tool-use,stop,session-start,codex-user-prompt-submit}.js` (5 dispatchers per `.codex-plugin/hooks/hooks.json`) + `lib/listener-protocol.js`; `actors.js:306-488` native `& codex` tab via wt.exe. All enforcement → soft under daemon-inject. (`user-prompt-submit` dispatches `/crews-*` cmds → rehome to daemon.)

## D-003 fallback
File-ownership-only daemon, KEEP hooks: ~80% win (kills locks), no codex patch/SPOF/mono-engine, keeps soft gate via hooks. Retreat if patch/SPOF cost not worth zero-hooks.
