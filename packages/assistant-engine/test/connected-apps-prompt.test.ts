import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

describe('connected-apps system-prompt coverage', () => {
  it('names the newer service and toolkit use cases in the stable prompt', () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput())

    expect(prompt).toContain('Google Maps')
    expect(prompt).toContain('NPPES')
    expect(prompt).toContain('NPI')
    expect(prompt).toContain('Amazon')
    expect(prompt).toContain('Walmart')
    expect(prompt).toContain('Instacart')
    expect(prompt).toContain('Google Drive')
    expect(prompt).toContain('OneDrive')
    expect(prompt).toContain('Dropbox')
    expect(prompt).toContain('Google Tasks')
    expect(prompt).toContain('Todoist')
    expect(prompt).toContain('Notion')
  })

  it('warns about OpenWeather location handling and unsupported claims', () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput())

    expect(prompt).toContain('not an exact address')
    expect(prompt).toContain(
      'Do not claim unsupported UV, air-quality, or official-alert data.',
    )
  })

  it('keeps Mapbox as the geocoding/routing layer when Google Maps is named', () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput())

    expect(prompt).toContain(
      "keep Mapbox as Murph's geocoding, distance, and routing layer",
    )
  })
})

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'local',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    ...overrides,
  }
}
