import type { Credentials } from '@/persistence';
import { PermissionMode } from './loop';
import { onClaudeRun } from '@/fork/onClaudeRun';

/** JavaScript runtime to use for spawning Claude Code */
export type JsRuntime = 'node' | 'bun'

export interface StartOptions {
    model?: string
    permissionMode?: PermissionMode
    startingMode?: 'local' | 'remote'
    shouldStartDaemon?: boolean
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    startedBy?: 'daemon' | 'terminal'
    noSandbox?: boolean
    /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
    jsRuntime?: JsRuntime
}

// FORK PATCH: RESTORE-R4-done fork claude agent-loop wiring relocated to fork/onClaudeRun.onClaudeRun; this file is now a thin upstream-shaped seam (invariant HC-5)
export async function runClaude(credentials: Credentials, options: StartOptions = {}): Promise<void> {
    return onClaudeRun(credentials, options);
}
