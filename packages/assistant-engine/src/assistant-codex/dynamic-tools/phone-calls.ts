import { createHash } from 'node:crypto'

import { z } from 'zod'
import {
  hostedPhoneCallBriefSchema,
  type HostedPhoneCallBrief,
} from '@murphai/hosted-execution/phone-calls'

import type {
  AssistantHostedToolRequestKeyScope,
} from '../../assistant/hosted-tool-context.js'
import type {
  AssistantAcceptedTurnInputItemInput,
  AssistantAcceptedTurnInputSource,
} from '../../assistant/active-turn-input-journal.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const PHONE_CALL_BRIEF_ROOT_KEYS = [
  'allowTransferToUser',
  'goal',
  'instructions',
  'shareableFacts',
  'successCriteria',
  'timeZone',
  'to',
] as const
const SYNTHETIC_INITIAL_ACCEPTED_INPUT_ID = 'initial'

export const MURPH_CREATE_PHONE_CALL_TOOL = {
  namespace: 'murph',
  name: 'create_phone_call',
  description: [
    'Start one outbound phone call on the user\'s behalf.',
    'Use only when the user asked Murph to call or clearly approved this call.',
    'Resolve relative dates and times before creating the brief.',
    'Put only user-approved, call-relevant, disclosable facts in shareableFacts.',
    'Facts outside shareableFacts require Murph consultation during the call.',
  ].join(' '),
  inputSchema: z.toJSONSchema(hostedPhoneCallBriefSchema, { io: 'input' }),
} as const

export type PhoneCallDynamicToolRequest =
  | {
      brief: HostedPhoneCallBrief
      kind: 'create-phone-call'
    }
  | {
      kind: 'invalid-phone-call-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readPhoneCallDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): PhoneCallDynamicToolRequest | null {
  if (input.tool !== MURPH_CREATE_PHONE_CALL_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: hostedPhoneCallBriefSchema,
    schemaRootKeys: PHONE_CALL_BRIEF_ROOT_KEYS,
    toolName: 'murph.create_phone_call',
    value: input.arguments,
  })

  return parsed.ok
    ? { brief: parsed.args, kind: 'create-phone-call' }
    : { kind: 'invalid-phone-call-arguments', validationDigest: parsed.validationDigest }
}

export function createPhoneCallRequestKey(input: {
  brief: HostedPhoneCallBrief
  scope: AssistantHostedToolRequestKeyScope
}): string {
  if (input.scope.acceptedInputIds.length === 0) {
    throw new TypeError('Phone call request key requires accepted user input.')
  }

  const digest = createHash('sha256')
    .update(stableJson({
      acceptedInputIds: [...input.scope.acceptedInputIds],
      brief: input.brief,
      conversationId: input.scope.conversationId,
      inboundMailboxItemIds: [...input.scope.inboundMailboxItemIds],
      recipientKey: input.scope.recipientKey,
      schema: 'murph.create-phone-call.request-key.v1',
    }))
    .digest('hex')
  return `phone_call_${digest}`
}

export function resolveAssistantPhoneCallAcceptedInputIds(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
  turnTrigger?: string | null
}): readonly string[] {
  return input.acceptedInputItems
    .filter((item) => isAssistantPhoneCallAcceptedInputEligible({
      id: item.id,
      source: item.source,
      turnTrigger: input.turnTrigger ?? null,
    }))
    .map((item) => item.id)
}

function isAssistantPhoneCallAcceptedInputEligible(input: {
  id: string
  source: AssistantAcceptedTurnInputSource
  turnTrigger: string | null
}): boolean {
  if (!isManualPhoneCallTurnTrigger(input.turnTrigger)) {
    return false
  }
  if (input.id === SYNTHETIC_INITIAL_ACCEPTED_INPUT_ID) {
    return false
  }

  switch (input.source) {
    case 'assistant-input':
    case 'manual':
      return true
    case 'initial':
      return false
    case 'system':
      return false
  }
}

function isManualPhoneCallTurnTrigger(turnTrigger: string | null): boolean {
  return turnTrigger === null ||
    turnTrigger === 'manual-ask' ||
    turnTrigger === 'manual-deliver'
}

function stableJson(value: unknown): string {
  return JSON.stringify(stabilizeJsonValue(value))
}

function stabilizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilizeJsonValue(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stabilizeJsonValue(entryValue)]),
  )
}
