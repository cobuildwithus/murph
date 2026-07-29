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
    currentLocalDate: '2026-07-29',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}

describe('assistant reminder density policy', () => {
  it('keeps dense reply-loop rules in private automation guidance only', () => {
    const directLayers = buildAssistantSystemPromptLayers(createPromptInput())
    const groupLayers = buildAssistantSystemPromptLayers(
      createPromptInput({ conversationScope: 'group' }),
    )

    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'prefer one useful interruption over several',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'offer to combine them before saving',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'combine the immediately preceding unresolved action with the current cue in one message',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'never accumulate older occurrences as debt',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'return `skip` after that combined grace check-in also receives no related reply',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'Never tell the user to respond with status keywords',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'accept any natural reply that resolves or changes the loop',
    )
    expect(directLayers.stableRouteCapabilityPrompt).toContain(
      'continuityPolicy: preserve',
    )
    expect(groupLayers.stableRouteCapabilityPrompt).not.toContain(
      'prefer one useful interruption over several',
    )
  })

  it('documents one-occurrence carry-forward without reminder debt', async () => {
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'behavior-followthrough',
        'SKILL.md',
      ),
      'utf8',
    )
    const compactSkill = skill.replace(/\s+/g, ' ')

    expect(skill).toContain('### Reminder density and reply loop')
    expect(compactSkill).toContain(
      'include the current action in the same message',
    )
    expect(compactSkill).toContain(
      'return `skip`. Do not send a separate pause warning.',
    )
    expect(compactSkill).toContain(
      'only the immediately preceding occurrence needs a closed action window',
    )
    expect(compactSkill).toContain(
      'Carry forward at most the immediately preceding occurrence.',
    )
    expect(compactSkill).toContain(
      'Never prescribe keywords, status syntax, or a menu of canned replies.',
    )
    expect(compactSkill).toContain(
      'lead with one short, ordinary question',
    )
    expect(compactSkill).toContain(
      'may use any natural wording that answers',
    )
    expect(compactSkill).toContain(
      'Ask about the last round in normal language',
    )
    expect(compactSkill).toContain(
      'unrelated conversation does not keep it alive',
    )
    expect(compactSkill).not.toContain(
      'a short status such as done, skip, later, or stop',
    )
  })
})
