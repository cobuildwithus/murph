import { describe, expect, it } from 'vitest'

import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
} from '../src/assistant/managed-automations.js'

const weeklyHealthInsight = MURPH_MANAGED_AUTOMATIONS.find(
  (automation) =>
    automation.automationId === MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
)

describe('weekly health insight recovery readiness candidate', () => {
  it('verifies source freshness before interpreting a recovery decline', () => {
    expect(weeklyHealthInsight).toBeDefined()
    expect(weeklyHealthInsight?.instructions).toContain(
      'when `murph.device` is available call it with `action: list_accounts`',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      '`lastDate` covers the claimed window',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      '`stalenessVsNewestDays` or sync gaps do not explain the decline',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      'If source health or freshness cannot be proved, suppress the candidate.',
    )
  })

  it('requires corroboration and reuses the existing recovery skills', () => {
    expect(weeklyHealthInsight?.instructions).toContain(
      'A proprietary recovery/readiness score alone never clears the bar.',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/hrv-resting-heart-rate/SKILL.md',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/sleep-recovery-readiness/SKILL.md',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      'compose their guidance rather than inventing a new readiness score',
    )
  })

  it('bounds adjustments and preserves safety routing', () => {
    expect(weeklyHealthInsight?.instructions).toContain(
      'one reversible, low-burden adjustment with one guardrail and a reassessment trigger',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      'Never prescribe rest or a recovery block from a score alone.',
    )
    expect(weeklyHealthInsight?.instructions).toContain(
      'must follow the owning skill',
    )
    expect(weeklyHealthInsight?.schedule).toEqual({
      kind: 'cron',
      expression: '0 12 * * 0',
    })
  })
})
