import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantHostedAutomationAvailable: true,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedLabsAvailable: false,
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-08-10',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}

describe('assistant appointment reminder policy', () => {
  it('authorizes one verified private reminder for a confirmed appointment', () => {
    const prompt = buildAssistantSystemPromptLayers(
      createPromptInput(),
    ).stableRouteCapabilityPrompt

    expect(prompt).toContain('Appointment reminder default:')
    expect(prompt).toContain(
      'a booked or otherwise confirmed future care appointment',
    )
    expect(prompt).toContain(
      'explicit owning-tool authorization for exactly one private one-shot reminder',
    )
    expect(prompt).toContain(
      'without separate confirmation unless the user opts out',
    )
    expect(prompt).toContain('before noon local')
    expect(prompt).toContain(
      'the prior evening at a known pre-bed reminder time or 8:00 PM',
    )
    expect(prompt).toContain(
      'for noon or later, schedule 8:00 AM local that day',
    )
    expect(prompt).toContain(
      'Reuse one stable automation identity for repeated mentions',
    )
    expect(prompt).toContain(
      'patch it when a reschedule is confirmed and archive it when cancellation is confirmed',
    )
    expect(prompt).toContain(
      'follow the existing save-verification rules before claiming it is active',
    )
  })

  it('keeps the automatic reminder policy out of group and unavailable routes', () => {
    const groupPrompt = buildAssistantSystemPromptLayers(
      createPromptInput({ conversationScope: 'group' }),
    ).stableRouteCapabilityPrompt
    const unavailablePrompt = buildAssistantSystemPromptLayers(
      createPromptInput({ assistantHostedAutomationAvailable: false }),
    ).stableRouteCapabilityPrompt

    expect(groupPrompt).not.toContain('Appointment reminder default:')
    expect(unavailablePrompt).not.toContain('Appointment reminder default:')
    expect(unavailablePrompt).toContain(
      'Scheduled automation changes are unavailable in this turn.',
    )
  })
})
