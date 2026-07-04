import { onCodexRun } from '@/fork/onCodexRun';

// FORK PATCH: RESTORE-R4-done fork codex agent-loop wiring relocated to fork/onCodexRun.onCodexRun; this file is now a thin upstream-shaped seam (invariant HC-4)
export function runCodex(opts: Parameters<typeof onCodexRun>[0]): Promise<void> {
    return onCodexRun(opts);
}
