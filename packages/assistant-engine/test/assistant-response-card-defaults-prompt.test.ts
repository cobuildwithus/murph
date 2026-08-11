import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function createPromptInput(
  conversationScope: 'direct' | 'group',
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope,
    currentLocalDate: '2026-08-11',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
  }
}

describe('assistant response-card defaults', () => {
  it('defaults eligible private cards without exposing private-card guidance to groups', () => {
    const directPrompt = buildAssistantSystemPrompt(createPromptInput('direct'))
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput('group'))

    expect(directPrompt).toContain(
      'Private cards: if its skill and tool allow it, attach now without another ask.',
    )
    expect(directPrompt).toContain('No prose; routine logs stay concise.')
    expect((directPrompt.match(/Private cards:/gu) ?? [])).toHaveLength(1)
    expect(groupPrompt).not.toContain('Private cards:')
  })
})
