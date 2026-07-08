import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RUNNER_FILES = [
    {
        // NOTE: the agent-loop wiring was relocated from runClaude.ts to the
        // fork/onClaudeRun seam (HC-5); runClaude.ts is now a thin delegating shim, so the
        // publish-permission-mode wiring this test guards lives in fork/onClaudeRun.ts.
        name: 'fork/onClaudeRun.ts',
        source: readFileSync(new URL('../fork/onClaudeRun.ts', import.meta.url), 'utf8'),
    },
    {
        // NOTE: relocated from runCodex.ts to the fork/onCodexRun seam (HC-4).
        name: 'fork/onCodexRun.ts',
        source: readFileSync(new URL('../fork/onCodexRun.ts', import.meta.url), 'utf8'),
    },
];

describe('permission mode publish helper wiring', () => {
    it.each(RUNNER_FILES)('$name imports publishPermissionModeIfChanged', ({ source }) => {
        expect(source).toMatch(
            /import\s+\{[^}]*\bpublishPermissionModeIfChanged\b[^}]*\}\s+from\s+['"](?:@\/utils\/publishPermissionMode|\.\.?\/[^'"]*publishPermissionMode)['"]/,
        );
    });

    it.each(RUNNER_FILES)('$name calls publishPermissionModeIfChanged', ({ source }) => {
        expect(source).toContain('publishPermissionModeIfChanged(');
    });
});
