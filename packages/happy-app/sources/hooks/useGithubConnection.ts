import * as React from 'react';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/auth/AuthContext';
import { useProfile } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { fetchGithubConnectParams, disconnectGithub } from '@/sync/githubConnection';

/**
 * State machine for the OPTIONAL, post-pairing GitHub connected service.
 *
 * - `loading`      : still fetching /v1/connect/github/params
 * - `unavailable`  : server has no GitHub OAuth app configured (enabled=false)
 * - `disconnected` : configured, but no GitHub profile connected yet
 * - `connected`    : profile.github is present
 * - `error`        : params fetch failed (retryable via reload())
 *
 * Connection status is derived from the synced profile (`profile.github`), so a
 * browser-completed callback that emits a profile update flips the UI to
 * `connected` live; `connect()`/`disconnect()` also refresh the profile so the
 * screen self-heals without a manual reload.
 */
export type GithubConnectionStatus =
    | 'loading'
    | 'unavailable'
    | 'disconnected'
    | 'connected'
    | 'error';

export interface GithubConnectionController {
    status: GithubConnectionStatus;
    connectedLogin: string | null;
    /** true while a connect/disconnect action is in flight. */
    busy: boolean;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    reload: () => Promise<void>;
}

export function useGithubConnection(): GithubConnectionController {
    const auth = useAuth();
    const profile = useProfile();
    const credentials = auth.credentials;
    const connectedLogin = profile.github?.login ?? null;

    const [enabled, setEnabled] = React.useState<boolean | null>(null);
    const [authorizeUrl, setAuthorizeUrl] = React.useState<string | null>(null);
    const [paramsError, setParamsError] = React.useState(false);
    const [busy, setBusy] = React.useState(false);

    const reload = React.useCallback(async () => {
        if (!credentials) {
            return;
        }
        try {
            setParamsError(false);
            const params = await fetchGithubConnectParams(credentials);
            setEnabled(params.enabled);
            setAuthorizeUrl(params.url ?? null);
        } catch {
            setEnabled(null);
            setAuthorizeUrl(null);
            setParamsError(true);
        }
    }, [credentials]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    const connect = React.useCallback(async () => {
        if (!authorizeUrl || busy) {
            return;
        }
        setBusy(true);
        try {
            // Resolves when the in-app browser is dismissed (native) / after the
            // tab is opened (web); refresh both profile and params afterwards so
            // the completed callback is reflected without a manual reload.
            await WebBrowser.openBrowserAsync(authorizeUrl);
            await sync.refreshProfile();
            await reload();
        } finally {
            setBusy(false);
        }
    }, [authorizeUrl, busy, reload]);

    const disconnect = React.useCallback(async () => {
        if (!credentials || busy) {
            return;
        }
        setBusy(true);
        try {
            await disconnectGithub(credentials);
            await sync.refreshProfile();
        } finally {
            setBusy(false);
        }
    }, [credentials, busy]);

    const status: GithubConnectionStatus = paramsError
        ? 'error'
        : enabled === null
            ? 'loading'
            : !enabled
                ? 'unavailable'
                : connectedLogin
                    ? 'connected'
                    : 'disconnected';

    return { status, connectedLogin, busy, connect, disconnect, reload };
}
