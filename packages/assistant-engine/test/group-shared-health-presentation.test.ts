import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION,
} from '../src/assistant/group-shared-freshness.js'

describe('group shared metric presentation prompt', () => {
  it('chooses one best-supported cross-source value by default', () => {
    const prompt = ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION

    expect(prompt).toContain('preserve source-tagged records as separate evidence')
    expect(prompt).toContain('do not persist a canonical value')
    expect(prompt).toContain('alter, sum, average, or silently merge source records')
    expect(prompt).toContain('does not require listing every device')
    expect(prompt).toContain('present one best-supported value by default')
    expect(prompt).toContain(
      'for steps and total sleep, prefer the larger plausible value',
    )
    expect(prompt).toContain(
      'Mention alternate values or the selected source only when',
    )
    expect(prompt).not.toMatch(/\b(?:Apple Health|Garmin|Oura|WHOOP)\b/u)
  })
})
