import { describe, expect, it } from 'vitest'

import {
  buildAssistantNotificationDecisionSystemPromptLayers,
  buildAssistantSystemPromptLayers,
  type AssistantNotificationDecisionSystemPromptInput,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

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
    expect(notificationLayers.stableRouteCapabilityPrompt).toContain(
      'Scheduled vault reads:',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).toContain(
      'Native shell, filesystem, subprocess, and CLI execution are unavailable',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).toContain(
      'Use only `murph.scheduled_read`',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).toContain(
      'purpose-specific typed Murph tools',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).not.toContain(
      'this privileged local route',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).not.toContain(
      'Python is available',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).not.toContain(
      'vault-cli batch',
    )
    expect(notificationLayers.stableRouteCapabilityPrompt).not.toContain(
      'Notification CLI contract.',
    )
    expect(notificationLayers.prompt).not.toContain(
      'Canonical task-owned reads and writes required by the automation',
    )
  })

  it('routes every scheduled group challenge through all three owning skills', () => {
    const layers = buildAssistantNotificationDecisionSystemPromptLayers({
      ...baseNotificationInput,
      assistantContextSnapshotPrompt: 'PRIVATE_CONTEXT_MUST_NOT_APPEAR',
      conversationScope: 'group',
    })

    expect(layers.prompt).toContain(
      'registered `group-chat`, `group-challenge`, and `groupchat-comedy` skills',
    )
    expect(layers.prompt).toContain(
      '`murph.scheduled_read` action `skill_get`',
    )
    expect(layers.prompt).toContain(
      'typed `group_health_update` receives all currently consented',
    )
    expect(layers.prompt).toContain(
      'Assistant personality preferences for this group room:',
    )
    expect(layers.prompt).toContain('Humor 8/10')
    expect(layers.prompt).toContain(
      'a scheduled challenge run is challenge lifecycle work, not generic notification copy',
    )
    expect(layers.prompt).toContain(
      'Do not flatten a skill-required medium into a generic text standings recap',
    )
    expect(layers.prompt).toContain(
      'Generated response media is delivered with `send_message`',
    )
    expect(layers.prompt).toContain(
      'For a group-challenge `send_message`, `privateSummary` is required',
    )
    expect(layers.prompt).toContain(
      'Keep it nonempty and within 50,000 characters; the parent validates that bound before queueing.',
    )
    expect(layers.prompt).toContain(
      'Never put refs, IDs, paths, or URLs in it.',
    )
    expect(layers.prompt).toContain(
      'only after terminal `sent` does the effect owner commit one `Delivered dispatch` section',
    )
    expect(layers.prompt).toContain(
      'it archives the challenge page, removes the exact pointer, then archives the exact automation revision',
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
    expect(layers.prompt).toContain('The only write surface is `murph.maintenance_memory`')
    expect(layers.prompt).toContain(
      'Native shell, filesystem, subprocess, and CLI execution are unavailable',
    )
    expect(layers.prompt).toContain(
      '`murph.scheduled_read` with `action: "memory_show"`',
    )
    expect(layers.prompt).not.toContain('vault-cli memory upsert')
    expect(layers.prompt).not.toContain('vault-cli memory update')
    expect(layers.prompt).not.toContain('Murph skill router:')
    expect(layers.prompt).not.toContain('Notification CLI contract.')
    expect(layers.prompt).not.toContain('Assistant personality preferences')
  })
})
