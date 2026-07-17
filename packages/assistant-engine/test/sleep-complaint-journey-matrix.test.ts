import {
  buildAutomationSupportSeriesTag,
  getHabitatAspectDefinition,
  parseAutomationSupportSeriesTag,
} from '@murphai/contracts'
import {
  resolveExperimentSessionMetricSpec,
  validateExperimentSessionMetricValue,
} from '@murphai/query'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  type AssistantSkillSlug,
} from '../src/assistant-skill-assets.ts'

function skill(slug: AssistantSkillSlug) {
  const entry = ASSISTANT_SKILLS.find((candidate) => candidate.slug === slug)
  if (!entry) {
    throw new Error(`Missing assistant skill ${slug}.`)
  }
  return entry
}

describe('sleep complaint journey matrix', () => {
  it('keeps ten distinct complaint families attached to an executable owner surface', () => {
    const journeys = [
      {
        complaint: 'getting-to-bed friction',
        prove: () => {
          expect(skill('sleep-improvement').triggerHint).toMatch(/wind-down|bedtime/iu)
          expect(skill('behavior-followthrough').triggerHint).toMatch(/friction|repeated behavior/iu)
        },
      },
      {
        complaint: 'sleep-onset racing thoughts',
        prove: () => {
          expect(skill('sleep-improvement').triggerHint).toContain('sleep onset')
          expect(skill('stress-regulation').triggerHint).toMatch(/trouble winding down/iu)
          expect(resolveExperimentSessionMetricSpec('pre_sleep_arousal')?.key)
            .toBe('pre-sleep-arousal')
        },
      },
      {
        complaint: 'maintenance waking and early waking',
        prove: () => {
          expect(skill('sleep-improvement').triggerHint).toContain('night awakenings')
          expect(resolveExperimentSessionMetricSpec('wake_after_sleep_onset_minutes'))
            .toMatchObject({
              biomarkerKey: 'biomarker:wake-after-sleep-onset',
              canonicalUnit: 'minutes',
            })
        },
      },
      {
        complaint: 'circadian drift',
        prove: () => {
          expect(skill('circadian-rhythm').triggerHint).toContain(
            'delayed or advanced sleep schedule',
          )
          expect(skill('circadian-rhythm').triggerHint).toContain('sleep schedule regularity')
        },
      },
      {
        complaint: 'daytime sleepiness and apnea gate',
        prove: () => {
          expect(skill('energy-fatigue').triggerHint).toContain('daytime sleepiness')
          expect(skill('sleep-improvement').triggerHint).toMatch(
            /snoring, gasping, unrefreshing sleep, or dangerous daytime sleepiness/iu,
          )
          expect(validateExperimentSessionMetricValue({
            fieldId: 'daytime_sleepiness',
            value: 11,
          })).toEqual({
            success: false,
            message: 'daytime_sleepiness must be between 0 and 10 score.',
          })
        },
      },
      {
        complaint: 'environmental disruption',
        prove: () => {
          const sleepEnvironment = getHabitatAspectDefinition('sleep-environment')
          expect(sleepEnvironment?.indicators.map((indicator) => indicator.id))
            .toEqual(expect.arrayContaining([
              'night_temp_c',
              'darkness',
              'night_noise',
              'noise_countermeasures',
            ]))
        },
      },
      {
        complaint: 'supplement and medication stack safety',
        prove: () => {
          expect(skill('micronutrients-supplements').triggerHint).toMatch(
            /magnesium|interactions/iu,
          )
          expect(skill('substance-load').triggerHint).toMatch(
            /caffeine|alcohol|cannabis/iu,
          )
        },
      },
      {
        complaint: 'wearable stage uncertainty',
        prove: () => {
          expect(skill('sleep-improvement').triggerHint).toContain(
            'wearable sleep stage or sleep score interpretation',
          )
          expect(skill('hrv-resting-heart-rate').triggerHint).toContain('wearable noise versus signal')
        },
      },
      {
        complaint: 'baseline observation versus experiment',
        prove: () => {
          expect(skill('self-management-experiments').triggerHint).toContain(
            'low-burden personalized experiments',
          )
          expect(skill('experiment-onboarding').triggerHint).toContain(
            'bounded health experiments',
          )
        },
      },
      {
        complaint: 'bounded follow-through and closeout',
        prove: () => {
          const tag = buildAutomationSupportSeriesTag(
            'experiment-lifecycle:exp_sleep_journey',
          )
          expect(parseAutomationSupportSeriesTag(tag)).toEqual({
            seriesId: 'experiment-lifecycle:exp_sleep_journey',
            tag,
          })
          expect(skill('behavior-followthrough').triggerHint).toMatch(
            /reviewing a repeated behavior|recurring support/iu,
          )
        },
      },
    ] as const

    expect(journeys.map((journey) => journey.complaint)).toHaveLength(10)
    expect(new Set(journeys.map((journey) => journey.complaint)).size).toBe(10)
    for (const journey of journeys) {
      journey.prove()
    }
  })
})
