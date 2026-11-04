import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt, type AssistantSystemPromptInput } from '../src/assistant/system-prompt.js'

function prompt(overrides: Partial<AssistantSystemPromptInput> = {}): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null, assistantContextSnapshotPrompt: null,
    assistantProgressUpdatesAvailable: true,
    channel: 'linq', cliAccess: { rawCommand: 'vault-cli' },
    conversationScope: 'direct', currentLocalDate: '2030-01-10', currentTimeZone: 'UTC',
    hostedRuntime: true, modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false, ordinaryInboundTurn: true,
    ...overrides,
  })
}

describe('assistant progress prompt', () => {
  it.each([false, true])('starts a direct goal proposal with one first-round update while retaining routine silence (onboarding=%s)', (onboardingGuidance) => {
    const text = prompt({ onboardingGuidance })
    const setup = text.split('\n').find((line) => line.startsWith('- Setup:'))
    expect(setup).toContain('in the first tool round, alongside exactly one brief `murph.send_progress_update`')
    expect(setup).not.toContain('alone first')
    expect(text).toContain('Routine onboarding/setup needs no preamble for goal capture, context reads, device checks, a save, or the next question.')
    expect(text).toContain('Keep quick answers and one or two straightforward actions quiet.')
    expect(text).toContain('On acceptance, execute its persist section using the loaded instructions and completed research; do not restart setup.')
  })

  it('keeps group proposals under the sparse group progress rule', () => {
    const text = prompt({ conversationScope: 'group' })
    expect(text).toContain('For a new proposal, run `cat "$MURPH_ASSISTANT_SKILLS_ROOT/goal-setup/SKILL.md"` alone first; do not write yet.')
    expect(text).not.toContain('alongside exactly one brief `murph.send_progress_update`')
    expect(text).toContain('Skip group progress for challenge setup, the next setup question, permission offers, routine standings reads, and short tool sequences.')
  })

  it('preserves the visible-welcome first-reply fast path', () => {
    expect(prompt({ onboardingGuidance: true })).toContain('no commands, tool calls, memory writes, delegation, or progress update')
  })

  it('does not require an unavailable progress tool', () => {
    const text = prompt({ assistantProgressUpdatesAvailable: false })
    expect(text).not.toContain('murph.send_progress_update')
    expect(text).toContain('Member-visible interim progress is unavailable on this route. Continue the work and return only the final response.')
  })
})
