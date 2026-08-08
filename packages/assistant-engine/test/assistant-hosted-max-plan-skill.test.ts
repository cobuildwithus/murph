import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readLowUsageSkill(): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), 'hosted-low-usage', 'SKILL.md'),
    'utf8',
  )
}

describe('assistant Max plan guidance', () => {
  it('offers Max only from authoritative plan quotes and preserves explicit confirmation', async () => {
    const skill = (await readLowUsageSkill()).replace(/\s+/gu, ' ')

    expect(skill).toContain(
      'Do not turn an explicit Max quote into an automatic recommendation',
    )
    expect(skill).toContain(
      'Edge, or Max, call `murph.plan_usage` with that exact `targetPlanCode`',
    )
    expect(skill).toContain(
      'Max maps to `launch_max_monthly`',
    )
    expect(skill).toContain(
      'State only the quote\'s exact price and timing',
    )
    expect(skill).toContain(
      'Before `change_plan`, require a matching current quote, state its exact label, and get explicit confirmation',
    )
  })

  it('does not promise an unreleased model and gives Max the normal top-up fallback', async () => {
    const skill = (await readLowUsageSkill()).replace(/\s+/gu, ' ')

    expect(skill).toContain(
      'Never promise a particular unreleased model or imply that future access is already active',
    )
    expect(skill).toContain(
      '**Direct paid Max:** When `recommendedAction` is `add_usage`, say that the member can add usage',
    )
    expect(skill).toContain(
      '**Paid Max:** On an explicit request, use the authorized personal add-usage handoff or offer waiting for the reset',
    )
    expect(skill).toContain(
      'Max keeps access to Murph\'s current premium model and has no higher direct tier to invent',
    )
    expect(skill).not.toContain('priority access to new frontier models')
  })
})
