import { z } from 'zod'

import {
  automationAssistantTargetOverrideSchema,
  automationActiveUntilSchema,
  automationContinuityPolicyValues,
  automationScheduleCronSchema,
  automationScheduleSchema,
  automationStatusValues,
  automationSupportKindValues,
} from '@murphai/contracts'
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
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  buildGroupNewsletterAutomationSaveRequest,
  GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES,
  GROUP_NEWSLETTER_DEFAULT_HEALTH_SCOPES,
  GROUP_NEWSLETTER_DELIVERY_VALUES,
  GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES,
  GROUP_NEWSLETTER_TONE_VALUES,
} from '../../assistant/group-newsletter-automation.js'
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

function deriveAutomationSlugFromTitle(title: string): string {
  // Mirrors the canonical automation title fallback without importing the
  // filesystem-heavy core package into deferred tool schema assembly.
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized || 'item'
}

const saveAutomationArgumentsSchema = z.object({
  action: z.literal('save'),
  activeUntil: automationActiveUntilSchema.nullable().optional(),
  assistantTargetOverride: automationAssistantTargetOverrideSchema.nullable().optional(),
  automationId: automationIdentifierSchema.optional(),
  continuityPolicy: z.enum(automationContinuityPolicyValues).optional(),
  instructions: automationInstructionsSchema,
  schedule: automationScheduleSchema,
  slug: automationSlugSchema.optional(),
  status: z.enum(automationStatusValues).optional(),
  summary: automationSummarySchema.nullable().optional(),
  supportKind: z.enum(automationSupportKindValues).nullable().optional(),
  supportSeriesId: automationSupportSeriesIdSchema.optional(),
  tags: automationTagsSchema.optional(),
  title: automationTitleSchema,
}).strict().superRefine((value, context) => {
  const requestedSlug =
    value.slug ?? deriveAutomationSlugFromTitle(value.title)
  if (
    value.automationId ===
      MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID
    || requestedSlug === MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'The onboarding first personal read must use its fixed structured action.',
      path: ['action'],
    })
  }
})

const saveOnboardingFirstPersonalReadArgumentsSchema = z.object({
  action: z.literal(MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION),
}).strict()

const patchAutomationArgumentsSchema = z.object({
  action: z.literal('patch'),
  activeUntil: automationActiveUntilSchema.nullable().optional(),
  assistantTargetOverride: automationAssistantTargetOverrideSchema.nullable().optional(),
  continuityPolicy: z.enum(automationContinuityPolicyValues).optional(),
  instructions: automationInstructionsSchema.optional(),
  lookup: automationIdentifierSchema,
  retargetToCurrentConversation: z.literal(true).optional(),
  schedule: automationScheduleSchema.optional(),
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
})

const reconcileAutomationArgumentsSchema = z.object({
  action: z.literal('reconcile'),
  desiredAutomationIds: z.array(automationIdentifierSchema).max(200),
  supportSeriesId: automationSupportSeriesIdSchema,
}).strict()

const saveGroupNewsletterArgumentsSchema = z.object({
  action: z.literal('save_newsletter'),
  customNote: z.string().trim().min(1).max(2_000).nullable().optional(),
  delivery: z.enum(GROUP_NEWSLETTER_DELIVERY_VALUES),
  healthScopes: z
    .array(z.enum(GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES))
    .min(1)
    .max(GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES.length)
    .optional(),
  newsletterName: automationTitleSchema,
  schedule: automationScheduleCronSchema,
  tone: z.enum(GROUP_NEWSLETTER_TONE_VALUES).default('supportive'),
}).strict().superRefine((value, context) => {
  if (
    value.healthScopes
    && new Set(value.healthScopes).size !== value.healthScopes.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Newsletter health scopes must be unique.',
      path: ['healthScopes'],
    })
  }
  if (value.delivery === 'current_chat' && (value.healthScopes?.length ?? 0) > 3) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Current-chat newsletters support at most three health scopes.',
      path: ['healthScopes'],
    })
  }
})

const automationArgumentsSchema = z.discriminatedUnion('action', [
  saveAutomationArgumentsSchema,
  saveOnboardingFirstPersonalReadArgumentsSchema,
  saveGroupNewsletterArgumentsSchema,
  patchAutomationArgumentsSchema,
  reconcileAutomationArgumentsSchema,
])

export const MURPH_AUTOMATION_TOOL = {
  namespace: 'murph',
  name: 'automation',
  deferLoading: true,
  description:
    'Create, update, or reconcile durable Murph automations for the current authenticated conversation. save_onboarding_first_personal_read creates the fixed code-owned private first-read one-shot for the answered-onboarding completion turn; it accepts no prompt, timing, model, route, or other fields. Generic save cannot replace it, the fixed slug is reserved, and generic patch may only archive the existing record when the member cancels. save_newsletter creates or replaces this group\'s one health newsletter from structured name, cron schedule, delivery, tone, and health scopes; use it for both current-chat and group-email delivery instead of authoring newsletter instructions. save binds an ordinary automation to this conversation and accepts no route fields. patch preserves the stored route unless retargetToCurrentConversation=true is explicit. reconcile archives members of one supportSeriesId that are absent from desiredAutomationIds. Use patch status to pause, reactivate, or archive. Never pass credentials, delivery targets, filesystem paths, reserved system tags, or generic commands.',
  inputSchema: z.toJSONSchema(automationArgumentsSchema, { io: 'input' }),
} as const

export type AutomationDynamicToolRequest =
  | {
      kind: 'automation'
      request: AssistantHostedAutomationToolRequest
    }
  | {
      kind: 'invalid-automation-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readAutomationDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): AutomationDynamicToolRequest | null {
  if (input.tool !== MURPH_AUTOMATION_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: automationArgumentsSchema,
    schemaRootKeys: [
      'action',
      'activeUntil',
      'assistantTargetOverride',
      'automationId',
      'continuityPolicy',
      'instructions',
      'lookup',
      'retargetToCurrentConversation',
      'schedule',
      'slug',
      'status',
      'summary',
      'supportKind',
      'supportSeriesId',
      'tags',
      'title',
      'desiredAutomationIds',
      'customNote',
      'delivery',
      'healthScopes',
      'newsletterName',
      'tone',
    ],
    toolName: 'murph.automation',
    value: input.arguments,
  })

  return parsed.ok
    ? {
        kind: 'automation',
        request:
          parsed.args.action === MURPH_ONBOARDING_FIRST_PERSONAL_READ_ACTION
            ? buildOnboardingFirstPersonalReadAutomationSaveRequest()
            : parsed.args.action === 'save_newsletter'
              ? buildGroupNewsletterAutomationSaveRequest({
                  configuration: {
                    customNote: parsed.args.customNote,
                    delivery: parsed.args.delivery,
                    healthScopes: parsed.args.healthScopes
                      ?? (
                        parsed.args.delivery === 'current_chat'
                          ? [...GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES]
                          : [...GROUP_NEWSLETTER_DEFAULT_HEALTH_SCOPES]
                      ),
                    newsletterName: parsed.args.newsletterName,
                    tone: parsed.args.tone,
                  },
                  schedule: parsed.args.schedule,
                })
              : parsed.args,
      }
    : {
        kind: 'invalid-automation-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeAutomationDynamicTool(input: {
  abortSignal?: AbortSignal | null
  automationTool: AssistantHostedAutomationTool
  request: Extract<AutomationDynamicToolRequest, { kind: 'automation' }>
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  try {
    const response = await input.automationTool.request(input.request.request, {
      signal: input.abortSignal ?? null,
    })
    if (response.action !== input.request.request.action) {
      return automationTextResult(
        false,
        'automation operation returned an unexpected result',
      )
    }

    const text = serializeAutomationToolResponse(response)
    return text
      ? automationTextResult(true, text)
      : automationTextResult(false, 'automation result is too large')
  } catch {
    return automationTextResult(false, 'automation operation is unavailable')
  }
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
        lookupId: response.lookupId,
        routeBinding: response.routeBinding,
        status: response.status,
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
