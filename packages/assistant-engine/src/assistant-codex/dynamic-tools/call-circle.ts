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
  'cadence',
  'counterWindow',
  'kind',
  'memberCadenceUpdates',
  'timeZone',
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
    'The server resolves the group, match, and member side from the authenticated thread and the pending ask; never supply identifiers.',
    'For preferences, send only the settings the member changed: days/times as windows plus the current IANA timeZone, cadence as weekly, biweekly, or monthly for their default frequency, and memberCadenceUpdates for a private per-person weekly, biweekly, monthly, never, or default override. The default value clears a prior override.',
    'For a per-person override, send only the person name the member used in this private conversation. The server resolves it against privacy-preserving same-group Call Circle names; never guess or send an opaque member id. Ambiguous or unknown names fail closed. Never send a phone number or group, match, route, or side identifier.',
    'For a setup or preferences ask, no means kind="pause". For a match ask, yes means kind="confirm", no means kind="decline", and an alternate time means kind="counter".',
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
