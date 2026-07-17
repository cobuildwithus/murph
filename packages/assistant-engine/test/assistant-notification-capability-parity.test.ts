import { describe, expect, it } from 'vitest'

import {
  buildAssistantNotificationDecisionSystemPromptLayers,
  buildAssistantSystemPromptLayers,
  type AssistantNotificationDecisionSystemPromptInput,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'
import { buildAssistantSkillFileRef } from '../src/assistant-skill-assets.js'

const baseNotificationInput: AssistantNotificationDecisionSystemPromptInput = {
  assistantCliContract: 'Notification CLI contract.',
  assistantContextSnapshotPrompt: 'Context snapshot block.',
  assistantDynamicContextPrompts: ['Dynamic context block.'],
  assistantHostedAutomationAvailable: false,
  assistantHostedDeviceConnectAvailable: true,
  assistantHostedDeviceConnectProviders: [
    { label: 'Oura', provider: 'oura' },
  ],
  assistantHostedLabsAvailable: false,
  assistantKnowledgeToolsAvailable: true,
  assistantPersonality: {
    detail: 7,
    humor: 8,
    push: 4,
  },
  assistantStyleSettingsAvailable: false,
  assistantTone: 'casual',
  channel: 'linq',
  cliAccess: {
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  },
  currentLocalDate: '2026-07-17',
  currentTimeZone: 'America/New_York',
  conversationScope: 'direct',
  hostedRuntime: true,
  modelBehaviorProfile: 'gpt5-agentic',
  murphProductBaseUrl: 'https://withmurph.ai',
  scheduledOccurrenceAt: '2026-07-17T13:00:00.000Z',
}

describe('assistant scheduled-turn capability parity', () => {
  it('reuses the interactive capability and thread-context layers by construction', () => {
    const notificationLayers =
      buildAssistantNotificationDecisionSystemPromptLayers(baseNotificationInput)
    const interactiveInput: AssistantSystemPromptInput = {
      ...baseNotificationInput,
      onboardingGuidance: false,
      turnTrigger: 'automation-cron',
    }
    const interactiveLayers = buildAssistantSystemPromptLayers(interactiveInput)

    expect(notificationLayers.staticCacheableCorePrompt).toBe(
      interactiveLayers.staticCacheableCorePrompt,
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).toBe(
      interactiveLayers.stableRouteCapabilityPrompt,
    )
    expect(notificationLayers.threadContextPrompt).toBe(
      interactiveLayers.threadContextPrompt,
    )
    expect(notificationLayers.dynamicTurnContextPrompt).toContain(
      interactiveLayers.dynamicTurnContextPrompt,
    )
    expect(notificationLayers.dynamicTurnContextPrompt).toContain(
      'Scheduled occurrence context:',
    )
    expect(notificationLayers.dynamicTurnContextPrompt).toContain(
      'Notification execution rules:',
    )
  })

  it('routes every scheduled group challenge through all three owning skills', () => {
    const layers = buildAssistantNotificationDecisionSystemPromptLayers({
      ...baseNotificationInput,
      assistantContextSnapshotPrompt: 'PRIVATE_CONTEXT_MUST_NOT_APPEAR',
      conversationScope: 'group',
    })

    expect(layers.prompt).toContain(buildAssistantSkillFileRef('group-chat'))
    expect(layers.prompt).toContain(buildAssistantSkillFileRef('group-challenge'))
    expect(layers.prompt).toContain(buildAssistantSkillFileRef('groupchat-comedy'))
    expect(layers.prompt).toContain(
      'Assistant personality preferences for this group room:',
    )
    expect(layers.prompt).toContain('Humor 8/10')
    expect(layers.prompt).toContain(
      'a scheduled challenge run is challenge lifecycle work, not generic notification copy',
    )
    expect(layers.prompt).toContain(
      'Do not flatten a skill-required comic, voice memo, song, or image into a generic text standings recap',
    )
    expect(layers.prompt).toContain(
      'Generated response media is delivered with `send_message`',
    )
    expect(layers.prompt).not.toContain('PRIVATE_CONTEXT_MUST_NOT_APPEAR')
  })

  it('keeps exact maintenance turns outside the shared capability kernel', () => {
    const layers = buildAssistantNotificationDecisionSystemPromptLayers({
      ...baseNotificationInput,
      maintenanceTurn: true,
    })

    expect(layers.stableRouteCapabilityPrompt).toBe('')
    expect(layers.threadContextPrompt).toBe('')
    expect(layers.prompt).toContain('Maintenance execution rules:')
    expect(layers.prompt).not.toContain('Murph skill router:')
    expect(layers.prompt).not.toContain('Notification CLI contract.')
    expect(layers.prompt).not.toContain('Assistant personality preferences')
  })
})
