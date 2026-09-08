import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
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
  it('keeps one resident reminder policy without conflicting skill defaults', async () => {
    const prompt = buildAssistantSystemPromptLayers(
      createPromptInput(),
    ).stableRouteCapabilityPrompt
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'appointment-scheduling',
        'SKILL.md',
      ),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(prompt).toContain(
      'a reminder alone does not require loading the appointment skill',
    )
    expect(normalizedSkill).toContain(
      'a booked or otherwise confirmed future care appointment',
    )
    expect(normalizedSkill).toContain(
      'explicit owning-tool authorization for exactly one private one-shot reminder',
    )
    expect(normalizedSkill).toContain(
      'without separate confirmation unless the user opts out',
    )
    expect(normalizedSkill).toContain(
      'Appointment timing defaults apply only when the member supplied neither an exact clock time nor a broad time window',
    )
    expect(normalizedSkill).toContain(
      'never replace an exact member time with an appointment default',
    )
    expect(normalizedSkill).toContain("developer prompt's **Private appointment follow-through** policy")
    expect(normalizedSkill).toContain('Never guess a missing appointment date or start time')
    expect(normalizedSkill).toContain('Reuse the existing reminder when conversation or tool evidence identifies it')
    expect(normalizedSkill).toContain('never invent a stable recipe key')
    expect(prompt).toContain('For a start before 10:00 AM')
    expect(prompt).toContain('For a start at 10:00 AM or later')
    expect(prompt).toContain('latest still-useful future time')
    for (const conflict of ['before noon', 'noon or later', 'earliest useful future time', 'If only the date is known']) {
      expect(`${prompt} ${normalizedSkill}`).not.toContain(conflict)
    }
    expect(normalizedSkill).toContain(
      'Patch it when a reschedule is confirmed and archive it when cancellation is confirmed',
    )
    expect(normalizedSkill).toContain(
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

    expect(groupPrompt).not.toContain(
      'For a confirmed future care appointment in private',
    )
    expect(unavailablePrompt).not.toContain(
      'For a confirmed future care appointment in private',
    )
    expect(unavailablePrompt).toContain(
      'Scheduled automation changes are unavailable in this turn.',
    )
  })
})
