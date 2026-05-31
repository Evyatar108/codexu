import { render } from "ink";
import React from "react";
import { ApiClient } from '@/api/api';
import { CodexAppServerClient } from './codexAppServerClient';
import type { CodexTransportFlag } from './cliArgs';
import { VALID_CODEX_REMOTE_PERMISSION_MODES } from './cliArgs';
import { CodexPermissionHandler } from './utils/permissionHandler';
import { ReasoningProcessor } from './utils/reasoningProcessor';
import { DiffProcessor } from './utils/diffProcessor';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { logger } from '@/ui/logger';
import { Credentials, readDaemonState, readSettings } from '@/persistence';
import { configuration } from '@/configuration';
import packageJson from '../../package.json';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { MessageBatch, MessageDelivery } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { projectPath } from '@/projectPath';
import { join } from 'node:path';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { startHappyServer } from '@/claude/utils/startHappyServer';
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { CodexDisplay } from "@/ui/ink/CodexDisplay";
import { trimIdent } from "@/utils/trimIdent";
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import { notifyDaemonSessionStarted } from "@/daemon/controlClient";
import { encodeBase64, decodeBase64 } from '@/api/encryption';
import type { Session as ApiSession } from '@/api/types';
import { registerKillSessionHandler } from "@/claude/registerKillSessionHandler";
import { connectionState } from '@/utils/serverConnectionErrors';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { publishAgentConfigurationMetadataIfChanged, publishPermissionModeIfChanged } from '@/utils/publishPermissionMode';
import { appendLedgerRecord } from '@/ledger/writer';
import type { AgentConfiguration, ApiSessionClient } from '@/api/apiSession';
import { resolveCodexExecutionPolicy } from './executionPolicy';
import { parseSpecialCommand } from '@/parsers/specialCommands';
import { mapCodexMcpMessageToSessionEnvelopes, mapCodexProcessorMessageToSessionEnvelopes } from './utils/sessionProtocolMapper';
import { resumeExistingThread } from './resumeExistingThread';
import { emitReadyIfIdle } from './emitReadyIfIdle';
import type { ReasoningEffort } from './codexAppServerTypes';
import { HAPPY_CURRENT_SESSION_ID, HAPPY_DAEMON_CONTROL_URL, HAPPY_FORKED_FROM_SESSION_ID } from '@/utils/envNames';
import { createCodexPatchApprovalInput } from './codexApprovalSnapshot';
import type { LedgerRecord } from '@slopus/happy-wire';
import { createEnvelope } from '@slopus/happy-wire';
import { loadProjectMcpServers } from './projectMcpConfig';
import { filterMcpServersByToolGating } from './mcpServerGating';
import { createAgentTreeState, type AgentTreeEvent } from './agentTreeState';

function getMessageDelivery(message: { messageId?: string; seq?: number }): MessageDelivery | undefined {
    return typeof message.messageId === 'string' && typeof message.seq === 'number'
        ? { messageId: message.messageId, seq: message.seq }
        : undefined;
}

/**
 * Extracts a human-readable error from a codex task_complete/turn_aborted event.
 * Returns null if the event represents a successful/clean completion.
 */
function describeCodexFailure(msg: any): string | null {
    const hasFailure = msg?.status === 'failed' || (msg?.error !== undefined && msg?.error !== null);
    if (!hasFailure) return null;
    const err = msg.error;
    if (typeof err === 'string' && err.length > 0) return err;
    if (err && typeof err === 'object' && typeof err.message === 'string' && err.message.length > 0) {
        return err.message;
    }
    return 'Unknown error';
}

/**
 * Main entry point for the codex command with ink UI
 */
export async function runCodex(opts: {
    credentials: Credentials;
    startedBy?: 'daemon' | 'terminal';
    noSandbox?: boolean;
    resumeThreadId?: string;
    effortLevel?: ReasoningEffort;
    model?: string;
    permissionMode?: string;
    projectDocFallback?: string[];
    codexTransport?: CodexTransportFlag | undefined;
    /**
     * Gap 9 (codex-agent-parity-audit.md): mirror Claude's `--claude-arg`
     * escape hatch. These flags are appended verbatim to the spawned
     * `codex app-server` argv. Power-user territory; prefer structured
     * codex flags (`--effort`, `--model`, `--permission-mode`,
     * `--codex-transport`) when possible.
     */
    codexAppServerArgs?: string[];
}): Promise<void> {
    const projectDocFallback = opts.projectDocFallback ?? ['CLAUDE.md', 'AGENTS.md'];

    // Early check: ensure Codex CLI is installed before proceeding
    try {
        execSync('codex --version', { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
    } catch {
        console.error('\n\x1b[1m\x1b[33mCodex CLI is not installed\x1b[0m\n');
        console.error('Please install Codex CLI using one of these methods:\n');
        console.error('\x1b[1mOption 1 - npm (recommended):\x1b[0m');
        console.error('  \x1b[36mnpm install -g @openai/codex\x1b[0m\n');
        console.error('\x1b[1mOption 2 - Homebrew (macOS):\x1b[0m');
        console.error('  \x1b[36mbrew install --cask codex\x1b[0m\n');
        console.error('Alternatively, use Claude Code:');
        console.error('  \x1b[36mhappy claude\x1b[0m\n');
        process.exit(1);
    }

    // Use shared PermissionMode type for cross-agent compatibility
    type PermissionMode = import('@/api/types').PermissionMode;
    interface EnhancedMode {
        permissionMode: PermissionMode;
        model?: string;
        thinkingLevel?: ReasoningEffort;
        customSystemPrompt?: string;
        appendSystemPrompt?: string;
        // Gap 8 (codex-agent-parity-audit.md): partial parity for
        // per-message tool gating. Whole-server granularity; the
        // filter is applied to mcpServers at startThread / resume
        // sites. See mcpServerGating.ts.
        allowedTools?: string[];
        disallowedTools?: string[];
    }

    //
    // Define session
    //

    const sessionTag = randomUUID();

    // Set backend for offline warnings (before any API calls)
    connectionState.setBackend('Codex');

    const api = await ApiClient.create(opts.credentials);

    // Log startup options
    logger.debug(`[codex] Starting with options: startedBy=${opts.startedBy || 'terminal'}`);

    //
    // Machine
    //

    const settings = await readSettings();
    let machineId = settings?.machineId;
    const sandboxConfig = opts.noSandbox ? undefined : settings?.sandboxConfig;
    if (!machineId) {
        console.error(`[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on https://github.com/slopus/happy-cli/issues`);
        process.exit(1);
    }
    logger.debug(`Using machineId: ${machineId}`);
    //
    // Create session
    //

    const { state, metadata } = createSessionMetadata({
        flavor: 'codex',
        machineId,
        startedBy: opts.startedBy,
        sandbox: sandboxConfig,
    });

    // Check for session reconnection env vars (set by daemon for resume-in-place)
    const reconnectSessionId = process.env.HAPPY_RECONNECT_SESSION_ID;
    const reconnectKeyBase64 = process.env.HAPPY_RECONNECT_ENCRYPTION_KEY;
    const reconnectVariant = process.env.HAPPY_RECONNECT_ENCRYPTION_VARIANT as 'legacy' | 'dataKey' | undefined;
    const reconnectSeq = process.env.HAPPY_RECONNECT_SEQ;
    const reconnectMetadataVersion = process.env.HAPPY_RECONNECT_METADATA_VERSION;
    const reconnectAgentStateVersion = process.env.HAPPY_RECONNECT_AGENT_STATE_VERSION;
    const forkedFromSessionId = process.env[HAPPY_FORKED_FROM_SESSION_ID];

    let response: ApiSession | null;
    if (reconnectSessionId && reconnectKeyBase64 && reconnectVariant) {
        logger.debug(`[START] Reconnecting to existing session ${reconnectSessionId}`);
        response = {
            id: reconnectSessionId,
            seq: parseInt(reconnectSeq || '0', 10),
            encryptionKey: decodeBase64(reconnectKeyBase64),
            encryptionVariant: reconnectVariant,
            metadata,
            metadataVersion: parseInt(reconnectMetadataVersion || '0', 10),
            agentState: state,
            agentStateVersion: parseInt(reconnectAgentStateVersion || '0', 10),
        };
    } else {
        response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });
    }

    // Handle server unreachable case - create offline stub with hot reconnection
    let session: ApiSessionClient;
    // Permission handler declared here so it can be updated in onSessionSwap callback
    // (assigned later at line ~385 after client setup)
    let permissionHandler: CodexPermissionHandler;
    let client!: CodexAppServerClient;
    let reasoningProcessor!: ReasoningProcessor;
    let abortInProgress: Promise<void> | null = null;
    let closing = false;
    const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
        api,
        sessionTag,
        metadata,
        state,
        response,
        onSessionSwap: (newSession) => {
            session = newSession;
            // Update permission handler with new session to avoid stale reference
            if (permissionHandler) {
                permissionHandler.updateSession(newSession);
            }
        }
    });
    session = initialSession;
    const ledgerRunId = metadata.runId;
    const ledgerSessionId = response?.id ?? session.sessionId;
    const appendSessionLedgerRecord = (record: LedgerRecord): void => {
        if (!ledgerRunId) return;
        void appendLedgerRecord(ledgerRunId, ledgerSessionId, record).catch((error) => {
            logger.debug('[ledger] Failed to append Codex ledger record', error);
        });
    };
    const lastPublishedPermissionModeCode = { current: undefined as string | undefined };

    // On reconnect, un-archive the session and skip replaying old messages.
    if (reconnectSessionId) {
        session.suppressNextArchiveSignal();
        session.skipExistingMessages();
        session.updateMetadata((meta) => ({
            ...meta,
            lifecycleState: 'running',
            archivedBy: undefined,
        }));
    }

    // Always report to daemon if it exists (skip if offline)
    if (response) {
        try {
            logger.debug(`[START] Reporting session ${response.id} to daemon`);
            const result = await notifyDaemonSessionStarted(response.id, metadata, {
                encryptionKey: encodeBase64(response.encryptionKey),
                encryptionVariant: response.encryptionVariant,
                seq: response.seq,
                metadataVersion: response.metadataVersion,
                agentStateVersion: response.agentStateVersion,
            });
            if (result.error) {
                logger.debug(`[START] Failed to report to daemon (may not be running):`, result.error);
            } else {
                logger.debug(`[START] Reported session ${response.id} to daemon`);
            }
        } catch (error) {
            logger.debug('[START] Failed to report to daemon (may not be running):', error);
        }
    }

    const messageQueue = new MessageQueue2<EnhancedMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        thinkingLevel: mode.thinkingLevel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools,
    }));

    // Track current overrides to apply per message
    // Use shared PermissionMode type from api/types for cross-agent compatibility
    let currentPermissionMode: import('@/api/types').PermissionMode | undefined = opts.permissionMode as import('@/api/types').PermissionMode | undefined;
    let currentModel: string | undefined = opts.model;
    let currentThinkingLevel: ReasoningEffort | undefined = opts.effortLevel;
    // Gap 7 (codex-agent-parity-audit.md): codex now mirrors Claude's per-message
    // customSystemPrompt / appendSystemPrompt tracking. Values are applied to the
    // NEXT thread start (or resume) — mid-session changes do NOT restart an
    // already-active thread, matching Claude's "next turn only" semantics.
    let currentCustomSystemPrompt: string | undefined = undefined;
    let currentAppendSystemPrompt: string | undefined = undefined;
    // Gap 8 (codex-agent-parity-audit.md): partial codex-side parity for
    // per-message tool gating. Values are applied at the NEXT thread
    // start / resume — codex has no per-turn tool allowlist, so the
    // filter operates on the mcpServers config handed to startThread.
    let currentAllowedTools: string[] | undefined = undefined;
    let currentDisallowedTools: string[] | undefined = undefined;

    // Valid Codex permission modes from remote messages. Restricted to the
    // native Codex modes exposed by the mobile UI (see modelModeOptions.ts:
    // getCodexPermissionModes) PLUS 'plan' for cross-agent (Claude → Codex)
    // session handoffs. Anything outside this set is silently ignored —
    // the previous code blindly cast `message.meta.permissionMode as PermissionMode`
    // at runtime, meaning a crafted value like `'totally_unsafe'` would be
    // accepted and then fall through to the `default` branch in
    // resolveCodexExecutionPolicy() — or worse, an attacker-chosen valid value
    // could escalate sandbox scope (issue #1092).
    const VALID_REMOTE_PERMISSION_MODES: readonly PermissionMode[] = VALID_CODEX_REMOTE_PERMISSION_MODES;

    // Gap 6 (codex-agent-parity-audit.md) v1 defensive plan-mode mapping: codex
    // has no native plan mode or `ExitPlanMode` tool. When the mobile UI hands
    // a Claude session in plan mode off to codex (or the user picks 'plan'
    // through a future codex picker), executionPolicy.ts coerces plan →
    // { approval: never, sandbox: read-only } so the agent runs unattended but
    // cannot write. The user sees a one-time service-message hint so they
    // understand the approximation. v2 (codex-plan-mode-overlay) will ship a
    // real overlay crate with an exit_plan_mode tool.
    let planModeHintSent = false;
    const PLAN_MODE_HINT_TEXT = 'Plan mode on codex is approximated as read-only; the ExitPlanMode tool is not available. The agent will read freely but cannot write or run mutating commands until you change the mode.';
    const maybeSendPlanModeHint = (mode: PermissionMode | undefined): void => {
        if (mode !== 'plan' || planModeHintSent || closing) return;
        planModeHintSent = true;
        try {
            session.sendSessionProtocolMessage(createEnvelope('agent', {
                t: 'service',
                text: PLAN_MODE_HINT_TEXT,
            }));
        } catch (err) {
            logger.debug('[Codex] Failed to emit plan-mode hint', err);
        }
    };

    // Fire the hint immediately if startup options already specify plan mode.
    maybeSendPlanModeHint(currentPermissionMode);

    if (typeof session.onAgentConfiguration === 'function') {
        session.onAgentConfiguration((configuration: AgentConfiguration) => {
            const metadataPatch: { model?: string; thinkingLevel?: ReasoningEffort } = {};
            if (Object.prototype.hasOwnProperty.call(configuration, 'permissionMode')) {
                const incoming = configuration.permissionMode as PermissionMode | undefined;
                if (incoming === undefined || VALID_REMOTE_PERMISSION_MODES.includes(incoming)) {
                    currentPermissionMode = incoming;
                    void publishPermissionModeIfChanged(session, metadata, currentPermissionMode, lastPublishedPermissionModeCode);
                    maybeSendPlanModeHint(currentPermissionMode);
                    logger.debug(`[Codex] Permission mode updated from live configuration for next turn: ${currentPermissionMode ?? 'default (effective)'}`);
                } else {
                    logger.debug(`[Codex] Ignoring invalid permission mode from live configuration: ${String(configuration.permissionMode)}`);
                }
            }
            if (Object.prototype.hasOwnProperty.call(configuration, 'model')) {
                currentModel = configuration.model || undefined;
                metadataPatch.model = currentModel;
                logger.debug(`[Codex] Model updated from live configuration for next turn: ${currentModel || 'default'}`);
            }
            if (Object.prototype.hasOwnProperty.call(configuration, 'thinkingLevel')) {
                currentThinkingLevel = configuration.thinkingLevel as ReasoningEffort | undefined;
                metadataPatch.thinkingLevel = currentThinkingLevel;
                logger.debug(`[Codex] Thinking level updated from live configuration for next turn: ${currentThinkingLevel || 'default'}`);
            }
            void publishAgentConfigurationMetadataIfChanged(session, metadata, metadataPatch);
        });
    }

    session.onUserMessage((message) => {
        if (closing) return;

        // Resolve permission mode (validate against Codex-native modes)
        let messagePermissionMode = currentPermissionMode;
        if (message.meta?.permissionMode) {
            const incoming = message.meta.permissionMode as PermissionMode;
            if (VALID_REMOTE_PERMISSION_MODES.includes(incoming)) {
                messagePermissionMode = incoming;
                currentPermissionMode = messagePermissionMode;
                logger.debug(`[Codex] Permission mode updated from user message to: ${currentPermissionMode}`);
                void publishPermissionModeIfChanged(session, metadata, messagePermissionMode, lastPublishedPermissionModeCode);
                maybeSendPlanModeHint(messagePermissionMode);
            } else {
                logger.debug(`[Codex] Ignoring invalid permission mode from user message: ${String(message.meta.permissionMode)}`);
            }
        } else {
            logger.debug(`[Codex] User message received with no permission mode override, using current: ${currentPermissionMode ?? 'default (effective)'}`);
        }

        // Resolve model; explicit null resets to default (undefined)
        let messageModel = currentModel;
        if (message.meta?.hasOwnProperty('model')) {
            messageModel = message.meta.model || undefined;
            currentModel = messageModel;
            logger.debug(`[Codex] Model updated from user message: ${messageModel || 'reset to default'}`);
        } else {
            logger.debug(`[Codex] User message received with no model override, using current: ${currentModel || 'default'}`);
        }

        let messageThinkingLevel = currentThinkingLevel;
        if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'thinkingLevel')) {
            messageThinkingLevel = message.meta.thinkingLevel as ReasoningEffort | undefined;
            currentThinkingLevel = messageThinkingLevel;
            logger.debug(`[Codex] Thinking level updated from user message: ${messageThinkingLevel || 'reset to default'}`);
        }

        // Resolve custom system prompt - use message.meta.customSystemPrompt if provided, otherwise use current
        let messageCustomSystemPrompt = currentCustomSystemPrompt;
        if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'customSystemPrompt')) {
            messageCustomSystemPrompt = message.meta.customSystemPrompt || undefined; // null becomes undefined
            currentCustomSystemPrompt = messageCustomSystemPrompt;
            logger.debug(`[Codex] Custom system prompt updated from user message: ${messageCustomSystemPrompt ? 'set' : 'reset to none'}`);
        }

        // Resolve append system prompt - use message.meta.appendSystemPrompt if provided, otherwise use current
        let messageAppendSystemPrompt = currentAppendSystemPrompt;
        if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'appendSystemPrompt')) {
            messageAppendSystemPrompt = message.meta.appendSystemPrompt || undefined; // null becomes undefined
            currentAppendSystemPrompt = messageAppendSystemPrompt;
            logger.debug(`[Codex] Append system prompt updated from user message: ${messageAppendSystemPrompt ? 'set' : 'reset to none'}`);
        }

        // Gap 8: resolve allowedTools / disallowedTools per-message. Same
        // sentinel pattern as customSystemPrompt — explicit null/empty
        // resets to "no constraint". Stored on the EnhancedMode so a
        // change forces a new isolation key (the next thread start picks
        // them up via the filtered mcpServers).
        let messageAllowedTools = currentAllowedTools;
        if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'allowedTools')) {
            const raw = (message.meta as { allowedTools?: unknown }).allowedTools;
            messageAllowedTools = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : undefined;
            currentAllowedTools = messageAllowedTools;
            logger.debug(`[Codex] allowedTools updated from user message: ${messageAllowedTools ? messageAllowedTools.join(',') : 'reset to none'}`);
        }
        let messageDisallowedTools = currentDisallowedTools;
        if (message.meta && Object.prototype.hasOwnProperty.call(message.meta, 'disallowedTools')) {
            const raw = (message.meta as { disallowedTools?: unknown }).disallowedTools;
            messageDisallowedTools = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : undefined;
            currentDisallowedTools = messageDisallowedTools;
            logger.debug(`[Codex] disallowedTools updated from user message: ${messageDisallowedTools ? messageDisallowedTools.join(',') : 'reset to none'}`);
        }

        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode || 'default',
            model: messageModel,
            thinkingLevel: messageThinkingLevel,
            customSystemPrompt: messageCustomSystemPrompt,
            appendSystemPrompt: messageAppendSystemPrompt,
            allowedTools: messageAllowedTools,
            disallowedTools: messageDisallowedTools,
        };
        // Slash commands (`/clear`, `/compact`) must not be newline-joined with
        // sibling user text; isolation lets the loop body dispatch them through
        // the dedicated codex RPC paths without dragging accidentally-batched
        // text into the same handling. Detection here intentionally mirrors the
        // loop-body parse so the wrapped-form contract (F-012 / F-013 — see
        // packages/happy-cli/AGENTS.md "Wrapped-slash-command detection") stays
        // single-sourced through parseSpecialCommand.
        const inboundSpecial = parseSpecialCommand(message.content.text);
        if (inboundSpecial.type === 'clear' || inboundSpecial.type === 'compact') {
            messageQueue.pushIsolateAndClear(message.content.text, enhancedMode, getMessageDelivery(message));
        } else {
            messageQueue.push(message.content.text, enhancedMode, getMessageDelivery(message));
        }
        if (ledgerRunId) {
            appendSessionLedgerRecord({
                runId: ledgerRunId,
                sessionId: ledgerSessionId,
                timestamp: new Date().toISOString(),
                eventType: 'message-sent',
                direction: 'user-to-agent',
                messageId: message.messageId,
                seqWithinSession: message.seq,
                messagePreview: message.content.text,
            });
        }
    });
    let thinking = false;
    let currentTurnId: string | null = null;
    let codexStartedSubagents = new Set<string>();
    let codexActiveSubagents = new Set<string>();
    let codexProviderSubagentToSessionSubagent = new Map<string, string>();
    // Tracks whether the most recent `thread/compact/start` was driven by a
    // `/compact` slash command from the user. The context_compacted event
    // handler (see below) consumes this flag to distinguish the manual `compact`
    // boundary from the automatic `autocompact` boundary — codex's wire surface
    // does not tag the `thread/compacted` notification with origin.
    let userTriggeredCompactInFlight = false;
    session.keepAlive(thinking, 'remote');
    // Periodic keep-alive; store handle so we can clear on exit
    const keepAliveInterval = setInterval(() => {
        if (!closing) session.keepAlive(thinking, 'remote');
    }, 2000);

    const sendSessionEventIfOpen = (event: Parameters<typeof session.sendSessionEvent>[0]) => {
        if (!closing) session.sendSessionEvent(event);
    };

    const sendSessionProtocolMessageIfOpen = (envelope: Parameters<typeof session.sendSessionProtocolMessage>[0]) => {
        if (!closing) session.sendSessionProtocolMessage(envelope);
    };

    const keepAliveIfOpen = () => {
        if (!closing) session.keepAlive(thinking, 'remote');
    };

    const sendReady = () => {
        if (closing) return;
        session.sendSessionEvent({ type: 'ready' });
        try {
            session.sendPushEvent({
                kind: 'done',
                data: {
                    sessionId: session.sessionId,
                    type: 'ready',
                    provider: 'codex',
                }
            });
        } catch (pushError) {
            logger.debug('[Codex] Failed to send ready push', pushError);
        }
    };
    const agentTreeState = createAgentTreeState();

    // Debug helper: log active handles/requests if DEBUG is enabled
    function logActiveHandles(tag: string) {
        if (!process.env.DEBUG) return;
        const anyProc: any = process as any;
        const handles = typeof anyProc._getActiveHandles === 'function' ? anyProc._getActiveHandles() : [];
        const requests = typeof anyProc._getActiveRequests === 'function' ? anyProc._getActiveRequests() : [];
        logger.debug(`[codex][handles] ${tag}: handles=${handles.length} requests=${requests.length}`);
        try {
            const kinds = handles.map((h: any) => (h && h.constructor ? h.constructor.name : typeof h));
            logger.debug(`[codex][handles] kinds=${JSON.stringify(kinds)}`);
        } catch { }
    }

    //
    // Abort handling
    // IMPORTANT: There are two different operations:
    // 1. Abort (handleAbort): Stops the current inference/task but keeps the session alive
    //    - Used by the 'abort' RPC from mobile app
    //    - Similar to Claude Code's abort behavior
    //    - Allows continuing with new prompts after aborting
    // 2. Kill (handleKillSession): Terminates the entire process
    //    - Used by the 'killSession' RPC
    //    - Completely exits the CLI process
    //

    // AbortController is used ONLY to wake messageQueue.waitForMessages when idle.
    // Turn cancellation uses client.interruptTurn() — no AbortController hack needed.
    let abortController = new AbortController();
    let shouldExit = false;

    /**
     * Handles aborting the current task/inference without exiting the process.
     * This is the equivalent of Claude Code's abort - it stops what's currently
     * happening but keeps the session alive for new prompts.
     */
    async function handleAbort() {
        if (abortInProgress) {
            await abortInProgress;
            return;
        }

        logger.debug('[Codex] Abort requested - stopping current task');
        abortInProgress = (async () => {
            try {
                // Resolve any pending permission requests as 'abort' first.
                if (permissionHandler) {
                    permissionHandler.abortAll();
                }

                // Request interruption, then force-restart Codex app-server if
                // it doesn't settle quickly (long-running shell commands).
                if (client) {
                    const abortResult = await client.abortTurnWithFallback({
                        gracePeriodMs: 3000,
                        forceRestartOnTimeout: true,
                    });
                    if (abortResult.forcedRestart) {
                        logger.warn('[Codex] Forced app-server restart after interrupt timeout');
                        sendSessionEventIfOpen({
                            type: 'message',
                            message: abortResult.resumedThread
                                ? 'Force-stopped active task after interrupt timeout. Codex backend was restarted and the previous thread was resumed.'
                                : 'Force-stopped active task after interrupt timeout. Codex backend was restarted, but the previous thread could not be resumed.',
                        });
                    }
                }

                if (reasoningProcessor) {
                    reasoningProcessor.abort();
                }
                logger.debug('[Codex] Abort completed - session remains active');
            } catch (error) {
                logger.debug('[Codex] Error during abort:', error);
            } finally {
                // Wake up message queue wait if idle
                abortController.abort();
                abortController = new AbortController();
            }
        })();

        await abortInProgress;
        abortInProgress = null;
    }

    /**
     * Handles session termination and process exit.
     * This is called when the session needs to be completely killed (not just aborted).
     * Abort stops the current inference but keeps the session alive.
     * Kill terminates the entire process.
     */
    const handleKillSession = async () => {
        closing = true;
        session.rpcHandlerManager.unregisterHandler('sessionGetAgentTree');
        logger.debug('[Codex] Kill session requested - terminating process');
        await handleAbort();
        agentTreeState.clear();
        logger.debug('[Codex] Abort completed, proceeding with termination');

        // Update lifecycle state to archived before closing
        if (session) {
            session.updateMetadata((currentMetadata) => ({
                ...currentMetadata,
                lifecycleState: 'archived',
                lifecycleStateSince: Date.now(),
                archivedBy: 'cli',
                archiveReason: 'User terminated'
            }));

            // Send session death message
            session.sendSessionDeath();
            await session.flush();
            await session.close();
        }

        // Force close Codex transport (best-effort) so we don't leave stray processes
        try {
            await client.disconnect({ terminateAppServer: true });
        } catch (e) {
            logger.debug('[Codex] Error disconnecting Codex during termination', e);
        }

        // Stop Happy MCP server
        happyServer.stop();

        logger.debug('[Codex] Session termination complete');
    };

    // Register abort handler
    session.rpcHandlerManager.registerHandler('abort', handleAbort);
    session.rpcHandlerManager.registerHandler('sessionGetAgentTree', () => agentTreeState.snapshot());

    registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

    //
    // Initialize Ink UI
    //

    const messageBuffer = new MessageBuffer();
    const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
    let inkInstance: any = null;

    if (hasTTY) {
        console.clear();
        inkInstance = render(React.createElement(CodexDisplay, {
            messageBuffer,
            logPath: process.env.DEBUG ? logger.getLogPath() : undefined,
            onExit: async () => {
                // Exit the agent
                logger.debug('[codex]: Exiting agent via Ctrl-C');
                shouldExit = true;
                await handleAbort();
            }
        }), {
            exitOnCtrlC: false,
            patchConsole: false
        });
    }

    if (hasTTY) {
        process.stdin.resume();
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.setEncoding("utf8");
    }

    //
    // Start Context 
    //

    client = new CodexAppServerClient(sandboxConfig, {
        transport: opts.codexTransport ?? 'ws',
        transportSource: opts.codexTransport ? 'explicit' : 'default',
        logFilePath: join(configuration.logsDir, `codex-app-server-${sessionTag}.log`),
        extraAppServerArgs: opts.codexAppServerArgs,
    });

    permissionHandler = new CodexPermissionHandler(session);
    reasoningProcessor = new ReasoningProcessor((message) => {
        const envelopes = mapCodexProcessorMessageToSessionEnvelopes(message, { currentTurnId });
        for (const envelope of envelopes) {
            sendSessionProtocolMessageIfOpen(envelope);
        }
    });
    const diffProcessor = new DiffProcessor((message) => {
        const envelopes = mapCodexProcessorMessageToSessionEnvelopes(message, { currentTurnId });
        for (const envelope of envelopes) {
            sendSessionProtocolMessageIfOpen(envelope);
        }
    });

    // Approval handler: routes server → client approval requests to our permission handler
    client.setApprovalHandler(async (params) => {
        const toolName = params.type === 'exec'
            ? 'CodexBash'
            : params.type === 'patch'
                ? 'CodexPatch'
                : (params.toolName ?? 'McpTool');
        const input = params.type === 'exec'
            ? { command: params.command, cwd: params.cwd }
            : params.type === 'patch'
                ? createCodexPatchApprovalInput(params.fileChanges)
                : (params.input ?? {});

        try {
            const result = await permissionHandler.handleToolCall(params.callId, toolName, input);
            logger.debug('[Codex] Permission result:', result.decision);
            return result.decision;
        } catch (error) {
            logger.debug('[Codex] Error handling permission:', error);
            return 'denied';
        }
    });

    // Event handler: same EventMsg types as the legacy MCP server — no changes needed
    client.setEventHandler((msg) => {
        logger.debug(`[Codex] Event: ${JSON.stringify(msg)}`);

        const agentTreeDeltas = agentTreeState.applyEvent(msg as AgentTreeEvent);
        for (const delta of agentTreeDeltas) {
            if (!closing) session.sendAgentTreeUpdate(delta);
        }

        // Add messages to the ink UI buffer based on message type
        if (msg.type === 'agent_message') {
            messageBuffer.addMessage((msg as any).message, 'assistant');
        } else if (msg.type === 'agent_reasoning_delta') {
            // Skip reasoning deltas in the UI to reduce noise
        } else if (msg.type === 'agent_reasoning') {
            messageBuffer.addMessage(`[Thinking] ${(msg as any).text.substring(0, 100)}...`, 'system');
        } else if (msg.type === 'exec_command_begin') {
            messageBuffer.addMessage(`Executing: ${(msg as any).command}`, 'tool');
        } else if (msg.type === 'exec_command_end') {
            const output = (msg as any).output || (msg as any).error || 'Command completed';
            const truncatedOutput = output.substring(0, 200);
            messageBuffer.addMessage(
                `Result: ${truncatedOutput}${output.length > 200 ? '...' : ''}`,
                'result'
            );
        } else if (msg.type === 'task_started') {
            messageBuffer.addMessage('Starting task...', 'status');
        } else if (msg.type === 'task_complete') {
            // Ready is emitted from the main loop's idle check so pushes only fire once
            // after the queue is actually drained.
            const failure = describeCodexFailure(msg);
            if (failure) {
                messageBuffer.addMessage(`Task failed: ${failure}`, 'status');
                sendSessionEventIfOpen({ type: 'message', message: `Codex error: ${failure}` });
            } else {
                messageBuffer.addMessage('Task completed', 'status');
            }
        } else if (msg.type === 'turn_aborted') {
            const failure = describeCodexFailure(msg);
            if (failure) {
                messageBuffer.addMessage(`Turn aborted: ${failure}`, 'status');
                sendSessionEventIfOpen({ type: 'message', message: `Codex error: ${failure}` });
            } else {
                messageBuffer.addMessage('Turn aborted', 'status');
            }
        }

        if (msg.type === 'task_started') {
            if (!thinking) {
                logger.debug('thinking started');
                thinking = true;
                keepAliveIfOpen();
            }
        }
        if (msg.type === 'task_complete' || msg.type === 'turn_aborted') {
            if (thinking) {
                logger.debug('thinking completed');
                thinking = false;
                keepAliveIfOpen();
            }
            // Reset diff processor on task end or abort
            diffProcessor.reset();
        }
        if (msg.type === 'agent_reasoning_section_break') {
            reasoningProcessor.handleSectionBreak();
        }
        if (msg.type === 'agent_reasoning_delta') {
            reasoningProcessor.processDelta((msg as any).delta);
        }
        if (msg.type === 'agent_reasoning') {
            reasoningProcessor.complete((msg as any).text);
        }
        if (msg.type === 'patch_apply_begin') {
            const { changes } = msg as any;
            const changeCount = Object.keys(changes).length;
            const filesMsg = changeCount === 1 ? '1 file' : `${changeCount} files`;
            messageBuffer.addMessage(`Modifying ${filesMsg}...`, 'tool');
        }
        if (msg.type === 'patch_apply_end') {
            const { stdout, stderr, success } = msg as any;
            if (success) {
                const message = stdout || 'Files modified successfully';
                messageBuffer.addMessage(message.substring(0, 200), 'result');
            } else {
                const errorMsg = stderr || 'Failed to modify files';
                messageBuffer.addMessage(`Error: ${errorMsg.substring(0, 200)}`, 'result');
            }
        }
        if (msg.type === 'turn_diff') {
            if ((msg as any).unified_diff) {
                diffProcessor.processDiff((msg as any).unified_diff);
            }
        }
        if (msg.type === 'context_compacted') {
            // Codex auto/manual compaction parity with Claude's PostCompact hook.
            // Codex's ContextCompactedEvent is a unit struct (no fields distinguish
            // auto from manual), so runCodex tracks whether the most recent
            // `thread/compact/start` was driven by a `/compact` slash command via
            // the `userTriggeredCompactInFlight` flag. When the flag is set, emit
            // `kind: 'compact', triggeredBy: 'user'` (parity with Claude's manual
            // /compact path) and consume the flag so the next auto compaction
            // emits `kind: 'autocompact', triggeredBy: 'system'` again.
            const userTriggered = userTriggeredCompactInFlight;
            userTriggeredCompactInFlight = false;
            void session.sendContextBoundary({
                kind: userTriggered ? 'compact' : 'autocompact',
                triggeredBy: userTriggered ? 'user' : 'system',
                at: Date.now(),
            }).catch((err: unknown) => {
                logger.debug('[Codex] Failed to emit context_compacted boundary:', err);
            });
        }

        // Convert events into the unified session-protocol envelope stream.
        // Reasoning deltas are handled by ReasoningProcessor to avoid duplicate text output.
        if (msg.type !== 'agent_reasoning_delta' && msg.type !== 'agent_reasoning' && msg.type !== 'agent_reasoning_section_break' && msg.type !== 'turn_diff') {
            const mapped = mapCodexMcpMessageToSessionEnvelopes(msg, {
                currentTurnId,
                startedSubagents: codexStartedSubagents,
                activeSubagents: codexActiveSubagents,
                providerSubagentToSessionSubagent: codexProviderSubagentToSessionSubagent,
            });
            currentTurnId = mapped.currentTurnId;
            codexStartedSubagents = mapped.startedSubagents;
            codexActiveSubagents = mapped.activeSubagents;
            codexProviderSubagentToSessionSubagent = mapped.providerSubagentToSessionSubagent;
            for (const envelope of mapped.envelopes) {
                sendSessionProtocolMessageIfOpen(envelope);
            }
        }
    });

    // Start Happy MCP server (HTTP) and prepare STDIO bridge config for Codex
    const happyServer = await startHappyServer(session);
    const cwdAtStart = process.cwd();
    const projectMcpServers = loadProjectMcpServers(cwdAtStart);
    // Launch the bridge via `node <path>` (rather than relying on the .mjs shebang)
    // so it works on Windows, where Windows can't execute shebang scripts directly.
    // codex would otherwise fail to start the MCP server, the change_title tool would
    // not be visible to the model, and the model would improvise with shell echoes.
    const bridgeEntrypoint = join(projectPath(), 'bin', 'happy-mcp.mjs');
    const mcpServers = {
        ...projectMcpServers,
        happy: {
            command: process.execPath,
            args: ['--no-warnings', '--no-deprecation', bridgeEntrypoint, '--url', happyServer.url]
        }
    };
    let first = true;

    try {
        const daemonState = await readDaemonState();
        const codexAppServerEnv: Record<string, string> = {
            [HAPPY_CURRENT_SESSION_ID]: session.sessionId,
        };
        if (daemonState?.httpPort) {
            codexAppServerEnv[HAPPY_DAEMON_CONTROL_URL] = `http://127.0.0.1:${daemonState.httpPort}`;
        }

        logger.debug('[codex]: client.connect begin');
        await client.connect({ extraEnv: codexAppServerEnv });
        logger.debug('[codex]: client.connect done');

        if (client.sandboxEnabled) {
            currentPermissionMode = 'yolo';
            await publishPermissionModeIfChanged(session, metadata, 'yolo', lastPublishedPermissionModeCode);
        }

        if (opts.resumeThreadId) {
            // Gap 8: apply allowedTools/disallowedTools at resume too —
            // the codex thread re-startup picks up the filtered mcpServers
            // for the resumed turn. Uses the current (CLI-startup) values;
            // per-message overrides arrive after this branch and apply at
            // the next startThread.
            const resumeMcpServers = filterMcpServersByToolGating(mcpServers, {
                allowedTools: currentAllowedTools,
                disallowedTools: currentDisallowedTools,
            });
            await resumeExistingThread({
                client,
                session,
                messageBuffer,
                threadId: opts.resumeThreadId,
                cwd: cwdAtStart,
                mcpServers: resumeMcpServers,
                projectDocFallback,
                baseInstructions: currentCustomSystemPrompt,
                developerInstructions: currentAppendSystemPrompt,
            });
            if (forkedFromSessionId) {
                await session.sendContextBoundary({
                    kind: 'session-fork-resume',
                    triggeredBy: 'user',
                    at: Date.now(),
                    forkedFromSid: forkedFromSessionId,
                });
            }
            first = false;
        }

        let pending: MessageBatch<EnhancedMode> | null = null;
        const emitConsumptionReceipts = (batch: MessageBatch<EnhancedMode>) => {
            for (const delivery of batch.consumedMessages) {
                session.sendMessageConsumption({
                    messageId: delivery.messageId,
                    agentFlavor: 'codex',
                });
            }
        };

        while (!shouldExit) {
            logActiveHandles('loop-top');
            let message: MessageBatch<EnhancedMode> | null = pending;
            pending = null;
            if (!message) {
                // Capture the current signal to distinguish idle-abort from queue close
                const waitSignal = abortController.signal;
                const batch = await messageQueue.waitForMessagesAndGetAsString(waitSignal);
                if (!batch) {
                    // If wait was aborted (e.g., remote abort with no active inference), ignore and continue
                    if (waitSignal.aborted && !shouldExit) {
                        logger.debug('[codex]: Wait aborted while idle; ignoring and continuing');
                        continue;
                    }
                    logger.debug(`[codex]: batch=${!!batch}, shouldExit=${shouldExit}`);
                    break;
                }
                message = batch;
            }

            // Defensive check for TS narrowing
            if (!message) {
                break;
            }

            emitConsumptionReceipts(message);

            // Display user messages in the UI
            messageBuffer.addMessage(message.message, 'user');

            // Intercept happy-cli-side slash commands BEFORE dispatching to codex.
            // The codex app-server does not natively interpret `/clear` or
            // `/compact` typed in user-turn text; we drive the equivalent codex
            // actions via dedicated JSON-RPCs and emit typed context-boundary
            // envelopes for app rendering parity with the Claude path (see
            // Gap 5 in plans/codex-agent-parity-audit.md and the wrapped-form
            // contract in packages/happy-cli/AGENTS.md "Wrapped-slash-command
            // detection (F-012 / F-013)").
            const specialCommand = parseSpecialCommand(message.message);
            if (specialCommand.type === 'clear') {
                logger.debug('[Codex] Detected /clear command');
                const hadThread = client.hasActiveThread();
                client.clearActiveThread();
                // Drop the stale thread id from session metadata so subsequent
                // metadata reads (e.g., reconnect / fork) don't resurrect a
                // thread that no longer represents the live context.
                session.updateMetadata((currentMetadata) => ({
                    ...currentMetadata,
                    codexThreadId: undefined,
                }));
                if (hadThread) {
                    void session.sendContextBoundary({
                        kind: 'clear',
                        triggeredBy: 'user',
                        at: Date.now(),
                    }).catch((err: unknown) => {
                        logger.debug('[Codex] Failed to emit clear context boundary:', err);
                    });
                }
                messageBuffer.addMessage('Context cleared. The next message will start a fresh codex thread.', 'status');
                continue;
            }
            if (specialCommand.type === 'compact') {
                logger.debug('[Codex] Detected /compact command');
                if (!client.hasActiveThread()) {
                    messageBuffer.addMessage('No active codex thread to compact.', 'status');
                    continue;
                }
                userTriggeredCompactInFlight = true;
                try {
                    await client.compactThread();
                } catch (error) {
                    // RPC failure means no compaction happened; release the flag
                    // so the next legitimate context_compacted event still emits
                    // the autocompact boundary correctly.
                    userTriggeredCompactInFlight = false;
                    logger.warn('[Codex] /compact RPC failed:', error);
                    messageBuffer.addMessage('Failed to compact context. Try again later.', 'status');
                }
                continue;
            }

            try {
                // Map permission mode to approval policy and sandbox.
                // With app-server, these are per-turn — no restart needed on mode change.
                const sandboxManagedByHappy = client.sandboxEnabled;
                const executionPolicy = resolveCodexExecutionPolicy(
                    message.mode.permissionMode,
                    sandboxManagedByHappy,
                );

                // Start thread on first turn (thread persists across mode changes)
                if (!client.hasActiveThread()) {
                    // Gap 8 (codex-agent-parity-audit.md): partial codex-side
                    // tool gating. Whole-server granularity — patterns
                    // matching a server (bare name or `X.*`) in disallowedTools
                    // drop the whole server; when allowedTools is set, only
                    // servers it mentions survive. Per-tool-within-server
                    // filtering is deferred to a follow-up overlay crate.
                    const startThreadMcpServers = filterMcpServersByToolGating(mcpServers, {
                        allowedTools: message.mode.allowedTools,
                        disallowedTools: message.mode.disallowedTools,
                    });
                    const startedThread = await client.startThread({
                        model: message.mode.model,
                        cwd: cwdAtStart,
                        approvalPolicy: executionPolicy.approvalPolicy,
                        sandbox: executionPolicy.sandbox,
                        mcpServers: startThreadMcpServers,
                        projectDocFallback,
                        baseInstructions: message.mode.customSystemPrompt,
                        developerInstructions: message.mode.appendSystemPrompt,
                    });
                    session.updateMetadata((currentMetadata) => ({
                        ...currentMetadata,
                        codexThreadId: startedThread.threadId,
                    }));
                }

                const turnPrompt = first
                    ? message.message + '\n\n' + CHANGE_TITLE_INSTRUCTION
                    : message.message;

                const result = await client.sendTurnAndWait(turnPrompt, {
                    model: message.mode.model,
                    effort: message.mode.thinkingLevel,
                    approvalPolicy: executionPolicy.approvalPolicy,
                    sandbox: executionPolicy.sandbox,
                });
                first = false;

                if (result.aborted) {
                    // Turn was aborted (user abort or permission cancel).
                    // UI handling already done by the event handler (turn_aborted).
                    logger.debug('[Codex] Turn aborted');
                }
            } catch (error) {
                // Only actual errors reach here (process crash, connection failure, etc.)
                logger.warn('Error in codex session:', error);
                messageBuffer.addMessage('Process exited unexpectedly', 'status');
                sendSessionEventIfOpen({ type: 'message', message: 'Process exited unexpectedly' });
            } finally {
                // Reset permission handler, reasoning processor, and diff processor
                permissionHandler.reset();
                reasoningProcessor.abort();  // Use abort to properly finish any in-progress tool calls
                diffProcessor.reset();
                thinking = false;
                keepAliveIfOpen();
                emitReadyIfIdle({
                    pending,
                    queueSize: () => messageQueue.size(),
                    shouldExit,
                    sendReady,
                    notify: () => {
                        if (!ledgerRunId) return;
                        appendSessionLedgerRecord({
                            runId: ledgerRunId,
                            sessionId: ledgerSessionId,
                            timestamp: new Date().toISOString(),
                            eventType: 'idle-reached',
                            queueDepth: messageQueue.size(),
                        });
                    },
                });
                logActiveHandles('after-turn');
            }
        }

    } finally {
        // Clean up resources when main loop exits
        logger.debug('[codex]: Final cleanup start');
        logActiveHandles('cleanup-start');

        // Cancel offline reconnection if still running
        if (reconnectionHandle) {
            logger.debug('[codex]: Cancelling offline reconnection');
            reconnectionHandle.cancel();
        }

        try {
            logger.debug('[codex]: sendSessionDeath');
            session.sendSessionDeath();
            logger.debug('[codex]: flush begin');
            await session.flush();
            logger.debug('[codex]: flush done');
            logger.debug('[codex]: session.close begin');
            await session.close();
            logger.debug('[codex]: session.close done');
        } catch (e) {
            logger.debug('[codex]: Error while closing session', e);
        }
        logger.debug('[codex]: client.disconnect begin');
        await client.disconnect();
        logger.debug('[codex]: client.disconnect done');
        // Stop Happy MCP server
        logger.debug('[codex]: happyServer.stop');
        happyServer.stop();

        // Clean up ink UI
        if (process.stdin.isTTY) {
            logger.debug('[codex]: setRawMode(false)');
            try { process.stdin.setRawMode(false); } catch { }
        }
        // Stop reading from stdin so the process can exit
        if (hasTTY) {
            logger.debug('[codex]: stdin.pause()');
            try { process.stdin.pause(); } catch { }
        }
        // Clear periodic keep-alive to avoid keeping event loop alive
        logger.debug('[codex]: clearInterval(keepAlive)');
        clearInterval(keepAliveInterval);
        if (inkInstance) {
            logger.debug('[codex]: inkInstance.unmount()');
            inkInstance.unmount();
        }
        messageBuffer.clear();

        logActiveHandles('cleanup-end');
        logger.debug('[codex]: Final cleanup completed');
    }
}
