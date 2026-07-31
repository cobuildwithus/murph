import { describe, expect, it } from 'vitest'

import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
  resolveMurphOnboardingFollowupActiveUntil,
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

  it('reserves at least 30 minutes after the latest jitter slot', () => {
    expect(resolveMurphOnboardingFollowupActiveUntil({
      scheduledAt: '2026-04-09T17:47:00.000Z',
      timeZone: 'America/New_York',
    })).toBe('2026-04-09T19:00:00.000Z')
    expect(resolveMurphOnboardingFollowupActiveUntil({
      scheduledAt: '2026-11-01T19:29:00.000Z',
      timeZone: 'America/New_York',
    })).toBe('2026-11-01T20:00:00.000Z')
  })

  it('defines a single reply-oriented final attempt', () => {
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary).toContain('One finite')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('This one-shot is consumed whether you send or skip.')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('send at most one')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('exactly one easy, reply-oriented question')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('must never run the onboarding completion command')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('Only a later foreground user reply may advance or complete onboarding.')
    expect(MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions)
      .toContain('finite next-day recovery rule')
  })
})
