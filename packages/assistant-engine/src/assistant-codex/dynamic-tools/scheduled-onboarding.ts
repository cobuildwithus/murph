import { z } from 'zod'

import {
  completePreparedOnboardingFollowup,
} from '../../assistant/onboarding-followup-automation.js'
import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
} from '../../assistant/scheduled-task-authority.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const argumentsSchema = z.object({
  reason: z.enum(['user_answered', 'user_declined']),
}).strict()

export const MURPH_COMPLETE_ONBOARDING_TOOL = {
  namespace: 'murph',
  name: 'complete_onboarding',
  description:
    'Complete onboarding only for the exact managed follow-up revision prepared by the trusted parent. The model selects only answered versus declined; it cannot supply a vault, user, automation, revision, route, timestamp, path, or command. The owner revalidates the prepared source revision immediately before the idempotent write.',
  inputSchema: z.toJSONSchema(argumentsSchema, { io: 'input' }),
} as const

export type ScheduledOnboardingDynamicToolRequest =
  | {
      kind: 'complete-onboarding'
      request: z.infer<typeof argumentsSchema>
    }
  | {
      kind: 'invalid-complete-onboarding-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledOnboardingDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ScheduledOnboardingDynamicToolRequest | null {
  if (input.tool !== MURPH_COMPLETE_ONBOARDING_TOOL.name) {
    return null
  }
  const parsed = parseDynamicToolArguments({
    schema: argumentsSchema,
    schemaRootKeys: ['reason'],
    toolName: 'murph.complete_onboarding',
    value: input.arguments,
  })
  return parsed.ok
    ? { kind: 'complete-onboarding', request: parsed.args }
    : {
        kind: 'invalid-complete-onboarding-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeScheduledOnboardingDynamicTool(input: {
  authority: AssistantScheduledTaskAuthority | null
  request: Extract<ScheduledOnboardingDynamicToolRequest, {
    kind: 'complete-onboarding'
  }>
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  const authority = resolveAssistantScheduledTaskAuthority(input.authority)
  if (!input.vaultRoot || authority.kind !== 'onboarding_followup') {
    return textResult(false, JSON.stringify({
      code: 'scheduled_onboarding_unauthorized',
    }))
  }

  try {
    const state = await completePreparedOnboardingFollowup({
      automationId: authority.automationId,
      expectedUpdatedAt: authority.expectedUpdatedAt,
      reason: input.request.request.reason,
      vault: input.vaultRoot,
    })
    return textResult(true, JSON.stringify({
      completedAt: state.completedAt,
      completedReason: state.completedReason,
      status: state.status,
    }))
  } catch {
    return textResult(false, JSON.stringify({
      code: 'scheduled_onboarding_unauthorized',
    }))
  }
}

function textResult(success: boolean, text: string) {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' as const }],
      success,
    },
  }
}
