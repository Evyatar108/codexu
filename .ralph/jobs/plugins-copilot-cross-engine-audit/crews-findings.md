# crews v1.7.x Copilot parity findings

### spawn-launcher-copilot
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/tools/crews.js spawn-member audit-test-member --crew audit-test-crew --as audit-lead --state-cwd <scratch>/state --cwd <scratch>/physical --engine copilot --no-launch -- 'Audit scratch member: acknowledge once, arm listener, then idle.'`; then `wt.exe -w crews-audit-test new-tab --title audit-test-member pwsh -NoExit -File <launcher.ps1>`
**Observed:** The generated launcher sets `CREWS_ENGINE = 'copilot'`, scrubs Claude identity env vars, invokes `copilot --name '♙ audit-test-member (audit-test-crew)' --allow-all-tools --plugin-dir ...`, and the manual `wt.exe` launch returned exit code 0. The launcher process wrote `launcher.pid` before teardown and was killed with `taskkill /T`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-launcher-head.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-wt-launch-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-launcher-pid.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-taskkill-launcher.txt`
**Status:** PASS

### session-start-session-env
**Command:** `printf '%s' <copilot sessionStart JSON> | env -u CREWS_STATE_CWD ... CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-session-start.js`
**Observed:** The Copilot SessionStart shim accepted `sessionId: audit-member-session-001` plus `env.COPILOT_AGENT_SESSION_ID`/`COPILOT_CLI=1`, returned member briefing as `additionalContext`, and updated the scratch member manifest with `engine: "copilot"` and the same `sessionId`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-copilot-session-start-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-copilot-session-start-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-session-start.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-session-pointer.json`
**Status:** PASS

### pretooluse-listener-gate
**Command:** `printf '%s' <copilot preToolUse JSON for bash "echo should-be-blocked"> | env -u CREWS_STATE_CWD ... CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-pre-tool-use.js`
**Observed:** With `listenerState: "never-armed"`, the Copilot PreToolUse shim emitted a block envelope with `decision: "block"`, `permissionDecision: "deny"`, and a Copilot-shaped listener arm instruction using `bash` plus `mode: "async"`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-no-listener-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-no-listener-output.json`
**Status:** PASS

### stop-listener-armed-and-kind-tag
**Command:** `printf '%s' <copilot agentStop JSON> | env -u CREWS_STATE_CWD ... CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-stop.js`; plus a Copilot PreToolUse listener-arm probe before the final stop attempt.
**Observed:** Stop without a kind tag blocked and rendered the Copilot `bash`/`mode: "async"` arm instruction. Stop with `kind="done"` but no listener also blocked on listener reachability. After a Copilot listener-arm tool call, Stop with prose plus `<|report kind="done" summary="audit done"|>` returned `{}` and the manifest recorded `listenerState: "armed"`, `lastKind: "done"`, `lastSummary: "audit done"`, and `lastSeq: 1`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-stop-missing-kind-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-stop-done-no-listener-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-arm-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-arm-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-stop-done-armed-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-stop.json`
**Status:** PASS

### posttooluse-30s-nag
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/tools/crews.js send-to-member audit-test-member ...`; exported listener-path mailbox consumption through `hooks/mailbox.consumeMailbox`; `sleep 31`; then `printf '%s' <copilot postToolUse JSON> | env -u CREWS_STATE_CWD ... node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-post-tool-use.js`
**Observed:** A scratch lead sent direct mail to the scratch member. The same exported mailbox API used by the listener consumed the mailbox and set `lastReviewRequiredSeq: 1` with no reviewed cursor. After 31 seconds, Copilot PostToolUse emitted a block envelope headed `[mid-turn nag] review-required: unreviewed delivery from sender audit-lead` and advanced `lastMidTurnNagSeq`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-send-to-member-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-consume-mailbox-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-delivery.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-posttooluse-nag-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-posttooluse-nag-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-posttooluse.json`
**Status:** PASS

### slash-commands-copilot
**Command:** `find D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/.copilot-plugin/copilot-skills -mindepth 1 -maxdepth 1 -type d`; then `env -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE COPILOT_AGENT_SESSION_ID=audit-member-session-001 COPILOT_CLI=1 node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/tools/crews.js review-mail audit-test-member --crew audit-test-crew --cwd <scratch>/state`
**Observed:** Copilot skill mirrors include the required kebab commands `status`, `send-to-member`, `stop-member`, and `spawn-member`. No `review-mail` Copilot skill mirror exists by design, and the CLI fallback successfully returned the pending mail entry and advanced `lastReviewedSeq` to 1.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-copilot-skills-list.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-review-mail-skill-presence.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-review-mail-cli-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-review-mail.json`
**Status:** PASS

### sessionid-pointer-restart
**Command:** `printf '%s' <copilot sessionStart JSON with cwd=<scratch>/physical, same sessionId, no CREWS_STATE_CWD> | env -u CREWS_STATE_CWD -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-session-start.js`
**Observed:** The restart-style SessionStart resolved the existing scratch member through the sessionId pointer even though the hook cwd was the physical cwd and `CREWS_STATE_CWD` was unset. Member directory count stayed 1, and the manifest kept `sessionId: audit-member-session-001` while refreshing `lastSessionStartAt` and `transcriptPath`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pointer-restart-session-start-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pointer-restart-session-start-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pointer-restart-result.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-scratch-snapshot.txt`
**Status:** PASS
