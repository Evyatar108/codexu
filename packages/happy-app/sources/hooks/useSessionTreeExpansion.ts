import { create } from 'zustand';
import { loadSessionTreeExpanded, saveSessionTreeExpanded } from '@/sync/persistence';

interface SessionTreeExpansionState {
    expanded: Record<string, true>;
    toggle: (sid: string) => void;
    isExpanded: (sid: string) => boolean;
}

const initialExpanded = loadSessionTreeExpanded();

export const useSessionTreeExpansion = create<SessionTreeExpansionState>()((set, get) => ({
    expanded: initialExpanded,
    toggle: (sid) => {
        const next = { ...get().expanded };
        if (next[sid]) {
            delete next[sid];
        } else {
            next[sid] = true;
        }
        set({ expanded: next });
        saveSessionTreeExpanded(next);
    },
    isExpanded: (sid) => get().expanded[sid] === true,
}));

export function toggle(sid: string): void {
    useSessionTreeExpansion.getState().toggle(sid);
}

export function isExpanded(sid: string): boolean {
    return useSessionTreeExpansion.getState().isExpanded(sid);
}

export function useExpansionSnapshot(): Record<string, true> {
    return useSessionTreeExpansion((state) => state.expanded);
}
