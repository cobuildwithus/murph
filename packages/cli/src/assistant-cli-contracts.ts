import { z } from 'incur'
import { isoTimestampSchema, pathSchema } from './vault-cli-contracts.js'

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
export const assistantCronScheduleKindValues = [
  'at',
  'every',
  'cron',
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
  'turn.completed',
  'turn.deferred',
] as const
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
    cooldownMs: z.number().int().positive().nullable().default(null),
    maxAttempts: z.number().int().positive().nullable().default(null),
  })
  .strict()

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
})

export const assistantAliasStoreSchema = z
  .object({
    version: z.literal(2),
    aliases: z.record(z.string(), z.string().min(1)),
    conversationKeys: z.record(z.string(), z.string().min(1)),
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

export const assistantSessionSchema = z
  .object({
    schema: z.literal('healthybob.assistant-session.v2'),
    sessionId: z.string().min(1),
    provider: z.enum(assistantChatProviderValues),
    providerSessionId: z.string().min(1).nullable(),
    providerOptions: assistantProviderSessionOptionsSchema,
    alias: z.string().min(1).nullable(),
    binding: assistantSessionBindingSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastTurnAt: isoTimestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
  })
  .strict()

export const assistantTranscriptEntrySchema = z.object({
  schema: z.literal('healthybob.assistant-transcript-entry.v1'),
  kind: z.enum(assistantTranscriptEntryKindValues),
  text: z.string(),
  createdAt: isoTimestampSchema,
})

export const assistantChannelDeliverySchema = z.object({
  channel: z.string().min(1),
  target: z.string().min(1),
  targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
  sentAt: isoTimestampSchema,
  messageLength: z.number().int().nonnegative(),
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
    schema: z.literal('healthybob.assistant-turn-receipt.v1'),
    turnId: z.string().min(1),
    sessionId: z.string().min(1),
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
    schema: z.literal('healthybob.assistant-outbox-intent.v1'),
    intentId: z.string().min(1),
    sessionId: z.string().min(1),
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
    bindingDelivery: assistantBindingDeliverySchema.nullable(),
    explicitTarget: z.string().min(1).nullable(),
    delivery: assistantChannelDeliverySchema.nullable(),
    lastError: assistantDeliveryErrorSchema.nullable(),
  })
  .strict()

export const assistantDiagnosticEventSchema = z
  .object({
    schema: z.literal('healthybob.assistant-diagnostic-event.v1'),
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
    schema: z.literal('healthybob.assistant-diagnostics.v1'),
    updatedAt: isoTimestampSchema,
    lastEventAt: isoTimestampSchema.nullable(),
    lastErrorAt: isoTimestampSchema.nullable(),
    counters: assistantDiagnosticsCountersSchema,
    recentWarnings: z.array(z.string()),
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
    schema: z.literal('healthybob.assistant-failover-state.v1'),
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
  })
  .strict()

export const assistantCronScheduleSchema = z.discriminatedUnion('kind', [
  assistantCronAtScheduleSchema,
  assistantCronEveryScheduleSchema,
  assistantCronExpressionScheduleSchema,
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
    schema: z.literal('healthybob.assistant-cron-job.v1'),
    jobId: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    keepAfterRun: z.boolean(),
    prompt: z.string().min(1),
    schedule: assistantCronScheduleSchema,
    target: assistantCronTargetSchema,
    foodAutoLog: assistantCronFoodAutoLogSchema.optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    state: assistantCronJobStateSchema,
  })
  .strict()

export const assistantCronRunRecordSchema = z
  .object({
    schema: z.literal('healthybob.assistant-cron-run.v1'),
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
    suggestedSchedule: assistantCronScheduleSchema,
    suggestedScheduleLabel: z.string().min(1),
    variables: z.array(assistantCronPresetVariableSchema),
  })
  .strict()

export const assistantAskResultSchema = z.object({
  vault: pathSchema,
  prompt: z.string().min(1),
  response: z.string(),
  session: assistantSessionSchema,
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
  session: assistantSessionSchema,
})

export const assistantDeliverResultSchema = z.object({
  vault: pathSchema,
  message: z.string().min(1),
  session: assistantSessionSchema,
  delivery: assistantChannelDeliverySchema,
})

export const assistantSessionListResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  sessions: z.array(assistantSessionSchema),
})

export const assistantSessionShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  session: assistantSessionSchema,
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

export const assistantMemoryUpsertResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  scope: z.enum(assistantMemoryWriteScopeValues),
  longTermAdded: z.number().int().nonnegative(),
  dailyAdded: z.number().int().nonnegative(),
  memories: z.array(assistantMemoryRecordSchema),
})

export const assistantMemoryForgetResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  removed: assistantMemoryRecordSchema,
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
export type AssistantSession = z.infer<typeof assistantSessionSchema>
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
export type AssistantAskResult = z.infer<typeof assistantAskResultSchema>
export type AssistantChatResult = z.infer<typeof assistantChatResultSchema>
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
export type AssistantMemoryUpsertResult = z.infer<
  typeof assistantMemoryUpsertResultSchema
>
export type AssistantMemoryForgetResult = z.infer<
  typeof assistantMemoryForgetResultSchema
>
export type AssistantCronSchedule = z.infer<typeof assistantCronScheduleSchema>
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
export type AssistantCronPresetListResult = z.infer<
  typeof assistantCronPresetListResultSchema
>
export type AssistantCronPresetShowResult = z.infer<
  typeof assistantCronPresetShowResultSchema
>
export type AssistantCronPresetInstallResult = z.infer<
  typeof assistantCronPresetInstallResultSchema
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
