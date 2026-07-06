/**
 * FORK PATCH: [RESTORE-R8e] nested tool-call depth cap + step counter (invariant HA-9).
 *
 * Upstream `ToolCallBlock` has no nesting / depth handling at all — rendering
 * deeply nested Task/Agent tool trees inline is a fork feature that keeps the
 * e-ink chat readable by collapsing anything past `MAX_NESTED_CHILD_DEPTH`
 * into a single "+N more steps" summary row. Relocated here as a fork-owned
 * seam so MessageView.tsx keeps only the render wiring. Behavior is
 * byte-identical to the pre-R8 fork.
 */
import { Message } from '@/sync/typesMessage';

export const MAX_NESTED_CHILD_DEPTH = 3;

export function countNestedSteps(messages: Message[]): number {
    return messages.reduce((count, message) => {
        if (message.kind === 'tool-call') {
            return count + 1 + countNestedSteps(message.children);
        }

        return count;
    }, 0);
}
