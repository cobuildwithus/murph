import { describe, expect, it } from 'vitest'

import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphOnboardingFollowupSchedule,
} from '../src/assistant/onboarding-followup-automation.ts'

describe('onboarding follow-up automation', () => {
  it('spreads members deterministically across the configured local window', () => {
    const schedules = Array.from({ length: 64 }, (_, index) =>
      resolveMurphOnboardingFollowupSchedule(`member-${index}`),
    )
    const localTimes = schedules.map((schedule) => {
      if (schedule.kind !== 'dailyLocal') {
        throw new Error('Expected a daily-local onboarding schedule template.')
      }
      return schedule.localTime
    })

    expect(resolveMurphOnboardingFollowupSchedule('member-7')).toEqual(
      resolveMurphOnboardingFollowupSchedule(' member-7 '),
    )
    expect(new Set(localTimes).size).toBeGreaterThan(1)
    expect(localTimes.every((localTime) =>
      localTime >= '13:30' && localTime <= '14:29'
    )).toBe(true)
  })

  it('requires a stable member key', () => {
    expect(() => resolveMurphOnboardingFollowupSchedule('   ')).toThrow(
      'requires a stable key',
    )
  })

  it('defines a single reply-oriented final attempt', () => {
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary).toContain('One finite')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('This one-shot is consumed whether you send or skip.')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('send at most one')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('exactly one easy, reply-oriented question')
  })
})
