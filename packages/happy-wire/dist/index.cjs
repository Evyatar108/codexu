'use strict';

var z = require('zod');
var cuid2 = require('@paralleldrive/cuid2');
var ed = require('@noble/ed25519');
var sha2_js = require('@noble/hashes/sha2.js');

function _interopNamespaceDefault(e) {
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var z__namespace = /*#__PURE__*/_interopNamespaceDefault(z);
var ed__namespace = /*#__PURE__*/_interopNamespaceDefault(ed);

const sessionRoleSchema = z__namespace.union([z__namespace.literal("user"), z__namespace.literal("agent")]);
const sessionTextEventSchema = z__namespace.object({
  t: z__namespace.literal("text"),
  text: z__namespace.string(),
  thinking: z__namespace.boolean().optional()
});
const sessionServiceMessageEventSchema = z__namespace.object({
  t: z__namespace.literal("service"),
  text: z__namespace.string()
});
const sessionToolCallStartEventSchema = z__namespace.object({
  t: z__namespace.literal("tool-call-start"),
  call: z__namespace.string(),
  name: z__namespace.string(),
  title: z__namespace.string(),
  description: z__namespace.string(),
  args: z__namespace.record(z__namespace.string(), z__namespace.unknown()),
  permissionRequestId: z__namespace.string().optional()
});
const sessionToolCallEndEventSchema = z__namespace.object({
  t: z__namespace.literal("tool-call-end"),
  call: z__namespace.string()
});
const sessionFileEventSchema = z__namespace.object({
  t: z__namespace.literal("file"),
  ref: z__namespace.string(),
  name: z__namespace.string(),
  size: z__namespace.number(),
  mimeType: z__namespace.string().optional(),
  image: z__namespace.object({
    width: z__namespace.number(),
    height: z__namespace.number(),
    thumbhash: z__namespace.string()
  }).optional()
});
const sessionTurnStartEventSchema = z__namespace.object({
  t: z__namespace.literal("turn-start")
});
const sessionStartEventSchema = z__namespace.object({
  t: z__namespace.literal("start"),
  title: z__namespace.string().optional()
});
const sessionTurnEndStatusSchema = z__namespace.enum(["completed", "failed", "cancelled"]);
const sessionTurnEndEventSchema = z__namespace.object({
  t: z__namespace.literal("turn-end"),
  status: sessionTurnEndStatusSchema
});
const sessionStopEventSchema = z__namespace.object({
  t: z__namespace.literal("stop")
});
const sessionContextBoundaryKindSchema = z__namespace.enum([
  "clear",
  "compact",
  "autocompact",
  "plan-mode-enter",
  "plan-mode-exit",
  "session-fork-resume"
]);
const sessionContextBoundaryTriggeredBySchema = z__namespace.enum(["user", "agent", "system"]);
const sessionContextBoundaryEventSchema = z__namespace.object({
  t: z__namespace.literal("context-boundary"),
  kind: sessionContextBoundaryKindSchema,
  at: z__namespace.number(),
  /**
   * Boundary source mapping: 'user' for explicit user commands such as /clear,
   * 'agent' for model/agent-initiated lifecycle transitions, and 'system' for
   * Happy runtime or synchronization events.
   */
  triggeredBy: sessionContextBoundaryTriggeredBySchema,
  summaryRef: z__namespace.string().optional(),
  forkedFromSid: z__namespace.string().optional()
});
const sessionAgentConfigurationChangedEventSchema = z__namespace.object({
  t: z__namespace.literal("agent-configuration-changed"),
  permissionMode: z__namespace.string().nullable().optional(),
  model: z__namespace.string().nullable().optional(),
  thinkingLevel: z__namespace.string().nullable().optional(),
  sandbox: z__namespace.string().nullable().optional()
});
const sessionMessageConsumptionEventSchema = z__namespace.object({
  t: z__namespace.literal("message-consumption"),
  messageId: z__namespace.string(),
  consumedAt: z__namespace.number(),
  agentFlavor: z__namespace.enum(["claude", "codex"])
});
const sessionCopilotPromptEventSchema = z__namespace.object({
  t: z__namespace.literal("copilot-prompt"),
  requestId: z__namespace.string(),
  promptType: z__namespace.enum([
    "answer-permission",
    "answer-elicitation",
    "answer-plan",
    "answer-ask-user"
  ]),
  state: z__namespace.enum(["pending", "resolved"]),
  destructive: z__namespace.boolean(),
  payload: z__namespace.record(z__namespace.string(), z__namespace.unknown()).optional()
});
const sessionCopilotControlEventSchema = z__namespace.object({
  t: z__namespace.literal("copilot-control"),
  state: z__namespace.enum(["no-lease", "requested", "active"]),
  reason: z__namespace.enum(["keystroke", "expired", "released", "detached"]).optional(),
  requestId: z__namespace.string().optional(),
  leaseId: z__namespace.string().optional(),
  expiresAt: z__namespace.number().optional(),
  heartbeatIntervalMs: z__namespace.number().int().positive().optional(),
  leaseTtlMs: z__namespace.number().int().positive().optional()
});
const sessionEventSchema = z__namespace.discriminatedUnion("t", [
  sessionTextEventSchema,
  sessionServiceMessageEventSchema,
  sessionToolCallStartEventSchema,
  sessionToolCallEndEventSchema,
  sessionFileEventSchema,
  sessionTurnStartEventSchema,
  sessionStartEventSchema,
  sessionTurnEndEventSchema,
  sessionStopEventSchema,
  sessionContextBoundaryEventSchema,
  sessionAgentConfigurationChangedEventSchema,
  sessionMessageConsumptionEventSchema,
  sessionCopilotPromptEventSchema,
  sessionCopilotControlEventSchema
]);
const sessionEnvelopeSchema = z__namespace.object({
  id: z__namespace.string(),
  time: z__namespace.number(),
  role: sessionRoleSchema,
  turn: z__namespace.string().optional(),
  subagent: z__namespace.string().refine((value) => cuid2.isCuid(value), {
    message: "subagent must be a cuid2 value"
  }).optional(),
  ev: sessionEventSchema
}).superRefine((envelope, ctx) => {
  if (envelope.ev.t === "service" && envelope.role !== "agent") {
    ctx.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      message: 'service events must use role "agent"',
      path: ["role"]
    });
  }
  if ((envelope.ev.t === "start" || envelope.ev.t === "stop") && envelope.role !== "agent") {
    ctx.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      message: `${envelope.ev.t} events must use role "agent"`,
      path: ["role"]
    });
  }
});
function createEnvelope(role, ev, opts = {}) {
  return sessionEnvelopeSchema.parse({
    id: opts.id ?? cuid2.createId(),
    time: opts.time ?? Date.now(),
    role,
    ...opts.turn ? { turn: opts.turn } : {},
    ...opts.subagent ? { subagent: opts.subagent } : {},
    ev
  });
}

const MessageMetaSchema = z__namespace.object({
  sentFrom: z__namespace.string().optional(),
  permissionMode: z__namespace.enum(["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]).optional(),
  model: z__namespace.string().nullable().optional(),
  thinkingLevel: z__namespace.string().nullable().optional(),
  fallbackModel: z__namespace.string().nullable().optional(),
  customSystemPrompt: z__namespace.string().nullable().optional(),
  appendSystemPrompt: z__namespace.string().nullable().optional(),
  allowedTools: z__namespace.array(z__namespace.string()).nullable().optional(),
  disallowedTools: z__namespace.array(z__namespace.string()).nullable().optional(),
  displayText: z__namespace.string().optional(),
  attachmentRefs: z__namespace.array(z__namespace.object({
    remotePath: z__namespace.string(),
    name: z__namespace.string(),
    size: z__namespace.number()
  })).optional(),
  contextBoundaryFallback: z__namespace.boolean().optional()
});

const UserMessageAttachmentSchema = z__namespace.object({
  type: z__namespace.literal("image"),
  ref: z__namespace.string(),
  mimeType: z__namespace.string().optional()
});
const UserMessageSchema = z__namespace.object({
  role: z__namespace.literal("user"),
  content: z__namespace.object({
    type: z__namespace.literal("text"),
    text: z__namespace.string(),
    attachments: z__namespace.array(UserMessageAttachmentSchema).optional()
  }),
  localKey: z__namespace.string().optional(),
  meta: MessageMetaSchema.optional()
});
const AgentMessageSchema = z__namespace.object({
  role: z__namespace.literal("agent"),
  content: z__namespace.object({
    type: z__namespace.string()
  }).passthrough(),
  meta: MessageMetaSchema.optional()
});
const LegacyMessageContentSchema = z__namespace.discriminatedUnion("role", [UserMessageSchema, AgentMessageSchema]);

const SessionMessageContentSchema = z__namespace.object({
  c: z__namespace.string(),
  t: z__namespace.literal("encrypted")
});
const SessionMessageSchema = z__namespace.object({
  id: z__namespace.string(),
  seq: z__namespace.number(),
  localId: z__namespace.string().nullish(),
  content: SessionMessageContentSchema,
  createdAt: z__namespace.number(),
  updatedAt: z__namespace.number()
});
const SessionMessageRangeRequestSchema = z__namespace.object({
  requestId: z__namespace.string(),
  sessionId: z__namespace.string(),
  fromSeq: z__namespace.number().int().min(0),
  toSeq: z__namespace.number().int(),
  limit: z__namespace.number().int().min(1).max(200)
}).refine((request) => request.toSeq >= request.fromSeq, {
  path: ["toSeq"],
  message: "toSeq must be greater than or equal to fromSeq"
});
const SessionMessageRangeResponseSchema = z__namespace.discriminatedUnion("ok", [
  z__namespace.object({
    ok: z__namespace.literal(true),
    requestId: z__namespace.string(),
    sessionId: z__namespace.string(),
    fromSeq: z__namespace.number().int(),
    toSeq: z__namespace.number().int(),
    messages: z__namespace.array(SessionMessageSchema),
    hasMore: z__namespace.boolean()
  }),
  z__namespace.object({
    ok: z__namespace.literal(false),
    requestId: z__namespace.string(),
    error: z__namespace.object({
      code: z__namespace.enum(["session_not_found", "invalid_range", "rate_limited", "internal"]),
      message: z__namespace.string()
    })
  })
]);
const SessionProtocolMessageSchema = z__namespace.object({
  role: z__namespace.literal("session"),
  content: sessionEnvelopeSchema,
  meta: MessageMetaSchema.optional()
});
const MessageContentSchema = z__namespace.discriminatedUnion("role", [
  UserMessageSchema,
  AgentMessageSchema,
  SessionProtocolMessageSchema
]);
const VersionedEncryptedValueSchema = z__namespace.object({
  version: z__namespace.number(),
  value: z__namespace.string()
});
const VersionedNullableEncryptedValueSchema = z__namespace.object({
  version: z__namespace.number(),
  value: z__namespace.string().nullable()
});
const UpdateNewMessageBodySchema = z__namespace.object({
  t: z__namespace.literal("new-message"),
  sid: z__namespace.string(),
  message: SessionMessageSchema
});
const UpdateSessionBodySchema = z__namespace.object({
  t: z__namespace.literal("update-session"),
  id: z__namespace.string(),
  metadata: VersionedEncryptedValueSchema.nullish(),
  agentState: VersionedNullableEncryptedValueSchema.nullish()
});
const VersionedMachineEncryptedValueSchema = z__namespace.object({
  version: z__namespace.number(),
  value: z__namespace.string()
});
const UpdateMachineBodySchema = z__namespace.object({
  t: z__namespace.literal("update-machine"),
  machineId: z__namespace.string(),
  metadata: VersionedMachineEncryptedValueSchema.nullish(),
  daemonState: VersionedMachineEncryptedValueSchema.nullish(),
  active: z__namespace.boolean().optional(),
  activeAt: z__namespace.number().optional()
});
const CoreUpdateBodySchema = z__namespace.discriminatedUnion("t", [
  UpdateNewMessageBodySchema,
  UpdateSessionBodySchema,
  UpdateMachineBodySchema
]);
const CoreUpdateContainerSchema = z__namespace.object({
  id: z__namespace.string(),
  seq: z__namespace.number(),
  body: CoreUpdateBodySchema,
  createdAt: z__namespace.number()
});
const ApiMessageSchema = SessionMessageSchema;
const ApiUpdateNewMessageSchema = UpdateNewMessageBodySchema;
const ApiUpdateSessionStateSchema = UpdateSessionBodySchema;
const ApiUpdateMachineStateSchema = UpdateMachineBodySchema;
const UpdateBodySchema = UpdateNewMessageBodySchema;
const UpdateSchema = CoreUpdateContainerSchema;

const TofuPublicKeysSchema = z__namespace.object({
  ed25519PublicKey: z__namespace.string().min(1),
  x25519PublicKey: z__namespace.string().min(1),
  ed25519Fingerprint: z__namespace.string().min(1).optional()
});
const TofuPubkeysEventSchema = z__namespace.object({
  t: z__namespace.literal("tofu-pubkeys"),
  keys: TofuPublicKeysSchema
});
const TofuSessionKeyExchangeSchema = z__namespace.object({
  t: z__namespace.literal("tofu-session-key"),
  machineId: z__namespace.string().min(1),
  mobileX25519PublicKey: z__namespace.string().min(1),
  serverX25519PublicKey: z__namespace.string().min(1),
  sessionKey: z__namespace.string().min(1),
  firstSeenAt: z__namespace.number()
});
const TofuHandshakeMessageSchema = z__namespace.discriminatedUnion("t", [
  TofuPubkeysEventSchema,
  TofuSessionKeyExchangeSchema
]);

const VoiceConversationGrantedSchema = z__namespace.object({
  allowed: z__namespace.literal(true),
  conversationToken: z__namespace.string(),
  conversationId: z__namespace.string(),
  agentId: z__namespace.string(),
  elevenUserId: z__namespace.string(),
  usedSeconds: z__namespace.number(),
  limitSeconds: z__namespace.number()
});
const VoiceConversationDeniedSchema = z__namespace.object({
  allowed: z__namespace.literal(false),
  reason: z__namespace.enum(["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]),
  usedSeconds: z__namespace.number(),
  limitSeconds: z__namespace.number(),
  agentId: z__namespace.string()
});
const VoiceConversationResponseSchema = z__namespace.discriminatedUnion("allowed", [
  VoiceConversationGrantedSchema,
  VoiceConversationDeniedSchema
]);
const VoiceUsageResponseSchema = z__namespace.object({
  usedSeconds: z__namespace.number(),
  limitSeconds: z__namespace.number(),
  conversationCount: z__namespace.number(),
  conversationLimit: z__namespace.number(),
  elevenUserId: z__namespace.string()
});

const SKILL_BODY_PREFIX_RE = /^Base directory for this skill: \S[^\r\n]*\r?\n\r?\n# /;
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isMatchInput(raw) {
  return isRecord(raw) && typeof raw.type === "string" && isRecord(raw.message) && "content" in raw.message;
}
function getUserContentShape(raw) {
  if (raw.type !== "user") {
    return null;
  }
  const { content } = raw.message;
  if (typeof content === "string") {
    return { shape: "string", text: content };
  }
  if (Array.isArray(content) && content.length === 1) {
    const [block] = content;
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      return { shape: "array1", text: block.text };
    }
  }
  return null;
}
function makeWrappedTagEntry(tagName, opts) {
  const inlineSource = `<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`;
  const standaloneLineSource = `(^|\\n)<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>(\\n|$)`;
  const entry = {
    name: tagName,
    receiverMatchSite: "wrapped-tag",
    receiverRegexes: {
      buildInlineRe: () => new RegExp(inlineSource, "gi"),
      buildStandaloneLineRe: () => new RegExp(standaloneLineSource, "gi")
    }
  };
  if (opts?.enableSender) {
    const fullStringRe = new RegExp("^\\s*" + inlineSource + "\\s*$", "i");
    entry.senderPredicate = (raw) => {
      const shaped = getUserContentShape(raw);
      return shaped !== null && shaped.shape === "string" && fullStringRe.test(shaped.text);
    };
  }
  return entry;
}
const skillBodyEntry = {
  name: "skill-body",
  receiverMatchSite: "skill-body-prefix",
  receiverPrefix: SKILL_BODY_PREFIX_RE,
  senderPredicate: (raw) => {
    const shaped = getUserContentShape(raw);
    return shaped !== null && shaped.shape === "array1" && SKILL_BODY_PREFIX_RE.test(shaped.text);
  }
};
const localCommandCaveatEntry = makeWrappedTagEntry("local-command-caveat", { enableSender: true });
const systemReminderEntry = makeWrappedTagEntry("system-reminder");
const forkBoilerplateEntry = makeWrappedTagEntry("fork-boilerplate");
const nonRenderableEntries = [
  skillBodyEntry,
  localCommandCaveatEntry,
  systemReminderEntry,
  forkBoilerplateEntry
];
function findSenderDropEntry(raw) {
  if (!isMatchInput(raw)) {
    return null;
  }
  return nonRenderableEntries.find((entry) => entry.senderPredicate?.(raw)) ?? null;
}

const payloadSchema = z__namespace.record(z__namespace.unknown()).optional();
const safePathComponent = z__namespace.string().regex(/^[A-Za-z0-9_-]+$/);
const baseLedgerRecordSchema = z__namespace.object({
  runId: safePathComponent,
  sessionId: safePathComponent,
  timestamp: z__namespace.string().datetime(),
  seqWithinSession: z__namespace.number().int().nonnegative().optional()
});
const LedgerErrorCodeSchema = z__namespace.enum([
  "spawn-failed",
  "wrong-account",
  "timeout",
  "crash",
  "ledger-write-failed",
  "monitor-failure"
]);
const SpawnLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("spawn"),
  agent: z__namespace.string().min(1),
  projectPath: z__namespace.string().min(1),
  worktreePath: z__namespace.string().min(1),
  branchName: z__namespace.string().min(1).optional(),
  payload: payloadSchema
});
const MessageSentLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("message-sent"),
  direction: z__namespace.enum(["user-to-agent", "agent-to-server"]),
  messageId: z__namespace.string().min(1).optional(),
  messagePreview: z__namespace.string().optional(),
  payload: payloadSchema
});
const IdleReachedLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("idle-reached"),
  queueDepth: z__namespace.number().int().nonnegative(),
  payload: payloadSchema
});
const PendingPermissionLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("pending-permission"),
  requestIds: z__namespace.array(z__namespace.string().min(1)),
  payload: payloadSchema
});
const LastOutputSummaryLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("last-output-summary"),
  summary: z__namespace.string(),
  heuristic: z__namespace.enum(["assistant-text", "tool-result", "server-summary"]),
  payload: payloadSchema
});
const ValidationAttachedLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("validation-attached"),
  testReference: z__namespace.string().min(1),
  verificationUrl: z__namespace.string().url(),
  payload: payloadSchema
});
const DoneLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("done"),
  scopeSummary: z__namespace.string().min(1),
  testReference: z__namespace.string().min(1),
  verificationUrl: z__namespace.string().url(),
  caveats: z__namespace.array(z__namespace.string()),
  payload: payloadSchema
});
const ErrorLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z__namespace.literal("error"),
  errorCode: LedgerErrorCodeSchema,
  errorMessage: z__namespace.string().min(1),
  payload: payloadSchema
});
const LedgerRecordSchema = z__namespace.discriminatedUnion("eventType", [
  SpawnLedgerRecordSchema,
  MessageSentLedgerRecordSchema,
  IdleReachedLedgerRecordSchema,
  PendingPermissionLedgerRecordSchema,
  LastOutputSummaryLedgerRecordSchema,
  ValidationAttachedLedgerRecordSchema,
  DoneLedgerRecordSchema,
  ErrorLedgerRecordSchema
]);

const AgentTreeNodeSchema = z__namespace.object({
  threadId: z__namespace.string(),
  agentRole: z__namespace.string(),
  nickname: z__namespace.string().nullable(),
  status: z__namespace.string(),
  lastTaskMessage: z__namespace.string().optional(),
  spawnedAt: z__namespace.number()
});
const AgentTreeEdgeSchema = z__namespace.object({
  parent: z__namespace.string(),
  child: z__namespace.string()
});
const AgentTreeSnapshotSchema = z__namespace.object({
  nodes: z__namespace.array(AgentTreeNodeSchema),
  edges: z__namespace.array(AgentTreeEdgeSchema),
  seq: z__namespace.number()
});
const AgentTreePendingSpawnStartedDeltaSchema = z__namespace.object({
  type: z__namespace.literal("pending-spawn-started"),
  seq: z__namespace.number(),
  callId: z__namespace.string(),
  parentThreadId: z__namespace.string(),
  agentRole: z__namespace.string(),
  nickname: z__namespace.string().nullable(),
  taskMessage: z__namespace.string().optional(),
  startedAt: z__namespace.number()
});
const AgentTreeNodeAddedDeltaSchema = z__namespace.object({
  type: z__namespace.literal("node-added"),
  seq: z__namespace.number(),
  node: AgentTreeNodeSchema,
  edge: AgentTreeEdgeSchema
});
const AgentTreeNodeStatusChangedDeltaSchema = z__namespace.object({
  type: z__namespace.literal("node-status-changed"),
  seq: z__namespace.number(),
  threadId: z__namespace.string(),
  status: z__namespace.string(),
  lastTaskMessage: z__namespace.string().optional()
});
const AgentTreeNodeRemovedDeltaSchema = z__namespace.object({
  type: z__namespace.literal("node-removed"),
  seq: z__namespace.number(),
  threadId: z__namespace.string()
});
const AgentTreeDeltaSchema = z__namespace.discriminatedUnion("type", [
  AgentTreePendingSpawnStartedDeltaSchema,
  AgentTreeNodeAddedDeltaSchema,
  AgentTreeNodeStatusChangedDeltaSchema,
  AgentTreeNodeRemovedDeltaSchema
]);
const AgentTreeUpdateInboundPayloadSchema = z__namespace.object({
  delta: AgentTreeDeltaSchema
});
const AgentTreeUpdateOutboundPayloadSchema = z__namespace.object({
  sessionId: z__namespace.string(),
  delta: AgentTreeDeltaSchema
});
const SessionGetAgentTreeRequestSchema = z__namespace.object({
  sessionId: z__namespace.string()
});
const SessionGetAgentTreeResponseSchema = AgentTreeSnapshotSchema;

const MAX_HOPS = 4;
const AgentCommsScopeSchema = z__namespace.enum(["B", "C", "A"]);
const AgentCommsChannelSchema = z__namespace.enum(["message", "spawn"]);
const AgentCommsKindSchema = z__namespace.enum([
  "request",
  "reply",
  "notify",
  "spawn-request",
  "spawn-result"
]);
const AgentCommsFromSchema = z__namespace.object({
  machineId: z__namespace.string().min(1),
  sessionId: z__namespace.string().min(1)
});
const AgentCommsToSchema = z__namespace.object({
  machineId: z__namespace.string().min(1).optional(),
  sessionId: z__namespace.string().min(1)
});
const AgentCommsEnvelopeSchema = z__namespace.object({
  v: z__namespace.literal(1),
  id: z__namespace.string().min(1),
  ts: z__namespace.number().int().nonnegative(),
  from: AgentCommsFromSchema,
  to: AgentCommsToSchema,
  scope: AgentCommsScopeSchema,
  channel: AgentCommsChannelSchema,
  kind: AgentCommsKindSchema,
  correlationId: z__namespace.string().min(1).optional(),
  hopCount: z__namespace.number().int().min(0).max(MAX_HOPS),
  hopPath: z__namespace.array(z__namespace.string().min(1)),
  body: z__namespace.unknown()
});
const SenderKeysSchema = z__namespace.object({
  ed25519PublicKey: z__namespace.string().min(1),
  ecdhPublicKey: z__namespace.string().min(1),
  ed25519Fingerprint: z__namespace.string().min(1).optional()
});
const AgentCommsIngestBodySchema = z__namespace.object({
  envelope: AgentCommsEnvelopeSchema,
  signature: z__namespace.string().min(1),
  senderKeys: SenderKeysSchema
});
function hasDuplicate(values) {
  return new Set(values).size !== values.length;
}
function routeHopValidation(envelope) {
  if (envelope.hopCount > MAX_HOPS) return `hopCount ${envelope.hopCount} exceeds MAX_HOPS ${MAX_HOPS}`;
  if (hasDuplicate(envelope.hopPath)) return "hopPath contains a duplicate session";
  const targetRefs = /* @__PURE__ */ new Set([envelope.to.sessionId]);
  if (envelope.to.machineId) targetRefs.add(`${envelope.to.machineId}:${envelope.to.sessionId}`);
  return envelope.hopPath.some((ref) => targetRefs.has(ref)) ? "hopPath already contains the target session" : null;
}

ed__namespace.hashes.sha512 = (message) => sha2_js.sha512(message);
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();
function encodeBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const hasByte1 = i + 1 < bytes.length;
    const hasByte2 = i + 2 < bytes.length;
    const b0 = bytes[i];
    const b1 = hasByte1 ? bytes[i + 1] : 0;
    const b2 = hasByte2 ? bytes[i + 2] : 0;
    const triple = b0 << 16 | b1 << 8 | b2;
    out += BASE64_ALPHABET[triple >> 18 & 63];
    out += BASE64_ALPHABET[triple >> 12 & 63];
    out += hasByte1 ? BASE64_ALPHABET[triple >> 6 & 63] : "=";
    out += hasByte2 ? BASE64_ALPHABET[triple & 63] : "=";
  }
  return out;
}
function decodeBase64(text) {
  let clean = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128 && BASE64_LOOKUP[code] !== -1) {
      clean += text[i];
    } else if (text[i] !== "=" && text[i] !== "\n" && text[i] !== "\r" && text[i] !== " " && text[i] !== "	") {
      throw new Error("invalid base64 input");
    }
  }
  const outLen = Math.floor(clean.length * 3 / 4);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let oi = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = acc << 6 | BASE64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[oi++] = acc >> bits & 255;
    }
  }
  return out;
}
const PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION = 1;
const PUBLIC_DEVICE_PROOF_DOMAIN = "happy-public-device-proof/v1";
const PUBLIC_DEVICE_PROOF_HEADER = "x-happy-device-proof";
const PUBLIC_DEVICE_PROOF_FRESHNESS_MS = 5 * 60 * 1e3;
const PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS = 60 * 1e3;
const PublicSignedRequestEnvelopeSchema = z__namespace.object({
  v: z__namespace.literal(PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION),
  keyId: z__namespace.string().min(1),
  publicKey: z__namespace.string().min(1),
  nonce: z__namespace.string().min(1),
  issuedAt: z__namespace.number().int().nonnegative(),
  method: z__namespace.string().min(1),
  path: z__namespace.string().min(1),
  bodyHash: z__namespace.string().min(1),
  signature: z__namespace.string().min(1)
});
function normalizeMethod(method) {
  return method.toUpperCase();
}
function canonicalRequestStringToSign(fields) {
  return [
    PUBLIC_DEVICE_PROOF_DOMAIN,
    normalizeMethod(fields.method),
    canonicalizePublicRequestTarget(fields.path),
    fields.keyId,
    fields.publicKey,
    fields.nonce,
    String(fields.issuedAt),
    fields.bodyHash
  ].join("\n");
}
function canonicalizePublicRequestTarget(target) {
  if (!target.startsWith("/") || target.includes("#") || /[\u0000-\u001f\u007f]/.test(target)) {
    throw new Error("invalid proof target");
  }
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] === "%" && !/^[0-9A-Fa-f]{2}$/.test(target.slice(index + 1, index + 3))) {
      throw new Error("invalid proof target encoding");
    }
  }
  const parsed = new URL(`http://localhost${target}`);
  const pairs = Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = compareUtf8$1(leftKey, rightKey);
    return keyOrder !== 0 ? keyOrder : compareUtf8$1(leftValue, rightValue);
  });
  const query = new URLSearchParams();
  for (const [key, value] of pairs) {
    query.append(key, value);
  }
  const encoded = query.toString();
  return encoded ? `${parsed.pathname}?${encoded}` : parsed.pathname;
}
function compareUtf8$1(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}
function hashRequestBody(body) {
  let bytes;
  if (body == null) {
    bytes = new Uint8Array();
  } else if (typeof body === "string") {
    bytes = new TextEncoder().encode(body);
  } else {
    bytes = body;
  }
  return encodeBase64(sha2_js.sha256(bytes));
}
function generatePublicRequestNonce(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return encodeBase64(bytes);
}
async function signPublicRequest(input, secretKey) {
  const method = normalizeMethod(input.method);
  const path = canonicalizePublicRequestTarget(input.path);
  const publicKey = encodeBase64(await ed__namespace.getPublicKeyAsync(secretKey));
  const canonical = canonicalRequestStringToSign({
    method,
    path,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    bodyHash: input.bodyHash
  });
  const signature = encodeBase64(await ed__namespace.signAsync(new TextEncoder().encode(canonical), secretKey));
  return {
    v: PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    method,
    path,
    bodyHash: input.bodyHash,
    signature
  };
}
async function verifyPublicRequest(envelope, context) {
  const parsed = PublicSignedRequestEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const env = parsed.data;
  if (normalizeMethod(env.method) !== normalizeMethod(context.method)) {
    return { ok: false, reason: "method_mismatch" };
  }
  let target;
  try {
    target = canonicalizePublicRequestTarget(context.path);
  } catch {
    return { ok: false, reason: "path_mismatch" };
  }
  if (env.path !== target) {
    return { ok: false, reason: "path_mismatch" };
  }
  if (context.bodyHash !== void 0 && env.bodyHash !== context.bodyHash) {
    return { ok: false, reason: "body_hash_mismatch" };
  }
  if (context.expectedPublicKey !== void 0 && env.publicKey !== context.expectedPublicKey) {
    return { ok: false, reason: "public_key_mismatch" };
  }
  let publicKeyBytes;
  let signatureBytes;
  try {
    publicKeyBytes = decodeBase64(env.publicKey);
    signatureBytes = decodeBase64(env.signature);
  } catch {
    return { ok: false, reason: "invalid_base64" };
  }
  if (publicKeyBytes.length !== 32) {
    return { ok: false, reason: "invalid_public_key_length" };
  }
  if (signatureBytes.length !== 64) {
    return { ok: false, reason: "invalid_signature_length" };
  }
  const canonical = canonicalRequestStringToSign(env);
  let valid = false;
  try {
    valid = await ed__namespace.verifyAsync(signatureBytes, new TextEncoder().encode(canonical), publicKeyBytes);
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: "signature_invalid" };
}
function isPublicProofFresh(issuedAt, now, windowMs = PUBLIC_DEVICE_PROOF_FRESHNESS_MS, clockSkewMs = PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS) {
  return issuedAt <= now + clockSkewMs && issuedAt >= now - windowMs;
}
function encodePublicDeviceProofHeader(envelope) {
  return encodeBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}
function decodePublicDeviceProofHeader(header) {
  if (!header) {
    return null;
  }
  try {
    const json = new TextDecoder().decode(decodeBase64(header));
    const parsed = PublicSignedRequestEnvelopeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
const PUBLIC_DEVICE_AUTH_TEST_VECTOR = {
  seedHex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  keyId: "device-test-key",
  publicKeyBase64: "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=",
  nonceBase64: "bm9uY2UtMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  issuedAt: 17356896e5,
  method: "POST",
  path: "/pair/connect",
  body: '{"mobileEcdhPublicKey":"AAECAwQFBgcICQoLDA0ODw=="}',
  bodyHashBase64: "x4jOxy7m4ahMoun9VgIPk36KVKoOaXa7IbYZChfDhiw=",
  canonicalString: "happy-public-device-proof/v1\nPOST\n/pair/connect\ndevice-test-key\nA6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=\nbm9uY2UtMDAwMDAwMDAwMDAwMDAwMDAwMDA=\n1735689600000\nx4jOxy7m4ahMoun9VgIPk36KVKoOaXa7IbYZChfDhiw=",
  signatureBase64: "6A31zge0s5yf6XHqLDAp4gdtZ5k0nzSJIk1YF5IdfXiY8kL/5MqAjvNFSgSWN7rDmYD8F21Md+C2R8cRAFzlBw==",
  envelope: {
    v: PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: "device-test-key",
    publicKey: "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=",
    nonce: "bm9uY2UtMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
    issuedAt: 17356896e5,
    method: "POST",
    path: "/pair/connect",
    bodyHash: "x4jOxy7m4ahMoun9VgIPk36KVKoOaXa7IbYZChfDhiw=",
    signature: "6A31zge0s5yf6XHqLDAp4gdtZ5k0nzSJIk1YF5IdfXiY8kL/5MqAjvNFSgSWN7rDmYD8F21Md+C2R8cRAFzlBw=="
  },
  headerBase64: "eyJ2IjoxLCJrZXlJZCI6ImRldmljZS10ZXN0LWtleSIsInB1YmxpY0tleSI6IkE2RUh2L1BPRUw0ZGNOMFk1MHZBbVdmazFqQ2JwUTFmSGR5R1pCSlZNYmc9Iiwibm9uY2UiOiJibTl1WTJVdE1EQXdNREF3TURBd01EQXdNREF3TURBd01EQT0iLCJpc3N1ZWRBdCI6MTczNTY4OTYwMDAwMCwibWV0aG9kIjoiUE9TVCIsInBhdGgiOiIvcGFpci9jb25uZWN0IiwiYm9keUhhc2giOiJ4NGpPeHk3bTRhaE1vdW45VmdJUGszNktWS29PYVhhN0liWVpDaGZEaGl3PSIsInNpZ25hdHVyZSI6IjZBMzF6Z2UwczV5ZjZYSHFMREFwNGdkdFo1azBuelNKSWsxWUY1SWRmWGlZOGtMLzVNcUFqdk5GU2dTV043ckRtWUQ4RjIxTWQrQzJSOGNSQUZ6bEJ3PT0ifQ=="
};

const PUBLIC_PAIRING_INVITE_VERSION = 1;
const PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS = 10 * 60 * 1e3;
const CloudflareAccessServiceTokenSchema = z__namespace.object({
  clientId: z__namespace.string().min(1),
  clientSecret: z__namespace.string().min(1)
});
const PublicPairingInviteSchema = z__namespace.object({
  version: z__namespace.literal(PUBLIC_PAIRING_INVITE_VERSION),
  serverUrl: z__namespace.string().url(),
  machineId: z__namespace.string().min(1),
  pairSecret: z__namespace.string().min(1),
  cloudflareAccess: CloudflareAccessServiceTokenSchema,
  issuedAt: z__namespace.string().datetime(),
  expiresAt: z__namespace.string().datetime()
});
function generatePairSecret(byteLength = 24) {
  return generatePublicRequestNonce(byteLength);
}
function toDate(value) {
  if (value === void 0) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date supplied to public pairing invite");
  }
  return date;
}
function createPublicPairingInvite(input) {
  const issuedAtDate = toDate(input.issuedAt) ?? /* @__PURE__ */ new Date();
  const ttlMs = input.ttlMs ?? PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS;
  const expiresAtDate = toDate(input.expiresAt) ?? new Date(issuedAtDate.getTime() + ttlMs);
  return PublicPairingInviteSchema.parse({
    version: PUBLIC_PAIRING_INVITE_VERSION,
    serverUrl: input.serverUrl,
    machineId: input.machineId,
    pairSecret: input.pairSecret ?? generatePairSecret(),
    cloudflareAccess: {
      clientId: input.cloudflareAccess.clientId,
      clientSecret: input.cloudflareAccess.clientSecret
    },
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString()
  });
}
function isPublicPairingInviteValid(invite, now = /* @__PURE__ */ new Date()) {
  const parsed = PublicPairingInviteSchema.safeParse(invite);
  if (!parsed.success) return false;
  const issuedAt = new Date(parsed.data.issuedAt).getTime();
  const expiresAt = new Date(parsed.data.expiresAt).getTime();
  const nowMs = now.getTime();
  return nowMs >= issuedAt && nowMs <= expiresAt;
}
function toBase64Url$1(text) {
  const bytes = new TextEncoder().encode(text);
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(token) {
  const standard = token.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(decodeBase64(standard));
}
function encodePublicPairingInvite(invite) {
  const validated = PublicPairingInviteSchema.parse(invite);
  return toBase64Url$1(JSON.stringify(validated));
}
function decodePublicPairingInvite(token) {
  if (!token) return null;
  let json;
  try {
    json = fromBase64Url(token.trim());
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = PublicPairingInviteSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
const PUBLIC_PAIRING_INVITE_TEST_VECTOR = (() => {
  const invite = {
    version: PUBLIC_PAIRING_INVITE_VERSION,
    serverUrl: "https://happy.example.com",
    machineId: "machine-test-0001",
    pairSecret: "cGFpci1zZWNyZXQtZml4dHVyZQ==",
    cloudflareAccess: {
      clientId: "cf-access-client-id.example",
      clientSecret: "cf-access-client-secret-value"
    },
    issuedAt: "2026-05-11T12:00:00.000Z",
    expiresAt: "2026-05-11T12:10:00.000Z"
  };
  return { invite, token: encodePublicPairingInvite(invite) };
})();

const LOCAL_PAIRING_INVITE_KIND = "happy-local-pairing";
const LOCAL_PAIRING_INVITE_VERSION = 1;
const LOCAL_PAIRING_AUTH_MODE = "paired-device";
const LOCAL_PAIRING_WINDOW_MS = 12e4;
const LOCAL_PAIRING_FORWARD_SKEW_MS = 3e4;
const LOCAL_PAIRING_SECRET_BYTES = 32;
const LOCAL_PAIRING_NONCE_BYTES = 24;
const LOCAL_PAIRING_SECRET_HEADER = "X-Happy-Pairing-Secret";
const LOCAL_PAIRING_NONCE_HEADER = "X-Happy-Pairing-Nonce";
const LocalPairingInviteShapeSchema = z__namespace.object({
  kind: z__namespace.literal(LOCAL_PAIRING_INVITE_KIND),
  version: z__namespace.literal(LOCAL_PAIRING_INVITE_VERSION),
  authMode: z__namespace.literal(LOCAL_PAIRING_AUTH_MODE),
  serverUrl: z__namespace.string().min(1),
  browserOrigin: z__namespace.string().min(1),
  machineId: z__namespace.string().min(1).max(256),
  pairSecret: z__namespace.string().min(1),
  pairingNonce: z__namespace.string().min(1),
  issuedAt: z__namespace.string().datetime(),
  expiresAt: z__namespace.string().datetime()
}).strict();
const LocalPairingInviteSchema = LocalPairingInviteShapeSchema.superRefine((invite, context) => {
  if (!isStrictLoopbackServerUrl(invite.serverUrl)) {
    context.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      path: ["serverUrl"],
      message: "serverUrl must be an explicit http://127.0.0.1:<port> origin"
    });
  }
  if (!isOrigin(invite.browserOrigin)) {
    context.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      path: ["browserOrigin"],
      message: "browserOrigin must be an exact URL origin"
    });
  }
  if (!isCanonicalBase64UrlBytes$1(invite.pairSecret, LOCAL_PAIRING_SECRET_BYTES)) {
    context.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      path: ["pairSecret"],
      message: `pairSecret must be ${LOCAL_PAIRING_SECRET_BYTES} canonical base64url bytes`
    });
  }
  if (!isCanonicalBase64UrlBytes$1(invite.pairingNonce, LOCAL_PAIRING_NONCE_BYTES)) {
    context.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      path: ["pairingNonce"],
      message: `pairingNonce must be ${LOCAL_PAIRING_NONCE_BYTES} canonical base64url bytes`
    });
  }
  const issuedAt = Date.parse(invite.issuedAt);
  const expiresAt = Date.parse(invite.expiresAt);
  if (expiresAt - issuedAt !== LOCAL_PAIRING_WINDOW_MS) {
    context.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: `pairing window must be exactly ${LOCAL_PAIRING_WINDOW_MS}ms`
    });
  }
});
function createLocalPairingInvite(input) {
  const issuedAt = parseDate(input.issuedAt) ?? /* @__PURE__ */ new Date();
  const expiresAt = parseDate(input.expiresAt) ?? new Date(issuedAt.getTime() + LOCAL_PAIRING_WINDOW_MS);
  return LocalPairingInviteSchema.parse({
    kind: LOCAL_PAIRING_INVITE_KIND,
    version: LOCAL_PAIRING_INVITE_VERSION,
    authMode: LOCAL_PAIRING_AUTH_MODE,
    serverUrl: input.serverUrl,
    browserOrigin: input.browserOrigin,
    machineId: input.machineId,
    pairSecret: input.pairSecret ?? generateLocalPairingSecret(),
    pairingNonce: input.pairingNonce ?? generateLocalPairingNonce(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  });
}
function encodeLocalPairingInvite(invite) {
  const validated = LocalPairingInviteSchema.parse(invite);
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(validated)));
}
function decodeLocalPairingInvite(token, expectedBrowserOrigin) {
  if (!token) {
    return null;
  }
  try {
    const bytes = decodeBase64Url(token.trim());
    const parsed = LocalPairingInviteSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    );
    if (!parsed.success) {
      return null;
    }
    if (expectedBrowserOrigin !== void 0 && parsed.data.browserOrigin !== expectedBrowserOrigin) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
function isLocalPairingInviteValid(invite, expectedBrowserOrigin, now = /* @__PURE__ */ new Date()) {
  const parsed = LocalPairingInviteSchema.safeParse(invite);
  if (!parsed.success || parsed.data.browserOrigin !== expectedBrowserOrigin) {
    return false;
  }
  const issuedAt = Date.parse(parsed.data.issuedAt);
  const expiresAt = Date.parse(parsed.data.expiresAt);
  const nowMs = now.getTime();
  return issuedAt <= nowMs + LOCAL_PAIRING_FORWARD_SKEW_MS && expiresAt > nowMs;
}
function generateLocalPairingSecret() {
  return toBase64Url(generatePublicRequestNonce(LOCAL_PAIRING_SECRET_BYTES));
}
function generateLocalPairingNonce() {
  return toBase64Url(generatePublicRequestNonce(LOCAL_PAIRING_NONCE_BYTES));
}
function encodeBase64Url(bytes) {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeBase64Url(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url input");
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const decoded = decodeBase64(padded);
  if (encodeBase64Url(decoded) !== value) {
    throw new Error("non-canonical base64url input");
  }
  return decoded;
}
function isStrictLoopbackServerUrl(value) {
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(value);
  if (!match) {
    return false;
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port === String(port) && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}
function isCanonicalBase64UrlBytes$1(value, byteLength) {
  try {
    return decodeBase64Url(value).length === byteLength;
  } catch {
    return false;
  }
}
function isOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}
function parseDate(value) {
  if (value === void 0) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Invalid date supplied to local pairing invite");
  }
  return date;
}
function toBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

ed__namespace.hashes.sha512 = (message) => sha2_js.sha512(message);
const LOCAL_DEVICE_PROOF_ENVELOPE_VERSION = 1;
const LOCAL_DEVICE_PROOF_DOMAIN = "happy-local-device-proof/v1";
const LOCAL_DEVICE_PROOF_HEADER = "X-Happy-Local-Device-Proof";
const LOCAL_DEVICE_PROOF_FRESHNESS_MS = 12e4;
const LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS = 3e4;
const LOCAL_DEVICE_PROOF_NONCE_BYTES = 24;
const LocalSignedRequestEnvelopeShapeSchema = z__namespace.object({
  v: z__namespace.literal(LOCAL_DEVICE_PROOF_ENVELOPE_VERSION),
  keyId: z__namespace.string().min(1).max(256),
  publicKey: z__namespace.string().min(1),
  nonce: z__namespace.string().min(1),
  issuedAt: z__namespace.number().int().nonnegative(),
  method: z__namespace.string().regex(/^[A-Z]+$/),
  target: z__namespace.string().min(1),
  bodyHash: z__namespace.string().min(1),
  signature: z__namespace.string().min(1)
}).strict();
const LocalSignedRequestEnvelopeSchema = LocalSignedRequestEnvelopeShapeSchema.superRefine((envelope, context) => {
  if (!isCanonicalBase64Bytes(envelope.publicKey, 32)) {
    context.addIssue({ code: z__namespace.ZodIssueCode.custom, path: ["publicKey"], message: "invalid Ed25519 public key" });
  }
  if (!isCanonicalBase64UrlBytes(envelope.nonce, LOCAL_DEVICE_PROOF_NONCE_BYTES)) {
    context.addIssue({ code: z__namespace.ZodIssueCode.custom, path: ["nonce"], message: "invalid proof nonce" });
  }
  try {
    if (canonicalizeLocalRequestTarget(envelope.target) !== envelope.target) {
      context.addIssue({ code: z__namespace.ZodIssueCode.custom, path: ["target"], message: "target is not canonical" });
    }
  } catch {
    context.addIssue({ code: z__namespace.ZodIssueCode.custom, path: ["target"], message: "invalid proof target" });
  }
  if (!isCanonicalBase64Bytes(envelope.bodyHash, 32)) {
    context.addIssue({ code: z__namespace.ZodIssueCode.custom, path: ["bodyHash"], message: "invalid SHA-256 body hash" });
  }
  if (!isCanonicalBase64Bytes(envelope.signature, 64)) {
    context.addIssue({ code: z__namespace.ZodIssueCode.custom, path: ["signature"], message: "invalid Ed25519 signature" });
  }
});
function canonicalizeLocalRequestTarget(target) {
  if (!target.startsWith("/") || target.includes("#") || /[\u0000-\u001f\u007f]/.test(target)) {
    throw new Error("invalid proof target");
  }
  validatePercentEncodingAndUtf8(target);
  const parsed = new URL(`http://localhost${target}`);
  const pairs = Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = compareUtf8(leftKey, rightKey);
    return keyOrder !== 0 ? keyOrder : compareUtf8(leftValue, rightValue);
  });
  const search = new URLSearchParams();
  for (const [key, value] of pairs) {
    search.append(key, value);
  }
  const encodedQuery = search.toString();
  return encodedQuery ? `${parsed.pathname}?${encodedQuery}` : parsed.pathname;
}
function canonicalLocalRequestStringToSign(fields) {
  return [
    LOCAL_DEVICE_PROOF_DOMAIN,
    normalizeMethod(fields.method),
    canonicalizeLocalRequestTarget(fields.target),
    fields.keyId,
    fields.publicKey,
    fields.nonce,
    String(fields.issuedAt),
    fields.bodyHash
  ].join("\n");
}
async function signLocalRequest(input, secretKey) {
  const publicKey = encodeBase64(await ed__namespace.getPublicKeyAsync(secretKey));
  const envelope = {
    v: LOCAL_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    method: normalizeMethod(input.method),
    target: canonicalizeLocalRequestTarget(input.target),
    bodyHash: input.bodyHash,
    signature: ""
  };
  const canonical = canonicalLocalRequestStringToSign(envelope);
  envelope.signature = encodeBase64(await ed__namespace.signAsync(new TextEncoder().encode(canonical), secretKey));
  return LocalSignedRequestEnvelopeSchema.parse(envelope);
}
async function verifyLocalRequest(envelope, context) {
  const parsed = LocalSignedRequestEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const proof = parsed.data;
  let target;
  try {
    target = canonicalizeLocalRequestTarget(context.target);
  } catch {
    return { ok: false, reason: "invalid_target" };
  }
  if (proof.method !== normalizeMethod(context.method)) {
    return { ok: false, reason: "method_mismatch" };
  }
  if (proof.target !== target) {
    return { ok: false, reason: "target_mismatch" };
  }
  if (context.bodyHash !== void 0 && proof.bodyHash !== context.bodyHash) {
    return { ok: false, reason: "body_hash_mismatch" };
  }
  if (context.expectedPublicKey !== void 0 && proof.publicKey !== context.expectedPublicKey) {
    return { ok: false, reason: "public_key_mismatch" };
  }
  try {
    const valid = await ed__namespace.verifyAsync(
      decodeBase64(proof.signature),
      new TextEncoder().encode(canonicalLocalRequestStringToSign(proof)),
      decodeBase64(proof.publicKey)
    );
    return valid ? { ok: true } : { ok: false, reason: "signature_invalid" };
  } catch {
    return { ok: false, reason: "signature_invalid" };
  }
}
function isLocalProofFresh(issuedAt, now, freshnessMs = LOCAL_DEVICE_PROOF_FRESHNESS_MS, clockSkewMs = LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS) {
  return issuedAt >= now - freshnessMs && issuedAt <= now + clockSkewMs;
}
function encodeLocalDeviceProofHeader(envelope) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(LocalSignedRequestEnvelopeSchema.parse(envelope))));
}
function decodeLocalDeviceProofHeader(header) {
  if (!header) {
    return null;
  }
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(header));
    const parsed = LocalSignedRequestEnvelopeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function hashLocalRequestBody(body) {
  return hashRequestBody(body);
}
function validatePercentEncodingAndUtf8(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "%" && !/^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      throw new Error("invalid proof target encoding");
    }
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 57343) {
      const isHigh = code <= 56319;
      const next = value.charCodeAt(index + 1);
      if (!isHigh || next < 56320 || next > 57343) {
        throw new Error("invalid proof target unicode");
      }
      index += 1;
    }
  }
}
function compareUtf8(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}
function isCanonicalBase64Bytes(value, byteLength) {
  try {
    const decoded = decodeBase64(value);
    return decoded.length === byteLength && encodeBase64(decoded) === value;
  } catch {
    return false;
  }
}
function isCanonicalBase64UrlBytes(value, byteLength) {
  try {
    return decodeBase64Url(value).length === byteLength;
  } catch {
    return false;
  }
}

ed__namespace.hashes.sha512 = (message) => sha2_js.sha512(message);
const PAIR_COMPLETE_REQUEST_VERSION = 1;
const PAIR_COMPLETE_RESPONSE_VERSION = 2;
const PAIR_COMPLETE_RESPONSE_DOMAIN = "happy-pair-complete/v2";
const PairCompleteRequestSchema = z__namespace.object({
  version: z__namespace.literal(PAIR_COMPLETE_REQUEST_VERSION),
  machineId: z__namespace.string().min(1).max(256),
  deviceKeyId: z__namespace.string().min(1).max(128),
  deviceEd25519PublicKey: z__namespace.string().min(1),
  mobileEcdhPublicKey: z__namespace.string().optional()
}).strict();
const CanonicalLocalProfileSchema = z__namespace.object({
  id: z__namespace.string().min(1),
  timestamp: z__namespace.number().int().nonnegative(),
  firstName: z__namespace.string().nullable(),
  lastName: z__namespace.string().nullable(),
  avatar: z__namespace.null(),
  github: z__namespace.object({
    id: z__namespace.number(),
    login: z__namespace.string(),
    name: z__namespace.string(),
    avatar_url: z__namespace.string(),
    email: z__namespace.string().optional(),
    bio: z__namespace.string().nullable()
  }).nullable(),
  connectedServices: z__namespace.array(z__namespace.string())
}).strict();
const CanonicalLocalProfileFileSchema = CanonicalLocalProfileSchema.extend({
  version: z__namespace.literal(1)
}).strict();
const PairCompleteResponseUnsignedSchema = z__namespace.object({
  version: z__namespace.literal(PAIR_COMPLETE_RESPONSE_VERSION),
  authMode: z__namespace.literal("paired-device"),
  githubLogin: z__namespace.null(),
  profile: CanonicalLocalProfileSchema,
  machine: z__namespace.object({
    machineId: z__namespace.string().min(1),
    tunnelUrl: z__namespace.string().url(),
    ed25519PublicKey: z__namespace.string().min(1),
    x25519PublicKey: z__namespace.string().min(1),
    ed25519Fingerprint: z__namespace.string().min(1),
    mobileSharedSecret: z__namespace.string().optional()
  }).strict(),
  pairedDevice: z__namespace.object({
    keyId: z__namespace.string().min(1),
    publicKey: z__namespace.string().min(1)
  }).strict(),
  issuedAt: z__namespace.number().int().nonnegative()
}).strict();
const PairCompleteResponseSchema = PairCompleteResponseUnsignedSchema.extend({
  serverSignature: z__namespace.string().min(1)
}).strict();
function canonicalPairCompleteResponse(response) {
  const value = PairCompleteResponseUnsignedSchema.parse(response);
  return [
    PAIR_COMPLETE_RESPONSE_DOMAIN,
    String(value.version),
    value.machine.machineId,
    value.machine.tunnelUrl,
    value.machine.ed25519PublicKey,
    value.machine.x25519PublicKey,
    value.machine.ed25519Fingerprint,
    value.pairedDevice.keyId,
    value.pairedDevice.publicKey,
    String(value.issuedAt),
    encodeBase64(sha2_js.sha256(new TextEncoder().encode(JSON.stringify(value.profile)))),
    value.machine.mobileSharedSecret ?? ""
  ].join("\n");
}
async function signPairCompleteResponse(response, serverSecretKey) {
  const validated = PairCompleteResponseUnsignedSchema.parse(response);
  const signature = await ed__namespace.signAsync(
    new TextEncoder().encode(canonicalPairCompleteResponse(validated)),
    serverSecretKey
  );
  return PairCompleteResponseSchema.parse({
    ...validated,
    serverSignature: encodeBase64(signature)
  });
}
async function verifyPairCompleteResponse(response) {
  const parsed = PairCompleteResponseSchema.safeParse(response);
  if (!parsed.success) {
    return false;
  }
  const { serverSignature, ...unsigned } = parsed.data;
  try {
    return await ed__namespace.verifyAsync(
      decodeBase64(serverSignature),
      new TextEncoder().encode(canonicalPairCompleteResponse(unsigned)),
      decodeBase64(unsigned.machine.ed25519PublicKey)
    );
  } catch {
    return false;
  }
}

const SESSION_OUTPUT_SNAPSHOT_TYPE = "session-output-snapshot";
const SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES = 1024 * 1024;
const SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS = 256;
const boundedIdentity = z__namespace.string().min(1).max(SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS);
const SessionOutputSnapshotPayloadSchema = z__namespace.object({
  sessionId: boundedIdentity,
  threadId: boundedIdentity,
  turnId: boundedIdentity,
  itemId: boundedIdentity,
  revision: z__namespace.number().int().nonnegative(),
  text: z__namespace.string().refine(
    (value) => new TextEncoder().encode(value).byteLength <= SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES,
    `text must be at most ${SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES} UTF-8 bytes`
  ),
  emittedAt: z__namespace.number().int().nonnegative()
}).strict();
const SessionOutputSnapshotEphemeralUpdateSchema = SessionOutputSnapshotPayloadSchema.extend({
  type: z__namespace.literal(SESSION_OUTPUT_SNAPSHOT_TYPE),
  id: boundedIdentity
}).strict().superRefine((update, context) => {
  if (update.id !== update.sessionId) {
    context.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      path: ["id"],
      message: "ephemeral update id must equal sessionId"
    });
  }
});
function getSessionOutputSnapshotKey(sessionId, itemId) {
  return `${sessionId}:${itemId}`;
}
function getSessionOutputSnapshotTransientMessageId(sessionId, itemId) {
  return `happy-session-output-snapshot:${getSessionOutputSnapshotKey(sessionId, itemId)}`;
}

const uuidV4Schema = z__namespace.string().uuid().refine(
  (value) => value.slice(14, 15).toLowerCase() === "4",
  "actionId must be a UUID v4"
);
const steeringCommandTypeSchema = z__namespace.enum([
  "answer-permission",
  "answer-elicitation",
  "answer-plan",
  "answer-ask-user"
]);
const answerAskUserContentSchema = z__namespace.object({
  answer: z__namespace.string(),
  wasFreeform: z__namespace.boolean().optional(),
  dismissed: z__namespace.boolean().optional()
}).strict();
const answerElicitationContentSchema = z__namespace.object({
  action: z__namespace.enum(["accept", "decline", "cancel"]),
  content: z__namespace.record(z__namespace.string(), z__namespace.unknown()).optional()
}).strict();
const answerPlanContentSchema = z__namespace.object({
  approved: z__namespace.boolean(),
  selectedAction: z__namespace.string().optional(),
  feedback: z__namespace.string().optional()
}).strict();
const answerPermissionContentSchema = z__namespace.object({
  decision: z__namespace.enum(["approve", "deny"]),
  scope: z__namespace.literal("once").optional()
}).strict();
const commandBase = {
  actionId: uuidV4Schema,
  sessionId: z__namespace.string().min(1),
  targetRequestId: z__namespace.string().min(1)
};
const steeringCommandEnvelopeSchema = z__namespace.discriminatedUnion("type", [
  z__namespace.object({
    ...commandBase,
    type: z__namespace.literal("answer-ask-user"),
    content: answerAskUserContentSchema
  }).strict(),
  z__namespace.object({
    ...commandBase,
    type: z__namespace.literal("answer-elicitation"),
    content: answerElicitationContentSchema
  }).strict(),
  z__namespace.object({
    ...commandBase,
    type: z__namespace.literal("answer-plan"),
    content: answerPlanContentSchema
  }).strict(),
  z__namespace.object({
    ...commandBase,
    type: z__namespace.literal("answer-permission"),
    content: answerPermissionContentSchema
  }).strict()
]);
const steeringOutcomeSchema = z__namespace.enum([
  "pending",
  "applied",
  "duplicate",
  "already_resolved",
  "out_of_scope",
  "destructive_kind",
  "no_lease",
  "not_pending",
  "rate_limited"
]);
const steeringResultSchema = z__namespace.object({
  actionId: uuidV4Schema.optional(),
  outcome: steeringOutcomeSchema,
  leaseId: z__namespace.string().min(1).optional(),
  expiresAt: z__namespace.number().finite().optional(),
  heartbeatIntervalMs: z__namespace.number().int().positive().optional(),
  leaseTtlMs: z__namespace.number().int().positive().optional(),
  retryAfterMs: z__namespace.number().int().nonnegative().optional(),
  requestId: z__namespace.string().min(1).optional()
}).strict();
const steeringLeaseRevocationReasonSchema = z__namespace.enum([
  "keystroke",
  "expired",
  "released",
  "detached"
]);
const steeringControlChangedReasonSchema = z__namespace.enum([
  "granted",
  "denied",
  "keystroke",
  "expired",
  "released",
  "detached"
]);
const steeringControlChangedParamsSchema = z__namespace.object({
  reason: z__namespace.string().min(1),
  requestId: z__namespace.string().min(1).optional(),
  leaseId: z__namespace.string().min(1).optional(),
  expiresAt: z__namespace.number().finite().optional(),
  heartbeatIntervalMs: z__namespace.number().int().positive().optional(),
  leaseTtlMs: z__namespace.number().int().positive().optional()
}).passthrough();
const STEERING_RPC_METHODS = [
  "happy.attach",
  "happy.requestLease",
  "happy.heartbeat",
  "happy.releaseLease",
  "happy.answerPrompt",
  "happy.getControlState"
];
const STEERING_RELAY_CALLER_KEY = "__happyRpcCaller";
const steeringRelayCallerSchema = z__namespace.object({
  connectionId: z__namespace.string().min(1)
}).strict();

const MachineTunnelSchema = z__namespace.object({
  machineId: z__namespace.string(),
  tunnelId: z__namespace.string(),
  url: z__namespace.string(),
  tags: z__namespace.array(z__namespace.string()),
  lastSeenAt: z__namespace.union([z__namespace.number(), z__namespace.string().datetime()]),
  owner: z__namespace.string()
});

exports.AgentCommsChannelSchema = AgentCommsChannelSchema;
exports.AgentCommsEnvelopeSchema = AgentCommsEnvelopeSchema;
exports.AgentCommsFromSchema = AgentCommsFromSchema;
exports.AgentCommsIngestBodySchema = AgentCommsIngestBodySchema;
exports.AgentCommsKindSchema = AgentCommsKindSchema;
exports.AgentCommsScopeSchema = AgentCommsScopeSchema;
exports.AgentCommsToSchema = AgentCommsToSchema;
exports.AgentMessageSchema = AgentMessageSchema;
exports.AgentTreeDeltaSchema = AgentTreeDeltaSchema;
exports.AgentTreeEdgeSchema = AgentTreeEdgeSchema;
exports.AgentTreeNodeAddedDeltaSchema = AgentTreeNodeAddedDeltaSchema;
exports.AgentTreeNodeRemovedDeltaSchema = AgentTreeNodeRemovedDeltaSchema;
exports.AgentTreeNodeSchema = AgentTreeNodeSchema;
exports.AgentTreeNodeStatusChangedDeltaSchema = AgentTreeNodeStatusChangedDeltaSchema;
exports.AgentTreePendingSpawnStartedDeltaSchema = AgentTreePendingSpawnStartedDeltaSchema;
exports.AgentTreeSnapshotSchema = AgentTreeSnapshotSchema;
exports.AgentTreeUpdateInboundPayloadSchema = AgentTreeUpdateInboundPayloadSchema;
exports.AgentTreeUpdateOutboundPayloadSchema = AgentTreeUpdateOutboundPayloadSchema;
exports.ApiMessageSchema = ApiMessageSchema;
exports.ApiUpdateMachineStateSchema = ApiUpdateMachineStateSchema;
exports.ApiUpdateNewMessageSchema = ApiUpdateNewMessageSchema;
exports.ApiUpdateSessionStateSchema = ApiUpdateSessionStateSchema;
exports.CanonicalLocalProfileFileSchema = CanonicalLocalProfileFileSchema;
exports.CanonicalLocalProfileSchema = CanonicalLocalProfileSchema;
exports.CloudflareAccessServiceTokenSchema = CloudflareAccessServiceTokenSchema;
exports.CoreUpdateBodySchema = CoreUpdateBodySchema;
exports.CoreUpdateContainerSchema = CoreUpdateContainerSchema;
exports.DoneLedgerRecordSchema = DoneLedgerRecordSchema;
exports.ErrorLedgerRecordSchema = ErrorLedgerRecordSchema;
exports.IdleReachedLedgerRecordSchema = IdleReachedLedgerRecordSchema;
exports.LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS = LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS;
exports.LOCAL_DEVICE_PROOF_DOMAIN = LOCAL_DEVICE_PROOF_DOMAIN;
exports.LOCAL_DEVICE_PROOF_ENVELOPE_VERSION = LOCAL_DEVICE_PROOF_ENVELOPE_VERSION;
exports.LOCAL_DEVICE_PROOF_FRESHNESS_MS = LOCAL_DEVICE_PROOF_FRESHNESS_MS;
exports.LOCAL_DEVICE_PROOF_HEADER = LOCAL_DEVICE_PROOF_HEADER;
exports.LOCAL_DEVICE_PROOF_NONCE_BYTES = LOCAL_DEVICE_PROOF_NONCE_BYTES;
exports.LOCAL_PAIRING_AUTH_MODE = LOCAL_PAIRING_AUTH_MODE;
exports.LOCAL_PAIRING_FORWARD_SKEW_MS = LOCAL_PAIRING_FORWARD_SKEW_MS;
exports.LOCAL_PAIRING_INVITE_KIND = LOCAL_PAIRING_INVITE_KIND;
exports.LOCAL_PAIRING_INVITE_VERSION = LOCAL_PAIRING_INVITE_VERSION;
exports.LOCAL_PAIRING_NONCE_BYTES = LOCAL_PAIRING_NONCE_BYTES;
exports.LOCAL_PAIRING_NONCE_HEADER = LOCAL_PAIRING_NONCE_HEADER;
exports.LOCAL_PAIRING_SECRET_BYTES = LOCAL_PAIRING_SECRET_BYTES;
exports.LOCAL_PAIRING_SECRET_HEADER = LOCAL_PAIRING_SECRET_HEADER;
exports.LOCAL_PAIRING_WINDOW_MS = LOCAL_PAIRING_WINDOW_MS;
exports.LastOutputSummaryLedgerRecordSchema = LastOutputSummaryLedgerRecordSchema;
exports.LedgerErrorCodeSchema = LedgerErrorCodeSchema;
exports.LedgerRecordSchema = LedgerRecordSchema;
exports.LegacyMessageContentSchema = LegacyMessageContentSchema;
exports.LocalPairingInviteSchema = LocalPairingInviteSchema;
exports.LocalSignedRequestEnvelopeSchema = LocalSignedRequestEnvelopeSchema;
exports.MAX_HOPS = MAX_HOPS;
exports.MachineTunnelSchema = MachineTunnelSchema;
exports.MessageContentSchema = MessageContentSchema;
exports.MessageMetaSchema = MessageMetaSchema;
exports.MessageSentLedgerRecordSchema = MessageSentLedgerRecordSchema;
exports.PAIR_COMPLETE_REQUEST_VERSION = PAIR_COMPLETE_REQUEST_VERSION;
exports.PAIR_COMPLETE_RESPONSE_DOMAIN = PAIR_COMPLETE_RESPONSE_DOMAIN;
exports.PAIR_COMPLETE_RESPONSE_VERSION = PAIR_COMPLETE_RESPONSE_VERSION;
exports.PUBLIC_DEVICE_AUTH_TEST_VECTOR = PUBLIC_DEVICE_AUTH_TEST_VECTOR;
exports.PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS = PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS;
exports.PUBLIC_DEVICE_PROOF_DOMAIN = PUBLIC_DEVICE_PROOF_DOMAIN;
exports.PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION = PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION;
exports.PUBLIC_DEVICE_PROOF_FRESHNESS_MS = PUBLIC_DEVICE_PROOF_FRESHNESS_MS;
exports.PUBLIC_DEVICE_PROOF_HEADER = PUBLIC_DEVICE_PROOF_HEADER;
exports.PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS = PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS;
exports.PUBLIC_PAIRING_INVITE_TEST_VECTOR = PUBLIC_PAIRING_INVITE_TEST_VECTOR;
exports.PUBLIC_PAIRING_INVITE_VERSION = PUBLIC_PAIRING_INVITE_VERSION;
exports.PairCompleteRequestSchema = PairCompleteRequestSchema;
exports.PairCompleteResponseSchema = PairCompleteResponseSchema;
exports.PairCompleteResponseUnsignedSchema = PairCompleteResponseUnsignedSchema;
exports.PendingPermissionLedgerRecordSchema = PendingPermissionLedgerRecordSchema;
exports.PublicPairingInviteSchema = PublicPairingInviteSchema;
exports.PublicSignedRequestEnvelopeSchema = PublicSignedRequestEnvelopeSchema;
exports.SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS = SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS;
exports.SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES = SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES;
exports.SESSION_OUTPUT_SNAPSHOT_TYPE = SESSION_OUTPUT_SNAPSHOT_TYPE;
exports.STEERING_RELAY_CALLER_KEY = STEERING_RELAY_CALLER_KEY;
exports.STEERING_RPC_METHODS = STEERING_RPC_METHODS;
exports.SenderKeysSchema = SenderKeysSchema;
exports.SessionGetAgentTreeRequestSchema = SessionGetAgentTreeRequestSchema;
exports.SessionGetAgentTreeResponseSchema = SessionGetAgentTreeResponseSchema;
exports.SessionMessageContentSchema = SessionMessageContentSchema;
exports.SessionMessageRangeRequestSchema = SessionMessageRangeRequestSchema;
exports.SessionMessageRangeResponseSchema = SessionMessageRangeResponseSchema;
exports.SessionMessageSchema = SessionMessageSchema;
exports.SessionOutputSnapshotEphemeralUpdateSchema = SessionOutputSnapshotEphemeralUpdateSchema;
exports.SessionOutputSnapshotPayloadSchema = SessionOutputSnapshotPayloadSchema;
exports.SessionProtocolMessageSchema = SessionProtocolMessageSchema;
exports.SpawnLedgerRecordSchema = SpawnLedgerRecordSchema;
exports.TofuHandshakeMessageSchema = TofuHandshakeMessageSchema;
exports.TofuPubkeysEventSchema = TofuPubkeysEventSchema;
exports.TofuPublicKeysSchema = TofuPublicKeysSchema;
exports.TofuSessionKeyExchangeSchema = TofuSessionKeyExchangeSchema;
exports.UpdateBodySchema = UpdateBodySchema;
exports.UpdateMachineBodySchema = UpdateMachineBodySchema;
exports.UpdateNewMessageBodySchema = UpdateNewMessageBodySchema;
exports.UpdateSchema = UpdateSchema;
exports.UpdateSessionBodySchema = UpdateSessionBodySchema;
exports.UserMessageSchema = UserMessageSchema;
exports.ValidationAttachedLedgerRecordSchema = ValidationAttachedLedgerRecordSchema;
exports.VersionedEncryptedValueSchema = VersionedEncryptedValueSchema;
exports.VersionedMachineEncryptedValueSchema = VersionedMachineEncryptedValueSchema;
exports.VersionedNullableEncryptedValueSchema = VersionedNullableEncryptedValueSchema;
exports.VoiceConversationDeniedSchema = VoiceConversationDeniedSchema;
exports.VoiceConversationGrantedSchema = VoiceConversationGrantedSchema;
exports.VoiceConversationResponseSchema = VoiceConversationResponseSchema;
exports.VoiceUsageResponseSchema = VoiceUsageResponseSchema;
exports.answerAskUserContentSchema = answerAskUserContentSchema;
exports.answerElicitationContentSchema = answerElicitationContentSchema;
exports.answerPermissionContentSchema = answerPermissionContentSchema;
exports.answerPlanContentSchema = answerPlanContentSchema;
exports.canonicalLocalRequestStringToSign = canonicalLocalRequestStringToSign;
exports.canonicalPairCompleteResponse = canonicalPairCompleteResponse;
exports.canonicalRequestStringToSign = canonicalRequestStringToSign;
exports.canonicalizeLocalRequestTarget = canonicalizeLocalRequestTarget;
exports.canonicalizePublicRequestTarget = canonicalizePublicRequestTarget;
exports.createEnvelope = createEnvelope;
exports.createLocalPairingInvite = createLocalPairingInvite;
exports.createPublicPairingInvite = createPublicPairingInvite;
exports.decodeBase64 = decodeBase64;
exports.decodeBase64Url = decodeBase64Url;
exports.decodeLocalDeviceProofHeader = decodeLocalDeviceProofHeader;
exports.decodeLocalPairingInvite = decodeLocalPairingInvite;
exports.decodePublicDeviceProofHeader = decodePublicDeviceProofHeader;
exports.decodePublicPairingInvite = decodePublicPairingInvite;
exports.encodeBase64 = encodeBase64;
exports.encodeBase64Url = encodeBase64Url;
exports.encodeLocalDeviceProofHeader = encodeLocalDeviceProofHeader;
exports.encodeLocalPairingInvite = encodeLocalPairingInvite;
exports.encodePublicDeviceProofHeader = encodePublicDeviceProofHeader;
exports.encodePublicPairingInvite = encodePublicPairingInvite;
exports.findSenderDropEntry = findSenderDropEntry;
exports.forkBoilerplateEntry = forkBoilerplateEntry;
exports.generateLocalPairingNonce = generateLocalPairingNonce;
exports.generateLocalPairingSecret = generateLocalPairingSecret;
exports.generatePairSecret = generatePairSecret;
exports.generatePublicRequestNonce = generatePublicRequestNonce;
exports.getSessionOutputSnapshotKey = getSessionOutputSnapshotKey;
exports.getSessionOutputSnapshotTransientMessageId = getSessionOutputSnapshotTransientMessageId;
exports.hashLocalRequestBody = hashLocalRequestBody;
exports.hashRequestBody = hashRequestBody;
exports.isLocalPairingInviteValid = isLocalPairingInviteValid;
exports.isLocalProofFresh = isLocalProofFresh;
exports.isPublicPairingInviteValid = isPublicPairingInviteValid;
exports.isPublicProofFresh = isPublicProofFresh;
exports.isStrictLoopbackServerUrl = isStrictLoopbackServerUrl;
exports.localCommandCaveatEntry = localCommandCaveatEntry;
exports.makeWrappedTagEntry = makeWrappedTagEntry;
exports.nonRenderableEntries = nonRenderableEntries;
exports.normalizeMethod = normalizeMethod;
exports.routeHopValidation = routeHopValidation;
exports.sessionAgentConfigurationChangedEventSchema = sessionAgentConfigurationChangedEventSchema;
exports.sessionContextBoundaryEventSchema = sessionContextBoundaryEventSchema;
exports.sessionContextBoundaryKindSchema = sessionContextBoundaryKindSchema;
exports.sessionContextBoundaryTriggeredBySchema = sessionContextBoundaryTriggeredBySchema;
exports.sessionCopilotControlEventSchema = sessionCopilotControlEventSchema;
exports.sessionCopilotPromptEventSchema = sessionCopilotPromptEventSchema;
exports.sessionEnvelopeSchema = sessionEnvelopeSchema;
exports.sessionEventSchema = sessionEventSchema;
exports.sessionFileEventSchema = sessionFileEventSchema;
exports.sessionMessageConsumptionEventSchema = sessionMessageConsumptionEventSchema;
exports.sessionRoleSchema = sessionRoleSchema;
exports.sessionServiceMessageEventSchema = sessionServiceMessageEventSchema;
exports.sessionStartEventSchema = sessionStartEventSchema;
exports.sessionStopEventSchema = sessionStopEventSchema;
exports.sessionTextEventSchema = sessionTextEventSchema;
exports.sessionToolCallEndEventSchema = sessionToolCallEndEventSchema;
exports.sessionToolCallStartEventSchema = sessionToolCallStartEventSchema;
exports.sessionTurnEndEventSchema = sessionTurnEndEventSchema;
exports.sessionTurnEndStatusSchema = sessionTurnEndStatusSchema;
exports.sessionTurnStartEventSchema = sessionTurnStartEventSchema;
exports.signLocalRequest = signLocalRequest;
exports.signPairCompleteResponse = signPairCompleteResponse;
exports.signPublicRequest = signPublicRequest;
exports.skillBodyEntry = skillBodyEntry;
exports.steeringCommandEnvelopeSchema = steeringCommandEnvelopeSchema;
exports.steeringCommandTypeSchema = steeringCommandTypeSchema;
exports.steeringControlChangedParamsSchema = steeringControlChangedParamsSchema;
exports.steeringControlChangedReasonSchema = steeringControlChangedReasonSchema;
exports.steeringLeaseRevocationReasonSchema = steeringLeaseRevocationReasonSchema;
exports.steeringOutcomeSchema = steeringOutcomeSchema;
exports.steeringRelayCallerSchema = steeringRelayCallerSchema;
exports.steeringResultSchema = steeringResultSchema;
exports.systemReminderEntry = systemReminderEntry;
exports.verifyLocalRequest = verifyLocalRequest;
exports.verifyPairCompleteResponse = verifyPairCompleteResponse;
exports.verifyPublicRequest = verifyPublicRequest;
