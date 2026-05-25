import * as React from 'react';
import { useExpansionSnapshot } from '@/hooks/useSessionTreeExpansion';
import { useSessionListViewData, useSetting } from '@/sync/storage';
import type { SessionListViewItem, TreeSessionRowData } from '@/sync/storage';

function filterCollapsedSessionRows(rows: TreeSessionRowData[], expanded: Record<string, true>): TreeSessionRowData[] {
    const result: TreeSessionRowData[] = [];
    let skipBelowDepth: number | null = null;

    for (const row of rows) {
        if (skipBelowDepth !== null) {
            if (row.depth > skipBelowDepth) {
                continue;
            }
            skipBelowDepth = null;
        }

        result.push(row);

        if (row.hasChildren && expanded[row.id] !== true) {
            skipBelowDepth = row.depth;
        }
    }

    return result;
}

function filterVisibleSessionRows(
    rows: TreeSessionRowData[],
    expanded: Record<string, true>,
    hideInactiveSessions: boolean,
): TreeSessionRowData[] {
    const visibleRows = hideInactiveSessions ? rows.filter((row) => row.active) : rows;
    return filterCollapsedSessionRows(visibleRows, expanded);
}

export function useVisibleSessionListViewData(): SessionListViewItem[] | null {
    const data = useSessionListViewData();
    const hideInactiveSessions = useSetting('hideInactiveSessions');
    const expanded = useExpansionSnapshot();

    return React.useMemo(() => {
        if (!data) {
            return data;
        }

        const result: SessionListViewItem[] = [];
        let hasInactive = false;

        // First pass: add active sessions group and check if inactive sessions exist
        for (const item of data) {
            if (item.type === 'active-sessions') {
                if (item.sessions.some((session) => !session.active)) {
                    hasInactive = true;
                }
                result.push({
                    ...item,
                    sessions: filterVisibleSessionRows(item.sessions, expanded, hideInactiveSessions),
                });
            } else if (item.type === 'session' && !item.session.active) {
                hasInactive = true;
            }
        }

        // Insert archive toggle if there are inactive sessions
        if (hasInactive) {
            result.push({ type: 'archive-toggle', hidden: hideInactiveSessions });
        }

        // If not hiding, add all remaining items (headers, project groups, inactive sessions)
        if (!hideInactiveSessions) {
            let pendingProjectGroup: SessionListViewItem | null = null;
            let skipBelowDepth: number | null = null;

            for (const item of data) {
                if (item.type === 'active-sessions') {
                    continue; // already added
                }

                if (item.type === 'project-group') {
                    pendingProjectGroup = item;
                    continue;
                }

                if (item.type === 'session') {
                    const session = item.session;

                    if (skipBelowDepth !== null) {
                        if (session.depth > skipBelowDepth) {
                            continue;
                        }
                        skipBelowDepth = null;
                    }

                    if (pendingProjectGroup) {
                        result.push(pendingProjectGroup);
                        pendingProjectGroup = null;
                    }
                    result.push(item);

                    if (session.hasChildren && expanded[session.id] !== true) {
                        skipBelowDepth = session.depth;
                    }
                    continue;
                }

                pendingProjectGroup = null;
                skipBelowDepth = null;

                if (item.type === 'header') {
                    result.push(item);
                }
            }
        }

        return result;
    }, [data, expanded, hideInactiveSessions]);
}
