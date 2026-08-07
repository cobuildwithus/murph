import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type {
  AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'
import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  VENICE_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

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
  resolveAutomationAssistantTargetOverrideForTarget,
} from '../src/assistant/automation/target-override.ts'
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
  it('filters a model-only preference against a custom-inference boundary target', async () => {
    assistantStore.resolveAssistantSession.mockRejectedValueOnce({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    })

    const route = await resolveAssistantTurnRouteForMessage(
      createAutomationInput({ model: 'gpt-5.6-luna' }),
      null,
      requireTarget(
        'glm-5.2',
        'low',
        HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
      ),
    )

    expect(route.providerOptions).toMatchObject({
      model: 'glm-5.2',
      modelProvider: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
      reasoningEffort: 'low',
    })
  })

  it('evaluates the preference after a fresh provider transition', async () => {
    assistantStore.resolveAssistantSession.mockRejectedValueOnce({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    })

    const route = await resolveAssistantTurnRouteForMessage(
      {
        ...createAutomationInput({ model: 'gpt-5.6-luna' }),
        model: 'gpt-5.6-sol',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'low',
      },
      null,
      requireTarget(
        'glm-5.2',
        'low',
        HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
      ),
    )

    expect(route.providerOptions).toMatchObject({
      model: 'gpt-5.6-luna',
      modelProvider: 'vercel-ai-gateway',
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
      modelProvider: 'vercel-ai-gateway',
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
      model: 'gpt-5.6-luna',
      modelProvider: 'vercel-ai-gateway',
      profile: 'scheduled-policy',
      reasoningEffort: 'high',
      sandbox: 'read-only',
    })
  })
})

describe('automation provider routing', () => {
  it('keeps canonical product models for Venice egress translation', () => {
    expect(
      resolveAutomationAssistantTargetOverrideForTarget(
        { model: 'gpt-5.6-luna' },
        requireTarget(
          'gpt-5.6-terra',
          'low',
          VENICE_CODEX_MODEL_PROVIDER_ID,
        ),
      ),
    ).toEqual({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
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

function requireTarget(
  model: string,
  reasoningEffort: string,
  modelProvider = 'vercel-ai-gateway',
): AssistantModelTarget {
  const target = createAssistantModelTarget({
    model,
    modelProvider,
    provider: 'codex-cli',
    reasoningEffort,
  })
  if (!target) {
    throw new TypeError(`Expected a target for ${model}.`)
  }
  return target
}
