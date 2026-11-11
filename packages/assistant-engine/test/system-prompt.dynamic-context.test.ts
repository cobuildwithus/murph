import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const baseConversationInput: AssistantSystemPromptInput = {
  assistantCliContract: null,
  assistantDynamicContextPrompts: [
    'Connected wearable sync status for this turn:\n- WHOOP currently needs reconnect.',
  ],
  channel: 'local',
  cliAccess: {
    rawCommand: 'vault-cli',
  },
  currentLocalDate: '2026-06-29',
  currentTimeZone: 'America/New_York',
  onboardingGuidance: false,
}

describe('assistant dynamic context prompt blocks', () => {
  it('keeps static late-result and policy resident while changing only current turn facts', () => {
    const ordinary = buildAssistantSystemPromptLayers({
      ...baseConversationInput, hostedRuntime: true, ordinaryInboundTurn: true,
    })
    const later = buildAssistantSystemPromptLayers({
      ...baseConversationInput, hostedRuntime: true, ordinaryInboundTurn: true,
      currentLocalDate: '2026-06-30',
      assistantDynamicContextPrompts: ['A new trusted result for this turn.'],
    })
    expect(later.stableRouteCapabilityPrompt).toBe(ordinary.stableRouteCapabilityPrompt)
    expect(later.dynamicTurnContextPrompt).toContain('A new trusted result for this turn.')
    const unavailable = buildAssistantSystemPromptLayers({
      ...baseConversationInput, hostedRuntime: true, ordinaryInboundTurn: true,
    })
    expect(unavailable.stableRouteCapabilityPrompt).toBe(ordinary.stableRouteCapabilityPrompt)
  })

  it('uses hosted direct current time without treating group time as personal', () => {
    const hostedDirectLayers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'direct',
      currentInstant: '2027-02-14T07:17:05.678Z',
      currentLocalDate: '2027-02-13',
      currentTimeZone: 'America/Los_Angeles',
      hostedRuntime: true,
    })
    const hostedGroupLayers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'group',
      currentInstant: '2027-02-14T07:17:05.678Z',
      currentLocalDate: '2027-02-13',
      currentTimeZone: 'America/Los_Angeles',
      hostedRuntime: true,
    })

    expect(hostedDirectLayers.dynamicTurnContextPrompt).toContain(
      '2027-02-13 23:17:05 [UTC 2027-02-14T07:17:05.678Z]',
    )
    expect(hostedGroupLayers.dynamicTurnContextPrompt).not.toContain(
      '2027-02-14T07:17:05.678Z',
    )
    expect(hostedGroupLayers.blocks.map((block) => block.id)).not.toContain('turn.current-time')
    expect(
      buildAssistantSystemPromptLayers({
        ...baseConversationInput,
        conversationScope: 'direct',
      }).blocks.map((block) => block.id),
    ).not.toContain('turn.current-time')
  })

  it('carries every billing settings link somewhere in the prompt and billing skills', async () => {
    const layers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'direct',
      hostedRuntime: true,
    })
    const skillsRoot = resolveAssistantSkillsRoot()
    const assembledBillingPrompt = [
      layers.stableRouteCapabilityPrompt,
      await readFile(path.join(skillsRoot, 'hosted-low-usage', 'SKILL.md'), 'utf8'),
      await readFile(path.join(skillsRoot, 'murph-family', 'SKILL.md'), 'utf8'),
    ].join('\n')

    // The web app honors these exact links; which file owns each is free to change.
    for (const link of [
      `${MURPH_PRODUCT_ORIGIN}/settings#subscription`,
      `${MURPH_PRODUCT_ORIGIN}/settings?addUsage=true#subscription`,
      `${MURPH_PRODUCT_ORIGIN}/settings?addUsage=family#family`,
    ]) {
      expect(assembledBillingPrompt).toContain(link)
    }
  })

  it('injects runtime dynamic context on conversation turns', () => {
    const layers = buildAssistantSystemPromptLayers(baseConversationInput)

    expect(layers.dynamicTurnContextPrompt).toContain(
      'Connected wearable sync status for this turn'
    )
  })

  it('injects runtime dynamic context into ordinary scheduled turns too', () => {
    const layers = buildAssistantSystemPromptLayers({
      assistantCliContract: null,
      assistantDynamicContextPrompts: [
        'Connected wearable sync status for this turn:\n- WHOOP currently needs reconnect.',
      ],
      channel: 'local',
      cliAccess: {
        rawCommand: 'vault-cli',
      },
      currentLocalDate: '2026-06-29',
      currentTimeZone: 'America/New_York',
      onboardingGuidance: false,
      scheduledOccurrenceAt: '2026-06-29T13:00:00.000Z',
      turnTrigger: 'automation-cron',
    })

    expect(layers.dynamicTurnContextPrompt).toContain(
      'Connected wearable sync status for this turn'
    )
  })
})
