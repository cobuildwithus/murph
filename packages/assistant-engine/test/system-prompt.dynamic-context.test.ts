import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const baseConversationInput: AssistantSystemPromptInput = {
  assistantCliContract: null,
  assistantContextSnapshotPrompt: 'Context snapshot block.',
  assistantDynamicContextPrompts: [
    'Connected wearable sync status for this turn:\n- WHOOP currently needs reconnect.',
  ],
  channel: 'local',
  cliAccess: {
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  },
  currentLocalDate: '2026-06-29',
  currentTimeZone: 'America/New_York',
  modelBehaviorProfile: 'gpt5-agentic',
  onboardingGuidance: false,
}

describe('assistant dynamic context prompt blocks', () => {
  it('injects runtime dynamic context before the context snapshot on conversation turns', () => {
    const layers = buildAssistantSystemPromptLayers(baseConversationInput)

    expect(layers.dynamicTurnContextPrompt).toContain(
      'Connected wearable sync status for this turn'
    )
    expect(layers.dynamicTurnContextPrompt.indexOf(
      'Connected wearable sync status for this turn'
    )).toBeLessThan(
      layers.dynamicTurnContextPrompt.indexOf('Context snapshot block.')
    )
  })

  it('injects runtime dynamic context into ordinary scheduled turns too', () => {
    const layers = buildAssistantSystemPromptLayers({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: 'Context snapshot block.',
      assistantDynamicContextPrompts: [
        'Connected wearable sync status for this turn:\n- WHOOP currently needs reconnect.',
      ],
      channel: 'local',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-06-29',
      currentTimeZone: 'America/New_York',
      modelBehaviorProfile: 'gpt5-agentic',
      onboardingGuidance: false,
      turnTrigger: 'automation-cron',
    })

    expect(layers.dynamicTurnContextPrompt).toContain(
      'Connected wearable sync status for this turn'
    )
    expect(layers.dynamicTurnContextPrompt.indexOf(
      'Connected wearable sync status for this turn'
    )).toBeLessThan(
      layers.dynamicTurnContextPrompt.indexOf('Context snapshot block.')
    )
  })
})
