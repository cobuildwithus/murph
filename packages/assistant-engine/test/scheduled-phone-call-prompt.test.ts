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
    expect(prompt).toContain('Private Linq/Telegram scheduled calls are supported')
    expect(prompt).toContain('Before calling or scheduling, read `$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md`')
    expect(prompt).not.toMatch(/(?:cannot|can’t|can not) schedule (?:a )?(?:phone|call)/iu)
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain('scheduled occurrences may place one call')
  })
})
