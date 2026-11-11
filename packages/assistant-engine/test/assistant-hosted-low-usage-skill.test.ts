import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

describe('assistant hosted low-usage skill', () => {
  // Prices and usage amounts reach the member only from tool results, so the
  // skill itself must never quote a dollar figure or the internal credit unit.
  it('quotes no dollar amount and no internal usage-credit unit', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'hosted-low-usage', 'SKILL.md'),
      'utf8',
    )

    expect(skill).not.toMatch(/\$|weighted usage credit/iu)
  })
})
