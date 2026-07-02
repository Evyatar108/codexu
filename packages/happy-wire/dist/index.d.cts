import * as z from 'zod';

declare const MessageMetaSchema: z.ZodObject<{
    sentFrom: z.ZodOptional<z.ZodString>;
    permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    displayText: z.ZodOptional<z.ZodString>;
    attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
        remotePath: z.ZodString;
        name: z.ZodString;
        size: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        name: string;
        size: number;
        remotePath: string;
    }, {
        name: string;
        size: number;
        remotePath: string;
    }>, "many">>;
    contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
    model?: string | null | undefined;
    thinkingLevel?: string | null | undefined;
    sentFrom?: string | undefined;
    fallbackModel?: string | null | undefined;
    customSystemPrompt?: string | null | undefined;
    appendSystemPrompt?: string | null | undefined;
    allowedTools?: string[] | null | undefined;
    disallowedTools?: string[] | null | undefined;
    displayText?: string | undefined;
    attachmentRefs?: {
        name: string;
        size: number;
        remotePath: string;
    }[] | undefined;
    contextBoundaryFallback?: boolean | undefined;
}, {
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
    model?: string | null | undefined;
    thinkingLevel?: string | null | undefined;
    sentFrom?: string | undefined;
    fallbackModel?: string | null | undefined;
    customSystemPrompt?: string | null | undefined;
    appendSystemPrompt?: string | null | undefined;
    allowedTools?: string[] | null | undefined;
    disallowedTools?: string[] | null | undefined;
    displayText?: string | undefined;
    attachmentRefs?: {
        name: string;
        size: number;
        remotePath: string;
    }[] | undefined;
    contextBoundaryFallback?: boolean | undefined;
}>;
type MessageMeta = z.infer<typeof MessageMetaSchema>;

declare const SessionMessageContentSchema: z.ZodObject<{
    c: z.ZodString;
    t: z.ZodLiteral<"encrypted">;
}, "strip", z.ZodTypeAny, {
    c: string;
    t: "encrypted";
}, {
    c: string;
    t: "encrypted";
}>;
type SessionMessageContent = z.infer<typeof SessionMessageContentSchema>;
declare const SessionMessageSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    content: z.ZodObject<{
        c: z.ZodString;
        t: z.ZodLiteral<"encrypted">;
    }, "strip", z.ZodTypeAny, {
        c: string;
        t: "encrypted";
    }, {
        c: string;
        t: "encrypted";
    }>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}>;
type SessionMessage = z.infer<typeof SessionMessageSchema>;

declare const SessionMessageRangeRequestSchema: z.ZodEffects<z.ZodObject<{
    requestId: z.ZodString;
    sessionId: z.ZodString;
    fromSeq: z.ZodNumber;
    toSeq: z.ZodNumber;
    limit: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    requestId: string;
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    limit: number;
}, {
    requestId: string;
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    limit: number;
}>, {
    requestId: string;
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    limit: number;
}, {
    requestId: string;
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    limit: number;
}>;
type SessionMessageRangeRequest = z.infer<typeof SessionMessageRangeRequestSchema>;
declare const SessionMessageRangeResponseSchema: z.ZodDiscriminatedUnion<"ok", [z.ZodObject<{
    ok: z.ZodLiteral<true>;
    requestId: z.ZodString;
    sessionId: z.ZodString;
    fromSeq: z.ZodNumber;
    toSeq: z.ZodNumber;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>, "many">;
    hasMore: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    requestId: string;
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    ok: true;
    messages: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }[];
    hasMore: boolean;
}, {
    requestId: string;
    sessionId: string;
    fromSeq: number;
    toSeq: number;
    ok: true;
    messages: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }[];
    hasMore: boolean;
}>, z.ZodObject<{
    ok: z.ZodLiteral<false>;
    requestId: z.ZodString;
    error: z.ZodObject<{
        code: z.ZodEnum<["session_not_found", "invalid_range", "rate_limited", "internal"]>;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: "session_not_found" | "invalid_range" | "rate_limited" | "internal";
        message: string;
    }, {
        code: "session_not_found" | "invalid_range" | "rate_limited" | "internal";
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    requestId: string;
    ok: false;
    error: {
        code: "session_not_found" | "invalid_range" | "rate_limited" | "internal";
        message: string;
    };
}, {
    requestId: string;
    ok: false;
    error: {
        code: "session_not_found" | "invalid_range" | "rate_limited" | "internal";
        message: string;
    };
}>]>;
type SessionMessageRangeResponse = z.infer<typeof SessionMessageRangeResponseSchema>;
declare const SessionProtocolMessageSchema: z.ZodObject<{
    role: z.ZodLiteral<"session">;
    content: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        time: z.ZodNumber;
        role: z.ZodUnion<[z.ZodLiteral<"user">, z.ZodLiteral<"agent">]>;
        turn: z.ZodOptional<z.ZodString>;
        subagent: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        ev: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
            t: z.ZodLiteral<"text">;
            text: z.ZodString;
            thinking: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"service">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "service";
            text: string;
        }, {
            t: "service";
            text: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-start">;
            call: z.ZodString;
            name: z.ZodString;
            title: z.ZodString;
            description: z.ZodString;
            args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            permissionRequestId: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        }, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-end">;
            call: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-end";
            call: string;
        }, {
            t: "tool-call-end";
            call: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"file">;
            ref: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            mimeType: z.ZodOptional<z.ZodString>;
            image: z.ZodOptional<z.ZodObject<{
                width: z.ZodNumber;
                height: z.ZodNumber;
                thumbhash: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                width: number;
                height: number;
                thumbhash: string;
            }, {
                width: number;
                height: number;
                thumbhash: string;
            }>>;
        }, "strip", z.ZodTypeAny, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-start">;
        }, "strip", z.ZodTypeAny, {
            t: "turn-start";
        }, {
            t: "turn-start";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"start">;
            title: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "start";
            title?: string | undefined;
        }, {
            t: "start";
            title?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-end">;
            status: z.ZodEnum<["completed", "failed", "cancelled"]>;
        }, "strip", z.ZodTypeAny, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"stop">;
        }, "strip", z.ZodTypeAny, {
            t: "stop";
        }, {
            t: "stop";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"context-boundary">;
            kind: z.ZodEnum<["clear", "compact", "autocompact", "plan-mode-enter", "plan-mode-exit", "session-fork-resume"]>;
            at: z.ZodNumber;
            triggeredBy: z.ZodEnum<["user", "agent", "system"]>;
            summaryRef: z.ZodOptional<z.ZodString>;
            forkedFromSid: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        }, {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"agent-configuration-changed">;
            permissionMode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            sandbox: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        }, {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"message-consumption">;
            messageId: z.ZodString;
            consumedAt: z.ZodNumber;
            agentFlavor: z.ZodEnum<["claude", "codex"]>;
        }, "strip", z.ZodTypeAny, {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        }, {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        }>]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }>, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    };
    role: "session";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    };
    role: "session";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}>;
type SessionProtocolMessage = z.infer<typeof SessionProtocolMessageSchema>;
declare const MessageContentSchema: z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"image">;
            ref: z.ZodString;
            mimeType: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }, {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    }, {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    }>;
    localKey: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    };
    role: "user";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
    localKey?: string | undefined;
}, {
    content: {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    };
    role: "user";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
    localKey?: string | undefined;
}>, z.ZodObject<{
    role: z.ZodLiteral<"agent">;
    content: z.ZodObject<{
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}>, z.ZodObject<{
    role: z.ZodLiteral<"session">;
    content: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        time: z.ZodNumber;
        role: z.ZodUnion<[z.ZodLiteral<"user">, z.ZodLiteral<"agent">]>;
        turn: z.ZodOptional<z.ZodString>;
        subagent: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        ev: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
            t: z.ZodLiteral<"text">;
            text: z.ZodString;
            thinking: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"service">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "service";
            text: string;
        }, {
            t: "service";
            text: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-start">;
            call: z.ZodString;
            name: z.ZodString;
            title: z.ZodString;
            description: z.ZodString;
            args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            permissionRequestId: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        }, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-end">;
            call: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-end";
            call: string;
        }, {
            t: "tool-call-end";
            call: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"file">;
            ref: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            mimeType: z.ZodOptional<z.ZodString>;
            image: z.ZodOptional<z.ZodObject<{
                width: z.ZodNumber;
                height: z.ZodNumber;
                thumbhash: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                width: number;
                height: number;
                thumbhash: string;
            }, {
                width: number;
                height: number;
                thumbhash: string;
            }>>;
        }, "strip", z.ZodTypeAny, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-start">;
        }, "strip", z.ZodTypeAny, {
            t: "turn-start";
        }, {
            t: "turn-start";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"start">;
            title: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "start";
            title?: string | undefined;
        }, {
            t: "start";
            title?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-end">;
            status: z.ZodEnum<["completed", "failed", "cancelled"]>;
        }, "strip", z.ZodTypeAny, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"stop">;
        }, "strip", z.ZodTypeAny, {
            t: "stop";
        }, {
            t: "stop";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"context-boundary">;
            kind: z.ZodEnum<["clear", "compact", "autocompact", "plan-mode-enter", "plan-mode-exit", "session-fork-resume"]>;
            at: z.ZodNumber;
            triggeredBy: z.ZodEnum<["user", "agent", "system"]>;
            summaryRef: z.ZodOptional<z.ZodString>;
            forkedFromSid: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        }, {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"agent-configuration-changed">;
            permissionMode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            sandbox: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        }, {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"message-consumption">;
            messageId: z.ZodString;
            consumedAt: z.ZodNumber;
            agentFlavor: z.ZodEnum<["claude", "codex"]>;
        }, "strip", z.ZodTypeAny, {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        }, {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        }>]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }>, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    }>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    };
    role: "session";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
            permissionRequestId?: string | undefined;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        } | {
            t: "context-boundary";
            at: number;
            kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
            triggeredBy: "user" | "agent" | "system";
            summaryRef?: string | undefined;
            forkedFromSid?: string | undefined;
        } | {
            t: "agent-configuration-changed";
            permissionMode?: string | null | undefined;
            model?: string | null | undefined;
            thinkingLevel?: string | null | undefined;
            sandbox?: string | null | undefined;
        } | {
            t: "message-consumption";
            messageId: string;
            consumedAt: number;
            agentFlavor: "claude" | "codex";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
    };
    role: "session";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}>]>;
type MessageContent = z.infer<typeof MessageContentSchema>;
declare const VersionedEncryptedValueSchema: z.ZodObject<{
    version: z.ZodNumber;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    version: number;
}, {
    value: string;
    version: number;
}>;
type VersionedEncryptedValue = z.infer<typeof VersionedEncryptedValueSchema>;
declare const VersionedNullableEncryptedValueSchema: z.ZodObject<{
    version: z.ZodNumber;
    value: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    value: string | null;
    version: number;
}, {
    value: string | null;
    version: number;
}>;
type VersionedNullableEncryptedValue = z.infer<typeof VersionedNullableEncryptedValueSchema>;
declare const UpdateNewMessageBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>;
type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>;
declare const UpdateSessionBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"update-session">;
    id: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string | null;
        version: number;
    }, {
        value: string | null;
        version: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}>;
type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>;
declare const VersionedMachineEncryptedValueSchema: z.ZodObject<{
    version: z.ZodNumber;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    version: number;
}, {
    value: string;
    version: number;
}>;
type VersionedMachineEncryptedValue = z.infer<typeof VersionedMachineEncryptedValueSchema>;
declare const UpdateMachineBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"update-machine">;
    machineId: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
    activeAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}>;
type UpdateMachineBody = z.infer<typeof UpdateMachineBodySchema>;
declare const CoreUpdateBodySchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"update-session">;
    id: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string | null;
        version: number;
    }, {
        value: string | null;
        version: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"update-machine">;
    machineId: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
    activeAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}>]>;
type CoreUpdateBody = z.infer<typeof CoreUpdateBodySchema>;
declare const CoreUpdateContainerSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    body: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
        t: z.ZodLiteral<"new-message">;
        sid: z.ZodString;
        message: z.ZodObject<{
            id: z.ZodString;
            seq: z.ZodNumber;
            localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            content: z.ZodObject<{
                c: z.ZodString;
                t: z.ZodLiteral<"encrypted">;
            }, "strip", z.ZodTypeAny, {
                c: string;
                t: "encrypted";
            }, {
                c: string;
                t: "encrypted";
            }>;
            createdAt: z.ZodNumber;
            updatedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-session">;
        id: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            value: string | null;
            version: number;
        }, {
            value: string | null;
            version: number;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-machine">;
        machineId: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        active: z.ZodOptional<z.ZodBoolean>;
        activeAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }>]>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}>;
type CoreUpdateContainer = z.infer<typeof CoreUpdateContainerSchema>;
declare const ApiMessageSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    content: z.ZodObject<{
        c: z.ZodString;
        t: z.ZodLiteral<"encrypted">;
    }, "strip", z.ZodTypeAny, {
        c: string;
        t: "encrypted";
    }, {
        c: string;
        t: "encrypted";
    }>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}>;
type ApiMessage = SessionMessage;
declare const ApiUpdateNewMessageSchema: z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>;
type ApiUpdateNewMessage = UpdateNewMessageBody;
declare const ApiUpdateSessionStateSchema: z.ZodObject<{
    t: z.ZodLiteral<"update-session">;
    id: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string | null;
        version: number;
    }, {
        value: string | null;
        version: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}>;
type ApiUpdateSessionState = UpdateSessionBody;
declare const ApiUpdateMachineStateSchema: z.ZodObject<{
    t: z.ZodLiteral<"update-machine">;
    machineId: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
    activeAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}>;
type ApiUpdateMachineState = UpdateMachineBody;
declare const UpdateBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>;
type UpdateBody = UpdateNewMessageBody;
declare const UpdateSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    body: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
        t: z.ZodLiteral<"new-message">;
        sid: z.ZodString;
        message: z.ZodObject<{
            id: z.ZodString;
            seq: z.ZodNumber;
            localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            content: z.ZodObject<{
                c: z.ZodString;
                t: z.ZodLiteral<"encrypted">;
            }, "strip", z.ZodTypeAny, {
                c: string;
                t: "encrypted";
            }, {
                c: string;
                t: "encrypted";
            }>;
            createdAt: z.ZodNumber;
            updatedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-session">;
        id: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            value: string | null;
            version: number;
        }, {
            value: string | null;
            version: number;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-machine">;
        machineId: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        active: z.ZodOptional<z.ZodBoolean>;
        activeAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }>]>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}>;
type Update = CoreUpdateContainer;

declare const UserMessageSchema: z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"image">;
            ref: z.ZodString;
            mimeType: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }, {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    }, {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    }>;
    localKey: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    };
    role: "user";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
    localKey?: string | undefined;
}, {
    content: {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    };
    role: "user";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
    localKey?: string | undefined;
}>;
type UserMessage = z.infer<typeof UserMessageSchema>;
declare const AgentMessageSchema: z.ZodObject<{
    role: z.ZodLiteral<"agent">;
    content: z.ZodObject<{
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}>;
type AgentMessage = z.infer<typeof AgentMessageSchema>;
declare const LegacyMessageContentSchema: z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodLiteral<"image">;
            ref: z.ZodString;
            mimeType: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }, {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    }, {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    }>;
    localKey: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    };
    role: "user";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
    localKey?: string | undefined;
}, {
    content: {
        type: "text";
        text: string;
        attachments?: {
            type: "image";
            ref: string;
            mimeType?: string | undefined;
        }[] | undefined;
    };
    role: "user";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
    localKey?: string | undefined;
}>, z.ZodObject<{
    role: z.ZodLiteral<"agent">;
    content: z.ZodObject<{
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
        attachmentRefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
            remotePath: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            size: number;
            remotePath: string;
        }, {
            name: string;
            size: number;
            remotePath: string;
        }>, "many">>;
        contextBoundaryFallback: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }, {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sentFrom?: string | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
        attachmentRefs?: {
            name: string;
            size: number;
            remotePath: string;
        }[] | undefined;
        contextBoundaryFallback?: boolean | undefined;
    } | undefined;
}>]>;
type LegacyMessageContent = z.infer<typeof LegacyMessageContentSchema>;

declare const sessionRoleSchema: z.ZodUnion<[z.ZodLiteral<"user">, z.ZodLiteral<"agent">]>;
type SessionRole = z.infer<typeof sessionRoleSchema>;
declare const sessionTextEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"text">;
    text: z.ZodString;
    thinking: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}>;
declare const sessionServiceMessageEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"service">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "service";
    text: string;
}, {
    t: "service";
    text: string;
}>;
declare const sessionToolCallStartEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"tool-call-start">;
    call: z.ZodString;
    name: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    permissionRequestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
    permissionRequestId?: string | undefined;
}, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
    permissionRequestId?: string | undefined;
}>;
declare const sessionToolCallEndEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"tool-call-end">;
    call: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-end";
    call: string;
}, {
    t: "tool-call-end";
    call: string;
}>;
declare const sessionFileEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"file">;
    ref: z.ZodString;
    name: z.ZodString;
    size: z.ZodNumber;
    mimeType: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        thumbhash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        thumbhash: string;
    }, {
        width: number;
        height: number;
        thumbhash: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}>;
declare const sessionTurnStartEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"turn-start">;
}, "strip", z.ZodTypeAny, {
    t: "turn-start";
}, {
    t: "turn-start";
}>;
declare const sessionStartEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"start">;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "start";
    title?: string | undefined;
}, {
    t: "start";
    title?: string | undefined;
}>;
declare const sessionTurnEndStatusSchema: z.ZodEnum<["completed", "failed", "cancelled"]>;
type SessionTurnEndStatus = z.infer<typeof sessionTurnEndStatusSchema>;
declare const sessionTurnEndEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"turn-end">;
    status: z.ZodEnum<["completed", "failed", "cancelled"]>;
}, "strip", z.ZodTypeAny, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}>;
declare const sessionStopEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"stop">;
}, "strip", z.ZodTypeAny, {
    t: "stop";
}, {
    t: "stop";
}>;
declare const sessionContextBoundaryKindSchema: z.ZodEnum<["clear", "compact", "autocompact", "plan-mode-enter", "plan-mode-exit", "session-fork-resume"]>;
type SessionContextBoundaryKind = z.infer<typeof sessionContextBoundaryKindSchema>;
declare const sessionContextBoundaryTriggeredBySchema: z.ZodEnum<["user", "agent", "system"]>;
type SessionContextBoundaryTriggeredBy = z.infer<typeof sessionContextBoundaryTriggeredBySchema>;
declare const sessionContextBoundaryEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"context-boundary">;
    kind: z.ZodEnum<["clear", "compact", "autocompact", "plan-mode-enter", "plan-mode-exit", "session-fork-resume"]>;
    at: z.ZodNumber;
    /**
     * Boundary source mapping: 'user' for explicit user commands such as /clear,
     * 'agent' for model/agent-initiated lifecycle transitions, and 'system' for
     * Happy runtime or synchronization events.
     */
    triggeredBy: z.ZodEnum<["user", "agent", "system"]>;
    summaryRef: z.ZodOptional<z.ZodString>;
    forkedFromSid: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "context-boundary";
    at: number;
    kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
    triggeredBy: "user" | "agent" | "system";
    summaryRef?: string | undefined;
    forkedFromSid?: string | undefined;
}, {
    t: "context-boundary";
    at: number;
    kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
    triggeredBy: "user" | "agent" | "system";
    summaryRef?: string | undefined;
    forkedFromSid?: string | undefined;
}>;
type SessionContextBoundaryEvent = z.infer<typeof sessionContextBoundaryEventSchema>;
declare const sessionAgentConfigurationChangedEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"agent-configuration-changed">;
    permissionMode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sandbox: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    t: "agent-configuration-changed";
    permissionMode?: string | null | undefined;
    model?: string | null | undefined;
    thinkingLevel?: string | null | undefined;
    sandbox?: string | null | undefined;
}, {
    t: "agent-configuration-changed";
    permissionMode?: string | null | undefined;
    model?: string | null | undefined;
    thinkingLevel?: string | null | undefined;
    sandbox?: string | null | undefined;
}>;
type SessionAgentConfigurationChangedEvent = z.infer<typeof sessionAgentConfigurationChangedEventSchema>;
declare const sessionMessageConsumptionEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"message-consumption">;
    messageId: z.ZodString;
    consumedAt: z.ZodNumber;
    agentFlavor: z.ZodEnum<["claude", "codex"]>;
}, "strip", z.ZodTypeAny, {
    t: "message-consumption";
    messageId: string;
    consumedAt: number;
    agentFlavor: "claude" | "codex";
}, {
    t: "message-consumption";
    messageId: string;
    consumedAt: number;
    agentFlavor: "claude" | "codex";
}>;
type SessionMessageConsumptionEvent = z.infer<typeof sessionMessageConsumptionEventSchema>;
declare const sessionEventSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"text">;
    text: z.ZodString;
    thinking: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"service">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "service";
    text: string;
}, {
    t: "service";
    text: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"tool-call-start">;
    call: z.ZodString;
    name: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    permissionRequestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
    permissionRequestId?: string | undefined;
}, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
    permissionRequestId?: string | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"tool-call-end">;
    call: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-end";
    call: string;
}, {
    t: "tool-call-end";
    call: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"file">;
    ref: z.ZodString;
    name: z.ZodString;
    size: z.ZodNumber;
    mimeType: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        thumbhash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        thumbhash: string;
    }, {
        width: number;
        height: number;
        thumbhash: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"turn-start">;
}, "strip", z.ZodTypeAny, {
    t: "turn-start";
}, {
    t: "turn-start";
}>, z.ZodObject<{
    t: z.ZodLiteral<"start">;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "start";
    title?: string | undefined;
}, {
    t: "start";
    title?: string | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"turn-end">;
    status: z.ZodEnum<["completed", "failed", "cancelled"]>;
}, "strip", z.ZodTypeAny, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}>, z.ZodObject<{
    t: z.ZodLiteral<"stop">;
}, "strip", z.ZodTypeAny, {
    t: "stop";
}, {
    t: "stop";
}>, z.ZodObject<{
    t: z.ZodLiteral<"context-boundary">;
    kind: z.ZodEnum<["clear", "compact", "autocompact", "plan-mode-enter", "plan-mode-exit", "session-fork-resume"]>;
    at: z.ZodNumber;
    /**
     * Boundary source mapping: 'user' for explicit user commands such as /clear,
     * 'agent' for model/agent-initiated lifecycle transitions, and 'system' for
     * Happy runtime or synchronization events.
     */
    triggeredBy: z.ZodEnum<["user", "agent", "system"]>;
    summaryRef: z.ZodOptional<z.ZodString>;
    forkedFromSid: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "context-boundary";
    at: number;
    kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
    triggeredBy: "user" | "agent" | "system";
    summaryRef?: string | undefined;
    forkedFromSid?: string | undefined;
}, {
    t: "context-boundary";
    at: number;
    kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
    triggeredBy: "user" | "agent" | "system";
    summaryRef?: string | undefined;
    forkedFromSid?: string | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"agent-configuration-changed">;
    permissionMode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sandbox: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    t: "agent-configuration-changed";
    permissionMode?: string | null | undefined;
    model?: string | null | undefined;
    thinkingLevel?: string | null | undefined;
    sandbox?: string | null | undefined;
}, {
    t: "agent-configuration-changed";
    permissionMode?: string | null | undefined;
    model?: string | null | undefined;
    thinkingLevel?: string | null | undefined;
    sandbox?: string | null | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"message-consumption">;
    messageId: z.ZodString;
    consumedAt: z.ZodNumber;
    agentFlavor: z.ZodEnum<["claude", "codex"]>;
}, "strip", z.ZodTypeAny, {
    t: "message-consumption";
    messageId: string;
    consumedAt: number;
    agentFlavor: "claude" | "codex";
}, {
    t: "message-consumption";
    messageId: string;
    consumedAt: number;
    agentFlavor: "claude" | "codex";
}>]>;
type SessionEvent = z.infer<typeof sessionEventSchema>;
declare const sessionEnvelopeSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    time: z.ZodNumber;
    role: z.ZodUnion<[z.ZodLiteral<"user">, z.ZodLiteral<"agent">]>;
    turn: z.ZodOptional<z.ZodString>;
    subagent: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    ev: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
        t: z.ZodLiteral<"text">;
        text: z.ZodString;
        thinking: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    }, {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"service">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        t: "service";
        text: string;
    }, {
        t: "service";
        text: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"tool-call-start">;
        call: z.ZodString;
        name: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        permissionRequestId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        permissionRequestId?: string | undefined;
    }, {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        permissionRequestId?: string | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"tool-call-end">;
        call: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        t: "tool-call-end";
        call: string;
    }, {
        t: "tool-call-end";
        call: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"file">;
        ref: z.ZodString;
        name: z.ZodString;
        size: z.ZodNumber;
        mimeType: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            thumbhash: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            width: number;
            height: number;
            thumbhash: string;
        }, {
            width: number;
            height: number;
            thumbhash: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    }, {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"turn-start">;
    }, "strip", z.ZodTypeAny, {
        t: "turn-start";
    }, {
        t: "turn-start";
    }>, z.ZodObject<{
        t: z.ZodLiteral<"start">;
        title: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        t: "start";
        title?: string | undefined;
    }, {
        t: "start";
        title?: string | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"turn-end">;
        status: z.ZodEnum<["completed", "failed", "cancelled"]>;
    }, "strip", z.ZodTypeAny, {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    }, {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    }>, z.ZodObject<{
        t: z.ZodLiteral<"stop">;
    }, "strip", z.ZodTypeAny, {
        t: "stop";
    }, {
        t: "stop";
    }>, z.ZodObject<{
        t: z.ZodLiteral<"context-boundary">;
        kind: z.ZodEnum<["clear", "compact", "autocompact", "plan-mode-enter", "plan-mode-exit", "session-fork-resume"]>;
        at: z.ZodNumber;
        /**
         * Boundary source mapping: 'user' for explicit user commands such as /clear,
         * 'agent' for model/agent-initiated lifecycle transitions, and 'system' for
         * Happy runtime or synchronization events.
         */
        triggeredBy: z.ZodEnum<["user", "agent", "system"]>;
        summaryRef: z.ZodOptional<z.ZodString>;
        forkedFromSid: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        t: "context-boundary";
        at: number;
        kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
        triggeredBy: "user" | "agent" | "system";
        summaryRef?: string | undefined;
        forkedFromSid?: string | undefined;
    }, {
        t: "context-boundary";
        at: number;
        kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
        triggeredBy: "user" | "agent" | "system";
        summaryRef?: string | undefined;
        forkedFromSid?: string | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"agent-configuration-changed">;
        permissionMode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        sandbox: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        t: "agent-configuration-changed";
        permissionMode?: string | null | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sandbox?: string | null | undefined;
    }, {
        t: "agent-configuration-changed";
        permissionMode?: string | null | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sandbox?: string | null | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"message-consumption">;
        messageId: z.ZodString;
        consumedAt: z.ZodNumber;
        agentFlavor: z.ZodEnum<["claude", "codex"]>;
    }, "strip", z.ZodTypeAny, {
        t: "message-consumption";
        messageId: string;
        consumedAt: number;
        agentFlavor: "claude" | "codex";
    }, {
        t: "message-consumption";
        messageId: string;
        consumedAt: number;
        agentFlavor: "claude" | "codex";
    }>]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        permissionRequestId?: string | undefined;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    } | {
        t: "context-boundary";
        at: number;
        kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
        triggeredBy: "user" | "agent" | "system";
        summaryRef?: string | undefined;
        forkedFromSid?: string | undefined;
    } | {
        t: "agent-configuration-changed";
        permissionMode?: string | null | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sandbox?: string | null | undefined;
    } | {
        t: "message-consumption";
        messageId: string;
        consumedAt: number;
        agentFlavor: "claude" | "codex";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
}, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        permissionRequestId?: string | undefined;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    } | {
        t: "context-boundary";
        at: number;
        kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
        triggeredBy: "user" | "agent" | "system";
        summaryRef?: string | undefined;
        forkedFromSid?: string | undefined;
    } | {
        t: "agent-configuration-changed";
        permissionMode?: string | null | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sandbox?: string | null | undefined;
    } | {
        t: "message-consumption";
        messageId: string;
        consumedAt: number;
        agentFlavor: "claude" | "codex";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
}>, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        permissionRequestId?: string | undefined;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    } | {
        t: "context-boundary";
        at: number;
        kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
        triggeredBy: "user" | "agent" | "system";
        summaryRef?: string | undefined;
        forkedFromSid?: string | undefined;
    } | {
        t: "agent-configuration-changed";
        permissionMode?: string | null | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sandbox?: string | null | undefined;
    } | {
        t: "message-consumption";
        messageId: string;
        consumedAt: number;
        agentFlavor: "claude" | "codex";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
}, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        permissionRequestId?: string | undefined;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    } | {
        t: "context-boundary";
        at: number;
        kind: "clear" | "compact" | "autocompact" | "plan-mode-enter" | "plan-mode-exit" | "session-fork-resume";
        triggeredBy: "user" | "agent" | "system";
        summaryRef?: string | undefined;
        forkedFromSid?: string | undefined;
    } | {
        t: "agent-configuration-changed";
        permissionMode?: string | null | undefined;
        model?: string | null | undefined;
        thinkingLevel?: string | null | undefined;
        sandbox?: string | null | undefined;
    } | {
        t: "message-consumption";
        messageId: string;
        consumedAt: number;
        agentFlavor: "claude" | "codex";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
}>;
type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;
type CreateEnvelopeOptions = {
    id?: string;
    time?: number;
    turn?: string;
    subagent?: string;
};
declare function createEnvelope(role: SessionRole, ev: SessionEvent, opts?: CreateEnvelopeOptions): SessionEnvelope;

declare const TofuPublicKeysSchema: z.ZodObject<{
    ed25519PublicKey: z.ZodString;
    x25519PublicKey: z.ZodString;
    ed25519Fingerprint: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ed25519PublicKey: string;
    x25519PublicKey: string;
    ed25519Fingerprint?: string | undefined;
}, {
    ed25519PublicKey: string;
    x25519PublicKey: string;
    ed25519Fingerprint?: string | undefined;
}>;
type TofuPublicKeys = z.infer<typeof TofuPublicKeysSchema>;
declare const TofuPubkeysEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"tofu-pubkeys">;
    keys: z.ZodObject<{
        ed25519PublicKey: z.ZodString;
        x25519PublicKey: z.ZodString;
        ed25519Fingerprint: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    }, {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "tofu-pubkeys";
    keys: {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    };
}, {
    t: "tofu-pubkeys";
    keys: {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    };
}>;
type TofuPubkeysEvent = z.infer<typeof TofuPubkeysEventSchema>;
declare const TofuSessionKeyExchangeSchema: z.ZodObject<{
    t: z.ZodLiteral<"tofu-session-key">;
    machineId: z.ZodString;
    mobileX25519PublicKey: z.ZodString;
    serverX25519PublicKey: z.ZodString;
    sessionKey: z.ZodString;
    firstSeenAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "tofu-session-key";
    machineId: string;
    mobileX25519PublicKey: string;
    serverX25519PublicKey: string;
    sessionKey: string;
    firstSeenAt: number;
}, {
    t: "tofu-session-key";
    machineId: string;
    mobileX25519PublicKey: string;
    serverX25519PublicKey: string;
    sessionKey: string;
    firstSeenAt: number;
}>;
type TofuSessionKeyExchange = z.infer<typeof TofuSessionKeyExchangeSchema>;
declare const TofuHandshakeMessageSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"tofu-pubkeys">;
    keys: z.ZodObject<{
        ed25519PublicKey: z.ZodString;
        x25519PublicKey: z.ZodString;
        ed25519Fingerprint: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    }, {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "tofu-pubkeys";
    keys: {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    };
}, {
    t: "tofu-pubkeys";
    keys: {
        ed25519PublicKey: string;
        x25519PublicKey: string;
        ed25519Fingerprint?: string | undefined;
    };
}>, z.ZodObject<{
    t: z.ZodLiteral<"tofu-session-key">;
    machineId: z.ZodString;
    mobileX25519PublicKey: z.ZodString;
    serverX25519PublicKey: z.ZodString;
    sessionKey: z.ZodString;
    firstSeenAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "tofu-session-key";
    machineId: string;
    mobileX25519PublicKey: string;
    serverX25519PublicKey: string;
    sessionKey: string;
    firstSeenAt: number;
}, {
    t: "tofu-session-key";
    machineId: string;
    mobileX25519PublicKey: string;
    serverX25519PublicKey: string;
    sessionKey: string;
    firstSeenAt: number;
}>]>;
type TofuHandshakeMessage = z.infer<typeof TofuHandshakeMessageSchema>;

declare const VoiceConversationGrantedSchema: z.ZodObject<{
    allowed: z.ZodLiteral<true>;
    conversationToken: z.ZodString;
    conversationId: z.ZodString;
    agentId: z.ZodString;
    elevenUserId: z.ZodString;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}>;
declare const VoiceConversationDeniedSchema: z.ZodObject<{
    allowed: z.ZodLiteral<false>;
    reason: z.ZodEnum<["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]>;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
    agentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}>;
declare const VoiceConversationResponseSchema: z.ZodDiscriminatedUnion<"allowed", [z.ZodObject<{
    allowed: z.ZodLiteral<true>;
    conversationToken: z.ZodString;
    conversationId: z.ZodString;
    agentId: z.ZodString;
    elevenUserId: z.ZodString;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}>, z.ZodObject<{
    allowed: z.ZodLiteral<false>;
    reason: z.ZodEnum<["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]>;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
    agentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}>]>;
type VoiceConversationResponse = z.infer<typeof VoiceConversationResponseSchema>;
declare const VoiceUsageResponseSchema: z.ZodObject<{
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
    conversationCount: z.ZodNumber;
    conversationLimit: z.ZodNumber;
    elevenUserId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
    conversationCount: number;
    conversationLimit: number;
}, {
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
    conversationCount: number;
    conversationLimit: number;
}>;
type VoiceUsageResponse = z.infer<typeof VoiceUsageResponseSchema>;

interface RawClaudeMessageMatchInput {
    type: string;
    message: {
        content: unknown;
    };
}
interface ReceiverRegexFactory {
    buildInlineRe(): RegExp;
    buildStandaloneLineRe(): RegExp;
}
interface NonRenderableEntry {
    name: string;
    senderPredicate?: (raw: RawClaudeMessageMatchInput) => boolean;
    receiverRegexes?: ReceiverRegexFactory;
    receiverPrefix?: RegExp;
    receiverMatchSite: 'skill-body-prefix' | 'wrapped-tag';
}
declare function makeWrappedTagEntry(tagName: string, opts?: {
    enableSender?: boolean;
}): NonRenderableEntry;
declare const skillBodyEntry: NonRenderableEntry;
declare const localCommandCaveatEntry: NonRenderableEntry;
declare const systemReminderEntry: NonRenderableEntry;
declare const forkBoilerplateEntry: NonRenderableEntry;
declare const nonRenderableEntries: readonly NonRenderableEntry[];
declare function findSenderDropEntry(raw: unknown): NonRenderableEntry | null;

declare const LedgerErrorCodeSchema: z.ZodEnum<["spawn-failed", "wrong-account", "timeout", "crash", "ledger-write-failed", "monitor-failure"]>;
type LedgerErrorCode = z.infer<typeof LedgerErrorCodeSchema>;
declare const SpawnLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"spawn">;
    agent: z.ZodString;
    projectPath: z.ZodString;
    worktreePath: z.ZodString;
    branchName: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    agent: string;
    runId: string;
    timestamp: string;
    eventType: "spawn";
    projectPath: string;
    worktreePath: string;
    seqWithinSession?: number | undefined;
    branchName?: string | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    agent: string;
    runId: string;
    timestamp: string;
    eventType: "spawn";
    projectPath: string;
    worktreePath: string;
    seqWithinSession?: number | undefined;
    branchName?: string | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const MessageSentLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"message-sent">;
    direction: z.ZodEnum<["user-to-agent", "agent-to-server"]>;
    messageId: z.ZodOptional<z.ZodString>;
    messagePreview: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "message-sent";
    direction: "user-to-agent" | "agent-to-server";
    messageId?: string | undefined;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
    messagePreview?: string | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "message-sent";
    direction: "user-to-agent" | "agent-to-server";
    messageId?: string | undefined;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
    messagePreview?: string | undefined;
}>;
declare const IdleReachedLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"idle-reached">;
    queueDepth: z.ZodNumber;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "idle-reached";
    queueDepth: number;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "idle-reached";
    queueDepth: number;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const PendingPermissionLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"pending-permission">;
    requestIds: z.ZodArray<z.ZodString, "many">;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "pending-permission";
    requestIds: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "pending-permission";
    requestIds: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const LastOutputSummaryLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"last-output-summary">;
    summary: z.ZodString;
    heuristic: z.ZodEnum<["assistant-text", "tool-result", "server-summary"]>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "last-output-summary";
    summary: string;
    heuristic: "assistant-text" | "tool-result" | "server-summary";
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "last-output-summary";
    summary: string;
    heuristic: "assistant-text" | "tool-result" | "server-summary";
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const ValidationAttachedLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"validation-attached">;
    testReference: z.ZodString;
    verificationUrl: z.ZodString;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "validation-attached";
    testReference: string;
    verificationUrl: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "validation-attached";
    testReference: string;
    verificationUrl: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const DoneLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"done">;
    scopeSummary: z.ZodString;
    testReference: z.ZodString;
    verificationUrl: z.ZodString;
    caveats: z.ZodArray<z.ZodString, "many">;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "done";
    testReference: string;
    verificationUrl: string;
    scopeSummary: string;
    caveats: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "done";
    testReference: string;
    verificationUrl: string;
    scopeSummary: string;
    caveats: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const ErrorLedgerRecordSchema: z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"error">;
    errorCode: z.ZodEnum<["spawn-failed", "wrong-account", "timeout", "crash", "ledger-write-failed", "monitor-failure"]>;
    errorMessage: z.ZodString;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "error";
    errorCode: "spawn-failed" | "wrong-account" | "timeout" | "crash" | "ledger-write-failed" | "monitor-failure";
    errorMessage: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "error";
    errorCode: "spawn-failed" | "wrong-account" | "timeout" | "crash" | "ledger-write-failed" | "monitor-failure";
    errorMessage: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>;
declare const LedgerRecordSchema: z.ZodDiscriminatedUnion<"eventType", [z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"spawn">;
    agent: z.ZodString;
    projectPath: z.ZodString;
    worktreePath: z.ZodString;
    branchName: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    agent: string;
    runId: string;
    timestamp: string;
    eventType: "spawn";
    projectPath: string;
    worktreePath: string;
    seqWithinSession?: number | undefined;
    branchName?: string | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    agent: string;
    runId: string;
    timestamp: string;
    eventType: "spawn";
    projectPath: string;
    worktreePath: string;
    seqWithinSession?: number | undefined;
    branchName?: string | undefined;
    payload?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"message-sent">;
    direction: z.ZodEnum<["user-to-agent", "agent-to-server"]>;
    messageId: z.ZodOptional<z.ZodString>;
    messagePreview: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "message-sent";
    direction: "user-to-agent" | "agent-to-server";
    messageId?: string | undefined;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
    messagePreview?: string | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "message-sent";
    direction: "user-to-agent" | "agent-to-server";
    messageId?: string | undefined;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
    messagePreview?: string | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"idle-reached">;
    queueDepth: z.ZodNumber;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "idle-reached";
    queueDepth: number;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "idle-reached";
    queueDepth: number;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"pending-permission">;
    requestIds: z.ZodArray<z.ZodString, "many">;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "pending-permission";
    requestIds: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "pending-permission";
    requestIds: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"last-output-summary">;
    summary: z.ZodString;
    heuristic: z.ZodEnum<["assistant-text", "tool-result", "server-summary"]>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "last-output-summary";
    summary: string;
    heuristic: "assistant-text" | "tool-result" | "server-summary";
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "last-output-summary";
    summary: string;
    heuristic: "assistant-text" | "tool-result" | "server-summary";
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"validation-attached">;
    testReference: z.ZodString;
    verificationUrl: z.ZodString;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "validation-attached";
    testReference: string;
    verificationUrl: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "validation-attached";
    testReference: string;
    verificationUrl: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"done">;
    scopeSummary: z.ZodString;
    testReference: z.ZodString;
    verificationUrl: z.ZodString;
    caveats: z.ZodArray<z.ZodString, "many">;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "done";
    testReference: string;
    verificationUrl: string;
    scopeSummary: string;
    caveats: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "done";
    testReference: string;
    verificationUrl: string;
    scopeSummary: string;
    caveats: string[];
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    runId: z.ZodString;
    sessionId: z.ZodString;
    timestamp: z.ZodString;
    seqWithinSession: z.ZodOptional<z.ZodNumber>;
} & {
    eventType: z.ZodLiteral<"error">;
    errorCode: z.ZodEnum<["spawn-failed", "wrong-account", "timeout", "crash", "ledger-write-failed", "monitor-failure"]>;
    errorMessage: z.ZodString;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "error";
    errorCode: "spawn-failed" | "wrong-account" | "timeout" | "crash" | "ledger-write-failed" | "monitor-failure";
    errorMessage: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}, {
    sessionId: string;
    runId: string;
    timestamp: string;
    eventType: "error";
    errorCode: "spawn-failed" | "wrong-account" | "timeout" | "crash" | "ledger-write-failed" | "monitor-failure";
    errorMessage: string;
    seqWithinSession?: number | undefined;
    payload?: Record<string, unknown> | undefined;
}>]>;
type LedgerRecord = z.infer<typeof LedgerRecordSchema>;

declare const AgentTreeNodeSchema: z.ZodObject<{
    threadId: z.ZodString;
    agentRole: z.ZodString;
    nickname: z.ZodNullable<z.ZodString>;
    status: z.ZodString;
    lastTaskMessage: z.ZodOptional<z.ZodString>;
    spawnedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: string;
    threadId: string;
    agentRole: string;
    nickname: string | null;
    spawnedAt: number;
    lastTaskMessage?: string | undefined;
}, {
    status: string;
    threadId: string;
    agentRole: string;
    nickname: string | null;
    spawnedAt: number;
    lastTaskMessage?: string | undefined;
}>;
type AgentTreeNode = z.infer<typeof AgentTreeNodeSchema>;
declare const AgentTreeEdgeSchema: z.ZodObject<{
    parent: z.ZodString;
    child: z.ZodString;
}, "strip", z.ZodTypeAny, {
    parent: string;
    child: string;
}, {
    parent: string;
    child: string;
}>;
type AgentTreeEdge = z.infer<typeof AgentTreeEdgeSchema>;
declare const AgentTreeSnapshotSchema: z.ZodObject<{
    nodes: z.ZodArray<z.ZodObject<{
        threadId: z.ZodString;
        agentRole: z.ZodString;
        nickname: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        lastTaskMessage: z.ZodOptional<z.ZodString>;
        spawnedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }>, "many">;
    edges: z.ZodArray<z.ZodObject<{
        parent: z.ZodString;
        child: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        parent: string;
        child: string;
    }, {
        parent: string;
        child: string;
    }>, "many">;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    seq: number;
    nodes: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }[];
    edges: {
        parent: string;
        child: string;
    }[];
}, {
    seq: number;
    nodes: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }[];
    edges: {
        parent: string;
        child: string;
    }[];
}>;
type AgentTreeSnapshot = z.infer<typeof AgentTreeSnapshotSchema>;
declare const AgentTreePendingSpawnStartedDeltaSchema: z.ZodObject<{
    type: z.ZodLiteral<"pending-spawn-started">;
    seq: z.ZodNumber;
    callId: z.ZodString;
    parentThreadId: z.ZodString;
    agentRole: z.ZodString;
    nickname: z.ZodNullable<z.ZodString>;
    taskMessage: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pending-spawn-started";
    seq: number;
    agentRole: string;
    nickname: string | null;
    callId: string;
    parentThreadId: string;
    startedAt: number;
    taskMessage?: string | undefined;
}, {
    type: "pending-spawn-started";
    seq: number;
    agentRole: string;
    nickname: string | null;
    callId: string;
    parentThreadId: string;
    startedAt: number;
    taskMessage?: string | undefined;
}>;
type AgentTreePendingSpawnStartedDelta = z.infer<typeof AgentTreePendingSpawnStartedDeltaSchema>;
declare const AgentTreeNodeAddedDeltaSchema: z.ZodObject<{
    type: z.ZodLiteral<"node-added">;
    seq: z.ZodNumber;
    node: z.ZodObject<{
        threadId: z.ZodString;
        agentRole: z.ZodString;
        nickname: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        lastTaskMessage: z.ZodOptional<z.ZodString>;
        spawnedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }>;
    edge: z.ZodObject<{
        parent: z.ZodString;
        child: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        parent: string;
        child: string;
    }, {
        parent: string;
        child: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "node-added";
    seq: number;
    node: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    };
    edge: {
        parent: string;
        child: string;
    };
}, {
    type: "node-added";
    seq: number;
    node: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    };
    edge: {
        parent: string;
        child: string;
    };
}>;
type AgentTreeNodeAddedDelta = z.infer<typeof AgentTreeNodeAddedDeltaSchema>;
declare const AgentTreeNodeStatusChangedDeltaSchema: z.ZodObject<{
    type: z.ZodLiteral<"node-status-changed">;
    seq: z.ZodNumber;
    threadId: z.ZodString;
    status: z.ZodString;
    lastTaskMessage: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: string;
    type: "node-status-changed";
    seq: number;
    threadId: string;
    lastTaskMessage?: string | undefined;
}, {
    status: string;
    type: "node-status-changed";
    seq: number;
    threadId: string;
    lastTaskMessage?: string | undefined;
}>;
type AgentTreeNodeStatusChangedDelta = z.infer<typeof AgentTreeNodeStatusChangedDeltaSchema>;
declare const AgentTreeNodeRemovedDeltaSchema: z.ZodObject<{
    type: z.ZodLiteral<"node-removed">;
    seq: z.ZodNumber;
    threadId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "node-removed";
    seq: number;
    threadId: string;
}, {
    type: "node-removed";
    seq: number;
    threadId: string;
}>;
type AgentTreeNodeRemovedDelta = z.infer<typeof AgentTreeNodeRemovedDeltaSchema>;
declare const AgentTreeDeltaSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"pending-spawn-started">;
    seq: z.ZodNumber;
    callId: z.ZodString;
    parentThreadId: z.ZodString;
    agentRole: z.ZodString;
    nickname: z.ZodNullable<z.ZodString>;
    taskMessage: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pending-spawn-started";
    seq: number;
    agentRole: string;
    nickname: string | null;
    callId: string;
    parentThreadId: string;
    startedAt: number;
    taskMessage?: string | undefined;
}, {
    type: "pending-spawn-started";
    seq: number;
    agentRole: string;
    nickname: string | null;
    callId: string;
    parentThreadId: string;
    startedAt: number;
    taskMessage?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"node-added">;
    seq: z.ZodNumber;
    node: z.ZodObject<{
        threadId: z.ZodString;
        agentRole: z.ZodString;
        nickname: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        lastTaskMessage: z.ZodOptional<z.ZodString>;
        spawnedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }>;
    edge: z.ZodObject<{
        parent: z.ZodString;
        child: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        parent: string;
        child: string;
    }, {
        parent: string;
        child: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "node-added";
    seq: number;
    node: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    };
    edge: {
        parent: string;
        child: string;
    };
}, {
    type: "node-added";
    seq: number;
    node: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    };
    edge: {
        parent: string;
        child: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"node-status-changed">;
    seq: z.ZodNumber;
    threadId: z.ZodString;
    status: z.ZodString;
    lastTaskMessage: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: string;
    type: "node-status-changed";
    seq: number;
    threadId: string;
    lastTaskMessage?: string | undefined;
}, {
    status: string;
    type: "node-status-changed";
    seq: number;
    threadId: string;
    lastTaskMessage?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"node-removed">;
    seq: z.ZodNumber;
    threadId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "node-removed";
    seq: number;
    threadId: string;
}, {
    type: "node-removed";
    seq: number;
    threadId: string;
}>]>;
type AgentTreeDelta = z.infer<typeof AgentTreeDeltaSchema>;
declare const AgentTreeUpdateInboundPayloadSchema: z.ZodObject<{
    delta: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"pending-spawn-started">;
        seq: z.ZodNumber;
        callId: z.ZodString;
        parentThreadId: z.ZodString;
        agentRole: z.ZodString;
        nickname: z.ZodNullable<z.ZodString>;
        taskMessage: z.ZodOptional<z.ZodString>;
        startedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    }, {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"node-added">;
        seq: z.ZodNumber;
        node: z.ZodObject<{
            threadId: z.ZodString;
            agentRole: z.ZodString;
            nickname: z.ZodNullable<z.ZodString>;
            status: z.ZodString;
            lastTaskMessage: z.ZodOptional<z.ZodString>;
            spawnedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        }, {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        }>;
        edge: z.ZodObject<{
            parent: z.ZodString;
            child: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            parent: string;
            child: string;
        }, {
            parent: string;
            child: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    }, {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"node-status-changed">;
        seq: z.ZodNumber;
        threadId: z.ZodString;
        status: z.ZodString;
        lastTaskMessage: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    }, {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"node-removed">;
        seq: z.ZodNumber;
        threadId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "node-removed";
        seq: number;
        threadId: string;
    }, {
        type: "node-removed";
        seq: number;
        threadId: string;
    }>]>;
}, "strip", z.ZodTypeAny, {
    delta: {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    } | {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    } | {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    } | {
        type: "node-removed";
        seq: number;
        threadId: string;
    };
}, {
    delta: {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    } | {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    } | {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    } | {
        type: "node-removed";
        seq: number;
        threadId: string;
    };
}>;
type AgentTreeUpdateInboundPayload = z.infer<typeof AgentTreeUpdateInboundPayloadSchema>;
declare const AgentTreeUpdateOutboundPayloadSchema: z.ZodObject<{
    sessionId: z.ZodString;
    delta: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"pending-spawn-started">;
        seq: z.ZodNumber;
        callId: z.ZodString;
        parentThreadId: z.ZodString;
        agentRole: z.ZodString;
        nickname: z.ZodNullable<z.ZodString>;
        taskMessage: z.ZodOptional<z.ZodString>;
        startedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    }, {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"node-added">;
        seq: z.ZodNumber;
        node: z.ZodObject<{
            threadId: z.ZodString;
            agentRole: z.ZodString;
            nickname: z.ZodNullable<z.ZodString>;
            status: z.ZodString;
            lastTaskMessage: z.ZodOptional<z.ZodString>;
            spawnedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        }, {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        }>;
        edge: z.ZodObject<{
            parent: z.ZodString;
            child: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            parent: string;
            child: string;
        }, {
            parent: string;
            child: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    }, {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"node-status-changed">;
        seq: z.ZodNumber;
        threadId: z.ZodString;
        status: z.ZodString;
        lastTaskMessage: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    }, {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"node-removed">;
        seq: z.ZodNumber;
        threadId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "node-removed";
        seq: number;
        threadId: string;
    }, {
        type: "node-removed";
        seq: number;
        threadId: string;
    }>]>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    delta: {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    } | {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    } | {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    } | {
        type: "node-removed";
        seq: number;
        threadId: string;
    };
}, {
    sessionId: string;
    delta: {
        type: "pending-spawn-started";
        seq: number;
        agentRole: string;
        nickname: string | null;
        callId: string;
        parentThreadId: string;
        startedAt: number;
        taskMessage?: string | undefined;
    } | {
        type: "node-added";
        seq: number;
        node: {
            status: string;
            threadId: string;
            agentRole: string;
            nickname: string | null;
            spawnedAt: number;
            lastTaskMessage?: string | undefined;
        };
        edge: {
            parent: string;
            child: string;
        };
    } | {
        status: string;
        type: "node-status-changed";
        seq: number;
        threadId: string;
        lastTaskMessage?: string | undefined;
    } | {
        type: "node-removed";
        seq: number;
        threadId: string;
    };
}>;
type AgentTreeUpdateOutboundPayload = z.infer<typeof AgentTreeUpdateOutboundPayloadSchema>;
declare const SessionGetAgentTreeRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
}, {
    sessionId: string;
}>;
type SessionGetAgentTreeRequest = z.infer<typeof SessionGetAgentTreeRequestSchema>;
declare const SessionGetAgentTreeResponseSchema: z.ZodObject<{
    nodes: z.ZodArray<z.ZodObject<{
        threadId: z.ZodString;
        agentRole: z.ZodString;
        nickname: z.ZodNullable<z.ZodString>;
        status: z.ZodString;
        lastTaskMessage: z.ZodOptional<z.ZodString>;
        spawnedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }, {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }>, "many">;
    edges: z.ZodArray<z.ZodObject<{
        parent: z.ZodString;
        child: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        parent: string;
        child: string;
    }, {
        parent: string;
        child: string;
    }>, "many">;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    seq: number;
    nodes: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }[];
    edges: {
        parent: string;
        child: string;
    }[];
}, {
    seq: number;
    nodes: {
        status: string;
        threadId: string;
        agentRole: string;
        nickname: string | null;
        spawnedAt: number;
        lastTaskMessage?: string | undefined;
    }[];
    edges: {
        parent: string;
        child: string;
    }[];
}>;
type SessionGetAgentTreeResponse = z.infer<typeof SessionGetAgentTreeResponseSchema>;

/**
 * Hop-count cap for cross-scope envelope relays.
 *
 * Every relaying daemon increments `hopCount` and rejects when it exceeds
 * `MAX_HOPS`. The initial cap is 4; chains beyond this length are treated
 * as cross-scope cycles. See `plans/agent-comms-design.md` §3 / §6.
 */
declare const MAX_HOPS = 4;
declare const AgentCommsScopeSchema: z.ZodEnum<["B", "C", "A"]>;
type AgentCommsScope = z.infer<typeof AgentCommsScopeSchema>;
declare const AgentCommsChannelSchema: z.ZodEnum<["message", "spawn"]>;
type AgentCommsChannel = z.infer<typeof AgentCommsChannelSchema>;
declare const AgentCommsKindSchema: z.ZodEnum<["request", "reply", "notify", "spawn-request", "spawn-result"]>;
type AgentCommsKind = z.infer<typeof AgentCommsKindSchema>;
declare const AgentCommsFromSchema: z.ZodObject<{
    machineId: z.ZodString;
    sessionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    machineId: string;
}, {
    sessionId: string;
    machineId: string;
}>;
type AgentCommsFrom = z.infer<typeof AgentCommsFromSchema>;
declare const AgentCommsToSchema: z.ZodObject<{
    machineId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    machineId?: string | undefined;
}, {
    sessionId: string;
    machineId?: string | undefined;
}>;
type AgentCommsTo = z.infer<typeof AgentCommsToSchema>;
/**
 * Shared wire envelope for unified agent-to-agent communication.
 *
 * Carries both `agent_comms.send` (message channel) and `agent_comms.spawn`
 * (spawn channel) payloads across all three scopes (B, C, A). The router
 * derives/asserts `scope`; the envelope carries it for audit so downstream
 * relays can verify the dispatch path independently. Hop tracking
 * (`hopCount`, `hopPath`) is the load-bearing cross-scope cycle gate; see
 * `plans/agent-comms-design.md` §3 and §6 for the producer/relay rules.
 */
declare const AgentCommsEnvelopeSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    id: z.ZodString;
    ts: z.ZodNumber;
    from: z.ZodObject<{
        machineId: z.ZodString;
        sessionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        machineId: string;
    }, {
        sessionId: string;
        machineId: string;
    }>;
    to: z.ZodObject<{
        machineId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        machineId?: string | undefined;
    }, {
        sessionId: string;
        machineId?: string | undefined;
    }>;
    scope: z.ZodEnum<["B", "C", "A"]>;
    channel: z.ZodEnum<["message", "spawn"]>;
    kind: z.ZodEnum<["request", "reply", "notify", "spawn-request", "spawn-result"]>;
    correlationId: z.ZodOptional<z.ZodString>;
    hopCount: z.ZodNumber;
    hopPath: z.ZodArray<z.ZodString, "many">;
    body: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    id: string;
    kind: "request" | "reply" | "notify" | "spawn-request" | "spawn-result";
    v: 1;
    ts: number;
    from: {
        sessionId: string;
        machineId: string;
    };
    to: {
        sessionId: string;
        machineId?: string | undefined;
    };
    scope: "B" | "C" | "A";
    channel: "message" | "spawn";
    hopCount: number;
    hopPath: string[];
    body?: unknown;
    correlationId?: string | undefined;
}, {
    id: string;
    kind: "request" | "reply" | "notify" | "spawn-request" | "spawn-result";
    v: 1;
    ts: number;
    from: {
        sessionId: string;
        machineId: string;
    };
    to: {
        sessionId: string;
        machineId?: string | undefined;
    };
    scope: "B" | "C" | "A";
    channel: "message" | "spawn";
    hopCount: number;
    hopPath: string[];
    body?: unknown;
    correlationId?: string | undefined;
}>;
type AgentCommsEnvelope = z.infer<typeof AgentCommsEnvelopeSchema>;
/**
 * Sender public-key material carried alongside a Scope A ingest envelope.
 *
 * These are the pinned peer's Ed25519/X25519 public keys (and optional
 * fingerprint) used by the receiving daemon to verify the detached signature
 * and open the sealed body. See `plans/agent-comms-design.md` §5.4.
 */
declare const SenderKeysSchema: z.ZodObject<{
    ed25519PublicKey: z.ZodString;
    ecdhPublicKey: z.ZodString;
    ed25519Fingerprint: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ed25519PublicKey: string;
    ecdhPublicKey: string;
    ed25519Fingerprint?: string | undefined;
}, {
    ed25519PublicKey: string;
    ecdhPublicKey: string;
    ed25519Fingerprint?: string | undefined;
}>;
type SenderKeys = z.infer<typeof SenderKeysSchema>;
/**
 * Wire body for the Scope A `POST /agent-comms/ingest` endpoint.
 *
 * The receiving daemon's ingest listener validates this shape at the Zod
 * boundary, runs `routeHopValidation`, then delegates cryptographic
 * verification and mailbox append to the daemon-injected handler.
 */
declare const AgentCommsIngestBodySchema: z.ZodObject<{
    envelope: z.ZodObject<{
        v: z.ZodLiteral<1>;
        id: z.ZodString;
        ts: z.ZodNumber;
        from: z.ZodObject<{
            machineId: z.ZodString;
            sessionId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            sessionId: string;
            machineId: string;
        }, {
            sessionId: string;
            machineId: string;
        }>;
        to: z.ZodObject<{
            machineId: z.ZodOptional<z.ZodString>;
            sessionId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            sessionId: string;
            machineId?: string | undefined;
        }, {
            sessionId: string;
            machineId?: string | undefined;
        }>;
        scope: z.ZodEnum<["B", "C", "A"]>;
        channel: z.ZodEnum<["message", "spawn"]>;
        kind: z.ZodEnum<["request", "reply", "notify", "spawn-request", "spawn-result"]>;
        correlationId: z.ZodOptional<z.ZodString>;
        hopCount: z.ZodNumber;
        hopPath: z.ZodArray<z.ZodString, "many">;
        body: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        id: string;
        kind: "request" | "reply" | "notify" | "spawn-request" | "spawn-result";
        v: 1;
        ts: number;
        from: {
            sessionId: string;
            machineId: string;
        };
        to: {
            sessionId: string;
            machineId?: string | undefined;
        };
        scope: "B" | "C" | "A";
        channel: "message" | "spawn";
        hopCount: number;
        hopPath: string[];
        body?: unknown;
        correlationId?: string | undefined;
    }, {
        id: string;
        kind: "request" | "reply" | "notify" | "spawn-request" | "spawn-result";
        v: 1;
        ts: number;
        from: {
            sessionId: string;
            machineId: string;
        };
        to: {
            sessionId: string;
            machineId?: string | undefined;
        };
        scope: "B" | "C" | "A";
        channel: "message" | "spawn";
        hopCount: number;
        hopPath: string[];
        body?: unknown;
        correlationId?: string | undefined;
    }>;
    signature: z.ZodString;
    senderKeys: z.ZodObject<{
        ed25519PublicKey: z.ZodString;
        ecdhPublicKey: z.ZodString;
        ed25519Fingerprint: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        ed25519PublicKey: string;
        ecdhPublicKey: string;
        ed25519Fingerprint?: string | undefined;
    }, {
        ed25519PublicKey: string;
        ecdhPublicKey: string;
        ed25519Fingerprint?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    envelope: {
        id: string;
        kind: "request" | "reply" | "notify" | "spawn-request" | "spawn-result";
        v: 1;
        ts: number;
        from: {
            sessionId: string;
            machineId: string;
        };
        to: {
            sessionId: string;
            machineId?: string | undefined;
        };
        scope: "B" | "C" | "A";
        channel: "message" | "spawn";
        hopCount: number;
        hopPath: string[];
        body?: unknown;
        correlationId?: string | undefined;
    };
    signature: string;
    senderKeys: {
        ed25519PublicKey: string;
        ecdhPublicKey: string;
        ed25519Fingerprint?: string | undefined;
    };
}, {
    envelope: {
        id: string;
        kind: "request" | "reply" | "notify" | "spawn-request" | "spawn-result";
        v: 1;
        ts: number;
        from: {
            sessionId: string;
            machineId: string;
        };
        to: {
            sessionId: string;
            machineId?: string | undefined;
        };
        scope: "B" | "C" | "A";
        channel: "message" | "spawn";
        hopCount: number;
        hopPath: string[];
        body?: unknown;
        correlationId?: string | undefined;
    };
    signature: string;
    senderKeys: {
        ed25519PublicKey: string;
        ecdhPublicKey: string;
        ed25519Fingerprint?: string | undefined;
    };
}>;
type AgentCommsIngestBody = z.infer<typeof AgentCommsIngestBodySchema>;
/** The daemon-injected closure that performs auth + mailbox delivery for an ingest body. */
type AgentCommsIngestHandler = (body: AgentCommsIngestBody) => Promise<{
    id: string;
    seq: number;
}>;
/**
 * Backend-observable hop checks performed before an ingest body reaches the
 * cryptographic handler. Returns a human-readable error string when the
 * envelope violates a hop invariant (hop-count cap, duplicate hop, or the
 * hopPath already containing the target session), or `null` when it is valid.
 */
declare function routeHopValidation(envelope: AgentCommsEnvelope): string | null;

declare function encodeBase64(bytes: Uint8Array): string;
declare function decodeBase64(text: string): Uint8Array;
declare const PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION: 1;
/**
 * Domain-separation prefix for the canonical string that a paired device signs.
 * Binding this into every signature prevents a signature produced for another
 * purpose (e.g. a peer-auth handshake) from being replayed as a device proof.
 */
declare const PUBLIC_DEVICE_PROOF_DOMAIN = "happy-public-device-proof/v1";
/**
 * HTTP + Socket.IO handshake header that carries the base64-encoded JSON
 * envelope. Lower-case because Node/Fastify/Socket.IO normalize header names.
 */
declare const PUBLIC_DEVICE_PROOF_HEADER = "x-happy-device-proof";
/** Default freshness window (5 minutes) for a proof's issuedAt timestamp. */
declare const PUBLIC_DEVICE_PROOF_FRESHNESS_MS: number;
/** Allowed forward clock skew (1 minute) between a device and the server. */
declare const PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS: number;
declare const PublicSignedRequestEnvelopeSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    keyId: z.ZodString;
    publicKey: z.ZodString;
    nonce: z.ZodString;
    issuedAt: z.ZodNumber;
    method: z.ZodString;
    path: z.ZodString;
    bodyHash: z.ZodString;
    signature: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    v: 1;
    signature: string;
    keyId: string;
    publicKey: string;
    nonce: string;
    issuedAt: number;
    method: string;
    bodyHash: string;
}, {
    path: string;
    v: 1;
    signature: string;
    keyId: string;
    publicKey: string;
    nonce: string;
    issuedAt: number;
    method: string;
    bodyHash: string;
}>;
type PublicSignedRequestEnvelope = z.infer<typeof PublicSignedRequestEnvelopeSchema>;
declare function normalizeMethod(method: string): string;
interface CanonicalRequestFields {
    method: string;
    path: string;
    keyId: string;
    publicKey: string;
    nonce: string;
    issuedAt: number;
    bodyHash: string;
}
/**
 * Builds the exact string a device signs. The field order is fixed and each
 * field is on its own line; the values themselves are opaque base64/ascii and
 * never contain a newline, so the encoding is unambiguous.
 */
declare function canonicalRequestStringToSign(fields: CanonicalRequestFields): string;
/** SHA-256 of the raw request body, base64-encoded. Empty body hashes the empty string. */
declare function hashRequestBody(body: Uint8Array | string | null | undefined): string;
/** Generates a random base64 nonce. 24 bytes → 192 bits of entropy by default. */
declare function generatePublicRequestNonce(byteLength?: number): string;
interface SignPublicRequestInput {
    method: string;
    path: string;
    keyId: string;
    nonce: string;
    issuedAt: number;
    bodyHash: string;
}
/**
 * Produces a signed-request envelope for an already-paired device. `secretKey`
 * is the 32-byte Ed25519 seed; the public key is derived from it so the
 * envelope is internally self-consistent.
 */
declare function signPublicRequest(input: SignPublicRequestInput, secretKey: Uint8Array): Promise<PublicSignedRequestEnvelope>;
interface VerifyPublicRequestContext {
    /** Actual HTTP method of the incoming request. */
    method: string;
    /** Actual matched route path (or URL path) of the incoming request. */
    path: string;
    /** Actual base64 SHA-256 of the incoming body. If provided, it must equal the signed bodyHash. */
    bodyHash?: string;
    /** Pinned device public key (base64). If provided, the envelope's publicKey must match it exactly. */
    expectedPublicKey?: string;
}
interface PublicRequestVerification {
    ok: boolean;
    reason?: string;
}
/**
 * Cryptographically verifies a signed-request envelope and its binding to the
 * incoming request (method, path, and — when supplied — body hash and pinned
 * key). This is intentionally stateless: freshness (issuedAt) and single-use
 * (nonce) enforcement live in the server-side verifier that owns a clock and a
 * replay cache. Returns { ok:false, reason } rather than throwing so callers
 * fail closed on any error.
 */
declare function verifyPublicRequest(envelope: unknown, context: VerifyPublicRequestContext): Promise<PublicRequestVerification>;
/**
 * True when a proof's issuedAt falls inside the freshness window relative to
 * `now`, tolerating a small forward clock skew. Server-side helper; kept here so
 * the freshness policy is defined next to the envelope it guards.
 */
declare function isPublicProofFresh(issuedAt: number, now: number, windowMs?: number, clockSkewMs?: number): boolean;
/** Encodes an envelope into the base64 header string carried on requests/handshakes. */
declare function encodePublicDeviceProofHeader(envelope: PublicSignedRequestEnvelope): string;
/** Parses the base64 header string back into a validated envelope, or null if malformed. */
declare function decodePublicDeviceProofHeader(header: string | undefined | null): PublicSignedRequestEnvelope | null;
interface PublicDeviceAuthTestVector {
    seedHex: string;
    keyId: string;
    publicKeyBase64: string;
    nonceBase64: string;
    issuedAt: number;
    method: string;
    path: string;
    body: string;
    bodyHashBase64: string;
    canonicalString: string;
    signatureBase64: string;
    envelope: PublicSignedRequestEnvelope;
    headerBase64: string;
}
declare const PUBLIC_DEVICE_AUTH_TEST_VECTOR: PublicDeviceAuthTestVector;

declare const PUBLIC_PAIRING_INVITE_VERSION: 1;
/** Default lifetime of a pairing invite when no explicit expiry/ttl is supplied. */
declare const PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS: number;
declare const CloudflareAccessServiceTokenSchema: z.ZodObject<{
    clientId: z.ZodString;
    clientSecret: z.ZodString;
}, "strip", z.ZodTypeAny, {
    clientId: string;
    clientSecret: string;
}, {
    clientId: string;
    clientSecret: string;
}>;
type CloudflareAccessServiceToken = z.infer<typeof CloudflareAccessServiceTokenSchema>;
declare const PublicPairingInviteSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    serverUrl: z.ZodString;
    machineId: z.ZodString;
    pairSecret: z.ZodString;
    cloudflareAccess: z.ZodObject<{
        clientId: z.ZodString;
        clientSecret: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        clientId: string;
        clientSecret: string;
    }, {
        clientId: string;
        clientSecret: string;
    }>;
    issuedAt: z.ZodString;
    expiresAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    version: 1;
    machineId: string;
    issuedAt: string;
    serverUrl: string;
    pairSecret: string;
    cloudflareAccess: {
        clientId: string;
        clientSecret: string;
    };
    expiresAt: string;
}, {
    version: 1;
    machineId: string;
    issuedAt: string;
    serverUrl: string;
    pairSecret: string;
    cloudflareAccess: {
        clientId: string;
        clientSecret: string;
    };
    expiresAt: string;
}>;
type PublicPairingInvite = z.infer<typeof PublicPairingInviteSchema>;
interface CreatePublicPairingInviteInput {
    serverUrl: string;
    machineId: string;
    cloudflareAccess: CloudflareAccessServiceToken;
    /** One-time pairing-window secret. Generated when omitted. */
    pairSecret?: string;
    issuedAt?: Date | string;
    /** Invite lifetime; ignored when `expiresAt` is supplied. */
    ttlMs?: number;
    expiresAt?: Date | string;
}
/** Generate a fresh, high-entropy one-time pairing secret. */
declare function generatePairSecret(byteLength?: number): string;
/**
 * Assemble a validated {@link PublicPairingInvite}. Generates a fresh
 * `pairSecret` and a bounded `issuedAt`/`expiresAt` window unless overridden.
 */
declare function createPublicPairingInvite(input: CreatePublicPairingInviteInput): PublicPairingInvite;
/**
 * True when `invite` parses against the schema and `now` falls within
 * `[issuedAt, expiresAt]`. Never throws.
 */
declare function isPublicPairingInviteValid(invite: unknown, now?: Date): boolean;
/** Encode a validated invite as a compact base64url token (QR / manual entry). */
declare function encodePublicPairingInvite(invite: PublicPairingInvite): string;
/**
 * Decode + validate a base64url invite token. Returns null when the token is
 * malformed, not valid base64url, not JSON, or fails schema validation.
 */
declare function decodePublicPairingInvite(token: string | undefined | null): PublicPairingInvite | null;
interface PublicPairingInviteTestVector {
    invite: PublicPairingInvite;
    token: string;
}
/**
 * Deterministic round-trip fixture shared with consumers (US-007 app import).
 * `token` is the canonical base64url encoding of `invite`.
 */
declare const PUBLIC_PAIRING_INVITE_TEST_VECTOR: PublicPairingInviteTestVector;

declare const MachineTunnelSchema: z.ZodObject<{
    machineId: z.ZodString;
    tunnelId: z.ZodString;
    url: z.ZodString;
    tags: z.ZodArray<z.ZodString, "many">;
    lastSeenAt: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    owner: z.ZodString;
}, "strip", z.ZodTypeAny, {
    machineId: string;
    tunnelId: string;
    url: string;
    tags: string[];
    lastSeenAt: string | number;
    owner: string;
}, {
    machineId: string;
    tunnelId: string;
    url: string;
    tags: string[];
    lastSeenAt: string | number;
    owner: string;
}>;
type MachineTunnel = z.infer<typeof MachineTunnelSchema>;

export { AgentCommsChannelSchema, AgentCommsEnvelopeSchema, AgentCommsFromSchema, AgentCommsIngestBodySchema, AgentCommsKindSchema, AgentCommsScopeSchema, AgentCommsToSchema, AgentMessageSchema, AgentTreeDeltaSchema, AgentTreeEdgeSchema, AgentTreeNodeAddedDeltaSchema, AgentTreeNodeRemovedDeltaSchema, AgentTreeNodeSchema, AgentTreeNodeStatusChangedDeltaSchema, AgentTreePendingSpawnStartedDeltaSchema, AgentTreeSnapshotSchema, AgentTreeUpdateInboundPayloadSchema, AgentTreeUpdateOutboundPayloadSchema, ApiMessageSchema, ApiUpdateMachineStateSchema, ApiUpdateNewMessageSchema, ApiUpdateSessionStateSchema, CloudflareAccessServiceTokenSchema, CoreUpdateBodySchema, CoreUpdateContainerSchema, DoneLedgerRecordSchema, ErrorLedgerRecordSchema, IdleReachedLedgerRecordSchema, LastOutputSummaryLedgerRecordSchema, LedgerErrorCodeSchema, LedgerRecordSchema, LegacyMessageContentSchema, MAX_HOPS, MachineTunnelSchema, MessageContentSchema, MessageMetaSchema, MessageSentLedgerRecordSchema, PUBLIC_DEVICE_AUTH_TEST_VECTOR, PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS, PUBLIC_DEVICE_PROOF_DOMAIN, PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION, PUBLIC_DEVICE_PROOF_FRESHNESS_MS, PUBLIC_DEVICE_PROOF_HEADER, PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS, PUBLIC_PAIRING_INVITE_TEST_VECTOR, PUBLIC_PAIRING_INVITE_VERSION, PendingPermissionLedgerRecordSchema, PublicPairingInviteSchema, PublicSignedRequestEnvelopeSchema, SenderKeysSchema, SessionGetAgentTreeRequestSchema, SessionGetAgentTreeResponseSchema, SessionMessageContentSchema, SessionMessageRangeRequestSchema, SessionMessageRangeResponseSchema, SessionMessageSchema, SessionProtocolMessageSchema, SpawnLedgerRecordSchema, TofuHandshakeMessageSchema, TofuPubkeysEventSchema, TofuPublicKeysSchema, TofuSessionKeyExchangeSchema, UpdateBodySchema, UpdateMachineBodySchema, UpdateNewMessageBodySchema, UpdateSchema, UpdateSessionBodySchema, UserMessageSchema, ValidationAttachedLedgerRecordSchema, VersionedEncryptedValueSchema, VersionedMachineEncryptedValueSchema, VersionedNullableEncryptedValueSchema, VoiceConversationDeniedSchema, VoiceConversationGrantedSchema, VoiceConversationResponseSchema, VoiceUsageResponseSchema, canonicalRequestStringToSign, createEnvelope, createPublicPairingInvite, decodeBase64, decodePublicDeviceProofHeader, decodePublicPairingInvite, encodeBase64, encodePublicDeviceProofHeader, encodePublicPairingInvite, findSenderDropEntry, forkBoilerplateEntry, generatePairSecret, generatePublicRequestNonce, hashRequestBody, isPublicPairingInviteValid, isPublicProofFresh, localCommandCaveatEntry, makeWrappedTagEntry, nonRenderableEntries, normalizeMethod, routeHopValidation, sessionAgentConfigurationChangedEventSchema, sessionContextBoundaryEventSchema, sessionContextBoundaryKindSchema, sessionContextBoundaryTriggeredBySchema, sessionEnvelopeSchema, sessionEventSchema, sessionFileEventSchema, sessionMessageConsumptionEventSchema, sessionRoleSchema, sessionServiceMessageEventSchema, sessionStartEventSchema, sessionStopEventSchema, sessionTextEventSchema, sessionToolCallEndEventSchema, sessionToolCallStartEventSchema, sessionTurnEndEventSchema, sessionTurnEndStatusSchema, sessionTurnStartEventSchema, signPublicRequest, skillBodyEntry, systemReminderEntry, verifyPublicRequest };
export type { AgentCommsChannel, AgentCommsEnvelope, AgentCommsFrom, AgentCommsIngestBody, AgentCommsIngestHandler, AgentCommsKind, AgentCommsScope, AgentCommsTo, AgentMessage, AgentTreeDelta, AgentTreeEdge, AgentTreeNode, AgentTreeNodeAddedDelta, AgentTreeNodeRemovedDelta, AgentTreeNodeStatusChangedDelta, AgentTreePendingSpawnStartedDelta, AgentTreeSnapshot, AgentTreeUpdateInboundPayload, AgentTreeUpdateOutboundPayload, ApiMessage, ApiUpdateMachineState, ApiUpdateNewMessage, ApiUpdateSessionState, CanonicalRequestFields, CloudflareAccessServiceToken, CoreUpdateBody, CoreUpdateContainer, CreateEnvelopeOptions, CreatePublicPairingInviteInput, LedgerErrorCode, LedgerRecord, LegacyMessageContent, MachineTunnel, MessageContent, MessageMeta, NonRenderableEntry, PublicDeviceAuthTestVector, PublicPairingInvite, PublicPairingInviteTestVector, PublicRequestVerification, PublicSignedRequestEnvelope, RawClaudeMessageMatchInput, ReceiverRegexFactory, SenderKeys, SessionAgentConfigurationChangedEvent, SessionContextBoundaryEvent, SessionContextBoundaryKind, SessionContextBoundaryTriggeredBy, SessionEnvelope, SessionEvent, SessionGetAgentTreeRequest, SessionGetAgentTreeResponse, SessionMessage, SessionMessageConsumptionEvent, SessionMessageContent, SessionMessageRangeRequest, SessionMessageRangeResponse, SessionProtocolMessage, SessionRole, SessionTurnEndStatus, SignPublicRequestInput, TofuHandshakeMessage, TofuPubkeysEvent, TofuPublicKeys, TofuSessionKeyExchange, Update, UpdateBody, UpdateMachineBody, UpdateNewMessageBody, UpdateSessionBody, UserMessage, VerifyPublicRequestContext, VersionedEncryptedValue, VersionedMachineEncryptedValue, VersionedNullableEncryptedValue, VoiceConversationResponse, VoiceUsageResponse };
