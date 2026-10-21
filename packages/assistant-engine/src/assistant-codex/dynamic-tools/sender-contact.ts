import * as z from '@murphai/contracts/zod-runtime'
import { isAssistantInputEventId, readAssistantInputEvent } from '../../assistant/input-store.js'
import type { AssistantHostedUserActionScope } from '../../assistant/hosted-tool-context.js'
import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const senderContactArgumentsSchema = z.object({}).strict()

export const MURPH_GET_SENDER_CONTACT_TOOL = {
  namespace: 'murph',
  name: 'get_sender_contact',
  deferLoading: true,
  description: 'Read the current private iMessage sender contact only when needed. Returns the authenticated incoming phone or email handle, not Murph’s number. An email handle is not a phone number. This read grants no permission to call or share it.',
  inputSchema: z.toJSONSchema(senderContactArgumentsSchema, { io: 'input' }),
} as const

export type SenderContactDynamicToolRequest =
  | { kind: 'get-sender-contact' }
  | { kind: 'invalid-sender-contact-arguments'; validationDigest: SafeToolCallValidationDigest }

export function readSenderContactDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): SenderContactDynamicToolRequest | null {
  if (input.tool !== MURPH_GET_SENDER_CONTACT_TOOL.name) return null
  const parsed = parseDynamicToolArguments({
    schema: senderContactArgumentsSchema,
    toolName: 'murph.get_sender_contact',
    value: input.arguments,
  })
  return parsed.ok
    ? { kind: 'get-sender-contact' }
    : { kind: 'invalid-sender-contact-arguments', validationDigest: parsed.validationDigest }
}

export async function executeGetSenderContactDynamicTool(input: {
  userActionScope: AssistantHostedUserActionScope | null
  vaultRoot: string | null
}) {
  const inputId = input.userActionScope?.acceptedInputIds.at(-1)
  if (input.userActionScope?.conversationScope !== 'direct'
    || !input.vaultRoot || !inputId || !isAssistantInputEventId(inputId)) {
    return toolTextResult(false, 'Sender contact requires current private user input.', 'authority_rejected')
  }
  try {
    const event = await readAssistantInputEvent({ inputId, vault: input.vaultRoot })
    const metadata = event?.sourceMetadata
    if (event?.contentRetiredAt || event?.conversation?.source !== 'linq'
      || event.conversation.threadIsDirect !== true || event.conversation.actorIsSelf
      || metadata?.kind !== 'linq' || metadata.externalThreadRouteAuthorityPresent === true
      || !metadata.senderHandle) {
      return toolTextResult(true, JSON.stringify({ status: 'unavailable' }))
    }
    return toolTextResult(true, JSON.stringify({ status: 'available', senderHandle: metadata.senderHandle }))
  } catch (error) {
    return toolTextResult(false, 'Sender contact could not be read.', 'handler_exception', error)
  }
}
