import { describe, expect, it } from 'vitest'
import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'

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
        'before answering an explicit hosted plan, included-usage, billing, Family-member usage, or group-funding request',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'explicit-request or first-heads-up route as applicable',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'single final usage-segment contract only for an assistant-initiated heads-up',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '`---` delimiter only when the channel reply-style guidance supports bubbles',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'Do not send a separate warning or repeat one already visible',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '`murph.plan_usage` is read-only and changes neither billing, Family state, nor usage credit',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        `provide \`${MURPH_PRODUCT_ORIGIN}/settings#subscription\` only after \`status\` is \`active\` or \`exhausted\`, or \`reason\` is \`trial_conversion_pending\``,
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'never provide it for `group_not_supported` or `hosted_access_inactive`',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '`continue_pulse` is eligible only for a current active trial and keeps it scheduled to become Pulse at trial end without charging now',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'conversion-pending or ended trials require the quoted `start_pulse_now` path and exact confirmation',
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
