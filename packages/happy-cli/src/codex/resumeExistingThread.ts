import { trimIdent } from '@/utils/trimIdent';
import { synthesizeCodexTools } from './codexToolsList';
import type { ApprovalPolicy, ReasoningEffort } from './codexAppServerTypes';

type ResumedThread = {
    threadId: string;
    model: string;
    modelProvider: string;
    approvalPolicy: ApprovalPolicy;
    sandbox: unknown;
    reasoningEffort: ReasoningEffort | null;
};

type ResumeThreadClient = {
    resumeThread: (opts: {
        threadId: string;
        cwd: string;
        mcpServers: Record<string, unknown>;
        projectDocFallback?: string[];
        baseInstructions?: string;
        developerInstructions?: string;
    }) => Promise<ResumedThread>;
};

type ResumeThreadSession = {
    updateMetadata: (handler: (currentMetadata: any) => any) => void;
    sendSessionEvent: (event: { type: 'message'; message: string }) => void;
};

type ResumeThreadMessageBuffer = {
    addMessage: (message: string, type: 'status') => void;
};

export async function resumeExistingThread(opts: {
    client: ResumeThreadClient;
    session: ResumeThreadSession;
    messageBuffer: ResumeThreadMessageBuffer;
    threadId: string;
    cwd: string;
    mcpServers: Record<string, unknown>;
    projectDocFallback?: string[];
    baseInstructions?: string;
    developerInstructions?: string;
}): Promise<ResumedThread> {
    try {
        const resumedThread = await opts.client.resumeThread({
            threadId: opts.threadId,
            cwd: opts.cwd,
            mcpServers: opts.mcpServers,
            ...(opts.projectDocFallback === undefined ? {} : { projectDocFallback: opts.projectDocFallback }),
            ...(opts.baseInstructions === undefined ? {} : { baseInstructions: opts.baseInstructions }),
            ...(opts.developerInstructions === undefined ? {} : { developerInstructions: opts.developerInstructions }),
        });

        // Gap 11 + Gap 12 (codex-agent-parity-audit.md): mirror codex's
        // ResumeConversationResponse into session metadata for statusline
        // parity (Gap 11) and synthesize tools[] from the resolved
        // mcpServers + codex built-ins (Gap 12). Mirrors the first-turn
        // startThread metadata write in runCodex.ts.
        const synthesizedTools = synthesizeCodexTools(opts.mcpServers);
        opts.session.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            codexThreadId: resumedThread.threadId,
            codexSession: {
                model: resumedThread.model,
                modelProvider: resumedThread.modelProvider,
                approvalPolicy: resumedThread.approvalPolicy,
                sandbox: resumedThread.sandbox,
                reasoningEffort: resumedThread.reasoningEffort,
            },
            tools: synthesizedTools,
        }));
        opts.messageBuffer.addMessage(`Resumed thread ${trimIdent(resumedThread.threadId)}`, 'status');
        opts.session.sendSessionEvent({
            type: 'message',
            message: `Resumed Codex thread ${resumedThread.threadId}`,
        });

        return resumedThread;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to resume Codex thread ${opts.threadId}: ${reason}`);
    }
}
