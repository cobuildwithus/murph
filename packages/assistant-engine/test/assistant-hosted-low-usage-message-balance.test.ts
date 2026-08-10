import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

describe('assistant hosted low-usage message-balance policy', () => {
  it('never converts remaining usage into messages left', async () => {
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'hosted-low-usage',
        'SKILL.md',
      ),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      'Never calculate, estimate, or state how many messages a person, Family member, or group has left.',
    )
    expect(normalizedSkill).toContain(
      'even when someone asks directly, supplies a percent-per-message observation',
    )
    expect(normalizedSkill).toContain(
      'Do not divide or extrapolate from remaining percentage, dollars, credit formulas, forecasts, model choice, or prior turns.',
    )
    expect(normalizedSkill).toContain(
      'Answer with only the authoritative fields allowed below: remaining percentage, an applicable monthly reset date, or days forecast.',
    )
    expect(normalizedSkill).toContain(
      'Starter usage has no expiry date.',
    )
    expect(normalizedSkill).toContain(
      'never reuse it to estimate the current balance',
    )
    expect(normalizedSkill).toContain(
      'Never say or imply "you have X messages left," give a range of messages left, or claim that each message uses a fixed percentage.',
    )
    expect(normalizedSkill).toContain(
      'An explicit request for a message count still does not authorize estimating one',
    )
    expect(normalizedSkill).not.toContain(
      'Use messages, tokens, credits, or usage only when someone explicitly asks',
    )
  })
})
