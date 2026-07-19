import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import {
    findOptionByKey,
    getAvailableModels,
    getAvailablePermissionModes,
    getDefaultEffortKeyForModel,
    getEffortLevelsForModel,
    resolveCurrentOption,
    resolvePermissionModeForPicker,
    type AgentFlavor,
    type EffortLevel,
    type ModelMode,
    type PermissionMode,
} from '@/components/modelModeOptions';
import { PickerContent, type PickerItem } from '@/components/pickers';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { parseCompositeSessionId } from '@/sync/machineSessionId';
import { machineSpawnSessionFromSession, type SupportedAgent } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { useAllMachines, useSession, isCopilotSession, isPlaceholderSession } from '@/sync/storage';
import type { Machine, Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { formatPathRelativeToHome, getSessionName } from '@/utils/sessionUtils';

type PickerType = 'agent' | 'model' | 'permission' | 'effort';

const ALL_AGENTS: SupportedAgent[] = ['claude', 'codex', 'openclaw', 'gemini'];

function getMachineName(machine: Machine | null): string {
    return machine?.metadata?.displayName || machine?.metadata?.host || t('status.unknown');
}

function optionItems(options: Array<ModelMode | PermissionMode | EffortLevel>): PickerItem[] {
    return options.map((option) => ({
        key: option.key,
        label: option.name,
        subtitle: option.description ?? undefined,
    }));
}

function resolveMachine(sessionId: string, session: Session | null, machines: Machine[]): { machineId: string; machine: Machine | null } {
    const fallbackMachineId = session?.metadata?.machineId ?? '';
    const { machineId } = parseCompositeSessionId(sessionId, fallbackMachineId);
    return {
        machineId,
        machine: machines.find((candidate) => candidate.id === machineId) ?? null,
    };
}

function getAgentLabel(agent: SupportedAgent): string {
    switch (agent) {
        case 'claude':
            return t('spawnChild.agents.claude');
        case 'codex':
            return t('spawnChild.agents.codex');
        case 'openclaw':
            return t('spawnChild.agents.openclaw');
        case 'gemini':
            return t('spawnChild.agents.gemini');
    }
}

function getAvailableAgents(machine: Machine | null): SupportedAgent[] {
    const availability = machine?.metadata?.cliAvailability;
    if (!availability) {
        return ALL_AGENTS;
    }
    const agents = ALL_AGENTS.filter((agent) => availability[agent]);
    return agents.length > 0 ? agents : ALL_AGENTS;
}

function getInitialAgent(session: Session | null, machine: Machine | null): SupportedAgent {
    const availableAgents = getAvailableAgents(machine);
    const flavor = session?.metadata?.flavor;
    if (flavor && availableAgents.includes(flavor as SupportedAgent)) {
        return flavor as SupportedAgent;
    }
    return availableAgents.includes('codex') ? 'codex' : availableAgents[0] ?? 'codex';
}

export function SpawnChildScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string | string[] }>();
    const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
    const session = useSession(sessionId ?? '');
    const machines = useAllMachines({ includeOffline: true });
    const { machineId, machine } = React.useMemo(
        () => resolveMachine(sessionId ?? '', session, machines),
        [machines, session, sessionId],
    );

    const parentPath = session?.metadata?.path ?? '';
    const homeDir = machine?.metadata?.homeDir;
    const parentLabel = session ? getSessionName(session) : '';
    const [selectedAgent, setSelectedAgent] = React.useState<SupportedAgent>(() => getInitialAgent(session, machine));
    const [selectedModelKey, setSelectedModelKey] = React.useState<string | null>(null);
    const [selectedPermissionKey, setSelectedPermissionKey] = React.useState<string | null>(null);
    const [selectedEffortKey, setSelectedEffortKey] = React.useState<string | null>(null);
    const [activePicker, setActivePicker] = React.useState<PickerType | null>(null);
    const [initialMessage, setInitialMessage] = React.useState('');
    const [isSpawning, setIsSpawning] = React.useState(false);

    const availableAgents = React.useMemo(() => getAvailableAgents(machine), [machine]);
    React.useEffect(() => {
        if (!availableAgents.includes(selectedAgent)) {
            setSelectedAgent(availableAgents[0] ?? 'codex');
            setSelectedModelKey(null);
            setSelectedPermissionKey(null);
            setSelectedEffortKey(null);
        }
    }, [availableAgents, selectedAgent]);

    const modelOptions = React.useMemo(() => getAvailableModels(selectedAgent, session?.metadata, t), [selectedAgent, session?.metadata]);
    const currentModel = React.useMemo(() => {
        return resolveCurrentOption(modelOptions, [
            selectedModelKey,
            selectedAgent === session?.metadata?.flavor ? session?.modelMode : undefined,
            selectedAgent === session?.metadata?.flavor ? session?.metadata?.currentModelCode : undefined,
            'default',
        ]) ?? modelOptions[0] ?? null;
    }, [modelOptions, selectedAgent, selectedModelKey, session?.metadata?.currentModelCode, session?.metadata?.flavor, session?.modelMode]);

    const permissionOptions = React.useMemo(() => getAvailablePermissionModes(selectedAgent, session?.metadata, t), [selectedAgent, session?.metadata]);
    const currentPermission = React.useMemo(() => {
        return findOptionByKey(permissionOptions, selectedPermissionKey) ?? resolvePermissionModeForPicker(permissionOptions, {
            userChosen: selectedAgent === session?.metadata?.flavor ? session?.permissionModeUserChosen ?? false : false,
            sessionPermissionMode: selectedAgent === session?.metadata?.flavor ? session?.permissionMode : undefined,
            metadataCurrentPermissionModeCode: selectedAgent === session?.metadata?.flavor ? session?.metadata?.currentPermissionModeCode : undefined,
            metadataDangerouslySkipPermissions: selectedAgent === session?.metadata?.flavor ? session?.metadata?.dangerouslySkipPermissions : undefined,
            flavor: selectedAgent as AgentFlavor,
        }) ?? permissionOptions[0] ?? null;
    }, [permissionOptions, selectedAgent, selectedPermissionKey, session?.metadata?.currentPermissionModeCode, session?.metadata?.dangerouslySkipPermissions, session?.metadata?.flavor, session?.permissionMode, session?.permissionModeUserChosen]);

    const effortOptions = React.useMemo(() => getEffortLevelsForModel(selectedAgent, currentModel?.key ?? 'default'), [currentModel?.key, selectedAgent]);
    const currentEffort = React.useMemo(() => {
        return resolveCurrentOption(effortOptions, [
            selectedEffortKey,
            selectedAgent === session?.metadata?.flavor ? session?.effortLevel : undefined,
            selectedAgent === session?.metadata?.flavor ? session?.metadata?.currentThoughtLevelCode : undefined,
            getDefaultEffortKeyForModel(selectedAgent, currentModel?.key ?? 'default'),
        ]) ?? effortOptions[0] ?? null;
    }, [currentModel?.key, effortOptions, selectedAgent, selectedEffortKey, session?.effortLevel, session?.metadata?.currentThoughtLevelCode, session?.metadata?.flavor]);

    const pickerData = React.useMemo(() => {
        switch (activePicker) {
            case 'agent':
                return {
                    title: t('spawnChild.agent'),
                    items: availableAgents.map((agent) => ({ key: agent, label: getAgentLabel(agent) })),
                    selectedKey: selectedAgent,
                    searchPlaceholder: t('spawnChild.searchAgents'),
                };
            case 'model':
                return { title: t('agentInput.model.title'), items: optionItems(modelOptions), selectedKey: currentModel?.key ?? null, searchPlaceholder: t('spawnChild.searchModels') };
            case 'permission':
                return { title: t('agentInput.permissionMode.title'), items: optionItems(permissionOptions), selectedKey: currentPermission?.key ?? null, searchPlaceholder: t('spawnChild.searchPermissions') };
            case 'effort':
                return { title: t('agentInput.effort.title'), items: optionItems(effortOptions), selectedKey: currentEffort?.key ?? null, searchPlaceholder: t('spawnChild.searchEffort') };
            default:
                return null;
        }
    }, [activePicker, availableAgents, currentEffort?.key, currentModel?.key, currentPermission?.key, effortOptions, modelOptions, permissionOptions, selectedAgent]);

    const handlePickerSelect = React.useCallback((key: string) => {
        switch (activePicker) {
            case 'agent':
                setSelectedAgent(key as SupportedAgent);
                setSelectedModelKey(null);
                setSelectedPermissionKey(null);
                setSelectedEffortKey(null);
                break;
            case 'model':
                setSelectedModelKey(key);
                setSelectedEffortKey(null);
                break;
            case 'permission':
                setSelectedPermissionKey(key);
                break;
            case 'effort':
                setSelectedEffortKey(key);
                break;
        }
        setActivePicker(null);
    }, [activePicker]);

    const handleSubmit = React.useCallback(async () => {
        if (!sessionId || !session || !machineId || !parentPath) {
            Modal.alert(t('common.error'), t('spawnChild.errors.parentMissing'));
            return;
        }

        const trimmedInitialMessage = initialMessage.trim();
        setIsSpawning(true);
        try {
            const result = await machineSpawnSessionFromSession(sessionId, {
                agent: selectedAgent,
                model: currentModel?.key,
                permissionMode: currentPermission?.key,
                effortLevel: currentEffort?.key,
                initialMessage: trimmedInitialMessage.length > 0 ? trimmedInitialMessage : undefined,
            });

            switch (result.type) {
                case 'success':
                    await sync.refreshSessions();
                    if (trimmedInitialMessage.length > 0) {
                        await sync.sendMessage(result.sessionId, trimmedInitialMessage, { source: 'new_session' });
                    }
                    router.replace(`/session/${result.sessionId}` as Href);
                    break;
                case 'error':
                    Modal.alert(t('common.error'), result.errorMessage);
                    break;
                default:
                    Modal.alert(t('common.error'), t('spawnChild.errors.spawnFailed'));
                    break;
            }
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('spawnChild.errors.spawnFailed'));
        } finally {
            setIsSpawning(false);
        }
    }, [currentEffort?.key, currentModel?.key, currentPermission?.key, initialMessage, machineId, parentPath, router, selectedAgent, session, sessionId]);

    const canSubmit = !!session && !!machineId && !!parentPath && !isSpawning;
    const showModel = modelOptions.length > 1;
    const showPermission = permissionOptions.length > 1;
    const showEffort = effortOptions.length > 0;

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                <View style={styles.content}>
                    <Text style={styles.title}>{t('spawnChild.title')}</Text>

                    <View style={styles.parentPill}>
                        <Ionicons name="git-network-outline" size={16} color={theme.colors.textSecondary} />
                        <Text style={styles.parentPillText} numberOfLines={1}>{t('spawnChild.parentLabel', { name: parentLabel })}</Text>
                    </View>

                    <View style={styles.panel}>
                        <InfoRow icon="desktop-outline" label={t('spawnChild.machine')} value={getMachineName(machine)} />
                        <InfoRow icon="folder-open-outline" label={t('spawnChild.project')} value={formatPathRelativeToHome(parentPath, homeDir)} />
                        <PickerRow icon="terminal-outline" label={t('spawnChild.agent')} value={getAgentLabel(selectedAgent)} onPress={() => setActivePicker('agent')} />
                        {showModel && (
                            <PickerRow icon="cube-outline" label={t('agentInput.model.title')} value={currentModel?.name ?? t('spawnChild.defaultModel')} onPress={() => setActivePicker('model')} />
                        )}
                        {showPermission && (
                            <PickerRow icon="shield-outline" label={t('agentInput.permissionMode.title')} value={currentPermission?.name ?? t('spawnChild.defaultPermission')} onPress={() => setActivePicker('permission')} />
                        )}
                        {showEffort && (
                            <PickerRow icon="speedometer-outline" label={t('agentInput.effort.title')} value={currentEffort?.name ?? t('spawnChild.defaultEffort')} onPress={() => setActivePicker('effort')} />
                        )}
                    </View>

                    <View style={styles.messagePanel}>
                        <Text style={styles.messageLabel}>{t('spawnChild.initialMessage')}</Text>
                        <TextInput
                            multiline
                            onChangeText={setInitialMessage}
                            placeholder={t('spawnChild.initialMessagePlaceholder')}
                            placeholderTextColor={theme.colors.textSecondary}
                            style={styles.messageInput}
                            textAlignVertical="top"
                            value={initialMessage}
                        />
                    </View>

                    {pickerData && (
                        <View style={styles.pickerPanel}>
                            <PickerContent {...pickerData} onSelect={handlePickerSelect} autoFocusSearch={true} />
                        </View>
                    )}
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isSpawning ? t('spawnChild.spawning') : t('spawnChild.submit')}
                    disabled={!canSubmit}
                    onPress={handleSubmit}
                    style={({ pressed }) => [
                        styles.submitButton,
                        !canSubmit && styles.submitButtonDisabled,
                        pressed && styles.submitButtonPressed,
                    ]}
                >
                    {isSpawning ? (
                        <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                    ) : (
                        <>
                            <Octicons name="plus-circle" size={16} color={theme.colors.button.primary.tint} />
                            <Text style={styles.submitButtonText}>{t('spawnChild.submit')}</Text>
                        </>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

function InfoRow({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.row}>
            <Ionicons name={icon} size={16} color={theme.colors.textSecondary} />
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
        </View>
    );
}

function PickerRow({ icon, label, value, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
            <Ionicons name={icon} size={16} color={theme.colors.textSecondary} />
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.header.background,
    },
    scrollContent: {
        flexGrow: 1,
        paddingBottom: 96,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: 16,
        paddingTop: 16,
        gap: 12,
    },
    title: {
        fontSize: 24,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    },
    parentPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        gap: 8,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: theme.colors.input.background,
    },
    parentPillText: {
        flexShrink: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    panel: {
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: theme.colors.input.background,
    },
    messagePanel: {
        borderRadius: 8,
        padding: 12,
        gap: 8,
        backgroundColor: theme.colors.input.background,
    },
    messageLabel: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    messageInput: {
        minHeight: 112,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: theme.colors.text,
        backgroundColor: theme.colors.header.background,
        fontSize: 15,
        ...Typography.default(),
    },
    pickerPanel: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        overflow: 'hidden',
        backgroundColor: theme.colors.header.background,
    },
    row: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    rowPressed: {
        opacity: 0.65,
    },
    rowLabel: {
        width: 86,
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    rowValue: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 20,
        backgroundColor: theme.colors.header.background,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    submitButton: {
        maxWidth: layout.maxWidth,
        width: '100%',
        alignSelf: 'center',
        minHeight: 46,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.colors.button.primary.background,
    },
    submitButtonDisabled: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    submitButtonPressed: {
        opacity: 0.75,
    },
    submitButtonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
}));

// M1a split-gate: spawn-child is a mutation surface (machineSpawnSessionFromSession).
// Read-only Copilot mirrors and unknown placeholder sessions fail closed BEFORE
// SpawnChildScreen mounts, so no spawn/config effects run. Deep links cannot bypass
// the phone allowlist.
function SpawnChildScreenGate() {
    const params = useLocalSearchParams<{ id?: string | string[] }>();
    const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
    const session = useSession(sessionId ?? '');
    if (isCopilotSession(session) || isPlaceholderSession(session)) {
        return null;
    }
    return <SpawnChildScreen />;
}

export default React.memo(SpawnChildScreenGate);
