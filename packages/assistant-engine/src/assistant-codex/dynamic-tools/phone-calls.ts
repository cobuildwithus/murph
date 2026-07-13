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
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { stableJson } from './stable-json.js'

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

export const MURPH_CREATE_PHONE_CALL_TOOL = {
  namespace: 'murph',
  name: 'create_phone_call',
  description: [
    'Start one outbound phone call on the user\'s behalf.',
    'Use only when the user asked Murph to call or clearly approved this call.',
    'Resolve relative dates and times before creating the brief.',
    'For appointment calls, collect the user-approved first name and likely required booking facts such as patient name or date of birth before calling.',
    'Set callerName to the user-approved first name or name the callee may hear in the opening line unless the name does not make sense for this call.',
    'Put only user-approved, call-relevant, disclosable facts in shareableFacts.',
    'Set allowTransferToUser=true for calls likely to require live user identity verification, personal consent, or in-the-moment judgment unless the user says not to transfer.',
    'Set allowTransferToUser=false for info-only calls, simple status checks, or calls where transfer would surprise the user.',
    'Do not put the user transfer phone number in shareableFacts; Murph resolves verified transfer numbers server-side.',
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
