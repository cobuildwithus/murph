import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import { MURPH_CREATE_PHONE_CALL_TOOL } from '../src/assistant-codex/dynamic-tools/phone-calls.js'

describe('scheduled phone-call prompt', () => {
  it.each(['automation-auto-reply', 'automation-cron'] as const)('composes call authority for %s', async (turnTrigger) => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null, assistantHostedAutomationAvailable: true,
      channel: 'linq', cliAccess: { rawCommand: 'vault-cli' },
      conversationScope: 'direct', currentLocalDate: '2030-04-01',
      currentTimeZone: 'America/New_York', hostedRuntime: true,
onboardingGuidance: false, turnTrigger,
    })
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'phone-calls', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(skill).toContain('A private Linq or Telegram automation can place one call at its exact scheduled')
    expect(prompt).toContain("Before calling or scheduling a call, or answering a call's status, read `$MURPH_ASSISTANT_SKILLS_ROOT/phone-calls/SKILL.md`")
    expect(prompt).not.toMatch(/(?:cannot|can’t|can not) schedule (?:a )?(?:phone|call)/iu)
    expect(MURPH_CREATE_PHONE_CALL_TOOL.description).toContain('scheduled occurrences may place one call')
  })
})
