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
  it('defaults every verified private meal and live-workout update to its eligible card', () => {
    const directPrompt = buildAssistantSystemPrompt(createPromptInput('direct'))
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput('group'))

    expect(directPrompt).toContain(
      'Private cards: verified meal/live-workout updates use the allowed card; meal totals need no goals and meal intent never sets targets.',
    )
    expect(directPrompt).toContain('Routine meal capture and daily nutrition summaries are one short workflow, even with several skill/context reads, a save, readback and totals check. Do not send a progress update for those steps or before the card.')
    expect(directPrompt).toContain('The first suitable totals-only card includes the fixed optional-goals introduction; later cards and prior declines omit it.')
    expect(directPrompt).not.toContain('routine logs stay concise')
    expect((directPrompt.match(/Private cards:/gu) ?? [])).toHaveLength(1)
    expect(groupPrompt).not.toContain('Private cards:')
  })
})
