import { createHash } from 'node:crypto'

import * as z from '@murphai/contracts/zod-runtime'

import {
  automationActiveUntilSchema,
  automationContinuityPolicyValues,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
  automationScheduleDeviceActivitySchema,
  automationScheduleEverySchema,
  automationStatusValues,
  automationSupportKindValues,
  formatTimeZoneDateTimeParts,
  normalizeIanaTimeZone,
  type AutomationSchedule,
} from '@murphai/contracts'
import { resolveAutomationUpsertSlug } from '@murphai/core'
import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
} from '@murphai/hosted-execution/assistant-model'
import type {
  AssistantAcceptedTurnInputReferenceWindow,
} from '../../assistant/active-turn-input-journal.js'
import type {
  AssistantHostedAutomationTool,
  AssistantHostedAutomationToolRequest,
  AssistantHostedAutomationToolResponse,
} from '../../assistant/execution-context.js'
import {
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
} from '../../assistant/onboarding-first-personal-read-automation.js'
import {
  buildSafeToolCallValidationDigest,
  collectSafeJsonSchemaValidationPaths,
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const AUTOMATION_TOOL_RESULT_MAX_BYTES = 24_000
const automationIdentifierSchema = z.string().trim().min(1).max(191)
const automationSupportSeriesIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,199})$/u)
const automationSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
const automationTitleSchema = z.string().trim().min(1).max(160)
const automationInstructionsSchema = z.string().trim().min(1).max(50_000)
const automationSummarySchema = z.string().trim().min(1).max(4_000)
const automationUpdatedAtSchema = z.string().datetime({ offset: true })
const automationTagsSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(32)
  .superRefine((tags, context) => {
    for (const [index, tag] of tags.entries()) {
      if (tag.startsWith('system:')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Reserved system tags cannot be supplied directly.',
          path: [index],
        })
      }
    }
  })

const hostedAutomationAssistantTargetOverrideSchema = z
  .object({
    model: z
      .enum(HOSTED_ASSISTANT_PRODUCT_MODELS)
      .optional()
      .describe(
        'Optional model for this automation turn only. Use Luna for self-contained cues and reminders with no reads or tools, Terra for bounded contextual judgment or a few targeted reads, and inherit the conversation model for broad context, research, complex or sensitive reasoning, or whenever that selected model materially matters.',
      ),
    reasoningEffort: z
      .enum(HOSTED_ASSISTANT_REASONING_EFFORTS)
      .optional()
      .describe(
        'Optional reasoning effort for this automation turn only. When omitted with an explicit model, Murph uses high for Luna and low for Terra or Sol at execution. A reasoning-only override keeps the conversation model.',
      ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.model === undefined && value.reasoningEffort === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Target override must select a model, reasoning effort, or both.',
        path: [],
      })
    }
  })
  .describe(
    'Turn-scoped automation model and reasoning selection. It never changes the conversation default; later replies return to the saved conversation model with this automation message retained in shared history.',
  )

const automationLocalAtDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const automationLocalAtRecoveryKeyPattern = /^[a-f0-9]{64}$/u
const automationLocalAtTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const automationLocalAtFoldValues = ['earlier', 'later'] as const
const automationLocalAtRelativeDayValues = ['today', 'tomorrow'] as const

type AutomationLocalAtFailureCode =
  | 'local_at_fold'
  | 'local_at_gap'
  | 'local_at_invalid_timezone'
  | 'local_at_reference_spans_dates'
  | 'local_at_reference_unavailable'

class AutomationLocalAtResolutionError extends Error {
  readonly code: AutomationLocalAtFailureCode
  readonly resolvedLocalDate?: string

  constructor(
    code: AutomationLocalAtFailureCode,
    message: string,
    resolvedLocalDate?: string,
  ) {
    super(message)
    this.code = code
    this.resolvedLocalDate = resolvedLocalDate
    this.name = 'AutomationLocalAtResolutionError'
  }
}

const automationOneShotLocalAtSchema = z
  .object({
    date: z
      .string()
      .regex(automationLocalAtDatePattern, 'Expected a YYYY-MM-DD calendar date.')
      .optional()
      .describe(
        'Explicit calendar date from the request. Do not calculate this field from relative words.',
      ),
    relativeDay: z
      .enum(automationLocalAtRelativeDayValues)
      .optional()
      .describe(
        'Preserve today, tonight, or tomorrow as a semantic day for trusted resolution in timeZone. Use today for today or tonight.',
      ),
    time: z
      .string()
      .regex(automationLocalAtTimePattern, 'Expected a 24-hour HH:MM wall-clock time.'),
    timeZone: z.string().min(1).max(128),
    fold: z.enum(automationLocalAtFoldValues).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.date === undefined) === (value.relativeDay === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of schedule.localAt.date or schedule.localAt.relativeDay.',
        path: [],
      })
    }
  })

const automationLocalAtScheduleSchema = z
  .object({
    kind: z.literal('at'),
    localAt: automationOneShotLocalAtSchema.describe(
      'User-authored one-shot local wall-clock time with either an explicit calendar date or preserved relative day, plus 24-hour time and IANA timezone.',
    ),
  })
  .strict()

const automationLocalAtRecoveryKeySchema = z
  .string()
  .regex(
    automationLocalAtRecoveryKeyPattern,
    'Expected the exact 64-character localAtRecoveryKey returned by the failed automation call.',
  )
  .describe(
    'Opaque root-turn correlation returned by a daylight-saving gap or fold failure. Echo it only on the explicit-date retry that answers that failure.',
  )

const dismissAutomationLocalAtRecoveryArgumentsSchema = z.object({
  action: z.literal('dismiss_local_at_recovery'),
  localAtRecoveryKey: automationLocalAtRecoveryKeySchema,
  resolvedLocalDate: z
    .string()
    .regex(automationLocalAtDatePattern, 'Expected a YYYY-MM-DD calendar date.')
    .describe(
      'Exact trusted calendar date returned with the daylight-saving recovery key.',
    ),
}).strict()

const automationDynamicToolScheduleSchema = z.union([
  automationScheduleEverySchema,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
  automationScheduleDeviceActivitySchema,
  automationLocalAtScheduleSchema,
])

const saveAutomationArgumentsSchema = z.object({
  action: z.literal('save'),
  activeUntil: automationActiveUntilSchema.nullable().optional(),
  assistantTargetOverride: hostedAutomationAssistantTargetOverrideSchema
    .nullable()
    .optional(),
  continuityPolicy: z.enum(automationContinuityPolicyValues).optional(),
  instructions: automationInstructionsSchema,
  localAtRecoveryKey: automationLocalAtRecoveryKeySchema.optional(),
  schedule: automationDynamicToolScheduleSchema,
  slug: automationSlugSchema.optional(),
  status: z.enum(automationStatusValues).optional(),
  summary: automationSummarySchema.nullable().optional(),
  supportKind: z.enum(automationSupportKindValues).nullable().optional(),
  supportSeriesId: automationSupportSeriesIdSchema.optional(),
  tags: automationTagsSchema.optional(),
  title: automationTitleSchema,
}).strict().superRefine((value, context) => {
  if (
    value.localAtRecoveryKey !== undefined
    && (
      !('localAt' in value.schedule)
      || value.schedule.localAt.date === undefined
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'localAtRecoveryKey is valid only with an explicit schedule.localAt.date retry.',
      path: ['localAtRecoveryKey'],
    })
  }
})

const saveOnboardingFirstPersonalReadArgumentsSchema = z.object({
  action: z.literal(MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION),
}).strict()

const inspectAutomationArgumentsSchema = z.object({
  action: z.literal('inspect'),
  lookup: automationIdentifierSchema.describe(
    'Existing automation id or slug to inspect without changing it.',
  ),
}).strict()

const patchAutomationArgumentsSchema = z.object({
  action: z.literal('patch'),
  activeUntil: automationActiveUntilSchema.nullable().optional(),
  assistantTargetOverride: hostedAutomationAssistantTargetOverrideSchema
    .nullable()
    .optional(),
  continuityPolicy: z.enum(automationContinuityPolicyValues).optional(),
  expectedUpdatedAt: automationUpdatedAtSchema.describe(
    'Required current automation updatedAt value from the most recent readback before changing an existing automation.',
  ),
  instructions: automationInstructionsSchema.optional(),
  localAtRecoveryKey: automationLocalAtRecoveryKeySchema.optional(),
  lookup: automationIdentifierSchema,
  retargetToCurrentConversation: z.literal(true).optional(),
  schedule: automationDynamicToolScheduleSchema.optional(),
  slug: automationSlugSchema.optional(),
  status: z.enum(automationStatusValues).optional(),
  summary: automationSummarySchema.nullable().optional(),
  supportKind: z.enum(automationSupportKindValues).nullable().optional(),
  supportSeriesId: automationSupportSeriesIdSchema.optional(),
  tags: automationTagsSchema.optional(),
  title: automationTitleSchema.optional(),
}).strict().superRefine((value, context) => {
  const patchKeys = [
    'activeUntil',
    'assistantTargetOverride',
    'continuityPolicy',
    'instructions',
    'retargetToCurrentConversation',
    'schedule',
    'slug',
    'status',
    'summary',
    'supportKind',
    'supportSeriesId',
    'tags',
    'title',
  ] as const
  const requestedPatchKeys = patchKeys.filter((key) =>
    Object.hasOwn(value, key),
  )
  const targetsOnboardingFirstRead =
    value.lookup === MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID
    || value.lookup === MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG
  const archivesOnboardingFirstReadOnly =
    requestedPatchKeys.length === 1
    && requestedPatchKeys[0] === 'status'
    && value.status === 'archived'
  const claimsOnboardingFirstReadSlug =
    value.slug === MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG

  if (
    claimsOnboardingFirstReadSlug
    || (targetsOnboardingFirstRead && !archivesOnboardingFirstReadOnly)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'The onboarding first personal read slug is reserved, and its existing record can only be archived through generic patch.',
      path: ['lookup'],
    })
  }

  if (requestedPatchKeys.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Patch requires at least one field to change.',
      path: [],
    })
  }

  if (
    value.localAtRecoveryKey !== undefined
    && (
      value.schedule === undefined
      || !('localAt' in value.schedule)
      || value.schedule.localAt.date === undefined
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'localAtRecoveryKey is valid only with an explicit schedule.localAt.date retry.',
      path: ['localAtRecoveryKey'],
    })
  }
})

const reconcileAutomationArgumentsSchema = z.object({
  action: z.literal('reconcile'),
  desiredAutomationIds: z.array(automationIdentifierSchema).max(200),
  supportSeriesId: automationSupportSeriesIdSchema,
}).strict()

const automationArgumentsSchema = z.discriminatedUnion('action', [
  dismissAutomationLocalAtRecoveryArgumentsSchema,
  inspectAutomationArgumentsSchema,
  saveAutomationArgumentsSchema,
  saveOnboardingFirstPersonalReadArgumentsSchema,
  patchAutomationArgumentsSchema,
  reconcileAutomationArgumentsSchema,
])

const AUTOMATION_ARGUMENT_ROOT_KEYS = [
  'action',
  'activeUntil',
  'assistantTargetOverride',
  'continuityPolicy',
  'expectedUpdatedAt',
  'instructions',
  'localAtRecoveryKey',
  'lookup',
  'retargetToCurrentConversation',
  'resolvedLocalDate',
  'schedule',
  'slug',
  'status',
  'summary',
  'supportKind',
  'supportSeriesId',
  'tags',
  'title',
  'desiredAutomationIds',
] as const

export const MURPH_AUTOMATION_TOOL = {
  namespace: 'murph',
  name: 'automation',
  deferLoading: true,
  description: [
    'Create, inspect, patch, or reconcile durable Murph automations for the current authenticated conversation. Generic save is create-only; use action=inspect and then a versioned patch for every existing automation. Inspect is read-only and returns the authoritative stored version plus scheduler timing projection. For every model-authored one-shot, pass schedule.kind=at with schedule.localAt.time, schedule.localAt.timeZone, and exactly one of schedule.localAt.date or schedule.localAt.relativeDay; raw exact ISO schedule.at is not accepted on generic save or patch. When the request says today, tonight, or tomorrow, preserve that wording as relativeDay (today for tonight) so the host resolves it against the named timezone; never calculate a calendar date from a relative word in the model. Use date only for an explicit calendar date from the request or established context. If localAt is nonexistent because of a daylight-saving gap, state the explicit host-resolved date returned by the tool while asking for another time, then retry with that date instead of relativeDay and echo the exact returned localAtRecoveryKey. If it is ambiguous because of a daylight-saving fold, state the explicit host-resolved date returned by the tool while asking whether the earlier or later occurrence is intended, then retry with that date, schedule.localAt.fold, and the exact returned localAtRecoveryKey instead of relativeDay. The recovery key is root-turn-only correlation: include it only on the explicit-date retry that answers that failure; unknown or wrong-date keys are rejected before mutation. If the participant withdraws that reminder or replaces its trusted date, first call action=dismiss_local_at_recovery with the exact returned localAtRecoveryKey and resolvedLocalDate; after successful dismissal, make any replacement save or versioned patch as an ordinary request without that key. Never dismiss an unresolved recovery unless the participant clearly withdraws or supersedes it; omitting it leaves that clarification pending and treats the call as an independent reminder. Recurring cron and dailyLocal values are wall-clock fields: when the user names a timezone, preserve the requested clock time and pass its IANA name in schedule.timeZone; never convert that clock time to UTC inside the cron or localTime field. On save, omit schedule.timeZone only when the recurrence should follow the vault timezone. On patch, inspect the current stored automation first and pass expectedUpdatedAt from that readback; if the automation changed, inspect it again and decide from the new stored state; a replacement recurring wall-clock schedule that omits schedule.timeZone preserves the stored explicit timezone, so do not ask the user to repeat it or guess it from current conversation context. After save or patch, inspect the stored schedule, status, updatedAt, timingVerified, effectiveTimeZone, and nextOccurrenceAt from this result. For an active deviceActivity schedule, confirm the persisted event trigger directly: a null nextOccurrenceAt means no clock occurrence is knowable until a matching activity arrives, not that future delivery is exhausted; do not invent a time or offer timing recovery. For time-based schedules, verify any user-facing timing confirmation against timingVerified, schedule, effectiveTimeZone, and nextOccurrenceAt from the tool result; a verified null nextOccurrenceAt means no later deliverable occurrence, not a retry or cutoff wake. For an active one-shot with that verified null result, say its requested time is no longer deliverable and offer to reschedule it. For ordinary save or patch, choose assistantTargetOverride deliberately: use Luna for self-contained cues and reminders with all needed context in the instructions and no reads or tools; use Terra for bounded contextual judgment or a few targeted reads; inherit the conversation-selected model for broad conversation history, research, complex or sensitive reasoning, or whenever that model materially matters. On save, omit assistantTargetOverride to inherit. On patch, assistantTargetOverride replaces the whole stored override: omit the field only to preserve it, use null to return to conversation inheritance, or send the complete replacement. Explicit model selections use high reasoning for Luna and low for Terra or Sol at execution unless reasoningEffort is supplied. The override applies only to the automation turn; a later reply returns to the saved conversation model with the automation message retained through compatible provider-thread continuity or committed history replay. save_onboarding_first_personal_read creates the fixed code-owned private first-read one-shot for the answered-onboarding completion turn; it accepts no prompt, timing, model, route, or other fields. Generic save cannot replace it, the fixed slug is reserved, and generic patch may only archive the existing record when the member cancels. save binds an ordinary automation to this conversation and accepts no route fields. patch preserves the stored route unless retargetToCurrentConversation=true is explicit. reconcile archives members of one supportSeriesId that are absent from desiredAutomationIds. Use patch status to pause, reactivate, or archive. Never pass credentials, delivery targets, filesystem paths, reserved system tags, model-provider ids, or generic commands.',
      'A save or patch result already includes one host-owned read-only timing readback. When timingVerified=false, confirm that the write succeeded and report the returned stored schedule and status, briefly state that timing remains unconfirmed, and make no next-occurrence claim. When timingVerificationIssues includes record_readback_mismatch, say the record changed during verification and treat the returned schedule and status as current instead of claiming the requested mutation still holds. Do not inspect again, retry the write, create a fallback automation, ask the member to authorize another inspection, or offer another inspection. Interpret runtime_state_pending as the scheduler finishing existing work, stale_recurring_occurrence as a fresh recurring run not yet projected, projection_unavailable as scheduler timing unavailable, record_readback_mismatch as the stored schedule and scheduler projection not yet aligned, and default_timezone_unverified as the schedule timezone not yet confirmed. Do not expose these internal code names.',
      'For recurring time-based schedules, use these exact canonical shapes: every `{"kind":"every","everyMs":3600000}`; cron `{"kind":"cron","expression":"0 9 * * 1-5","timeZone":"America/Chicago"}`; dailyLocal `{"kind":"dailyLocal","localTime":"09:00","timeZone":"America/Chicago"}`. Changes to an existing automation use `action: patch`, never `action: update`, and every patch requires `lookup` identifying the existing automation. Never invent schedule, update, or timezone fields outside the schema. The exact camel-case field `schedule.timeZone` is valid only for recurring `cron` and `dailyLocal` wall-clock schedules; never use `timezone`, `schedule.timezone`, top-level `timeZone`, or any other invented timezone field.',
    ].join(' '),
  inputSchema: z.toJSONSchema(automationArgumentsSchema, { io: 'input' }),
} as const

const AUTOMATION_VALIDATION_PATHS =
  collectSafeJsonSchemaValidationPaths(MURPH_AUTOMATION_TOOL.inputSchema)

export type AutomationDynamicToolRequest =
  | {
      kind: 'automation-local-at-recovery-dismissal'
      recoveryKey: string
      resolvedLocalDate: string
    }
  | {
      kind: 'automation'
      localAtRecovery?: {
        recoveryKey: string
        resolvedLocalDate: string
      }
      onboardingFirstReadCompletionRequested?: true
      request: AssistantHostedAutomationToolRequest
    }
  | {
      kind: 'invalid-automation-arguments'
      localAtRecovery?: {
        recoveryKey: string
        resolvedLocalDate: string
      }
      localAtTargetLabel?: string
      localAtTargetKey?: string
      resolvedLocalDate?: string
      safeFailureCode?: AutomationLocalAtFailureCode
      validationDigest: SafeToolCallValidationDigest
    }

export function readAutomationDynamicToolRequest(input: {
  arguments: unknown
  relativeDateReferenceWindow?: AssistantAcceptedTurnInputReferenceWindow | null
  tool: string | null
}): AutomationDynamicToolRequest | null {
  if (input.tool !== MURPH_AUTOMATION_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: automationArgumentsSchema,
    schemaPaths: AUTOMATION_VALIDATION_PATHS,
    schemaRootKeys: AUTOMATION_ARGUMENT_ROOT_KEYS,
    toolName: 'murph.automation',
    value: input.arguments,
  })

  if (!parsed.ok) {
    return {
      kind: 'invalid-automation-arguments',
      validationDigest: parsed.validationDigest,
    }
  }

  if (parsed.args.action === 'dismiss_local_at_recovery') {
    return {
      kind: 'automation-local-at-recovery-dismissal',
      recoveryKey: parsed.args.localAtRecoveryKey,
      resolvedLocalDate: parsed.args.resolvedLocalDate,
    }
  }

  let localAtAttempt: ReturnType<typeof readAutomationLocalAtAttempt> = null
  try {
    localAtAttempt = readAutomationLocalAtAttempt(parsed.args)
    return {
      kind: 'automation',
      ...(localAtAttempt?.explicitLocalDate && localAtAttempt.recoveryKey
        ? {
            localAtRecovery: {
              recoveryKey: localAtAttempt.recoveryKey,
              resolvedLocalDate: localAtAttempt.explicitLocalDate,
            },
          }
        : {}),
      ...(parsed.args.action === MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION
        ? { onboardingFirstReadCompletionRequested: true as const }
        : {}),
      request: resolveAutomationDynamicToolRequest(
        parsed.args,
        input.relativeDateReferenceWindow ?? null,
      ),
    }
  } catch (error) {
    return {
      kind: 'invalid-automation-arguments',
      ...(error instanceof AutomationLocalAtResolutionError
        ? {
            ...(localAtAttempt
              ? {
                  ...(localAtAttempt.explicitLocalDate &&
                    localAtAttempt.recoveryKey
                    ? {
                        localAtRecovery: {
                          recoveryKey: localAtAttempt.recoveryKey,
                          resolvedLocalDate:
                            localAtAttempt.explicitLocalDate,
                        },
                      }
                    : {}),
                  localAtTargetKey: localAtAttempt.targetKey,
                  localAtTargetLabel: localAtAttempt.targetLabel,
                }
              : {}),
            ...(error.resolvedLocalDate
              ? { resolvedLocalDate: error.resolvedLocalDate }
              : {}),
            safeFailureCode: error.code,
          }
        : {}),
      validationDigest: buildSafeToolCallValidationDigest({
        error: new z.ZodError([{
          code: z.ZodIssueCode.custom,
          message:
            error instanceof Error
              ? error.message
              : 'schedule.localAt could not be resolved.',
          path: ['schedule', 'localAt'],
        }]),
        rawInput: input.arguments,
        requestedToolName: 'murph.automation',
        schemaName: 'murph.automation.input',
        schemaRootKeys: AUTOMATION_ARGUMENT_ROOT_KEYS,
        toolName: 'murph.automation',
      }),
    }
  }
}

function readAutomationLocalAtAttempt(
  args: z.infer<typeof automationArgumentsSchema>,
): {
  explicitLocalDate: string | null
  recoveryKey: string | null
  targetKey: string
  targetLabel: string
} | null {
  if (args.action !== 'save' && args.action !== 'patch') {
    return null
  }
  const schedule = args.schedule
  if (schedule === undefined || !('localAt' in schedule)) {
    return null
  }

  const targetKey = args.localAtRecoveryKey
    ?? buildAutomationLocalAtTargetKey(
      args.action === 'patch'
        ? args.lookup
        : resolveAutomationUpsertSlug({
            slug: args.slug,
            title: args.title,
          }),
    )
  return {
    explicitLocalDate: schedule.localAt.date ?? null,
    recoveryKey: args.localAtRecoveryKey ?? null,
    targetKey,
    targetLabel: args.action === 'patch'
      ? args.lookup
      : args.slug
        ? `${args.title} (${args.slug})`
        : args.title,
  }
}

function buildAutomationLocalAtTargetKey(targetIdentity: string): string {
  return createHash('sha256')
    .update(JSON.stringify(targetIdentity))
    .digest('hex')
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveAutomationDynamicToolRequest(
  args: z.infer<typeof automationArgumentsSchema>,
  relativeDateReferenceWindow: AssistantAcceptedTurnInputReferenceWindow | null,
): AssistantHostedAutomationToolRequest {
  if (args.action === 'dismiss_local_at_recovery') {
    throw new TypeError(
      'Local-time recovery dismissal must be handled by the active root turn.',
    )
  }
  if (args.action === MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION) {
    return buildOnboardingFirstPersonalReadAutomationSaveRequest()
  }
  if (args.action === 'save') {
    const { localAtRecoveryKey: _localAtRecoveryKey, schedule, ...rest } = args
    return {
      ...rest,
      schedule: resolveDynamicAutomationSchedule(
        schedule,
        relativeDateReferenceWindow,
      ),
    }
  }
  if (args.action === 'patch') {
    const {
      localAtRecoveryKey: _localAtRecoveryKey,
      schedule,
      ...rest
    } = args
    return {
      ...rest,
      ...(schedule === undefined
        ? {}
        : {
            schedule: resolveDynamicAutomationSchedule(
              schedule,
              relativeDateReferenceWindow,
            ),
          }),
    }
  }
  return args
}

function resolveDynamicAutomationSchedule(
  schedule: z.infer<typeof automationDynamicToolScheduleSchema>,
  relativeDateReferenceWindow: AssistantAcceptedTurnInputReferenceWindow | null,
): AutomationSchedule {
  if ('localAt' in schedule) {
    return {
      at: resolveOneShotLocalAt(
        schedule.localAt,
        relativeDateReferenceWindow,
      ),
      kind: 'at',
    }
  }
  return schedule
}

function resolveOneShotLocalAt(
  localAt: z.infer<typeof automationOneShotLocalAtSchema>,
  relativeDateReferenceWindow: AssistantAcceptedTurnInputReferenceWindow | null,
): string {
  const timeZone = normalizeIanaTimeZone(localAt.timeZone)
  if (!timeZone) {
    throw new AutomationLocalAtResolutionError(
      'local_at_invalid_timezone',
      'schedule.localAt.timeZone must be a valid IANA timezone.',
    )
  }

  const date = localAt.date === undefined
    ? resolveLocalAtRelativeDate(
        localAt.relativeDay,
        timeZone,
        relativeDateReferenceWindow,
      )
    : parseLocalAtDate(localAt.date)
  const time = parseLocalAtTime(localAt.time)
  const localAsUtcMs = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    0,
    0,
  )
  const matches = [...collectOneShotLocalAtOffsets(timeZone, localAsUtcMs)]
    .map((offsetMs) => localAsUtcMs - offsetMs)
    .filter((candidateMs) => {
      const parts = formatTimeZoneDateTimeParts(candidateMs, timeZone)
      return parts.year === date.year
        && parts.month === date.month
        && parts.day === date.day
        && parts.hour === time.hour
        && parts.minute === time.minute
        && parts.second === 0
    })
  const uniqueMatches = [...new Set(matches)].sort((left, right) => left - right)
  if (uniqueMatches.length === 0) {
    throw new AutomationLocalAtResolutionError(
      'local_at_gap',
      'schedule.localAt does not exist in that timezone because of a daylight-saving gap.',
      formatLocalAtDate(date),
    )
  }
  if (uniqueMatches.length > 1) {
    if (localAt.fold === undefined) {
      throw new AutomationLocalAtResolutionError(
        'local_at_fold',
        'schedule.localAt is ambiguous in that timezone because of a daylight-saving fold; choose the earlier or later occurrence.',
        formatLocalAtDate(date),
      )
    }
    const selected = localAt.fold === 'earlier'
      ? uniqueMatches[0]
      : uniqueMatches.at(-1)
    return new Date(selected ?? Number.NaN).toISOString()
  }
  return new Date(uniqueMatches[0] ?? Number.NaN).toISOString()
}

function resolveLocalAtRelativeDate(
  relativeDay: typeof automationLocalAtRelativeDayValues[number] | undefined,
  timeZone: string,
  referenceWindow: AssistantAcceptedTurnInputReferenceWindow | null,
): { day: number; month: number; year: number } {
  if (relativeDay === undefined) {
    throw new Error('schedule.localAt requires an explicit date or relativeDay.')
  }
  const earliestAtMs = referenceWindow === null
    ? Number.NaN
    : Date.parse(referenceWindow.earliestAt)
  const latestAtMs = referenceWindow === null
    ? Number.NaN
    : Date.parse(referenceWindow.latestAt)
  if (
    !Number.isFinite(earliestAtMs)
    || !Number.isFinite(latestAtMs)
    || earliestAtMs > latestAtMs
  ) {
    throw new AutomationLocalAtResolutionError(
      'local_at_reference_unavailable',
      'schedule.localAt.relativeDay requires the accepted input reference window.',
    )
  }
  const current = formatTimeZoneDateTimeParts(earliestAtMs, timeZone)
  const latest = formatTimeZoneDateTimeParts(latestAtMs, timeZone)
  if (
    current.year !== latest.year
    || current.month !== latest.month
    || current.day !== latest.day
  ) {
    throw new AutomationLocalAtResolutionError(
      'local_at_reference_spans_dates',
      'schedule.localAt.relativeDay is ambiguous because the accepted inputs span calendar dates in that timezone; ask for an explicit YYYY-MM-DD date.',
    )
  }
  const dayOffset = relativeDay === 'tomorrow' ? 1 : 0
  const resolved = new Date(Date.UTC(
    current.year,
    current.month - 1,
    current.day + dayOffset,
  ))
  return {
    day: resolved.getUTCDate(),
    month: resolved.getUTCMonth() + 1,
    year: resolved.getUTCFullYear(),
  }
}

function collectOneShotLocalAtOffsets(
  timeZone: string,
  localAsUtcMs: number,
): Set<number> {
  const offsets = new Set<number>()
  const dayMs = 24 * 60 * 60 * 1_000
  for (const deltaMs of [-2 * dayMs, -dayMs, 0, dayMs, 2 * dayMs]) {
    const instantMs = localAsUtcMs + deltaMs
    const projected = formatTimeZoneDateTimeParts(instantMs, timeZone)
    const projectedAsUtcMs = Date.UTC(
      projected.year,
      projected.month - 1,
      projected.day,
      projected.hour,
      projected.minute,
      projected.second,
    )
    offsets.add(projectedAsUtcMs - instantMs)
  }
  return offsets
}

function parseLocalAtDate(
  value: string,
): { day: number; month: number; year: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) {
    throw new Error('schedule.localAt.date must use YYYY-MM-DD format.')
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 100) {
    throw new Error('schedule.localAt.date must be a valid calendar date.')
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() + 1 !== month
    || roundTrip.getUTCDate() !== day
  ) {
    throw new Error('schedule.localAt.date must be a valid calendar date.')
  }
  return { day, month, year }
}

function formatLocalAtDate(input: {
  day: number
  month: number
  year: number
}): string {
  return [
    input.year.toString().padStart(4, '0'),
    input.month.toString().padStart(2, '0'),
    input.day.toString().padStart(2, '0'),
  ].join('-')
}

function parseLocalAtTime(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value)
  if (!match) {
    throw new Error('schedule.localAt.time must use HH:MM format.')
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}

export async function executeAutomationDynamicTool(input: {
  abortSignal?: AbortSignal | null
  automationTool: AssistantHostedAutomationTool
  onboardingFirstReadCompletionTransitionAvailable?: boolean | null
  request: Extract<AutomationDynamicToolRequest, { kind: 'automation' }>
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (
    input.request.onboardingFirstReadCompletionRequested === true
    && input.onboardingFirstReadCompletionTransitionAvailable !== true
  ) {
    return automationTextResult(
      false,
      'onboarding first read is unavailable outside its completion transition',
    )
  }

  try {
    const response = await input.automationTool.request(input.request.request, {
      ...(input.request.onboardingFirstReadCompletionRequested === true
        ? { onboardingFirstReadCompletionTransition: true as const }
        : {}),
      signal: input.abortSignal ?? null,
    })
    if (response.action !== input.request.request.action) {
      return automationTextResult(
        false,
        'automation operation returned an unexpected result',
      )
    }

    const text = serializeAutomationToolResponse(response)
    if (!text) {
      return automationTextResult(false, 'automation result is too large')
    }
    return automationTextResult(true, text)
  } catch (error) {
    if (isAutomationConflictError(error)) {
      return automationTextResult(
        false,
        'automation changed since the last readback; inspect it again and decide from the current stored schedule before retrying',
      )
    }
    return automationTextResult(false, 'automation operation is unavailable')
  }
}

function isAutomationConflictError(
  error: unknown,
): error is { code: 'VAULT_AUTOMATION_CONFLICT' } {
  return isUnknownRecord(error) && error.code === 'VAULT_AUTOMATION_CONFLICT'
}

function serializeAutomationToolResponse(
  response: AssistantHostedAutomationToolResponse,
): string | null {
  let payload: Readonly<Record<string, unknown>>
  switch (response.action) {
    case 'reconcile':
      payload = {
        action: response.action,
        archivedCount: response.archivedCount,
        matchedCount: response.matchedCount,
        missingDesiredAutomationIds: response.missingDesiredAutomationIds,
        supportSeriesId: response.supportSeriesId,
        unchangedCount: response.unchangedCount,
      }
      break
    case 'patch':
    case 'save':
      payload = {
        action: response.action,
        automationId: response.automationId,
        created: response.created,
        effectiveTimeZone: response.effectiveTimeZone,
        lookupId: response.lookupId,
        nextOccurrenceAt: response.nextOccurrenceAt,
        routeBinding: response.routeBinding,
        schedule: response.schedule,
        status: response.status,
        timingVerified: response.timingVerified,
        timingVerificationIssues: response.timingVerificationIssues ?? [],
        updatedAt: response.updatedAt,
      }
      break
    case 'inspect':
      payload = {
        action: response.action,
        automationId: response.automationId,
        effectiveTimeZone: response.effectiveTimeZone,
        lookupId: response.lookupId,
        nextOccurrenceAt: response.nextOccurrenceAt,
        routeBinding: response.routeBinding,
        schedule: response.schedule,
        status: response.status,
        timingVerified: response.timingVerified,
        timingVerificationIssues: response.timingVerificationIssues ?? [],
        updatedAt: response.updatedAt,
      }
      break
  }
  try {
    const text = JSON.stringify(payload) ?? 'null'
    return new TextEncoder().encode(text).byteLength <= AUTOMATION_TOOL_RESULT_MAX_BYTES
      ? text
      : null
  } catch {
    return null
  }
}

function automationTextResult(success: boolean, text: string): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
