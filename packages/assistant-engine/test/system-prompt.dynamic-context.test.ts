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
  it.each(['direct', 'group'] as const)(
    'adds the conversational low-usage rule for hosted %s chats',
    (conversationScope) => {
      const layers = buildAssistantSystemPromptLayers({
        ...baseConversationInput,
        conversationScope,
        hostedRuntime: true,
      })

      expect(layers.stableRouteCapabilityPrompt).toContain('Low hosted usage:')
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'complete the user\'s current request first',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'For an ordinary trusted low-usage heads-up',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        "follow that skill's single final usage-segment contract",
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '`---` delimiter only when the channel reply-style guidance supports bubbles',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'segment and delimiter contract does not apply to the image-capacity-denial branch',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'Do not send a separate warning or repeat one already visible',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '`status: insufficient_image_capacity`, `reason: would_exhaust`, and `image_started: false`',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'Do not infer this state, retry the image, or claim the whole plan is low or exhausted',
      )
    },
  )

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
      scheduledOccurrenceAt: '2026-06-29T13:00:00.000Z',
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
