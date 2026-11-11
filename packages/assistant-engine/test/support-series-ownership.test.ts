import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { readWorkflowSkillPolicy } from './support/workflow-skill-policy.js'

async function readSkill(slug: string): Promise<string> {
  if (slug === 'behavior-followthrough' || slug === 'experiment-onboarding') return readWorkflowSkillPolicy(slug)
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

// Support automations are reconciled by series id. Each owning skill must name
// its own id format, because the runtime matches on that prefix.
describe('support series ownership', () => {
  it.each([
    ['micronutrients-supplements', 'supplement'],
    ['behavior-followthrough', 'habit'],
    ['experiment-onboarding', 'experiment'],
  ])('%s names its support series id format', async (slug, prefix) => {
    // The prefix is the contract; how the placeholder after it is spelled is not.
    expect(await readSkill(slug)).toMatch(new RegExp(`supportSeriesId: "${prefix}:<[A-Za-z-]+>"`, 'u'))
  })
})
