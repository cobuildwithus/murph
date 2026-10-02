import { describe, expect, it } from 'vitest'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import { MURPH_CREATE_PHONE_CALL_TOOL } from '../src/assistant-codex/dynamic-tools/phone-calls.js'

describe('scheduled phone-call prompt', () => {
  it.each(['automation-auto-reply', 'automation-cron'] as const)('composes call authority for %s', (turnTrigger) => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null, assistantHostedAutomationAvailable: true,
      channel: 'linq', cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
      conversationScope: 'direct', currentLocalDate: '2030-04-01',
      currentTimeZone: 'America/New_York', hostedRuntime: true,
      modelBehaviorProfile: 'gpt5-agentic', onboardingGuidance: false, turnTrigger,
    })
    expect(prompt).toContain('phone-call reminder is supported')
    expect(prompt).toContain('phone-formatted `Sender` on the accepted private Linq input')
    expect(prompt).toContain('use `murph.create_phone_call` once')
    expect(prompt).toContain('without asking again')
    expect(prompt).toContain('Scheduled group and email turns cannot place calls')
    expect(prompt).not.toMatch(/(?:cannot|can’t|can not) schedule (?:a )?(?:phone|call)/iu)
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain('scheduled occurrences may place one call')
  })
})
