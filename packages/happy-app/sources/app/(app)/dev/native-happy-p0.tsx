import * as React from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { MessageView } from '@/components/MessageView';
import { layout } from '@/components/layout';
import {
    NATIVE_HAPPY_P0_BROWSER_ORIGIN,
    NativeHappyP0ProbeController,
    type NativeHappyP0Check,
    type NativeHappyP0ExternalEvidence,
    type NativeHappyP0ViewState,
    type NativeHappyRendererVisualMeasurement,
} from '@/dev/nativeHappyP0Probe';

const INITIAL_STATE: NativeHappyP0ViewState = {
    phase: 'idle',
    statusText: 'Paste the one-use J0 invite to begin.',
    checks: [],
    rendererMessages: [],
    result: null,
};

declare global {
    interface Window {
        __nativeHappyP0Probe?: {
            confirmRustClientComplete(): void;
            setExternalEvidence(evidence: NativeHappyP0ExternalEvidence): void;
            getCompatibilityResult(): NativeHappyP0ViewState['result'];
            seedRendererForVisualCheck(): NativeHappyP0ViewState;
            recordRendererVisualEvidence(measurement: NativeHappyRendererVisualMeasurement): NativeHappyP0Check | null;
        };
    }
}

export default function NativeHappyP0Screen() {
    const [state, setState] = React.useState<NativeHappyP0ViewState>(INITIAL_STATE);
    const [invite, setInvite] = React.useState('');
    const controllerRef = React.useRef<NativeHappyP0ProbeController | null>(null);
    if (!controllerRef.current) {
        controllerRef.current = new NativeHappyP0ProbeController(setState);
    }
    const controller = controllerRef.current;

    React.useEffect(() => {
        if (Platform.OS === 'web') {
            window.__nativeHappyP0Probe = {
                confirmRustClientComplete: () => controller.confirmRustClientComplete(),
                setExternalEvidence: evidence => controller.setExternalEvidence(evidence),
                getCompatibilityResult: () => controller.getCompatibilityResult(),
                seedRendererForVisualCheck: () => controller.seedRendererForVisualCheck(),
                recordRendererVisualEvidence: measurement => controller.recordRendererVisualEvidence(measurement),
            };
        }
        return () => {
            controller.dispose();
            if (Platform.OS === 'web') {
                delete window.__nativeHappyP0Probe;
            }
        };
    }, [controller]);

    const browserOrigin = Platform.OS === 'web' ? window.location.origin : NATIVE_HAPPY_P0_BROWSER_ORIGIN;
    const running = state.phase.startsWith('running-') || state.phase === 'waiting-rust-client';
    const canRunInitial = (state.phase === 'idle' || state.phase === 'failed') && invite.trim().length > 0;
    const canConfirmRustClient = state.phase === 'waiting-rust-client';
    const canRunRestart = state.phase === 'awaiting-restart' && invite.trim().length > 0;

    const runInitial = () => {
        const token = invite.trim();
        setInvite('');
        void controller.runInitial(token, browserOrigin);
    };
    const runRestart = () => {
        const token = invite.trim();
        setInvite('');
        void controller.finishAfterRestart(token, browserOrigin);
    };

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={styles.heading}>Native Happy P0 browser proof</Text>
            <Text selectable style={styles.status} testID="native-happy-p0-status">{state.statusText}</Text>

            <TextInput
                accessibilityLabel="One-use J0 invite"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!running}
                onChangeText={setInvite}
                placeholder="One-use J0 invite"
                secureTextEntry
                style={styles.input}
                testID="native-happy-p0-invite"
                value={invite}
            />
            <View style={styles.actions}>
                <ProbeButton
                    disabled={!canRunInitial}
                    label="Run initial proof"
                    onPress={runInitial}
                    testID="native-happy-p0-run-initial"
                />
                <ProbeButton
                    disabled={!canConfirmRustClient}
                    label="Confirm Rust client completed"
                    onPress={() => controller.confirmRustClientComplete()}
                    testID="native-happy-p0-confirm-rust-client"
                />
                <ProbeButton
                    disabled={!canRunRestart}
                    label="Run restart proof"
                    onPress={runRestart}
                    testID="native-happy-p0-run-restart"
                />
                <ProbeButton
                    disabled={!state.result}
                    label="Download redacted result"
                    onPress={() => state.result && downloadResult(state.result)}
                    testID="native-happy-p0-download"
                />
                <ProbeButton
                    disabled={running}
                    label="Seed renderer visual check"
                    onPress={() => controller.seedRendererForVisualCheck()}
                    testID="native-happy-p0-seed-renderer"
                />
            </View>

            <View style={styles.panel}>
                <Text style={styles.panelHeading}>Checks</Text>
                {state.checks.length === 0 ? (
                    <Text style={styles.muted}>No checks have run.</Text>
                ) : state.checks.map(check => (
                    <View key={check.id} style={styles.checkRow}>
                        <Text style={check.status === 'PASS' ? styles.pass : styles.fail}>
                            {check.status}
                        </Text>
                        <View style={styles.checkCopy}>
                            <Text style={styles.checkLabel}>{check.label}</Text>
                            <Text selectable style={styles.checkDetail}>{check.detail}</Text>
                        </View>
                    </View>
                ))}
            </View>

            <View style={styles.panel}>
                <Text style={styles.panelHeading}>Existing renderer proof</Text>
                {state.rendererMessages.length === 0 ? (
                    <Text style={styles.muted}>Waiting for J0 snapshots.</Text>
                ) : state.rendererMessages.map(message => (
                    <MessageView
                        key={message.id}
                        message={message}
                        metadata={null}
                        sessionId="compat-session"
                        chatBodyWidth={layout.maxWidth}
                    />
                ))}
            </View>

            {state.result && (
                <View style={styles.verdict} testID="native-happy-p0-verdict">
                    <Text style={styles.panelHeading}>P0 verdict</Text>
                    <Text style={state.result.overallP0Verdict === 'GO' ? styles.pass : styles.fail}>
                        {state.result.overallP0Verdict}
                    </Text>
                    <Text style={styles.checkDetail}>Transport: {state.result.transportVerdict}</Text>
                    <Text style={styles.checkDetail}>Renderer: {state.result.rendererVerdict}</Text>
                    {state.result.stopCondition && (
                        <Text style={styles.checkDetail}>{state.result.stopCondition}</Text>
                    )}
                </View>
            )}
        </ScrollView>
    );
}

function ProbeButton(props: {
    disabled: boolean;
    label: string;
    onPress: () => void;
    testID: string;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={props.disabled}
            onPress={props.onPress}
            style={[styles.button, props.disabled && styles.buttonDisabled]}
            testID={props.testID}
        >
            <Text style={styles.buttonText}>{props.label}</Text>
        </Pressable>
    );
}

function downloadResult(result: NonNullable<NativeHappyP0ViewState['result']>): void {
    if (Platform.OS !== 'web') {
        return;
    }
    const href = URL.createObjectURL(new Blob(
        [`${JSON.stringify(result, null, 2)}\n`],
        { type: 'application/json' },
    ));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'compatibility-result.json';
    anchor.click();
    URL.revokeObjectURL(href);
}

const styles = StyleSheet.create((theme) => ({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: 920,
        alignSelf: 'center',
        padding: 20,
        gap: 14,
    },
    heading: {
        color: theme.colors.text,
        fontSize: 24,
        fontWeight: '700',
    },
    status: {
        color: theme.colors.textSecondary,
        fontSize: 15,
    },
    input: {
        minHeight: 46,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        paddingHorizontal: 12,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    button: {
        minHeight: 40,
        justifyContent: 'center',
        borderRadius: 8,
        paddingHorizontal: 14,
        backgroundColor: theme.colors.textLink,
    },
    buttonDisabled: {
        opacity: 0.4,
    },
    buttonText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    panel: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        padding: 14,
        gap: 10,
    },
    panelHeading: {
        color: theme.colors.text,
        fontSize: 18,
        fontWeight: '700',
    },
    muted: {
        color: theme.colors.textSecondary,
    },
    checkRow: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
    },
    checkCopy: {
        flex: 1,
        gap: 2,
    },
    checkLabel: {
        color: theme.colors.text,
        fontWeight: '600',
    },
    checkDetail: {
        color: theme.colors.textSecondary,
    },
    pass: {
        color: theme.colors.success,
        fontWeight: '700',
    },
    fail: {
        color: theme.colors.warningCritical,
        fontWeight: '700',
    },
    verdict: {
        borderWidth: 2,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        padding: 14,
        gap: 6,
    },
}));
