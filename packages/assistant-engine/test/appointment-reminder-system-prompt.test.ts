import { describe, expect, it } from 'vitest'

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
      setupCommand: 'murph',
    },
    conversationScope,
    currentLocalDate: '2026-08-10',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  }
}

describe('appointment reminder system prompt', () => {
  it('proactively creates one well-timed reminder for a confirmed private appointment', () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput('direct'))

    expect(prompt).toContain('Private appointment follow-through:')
    expect(prompt).toContain('during an ordinary attended turn')
    expect(prompt).toContain('concrete future appointment')
    expect(prompt).toContain('one one-shot reminder')
    expect(prompt).toContain('do not wait for a separate reminder request')
    expect(prompt).toContain('never knowingly create a duplicate')
    expect(prompt).toContain('For a start before 10:00 AM')
    expect(prompt).toContain('otherwise 8:00 PM')
    expect(prompt).toContain('For a start at 10:00 AM or later')
    expect(prompt).toContain('8:00 AM that day')
    expect(prompt).toContain('never create a past or after-start occurrence')
    expect(prompt).toContain(
      'hypothetical, tentative, canceled, completed, or date/time-unknown appointment',
    )
    expect(prompt).toContain('only after its save and timing are verified')
  })

  it('does not attach personal appointment reminder policy to a group room', () => {
    const prompt = buildAssistantSystemPrompt(createPromptInput('group'))

    expect(prompt).not.toContain('Private appointment follow-through:')
    expect(prompt).not.toContain('one one-shot reminder')
  })
})
