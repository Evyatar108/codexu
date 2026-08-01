import * as z from 'zod';

const uuidV4Schema = z.string().uuid().refine(
  (value) => value.slice(14, 15).toLowerCase() === '4',
  'actionId must be a UUID v4',
);

export const steeringCommandTypeSchema = z.enum([
  'answer-permission',
  'answer-elicitation',
  'answer-plan',
  'answer-ask-user',
]);
export type SteeringCommandType = z.infer<typeof steeringCommandTypeSchema>;

export const answerAskUserContentSchema = z.object({
  answer: z.string(),
  wasFreeform: z.boolean().optional(),
  dismissed: z.boolean().optional(),
}).strict();
export type AnswerAskUserContent = z.infer<typeof answerAskUserContentSchema>;

export const answerElicitationContentSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type AnswerElicitationContent = z.infer<typeof answerElicitationContentSchema>;

export const answerPlanContentSchema = z.object({
  approved: z.boolean(),
  selectedAction: z.string().optional(),
  feedback: z.string().optional(),
}).strict();
export type AnswerPlanContent = z.infer<typeof answerPlanContentSchema>;

export const answerPermissionContentSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  scope: z.literal('once').optional(),
}).strict();
export type AnswerPermissionContent = z.infer<typeof answerPermissionContentSchema>;

const commandBase = {
  actionId: uuidV4Schema,
  sessionId: z.string().min(1),
  targetRequestId: z.string().min(1),
};

export const steeringCommandEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    ...commandBase,
    type: z.literal('answer-ask-user'),
    content: answerAskUserContentSchema,
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal('answer-elicitation'),
    content: answerElicitationContentSchema,
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal('answer-plan'),
    content: answerPlanContentSchema,
  }).strict(),
  z.object({
    ...commandBase,
    type: z.literal('answer-permission'),
    content: answerPermissionContentSchema,
  }).strict(),
]);
export type SteeringCommandEnvelope = z.infer<typeof steeringCommandEnvelopeSchema>;

export const steeringOutcomeSchema = z.enum([
  'pending',
  'applied',
  'duplicate',
  'already_resolved',
  'out_of_scope',
  'destructive_kind',
  'no_lease',
  'not_pending',
  'rate_limited',
]);
export type SteeringOutcome = z.infer<typeof steeringOutcomeSchema>;

export const steeringResultSchema = z.object({
  actionId: uuidV4Schema.optional(),
  outcome: steeringOutcomeSchema,
  leaseId: z.string().min(1).optional(),
  expiresAt: z.number().finite().optional(),
  heartbeatIntervalMs: z.number().int().positive().optional(),
  leaseTtlMs: z.number().int().positive().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
  requestId: z.string().min(1).optional(),
}).strict();
export type SteeringResult = z.infer<typeof steeringResultSchema>;

export const steeringLeaseRevocationReasonSchema = z.enum([
  'keystroke',
  'expired',
  'superseded',
  'released',
  'detached',
]);
export type SteeringLeaseRevocationReason = z.infer<typeof steeringLeaseRevocationReasonSchema>;

export const steeringLeaseRevokedSchema = z.object({
  leaseId: z.string().min(1).optional(),
  reason: steeringLeaseRevocationReasonSchema,
}).strict();
export type SteeringLeaseRevoked = z.infer<typeof steeringLeaseRevokedSchema>;

export const STEERING_RPC_METHODS = [
  'happy.attach',
  'happy.requestLease',
  'happy.heartbeat',
  'happy.releaseLease',
  'happy.answerPrompt',
  'happy.getControlState',
] as const;
export type SteeringRpcMethod = typeof STEERING_RPC_METHODS[number];

export const STEERING_RELAY_CALLER_KEY = '__happyRpcCaller' as const;

export const steeringRelayCallerSchema = z.object({
  connectionId: z.string().min(1),
}).strict();
export type SteeringRelayCaller = z.infer<typeof steeringRelayCallerSchema>;
