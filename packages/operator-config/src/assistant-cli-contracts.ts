import { isIP } from 'node:net'
import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantReasoningEffortValues as contractAssistantReasoningEffortValues,
  automationRouteSchema,
  automationScheduleAtSchema,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
  automationScheduleEverySchema,
  automationTimeScheduleKindValues,
  automationTimeScheduleSchema,
  type AutomationRoute,
  type AutomationTimeScheduleKind,
} from '@murphai/contracts'
import {
  isAssistantGeneratedDeliveryRef,
  isNormalizedAssistantVaultFileRef,
} from '@murphai/runtime-state/assistant-generated-deliveries'
import { normalizeAssistantOpaqueId } from '@murphai/runtime-state/assistant-ids'
import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
  type GatewayDeliveryTargetKind,
  type GatewayReplyRouteKind,
} from '@murphai/gateway-core'
import {
  isoTimestampSchema,
  pathSchema,
} from './vault-cli-contracts.js'
import {
  assistantCodexModelProviderWireApiValues,
  assistantExecutionDriverValues,
  assistantResumeKindValues,
  buildCodexAssistantContinuityFingerprint,
  normalizeAssistantCodexModelProvider,
} from './assistant/target-runtime.js'
import {
  codexResumeStateSchema,
  normalizeCodexResumeState,
  type CodexResumeState,
} from './assistant/codex-resume-state.js'
import {
  looksLikePrivateAssistantRoutePlaceholder,
} from './assistant/current-delivery-route.js'
import {
  assistantResponseCardSchema,
} from './assistant-response-cards.js'

export const assistantSandboxValues = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const

export const assistantApprovalPolicyValues = ['never'] as const
export const assistantReasoningEffortValues = contractAssistantReasoningEffortValues

export const assistantChatProviderValues = ['codex-cli'] as const
export const assistantChannelNameValues = ['telegram', 'linq', 'email'] as const
export const assistantChannelNameSchema = z.enum(assistantChannelNameValues)
export const assistantChannelDeliveryTargetKindValues = gatewayDeliveryTargetKindValues
export const assistantBindingDeliveryKindValues = gatewayReplyRouteKindValues
export const assistantMessageReactionValues = [
  'heart',
  'thumbs_up',
  'laugh',
] as const
export const assistantTranscriptEntryKindValues = [
  'user',
  'assistant',
  'error',
  'status',
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
export const assistantCronScheduleKindValues = automationTimeScheduleKindValues
export const assistantCronTriggerValues = ['manual', 'scheduled'] as const
export const assistantCronRunOutcomeValues = [
  'delivered',
  'delivery_pending',
  'no_op',
  'expired',
  'skipped_gate',
  'failed',
] as const
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
export const assistantTurnDeliveryDispositionValues = [
  'not-requested',
  'queued',
  'sent',
  'retryable',
  'blocked',
  'failed',
] as const
export const assistantTurnTimelineEventKindValues = [
  'turn.started',
  'user.persisted',
  'turn.input.accepted',
  'provider.attempt.started',
  'provider.attempt.succeeded',
  'provider.attempt.failed',
  'delivery.queued',
  'delivery.attempt.started',
  'delivery.sent',
  'delivery.retry-scheduled',
  'delivery.failed',
  'turn.blocked',
  'turn.completed',
  'turn.deferred',
  'turn.failed',
] as const
// Must stay >= the hosted mailbox run import limit so one grouped auto-reply
// cannot silently drop consume authority for answered items.
export const ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT = 100
export const assistantAskResultStatusValues = ['completed'] as const
export const assistantOnboardingStatusValues = ['open', 'completed'] as const
export const assistantOnboardingCompletionReasonValues = [
  'user_answered',
  'user_declined',
  'manual',
] as const
export const assistantOutboxStatusValues = [
  'awaiting_approval',
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
  'turn-receipt',
  'outbox-intent',
  'runtime-budget',
  'cron-store',
  'cron-run',
] as const

export const assistantResponseMediaKindValues = [
  'image',
  'vault_image',
  'voice_memo',
  'vault_file',
] as const
export const assistantVaultImageMaxBytes = 10 * 1024 * 1024
export const assistantVaultFileMaxBytes = 100 * 1024 * 1024
export const assistantVoiceMemoSpeechOutputFormat = 'mp3_44100_128' as const
export const assistantVoiceMemoMusicModelId = 'music_v2' as const
export const assistantVoiceMemoMusicOutputFormat = 'mp3_48000_192' as const

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
  'status.snapshot.refreshed',
  'status.snapshot.quarantined',
  'runtime-budget.recovered',
  'runtime-budget.quarantined',
  'cron.store.quarantined',
  'cron.run.quarantined',
  'runtime.maintenance',
] as const

export const assistantHeadersSchema = z.record(
  z.string().min(1),
  z.string(),
)

export const assistantCodexModelProviderConfigSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]*$/u),
    name: z.string().min(1),
    baseUrl: z.string().url(),
    envKey: z.string().min(1),
    failureHint: z.string().min(1).optional(),
    supportsWebSockets: z.boolean().optional(),
    wireApi: z.enum(assistantCodexModelProviderWireApiValues),
  })
  .strict()

export const assistantCodexModelTargetSchema = z
  .object({
    adapter: z.literal('codex-cli'),
    approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable().default(null),
    codexCommand: z.string().min(1).nullable().default(null),
    codexHome: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().default(null),
    modelProvider: z.string().min(1).nullable().optional(),
    oss: z.boolean().default(false),
    profile: z.string().min(1).nullable().default(null),
    reasoningEffort: z.enum(assistantReasoningEffortValues).nullable().default(null),
    sandbox: z.enum(assistantSandboxValues).nullable().default(null),
  })
  .strict()

export const assistantModelTargetSchema = assistantCodexModelTargetSchema
const legacyAssistantSessionResumeStateSchema = z
  .object({
    assistantContractFingerprint: z.string().min(1).nullable().optional(),
    codexRolloutRelativePath: z.string().min(1).nullable().optional(),
    providerSessionId: z.string().min(1).nullable().default(null),
    resumeRouteId: z.string().min(1).nullable().default(null),
    threadInstructionsFingerprint: z.string().min(1).nullable().optional(),
  })
  .strict()

export const assistantSessionResumeStateSchema = codexResumeStateSchema

function createAssistantOpaqueIdSchema(kind: string) {
  return z.string().trim().refine(
    (value) => normalizeAssistantOpaqueId(value) !== null,
    `Assistant ${kind} ids must be opaque runtime ids without path separators or traversal segments.`,
  )
}

export const assistantSessionIdSchema = createAssistantOpaqueIdSchema('session')
export const assistantTurnIdSchema = createAssistantOpaqueIdSchema('turn')
export const assistantOutboxIntentIdSchema = createAssistantOpaqueIdSchema('outbox intent')
export const assistantCronJobIdSchema = createAssistantOpaqueIdSchema('cron job')
export const assistantCronRunIdSchema = createAssistantOpaqueIdSchema('cron run')

export const assistantProviderSessionOptionsSchema = z.object({
  continuityFingerprint: z.string().min(1),
  provider: z.enum(assistantChatProviderValues),
  model: z.string().min(1).nullable(),
  reasoningEffort: z.string().min(1).nullable().default(null),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  profile: z.string().min(1).nullable(),
  oss: z.boolean(),
  codexHome: z.string().min(1).nullable().optional(),
  modelProvider: z.string().min(1).nullable().optional(),
  executionDriver: z.enum(assistantExecutionDriverValues),
  resumeKind: z.enum(assistantResumeKindValues).nullable(),
  headers: assistantHeadersSchema.nullable().optional(),
})

export const assistantSessionSecretsSchema = z
  .object({
    schema: z.literal('murph.assistant-session-secrets.v1'),
    sessionId: assistantSessionIdSchema,
    updatedAt: isoTimestampSchema,
    providerHeaders: assistantHeadersSchema.nullable().default(null),
  })
  .strict()

export const assistantAliasStoreSchema = z
  .object({
    version: z.literal(1),
    aliases: z.record(z.string(), assistantSessionIdSchema),
    conversationKeys: z.record(z.string(), assistantSessionIdSchema),
    recentSessions: z.record(assistantSessionIdSchema, isoTimestampSchema).optional(),
  })
  .strict()

export const assistantBindingDeliverySchema = z.object({
  kind: z.enum(assistantBindingDeliveryKindValues),
  target: z.string().min(1),
})

export const assistantDeliverySourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('linq'),
      fromPhoneNumber: z.string().min(1),
    })
    .strict(),
])

export const assistantExternalThreadRouteAuthoritySchema = z
  .object({
    accountLookupKey: z.string().min(1).nullable().optional(),
    channel: z.enum(['email', 'linq', 'telegram']),
    containerMemberId: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict()

export const assistantOutboxAutomationAuthoritySchema = z
  .object({
    automationId: z.string().trim().min(1),
    supportSeriesId: z.string().trim().min(1).optional(),
    // Legacy parse-only fields retained for one 14-day terminal-outbox
    // retention window after all writers stopped emitting them. They are inert:
    // current delivery uses expectedUpdatedAt, while historical replies use
    // supportSeriesId plus the delivered occurrence.
    automationRelativePath: z.string().trim().min(1).optional(),
    expectedSemanticRevision: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
    expectedUpdatedAt: isoTimestampSchema,
  })
  .strict()

export const assistantSessionBindingSchema = z.object({
  conversationKey: z.string().min(1).nullable(),
  channel: z.string().min(1).nullable(),
  identityId: z.string().min(1).nullable(),
  actorId: z.string().min(1).nullable(),
  threadId: z.string().min(1).nullable(),
  threadIsDirect: z.boolean().nullable(),
  delivery: assistantBindingDeliverySchema.nullable(),
})

const assistantImageResponseMediaSchema = z
  .object({
    kind: z.literal('image').default('image'),
    url: z
      .string()
      .url()
      .transform((value, context) => {
        try {
          return normalizeAssistantResponseMediaUrl(value)
        } catch {
          context.addIssue({
            code: 'custom',
            message:
              'Assistant response media URLs must be valid public HTTPS image URLs.',
            params: { murphExpectedShape: 'public_https_image_url' },
          })
          return z.NEVER
        }
      }),
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    source: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()

const assistantVaultImageResponseMediaSchema = z
  .object({
    kind: z.literal('vault_image'),
    ref: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine(
        (value) => isNormalizedAssistantVaultFileRef(value),
        'Assistant vault image refs must be normalized vault-relative paths.',
      ),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => !/[\\/\u0000-\u001F\u007F]/u.test(value),
        'Assistant vault image names must not contain path separators or control characters.',
      ),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().positive().max(assistantVaultImageMaxBytes),
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    source: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()

export const assistantAuthoredResponseMediaSchema = z.preprocess(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, 'kind')
      ? { ...value, kind: 'image' }
      : value,
  z.discriminatedUnion('kind', [
    assistantImageResponseMediaSchema,
    assistantVaultImageResponseMediaSchema,
  ]),
)

export const assistantVoiceMemoGenerationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('elevenlabs_speech'),
      modelId: z.string().trim().min(1).max(200),
      outputFormat: z.literal(assistantVoiceMemoSpeechOutputFormat),
      text: z.string().trim().min(1).max(4000),
      voiceId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      durationMs: z.number().int().min(3_000).max(300_000),
      forceInstrumental: z.boolean(),
      kind: z.literal('elevenlabs_music'),
      modelId: z.literal(assistantVoiceMemoMusicModelId),
      outputFormat: z.literal(assistantVoiceMemoMusicOutputFormat),
      prompt: z.string().trim().min(1).max(4100),
    })
    .strict(),
])

export const assistantVoiceMemoTransportSchema = z.discriminatedUnion('kind', [
  z
    .object({
      attachmentId: z.string().trim().min(1).max(200),
      kind: z.literal('linq_attachment'),
    })
    .strict(),
  z
    .object({
      generation: assistantVoiceMemoGenerationSchema,
      kind: z.literal('telegram_generation'),
    })
    .strict(),
])

const assistantVoiceMemoResponseMediaSchema = z
  .object({
    kind: z.literal('voice_memo'),
    filename: z.string().trim().min(1).max(255),
    transcript: z.string().trim().min(1).max(4000).nullable().default(null),
    transport: assistantVoiceMemoTransportSchema,
  })
  .strict()

const assistantExportPackRetirementReceiptSchema = z
  .object({
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    packId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict()

const assistantVaultFileResponseMediaSchema = z
  .object({
    approvalGeneration: z.string().regex(/^[0-9a-f]{64}$/u).nullable().default(null),
    approvalId: z.string().regex(/^haa_[A-Za-z0-9_-]{32}$/u).nullable().default(null),
    kind: z.literal('vault_file'),
    ref: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine(
        (value) => isNormalizedAssistantVaultFileRef(value),
        'Assistant vault file refs must be normalized vault-relative paths.',
      ),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => !/[\\/\u0000-\u001F\u007F]/u.test(value),
        'Assistant vault file names must not contain path separators or control characters.',
      ),
    contentType: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u),
    retireExportPacks: z
      .array(assistantExportPackRetirementReceiptSchema)
      .min(1)
      .max(20)
      .optional(),
    sizeBytes: z.number().int().positive().max(assistantVaultFileMaxBytes),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.approvalGeneration === null) !== (value.approvalId === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant vault file approval id and generation must be present together.',
      })
    }
    if (value.retireExportPacks) {
      if (
        value.contentType !== 'application/zip'
        || !isAssistantGeneratedDeliveryRef(value.ref)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Export-pack retirement requires an assistant-generated ZIP.',
          path: ['retireExportPacks'],
        })
      }
      const packIds = value.retireExportPacks.map((receipt) => receipt.packId)
      if (new Set(packIds).size !== packIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'Export-pack retirement receipts must have unique pack ids.',
          path: ['retireExportPacks'],
        })
      }
    }
  })

export const assistantResponseMediaSchema = z.union([
  assistantImageResponseMediaSchema,
  assistantVaultImageResponseMediaSchema,
  assistantVoiceMemoResponseMediaSchema,
  assistantVaultFileResponseMediaSchema,
])

export const assistantMessageReactionSchema = z.enum(assistantMessageReactionValues)

export const assistantOutboxMessageReactionOperationSchema = z
  .object({
    kind: z.literal('message-reaction'),
    reaction: assistantMessageReactionSchema,
  })
  .strict()

export const assistantOutboxOperationSchema =
  assistantOutboxMessageReactionOperationSchema

export function normalizeAssistantResponseMediaUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Assistant response media URLs must be valid URLs.')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Assistant response media URLs must use HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Assistant response media URLs must be public image URLs without credentials, query strings, or fragments.')
  }
  if (!isPublicAssistantResponseMediaHost(parsed.hostname)) {
    throw new Error('Assistant response media URLs must use public hosts.')
  }
  if (!hasAssistantResponseMediaImageExtension(parsed.pathname) && !isCloudflareImagesDeliveryUrl(parsed)) {
    throw new Error('Assistant response media URLs must point to image files.')
  }

  return parsed.toString()
}

function hasAssistantResponseMediaImageExtension(pathname: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|webp)$/iu.test(pathname)
}

function isCloudflareImagesDeliveryUrl(url: URL): boolean {
  return url.hostname.toLowerCase().replace(/\.$/u, '') === 'imagedelivery.net'
    && url.pathname.split('/').filter(Boolean).length >= 3
}

function isPublicAssistantResponseMediaHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return false
  }

  const ipLiteral = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  if (isIP(ipLiteral) !== 0) {
    return false
  }

  return true
}

const assistantPersistedSessionV1Schema = z
  .object({
    schema: z.literal('murph.assistant-session.v1'),
    sessionId: assistantSessionIdSchema,
    target: assistantModelTargetSchema,
    resumeState: z
      .union([assistantSessionResumeStateSchema, legacyAssistantSessionResumeStateSchema])
      .nullable()
      .default(null),
    alias: z.string().min(1).nullable(),
    binding: assistantSessionBindingSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastTurnAt: isoTimestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
  })
  .strict()

export const assistantPersistedSessionSchema = z
  .object({
    schema: z.literal('murph.assistant-conversation.v2'),
    conversationId: assistantSessionIdSchema,
    alias: z.string().min(1).nullable(),
    binding: assistantSessionBindingSchema,
    codexTarget: assistantModelTargetSchema,
    codexResume: assistantSessionResumeStateSchema.nullable().default(null),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastTurnAt: isoTimestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
  })
  .strict()

const assistantPersistedSessionInputSchema = assistantPersistedSessionSchema
  .extend({
    codexResume: z.unknown().nullable().default(null),
  })
  .strict()

const assistantPersistedSessionRecordSchema = z.union([
  assistantPersistedSessionInputSchema,
  assistantPersistedSessionV1Schema,
])

export const assistantSessionSchema = assistantPersistedSessionRecordSchema.transform((value) =>
  normalizeAssistantSessionRecord(value),
)

export function parseAssistantSessionRecord(value: unknown): AssistantSession {
  return assistantSessionSchema.parse(value)
}

const assistantSessionOutputSchema = assistantPersistedSessionSchema
  .extend({
    sessionId: assistantSessionIdSchema,
    target: assistantModelTargetSchema,
    resumeState: assistantSessionResumeStateSchema.nullable().default(null),
    provider: z.enum(assistantChatProviderValues),
    providerOptions: assistantProviderSessionOptionsSchema,
  })
  .strict()

export const assistantSessionSummarySchema = z
  .object({
    schema: z.literal('murph.assistant-conversation.v2'),
    conversationId: assistantSessionIdSchema,
    sessionId: assistantSessionIdSchema,
    alias: z.string().min(1).nullable(),
    binding: assistantSessionBindingSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastTurnAt: isoTimestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
    provider: z.enum(assistantChatProviderValues),
    model: z.string().min(1).nullable(),
    modelProvider: z.string().min(1).nullable(),
    reasoningEffort: z.string().min(1).nullable(),
    sandbox: z.enum(assistantSandboxValues).nullable(),
    approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
    profile: z.string().min(1).nullable(),
    oss: z.boolean(),
    executionDriver: z.enum(assistantExecutionDriverValues),
    resumeKind: z.enum(assistantResumeKindValues).nullable(),
    resumeThreadId: z.string().min(1).nullable(),
  })
  .strict()

function normalizeAssistantSessionRecord(
  value: z.infer<typeof assistantPersistedSessionRecordSchema>,
): AssistantSession {
  const normalized = normalizeAssistantPersistedConversation(value)
  return buildAssistantRuntimeSession(normalized)
}

function buildAssistantRuntimeSession(
  value: AssistantPersistedSessionRecord,
): AssistantSession {
  const provider = value.codexTarget.adapter
  const modelProvider = normalizeAssistantCodexModelProvider(
    value.codexTarget.modelProvider,
  )
  const providerOptions = assistantProviderSessionOptionsSchema.parse({
    continuityFingerprint: buildCodexAssistantContinuityFingerprint({
      approvalPolicy: value.codexTarget.approvalPolicy,
      codexHome: value.codexTarget.codexHome,
      model: value.codexTarget.model,
      modelProvider,
      oss: value.codexTarget.oss,
      profile: value.codexTarget.profile,
      sandbox: value.codexTarget.sandbox,
    }),
    executionDriver: 'codex-app-server',
    provider,
    model: value.codexTarget.model,
    reasoningEffort: value.codexTarget.reasoningEffort,
    resumeKind: 'codex-thread',
    sandbox: value.codexTarget.sandbox,
    approvalPolicy: value.codexTarget.approvalPolicy,
    profile: value.codexTarget.profile,
    oss: value.codexTarget.oss,
    ...(value.codexTarget.codexHome
      ? { codexHome: value.codexTarget.codexHome }
      : {}),
    ...(modelProvider ? { modelProvider } : {}),
  })
  return {
    ...value,
    sessionId: value.conversationId,
    target: value.codexTarget,
    resumeState: value.codexResume,
    provider,
    providerOptions,
  }
}

function normalizeAssistantPersistedConversation(
  value: z.infer<typeof assistantPersistedSessionRecordSchema>,
): AssistantPersistedSessionRecord {
  if (value.schema === 'murph.assistant-conversation.v2') {
    return assistantPersistedSessionSchema.parse({
      ...value,
      codexResume: normalizeCodexResumeState(value.codexResume),
    })
  }

  return assistantPersistedSessionSchema.parse({
    schema: 'murph.assistant-conversation.v2',
    conversationId: value.sessionId,
    alias: value.alias,
    binding: value.binding,
    codexTarget: value.target,
    codexResume: normalizeAssistantSessionResumeState(value.resumeState),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastTurnAt: value.lastTurnAt,
    turnCount: value.turnCount,
  })
}

function normalizeAssistantSessionResumeState(
  value: unknown,
): AssistantSessionResumeState | null {
  return normalizeCodexResumeState(value)
}

export const assistantTranscriptEntrySchema = z.object({
  schema: z.literal('murph.assistant-transcript-entry.v1'),
  kind: z.enum(assistantTranscriptEntryKindValues),
  text: z.string(),
  createdAt: isoTimestampSchema,
  // Stable provenance for replay-safe imports that originate from a durable
  // outbox delivery rather than a provider turn.
  sourceOutboxIntentId: assistantOutboxIntentIdSchema.optional(),
  // The message receipt that owns the content-retention deadline. This may
  // precede createdAt when accepted work waits before entering a transcript.
  // New user entries always stamp it; legacy and non-message entries may omit
  // it so existing persisted transcripts remain parseable.
  contentReceivedAt: isoTimestampSchema.optional(),
  // Stamped when message-content retention has cleared this entry's text. The
  // transcript is the only durable copy of an inbound message that never
  // produced an inbox capture, so it carries the same 14-day deadline as the
  // capture ledger. Optional and additive: entries written before retention
  // existed stay valid, and its absence means the text is genuinely empty
  // rather than expired.
  textRetiredAt: isoTimestampSchema.optional(),
})

const assistantChannelCleanupMessageSchema = z
  .object({
    messageId: z.string().min(1),
    target: z.string().min(1),
  })
  .strict()

export const assistantProviderMessageEffectSchema = z
  .object({
    carriesIntentMedia: z.literal(true).optional(),
    providerMessageId: z.string().min(1),
    message: z.string().min(1).nullable(),
  })
  .strict()

const assistantMessageChannelDeliverySchema = z.object({
  kind: z.literal('message').optional(),
  channel: z.string().min(1),
  idempotencyKey: z.string().min(1).nullable().default(null),
  target: z.string().min(1),
  targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
  sentAt: isoTimestampSchema,
  messageLength: z.number().int().nonnegative(),
  providerMessageId: z.string().min(1).nullable().default(null),
  providerMessageIds: z.array(z.string().min(1)).min(1).optional(),
  providerMessageEffects: z
    .array(assistantProviderMessageEffectSchema)
    .min(1)
    .optional(),
  cleanupMessages: z.array(assistantChannelCleanupMessageSchema).min(1).optional(),
  cleanupTargetAliases: z.array(z.string().min(1)).min(1).optional(),
  providerThreadId: z.string().min(1).nullable().default(null),
})

const assistantMessageReactionChannelDeliverySchema = z
  .object({
    kind: z.literal('message-reaction'),
    channel: z.enum(['linq', 'telegram']),
    idempotencyKey: z.string().min(1).nullable().default(null),
    reaction: assistantMessageReactionSchema,
    sentAt: isoTimestampSchema,
    target: z.string().min(1),
    targetKind: z.enum(assistantChannelDeliveryTargetKindValues),
    targetMessageId: z.string().min(1),
  })
  .strict()

export const assistantChannelDeliverySchema = z.union([
  assistantMessageChannelDeliverySchema,
  assistantMessageReactionChannelDeliverySchema,
])

const assistantDeliveryErrorDiagnosticValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.null(),
])

export const assistantDeliveryErrorSchema = z
  .object({
    code: z.string().min(1).nullable(),
    diagnosticContext: z
      .record(z.string().min(1), assistantDeliveryErrorDiagnosticValueSchema)
      .optional(),
    message: z.string().min(1),
  })
  .strict()

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
    turnId: assistantTurnIdSchema,
    sessionId: assistantSessionIdSchema,
    provider: z.enum(assistantChatProviderValues),
    providerModel: z.string().min(1).nullable(),
    promptPreview: z.string().nullable(),
    responsePreview: z.string().nullable(),
    status: z.enum(assistantTurnReceiptStatusValues),
    deliveryRequested: z.boolean(),
    deliveryDisposition: z.enum(assistantTurnDeliveryDispositionValues),
    deliveryIntentId: assistantOutboxIntentIdSchema.nullable(),
    startedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
    lastError: assistantDeliveryErrorSchema.nullable(),
    timeline: z.array(assistantTurnTimelineEventSchema),
  })
  .strict()

export const assistantTurnReceiptSummaryTimelineEventSchema = z
  .object({
    at: isoTimestampSchema,
    kind: z.enum(assistantTurnTimelineEventKindValues),
    detail: z.string().nullable(),
  })
  .strict()

export const assistantTurnReceiptSummarySchema = z
  .object({
    schema: z.literal('murph.assistant-turn-receipt-summary.v1'),
    turnId: assistantTurnIdSchema,
    sessionId: assistantSessionIdSchema,
    provider: z.enum(assistantChatProviderValues),
    providerModel: z.string().min(1).nullable(),
    promptPreview: z.string().nullable(),
    responsePreview: z.string().nullable(),
    status: z.enum(assistantTurnReceiptStatusValues),
    deliveryRequested: z.boolean(),
    deliveryDisposition: z.enum(assistantTurnDeliveryDispositionValues),
    deliveryIntentId: assistantOutboxIntentIdSchema.nullable(),
    startedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
    lastError: assistantDeliveryErrorSchema.nullable(),
    timelineEventCount: z.number().int().nonnegative(),
    latestTimelineEvent: assistantTurnReceiptSummaryTimelineEventSchema.nullable(),
  })
  .strict()

export const assistantOutboxIntentStatusValues = assistantOutboxStatusValues
const assistantPrivateCompletionContinuitySchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        baseTurnCount: z.number().int().nonnegative(),
        preparedAt: isoTimestampSchema,
        sessionId: assistantSessionIdSchema,
        status: z.literal('prepared'),
        transcriptCreatedAt: isoTimestampSchema,
      })
      .strict(),
    z
      .object({
        appliedAt: isoTimestampSchema,
        baseTurnCount: z.number().int().nonnegative(),
        preparedAt: isoTimestampSchema,
        sessionId: assistantSessionIdSchema,
        status: z.literal('applied'),
        transcriptCreatedAt: isoTimestampSchema,
      })
      .strict(),
  ],
)
export const assistantOutboxIntentSchema = z
  .object({
    schema: z.literal('murph.assistant-outbox-intent.v1'),
    intentId: assistantOutboxIntentIdSchema,
    sessionId: assistantSessionIdSchema,
    turnId: assistantTurnIdSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastAttemptAt: isoTimestampSchema.nullable(),
    nextAttemptAt: isoTimestampSchema.nullable(),
    sentAt: isoTimestampSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    status: z.enum(assistantOutboxIntentStatusValues),
    message: z.string(),
    reviewedAssistantAskCompletionExpiresAt: isoTimestampSchema.optional(),
    privateCompletionContinuitySessionId:
      assistantSessionIdSchema.nullable().optional(),
    privateCompletionContinuity:
      assistantPrivateCompletionContinuitySchema.nullable().optional(),
    emailHtml: z.string().max(500_000).nullable().optional(),
    media: z.array(assistantResponseMediaSchema).max(40).default([]),
    card: assistantResponseCardSchema.nullable().default(null),
    subject: z.string().trim().min(1).nullable().default(null),
    operation: assistantOutboxOperationSchema.nullable().default(null),
    dedupeKey: z.string().min(1),
    targetFingerprint: z.string().min(1),
    channel: z.string().min(1).nullable(),
    identityId: z.string().min(1).nullable(),
    actorId: z.string().min(1).nullable(),
    threadId: z.string().min(1).nullable(),
    threadIsDirect: z.boolean().nullable(),
    replyToMessageId: z.string().min(1).nullable().default(null),
    nativeReplyRequested: z.literal(true).optional(),
    bindingDelivery: assistantBindingDeliverySchema.nullable(),
    deliverySource: assistantDeliverySourceSchema.nullable().default(null),
    automationAuthority: assistantOutboxAutomationAuthoritySchema
      .nullable()
      .optional(),
    scheduledOccurrenceAt: isoTimestampSchema.nullable().optional(),
    // Exact event time derived from the durable automation lead at fire time.
    plannedOccurrenceAt: isoTimestampSchema.nullable().optional(),
    externalThreadRouteAuthority: assistantExternalThreadRouteAuthoritySchema
      .nullable()
      .optional(),
    externalThreadService: z.string().trim().min(1).nullable().optional(),
    explicitTarget: z.string().min(1).nullable(),
    delivery: assistantChannelDeliverySchema.nullable(),
    deliveryConfirmationPending: z.boolean().default(false),
    deliveryIdempotencyKey: z.string().min(1).nullable().default(null),
    deliveryTransportIdempotent: z.boolean().default(false),
    groupEmailAuthorizationProof: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable()
      .optional(),
    // Read-only migration support for durable intents accepted before the
    // generic group-email field shipped. New writes use the field above.
    newsletterAuthorizationProof: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable()
      .optional(),
    answeredMailboxItemIds: z.array(z.string().trim().min(1))
      .max(ASSISTANT_ANSWERED_MAILBOX_ITEM_ID_LIMIT)
      .default([]),
    preparedDispatchToken: z.string().min(1).nullable().default(null),
    lastError: assistantDeliveryErrorSchema.nullable(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.card !== null && intent.media.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant response cards cannot be combined with response media.',
        path: ['card'],
      })
    }

    if (intent.card !== null && intent.operation !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant response cards require a normal message intent.',
        path: ['card'],
      })
    }

    if (
      intent.card?.kind === 'challenge_standings' &&
      !(
        intent.threadIsDirect === false &&
        intent.channel?.trim().toLowerCase() === 'linq'
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Challenge standings response cards require an authenticated Linq group conversation.',
        path: ['card'],
      })
    }
    if (
      intent.card !== null &&
      intent.card.kind !== 'challenge_standings' &&
      intent.threadIsDirect !== true
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant response cards require a private direct conversation.',
        path: ['card'],
      })
    }

    if (intent.nativeReplyRequested !== true) {
      return
    }

    if (intent.operation !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant native replies must use a normal message intent.',
        path: ['nativeReplyRequested'],
      })
    }

    const replyToMessageId = intent.replyToMessageId?.trim() ?? ''
    if (!replyToMessageId) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant native replies require a target message id.',
        path: ['replyToMessageId'],
      })
    }

    if (looksLikePrivateAssistantRoutePlaceholder(replyToMessageId)) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant native replies require a provider message id.',
        path: ['replyToMessageId'],
      })
    }

    const channel = intent.channel?.trim().toLowerCase() ?? ''
    if (channel !== 'linq' && channel !== 'telegram') {
      context.addIssue({
        code: 'custom',
        message: 'Assistant native replies require a supported message channel.',
        path: ['channel'],
      })
    } else if (channel === 'telegram' && !/^\d+$/u.test(replyToMessageId)) {
      context.addIssue({
        code: 'custom',
        message: 'Assistant Telegram native replies require a numeric target message id.',
        path: ['replyToMessageId'],
      })
    }
  })

export const assistantDiagnosticEventSchema = z
  .object({
    schema: z.literal('murph.assistant-diagnostic-event.v1'),
    at: isoTimestampSchema,
    level: z.enum(assistantDiagnosticLevelValues),
    component: z.enum(assistantDiagnosticComponentValues),
    kind: z.string().min(1),
    message: z.string().min(1),
    code: z.string().min(1).nullable(),
    sessionId: assistantSessionIdSchema.nullable(),
    turnId: assistantTurnIdSchema.nullable(),
    intentId: assistantOutboxIntentIdSchema.nullable(),
    dataJson: z.string().nullable(),
  })
  .strict()

export const assistantDiagnosticsCountersSchema = z
  .object({
    // Deprecated in v1: retained to parse existing snapshots. New turns do not
    // increment this field because foreground reply priority wins.
    turnsStarted: z.number().int().nonnegative(),
    turnsCompleted: z.number().int().nonnegative(),
    turnsDeferred: z.number().int().nonnegative(),
    turnsFailed: z.number().int().nonnegative(),
    // Deprecated in v1: retained to parse existing snapshots. Durable turn
    // receipts own provider-attempt evidence for new turns.
    providerAttempts: z.number().int().nonnegative(),
    providerFailures: z.number().int().nonnegative(),
    deliveriesQueued: z.number().int().nonnegative(),
    deliveriesSent: z.number().int().nonnegative(),
    deliveriesFailed: z.number().int().nonnegative(),
    deliveriesRetryable: z.number().int().nonnegative(),
    outboxDrains: z.number().int().nonnegative(),
    outboxRetries: z.number().int().nonnegative(),
    // Deprecated in v1: retained to parse existing snapshots. New automation
    // scans do not increment this field because foreground reply priority wins.
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
    code: z.string().min(1).nullable().default(null),
    component: z.string().min(1),
    entityId: z.string().min(1).nullable(),
    entityType: z.string().min(1).nullable(),
    message: z.string().min(1),
    dataJson: z.string().nullable(),
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
    autoReply: z.array(
      z
        .object({
          channel: z.string().min(1),
          enabledAt: isoTimestampSchema,
          eligibleAfter: z.lazy(() => assistantInputCursorSchema).nullable(),
        })
        .strict(),
    ),
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
    turnsRoot: pathSchema,
    generatedAt: isoTimestampSchema,
    runLock: assistantStatusRunLockSchema,
    automation: assistantStatusAutomationSchema,
    outbox: assistantStatusOutboxSummarySchema,
    diagnostics: assistantDiagnosticsSnapshotSchema,
    quarantine: assistantQuarantineSummarySchema,
    runtimeBudget: assistantRuntimeBudgetSnapshotSchema,
    recentTurns: z.array(assistantTurnReceiptSummarySchema),
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

export const assistantOnboardingStateSchema = z
  .object({
    schemaVersion: z.literal('murph.assistant-onboarding.v1'),
    status: z.enum(assistantOnboardingStatusValues),
    createdAt: isoTimestampSchema.nullable(),
    updatedAt: isoTimestampSchema.nullable(),
    completedAt: isoTimestampSchema.nullable(),
    completedReason: z
      .enum(assistantOnboardingCompletionReasonValues)
      .nullable(),
  })
  .strict()

export const assistantOnboardingResultSchema = z
  .object({
    vault: pathSchema,
    stateRoot: pathSchema,
    statePath: pathSchema,
    onboarding: assistantOnboardingStateSchema,
  })
  .strict()

const assistantOnboardingResumeContextSurfaceOkSchema = z
  .object({
    status: z.literal('ok'),
    count: z.number().int().nonnegative(),
    truncated: z.boolean(),
    items: z.array(z.unknown()),
  })
  .strict()

const assistantOnboardingResumeContextSurfaceErrorSchema = z
  .object({
    status: z.literal('error'),
    message: z.string().min(1),
  })
  .strict()

export const assistantOnboardingResumeContextSurfaceSchema =
  z.discriminatedUnion('status', [
    assistantOnboardingResumeContextSurfaceOkSchema,
    assistantOnboardingResumeContextSurfaceErrorSchema,
  ])

export const assistantOnboardingResumeContextMemorySchema =
  z.discriminatedUnion('status', [
    assistantOnboardingResumeContextSurfaceOkSchema
      .omit({ count: true, items: true, truncated: true })
      .extend({
        exists: z.boolean(),
        recordCount: z.number().int().nonnegative(),
        records: z.array(z.unknown()),
        truncated: z.boolean(),
        updatedAt: isoTimestampSchema.nullable(),
      })
      .strict(),
    assistantOnboardingResumeContextSurfaceErrorSchema,
  ])

export const assistantOnboardingResumeContextResultSchema = z
  .object({
    vault: pathSchema,
    limit: z.number().int().positive(),
    onboarding: assistantOnboardingStateSchema,
    memory: assistantOnboardingResumeContextMemorySchema,
    goals: assistantOnboardingResumeContextSurfaceSchema,
    regimens: assistantOnboardingResumeContextSurfaceSchema,
    supplements: assistantOnboardingResumeContextSurfaceSchema,
    conditions: assistantOnboardingResumeContextSurfaceSchema,
    allergies: assistantOnboardingResumeContextSurfaceSchema,
    experiments: assistantOnboardingResumeContextSurfaceSchema,
    deviceAccounts: assistantOnboardingResumeContextSurfaceSchema,
  })
  .strict()

export const assistantCronAtScheduleSchema = automationScheduleAtSchema

export const assistantCronEveryScheduleSchema = automationScheduleEverySchema

export const assistantCronExpressionScheduleSchema = automationScheduleCronSchema

export const assistantCronExpressionScheduleInputSchema = assistantCronExpressionScheduleSchema

export const assistantCronDailyLocalScheduleSchema = automationScheduleDailyLocalSchema

export const assistantCronScheduleSchema = automationTimeScheduleSchema

export const assistantCronScheduleInputSchema = automationTimeScheduleSchema

const assistantCronRouteSchema = automationRouteSchema
  .omit({ channel: true, deliverySource: true, threadId: true })
  .extend({
    channel: z.string().min(1).nullable(),
    deliverySource: assistantDeliverySourceSchema.nullable().default(null),
    threadId: z.string().min(1).nullable(),
  })
  .strict()

export const assistantCronTargetSchema = assistantCronRouteSchema
  .extend({
    sessionId: assistantSessionIdSchema.nullable(),
    alias: z.string().min(1).nullable(),
  })
  .strict()

export const assistantSelfDeliveryTargetSchema = automationRouteSchema
  .omit({ deliverySource: true })
  .extend({
    deliverySource: assistantDeliverySourceSchema.nullable().default(null),
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
    pendingDeliveryIntentId: assistantOutboxIntentIdSchema.nullable().optional(),
    runningAt: isoTimestampSchema.nullable(),
    runningPid: z.number().int().positive().nullable(),
  })
  .strict()

export const assistantCronScheduledLogSchema = z
  .object({
    scheduledLogId: z.string().min(1),
    actionKind: z.string().min(1),
  })
  .strict()

export const assistantCronJobSchema = z
  .object({
    schema: z.literal('murph.assistant-cron-job.v1'),
    jobId: assistantCronJobIdSchema,
    name: z.string().min(1),
    enabled: z.boolean(),
    keepAfterRun: z.boolean(),
    prompt: z.string().min(1),
    schedule: assistantCronScheduleSchema,
    target: assistantCronTargetSchema,
    scheduledLog: assistantCronScheduledLogSchema.optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    state: assistantCronJobStateSchema,
  })
  .strict()

const assistantCronLegacyRunStatusValues: ReadonlySet<string> =
  new Set(assistantCronRunStatusValues)

function normalizeAssistantCronRunRecordInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>
  const outcome = typeof record.outcome === 'string'
    ? record.outcome.trim()
    : ''
  if (outcome.length > 0) {
    return {
      ...record,
      reason: normalizeAssistantCronRunReason(record.reason, outcome),
    }
  }

  const status = typeof record.status === 'string'
    ? record.status.trim()
    : ''
  if (!assistantCronLegacyRunStatusValues.has(status)) {
    return value
  }

  return {
    ...record,
    outcome: legacyAssistantCronStatusToOutcome(status, record.error),
    reason: legacyAssistantCronStatusToReason(status, record.error),
  }
}

function legacyAssistantCronStatusToOutcome(
  status: string,
  error: unknown,
): (typeof assistantCronRunOutcomeValues)[number] {
  switch (status) {
    case 'succeeded':
      return 'delivered'
    case 'failed':
      return 'failed'
    case 'skipped':
      return typeof error === 'string' && error.length > 0
        ? 'skipped_gate'
        : 'no_op'
    default:
      return 'failed'
  }
}

function legacyAssistantCronStatusToReason(
  status: string,
  error: unknown,
): string {
  if (status === 'failed') {
    return 'legacy_failed'
  }
  if (status === 'skipped') {
    return typeof error === 'string' && error.length > 0
      ? 'legacy_skipped'
      : 'legacy_no_op'
  }
  return 'legacy_succeeded'
}

function normalizeAssistantCronRunReason(
  value: unknown,
  fallback: string,
): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback
}

const assistantCronNotificationDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skip'),
    reasonCode: z.literal('provider_skip'),
  }).strict(),
  z.object({
    kind: z.literal('send_message'),
    reasonCode: z.literal('provider_send_message'),
  }).strict(),
])

export const assistantCronRunRecordSchema = z.preprocess(
  normalizeAssistantCronRunRecordInput,
  z.object({
    schema: z.literal('murph.assistant-cron-run.v1'),
    runId: assistantCronRunIdSchema,
    jobId: assistantCronJobIdSchema,
    trigger: z.enum(assistantCronTriggerValues),
    outcome: z.enum(assistantCronRunOutcomeValues),
    reason: z.string().trim().min(1).max(120),
    status: z.enum(assistantCronRunStatusValues).optional(),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema,
    sessionId: assistantSessionIdSchema.nullable(),
    response: z.string().nullable(),
    responseLength: z.number().int().nonnegative(),
    error: z.string().nullable(),
    notificationDecision:
      assistantCronNotificationDecisionSchema.nullable().optional(),
    scheduledOccurrenceAt: isoTimestampSchema.optional(),
  })
  .strict(),
)

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
  responseDisposition: z.literal('none').optional(),
  media: z.array(assistantResponseMediaSchema).default([]),
  session: assistantSessionOutputSchema,
  delivery: assistantChannelDeliverySchema.nullable(),
  deliveryDeferred: z.boolean().default(false),
  deliveryIntentId: assistantOutboxIntentIdSchema.nullable().default(null),
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
  media: z.array(assistantResponseMediaSchema).default([]),
  delivery: assistantChannelDeliverySchema,
})

export const assistantSessionListResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  filters: z.object({
    limit: z.number().int().positive().max(50),
  }),
  sessions: z.array(assistantSessionSummarySchema),
  count: z.number().int().nonnegative(),
})

export const assistantSessionShowResultSchema = z.object({
  vault: pathSchema,
  stateRoot: pathSchema,
  session: assistantSessionOutputSchema,
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
  jobId: assistantCronJobIdSchema,
  runs: z.array(assistantCronRunRecordSchema),
})

export const assistantCronTargetSnapshotSchema = z.object({
  jobId: assistantCronJobIdSchema,
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

export const assistantInputCursorSchema = z
  .object({
    createdAt: isoTimestampSchema.nullable(),
    inputId: z.string().min(1),
    occurredAt: isoTimestampSchema,
    sourceKind: z.enum(['inbox-capture', 'hosted-mailbox']),
    sourcePosition: z.string().min(1).nullable().optional(),
  })
  .strict()

export const assistantAutoReplyChannelStateSchema = z
  .object({
    channel: z.string().min(1),
    enabledAt: isoTimestampSchema,
    eligibleAfter: assistantInputCursorSchema.nullable(),
  })
  .strict()

export const assistantAutomationStateSchema = z
  .object({
    version: z.literal(1),
    autoReply: z.array(assistantAutoReplyChannelStateSchema),
    updatedAt: isoTimestampSchema,
  })
  .strict()

export type AssistantAliasStore = z.infer<typeof assistantAliasStoreSchema>
export type AssistantBindingDelivery = z.infer<
  typeof assistantBindingDeliverySchema
>
export type AssistantDeliverySource = z.infer<
  typeof assistantDeliverySourceSchema
>
export type AssistantExternalThreadRouteAuthority = z.infer<
  typeof assistantExternalThreadRouteAuthoritySchema
>
export type AssistantSessionBinding = z.infer<
  typeof assistantSessionBindingSchema
>
export type AssistantVoiceMemoGeneration = z.infer<
  typeof assistantVoiceMemoGenerationSchema
>
export type AssistantVoiceMemoTransport = z.infer<
  typeof assistantVoiceMemoTransportSchema
>
export type AssistantResponseMedia = z.infer<
  typeof assistantResponseMediaSchema
>
export type AssistantVaultImageResponseMedia = Extract<
  AssistantResponseMedia,
  { kind: 'vault_image' }
>
export type AssistantVaultFileResponseMedia = Extract<
  AssistantResponseMedia,
  { kind: 'vault_file' }
>
export type AssistantResponseMediaKind = typeof assistantResponseMediaKindValues[number]
export type AssistantMessageReaction = z.infer<
  typeof assistantMessageReactionSchema
>
export type AssistantOutboxOperation = z.infer<
  typeof assistantOutboxOperationSchema
>
export type AssistantCodexModelProviderConfig = z.infer<
  typeof assistantCodexModelProviderConfigSchema
>
export type AssistantModelTarget = z.infer<typeof assistantModelTargetSchema>
export type AssistantSessionResumeState = CodexResumeState
type AssistantPersistedSessionRecord = z.infer<typeof assistantPersistedSessionSchema>
export type AssistantSession = AssistantPersistedSessionRecord &
  AssistantRuntimeSessionFields & {
    resumeState: AssistantSessionResumeState | null
  }

type AssistantRuntimeSessionFields = {
  sessionId: string
  target: AssistantModelTarget
  provider: AssistantChatProvider
  providerOptions: z.infer<typeof assistantProviderSessionOptionsSchema>
}
export type AssistantTranscriptEntry = z.infer<
  typeof assistantTranscriptEntrySchema
>
export type AssistantChannelDelivery = z.infer<
  typeof assistantChannelDeliverySchema
>
export type AssistantProviderMessageEffect = z.infer<
  typeof assistantProviderMessageEffectSchema
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
export type AssistantTurnReceiptSummary = z.infer<
  typeof assistantTurnReceiptSummarySchema
>
export type AssistantOutboxIntent = z.infer<typeof assistantOutboxIntentSchema>
export type AssistantOutboxAutomationAuthority = z.infer<
  typeof assistantOutboxAutomationAuthoritySchema
>
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
export type AssistantSessionSummary = z.infer<
  typeof assistantSessionSummarySchema
>
export type AssistantSessionShowResult = z.infer<
  typeof assistantSessionShowResultSchema
>
export type AssistantCronSchedule = z.infer<typeof assistantCronScheduleSchema>
export type AssistantCronScheduleInput = z.infer<typeof assistantCronScheduleInputSchema>
export type AssistantCronTarget = Omit<
  AutomationRoute,
  'channel' | 'deliverySource' | 'threadId'
> & {
  alias: string | null
  channel: string | null
  deliverySource: Exclude<AutomationRoute['deliverySource'], undefined>
  sessionId: string | null
  threadId: string | null
}
export type AssistantCronJobState = z.infer<typeof assistantCronJobStateSchema>
export type AssistantCronScheduledLog = z.infer<typeof assistantCronScheduledLogSchema>
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
export type AssistantSelfDeliveryTarget = z.infer<typeof assistantSelfDeliveryTargetSchema>
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
export type AssistantOnboardingCompletionReason =
  (typeof assistantOnboardingCompletionReasonValues)[number]
export type AssistantOnboardingState = z.infer<
  typeof assistantOnboardingStateSchema
>
export type AssistantOnboardingResult = z.infer<
  typeof assistantOnboardingResultSchema
>
export type AssistantOnboardingResumeContextResult = z.infer<
  typeof assistantOnboardingResumeContextResultSchema
>
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
export type AssistantInputCursor = z.infer<typeof assistantInputCursorSchema>
export type AssistantAutomationState = z.infer<
  typeof assistantAutomationStateSchema
>
export type AssistantSandbox = (typeof assistantSandboxValues)[number]
export type AssistantApprovalPolicy =
  (typeof assistantApprovalPolicyValues)[number]
export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number]
export type AssistantExecutionDriver =
  (typeof assistantExecutionDriverValues)[number]
export type AssistantResumeKind = (typeof assistantResumeKindValues)[number]
export type AssistantChatProvider =
  (typeof assistantChatProviderValues)[number]
export type AssistantChannelDeliveryTargetKind = GatewayDeliveryTargetKind
export type AssistantBindingDeliveryKind = GatewayReplyRouteKind
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
export type AssistantCronScheduleKind = AutomationTimeScheduleKind
export type AssistantCronTrigger = (typeof assistantCronTriggerValues)[number]
export type AssistantCronRunOutcome =
  (typeof assistantCronRunOutcomeValues)[number]
export type AssistantCronRunStatus =
  (typeof assistantCronRunStatusValues)[number]
export type AssistantTurnReceiptStatus =
  (typeof assistantTurnReceiptStatusValues)[number]
export type AssistantTurnDeliveryDisposition =
  (typeof assistantTurnDeliveryDispositionValues)[number]
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
