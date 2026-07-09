// FORK PATCH: [MOVE-W2] fork-authored tool-view registrations (invariant HA-23).
// Relocated from sources/components/tools/views/_all.tsx.
//
// The fork authored three extra tool-view renderers (TaskOutput / TaskStop from
// the codex agent-task stream, and FileEditView which replaces upstream's
// attachment-oriented FileView) and registers them by tool name. Holding those
// registrations + re-exports in this overlay keeps the canonical _all.tsx registry
// close to upstream so future upstream tool-view additions merge cleanly. Upstream's
// `file: FileView` registry entry and the `permissionFooter` prop are deliberately
// ABSENT from the fork registry; do NOT re-add them on merge.
import { TaskOutputView } from '@/components/tools/views/TaskOutputView';
import { TaskStopView } from '@/components/tools/views/TaskStopView';
import { FileEditView } from '@/components/tools/views/FileEditView';
import type { ToolViewComponent } from '@/components/tools/views/_all';

// Fork tool-view registry entries, spread into toolViewRegistry.
export const forkToolViewRegistry: Record<string, ToolViewComponent> = {
    'file-edit': FileEditView,
    TaskOutput: TaskOutputView,
    TaskStop: TaskStopView,
};

export { TaskOutputView, TaskStopView, FileEditView };
