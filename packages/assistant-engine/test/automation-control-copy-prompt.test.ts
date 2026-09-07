import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'
import {
  ASSISTANT_CRON_RECURRING_REMINDER_CADENCE_INSTRUCTIONS,
} from '../src/assistant/cron/recurring-reminder-conversation.js'

function buildPrompt(
  conversationScope: 'direct' | 'group',
  turnTrigger: AssistantSystemPromptInput['turnTrigger'],
): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedAutomationAvailable: true,
    channel: 'linq',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    conversationScope,
    currentLocalDate: '2026-08-05',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    scheduledOccurrenceAt: turnTrigger === 'automation-cron' ? '2026-08-05T13:00:00.000Z' : null,
    turnTrigger,
  })
}

describe('automation control copy', () => {
  it.each(['direct', 'group'] as const)('keeps control notes operational in scheduled %s copy', (scope) => {
    const prompt = buildPrompt(scope, 'automation-cron')
    expect(prompt).toContain('Saved notes about changing, pausing, or stopping an automation are operating instructions, not routine message copy.')
    expect(prompt).toContain('A statement that the recipient can adjust or pause updates does not request that sentence in the message.')
    expect(prompt).toContain('Do not echo or paraphrase those statements in a routine notification.')
    expect(prompt).toContain('Include control wording only when the task explicitly asks to include that wording, a requested review needs a decision, or the current engine-supplied cadence policy calls for a question.')
    expect(prompt).toContain('Preserve concrete stop conditions.')
    expect(prompt).not.toContain('Otherwise send the current concise cue and ask one natural question')
    const withCadence = [prompt, ASSISTANT_CRON_RECURRING_REMINDER_CADENCE_INSTRUCTIONS].join('\n\n')
    expect(withCadence).toContain('If no relevant human reply followed and that output already asked whether to keep, change, or pause these interruptions, return `skip`.')
    expect(withCadence).toContain('If a relevant human reply followed that output, use it when composing the current reminder; do not ask another cadence question or apply the silence-based skips below.')
    expect(withCadence).toContain('If no relevant human reply followed and no exception or skip condition above applies, send the current concise cue and ask one natural question')
    expect(withCadence).not.toContain('Otherwise send the current concise cue and ask one natural question')
  })

  it.each(['direct', 'group'] as const)('keeps generic control boilerplate out of %s authoring', (scope) => {
    const prompt = buildPrompt(scope, null)
    expect(prompt).toContain('Save the task and its concrete execution or stop conditions; do not add generic change/pause offers to stored instructions unless the user explicitly requests that repeated copy.')
    expect(prompt).toContain('Explain available controls during setup when useful.')
    expect(prompt).not.toContain('Saved notes about changing, pausing, or stopping an automation are operating instructions')
  })
})
