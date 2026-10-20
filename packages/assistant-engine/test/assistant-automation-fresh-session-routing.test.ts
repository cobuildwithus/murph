import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type {
  AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'

const assistantStore = vi.hoisted(() => ({
  resolveAssistantSession: vi.fn(),
}))

vi.mock('../src/assistant/store.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/store.js')
  >()
  return {
    ...actual,
    resolveAssistantSession: assistantStore.resolveAssistantSession,
  }
})

import {
  resolveAssistantTurnRouteForMessage,
} from '../src/assistant/service-turn-routes.ts'

type AssistantRouteInput = Parameters<
  typeof resolveAssistantTurnRouteForMessage
>[0]

beforeEach(() => {
  assistantStore.resolveAssistantSession.mockReset()
})

describe('fresh automation model routing', () => {
  it('upgrades an inherited OpenAI Sol target without an existing session', async () => {
    assistantStore.resolveAssistantSession.mockRejectedValueOnce({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    })
    const route = await resolveAssistantTurnRouteForMessage(
      createAutomationInput({}),
      null,
      requireTarget('gpt-6-sol', 'high', 'openai'),
    )
    expect(route.providerOptions).toMatchObject({
      model: 'gpt-6.1-sol',
      modelProvider: 'openai',
      reasoningEffort: 'high',
    })
  })



  it('keeps the resolved execution policy when no session exists', async () => {
    assistantStore.resolveAssistantSession.mockRejectedValueOnce({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    })
    const backend = createAssistantModelTarget({
      approvalPolicy: 'never',
      codexCommand: '/opt/murph-codex',
      model: 'gpt-5.6-sol',
      modelProvider: 'hosted-openai',
      profile: 'scheduled-policy',
      provider: 'codex-cli',
      reasoningEffort: 'low',
      sandbox: 'read-only',
    })
    if (!backend) {
      throw new TypeError('Expected operator defaults target.')
    }

    const route = await resolveAssistantTurnRouteForMessage(
      createAutomationInput({ model: 'gpt-5.6-luna' }),
      {
        backend,
        identityId: null,
        selfDeliveryTargets: null,
      } as AssistantOperatorDefaults,
    )

    expect(route.codexCommand).toBe('/opt/murph-codex')
    expect(route.providerOptions).toMatchObject({
      approvalPolicy: 'never',
      model: 'gpt-6-luna',
      modelProvider: 'hosted-openai',
      profile: 'scheduled-policy',
      reasoningEffort: 'low',
      sandbox: 'read-only',
    })
  })
})

function createAutomationInput(
  assistantTargetOverride: NonNullable<
    AssistantRouteInput['assistantTargetOverride']
  >,
): AssistantRouteInput {
  return {
    assistantTargetOverride,
    prompt: 'Send the scheduled reminder.',
    turnTrigger: 'automation-cron',
    vault: '/vault',
  }
}

function requireTarget(model: string, reasoningEffort: string, modelProvider: string) {
  const target = createAssistantModelTarget({
    provider: 'codex-cli',
    model,
    modelProvider,
    reasoningEffort,
  })
  if (!target) throw new TypeError('Expected assistant target.')
  return target
}
