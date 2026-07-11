import * as z from 'zod';
import { isCuid, createId } from '@paralleldrive/cuid2';
import * as ed from '@noble/ed25519';
import { sha512, sha256 } from '@noble/hashes/sha2.js';

const sessionRoleSchema = z.union([z.literal("user"), z.literal("agent")]);
const sessionTextEventSchema = z.object({
  t: z.literal("text"),
  text: z.string(),
  thinking: z.boolean().optional()
});
const sessionServiceMessageEventSchema = z.object({
  t: z.literal("service"),
  text: z.string()
});
const sessionToolCallStartEventSchema = z.object({
  t: z.literal("tool-call-start"),
  call: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  args: z.record(z.string(), z.unknown()),
  permissionRequestId: z.string().optional()
});
const sessionToolCallEndEventSchema = z.object({
  t: z.literal("tool-call-end"),
  call: z.string()
});
const sessionFileEventSchema = z.object({
  t: z.literal("file"),
  ref: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string().optional(),
  image: z.object({
    width: z.number(),
    height: z.number(),
    thumbhash: z.string()
  }).optional()
});
const sessionTurnStartEventSchema = z.object({
  t: z.literal("turn-start")
});
const sessionStartEventSchema = z.object({
  t: z.literal("start"),
  title: z.string().optional()
});
const sessionTurnEndStatusSchema = z.enum(["completed", "failed", "cancelled"]);
const sessionTurnEndEventSchema = z.object({
  t: z.literal("turn-end"),
  status: sessionTurnEndStatusSchema
});
const sessionStopEventSchema = z.object({
  t: z.literal("stop")
});
const sessionContextBoundaryKindSchema = z.enum([
  "clear",
  "compact",
  "autocompact",
  "plan-mode-enter",
  "plan-mode-exit",
  "session-fork-resume"
]);
const sessionContextBoundaryTriggeredBySchema = z.enum(["user", "agent", "system"]);
const sessionContextBoundaryEventSchema = z.object({
  t: z.literal("context-boundary"),
  kind: sessionContextBoundaryKindSchema,
  at: z.number(),
  /**
   * Boundary source mapping: 'user' for explicit user commands such as /clear,
   * 'agent' for model/agent-initiated lifecycle transitions, and 'system' for
   * Happy runtime or synchronization events.
   */
  triggeredBy: sessionContextBoundaryTriggeredBySchema,
  summaryRef: z.string().optional(),
  forkedFromSid: z.string().optional()
});
const sessionAgentConfigurationChangedEventSchema = z.object({
  t: z.literal("agent-configuration-changed"),
  permissionMode: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  thinkingLevel: z.string().nullable().optional(),
  sandbox: z.string().nullable().optional()
});
const sessionMessageConsumptionEventSchema = z.object({
  t: z.literal("message-consumption"),
  messageId: z.string(),
  consumedAt: z.number(),
  agentFlavor: z.enum(["claude", "codex"])
});
const sessionEventSchema = z.discriminatedUnion("t", [
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
  sessionMessageConsumptionEventSchema
]);
const sessionEnvelopeSchema = z.object({
  id: z.string(),
  time: z.number(),
  role: sessionRoleSchema,
  turn: z.string().optional(),
  subagent: z.string().refine((value) => isCuid(value), {
    message: "subagent must be a cuid2 value"
  }).optional(),
  ev: sessionEventSchema
}).superRefine((envelope, ctx) => {
  if (envelope.ev.t === "service" && envelope.role !== "agent") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'service events must use role "agent"',
      path: ["role"]
    });
  }
  if ((envelope.ev.t === "start" || envelope.ev.t === "stop") && envelope.role !== "agent") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${envelope.ev.t} events must use role "agent"`,
      path: ["role"]
    });
  }
});
function createEnvelope(role, ev, opts = {}) {
  return sessionEnvelopeSchema.parse({
    id: opts.id ?? createId(),
    time: opts.time ?? Date.now(),
    role,
    ...opts.turn ? { turn: opts.turn } : {},
    ...opts.subagent ? { subagent: opts.subagent } : {},
    ev
  });
}

const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(),
  permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]).optional(),
  model: z.string().nullable().optional(),
  thinkingLevel: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  displayText: z.string().optional(),
  attachmentRefs: z.array(z.object({
    remotePath: z.string(),
    name: z.string(),
    size: z.number()
  })).optional(),
  contextBoundaryFallback: z.boolean().optional()
});

const UserMessageAttachmentSchema = z.object({
  type: z.literal("image"),
  ref: z.string(),
  mimeType: z.string().optional()
});
const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.object({
    type: z.literal("text"),
    text: z.string(),
    attachments: z.array(UserMessageAttachmentSchema).optional()
  }),
  localKey: z.string().optional(),
  meta: MessageMetaSchema.optional()
});
const AgentMessageSchema = z.object({
  role: z.literal("agent"),
  content: z.object({
    type: z.string()
  }).passthrough(),
  meta: MessageMetaSchema.optional()
});
const LegacyMessageContentSchema = z.discriminatedUnion("role", [UserMessageSchema, AgentMessageSchema]);

const SessionMessageContentSchema = z.object({
  c: z.string(),
  t: z.literal("encrypted")
});
const SessionMessageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  localId: z.string().nullish(),
  content: SessionMessageContentSchema,
  createdAt: z.number(),
  updatedAt: z.number()
});
const SessionMessageRangeRequestSchema = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  fromSeq: z.number().int().min(0),
  toSeq: z.number().int(),
  limit: z.number().int().min(1).max(200)
}).refine((request) => request.toSeq >= request.fromSeq, {
  path: ["toSeq"],
  message: "toSeq must be greater than or equal to fromSeq"
});
const SessionMessageRangeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    sessionId: z.string(),
    fromSeq: z.number().int(),
    toSeq: z.number().int(),
    messages: z.array(SessionMessageSchema),
    hasMore: z.boolean()
  }),
  z.object({
    ok: z.literal(false),
    requestId: z.string(),
    error: z.object({
      code: z.enum(["session_not_found", "invalid_range", "rate_limited", "internal"]),
      message: z.string()
    })
  })
]);
const SessionProtocolMessageSchema = z.object({
  role: z.literal("session"),
  content: sessionEnvelopeSchema,
  meta: MessageMetaSchema.optional()
});
const MessageContentSchema = z.discriminatedUnion("role", [
  UserMessageSchema,
  AgentMessageSchema,
  SessionProtocolMessageSchema
]);
const VersionedEncryptedValueSchema = z.object({
  version: z.number(),
  value: z.string()
});
const VersionedNullableEncryptedValueSchema = z.object({
  version: z.number(),
  value: z.string().nullable()
});
const UpdateNewMessageBodySchema = z.object({
  t: z.literal("new-message"),
  sid: z.string(),
  message: SessionMessageSchema
});
const UpdateSessionBodySchema = z.object({
  t: z.literal("update-session"),
  id: z.string(),
  metadata: VersionedEncryptedValueSchema.nullish(),
  agentState: VersionedNullableEncryptedValueSchema.nullish()
});
const VersionedMachineEncryptedValueSchema = z.object({
  version: z.number(),
  value: z.string()
});
const UpdateMachineBodySchema = z.object({
  t: z.literal("update-machine"),
  machineId: z.string(),
  metadata: VersionedMachineEncryptedValueSchema.nullish(),
  daemonState: VersionedMachineEncryptedValueSchema.nullish(),
  active: z.boolean().optional(),
  activeAt: z.number().optional()
});
const CoreUpdateBodySchema = z.discriminatedUnion("t", [
  UpdateNewMessageBodySchema,
  UpdateSessionBodySchema,
  UpdateMachineBodySchema
]);
const CoreUpdateContainerSchema = z.object({
  id: z.string(),
  seq: z.number(),
  body: CoreUpdateBodySchema,
  createdAt: z.number()
});
const ApiMessageSchema = SessionMessageSchema;
const ApiUpdateNewMessageSchema = UpdateNewMessageBodySchema;
const ApiUpdateSessionStateSchema = UpdateSessionBodySchema;
const ApiUpdateMachineStateSchema = UpdateMachineBodySchema;
const UpdateBodySchema = UpdateNewMessageBodySchema;
const UpdateSchema = CoreUpdateContainerSchema;

const TofuPublicKeysSchema = z.object({
  ed25519PublicKey: z.string().min(1),
  x25519PublicKey: z.string().min(1),
  ed25519Fingerprint: z.string().min(1).optional()
});
const TofuPubkeysEventSchema = z.object({
  t: z.literal("tofu-pubkeys"),
  keys: TofuPublicKeysSchema
});
const TofuSessionKeyExchangeSchema = z.object({
  t: z.literal("tofu-session-key"),
  machineId: z.string().min(1),
  mobileX25519PublicKey: z.string().min(1),
  serverX25519PublicKey: z.string().min(1),
  sessionKey: z.string().min(1),
  firstSeenAt: z.number()
});
const TofuHandshakeMessageSchema = z.discriminatedUnion("t", [
  TofuPubkeysEventSchema,
  TofuSessionKeyExchangeSchema
]);

const VoiceConversationGrantedSchema = z.object({
  allowed: z.literal(true),
  conversationToken: z.string(),
  conversationId: z.string(),
  agentId: z.string(),
  elevenUserId: z.string(),
  usedSeconds: z.number(),
  limitSeconds: z.number()
});
const VoiceConversationDeniedSchema = z.object({
  allowed: z.literal(false),
  reason: z.enum(["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]),
  usedSeconds: z.number(),
  limitSeconds: z.number(),
  agentId: z.string()
});
const VoiceConversationResponseSchema = z.discriminatedUnion("allowed", [
  VoiceConversationGrantedSchema,
  VoiceConversationDeniedSchema
]);
const VoiceUsageResponseSchema = z.object({
  usedSeconds: z.number(),
  limitSeconds: z.number(),
  conversationCount: z.number(),
  conversationLimit: z.number(),
  elevenUserId: z.string()
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

const payloadSchema = z.record(z.unknown()).optional();
const safePathComponent = z.string().regex(/^[A-Za-z0-9_-]+$/);
const baseLedgerRecordSchema = z.object({
  runId: safePathComponent,
  sessionId: safePathComponent,
  timestamp: z.string().datetime(),
  seqWithinSession: z.number().int().nonnegative().optional()
});
const LedgerErrorCodeSchema = z.enum([
  "spawn-failed",
  "wrong-account",
  "timeout",
  "crash",
  "ledger-write-failed",
  "monitor-failure"
]);
const SpawnLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("spawn"),
  agent: z.string().min(1),
  projectPath: z.string().min(1),
  worktreePath: z.string().min(1),
  branchName: z.string().min(1).optional(),
  payload: payloadSchema
});
const MessageSentLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("message-sent"),
  direction: z.enum(["user-to-agent", "agent-to-server"]),
  messageId: z.string().min(1).optional(),
  messagePreview: z.string().optional(),
  payload: payloadSchema
});
const IdleReachedLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("idle-reached"),
  queueDepth: z.number().int().nonnegative(),
  payload: payloadSchema
});
const PendingPermissionLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("pending-permission"),
  requestIds: z.array(z.string().min(1)),
  payload: payloadSchema
});
const LastOutputSummaryLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("last-output-summary"),
  summary: z.string(),
  heuristic: z.enum(["assistant-text", "tool-result", "server-summary"]),
  payload: payloadSchema
});
const ValidationAttachedLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("validation-attached"),
  testReference: z.string().min(1),
  verificationUrl: z.string().url(),
  payload: payloadSchema
});
const DoneLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("done"),
  scopeSummary: z.string().min(1),
  testReference: z.string().min(1),
  verificationUrl: z.string().url(),
  caveats: z.array(z.string()),
  payload: payloadSchema
});
const ErrorLedgerRecordSchema = baseLedgerRecordSchema.extend({
  eventType: z.literal("error"),
  errorCode: LedgerErrorCodeSchema,
  errorMessage: z.string().min(1),
  payload: payloadSchema
});
const LedgerRecordSchema = z.discriminatedUnion("eventType", [
  SpawnLedgerRecordSchema,
  MessageSentLedgerRecordSchema,
  IdleReachedLedgerRecordSchema,
  PendingPermissionLedgerRecordSchema,
  LastOutputSummaryLedgerRecordSchema,
  ValidationAttachedLedgerRecordSchema,
  DoneLedgerRecordSchema,
  ErrorLedgerRecordSchema
]);

const AgentTreeNodeSchema = z.object({
  threadId: z.string(),
  agentRole: z.string(),
  nickname: z.string().nullable(),
  status: z.string(),
  lastTaskMessage: z.string().optional(),
  spawnedAt: z.number()
});
const AgentTreeEdgeSchema = z.object({
  parent: z.string(),
  child: z.string()
});
const AgentTreeSnapshotSchema = z.object({
  nodes: z.array(AgentTreeNodeSchema),
  edges: z.array(AgentTreeEdgeSchema),
  seq: z.number()
});
const AgentTreePendingSpawnStartedDeltaSchema = z.object({
  type: z.literal("pending-spawn-started"),
  seq: z.number(),
  callId: z.string(),
  parentThreadId: z.string(),
  agentRole: z.string(),
  nickname: z.string().nullable(),
  taskMessage: z.string().optional(),
  startedAt: z.number()
});
const AgentTreeNodeAddedDeltaSchema = z.object({
  type: z.literal("node-added"),
  seq: z.number(),
  node: AgentTreeNodeSchema,
  edge: AgentTreeEdgeSchema
});
const AgentTreeNodeStatusChangedDeltaSchema = z.object({
  type: z.literal("node-status-changed"),
  seq: z.number(),
  threadId: z.string(),
  status: z.string(),
  lastTaskMessage: z.string().optional()
});
const AgentTreeNodeRemovedDeltaSchema = z.object({
  type: z.literal("node-removed"),
  seq: z.number(),
  threadId: z.string()
});
const AgentTreeDeltaSchema = z.discriminatedUnion("type", [
  AgentTreePendingSpawnStartedDeltaSchema,
  AgentTreeNodeAddedDeltaSchema,
  AgentTreeNodeStatusChangedDeltaSchema,
  AgentTreeNodeRemovedDeltaSchema
]);
const AgentTreeUpdateInboundPayloadSchema = z.object({
  delta: AgentTreeDeltaSchema
});
const AgentTreeUpdateOutboundPayloadSchema = z.object({
  sessionId: z.string(),
  delta: AgentTreeDeltaSchema
});
const SessionGetAgentTreeRequestSchema = z.object({
  sessionId: z.string()
});
const SessionGetAgentTreeResponseSchema = AgentTreeSnapshotSchema;

const MAX_HOPS = 4;
const AgentCommsScopeSchema = z.enum(["B", "C", "A"]);
const AgentCommsChannelSchema = z.enum(["message", "spawn"]);
const AgentCommsKindSchema = z.enum([
  "request",
  "reply",
  "notify",
  "spawn-request",
  "spawn-result"
]);
const AgentCommsFromSchema = z.object({
  machineId: z.string().min(1),
  sessionId: z.string().min(1)
});
const AgentCommsToSchema = z.object({
  machineId: z.string().min(1).optional(),
  sessionId: z.string().min(1)
});
const AgentCommsEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  ts: z.number().int().nonnegative(),
  from: AgentCommsFromSchema,
  to: AgentCommsToSchema,
  scope: AgentCommsScopeSchema,
  channel: AgentCommsChannelSchema,
  kind: AgentCommsKindSchema,
  correlationId: z.string().min(1).optional(),
  hopCount: z.number().int().min(0).max(MAX_HOPS),
  hopPath: z.array(z.string().min(1)),
  body: z.unknown()
});
const SenderKeysSchema = z.object({
  ed25519PublicKey: z.string().min(1),
  ecdhPublicKey: z.string().min(1),
  ed25519Fingerprint: z.string().min(1).optional()
});
const AgentCommsIngestBodySchema = z.object({
  envelope: AgentCommsEnvelopeSchema,
  signature: z.string().min(1),
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

ed.hashes.sha512 = (message) => sha512(message);
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
const PublicSignedRequestEnvelopeSchema = z.object({
  v: z.literal(PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION),
  keyId: z.string().min(1),
  publicKey: z.string().min(1),
  nonce: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  method: z.string().min(1),
  path: z.string().min(1),
  bodyHash: z.string().min(1),
  signature: z.string().min(1)
});
function normalizeMethod(method) {
  return method.toUpperCase();
}
function canonicalRequestStringToSign(fields) {
  return [
    PUBLIC_DEVICE_PROOF_DOMAIN,
    normalizeMethod(fields.method),
    fields.path,
    fields.keyId,
    fields.publicKey,
    fields.nonce,
    String(fields.issuedAt),
    fields.bodyHash
  ].join("\n");
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
  return encodeBase64(sha256(bytes));
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
  const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
  const canonical = canonicalRequestStringToSign({
    method,
    path: input.path,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    bodyHash: input.bodyHash
  });
  const signature = encodeBase64(await ed.signAsync(new TextEncoder().encode(canonical), secretKey));
  return {
    v: PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    method,
    path: input.path,
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
  if (env.path !== context.path) {
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
    valid = await ed.verifyAsync(signatureBytes, new TextEncoder().encode(canonical), publicKeyBytes);
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
const CloudflareAccessServiceTokenSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1)
});
const PublicPairingInviteSchema = z.object({
  version: z.literal(PUBLIC_PAIRING_INVITE_VERSION),
  serverUrl: z.string().url(),
  machineId: z.string().min(1),
  pairSecret: z.string().min(1),
  cloudflareAccess: CloudflareAccessServiceTokenSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
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
const LocalPairingInviteShapeSchema = z.object({
  kind: z.literal(LOCAL_PAIRING_INVITE_KIND),
  version: z.literal(LOCAL_PAIRING_INVITE_VERSION),
  authMode: z.literal(LOCAL_PAIRING_AUTH_MODE),
  serverUrl: z.string().min(1),
  browserOrigin: z.string().min(1),
  machineId: z.string().min(1).max(256),
  pairSecret: z.string().min(1),
  pairingNonce: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict();
const LocalPairingInviteSchema = LocalPairingInviteShapeSchema.superRefine((invite, context) => {
  if (!isStrictLoopbackServerUrl(invite.serverUrl)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serverUrl"],
      message: "serverUrl must be an explicit http://127.0.0.1:<port> origin"
    });
  }
  if (!isOrigin(invite.browserOrigin)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["browserOrigin"],
      message: "browserOrigin must be an exact URL origin"
    });
  }
  if (!isCanonicalBase64UrlBytes$1(invite.pairSecret, LOCAL_PAIRING_SECRET_BYTES)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pairSecret"],
      message: `pairSecret must be ${LOCAL_PAIRING_SECRET_BYTES} canonical base64url bytes`
    });
  }
  if (!isCanonicalBase64UrlBytes$1(invite.pairingNonce, LOCAL_PAIRING_NONCE_BYTES)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pairingNonce"],
      message: `pairingNonce must be ${LOCAL_PAIRING_NONCE_BYTES} canonical base64url bytes`
    });
  }
  const issuedAt = Date.parse(invite.issuedAt);
  const expiresAt = Date.parse(invite.expiresAt);
  if (expiresAt - issuedAt !== LOCAL_PAIRING_WINDOW_MS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
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

ed.hashes.sha512 = (message) => sha512(message);
const LOCAL_DEVICE_PROOF_ENVELOPE_VERSION = 1;
const LOCAL_DEVICE_PROOF_DOMAIN = "happy-local-device-proof/v1";
const LOCAL_DEVICE_PROOF_HEADER = "X-Happy-Local-Device-Proof";
const LOCAL_DEVICE_PROOF_FRESHNESS_MS = 12e4;
const LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS = 3e4;
const LOCAL_DEVICE_PROOF_NONCE_BYTES = 24;
const LocalSignedRequestEnvelopeShapeSchema = z.object({
  v: z.literal(LOCAL_DEVICE_PROOF_ENVELOPE_VERSION),
  keyId: z.string().min(1).max(256),
  publicKey: z.string().min(1),
  nonce: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  method: z.string().regex(/^[A-Z]+$/),
  target: z.string().min(1),
  bodyHash: z.string().min(1),
  signature: z.string().min(1)
}).strict();
const LocalSignedRequestEnvelopeSchema = LocalSignedRequestEnvelopeShapeSchema.superRefine((envelope, context) => {
  if (!isCanonicalBase64Bytes(envelope.publicKey, 32)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicKey"], message: "invalid Ed25519 public key" });
  }
  if (!isCanonicalBase64UrlBytes(envelope.nonce, LOCAL_DEVICE_PROOF_NONCE_BYTES)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nonce"], message: "invalid proof nonce" });
  }
  try {
    if (canonicalizeLocalRequestTarget(envelope.target) !== envelope.target) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: "target is not canonical" });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: "invalid proof target" });
  }
  if (!isCanonicalBase64Bytes(envelope.bodyHash, 32)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bodyHash"], message: "invalid SHA-256 body hash" });
  }
  if (!isCanonicalBase64Bytes(envelope.signature, 64)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["signature"], message: "invalid Ed25519 signature" });
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
  const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
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
  envelope.signature = encodeBase64(await ed.signAsync(new TextEncoder().encode(canonical), secretKey));
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
    const valid = await ed.verifyAsync(
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

const SESSION_OUTPUT_SNAPSHOT_TYPE = "session-output-snapshot";
const SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES = 1024 * 1024;
const SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS = 256;
const boundedIdentity = z.string().min(1).max(SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS);
const SessionOutputSnapshotPayloadSchema = z.object({
  sessionId: boundedIdentity,
  threadId: boundedIdentity,
  turnId: boundedIdentity,
  itemId: boundedIdentity,
  revision: z.number().int().nonnegative(),
  text: z.string().refine(
    (value) => new TextEncoder().encode(value).byteLength <= SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES,
    `text must be at most ${SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES} UTF-8 bytes`
  ),
  emittedAt: z.number().int().nonnegative()
}).strict();
const SessionOutputSnapshotEphemeralUpdateSchema = SessionOutputSnapshotPayloadSchema.extend({
  type: z.literal(SESSION_OUTPUT_SNAPSHOT_TYPE),
  id: boundedIdentity
}).strict().superRefine((update, context) => {
  if (update.id !== update.sessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
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

const MachineTunnelSchema = z.object({
  machineId: z.string(),
  tunnelId: z.string(),
  url: z.string(),
  tags: z.array(z.string()),
  lastSeenAt: z.union([z.number(), z.string().datetime()]),
  owner: z.string()
});

export { AgentCommsChannelSchema, AgentCommsEnvelopeSchema, AgentCommsFromSchema, AgentCommsIngestBodySchema, AgentCommsKindSchema, AgentCommsScopeSchema, AgentCommsToSchema, AgentMessageSchema, AgentTreeDeltaSchema, AgentTreeEdgeSchema, AgentTreeNodeAddedDeltaSchema, AgentTreeNodeRemovedDeltaSchema, AgentTreeNodeSchema, AgentTreeNodeStatusChangedDeltaSchema, AgentTreePendingSpawnStartedDeltaSchema, AgentTreeSnapshotSchema, AgentTreeUpdateInboundPayloadSchema, AgentTreeUpdateOutboundPayloadSchema, ApiMessageSchema, ApiUpdateMachineStateSchema, ApiUpdateNewMessageSchema, ApiUpdateSessionStateSchema, CloudflareAccessServiceTokenSchema, CoreUpdateBodySchema, CoreUpdateContainerSchema, DoneLedgerRecordSchema, ErrorLedgerRecordSchema, IdleReachedLedgerRecordSchema, LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS, LOCAL_DEVICE_PROOF_DOMAIN, LOCAL_DEVICE_PROOF_ENVELOPE_VERSION, LOCAL_DEVICE_PROOF_FRESHNESS_MS, LOCAL_DEVICE_PROOF_HEADER, LOCAL_DEVICE_PROOF_NONCE_BYTES, LOCAL_PAIRING_AUTH_MODE, LOCAL_PAIRING_FORWARD_SKEW_MS, LOCAL_PAIRING_INVITE_KIND, LOCAL_PAIRING_INVITE_VERSION, LOCAL_PAIRING_NONCE_BYTES, LOCAL_PAIRING_NONCE_HEADER, LOCAL_PAIRING_SECRET_BYTES, LOCAL_PAIRING_SECRET_HEADER, LOCAL_PAIRING_WINDOW_MS, LastOutputSummaryLedgerRecordSchema, LedgerErrorCodeSchema, LedgerRecordSchema, LegacyMessageContentSchema, LocalPairingInviteSchema, LocalSignedRequestEnvelopeSchema, MAX_HOPS, MachineTunnelSchema, MessageContentSchema, MessageMetaSchema, MessageSentLedgerRecordSchema, PUBLIC_DEVICE_AUTH_TEST_VECTOR, PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS, PUBLIC_DEVICE_PROOF_DOMAIN, PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION, PUBLIC_DEVICE_PROOF_FRESHNESS_MS, PUBLIC_DEVICE_PROOF_HEADER, PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS, PUBLIC_PAIRING_INVITE_TEST_VECTOR, PUBLIC_PAIRING_INVITE_VERSION, PendingPermissionLedgerRecordSchema, PublicPairingInviteSchema, PublicSignedRequestEnvelopeSchema, SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS, SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES, SESSION_OUTPUT_SNAPSHOT_TYPE, SenderKeysSchema, SessionGetAgentTreeRequestSchema, SessionGetAgentTreeResponseSchema, SessionMessageContentSchema, SessionMessageRangeRequestSchema, SessionMessageRangeResponseSchema, SessionMessageSchema, SessionOutputSnapshotEphemeralUpdateSchema, SessionOutputSnapshotPayloadSchema, SessionProtocolMessageSchema, SpawnLedgerRecordSchema, TofuHandshakeMessageSchema, TofuPubkeysEventSchema, TofuPublicKeysSchema, TofuSessionKeyExchangeSchema, UpdateBodySchema, UpdateMachineBodySchema, UpdateNewMessageBodySchema, UpdateSchema, UpdateSessionBodySchema, UserMessageSchema, ValidationAttachedLedgerRecordSchema, VersionedEncryptedValueSchema, VersionedMachineEncryptedValueSchema, VersionedNullableEncryptedValueSchema, VoiceConversationDeniedSchema, VoiceConversationGrantedSchema, VoiceConversationResponseSchema, VoiceUsageResponseSchema, canonicalLocalRequestStringToSign, canonicalRequestStringToSign, canonicalizeLocalRequestTarget, createEnvelope, createLocalPairingInvite, createPublicPairingInvite, decodeBase64, decodeBase64Url, decodeLocalDeviceProofHeader, decodeLocalPairingInvite, decodePublicDeviceProofHeader, decodePublicPairingInvite, encodeBase64, encodeBase64Url, encodeLocalDeviceProofHeader, encodeLocalPairingInvite, encodePublicDeviceProofHeader, encodePublicPairingInvite, findSenderDropEntry, forkBoilerplateEntry, generateLocalPairingNonce, generateLocalPairingSecret, generatePairSecret, generatePublicRequestNonce, getSessionOutputSnapshotKey, getSessionOutputSnapshotTransientMessageId, hashLocalRequestBody, hashRequestBody, isLocalPairingInviteValid, isLocalProofFresh, isPublicPairingInviteValid, isPublicProofFresh, isStrictLoopbackServerUrl, localCommandCaveatEntry, makeWrappedTagEntry, nonRenderableEntries, normalizeMethod, routeHopValidation, sessionAgentConfigurationChangedEventSchema, sessionContextBoundaryEventSchema, sessionContextBoundaryKindSchema, sessionContextBoundaryTriggeredBySchema, sessionEnvelopeSchema, sessionEventSchema, sessionFileEventSchema, sessionMessageConsumptionEventSchema, sessionRoleSchema, sessionServiceMessageEventSchema, sessionStartEventSchema, sessionStopEventSchema, sessionTextEventSchema, sessionToolCallEndEventSchema, sessionToolCallStartEventSchema, sessionTurnEndEventSchema, sessionTurnEndStatusSchema, sessionTurnStartEventSchema, signLocalRequest, signPublicRequest, skillBodyEntry, systemReminderEntry, verifyLocalRequest, verifyPublicRequest };
