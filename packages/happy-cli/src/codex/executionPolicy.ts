import type { ApprovalPolicy, SandboxMode } from './codexAppServerTypes';

export function resolveCodexExecutionPolicy(
    permissionMode: import('@/api/types').PermissionMode,
    sandboxManagedByHappy: boolean,
): { approvalPolicy: ApprovalPolicy; sandbox: SandboxMode } {
    if (sandboxManagedByHappy) {
        return {
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
        };
    }

    const approvalPolicy: ApprovalPolicy = (() => {
        switch (permissionMode) {
            // Codex native modes
            case 'default': return 'untrusted';                    // Ask for non-trusted commands
            case 'read-only': return 'never';                      // Never ask, read-only enforced by sandbox
            case 'safe-yolo': return 'on-failure';                 // Auto-run, ask only on failure
            case 'yolo': return 'on-failure';                      // Auto-run, ask only on failure
            // Defensive fallback for Claude-specific modes (backward compatibility)
            case 'bypassPermissions': return 'on-failure';         // Full access: map to yolo behavior
            case 'acceptEdits': return 'on-request';               // Let model decide (closest to auto-approve edits)
            // Gap 6 (codex-agent-parity-audit.md) v1 defensive mapping: 'plan' has
            // no native codex equivalent (no ExitPlanMode tool). Approximate plan
            // semantics by combining 'never' approval with 'read-only' sandbox
            // below — the agent runs without prompting but cannot write. v2 will
            // ship a `codex-plan-mode` overlay crate with a real exit_plan_mode
            // tool; until then runCodex.ts also emits a one-time UI hint so users
            // know plan mode is approximated, not native.
            case 'plan': return 'never';                           // Read-only enforced by sandbox below
            default: return 'untrusted';                           // Safe fallback
        }
    })();

    const sandbox: SandboxMode = (() => {
        switch (permissionMode) {
            // Codex native modes
            case 'default': return 'workspace-write';              // Can write in workspace
            case 'read-only': return 'read-only';                  // Read-only filesystem
            case 'safe-yolo': return 'workspace-write';            // Can write in workspace
            case 'yolo': return 'danger-full-access';              // Full system access
            // Defensive fallback for Claude-specific modes
            case 'bypassPermissions': return 'danger-full-access'; // Full access: map to yolo
            case 'acceptEdits': return 'workspace-write';          // Can edit files in workspace
            // Gap 6 v1 defensive mapping: plan mode is approximated as read-only.
            case 'plan': return 'read-only';                       // Plan: read but no writes
            default: return 'workspace-write';                     // Safe default
        }
    })();

    return { approvalPolicy, sandbox };
}
