import { z } from 'zod'

import {
  automationAssistantTargetOverrideSchema,
  automationContinuityPolicyValues,
  automationScheduleSchema,
  automationStatusValues,
} from '@murphai/contracts'
import type {
  AssistantHostedAutomationTool,
  AssistantHostedAutomationToolRequest,
  AssistantHostedAutomationToolResponse,
} from '../../assistant/execution-context.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const AUTOMATION_TOOL_RESULT_MAX_BYTES = 24_000
const automationIdentifierSchema = z.string().trim().min(1).max(191)
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

const saveAutomationArgumentsSchema = z.object({
  action: z.literal('save'),
  assistantTargetOverride: automationAssistantTargetOverrideSchema.nullable().optional(),
  automationId: automationIdentifierSchema.optional(),
  continuityPolicy: z.enum(automationContinuityPolicyValues).optional(),
  instructions: automationInstructionsSchema,
  schedule: automationScheduleSchema,
  slug: automationSlugSchema.optional(),
  status: z.enum(automationStatusValues).optional(),
  summary: automationSummarySchema.nullable().optional(),
  tags: automationTagsSchema.optional(),
  title: automationTitleSchema,
}).strict()

const patchAutomationArgumentsSchema = z.object({
  action: z.literal('patch'),
  assistantTargetOverride: automationAssistantTargetOverrideSchema.nullable().optional(),
  continuityPolicy: z.enum(automationContinuityPolicyValues).optional(),
  instructions: automationInstructionsSchema.optional(),
  lookup: automationIdentifierSchema,
  retargetToCurrentConversation: z.literal(true).optional(),
  schedule: automationScheduleSchema.optional(),
  slug: automationSlugSchema.optional(),
  status: z.enum(automationStatusValues).optional(),
  summary: automationSummarySchema.nullable().optional(),
  tags: automationTagsSchema.optional(),
  title: automationTitleSchema.optional(),
}).strict().superRefine((value, context) => {
  const patchKeys = [
    'assistantTargetOverride',
    'continuityPolicy',
    'instructions',
    'retargetToCurrentConversation',
    'schedule',
    'slug',
    'status',
    'summary',
    'tags',
    'title',
  ] as const
  if (!patchKeys.some((key) => Object.hasOwn(value, key))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Patch requires at least one field to change.',
      path: [],
    })
  }
})

const automationArgumentsSchema = z.discriminatedUnion('action', [
  saveAutomationArgumentsSchema,
  patchAutomationArgumentsSchema,
])

export const MURPH_AUTOMATION_TOOL = {
  namespace: 'murph',
  name: 'automation',
  description:
    'Create or update one durable Murph automation for the current authenticated conversation. save binds delivery to this conversation and accepts no route fields. patch preserves the stored route unless retargetToCurrentConversation=true is explicit. Use patch status to pause, reactivate, or archive. The result identifies the automation, whether it was created, its route binding, and status. Never pass credentials, delivery targets, filesystem paths, or generic commands.',
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
      'tags',
      'title',
    ],
    toolName: 'murph.automation',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'automation', request: parsed.args }
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
  const payload = {
    action: response.action,
    automationId: response.automationId,
    created: response.created,
    lookupId: response.lookupId,
    routeBinding: response.routeBinding,
    status: response.status,
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
