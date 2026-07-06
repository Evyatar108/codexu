import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { MarkdownView } from "./markdown/MarkdownView";
import { t } from '@/text';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import { sync } from '@/sync/sync';
import { Option } from './markdown/MarkdownView';
import { isSkillBodyMessage } from './markdown/skillBody';
import { AnimatedText } from './StyledText';
import { useChatScaleAnimatedTextStyle } from '@/hooks/useChatFontScale';
import { BoundaryDivider } from './BoundaryDivider';
import { useLocalSetting } from '@/sync/storage';
import { parseLocalCommandMessage, isUserSlashCommandEcho } from './parseLocalCommandMessage';
// FORK PATCH: [RESTORE-R8e] happy-app fork overlay seams for MessageView (invariant HA-9).
// This file is kept close to upstream shape: the e-ink user-message band,
// attachment chips, and nested tool-call depth cap live under sources/fork/message/*,
// and the upstream goal/command chips + fork-from-message long-press are restored
// inline but gated behind the `messageCommandChips` local setting (default OFF ==
// the fork's flat e-ink behavior). See sources/fork/README.md and
// docs/happy-patch-surface.md HA-9.
import { einkMessageStyles } from '../fork/message/einkMessageStyles';
import { MessageAttachmentChips } from '../fork/message/MessageAttachmentChips';
import { MAX_NESTED_CHILD_DEPTH, countNestedSteps } from '../fork/message/nestedStepsCap';

export const MessageView = React.memo((props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  chatBodyWidth: number | undefined;
  getMessageById?: (id: string) => Message | null;
  /**
   * Long-press handler for user-text bubbles, wired by the session screen for
   * the fork-from-message flow. Only consulted when the `messageCommandChips`
   * setting is ON; until a parent provides it, fork-from-message is inert.
   * Parent wiring (ChatList/SessionView) is deferred to R8 stage 5.
   */
  onForkFromUserMessage?: (messageId: string, rewindPointId: string | undefined, messageText: string) => void;
}) => {
  const messageContentWidthStyle = React.useMemo(() => ({ maxWidth: props.chatBodyWidth }), [props.chatBodyWidth]);

  const content = (
    <View style={[styles.messageContent, messageContentWidthStyle]}>
      <RenderBlock
        message={props.message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        getMessageById={props.getMessageById}
        onForkFromUserMessage={props.onForkFromUserMessage}
      />
    </View>
  );

  // Whole-message scaling was rejected for this branch: later per-leaf animation must be the only live text scaling path.
  return (
    <View style={styles.messageContainer}>
      {content}
    </View>
  );
});

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  onForkFromUserMessage?: (messageId: string, rewindPointId: string | undefined, messageText: string) => void;
  depth?: number;
}): React.ReactElement {
  const depth = props.depth ?? 0;

  if (depth > MAX_NESTED_CHILD_DEPTH) {
    return <NestedStepsSummary count={countNestedSteps([props.message])} />;
  }

  switch (props.message.kind) {
    case 'user-text':
      return <UserTextBlock
        message={props.message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        onForkFromUserMessage={props.onForkFromUserMessage}
      />;

    case 'agent-text':
      return <AgentTextBlock message={props.message} sessionId={props.sessionId} />;

    case 'tool-call':
      return <ToolCallBlock
        message={props.message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        getMessageById={props.getMessageById}
        depth={depth}
      />;

    case 'agent-event':
      return <AgentEventBlock event={props.message.event} metadata={props.metadata} />;


    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

function UserTextBlock(props: {
  message: UserTextMessage;
  metadata: Metadata | null;
  sessionId: string;
  onForkFromUserMessage?: (messageId: string, rewindPointId: string | undefined, messageText: string) => void;
}) {
  // Hooks must run unconditionally and BEFORE any early return (skillBody guard
  // below), so keep every hook at the top of the component.
  const messageCommandChips = useLocalSetting('messageCommandChips');

  const handleOptionPress = React.useCallback((option: Option) => {
    sync.sendMessage(props.sessionId, option.title, { source: 'option' });
  }, [props.sessionId]);

  // Fork type adaptation: upstream's UserTextMessage carries `claudeUuid` /
  // `codexItemId` rewind anchors that the fork's flattened type does not have
  // yet. Until those land, fork-from-message has no per-message rewind id, so
  // it can only fork Codex sessions (which rewind by session position). The
  // handler + parent wiring are deferred to R8 stage 5.
  const rewindPointId: string | undefined = undefined;
  const canFork = Boolean(props.onForkFromUserMessage)
    && (Boolean(rewindPointId) || props.metadata?.flavor === 'codex');
  const handleLongPress = React.useCallback(() => {
    if (props.onForkFromUserMessage) {
      props.onForkFromUserMessage(props.message.id, rewindPointId, props.message.text);
    }
  }, [props.message.id, props.message.text, props.onForkFromUserMessage, rewindPointId]);

  const text = props.message.displayText || props.message.text;

  // Claude Code injects a verbatim copy of every loaded skill's SKILL.md after
  // the Skill tool_use/tool_result pair. Despite its `role:"user"` on the wire,
  // Happy's normalizer routes most variants through `AgentTextBlock`; this
  // user-text branch is kept as a defensive symmetric guard for any path that
  // surfaces the prefix here. See `isSkillBodyMessage` for the detection
  // contract and the same suppression in `AgentTextBlock`.
  if (isSkillBodyMessage(text)) {
    return null;
  }

  // DEFAULT (fork e-ink behavior): render a flat full-width band + attachment
  // chips. No goal/command chips, no fork-from-message long-press.
  if (!messageCommandChips) {
    return (
      <View style={einkMessageStyles.userMessageContainer}>
        <View style={einkMessageStyles.userMessageBubble}>
          <MarkdownView markdown={text} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
        </View>
        <MessageAttachmentChips attachmentRefs={props.message.meta?.attachmentRefs} />
      </View>
    );
  }

  // TOGGLE ON: restore upstream's slash-command/goal chip rendering +
  // fork-from-message long-press (from cli-1.1.10). This intentionally mirrors
  // upstream MessageView so the file drifts toward upstream shape. The fork's
  // composer-side pre-send intercept (usePreSendCommand/slashCommandIntercept)
  // is a separate mechanism and is untouched by this branch.

  // Claude Agent SDK emits synthetic user messages wrapped in tags like
  // <local-command-caveat>…</local-command-caveat> and
  // <command-message>…</command-message><command-name>/foo</command-name>
  // whenever a slash command runs. The user's own slash-command input is shown
  // optimistically (carries a localId); the SDK then injects the canonical
  // wrapper chip. Hide the raw echo so we don't render the command twice.
  // Gated to Claude flavor only (absent flavor == Claude).
  const isClaudeFlavor = !props.metadata?.flavor || props.metadata.flavor === 'claude';
  if (isClaudeFlavor && isUserSlashCommandEcho(props.message.text, props.message.localId != null)) {
    return null;
  }

  const parsed = parseLocalCommandMessage(props.message.displayText || props.message.text);
  if (parsed.kind === 'caveat') {
    return null;
  }
  if (parsed.kind === 'goal-confirmation') {
    return null;
  }
  if (parsed.kind === 'goal-run') {
    return (
      <View style={styles.upstreamUserMessageContainer}>
        <Pressable
          onLongPress={canFork ? handleLongPress : undefined}
          delayLongPress={400}
          style={[styles.upstreamUserMessageBubble, styles.goalMessageBubble]}
        >
          <MarkdownView markdown={parsed.goal} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
        </Pressable>
        <View style={styles.goalSentRow}>
          <Ionicons name="locate-outline" size={16} color={styles.goalSentText.color} />
          <Text style={styles.goalSentText}>{t('message.sentAsGoal')}</Text>
        </View>
      </View>
    );
  }
  if (parsed.kind === 'command-run') {
    return (
      <View style={styles.upstreamUserMessageContainer}>
        {parsed.args ? (
          <Pressable
            onLongPress={canFork ? handleLongPress : undefined}
            delayLongPress={400}
            style={[styles.upstreamUserMessageBubble, styles.commandMessageBubble]}
          >
            <MarkdownView markdown={parsed.args} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
          </Pressable>
        ) : null}
        <View style={styles.commandChip}>
          <Text style={styles.commandChipText}>/{parsed.commandName}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.upstreamUserMessageContainer}>
      <Pressable
        onLongPress={canFork ? handleLongPress : undefined}
        delayLongPress={400}
        style={styles.upstreamUserMessageBubble}
      >
        <MarkdownView markdown={parsed.text} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
      </Pressable>
    </View>
  );
}

function AgentTextBlock(props: {
  message: AgentTextMessage;
  sessionId: string;
}) {
  const handleOptionPress = React.useCallback((option: Option) => {
    sync.sendMessage(props.sessionId, option.title, { source: 'option' });
  }, [props.sessionId]);

  // Hide thinking messages
  if (props.message.isThinking) {
    return null;
  }

  // Claude Code injects the verbatim SKILL.md body after every Skill tool call.
  // Despite its `role:"user"` on the wire, Happy's normalizer routes it through
  // the agent-text path (typesRaw.ts), so we must suppress it here as well as
  // in `UserTextBlock`. See `isSkillBodyMessage` for the detection contract.
  if (isSkillBodyMessage(props.message.text)) {
    return null;
  }

  return (
    <View style={styles.agentMessageContainer}>
      <MarkdownView markdown={props.message.text} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
    </View>
  );
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
}) {
  if (props.event.type === 'switch') {
    return (
      <View style={styles.agentEventContainer}>
        <AgentEventText>{t('message.switchedToMode', { mode: props.event.mode })}</AgentEventText>
      </View>
    );
  }
  if (props.event.type === 'message') {
    return (
      <View style={styles.agentEventContainer}>
        <AgentEventText>{props.event.message}</AgentEventText>
      </View>
    );
  }
  if (props.event.type === 'limit-reached') {
    const formatTime = (timestamp: number): string => {
      try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t('message.unknownTime');
      }
    };

    return (
      <View style={styles.agentEventContainer}>
        <AgentEventText>
          {t('message.usageLimitUntil', { time: formatTime(props.event.endsAt) })}
        </AgentEventText>
      </View>
    );
  }
  if (props.event.type === 'context-boundary') {
    return <BoundaryDivider kind={props.event.kind} />;
  }
  return (
    <View style={styles.agentEventContainer}>
      <AgentEventText>{t('message.unknownEvent')}</AgentEventText>
    </View>
  );
}

function AgentEventText(props: {
  children: React.ReactNode;
}) {
  const animatedTextStyle = useChatScaleAnimatedTextStyle(14);

  return <AnimatedText style={[styles.agentEventText, animatedTextStyle]}>{props.children}</AnimatedText>;
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  depth: number;
}) {
  if (!props.message.tool) {
    return null;
  }

  const childDepth = props.depth + 1;
  const nestedStepCount = countNestedSteps(props.message.children);

  return (
    <View style={styles.toolContainer}>
      <ToolView
        tool={props.message.tool}
        metadata={props.metadata}
        messages={props.message.children}
        sessionId={props.sessionId}
        messageId={props.message.id}
      />
      {nestedStepCount > 0 && (
        <View style={styles.nestedChildren}>
          {childDepth > MAX_NESTED_CHILD_DEPTH ? (
            <NestedStepsSummary count={nestedStepCount} />
          ) : (
            props.message.children.map(child => (
              <RenderBlock
                key={child.id}
                message={child}
                metadata={props.metadata}
                sessionId={props.sessionId}
                getMessageById={props.getMessageById}
                depth={childDepth}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function NestedStepsSummary(props: { count: number }) {
  const animatedTextStyle = useChatScaleAnimatedTextStyle(13);

  return (
    <View style={styles.nestedStepsSummary}>
      <AnimatedText style={[styles.nestedStepsText, animatedTextStyle]}>
        {t('tools.taskView.moreSteps', { count: props.count })}
      </AnimatedText>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  messageContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  messageContent: {
    flexDirection: 'column',
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  // Upstream right-aligned bubble + goal/command chip styles (messageCommandChips ON).
  upstreamUserMessageContainer: {
    maxWidth: '100%',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  upstreamUserMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
    maxWidth: '100%',
  },
  goalMessageBubble: {
    marginBottom: 6,
  },
  commandMessageBubble: {
    marginBottom: 6,
  },
  goalSentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    maxWidth: '100%',
    opacity: 0.72,
  },
  goalSentText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  commandChip: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
    marginBottom: 12,
    maxWidth: '100%',
    opacity: 0.65,
  },
  commandChipText: {
    color: theme.colors.input.text,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  agentMessageContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    maxWidth: '100%',
  },
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  toolContainer: {
    marginHorizontal: 8,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  nestedChildren: {
    marginLeft: 16,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.textSecondary,
    paddingLeft: 12,
  },
  nestedStepsSummary: {
    paddingVertical: 8,
  },
  nestedStepsText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
}));
