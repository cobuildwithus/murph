import { z } from 'zod'
import {
  isoTimestampSchema,
  pathSchema,
  timeZoneSchema,
} from './vault-cli-contracts.js'
import { isValidAssistantOpaqueId } from './assistant/state-ids.js'

export const assistantSandboxValues = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const

export const assistantApprovalPolicyValues = [
  'untrusted',
  'on-request',
  'never',
] as const
export const assistantReasoningEffortValues = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export const assistantChatProviderValues = ['codex-cli', 'openai-compatible'] as const
export const assistantChannelDeliveryTargetKindValues = [
  'explicit',
  'participant',
  'thread',
] as const
export const assistantBindingDeliveryKindValues = [
  'participant',
  'thread',
] as const
export const assistantTranscriptEntryKindValues = [
  'user',
  'assistant',
  'error',
] as const
export const assistantTurnTriggerValues = [
  'manual-ask',
  'manual-deliver',
  'automation-auto-reply',
  'automation-cron',
] as const
export const assistantTurnActionClassValues = ['analysis', 'outbound'] as const
export const assistantTurnStateValues = [
  'running',
  'awaiting-delivery',
  'deferred',
  'delivery-failed',
  'failed',
  'completed',
] as const
export const assistantTurnEventKindValues = [
  'accepted',
  'context-ready',
  'provider-started',
  'provider-completed',
  'delivery-prepared',
  'delivery-sent',
  'delivery-deduplicated',
  'deferred',
  'failed',
  'completed',
] as const
export const assistantMemoryRecordKindValues = [
  'long-term',
  'daily',
] as const
export const assistantMemoryWriteActorValues = [
  'assistant',
  'operator',
] as const
export const assistantMemoryQueryScopeValues = [
  'long-term',
  'daily',
  'all',
] as const
export const assistantMemoryWriteScopeValues = [
  'long-term',
  'daily',
  'both',
] as const
export const assistantMemoryLongTermSectionValues = [
  'Identity',
  'Preferences',
  'Standing instructions',
  'Health context',
] as const
export const assistantMemoryVisibleSectionValues = [
  ...assistantMemoryLongTermSectionValues,
  'Notes',
] as const
const assistantMemoryMarkdownFilePathSchema = z
  .string()
  .regex(/^(MEMORY\.md|memory\/\d{4}-\d{2}-\d{2}\.md)$/u)
export const assistantCronScheduleKindValues = [
  'at',
  'every',
  'cron',
  'dailyLocal',
] as const
export const assistantCronTriggerValues = ['manual', 'scheduled'] as const
export const assistantCronRunStatusValues = [
  'succeeded',
  'failed',
  'skipped',
] as const
export const assistantTurnReceiptStatusValues = [
  'running',
  'completed',
  'deferred',
  'blocked',
  'failed',
] as const
export const assistantTurnTimelineEventKindValues = [
  'turn.started',
  'user.persisted',
  'provider.attempt.started',
  'provider.attempt.succeeded',
  'provider.attempt.failed',
  'provider.failover.applied',
  'provider.cooldown.started',
  'delivery.queued',
  'delivery.attempt.started',
  'delivery.sent',
  'delivery.retry-scheduled',
  'delivery.failed',
  'turn.blocked',
  'turn.completed',
  'turn.deferred',
] as const
export const assistantAskResultStatusValues = ['completed'] as const
export const assistantOutboxStatusValues = [
  'pending',
  'sending',
  'retryable',
  'sent',
  'failed',
  'abandoned',
] as const
export const assistantDiagnosticLevelValues = [
  'info',
  'warn',
  'error',
] as const
export const assistantDiagnosticComponentValues = [
  'assistant',
  'provider',
  'delivery',
  'outbox',
  'automation',
  'status',
] as const
export const assistantStatusRunLockStateValues = [
  'unlocked',
  'active',
  'stale',
] as const

export const assistantQuarantineArtifactKindValues = [
  'session',
  'indexes',
  'automation',
  'status',
  'diagnostics-snapshot',
  'failover',
  'turn-receipt',
  'outbox-intent',
  'runtime-budget',
  'cron-store',
  'cron-run',
] as const

export const assistantRuntimeEventKindValues = [
  'session.upserted',
  'session.quarantined',
  'indexes.rebuilt',
  'indexes.quarantined',
  'automation.recovered',
  'automation.quarantined',
  'outbox.intent.upserted',
  'outbox.intent.quarantined',
  'turn.receipt.upserted',
  'turn.receipt.quarantined',
  'diagnostics.event.recorded',
  'diagnostics.snapshot.recovered',
  'diagnostics.snapshot.quarantined',
  'failover.state.upserted',
  'failover.state.quarantined',
  'status.snapshot.refreshed',
  'status.snapshot.quarantined',
  'runtime-budget.recovered',
  'runtime-budget.quarantined',
  'cron.store.quarantined',
  'cron.run.quarantined',
  'memory.upserted',
  'memory.removed',
  'runtime.maintenance',
] as const

export const assistantHeadersSchema = z.record(
  z.string().min(1),
  z.string(),
)

export const assistantCodexModelTargetSchema = z
  .object({
    adapter: z.literal('codex-cli'),
    approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable().default(null),
    codexCommand: z.string().min(1).nullable().default(null),
    model: z.string().min(1).nullable().default(null),
    oss: z.boolean().default(false),
    profile: z.string().min(1).nullable().default(null),
    reasoningEffort: z.enum(assistantReasoningEffortValues).nullable().default(null),
    sandbox: z.enum(assistantSandboxValues).nullable().default(null),
  })
  .strict()

export const assistantOpenAiCompatibleModelTargetSchema = z
  .object({
    adapter: z.literal('openai-compatible'),
    apiKeyEnv: z.string().min(1).nullable().default(null),
    endpoint: z.string().min(1).nullable().default(null),
    headers: assistantHeadersSchema.nullable().default(null),
    model: z.string().min(1).nullable().default(null),
    providerName: z.string().min(1).nullable().default(null),
    reasoningEffort: z.enum(assistantReasoningEffortValues).nullable().default(null),
  })
  .strict()

export const assistantModelTargetSchema = z.discriminatedUnion('adapter', [
  assistantCodexModelTargetSchema,
  assistantOpenAiCompatibleModelTargetSchema,
])

export const assistantSessionProviderStateSchema = z
  .object({
    resumeRouteId: z.string().min(1).nullable().default(null),
  })
  .strict()

export const assistantSessionResumeStateSchema = z
  .object({
    providerSessionId: z.string().min(1).nullable().default(null),
    resumeRouteId: z.string().min(1).nullable().default(null),
  })
  .strict()

export const assistantSessionIdSchema = z.string().refine(
  (value) => isValidAssistantOpaqueId(value),
  'Assistant session ids must be opaque runtime ids without path separators or traversal segments.',
)

export const assistantProviderSessionOptionsSchema = z.object({
  model: z.string().min(1).nullable(),
  reasoningEffort: z.string().min(1).nullable().default(null),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  profile: z.string().min(1).nullable(),
  oss: z.boolean(),
  baseUrl: z.string().min(1).nullable().optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
  providerName: z.string().min(1).nullable().optional(),
  headers: assistantHeadersSchema.nullable().optional(),
})

export const assistantSessionSecretsSchema = z
  .object({
    schema: z.literal('murph.assistant-session-secrets.v1'),
    sessionId: z.string().min(1),
    updatedAt: isoTimestampSchema,
    providerHeaders: assistantHeadersSchema.nullable().default(null),
    providerBindingHeaders: assistantHeadersSchema.nullable().default(null),
  })
  .strict()

export const assistantProviderFailoverRouteSchema = z
  .object({
    name: z.string().min(1).nullable().default(null),
    provider: z.enum(assistantChatProviderValues),
    codexCommand: z.string().min(1).nullable().default(null),
    model: z.string().min(1).nullable().default(null),
    reasoningEffort: z.string().min(1).nullable().default(null),
    sandbox: z.enum(assistantSandboxValues).nullable().default(null),
    approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable().default(null),
    profile: z.string().min(1).nullable().default(null),
    oss: z.boolean().default(false),
    baseUrl: z.string().min(1).nullable().optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
    providerName: z.string().min(1).nullable().optional(),
    headers: assistantHeadersSchema.nullable().optional(),
    cooldownMs: z.number().int().positive().nullable().default(null),
  })
  .strict()

export const assistantAliasStoreSchema = z
  .object({
    version: z.literal(2),
    aliases: z.record(z.string(), assistantSessionIdSchema),
    conversationKeys: z.record(z.string(), assistantSessionIdSchema),
  })
  .strict()

export const assistantBindingDeliverySchema = z.object({
  kind: z.enum(assistantBindingDeliveryKindValues),
  target: z.string().min(1),
})

export const assistantSessionBindingSchema = z.object({
  conversationKey: z.string().min(1).nullable(),
  channel: z.string().min(1).nullable(),
  identityId: z.string().min(1).nullable(),
  actorId: z.string().min(1).nullable(),
  threadId: z.string().min(1).nullable(),
  threadIsDirect: z.boolean().nullable(),
  delivery: assistantBindingDeliverySchema.nullable(),
})

export const assistantProviderBindingSchema = z
  .object({
    provider: z.enum(assistantChatProviderValues),
    providerSessionId: z.string().min(1).nullable(),
    providerState: assistantSessionProviderStateSchema.nullable().optional(),
    providerOptions: assistantProviderSessionOptionsSchema,
  })
  .strict()

export const assistantPersistedSessionSchema = z
  .object({
    schema: z.literal('murph.assistant-session.v4'),
    sessionId: assistantSessionIdSchema,
    target: assistantModelTargetSchema,
    resumeState: assistantSessionResumeStateSchema.nullable().default(null),
    alias: z.string().min(1).nullable(),
    binding: assistantSessionBindingSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastTurnAt: isoTimestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
  })
  .strict()

export const assistantSessionSchema = assistantPersistedSessionSchema.transform((value) =>
  normalizeAssistantSessionRecord(value),
)

export function parseAssistantSessionRecord(value: unknown): AssistantSession {
  return assistantSessionSchema.parse(value)
}

const assistantSessionOutputSchema = assistantPersistedSessionSchema
  .extend({
    provider: z.enum(assistantChatProviderValues),
    providerOptions: assistantProviderSessionOptionsSchema,
    providerBinding: assistantProviderBindingSchema.nullable().default(null),
  })
  .strict()

function normalizeAssistantSessionRecord(
  value: z.infer<typeof assistantPersistedSessionSchema>,
): AssistantSession {
  return buildAssistantRuntimeSession({
    ...value,
    resumeState: normalizeAssistantSessionResumeState(value.resumeState),
  })
}

function buildAssistantRuntimeSession(
  value: AssistantPersistedSessionRecord,
): AssistantSession {
  const provider = value.target.adapter
  const providerOptions =
    value.target.adapter === 'openai-compatible'
      ? assistantProviderSessionOptionsSchema.parse({
          model: value.target.model,
          reasoningEffort: value.target.reasoningEffort,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          ...(value.target.endpoint ? { baseUrl: value.target.endpoint } : {}),
          ...(value.target.apiKeyEnv ? { apiKeyEnv: value.target.apiKeyEnv } : {}),
          ...(value.target.providerName
            ? { providerName: value.target.providerName }
            : {}),
          ...(value.target.headers ? { headers: value.target.headers } : {}),
        })
      : assistantProviderSessionOptionsSchema.parse({
          model: value.target.model,
          reasoningEffort: value.target.reasoningEffort,
          sandbox: value.target.sandbox,
          approvalPolicy: value.target.approvalPolicy,
          profile: value.target.profile,
          oss: value.target.oss,
        })
  const providerBinding =
    value.resumeState &&
    (value.resumeState.providerSessionId !== null ||
      value.resumeState.resumeRouteId !== null)
      ? assistantProviderBindingSchema.parse({
          provider,
          providerOptions,
          providerSessionId: value.resumeState.providerSessionId,
          providerState:
            value.resumeState.resumeRouteId !== null
              ? {
                  resumeRouteId: value.resumeState.resumeRouteId,
                }
              : null,
        })
      : null

  return {
    ...value,
    provider,
    providerBinding,
    providerOptions,
  }
}

function normalizeAssistantSessionResumeState(
  value: AssistantSessionResumeState | null | undefined,
): AssistantSessionResumeState | null {
  if (!value) {
    return null
  }

  const providerSessionId =
    typeof value.providerSessionId === 'string' && value.providerSessionId.trim().length > 0
      ? value.providerSessionId.trim()
      : null
  const resumeRouteId =
    typeof value.resumeRouteId === 'string' && value.resumeRouteId.trim().length > 0
      ? value.resumeRouteId.trim()
      : null

  return providerSessionId || resumeRouteId
    ? assistantSessionResumeStateSchema.parse({
        providerSessionId,
        resumeRouteId,
      })
    : null
}

export const assistantTranscriptEntrySchema = z.object({
  schema: z.literal('murph.assistant-transcript-entry.v1'),
  kind: z.enum(assistantTranscriptEntryKindValues),
  text: z.string(),
  createdAt: isoTimestampSchema,
})

export const assistantChannelDeliverySchema = z.object({
  channel: z.string().min(1),
  idempotencyKey: z.string().min(1).nullable().default(null),
  target: z.string().min(1),
  targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
  sentAt: isoTimestampSchema,
  messageLength: z.number().int().nonnegative(),
  providerMessageId: z.string().min(1).nullable().default(null),
  providerThreadId: z.string().min(1).nullable().default(null),
})

export const assistantDeliveryErrorSchema = z.object({
  code: z.string().min(1).nullable(),
  message: z.string().min(1),
})

export const assistantTurnReceiptContextSchema = z
  .object({
    deliveryRequested: z.boolean(),
    usedConversationTranscript: z.boolean(),
    usedMemoryPrompt: z.boolean(),
    usedSensitiveHealthContext: z.boolean(),
  })
  .strict()

export const assistantTurnReceiptEventSchema = z
  .object({
    at: isoTimestampSchema,
    kind: z.enum(assistantTurnEventKindValues),
    message: z.string().min(1),
    state: z.enum(assistantTurnStateValues).nullable(),
  })
  .strict()

export const assistantTurnTimelineEventSchema = z
  .object({
    at: isoTimestampSchema,
    kind: z.enum(assistantTurnTimelineEventKindValues),
    detail: z.string().nullable().default(null),
    metadata: z.record(z.string(), z.string()).default({}),
  })
  .strict()

export const assistantTurnReceiptSchema = z
  .object({
    schema: z.literal('murph.assistant-turn-receipt.v1'),
    turnId: z.string().min(1),
    sessionId: assistantSessionIdSchema,
    provider: z.enum(assistantChatProviderValues),
    providerModel: z.string().min(1).nullable(),
    promptPreview: z.string().nullable(),
    responsePreview: z.string().nullable(),
    status: z.enum(assistantTurnReceiptStatusValues),
    deliveryRequested: z.boolean(),
    deliveryDisposition: z.enum([
      'not-requested',
      'queued',
      'sent',
      'retryable',
      'blocked',
      'failed',
    ]),
    deliveryIntentId: z.string().min(1).nullable(),
    startedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
    lastError: assistantDeliveryErrorSchema.nullable(),
    timeline: z.array(assistantTurnTimelineEventSchema),
  })
  .strict()

export const assistantOutboxIntentStatusValues = assistantOutboxStatusValues

export const assistantOutboxIntentSchema = z
  .object({
    schema: z.literal('murph.assistant-outbox-intent.v1'),
    intentId: z.string().min(1),
    sessionId: assistantSessionIdSchema,
    turnId: z.string().min(1),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastAttemptAt: isoTimestampSchema.nullable(),
    nextAttemptAt: isoTimestampSchema.nullable(),
    sentAt: isoTimestampSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    status: z.enum(assistantOutboxIntentStatusValues),
    message: z.string().min(1),
    dedupeKey: z.string().min(1),
    targetFingerprint: z.string().min(1),
    channel: z.string().min(1).nullable(),
    identityId: z.string().min(1).nullable(),
    actorId: z.string().min(1).nullable(),
    threadId: z.string().min(1).nullable(),
    threadIsDirect: z.boolean().nullable(),
    replyToMessageId: z.string().min(1).nullable().default(null),
    bindingDelivery: assistantBindingDeliverySchema.nullable(),
    explicitTarget: z.string().min(1).nullable(),
    delivery: assistantChannelDeliverySchema.nullable(),
    deliveryConfirmationPending: z.boolean().default(false),
    deliveryIdempotencyKey: z.string().min(1).nullable().default(null),
    deliveryTransportIdempotent: z.boolean().default(false),
    lastError: assistantDeliveryErrorSchema.nullable(),
  })
  .strict()

export const assistantDiagnosticEventSchema = z
  .object({
    schema: z.literal('murph.assistant-diagnostic-event.v1'),
    at: isoTimestampSchema,
    level: z.enum(assistantDiagnosticLevelValues),
    component: z.enum(assistantDiagnosticComponentValues),
    kind: z.string().min(1),
    message: z.string().min(1),
    code: z.string().min(1).nullable(),
    sessionId: z.string().min(1).nullable(),
    turnId: z.string().min(1).nullable(),
    intentId: z.string().min(1).nullable(),
    dataJson: z.string().nullable(),
  })
  .strict()

export const assistantDiagnosticsCountersSchema = z
  .object({
    turnsStarted: z.number().int().nonnegative(),
    turnsCompleted: z.number().int().nonnegative(),
    turnsDeferred: z.number().int().nonnegative(),
    turnsFailed: z.number().int().nonnegative(),
    providerAttempts: z.number().int().nonnegative(),
    providerFailures: z.number().int().nonnegative(),
    providerFailovers: z.number().int().nonnegative(),
    deliveriesQueued: z.number().int().nonnegative(),
    deliveriesSent: z.number().int().nonnegative(),
    deliveriesFailed: z.number().int().nonnegative(),
    deliveriesRetryable: z.number().int().nonnegative(),
    outboxDrains: z.number().int().nonnegative(),
    outboxRetries: z.number().int().nonnegative(),
    automationScans: z.number().int().nonnegative(),
  })
  .strict()

export const assistantDiagnosticsSnapshotSchema = z
  .object({
    schema: z.literal('murph.assistant-diagnostics.v1'),
    updatedAt: isoTimestampSchema,
    lastEventAt: isoTimestampSchema.nullable(),
    lastErrorAt: isoTimestampSchema.nullable(),
    counters: assistantDiagnosticsCountersSchema,
    recentWarnings: z.array(z.string()),
  })
  .strict()

export const assistantQuarantineEntrySchema = z
  .object({
    schema: z.literal('murph.assistant-quarantine-entry.v1'),
    quarantineId: z.string().min(1),
    artifactKind: z.enum(assistantQuarantineArtifactKindValues),
    originalPath: pathSchema,
    quarantinedPath: pathSchema,
    metadataPath: pathSchema,
    quarantinedAt: isoTimestampSchema,
    errorCode: z.string().min(1).nullable(),
    message: z.string().min(1),
  })
  .strict()

export const assistantQuarantineSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
    recent: z.array(assistantQuarantineEntrySchema),
  })
  .strict()

export const assistantRuntimeCacheBudgetSchema = z
  .object({
    name: z.string().min(1),
    limit: z.number().int().positive(),
    size: z.number().int().nonnegative(),
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    evictions: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    ttlMs: z.number().int().positive(),
  })
  .strict()

export const assistantRuntimeMaintenanceSnapshotSchema = z
  .object({
    lastRunAt: isoTimestampSchema.nullable(),
    staleQuarantinePruned: z.number().int().nonnegative(),
    staleLocksCleared: z.number().int().nonnegative(),
    notes: z.array(z.string()),
  })
  .strict()

export const assistantRuntimeBudgetSnapshotSchema = z
  .object({
    schema: z.literal('murph.assistant-runtime-budget.v1'),
    updatedAt: isoTimestampSchema,
    caches: z.array(assistantRuntimeCacheBudgetSchema),
    maintenance: assistantRuntimeMaintenanceSnapshotSchema,
  })
  .strict()

export const assistantRuntimeEventSchema = z
  .object({
    schema: z.literal('murph.assistant-runtime-event.v1'),
    at: isoTimestampSchema,
    level: z.enum(assistantDiagnosticLevelValues),
    kind: z.enum(assistantRuntimeEventKindValues),
    component: z.string().min(1),
    entityId: z.string().min(1).nullable(),
    entityType: z.string().min(1).nullable(),
    message: z.string().min(1),
    dataJson: z.string().nullable(),
  })
  .strict()

export const assistantProviderRouteStateSchema = z
  .object({
    routeId: z.string().min(1),
    label: z.string().min(1),
    provider: z.enum(assistantChatProviderValues),
    model: z.string().min(1).nullable(),
    failureCount: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    consecutiveFailures: z.number().int().nonnegative(),
    lastFailureAt: isoTimestampSchema.nullable(),
    lastErrorCode: z.string().min(1).nullable(),
    lastErrorMessage: z.string().min(1).nullable(),
    cooldownUntil: isoTimestampSchema.nullable(),
  })
  .strict()

export const assistantFailoverStateSchema = z
  .object({
    schema: z.literal('murph.assistant-failover-state.v1'),
    updatedAt: isoTimestampSchema,
    routes: z.array(assistantProviderRouteStateSchema),
  })
  .strict()

export const assistantStatusRunLockSchema = z
  .object({
    state: z.enum(assistantStatusRunLockStateValues),
    pid: z.number().int().positive().nullable(),
    startedAt: isoTimestampSchema.nullable(),
    mode: z.enum(['continuous', 'once']).nullable(),
    command: z.string().min(1).nullable(),
    reason: z.string().nullable(),
  })
  .strict()

export const assistantStatusAutomationSchema = z
  .object({
    inboxScanCursor: z.lazy(() => assistantAutomationCursorSchema).nullable(),
    autoReplyScanCursor: z.lazy(() => assistantAutomationCursorSchema).nullable(),
    autoReplyChannels: z.array(z.string().min(1)),
    preferredChannels: z.array(z.string().min(1)),
    autoReplyBacklogChannels: z.array(z.string().min(1)),
    autoReplyPrimed: z.boolean(),
    updatedAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const assistantStatusOutboxSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    sending: z.number().int().nonnegative(),
    retryable: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    abandoned: z.number().int().nonnegative(),
    oldestPendingAt: isoTimestampSchema.nullable(),
    nextAttemptAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const assistantStatusResultSchema = z
  .object({
    vault: pathSchema,
    stateRoot: pathSchema,
    statusPath: pathSchema,
    outboxRoot: pathSchema,
    diagnosticsPath: pathSchema,
    failoverStatePath: pathSchema,
    turnsRoot: pathSchema,
    generatedAt: isoTimestampSchema,
    runLock: assistantStatusRunLockSchema,
    automation: assistantStatusAutomationSchema,
    outbox: assistantStatusOutboxSummarySchema,
    diagnostics: assistantDiagnosticsSnapshotSchema,
    failover: assistantFailoverStateSchema,
    quarantine: assistantQuarantineSummarySchema,
    runtimeBudget: assistantRuntimeBudgetSnapshotSchema,
    recentTurns: z.array(assistantTurnReceiptSchema),
    warnings: z.array(z.string()),
  })
  .strict()

export const assistantDoctorCheckStatusValues = ['pass', 'warn', 'fail'] as const

export const assistantDoctorCheckSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(assistantDoctorCheckStatusValues),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const assistantDoctorResultSchema = z
  .object({
    vault: pathSchema,
    stateRoot: pathSchema,
    ok: z.boolean(),
    sessionCount: z.number().int().nonnegative(),
    transcriptFileCount: z.number().int().nonnegative(),
    receiptCount: z.number().int().nonnegative(),
    outboxIntentCount: z.number().int().nonnegative(),
    quarantineCount: z.number().int().nonnegative(),
    checks: z.array(assistantDoctorCheckSchema),
  })
  .strict()

export const assistantMemoryRecordProvenanceSchema = z.object({
  writtenBy: z.enum(assistantMemoryWriteActorValues),
  sessionId: z.string().min(1).nullable(),
  turnId: z.string().min(1).nullable(),
})

export const assistantMemoryRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(assistantMemoryRecordKindValues),
  section: z.enum(assistantMemoryVisibleSectionValues),
  text: z.string().min(1),
  recordedAt: z.string().min(1).nullable(),
  sourcePath: pathSchema,
  sourceLine: z.number().int().positive(),
  provenance: assistantMemoryRecordProvenanceSchema.nullable(),
})

export const assistantMemorySearchHitSchema = assistantMemoryRecordSchema.extend({
  score: z.number().int().nonnegative(),
})

export const assistantCronAtScheduleSchema = z
  .object({
    kind: z.literal('at'),
    at: isoTimestampSchema,
  })
  .strict()

export const assistantCronEveryScheduleSchema = z
  .object({
    kind: z.literal('every'),
    everyMs: z.number().int().positive(),
  })
  .strict()

export const assistantCronExpressionScheduleSchema = z
  .object({
    kind: z.literal('cron'),
    expression: z.string().min(1),
    timeZone: timeZoneSchema,
  })
  .strict()

export const assistantCronExpressionScheduleInputSchema = z
  .object({
    kind: z.literal('cron'),
    expression: z.string().min(1),
    timeZone: timeZoneSchema.optional(),
  })
  .strict()

export const assistantCronDailyLocalScheduleSchema = z
  .object({
    kind: z.literal('dailyLocal'),
    localTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'Expected a 24-hour HH:MM time.'),
    timeZone: timeZoneSchema,
  })
  .strict()

export const assistantCronScheduleSchema = z.discriminatedUnion('kind', [
  assistantCronAtScheduleSchema,
  assistantCronEveryScheduleSchema,
  assistantCronExpressionScheduleSchema,
  assistantCronDailyLocalScheduleSchema,
])

export const assistantCronScheduleInputSchema = z.discriminatedUnion('kind', [
  assistantCronAtScheduleSchema,
  assistantCronEveryScheduleSchema,
  assistantCronExpressionScheduleInputSchema,
  assistantCronDailyLocalScheduleSchema,
])

export const assistantCronTargetSchema = z
  .object({
    sessionId: z.string().min(1).nullable(),
    alias: z.string().min(1).nullable(),
    channel: z.string().min(1).nullable(),
    identityId: z.string().min(1).nullable(),
    participantId: z.string().min(1).nullable(),
    sourceThreadId: z.string().min(1).nullable(),
    deliveryTarget: z.string().min(1).nullable(),
    deliverResponse: z.boolean(),
  })
  .strict()

export const assistantSelfDeliveryTargetSchema = z
  .object({
    channel: z.string().min(1),
    identityId: z.string().min(1).nullable(),
    participantId: z.string().min(1).nullable(),
    sourceThreadId: z.string().min(1).nullable(),
    deliveryTarget: z.string().min(1).nullable(),
  })
  .strict()

export const assistantCronJobStateSchema = z
  .object({
    nextRunAt: isoTimestampSchema.nullable(),
    lastRunAt: isoTimestampSchema.nullable(),
    lastSucceededAt: isoTimestampSchema.nullable(),
    lastFailedAt: isoTimestampSchema.nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    runningAt: isoTimestampSchema.nullable(),
    runningPid: z.number().int().positive().nullable(),
  })
  .strict()

export const assistantCronFoodAutoLogSchema = z
  .object({
    foodId: z.string().min(1),
  })
  .strict()

export const assistantCronJobSchema = z
  .object({
    schema: z.literal('murph.assistant-cron-job.v1'),
    jobId: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    keepAfterRun: z.boolean(),
    prompt: z.string().min(1),
    schedule: assistantCronScheduleSchema,
    target: assistantCronTargetSchema,
    stateDocId: z.string().min(1).nullable().default(null),
    foodAutoLog: assistantCronFoodAutoLogSchema.optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    state: assistantCronJobStateSchema,
  })
  .strict()

export const assistantCronRunRecordSchema = z
  .object({
    schema: z.literal('murph.assistant-cron-run.v1'),
    runId: z.string().min(1),
    jobId: z.string().min(1),
    trigger: z.enum(assistantCronTriggerValues),
    status: z.enum(assistantCronRunStatusValues),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema,
    sessionId: z.string().min(1).nullable(),
    response: z.string().nullable(),
    responseLength: z.number().int().nonnegative(),
    error: z.string().nullable(),
  })
  .strict()

export const assistantCronPresetVariableSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    required: z.boolean(),
    defaultValue: z.string().min(1).nullable(),
    example: z.string().min(1).nullable(),
  })
  .strict()

export const assistantCronPresetSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    suggestedName: z.string().min(1),
    suggestedSchedule: assistantCronScheduleInputSchema,
    suggestedScheduleLabel: z.string().min(1),
    variables: z.array(assistantCronPresetVariableSchema),
  })
  .strict()

export const assistantAskResultSchema = z.object({
  vault: pathSchema,
  status: z.enum(assistantAskResultStatusValues).default('completed'),
  prompt: z.string().min(1),
  response: z.string(),
  session: assistantSessionOutputSchema,
  delivery: assistantChannelDeliverySchema.nullable(),
  deliveryDeferred: z.boolean().default(false),
  deliveryIntentId: z.string().min(1).nullable().default(null),
  deliveryError: assistantDeliveryErrorSchema.nullable(),
})

export const assistantChatResultSchema = z.object({
  vault: pathSchema,
  startedAt: isoTimestampSchema,
  stoppedAt: isoTimestampSchema,
  turns: z.number().int().nonnegative(),
  session: assistantSessionOutputSchema,
})

export const assistantDeliverResultSchema = z.object({
  vault: pathSchema,
  message: z.string().min(1),
  session: assistantSessionOutputSchema,
  delivery: assistantChannelDeliverySchema,
})

export const assistantSessionListResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  sessions: z.array(assistantSessionOutputSchema),
})

export const assistantSessionShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  session: assistantSessionOutputSchema,
})

export const assistantMemorySearchResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  query: z.string().min(1).nullable(),
  scope: z.enum(assistantMemoryQueryScopeValues),
  section: z.enum(assistantMemoryVisibleSectionValues).nullable(),
  results: z.array(assistantMemorySearchHitSchema),
})

export const assistantMemoryGetResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  memory: assistantMemoryRecordSchema,
})

export const assistantMemoryFileReadResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  path: assistantMemoryMarkdownFilePathSchema,
  present: z.boolean(),
  text: z.string(),
  totalChars: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export const assistantMemoryFileWriteResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  path: assistantMemoryMarkdownFilePathSchema,
  totalChars: z.number().int().nonnegative(),
})

export const assistantMemoryFileAppendResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  path: assistantMemoryMarkdownFilePathSchema,
  appended: z.boolean(),
  section: z.enum(assistantMemoryVisibleSectionValues),
  totalBullets: z.number().int().nonnegative(),
})

export const assistantStateDocumentValueSchema = z.record(
  z.string(),
  z.unknown(),
)

export const assistantStateDocumentSchema = z.object({
  docId: z.string().min(1),
  documentPath: pathSchema,
  exists: z.boolean(),
  updatedAt: isoTimestampSchema.nullable(),
  value: assistantStateDocumentValueSchema.nullable(),
})

export const assistantStateDocumentListEntrySchema = z.object({
  docId: z.string().min(1),
  documentPath: pathSchema,
  updatedAt: isoTimestampSchema,
})

export const assistantStateListResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  documentsRoot: pathSchema,
  prefix: z.string().min(1).nullable(),
  documents: z.array(assistantStateDocumentListEntrySchema),
})

export const assistantStateShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  documentsRoot: pathSchema,
  document: assistantStateDocumentSchema,
})

export const assistantStatePutResultSchema = assistantStateShowResultSchema

export const assistantStatePatchResultSchema = assistantStateShowResultSchema

export const assistantStateDeleteResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  documentsRoot: pathSchema,
  docId: z.string().min(1),
  documentPath: pathSchema,
  existed: z.boolean(),
})

export const assistantCronStatusResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  totalJobs: z.number().int().nonnegative(),
  enabledJobs: z.number().int().nonnegative(),
  dueJobs: z.number().int().nonnegative(),
  runningJobs: z.number().int().nonnegative(),
  nextRunAt: isoTimestampSchema.nullable(),
})

export const assistantCronListResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  jobs: z.array(assistantCronJobSchema),
})

export const assistantCronShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  job: assistantCronJobSchema,
})

export const assistantCronAddResultSchema = assistantCronShowResultSchema

export const assistantCronRemoveResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  removed: assistantCronJobSchema,
})

export const assistantCronRunResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  job: assistantCronJobSchema,
  removedAfterRun: z.boolean(),
  run: assistantCronRunRecordSchema,
})

export const assistantCronRunsResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  jobId: z.string().min(1),
  runs: z.array(assistantCronRunRecordSchema),
})

export const assistantCronTargetSnapshotSchema = z.object({
  jobId: z.string().min(1),
  jobName: z.string().min(1),
  target: assistantCronTargetSchema,
  bindingDelivery: assistantBindingDeliverySchema.nullable(),
})

export const assistantCronTargetShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  cronTarget: assistantCronTargetSnapshotSchema,
})

export const assistantCronTargetSetResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  job: assistantCronJobSchema,
  beforeTarget: assistantCronTargetSnapshotSchema,
  afterTarget: assistantCronTargetSnapshotSchema,
  changed: z.boolean(),
  continuityReset: z.boolean(),
  dryRun: z.boolean(),
})

export const assistantCronPresetListResultSchema = z.object({
  vault: pathSchema,
  presets: z.array(assistantCronPresetSchema),
})

export const assistantCronPresetShowResultSchema = z.object({
  vault: pathSchema,
  preset: assistantCronPresetSchema,
  promptTemplate: z.string().min(1),
})

export const assistantCronPresetInstallResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  jobsPath: pathSchema,
  runsRoot: pathSchema,
  preset: assistantCronPresetSchema,
  job: assistantCronJobSchema,
  resolvedPrompt: z.string().min(1),
  resolvedVariables: z.record(z.string(), z.string()),
})

export const assistantSelfDeliveryTargetListResultSchema = z.object({
  configPath: pathSchema,
  targets: z.array(assistantSelfDeliveryTargetSchema),
})

export const assistantSelfDeliveryTargetShowResultSchema = z.object({
  configPath: pathSchema,
  target: assistantSelfDeliveryTargetSchema.nullable(),
})

export const assistantSelfDeliveryTargetSetResultSchema = z.object({
  configPath: pathSchema,
  target: assistantSelfDeliveryTargetSchema,
})

export const assistantSelfDeliveryTargetClearResultSchema = z.object({
  configPath: pathSchema,
  clearedChannels: z.array(z.string().min(1)),
})

export const assistantRunResultSchema = z.object({
  vault: pathSchema,
  startedAt: isoTimestampSchema,
  stoppedAt: isoTimestampSchema,
  reason: z.enum(['completed', 'signal', 'error']),
  daemonStarted: z.boolean(),
  scans: z.number().int().nonnegative(),
  considered: z.number().int().nonnegative(),
  routed: z.number().int().nonnegative(),
  noAction: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  replyConsidered: z.number().int().nonnegative(),
  replied: z.number().int().nonnegative(),
  replySkipped: z.number().int().nonnegative(),
  replyFailed: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
})

export const assistantStopResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  stopped: z.boolean(),
  stopMethod: z.enum(['signal', 'force-kill', 'stale-lock-cleanup']),
  pid: z.number().int().positive().nullable(),
  startedAt: isoTimestampSchema.nullable(),
  stoppedAt: isoTimestampSchema,
  command: z.string().min(1).nullable(),
  message: z.string().min(1),
})

export const assistantAutomationCursorSchema = z.object({
  occurredAt: isoTimestampSchema,
  captureId: z.string().min(1),
})

export const assistantAutomationStateSchema = z
  .object({
    version: z.literal(2),
    inboxScanCursor: assistantAutomationCursorSchema.nullable(),
    autoReplyScanCursor: assistantAutomationCursorSchema.nullable(),
    autoReplyChannels: z.array(z.string().min(1)),
    preferredChannels: z.array(z.string().min(1)).default([]),
    preferredScheduledUpdates: z.array(z.string().min(1)).optional(),
    autoReplyBacklogChannels: z.array(z.string().min(1)).default([]),
    autoReplyPrimed: z.boolean(),
    updatedAt: isoTimestampSchema,
  })
  .strict()

export type AssistantAliasStore = z.infer<typeof assistantAliasStoreSchema>
export type AssistantBindingDelivery = z.infer<
  typeof assistantBindingDeliverySchema
>
export type AssistantSessionBinding = z.infer<
  typeof assistantSessionBindingSchema
>
export type AssistantModelTarget = z.infer<typeof assistantModelTargetSchema>
export type AssistantSessionResumeState = z.infer<
  typeof assistantSessionResumeStateSchema
>
export type AssistantProviderBinding = z.infer<
  typeof assistantProviderBindingSchema
>
type AssistantPersistedSessionRecord = z.infer<typeof assistantPersistedSessionSchema>
export type AssistantSession = AssistantPersistedSessionRecord & {
  provider: AssistantChatProvider
  providerOptions: z.infer<typeof assistantProviderSessionOptionsSchema>
  providerBinding?: AssistantProviderBinding | null
}
export type AssistantTranscriptEntry = z.infer<
  typeof assistantTranscriptEntrySchema
>
export type AssistantChannelDelivery = z.infer<
  typeof assistantChannelDeliverySchema
>
export type AssistantDeliveryError = z.infer<
  typeof assistantDeliveryErrorSchema
>
export type AssistantTurnReceiptContext = z.infer<
  typeof assistantTurnReceiptContextSchema
>
export type AssistantTurnReceiptEvent = z.infer<
  typeof assistantTurnReceiptEventSchema
>
export type AssistantTurnTimelineEvent = z.infer<
  typeof assistantTurnTimelineEventSchema
>
export type AssistantTurnReceipt = z.infer<typeof assistantTurnReceiptSchema>
export type AssistantOutboxIntent = z.infer<typeof assistantOutboxIntentSchema>
export type AssistantDiagnosticEvent = z.infer<
  typeof assistantDiagnosticEventSchema
>
export type AssistantQuarantineArtifactKind =
  (typeof assistantQuarantineArtifactKindValues)[number]
export type AssistantQuarantineEntry = z.infer<
  typeof assistantQuarantineEntrySchema
>
export type AssistantQuarantineSummary = z.infer<
  typeof assistantQuarantineSummarySchema
>
export type AssistantRuntimeEventKind =
  (typeof assistantRuntimeEventKindValues)[number]
export type AssistantRuntimeEvent = z.infer<
  typeof assistantRuntimeEventSchema
>
export type AssistantRuntimeCacheBudget = z.infer<
  typeof assistantRuntimeCacheBudgetSchema
>
export type AssistantRuntimeMaintenanceSnapshot = z.infer<
  typeof assistantRuntimeMaintenanceSnapshotSchema
>
export type AssistantRuntimeBudgetSnapshot = z.infer<
  typeof assistantRuntimeBudgetSnapshotSchema
>
export type AssistantDiagnosticsCounters = z.infer<
  typeof assistantDiagnosticsCountersSchema
>
export type AssistantDiagnosticsSnapshot = z.infer<
  typeof assistantDiagnosticsSnapshotSchema
>
export type AssistantProviderFailoverRoute = z.infer<
  typeof assistantProviderFailoverRouteSchema
>
export type AssistantProviderRouteState = z.infer<
  typeof assistantProviderRouteStateSchema
>
export type AssistantFailoverState = z.infer<
  typeof assistantFailoverStateSchema
>
type AssistantAskResultRecord = z.infer<typeof assistantAskResultSchema>
export type AssistantAskResult = AssistantAskResultRecord
type AssistantChatResultRecord = z.infer<typeof assistantChatResultSchema>
export type AssistantChatResult = AssistantChatResultRecord
export type AssistantDeliverResult = z.infer<
  typeof assistantDeliverResultSchema
>
export type AssistantSessionListResult = z.infer<
  typeof assistantSessionListResultSchema
>
export type AssistantSessionShowResult = z.infer<
  typeof assistantSessionShowResultSchema
>
export type AssistantMemoryRecord = z.infer<
  typeof assistantMemoryRecordSchema
>
export type AssistantMemoryRecordProvenance = z.infer<
  typeof assistantMemoryRecordProvenanceSchema
>
export type AssistantMemorySearchHit = z.infer<
  typeof assistantMemorySearchHitSchema
>
export type AssistantMemorySearchResult = z.infer<
  typeof assistantMemorySearchResultSchema
>
export type AssistantMemoryGetResult = z.infer<
  typeof assistantMemoryGetResultSchema
>
export type AssistantMemoryFileReadResult = z.infer<
  typeof assistantMemoryFileReadResultSchema
>
export type AssistantMemoryFileWriteResult = z.infer<
  typeof assistantMemoryFileWriteResultSchema
>
export type AssistantMemoryFileAppendResult = z.infer<
  typeof assistantMemoryFileAppendResultSchema
>
export type AssistantStateDocumentValue = z.infer<
  typeof assistantStateDocumentValueSchema
>
export type AssistantStateDocument = z.infer<
  typeof assistantStateDocumentSchema
>
export type AssistantStateDocumentListEntry = z.infer<
  typeof assistantStateDocumentListEntrySchema
>
export type AssistantStateListResult = z.infer<
  typeof assistantStateListResultSchema
>
export type AssistantStateShowResult = z.infer<
  typeof assistantStateShowResultSchema
>
export type AssistantStatePutResult = z.infer<
  typeof assistantStatePutResultSchema
>
export type AssistantStatePatchResult = z.infer<
  typeof assistantStatePatchResultSchema
>
export type AssistantStateDeleteResult = z.infer<
  typeof assistantStateDeleteResultSchema
>
export type AssistantCronSchedule = z.infer<typeof assistantCronScheduleSchema>
export type AssistantCronScheduleInput = z.infer<typeof assistantCronScheduleInputSchema>
export type AssistantCronTarget = z.infer<typeof assistantCronTargetSchema>
export type AssistantCronJobState = z.infer<typeof assistantCronJobStateSchema>
export type AssistantCronFoodAutoLog = z.infer<typeof assistantCronFoodAutoLogSchema>
export type AssistantCronJob = z.infer<typeof assistantCronJobSchema>
export type AssistantCronRunRecord = z.infer<
  typeof assistantCronRunRecordSchema
>
export type AssistantCronPresetVariable = z.infer<
  typeof assistantCronPresetVariableSchema
>
export type AssistantCronPreset = z.infer<typeof assistantCronPresetSchema>
export type AssistantCronStatusResult = z.infer<
  typeof assistantCronStatusResultSchema
>
export type AssistantCronListResult = z.infer<
  typeof assistantCronListResultSchema
>
export type AssistantCronShowResult = z.infer<
  typeof assistantCronShowResultSchema
>
export type AssistantCronAddResult = z.infer<typeof assistantCronAddResultSchema>
export type AssistantCronRemoveResult = z.infer<
  typeof assistantCronRemoveResultSchema
>
export type AssistantCronRunResult = z.infer<typeof assistantCronRunResultSchema>
export type AssistantCronRunsResult = z.infer<
  typeof assistantCronRunsResultSchema
>
export type AssistantCronTargetSnapshot = z.infer<
  typeof assistantCronTargetSnapshotSchema
>
export type AssistantCronTargetShowResult = z.infer<
  typeof assistantCronTargetShowResultSchema
>
export type AssistantCronTargetSetResult = z.infer<
  typeof assistantCronTargetSetResultSchema
>
export type AssistantCronPresetListResult = z.infer<
  typeof assistantCronPresetListResultSchema
>
export type AssistantCronPresetShowResult = z.infer<
  typeof assistantCronPresetShowResultSchema
>
export type AssistantCronPresetInstallResult = z.infer<
  typeof assistantCronPresetInstallResultSchema
>
export type AssistantSelfDeliveryTarget = z.infer<
  typeof assistantSelfDeliveryTargetSchema
>
export type AssistantSelfDeliveryTargetListResult = z.infer<
  typeof assistantSelfDeliveryTargetListResultSchema
>
export type AssistantSelfDeliveryTargetShowResult = z.infer<
  typeof assistantSelfDeliveryTargetShowResultSchema
>
export type AssistantSelfDeliveryTargetSetResult = z.infer<
  typeof assistantSelfDeliveryTargetSetResultSchema
>
export type AssistantSelfDeliveryTargetClearResult = z.infer<
  typeof assistantSelfDeliveryTargetClearResultSchema
>
export type AssistantRunResult = z.infer<typeof assistantRunResultSchema>
export type AssistantStopResult = z.infer<typeof assistantStopResultSchema>
export type AssistantStatusRunLock = z.infer<
  typeof assistantStatusRunLockSchema
>
export type AssistantStatusAutomation = z.infer<
  typeof assistantStatusAutomationSchema
>
export type AssistantStatusOutboxSummary = z.infer<
  typeof assistantStatusOutboxSummarySchema
>
export type AssistantStatusResult = z.infer<
  typeof assistantStatusResultSchema
>
export type AssistantDoctorCheck = z.infer<typeof assistantDoctorCheckSchema>
export type AssistantDoctorResult = z.infer<
  typeof assistantDoctorResultSchema
>
export type AssistantSessionSecrets = z.infer<typeof assistantSessionSecretsSchema>
export type AssistantAutomationCursor = z.infer<
  typeof assistantAutomationCursorSchema
>
export type AssistantAutomationState = z.infer<
  typeof assistantAutomationStateSchema
>
export type AssistantSandbox = (typeof assistantSandboxValues)[number]
export type AssistantApprovalPolicy =
  (typeof assistantApprovalPolicyValues)[number]
export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number]
export type AssistantChatProvider =
  (typeof assistantChatProviderValues)[number]
export type AssistantChannelDeliveryTargetKind =
  (typeof assistantChannelDeliveryTargetKindValues)[number]
export type AssistantBindingDeliveryKind =
  (typeof assistantBindingDeliveryKindValues)[number]
export type AssistantTranscriptEntryKind =
  (typeof assistantTranscriptEntryKindValues)[number]
export type AssistantTurnTrigger =
  (typeof assistantTurnTriggerValues)[number]
export type AssistantTurnActionClass =
  (typeof assistantTurnActionClassValues)[number]
export type AssistantTurnState = (typeof assistantTurnStateValues)[number]
export type AssistantTurnEventKind =
  (typeof assistantTurnEventKindValues)[number]
export type AssistantOutboxIntentStatus =
  (typeof assistantOutboxIntentStatusValues)[number]
export type AssistantMemoryRecordKind =
  (typeof assistantMemoryRecordKindValues)[number]
export type AssistantMemoryQueryScope =
  (typeof assistantMemoryQueryScopeValues)[number]
export type AssistantMemoryWriteScope =
  (typeof assistantMemoryWriteScopeValues)[number]
export type AssistantMemoryLongTermSection =
  (typeof assistantMemoryLongTermSectionValues)[number]
export type AssistantMemoryVisibleSection =
  (typeof assistantMemoryVisibleSectionValues)[number]
export type AssistantCronScheduleKind =
  (typeof assistantCronScheduleKindValues)[number]
export type AssistantCronTrigger = (typeof assistantCronTriggerValues)[number]
export type AssistantCronRunStatus =
  (typeof assistantCronRunStatusValues)[number]
export type AssistantTurnReceiptStatus =
  (typeof assistantTurnReceiptStatusValues)[number]
export type AssistantTurnTimelineEventKind =
  (typeof assistantTurnTimelineEventKindValues)[number]
export type AssistantOutboxStatus =
  (typeof assistantOutboxStatusValues)[number]
export type AssistantDiagnosticLevel =
  (typeof assistantDiagnosticLevelValues)[number]
export type AssistantDiagnosticComponent =
  (typeof assistantDiagnosticComponentValues)[number]
export type AssistantStatusRunLockState =
  (typeof assistantStatusRunLockStateValues)[number]
export type AssistantDoctorCheckStatus =
  (typeof assistantDoctorCheckStatusValues)[number]
export type AssistantProviderSessionOptions = z.infer<
  typeof assistantProviderSessionOptionsSchema
>
type AssistantSessionProviderStateRecord = z.infer<
  typeof assistantSessionProviderStateSchema
>
export type AssistantSessionProviderState = AssistantSessionProviderStateRecord
