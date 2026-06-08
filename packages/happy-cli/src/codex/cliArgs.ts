import type { PermissionMode } from '@/api/types';
import type { ReasoningEffort } from './codexAppServerTypes';

export type CodexTransportFlag = 'stdio' | 'ws';

export const VALID_CODEX_EFFORT_LEVELS: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export const VALID_CODEX_REMOTE_PERMISSION_MODES: readonly PermissionMode[] = [
    'default',
    'read-only',
    'safe-yolo',
    'yolo',
    // Gap 6 (codex-agent-parity-audit.md) v1: accept 'plan' from the mobile UI
    // so a Claude → Codex session handoff that carries `meta.permissionMode:
    // 'plan'` is not silently dropped. The defensive mapping in
    // executionPolicy.ts coerces plan → { never approval, read-only sandbox };
    // runCodex.ts emits a one-time UI hint on first plan-mode activation so the
    // user knows ExitPlanMode is unavailable. v2 (codex-plan-mode-overlay) will
    // land an overlay crate with a real exit_plan_mode tool.
    'plan',
];

export function isValidCodexEffortLevel(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && VALID_CODEX_EFFORT_LEVELS.includes(value as ReasoningEffort);
}

export function isValidCodexRemotePermissionMode(value: unknown): value is PermissionMode {
    return typeof value === 'string' && VALID_CODEX_REMOTE_PERMISSION_MODES.includes(value as PermissionMode);
}

function parseCodexEffort(value: string): ReasoningEffort {
    const normalized = value.trim();
    if (VALID_CODEX_EFFORT_LEVELS.includes(normalized as ReasoningEffort)) {
        return normalized as ReasoningEffort;
    }
    throw new Error('Codex effort must be one of: none, minimal, low, medium, high, xhigh');
}

export function extractCodexResumeFlag(args: string[]): { resumeThreadId: string | null; args: string[] } {
    const remainingArgs: string[] = [];
    let resumeThreadId: string | null = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--resume' || arg === '-r') {
            if (resumeThreadId !== null) {
                throw new Error('Codex resume flag can only be provided once.');
            }

            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex resume requires a thread ID: happy codex --resume <thread-id>');
            }

            resumeThreadId = nextArg;
            i++;
            continue;
        }

        if (arg.startsWith('--resume=')) {
            if (resumeThreadId !== null) {
                throw new Error('Codex resume flag can only be provided once.');
            }

            const value = arg.slice('--resume='.length).trim();
            if (!value) {
                throw new Error('Codex resume requires a thread ID: happy codex --resume <thread-id>');
            }

            resumeThreadId = value;
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        resumeThreadId,
        args: remainingArgs,
    };
}

export function extractCodexEffortFlag(args: string[]): { effortLevel: ReasoningEffort | undefined; args: string[] } {
    const remainingArgs: string[] = [];
    let effortLevel: ReasoningEffort | undefined = undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--effort') {
            if (effortLevel !== undefined) {
                throw new Error('Codex effort flag can only be provided once.');
            }

            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex effort requires a value: happy codex --effort <level>');
            }

            effortLevel = parseCodexEffort(nextArg);
            i++;
            continue;
        }

        if (arg.startsWith('--effort=')) {
            if (effortLevel !== undefined) {
                throw new Error('Codex effort flag can only be provided once.');
            }

            effortLevel = parseCodexEffort(arg.slice('--effort='.length));
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        effortLevel,
        args: remainingArgs,
    };
}

export function extractCodexModelFlag(args: string[]): { model: string | undefined; args: string[] } {
    const remainingArgs: string[] = [];
    let model: string | undefined = undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--model') {
            if (model !== undefined) {
                throw new Error('Codex model flag can only be provided once.');
            }

            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex model requires a value: happy codex --model <model>');
            }

            model = nextArg;
            i++;
            continue;
        }

        if (arg.startsWith('--model=')) {
            if (model !== undefined) {
                throw new Error('Codex model flag can only be provided once.');
            }

            const value = arg.slice('--model='.length).trim();
            if (!value) {
                throw new Error('Codex model requires a value: happy codex --model <model>');
            }

            model = value;
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        model,
        args: remainingArgs,
    };
}

export function extractCodexPermissionModeFlag(args: string[]): { permissionMode: string | undefined; args: string[] } {
    const remainingArgs: string[] = [];
    let permissionMode: string | undefined = undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--permission-mode') {
            if (permissionMode !== undefined) {
                throw new Error('Codex permission-mode flag can only be provided once.');
            }

            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex permission-mode requires a value: happy codex --permission-mode <mode>');
            }

            permissionMode = nextArg;
            i++;
            continue;
        }

        if (arg.startsWith('--permission-mode=')) {
            if (permissionMode !== undefined) {
                throw new Error('Codex permission-mode flag can only be provided once.');
            }

            const value = arg.slice('--permission-mode='.length).trim();
            if (!value) {
                throw new Error('Codex permission-mode requires a value: happy codex --permission-mode <mode>');
            }

            permissionMode = value;
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        permissionMode,
        args: remainingArgs,
    };
}

export function extractCodexProjectDocFlag(args: string[]): { projectDocFallback: string[]; args: string[] } {
    const remainingArgs: string[] = [];
    const projectDocFallback: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--codex-project-doc') {
            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex project-doc requires a value: happy codex --codex-project-doc <name>');
            }

            projectDocFallback.push(nextArg);
            i++;
            continue;
        }

        if (arg.startsWith('--codex-project-doc=')) {
            const value = arg.slice('--codex-project-doc='.length).trim();
            if (!value) {
                throw new Error('Codex project-doc requires a value: happy codex --codex-project-doc <name>');
            }

            projectDocFallback.push(value);
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        projectDocFallback,
        args: remainingArgs,
    };
}

/**
 * Gap 9 (codex-agent-parity-audit.md): mirror Claude's `--claude-arg` escape
 * hatch. Collects every occurrence of `--codex-arg <value>` (or
 * `--codex-arg=<value>`) and returns them in argv order so they can be
 * appended verbatim to the spawned `codex app-server` invocation. This is
 * power-user territory — most users should stick to the structured codex
 * flags (`--effort`, `--model`, `--permission-mode`, `--codex-transport`).
 */
export function extractCodexArgFlag(args: string[]): { codexArgs: string[]; args: string[] } {
    const remainingArgs: string[] = [];
    const codexArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--codex-arg') {
            const nextArg = args[i + 1];
            if (nextArg === undefined) {
                throw new Error('Codex-arg requires a value: happy codex --codex-arg <flag>');
            }
            codexArgs.push(nextArg);
            i++;
            continue;
        }

        if (arg.startsWith('--codex-arg=')) {
            const value = arg.slice('--codex-arg='.length);
            if (value.length === 0) {
                throw new Error('Codex-arg requires a value: happy codex --codex-arg <flag>');
            }
            codexArgs.push(value);
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        codexArgs,
        args: remainingArgs,
    };
}

function parsePositiveIntegerSeconds(value: string): number {
    const normalized = value.trim();
    const parsed = Number(normalized);
    if (!/^[1-9]\d*$/.test(normalized) || !Number.isSafeInteger(parsed)) {
        throw new Error('Codex idle-timeout must be a positive integer number of seconds');
    }
    return parsed;
}

export function extractCodexIdleTimeoutFlag(args: string[]): { idleTimeoutSec: number | undefined; args: string[] } {
    const remainingArgs: string[] = [];
    let idleTimeoutSec: number | undefined = undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--idle-timeout') {
            if (idleTimeoutSec !== undefined) {
                throw new Error('Codex idle-timeout flag can only be provided once.');
            }

            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex idle-timeout requires a value: happy codex --idle-timeout <seconds>');
            }

            idleTimeoutSec = parsePositiveIntegerSeconds(nextArg);
            i++;
            continue;
        }

        if (arg.startsWith('--idle-timeout=')) {
            if (idleTimeoutSec !== undefined) {
                throw new Error('Codex idle-timeout flag can only be provided once.');
            }

            idleTimeoutSec = parsePositiveIntegerSeconds(arg.slice('--idle-timeout='.length));
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        idleTimeoutSec,
        args: remainingArgs,
    };
}

export function extractCodexTransportFlag(args: string[]): { transport: CodexTransportFlag | undefined; args: string[] } {
    const remainingArgs: string[] = [];
    let transport: CodexTransportFlag | undefined = undefined;

    const parseTransport = (value: string): CodexTransportFlag => {
        const normalized = value.trim();
        if (normalized === 'stdio' || normalized === 'ws') {
            return normalized;
        }
        throw new Error('Codex transport must be one of: stdio, ws');
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--codex-transport') {
            if (transport !== undefined) {
                throw new Error('Codex transport flag can only be provided once.');
            }

            const nextArg = args[i + 1];
            if (!nextArg || nextArg.startsWith('-')) {
                throw new Error('Codex transport requires a value: happy codex --codex-transport <stdio|ws>');
            }

            transport = parseTransport(nextArg);
            i++;
            continue;
        }

        if (arg.startsWith('--codex-transport=')) {
            if (transport !== undefined) {
                throw new Error('Codex transport flag can only be provided once.');
            }

            transport = parseTransport(arg.slice('--codex-transport='.length));
            continue;
        }

        remainingArgs.push(arg);
    }

    return {
        transport,
        args: remainingArgs,
    };
}
