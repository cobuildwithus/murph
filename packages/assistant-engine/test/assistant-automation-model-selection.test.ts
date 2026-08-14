import { describe, expect, it } from 'vitest'

import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.ts'
import {
  resolveAutomationAssistantTargetOverrideForTarget,
} from '../src/assistant/automation/target-override.ts'

const AUTOMATION_SCHEDULE = {
  kind: 'dailyLocal',
  localTime: '09:00',
} as const

function readSaveRequest(assistantTargetOverride?: unknown) {
  return readAutomationDynamicToolRequest({
    arguments: {
      action: 'save',
      ...(assistantTargetOverride === undefined
        ? {}
        : { assistantTargetOverride }),
      instructions: 'Send one concise burpee reminder.',
      schedule: AUTOMATION_SCHEDULE,
      title: 'Burpee reminder',
    },
    tool: 'automation',
  })
}

function readPatchRequest(assistantTargetOverride?: unknown) {
  return readAutomationDynamicToolRequest({
    arguments: {
      action: 'patch',
      expectedUpdatedAt: '2031-02-14T12:00:00.000Z',
      ...(assistantTargetOverride === undefined
        ? { title: 'Updated burpee reminder' }
        : { assistantTargetOverride }),
      lookup: 'burpee-reminder',
    },
    tool: 'automation',
  })
}

describe('hosted automation model selection', () => {
  it.each([
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol',
  ] as const)(
    'persists the declarative %s preference without freezing derived reasoning',
    (model) => {
      const parsed = readSaveRequest({ model })
      expect(parsed).toMatchObject({
        kind: 'automation',
        request: {
          action: 'save',
          assistantTargetOverride: {
            model,
          },
        },
      })
      if (
        parsed?.kind !== 'automation' ||
        parsed.request.action !== 'save'
      ) {
        throw new TypeError('Expected a valid automation save request.')
      }
      expect(parsed.request.assistantTargetOverride).not.toHaveProperty(
        'reasoningEffort',
      )
    },
  )

  it('preserves explicit reasoning and supports reasoning-only overrides', () => {
    expect(
      readSaveRequest({
        model: 'gpt-5.6-luna',
        reasoningEffort: 'medium',
      }),
    ).toMatchObject({
      kind: 'automation',
      request: {
        assistantTargetOverride: {
          model: 'gpt-5.6-luna',
          reasoningEffort: 'medium',
        },
      },
    })

    expect(
      readSaveRequest({
        reasoningEffort: 'high',
      }),
    ).toMatchObject({
      kind: 'automation',
      request: {
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
      },
    })
  })

  it('inherits the conversation target when no override is supplied', () => {
    const parsed = readSaveRequest()
    expect(parsed).toMatchObject({
      kind: 'automation',
      request: {
        action: 'save',
      },
    })
    if (
      parsed?.kind !== 'automation' ||
      parsed.request.action !== 'save'
    ) {
      throw new TypeError('Expected a valid automation save request.')
    }
    expect(parsed.request).not.toHaveProperty('assistantTargetOverride')
  })

  it('preserves an omitted patch override and accepts a complete replacement', () => {
    const preserved = readPatchRequest()
    expect(preserved).toMatchObject({
      kind: 'automation',
      request: {
        action: 'patch',
        lookup: 'burpee-reminder',
        title: 'Updated burpee reminder',
      },
    })
    if (
      preserved?.kind !== 'automation' ||
      preserved.request.action !== 'patch'
    ) {
      throw new TypeError('Expected a valid automation patch request.')
    }
    expect(preserved.request).not.toHaveProperty('assistantTargetOverride')

    const replaced = readPatchRequest({
      model: 'gpt-5.6-terra',
    })
    expect(replaced).toMatchObject({
      kind: 'automation',
      request: {
        action: 'patch',
        assistantTargetOverride: {
          model: 'gpt-5.6-terra',
        },
        lookup: 'burpee-reminder',
      },
    })
    if (
      replaced?.kind !== 'automation' ||
      replaced.request.action !== 'patch'
    ) {
      throw new TypeError('Expected a valid automation patch request.')
    }
    expect(replaced.request.assistantTargetOverride).not.toHaveProperty(
      'reasoningEffort',
    )
  })

  it('allows a patch to clear the stored turn override', () => {
    expect(readPatchRequest(null)).toMatchObject({
      kind: 'automation',
      request: {
        action: 'patch',
        assistantTargetOverride: null,
        lookup: 'burpee-reminder',
      },
    })
  })

  it('filters unsupported explicit-provider policy without a base target', () => {
    expect(
      resolveAutomationAssistantTargetOverrideForTarget(
        {
          model: 'glm-5.3',
          modelProvider: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
          reasoningEffort: 'high',
        },
        null,
      ),
    ).toEqual({
      model: 'glm-5.3',
      modelProvider: HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
    })
  })

  it.each([
    { model: 'gpt-5.6-luna', modelProvider: 'venice' },
    { model: 'not-a-product-model' },
    { model: 'gpt-5.6-luna', reasoningEffort: 'ultra' },
    {},
  ])('rejects unsupported hosted target override %j', (assistantTargetOverride) => {
    expect(readSaveRequest(assistantTargetOverride)).toMatchObject({
      kind: 'invalid-automation-arguments',
    })
  })
})
