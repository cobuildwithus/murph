import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

describe('connected-apps skill and system-prompt coverage', () => {
  it('owns the approved service and toolkit use cases in the skill', async () => {
    const skill = await readConnectedAppsSkill()

    for (const expected of [
      'Google Maps',
      'NPPES',
      'NPI',
      'Amazon',
      'Walmart',
      'Instacart',
      'Google Drive',
      'OneDrive',
      'Dropbox',
      'Google Tasks',
      'Todoist',
      'Notion',
      'Microsoft Outlook',
      'Zoho Mail',
    ]) {
      expect(skill).toContain(expected)
    }
  })

  it('keeps OpenWeather city-level and separates outdoor from indoor air', async () => {
    const skill = await readConnectedAppsSkill()
    const normalizedSkill = skill.replace(/\s+/g, ' ')

    expect(normalizedSkill).toContain('never an unnecessary exact address')
    expect(normalizedSkill).toContain('current outdoor air quality')
    expect(normalizedSkill).toContain(
      "Outdoor air quality is not evidence about the member's indoor air.",
    )
    expect(normalizedSkill).toContain(
      'Do not claim unsupported UV or official-alert data.',
    )
  })

  it('keeps Mapbox as the geocoding and routing layer', async () => {
    const skill = await readConnectedAppsSkill()

    expect(skill).toContain(
      "Keep Mapbox\n  as Murph's geocoding, distance, and routing layer",
    )
  })

  it('lazy-loads the detailed direct contract while preserving group floors', async () => {
    const skill = await readConnectedAppsSkill()
    const directPrompt = buildAssistantSystemPrompt(createPromptInput({
      conversationScope: 'direct',
    }))
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput({
      conversationScope: 'group',
    }))

    for (const requiredContract of [
      'GOOGLECALENDAR_CREATE_EVENT',
      'OUTLOOK_CALENDAR_CREATE_EVENT',
      'agentApproved: true',
      'event_duration_hour',
      'event_duration_minutes',
      'end_datetime',
      'do not retry',
    ]) {
      expect(skill).toContain(requiredContract)
      expect(directPrompt).not.toContain(requiredContract)
      expect(groupPrompt).not.toContain(requiredContract)
    }

    expect(directPrompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/connected-apps/SKILL.md',
    )
    expect(directPrompt).toContain('private untrusted evidence')
    expect(groupPrompt).toContain('Use only accountless built-in service tools')
    expect(groupPrompt).toContain(
      'Never list, connect, rename, disconnect, search, read, write, or select',
    )
  })
})

async function readConnectedAppsSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'connected-apps', 'SKILL.md'),
    'utf8',
  )
}

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
