import * as z from '@murphai/contracts/zod-runtime'
import { hostedLeaveGroupReasonSchema } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'
import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'

const argumentsSchema = z.object({ reason: hostedLeaveGroupReasonSchema, messageRef: z.string().min(1).max(128) }).strict()
export const MURPH_LEAVE_GROUP_TOOL = {
  namespace: 'murph', name: 'leave_group',
  description: 'Leave this group silently when it is clearly bots replying to each other, spam, has no real people, or a current participant asks you to leave. Pass a current messageRef. Success ends your turn without a goodbye or private message. A group with any game history cannot be left. If unavailable, explain why once when answering a person; do not retry.',
  inputSchema: z.toJSONSchema(argumentsSchema),
} as const

export function readLeaveGroupDynamicToolRequest(input: { tool: string | null; arguments: unknown }) {
  if (input.tool !== 'leave_group') return null
  const parsed = parseDynamicToolArguments({ schema: argumentsSchema, value: input.arguments, schemaRootKeys: ['reason', 'messageRef'], toolName: 'murph.leave_group' })
  return parsed.ok ? { kind: 'leave-group' as const, request: parsed.args } : { kind: 'invalid-tool-arguments' as const, errorCode: 'invalid_leave_group_arguments', validationDigest: parsed.validationDigest }
}

export async function executeLeaveGroupTool(input: {
  request: z.infer<typeof argumentsSchema>; context: AssistantHostedToolContext | null
}): Promise<MurphDynamicToolExecutionResult> {
  const scope = input.context?.currentUserActionScope?.()
  const tool = input.context?.groupTool
  if (!tool || scope?.conversationScope !== 'group' || scope.resultNotificationChannel !== 'linq'
    || !scope.acceptedInputIds.includes(input.request.messageRef)) {
    return toolTextResult(false, 'Leaving requires a current message from this Linq group.', 'authority_rejected')
  }
  try {
    const result = await tool.request({ action: 'leave_group', reason: input.request.reason,
      origin: { kind: 'accepted_input', assistantInputId: input.request.messageRef } })
    if (result.action !== 'leave_group') throw new TypeError('Unexpected group departure result.')
    if (result.result.status === 'unavailable') return toolTextResult(true, JSON.stringify(result))
    return { ...toolTextResult(true, JSON.stringify(result)), finalActionPatch: { kind: 'none', owner: 'leave-group' } }
  } catch (error) {
    return toolTextResult(false, 'Leaving could not be confirmed. Do not claim the group was left.', 'handler_exception', error)
  }
}
