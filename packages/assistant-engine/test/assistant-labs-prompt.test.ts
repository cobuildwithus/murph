import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const LABS_GUIDANCE_HEADER = 'Lab test discovery:'

describe('assistant labs prompt guidance', () => {
  it('puts the read-only catalog policy in the stable direct layer only', () => {
    const layers = buildAssistantSystemPromptLayers(createPromptInput({
      assistantHostedLabsAvailable: true,
      conversationScope: 'direct',
    }))

    expect(layers.stableRouteCapabilityPrompt).toContain(LABS_GUIDANCE_HEADER)
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'cannot order, book, pay for, reserve, or start checkout',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'heart health, overall health, liver health, or longevity',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'prefer the matching biomarker or narrow result',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'Keep each search to at most 5 results',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'the current catalog price',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'does not establish Murph ordering, member eligibility, appointment availability',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'ordering through Murph is planned for later',
    )
    expect(layers.stableRouteCapabilityPrompt).not.toMatch(/junction/iu)
    expect(layers.threadContextPrompt).not.toContain(LABS_GUIDANCE_HEADER)
    expect(layers.dynamicTurnContextPrompt).not.toContain(LABS_GUIDANCE_HEADER)
  })

  it('omits labs guidance when unavailable or outside a verified direct conversation', () => {
    for (const input of [
      createPromptInput({
        assistantHostedLabsAvailable: false,
        conversationScope: 'direct',
      }),
      createPromptInput({
        assistantHostedLabsAvailable: true,
        conversationScope: 'group',
      }),
      createPromptInput({
        assistantHostedLabsAvailable: true,
        conversationScope: 'unverified-external',
      }),
    ]) {
      const layers = buildAssistantSystemPromptLayers(input)
      expect(layers.prompt).not.toContain(LABS_GUIDANCE_HEADER)
    }
  })
})

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract.',
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-07-16',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}
