import { z } from 'zod'
import {
  hostedCallCircleRespondRequestSchema,
  type HostedCallCircleRespondRequest,
} from '@murphai/hosted-execution/call-circle'

import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const CALL_CIRCLE_RESPOND_ROOT_KEYS = [
  'counterWindow',
  'excludeMemberIds',
  'groupId',
  'kind',
  'matchId',
  'side',
  'windows',
] as const

export const MURPH_CALL_CIRCLE_RESPOND_TOOL = {
  namespace: 'murph',
  name: 'call_circle_respond',
  description: [
    'Record this member\'s own Call Circle preferences, pause choice, resume choice, or yes/no answer.',
    'Use only for replies from this member\'s own Murph thread.',
    'Use only after this member has already opted into Call Circle for the group or is replying to a pending Call Circle ask.',
    'Never record an answer for another person, never invent availability, never include phone numbers, and never start calls.',
    'For confirm, decline, and counter, omit matchId and side unless the pending ask explicitly supplied them; the server resolves the current member\'s active ask when it is unambiguous.',
    'For preferences, omit groupId unless the reply names a specific group; the server resolves the member\'s active Call Circle enrollment when it is unambiguous.',
    'For preferences, record only days and times the member provided. If they say no or pause, use kind="pause".',
  ].join(' '),
  inputSchema: z.toJSONSchema(hostedCallCircleRespondRequestSchema, { io: 'input' }),
} as const

export type CallCircleDynamicToolRequest =
  | {
      kind: 'call-circle-respond'
      request: HostedCallCircleRespondRequest
    }
  | {
      kind: 'invalid-call-circle-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readCallCircleDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): CallCircleDynamicToolRequest | null {
  if (input.tool !== MURPH_CALL_CIRCLE_RESPOND_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: hostedCallCircleRespondRequestSchema,
    schemaRootKeys: CALL_CIRCLE_RESPOND_ROOT_KEYS,
    toolName: 'murph.call_circle_respond',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'call-circle-respond', request: parsed.args }
    : { kind: 'invalid-call-circle-arguments', validationDigest: parsed.validationDigest }
}

export function isCallCircleTurnTriggerEligible(
  turnTrigger: string | null,
): boolean {
  return turnTrigger === null ||
    turnTrigger === 'manual-ask' ||
    turnTrigger === 'manual-deliver' ||
    turnTrigger === 'automation-auto-reply'
}
