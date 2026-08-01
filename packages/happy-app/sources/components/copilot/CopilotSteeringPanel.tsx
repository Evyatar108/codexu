/**
 * T6 Copilot steering panel — phone-side lease UX + prompt-answer composer.
 *
 * Rendered in place of the composer for `flavor: 'copilot'` sessions. It stays
 * fully static for the e-ink target: no animations, no ticking countdowns, no
 * polling-driven updates. State transitions re-render once.
 *
 * Scope (v1): answer-prompts only. Deliberately absent — send-text, abort,
 * session/foreground switch — those are hidden, not merely disabled.
 *
 * Destructive prompts render observe-only keyed strictly off the `destructive`
 * flag computed by the plumbing layer, never off hardcoded permission kinds.
 */

import * as React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';

import { t } from '@/text';
import type { CopilotPromptEntry } from '@/sync/reducer/reducer';

import {
    useCopilotSteeringController,
    type CopilotSteeringController,
    type PromptSendState,
} from './useCopilotSteeringController';
import type { OutcomeCopy, SteeringRevocationReason } from './copilotSteeringMachine';

function formatClockTime(epochMs: number): string {
    const date = new Date(epochMs);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Extract a short human-readable line from a prompt payload for display. Purely
 * best-effort — the payload shape is fork-defined and may drift, so this only
 * surfaces well-known string fields and never throws.
 */
function promptDisplayText(prompt: CopilotPromptEntry): string | null {
    const payload = prompt.payload;
    if (!payload) {
        return null;
    }
    for (const key of ['question', 'message', 'prompt', 'text', 'title', 'summary']) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    const request = payload.promptRequest ?? payload.permissionRequest;
    if (request && typeof request === 'object' && !Array.isArray(request)) {
        const record = request as Record<string, unknown>;
        const tool = record.toolName ?? record.name;
        if (typeof tool === 'string' && tool.trim().length > 0) {
            return tool.trim();
        }
        if (typeof record.kind === 'string' && record.kind.trim().length > 0) {
            return record.kind.trim();
        }
    }
    return null;
}

function promptTitle(promptType: CopilotPromptEntry['promptType']): string {
    switch (promptType) {
        case 'answer-permission':
            return t('copilotSteering.permissionTitle');
        case 'answer-elicitation':
            return t('copilotSteering.elicitationTitle');
        case 'answer-plan':
            return t('copilotSteering.planTitle');
        case 'answer-ask-user':
            return t('copilotSteering.askUserTitle');
    }
}

function revokedText(reason: SteeringRevocationReason | null): string {
    switch (reason) {
        case 'keystroke':
            return t('copilotSteering.revokedKeystroke');
        case 'expired':
            return t('copilotSteering.revokedExpired');
        case 'superseded':
            return t('copilotSteering.revokedSuperseded');
        case 'released':
            return t('copilotSteering.revokedReleased');
        case 'detached':
            return t('copilotSteering.revokedDetached');
        default:
            return t('copilotSteering.revokedEnded');
    }
}

function outcomeText(copy: OutcomeCopy): string {
    switch (copy.code) {
        case 'applied':
            return t('copilotSteering.outcomeApplied');
        case 'duplicate':
            return t('copilotSteering.outcomeDuplicate');
        case 'already_resolved':
            return t('copilotSteering.outcomeAlreadyResolved');
        case 'out_of_scope':
            return t('copilotSteering.outcomeOutOfScope');
        case 'destructive_kind':
            return t('copilotSteering.outcomeDestructive');
        case 'no_lease':
            return t('copilotSteering.outcomeNoLease');
        case 'not_pending':
            return t('copilotSteering.outcomeNotPending');
        case 'rate_limited':
            return t('copilotSteering.outcomeRateLimited');
        case 'rate_limited_retry':
            return t('copilotSteering.outcomeRateLimitedRetry', { seconds: copy.retrySeconds });
        case 'transport_failed':
            return t('copilotSteering.outcomeTransportFailed');
    }
}

// --- Reusable tappable button (e-ink-safe: 2px border + hard left accent) ----

function SteeringButton(props: {
    label: string;
    icon?: React.ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    disabled?: boolean;
    variant?: 'default' | 'primary' | 'danger';
}) {
    const { label, icon, onPress, disabled, variant = 'default' } = props;
    return (
        <Pressable
            onPress={disabled ? undefined : onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.button}
        >
            {icon ? <Ionicons name={icon} size={16} style={styles.buttonIcon} /> : null}
            <Text style={[styles.buttonLabel, disabled && styles.buttonLabelDisabled]}>{label}</Text>
            <View style={[styles.buttonAccent, variant === 'danger' && styles.buttonAccentDanger, variant === 'primary' && styles.buttonAccentPrimary]} />
        </Pressable>
    );
}

// --- Lease status row --------------------------------------------------------

function SteeringStatusRow({ controller }: { controller: CopilotSteeringController }) {
    const { view, leaseBusy, requestLease, releaseLease } = controller;

    let statusText: string;
    if (view.mode === 'holding') {
        statusText = view.expiresAt !== null
            ? t('copilotSteering.steeringActiveUntil', { time: formatClockTime(view.expiresAt) })
            : t('copilotSteering.steeringActive');
    } else if (view.mode === 'requesting') {
        statusText = t('copilotSteering.requesting');
    } else if (view.mode === 'conflict') {
        statusText = view.conflictKind === 'requested'
            ? t('copilotSteering.anotherClientRequesting')
            : t('copilotSteering.anotherClientSteering');
    } else if (view.mode === 'revoked') {
        statusText = revokedText(view.revokedReason);
    } else {
        statusText = t('copilotSteering.statusObserving');
    }

    const icon: React.ComponentProps<typeof Ionicons>['name'] = view.mode === 'holding'
        ? 'radio-button-on'
        : view.mode === 'conflict'
            ? 'lock-closed-outline'
            : 'eye-outline';

    return (
        <View style={styles.statusRow}>
            <View style={styles.statusTextColumn}>
                <View style={styles.statusHeadline}>
                    <Ionicons name={icon} size={16} style={styles.statusIcon} />
                    <Text style={styles.statusText}>{statusText}</Text>
                </View>
                {view.mode === 'revoked' ? (
                    <Text style={styles.statusHint}>{t('copilotSteering.reRequestHint')}</Text>
                ) : null}
            </View>
            <View style={styles.statusActions}>
                {view.mode === 'holding' ? (
                    <SteeringButton
                        label={leaseBusy ? t('copilotSteering.releasing') : t('copilotSteering.release')}
                        icon="hand-left-outline"
                        onPress={releaseLease}
                        disabled={leaseBusy}
                    />
                ) : view.canRequest ? (
                    <SteeringButton
                        label={t('copilotSteering.requestSteering')}
                        icon="hand-right-outline"
                        onPress={requestLease}
                        disabled={leaseBusy}
                        variant="primary"
                    />
                ) : null}
            </View>
        </View>
    );
}

// --- Send-status footer ------------------------------------------------------

function PromptSendFooter({ send }: { send: PromptSendState | undefined }) {
    if (!send) {
        return null;
    }
    if (send.status === 'sending') {
        return <Text style={styles.sendingText}>{t('copilotSteering.sending')}</Text>;
    }
    if (!send.copy) {
        return null;
    }
    return (
        <Text style={[styles.outcomeText, send.copy.kind === 'error' ? styles.outcomeError : styles.outcomeSuccess]}>
            {outcomeText(send.copy)}
        </Text>
    );
}

// --- Per-type answer affordances --------------------------------------------

function PermissionAnswer({ prompt, controller, disabled }: { prompt: CopilotPromptEntry; controller: CopilotSteeringController; disabled: boolean }) {
    return (
        <View style={styles.buttonRow}>
            <SteeringButton
                label={t('copilotSteering.approve')}
                icon="checkmark-outline"
                disabled={disabled}
                variant="primary"
                onPress={() => controller.answer(prompt, 'answer-permission', { decision: 'approve', scope: 'once' })}
            />
            <SteeringButton
                label={t('copilotSteering.deny')}
                icon="close-outline"
                disabled={disabled}
                variant="danger"
                onPress={() => controller.answer(prompt, 'answer-permission', { decision: 'deny' })}
            />
        </View>
    );
}

function ElicitationAnswer({ prompt, controller, disabled }: { prompt: CopilotPromptEntry; controller: CopilotSteeringController; disabled: boolean }) {
    return (
        <View style={styles.buttonRow}>
            <SteeringButton
                label={t('copilotSteering.accept')}
                icon="checkmark-outline"
                disabled={disabled}
                variant="primary"
                onPress={() => controller.answer(prompt, 'answer-elicitation', { action: 'accept' })}
            />
            <SteeringButton
                label={t('copilotSteering.decline')}
                icon="remove-outline"
                disabled={disabled}
                onPress={() => controller.answer(prompt, 'answer-elicitation', { action: 'decline' })}
            />
            <SteeringButton
                label={t('common.cancel')}
                icon="close-outline"
                disabled={disabled}
                variant="danger"
                onPress={() => controller.answer(prompt, 'answer-elicitation', { action: 'cancel' })}
            />
        </View>
    );
}

function PlanAnswer({ prompt, controller, disabled }: { prompt: CopilotPromptEntry; controller: CopilotSteeringController; disabled: boolean }) {
    const [feedback, setFeedback] = React.useState('');
    const trimmed = feedback.trim();
    return (
        <View>
            <TextInput
                style={styles.textInput}
                value={feedback}
                onChangeText={setFeedback}
                placeholder={t('copilotSteering.planFeedbackPlaceholder')}
                placeholderTextColor={styles.placeholder.color}
                multiline
                editable={!disabled}
            />
            <View style={styles.buttonRow}>
                <SteeringButton
                    label={t('copilotSteering.planApprove')}
                    icon="checkmark-outline"
                    disabled={disabled}
                    variant="primary"
                    onPress={() => controller.answer(prompt, 'answer-plan', { approved: true })}
                />
                <SteeringButton
                    label={t('copilotSteering.planReject')}
                    icon="close-outline"
                    disabled={disabled}
                    variant="danger"
                    onPress={() => controller.answer(
                        prompt,
                        'answer-plan',
                        trimmed.length > 0 ? { approved: false, feedback: trimmed } : { approved: false },
                    )}
                />
            </View>
        </View>
    );
}

function AskUserAnswer({ prompt, controller, disabled }: { prompt: CopilotPromptEntry; controller: CopilotSteeringController; disabled: boolean }) {
    const [answer, setAnswer] = React.useState('');
    const trimmed = answer.trim();
    return (
        <View>
            <TextInput
                style={styles.textInput}
                value={answer}
                onChangeText={setAnswer}
                placeholder={t('copilotSteering.askUserPlaceholder')}
                placeholderTextColor={styles.placeholder.color}
                multiline
                editable={!disabled}
            />
            <View style={styles.buttonRow}>
                <SteeringButton
                    label={t('copilotSteering.send')}
                    icon="send-outline"
                    disabled={disabled || trimmed.length === 0}
                    variant="primary"
                    onPress={() => controller.answer(prompt, 'answer-ask-user', { answer: trimmed, wasFreeform: true })}
                />
                <SteeringButton
                    label={t('copilotSteering.dismiss')}
                    icon="close-outline"
                    disabled={disabled}
                    onPress={() => controller.answer(prompt, 'answer-ask-user', { answer: '', dismissed: true })}
                />
            </View>
        </View>
    );
}

function PromptAnswerBody({ prompt, controller }: { prompt: CopilotPromptEntry; controller: CopilotSteeringController }) {
    const send = controller.sendStateByRequestId[prompt.requestId];
    const disabled = send?.status === 'sending';
    switch (prompt.promptType) {
        case 'answer-permission':
            return <PermissionAnswer prompt={prompt} controller={controller} disabled={disabled} />;
        case 'answer-elicitation':
            return <ElicitationAnswer prompt={prompt} controller={controller} disabled={disabled} />;
        case 'answer-plan':
            return <PlanAnswer prompt={prompt} controller={controller} disabled={disabled} />;
        case 'answer-ask-user':
            return <AskUserAnswer prompt={prompt} controller={controller} disabled={disabled} />;
    }
}

// --- Prompt card -------------------------------------------------------------

function SteeringPromptCard({ prompt, controller }: { prompt: CopilotPromptEntry; controller: CopilotSteeringController }) {
    const displayText = promptDisplayText(prompt);
    const canAnswer = controller.view.canAnswer;

    let body: React.ReactNode;
    if (prompt.destructive) {
        // Observe-only keyed strictly off the destructive flag.
        body = <Text style={styles.observeOnlyText}>{t('copilotSteering.observeOnlyDestructive')}</Text>;
    } else if (!canAnswer) {
        body = <Text style={styles.observeOnlyText}>{t('copilotSteering.observeOnlyNoLease')}</Text>;
    } else {
        body = <PromptAnswerBody prompt={prompt} controller={controller} />;
    }

    return (
        <View style={[styles.card, prompt.destructive && styles.cardDestructive]}>
            <View style={styles.cardHeader}>
                <Ionicons
                    name={prompt.destructive ? 'warning-outline' : 'help-circle-outline'}
                    size={16}
                    style={styles.cardHeaderIcon}
                />
                <Text style={styles.cardTitle}>{promptTitle(prompt.promptType)}</Text>
            </View>
            {displayText ? <Text style={styles.cardMessage}>{displayText}</Text> : null}
            {body}
            <PromptSendFooter send={controller.sendStateByRequestId[prompt.requestId]} />
        </View>
    );
}

// --- Resolved attribution ----------------------------------------------------

function ResolvedAttribution({ controller }: { controller: CopilotSteeringController }) {
    return (
        <View style={styles.attribution}>
            {controller.resolvedPrompts.map((prompt) => (
                <View key={prompt.requestId} style={styles.attributionRow}>
                    <Ionicons name="checkmark-done-outline" size={13} style={styles.attributionIcon} />
                    <Text style={styles.attributionText}>
                        {promptTitle(prompt.promptType)}
                        {' · '}
                        {controller.isAnsweredHere(prompt.requestId)
                            ? t('copilotSteering.answeredHere')
                            : t('copilotSteering.answeredElsewhere')}
                    </Text>
                </View>
            ))}
        </View>
    );
}

// --- Panel -------------------------------------------------------------------

export const CopilotSteeringPanel = React.memo(({ sessionId }: { sessionId: string }) => {
    const controller = useCopilotSteeringController(sessionId);
    const { pendingPrompts, resolvedPrompts, view } = controller;

    return (
        <View style={styles.container}>
            <SteeringStatusRow controller={controller} />
            {pendingPrompts.map((prompt) => (
                <SteeringPromptCard key={prompt.requestId} prompt={prompt} controller={controller} />
            ))}
            {view.mode === 'holding' && pendingPrompts.length === 0 ? (
                <Text style={styles.emptyText}>{t('copilotSteering.noPendingPrompts')}</Text>
            ) : null}
            {resolvedPrompts.length > 0 ? <ResolvedAttribution controller={controller} /> : null}
        </View>
    );
});

CopilotSteeringPanel.displayName = 'CopilotSteeringPanel';

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
        gap: 8,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    statusTextColumn: {
        flexShrink: 1,
        gap: 2,
    },
    statusHeadline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusIcon: {
        color: theme.colors.text,
    },
    statusText: {
        flexShrink: 1,
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '600',
    },
    statusHint: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    statusActions: {
        flexDirection: 'row',
        gap: 8,
    },
    button: {
        position: 'relative',
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        backgroundColor: theme.colors.userMessageBackground,
    },
    buttonIcon: {
        color: theme.colors.text,
    },
    buttonLabel: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: '600',
    },
    buttonLabelDisabled: {
        color: theme.colors.textSecondary,
    },
    buttonAccent: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        backgroundColor: theme.colors.text,
    },
    buttonAccentPrimary: {
        backgroundColor: theme.colors.success,
    },
    buttonAccentDanger: {
        backgroundColor: theme.colors.textDestructive,
    },
    buttonRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    card: {
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        backgroundColor: theme.colors.userMessageBackground,
        padding: 12,
        gap: 4,
    },
    cardDestructive: {
        borderColor: theme.colors.textDestructive,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    cardHeaderIcon: {
        color: theme.colors.text,
    },
    cardTitle: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: '700',
    },
    cardMessage: {
        color: theme.colors.text,
        fontSize: 13,
    },
    observeOnlyText: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontStyle: 'italic',
        marginTop: 4,
    },
    textInput: {
        marginTop: 8,
        minHeight: 40,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        backgroundColor: theme.colors.surface,
        color: theme.colors.text,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
        textAlignVertical: 'top',
    },
    placeholder: {
        color: theme.colors.textSecondary,
    },
    sendingText: {
        marginTop: 6,
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    outcomeText: {
        marginTop: 6,
        fontSize: 12,
        fontWeight: '600',
    },
    outcomeSuccess: {
        color: theme.colors.text,
    },
    outcomeError: {
        color: theme.colors.textDestructive,
    },
    emptyText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    attribution: {
        gap: 2,
        marginTop: 2,
    },
    attributionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    attributionIcon: {
        color: theme.colors.textSecondary,
    },
    attributionText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
}));
