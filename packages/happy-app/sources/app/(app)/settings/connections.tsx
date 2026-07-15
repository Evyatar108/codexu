import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Modal } from '@/modal';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useGithubConnection } from '@/hooks/useGithubConnection';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

/**
 * Optional GitHub connected service. This screen is intentionally separate from
 * pairing/auth: connecting GitHub only enriches the profile and never gates
 * pairing, daemon use, or any other setting. Static, e-ink-friendly status text
 * (no spinners) drives the loading/connecting states.
 */
export default React.memo(function ConnectionsScreen() {
    const { theme } = useUnistyles();
    const github = useGithubConnection();

    const [connecting, doConnect] = useHappyAction(async () => {
        await github.connect();
    });

    const [disconnecting, doDisconnect] = useHappyAction(async () => {
        const confirmed = await Modal.confirm(
            t('connections.disconnectConfirmTitle'),
            t('connections.disconnectConfirmMessage'),
            { cancelText: t('common.cancel'), confirmText: t('connections.disconnect'), destructive: true },
        );
        if (confirmed) {
            await github.disconnect();
        }
    });

    const [, doRetry] = useHappyAction(async () => {
        await github.reload();
    });

    const busy = connecting || disconnecting || github.busy;

    const renderGithubItem = () => {
        switch (github.status) {
            case 'loading':
                return (
                    <Item
                        title={t('connections.githubTitle')}
                        subtitle={t('common.loading')}
                        icon={<Ionicons name="logo-github" size={29} color={theme.colors.text} />}
                        showChevron={false}
                    />
                );
            case 'error':
                return (
                    <Item
                        title={t('connections.githubTitle')}
                        subtitle={t('connections.error')}
                        icon={<Ionicons name="logo-github" size={29} color={theme.colors.textDestructive} />}
                        detail={t('common.retry')}
                        onPress={doRetry}
                        showChevron={false}
                    />
                );
            case 'unavailable':
                return (
                    <Item
                        title={t('connections.githubTitle')}
                        subtitle={t('connections.unavailable')}
                        icon={<Ionicons name="logo-github" size={29} color={theme.colors.textSecondary} />}
                        showChevron={false}
                    />
                );
            case 'connected':
                return (
                    <Item
                        title={t('connections.githubTitle')}
                        subtitle={github.connectedLogin
                            ? t('connections.connectedAs', { login: github.connectedLogin })
                            : undefined}
                        icon={<Ionicons name="logo-github" size={29} color={theme.colors.status.connected} />}
                        detail={disconnecting ? t('connections.disconnecting') : t('connections.disconnect')}
                        onPress={busy ? undefined : doDisconnect}
                        showChevron={false}
                    />
                );
            case 'disconnected':
            default:
                return (
                    <Item
                        title={t('connections.githubTitle')}
                        subtitle={connecting ? t('connections.connecting') : t('connections.connect')}
                        icon={<Ionicons name="logo-github" size={29} color="#007AFF" />}
                        onPress={busy ? undefined : doConnect}
                        showChevron={false}
                    />
                );
        }
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('connections.githubTitle')}
                footer={t('connections.githubDescription')}
            >
                {renderGithubItem()}
            </ItemGroup>
        </ItemList>
    );
});
