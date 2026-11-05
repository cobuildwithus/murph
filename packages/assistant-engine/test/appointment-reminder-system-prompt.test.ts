import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function createPromptInput(
  conversationScope: AssistantSystemPromptInput['conversationScope'],
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    conversationScope,
    currentLocalDate: '2026-08-10',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    turnTrigger: null,
  }
}

describe('appointment reminder system prompt', () => {
  it('proactively creates one well-timed reminder for a confirmed private appointment', async () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput('direct'))
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'reminders', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/reminders/SKILL.md')

    expect(prompt).toContain('Private appointment follow-through:')
    expect(prompt).toContain('during an ordinary attended turn')
    expect(prompt).toContain('concrete future appointment')
    expect(prompt).toContain('exactly one one-shot reminder')
    expect(prompt).toContain('unless the member declines it')
    expect(prompt).toContain('do not wait for a separate reminder request')
    expect(skill).toContain('never knowingly create a duplicate')
    expect(skill).toContain(
      'member-specified reminder time overrides these defaults',
    )
    expect(skill).toContain('For a start before 10:00 AM')
    expect(skill).toContain('otherwise 8:00 PM')
    expect(skill).toContain('For a start at 10:00 AM or later')
    expect(skill).toContain('8:00 AM that day')
    expect(skill).toContain('never create a past or after-start occurrence')
    expect(skill).toContain(
      'hypothetical, tentative, canceled, completed, or date-or-time-unknown appointment',
    )
    expect(skill).toContain(
      'archive it or patch its timing',
    )
    expect(prompt).toContain('only after its save and timing are verified')
  })

  it('does not attach personal appointment reminder policy to a group room', () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput('group'))

    expect(prompt).not.toContain('Private appointment follow-through:')
    expect(prompt).not.toContain('exactly one one-shot reminder')
  })

  it('does not attach personal appointment reminder policy to an unverified external audience', () => {
    const prompt = buildAssistantSystemPrompt(
      createPromptInput('unverified-external'),
    )

    expect(prompt).not.toContain('Private appointment follow-through:')
    expect(prompt).not.toContain('exactly one one-shot reminder')
  })
})
