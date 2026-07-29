import { createHash } from 'node:crypto'

import { z } from 'zod'
import {
  hostedPhoneCallBriefSchema,
  type HostedPhoneCallBrief,
} from '@murphai/hosted-execution/phone-calls'

import type {
  AssistantHostedToolRequestKeyScope,
} from '../../assistant/hosted-tool-context.js'
import type { AssistantConversationScope } from '../../assistant/conversation-policy.js'
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
  'callerName',
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
    'Before a real call, read $MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md.',
    'Start one outbound phone call only when the current requester explicitly asked Murph to call or clearly approved this specific call.',
    'Resolve relative dates and times before creating the brief.',
    'Before a real health care appointment booking, rescheduling, cancellation, or waitlist call, read $MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md and satisfy its ready-to-act gate with a completed, user-approved readiness brief; an information-only or connectivity-test call must stay non-mutating, remain separate, and never count as appointment readiness.',
    'Put only requester-approved, call-relevant, disclosable facts in shareableFacts.',
    'Group-chat calls never transfer to one participant; Murph forces allowTransferToUser=false for group calls.',
    'Do not put a participant transfer phone number in shareableFacts; Murph resolves eligible verified transfer numbers server-side for private calls.',
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
      acceptedInputIds: [input.scope.acceptedInputIds.at(-1)!],
      brief: input.brief,
      conversationId: input.scope.conversationId,
      inboundMailboxItemIds: input.scope.inboundMailboxItemIds.length > 0
        ? [input.scope.inboundMailboxItemIds.at(-1)!]
        : [],
      recipientKey: input.scope.recipientKey,
      schema: 'murph.create-phone-call.request-key.v1',
    }))
    .digest('hex')
  return `phone_call_${digest}`
}

export function resolvePhoneCallRequesterInboundMailboxItemIds(
  scope: AssistantHostedToolRequestKeyScope,
): string[] {
  const requesterMailboxItemId = scope.inboundMailboxItemIds.at(-1)
  return requesterMailboxItemId ? [requesterMailboxItemId] : []
}

export function normalizePhoneCallBriefForConversationScope(input: {
  brief: HostedPhoneCallBrief
  conversationScope: AssistantConversationScope
}): HostedPhoneCallBrief {
  if (input.conversationScope !== 'group' || !input.brief.allowTransferToUser) {
    return input.brief
  }

  return {
    ...input.brief,
    allowTransferToUser: false,
  }
}

export function resolveAssistantUserActionAcceptedInputIds(input: {
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
  turnTrigger?: string | null
}): readonly string[] {
  return input.acceptedInputItems
    .filter((item) => isAssistantUserActionAcceptedInputEligible({
      id: item.id,
      source: item.source,
      turnTrigger: input.turnTrigger ?? null,
    }))
    .map((item) => item.id)
}

function isAssistantUserActionAcceptedInputEligible(input: {
  id: string
  source: AssistantAcceptedTurnInputSource
  turnTrigger: string | null
}): boolean {
  if (!isUserActionTurnTriggerEligibleForUserInput(input.turnTrigger)) {
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

function isUserActionTurnTriggerEligibleForUserInput(turnTrigger: string | null): boolean {
  return turnTrigger === null ||
    turnTrigger === 'manual-ask' ||
    turnTrigger === 'manual-deliver' ||
    turnTrigger === 'automation-auto-reply'
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
