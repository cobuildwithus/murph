import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const LABS_GUIDANCE_HEADER = 'Lab test discovery:'

describe('assistant labs prompt guidance', () => {
  it('puts the read-only catalog policy behind the stable direct trigger only', async () => {
    const layers = buildAssistantSystemPromptLayers(createPromptInput({
      assistantHostedLabsAvailable: true,
      conversationScope: 'direct',
    }))

    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'lab-tests', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(layers.stableRouteCapabilityPrompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/lab-tests/SKILL.md')
    expect(layers.stableRouteCapabilityPrompt).toContain(LABS_GUIDANCE_HEADER)
    expect(skill).toContain(
      'cannot order, book, pay for, reserve, or start checkout',
    )
    expect(skill).toContain(
      'heart health, overall health, liver health or longevity',
    )
    expect(skill).toContain(
      'prefer the matching biomarker or narrow result',
    )
    expect(skill).toContain(
      'Keep each search to at most 5 results',
    )
    expect(skill).toContain(
      'the current catalog price',
    )
    expect(skill).toContain(
      'does not establish Murph ordering, member eligibility, appointment availability',
    )
    expect(skill).toContain(
      'ordering through Murph is planned for later',
    )
    expect(layers.stableRouteCapabilityPrompt).not.toMatch(/junction/iu)
    expect(layers.threadContextPrompt).not.toContain(LABS_GUIDANCE_HEADER)
    expect(layers.dynamicTurnContextPrompt).not.toContain(LABS_GUIDANCE_HEADER)
  })

  it('omits labs guidance when unavailable or outside a verified direct conversation', () => {
    for (const input of [
      createPromptInput({
        assistantHostedLabsAvailable: false,
        conversationScope: 'direct',
      }),
      createPromptInput({
        assistantHostedLabsAvailable: true,
        conversationScope: 'group',
      }),
      createPromptInput({
        assistantHostedLabsAvailable: true,
        conversationScope: 'unverified-external',
      }),
    ]) {
      const layers = buildAssistantSystemPromptLayers(input)
      expect(layers.prompt).not.toContain(LABS_GUIDANCE_HEADER)
    }
  })
})

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract.',
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: '2026-07-16',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    ...overrides,
  }
}
