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
  it('routes confirmed private appointments to the scheduling policy', async () => {
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
      'For a confirmed future care appointment in private, follow `$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md`.',
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
    expect(normalizedSkill).toContain('before noon local')
    expect(normalizedSkill).toContain(
      'the prior evening at a known pre-bed reminder time or 8:00 PM',
    )
    expect(normalizedSkill).toContain(
      'For noon or later, schedule 8:00 AM local that day',
    )
    expect(normalizedSkill).toContain(
      'Reuse one stable automation identity for repeated mentions',
    )
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
