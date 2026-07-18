import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

describe('proactive onboarding support', () => {
  it('makes the first reminder-and-review package proactive but bounded', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedAutomationAvailable: true,
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
      channel: 'linq',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-07-17',
      currentTimeZone: 'America/New_York',
      hostedRuntime: true,
      onboardingGuidance: true,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
    })

    expect(prompt).toContain('do not wait for them to ask for reminders')
    expect(prompt).toContain(
      'put the exact finite reminder-and-review package inside the launch offer',
    )
    expect(prompt).toContain(
      'treat a clear yes as authorization for those named plan and support writes',
    )
    expect(prompt).toContain(
      'only an explicit opt-out, a one-time action, or a real delivery or safety blocker may leave it without reminders',
    )
    expect(prompt).toContain('Formal tone is not a quiet-support preference.')
  })

  it('requires schedule resolution, same-turn support writes, and a warm close', async () => {
    const skillsRoot = resolveAssistantSkillsRoot()
    const [behaviorRaw, onboardingRaw] = await Promise.all([
      readFile(
        path.join(skillsRoot, 'behavior-followthrough', 'SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(skillsRoot, 'murph-onboarding', 'SKILL.md'),
        'utf8',
      ),
    ])
    const behavior = behaviorRaw.replace(/\s+/gu, ' ')
    const onboarding = onboardingRaw.replace(/\s+/gu, ' ')

    expect(behavior).toContain('"Any day you have time" is unresolved.')
    expect(behavior).toContain(
      'proactive support is the default launch shape, not an optional menu after the plan',
    )
    expect(behavior).toContain(
      'one actionable reminder for each planned occurrence in the initial support window',
    )
    expect(behavior).toContain(
      'A clear yes to that offer authorizes the named plan, reminder, and review writes together.',
    )
    expect(behavior).toContain('mandatory launch close')
    expect(behavior).toContain(
      'name the exact next scheduled touchpoint and what useful help will arrive',
    )
    expect(behavior).toContain(
      'end with one broad invitation to work on anything else Murph can help with',
    )
    expect(behavior).toContain(
      'Formal or quiet style may rule out a song; it never rules out the text celebration.',
    )

    expect(onboarding).toContain(
      'perform the canonical plan and exact reminder/review writes named in the launch offer in the same turn',
    )
    expect(onboarding).toContain(
      'Do not leave reminder setup for the user to request later and do not ask for a second confirmation.',
    )
    expect(onboarding).toContain(
      'Formal tone may rule out a song; it never rules out the text celebration.',
    )
    expect(onboarding).toContain(
      'the named support writes succeeded or an explicit opt-out or real blocker is recorded',
    )
  })
})
