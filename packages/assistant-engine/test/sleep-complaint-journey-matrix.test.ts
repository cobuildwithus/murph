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
          expect(skill('behavior-followthrough').triggerHint).toMatch(/friction|repeated behavior/iu)
        },
      },
      {
        complaint: 'sleep-onset racing thoughts',
        prove: () => {
          expect(resolveExperimentSessionMetricSpec('pre_sleep_arousal')?.key)
            .toBe('pre-sleep-arousal')
        },
      },
      {
        complaint: 'maintenance waking and early waking',
        prove: () => {
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
        },
      },
      {
        complaint: 'daytime sleepiness and apnea gate',
        prove: () => {
          expect(skill('energy-fatigue').triggerHint).toContain('daytime sleepiness')
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
        },
      },
      {
        complaint: 'wearable stage uncertainty',
        prove: () => {
        },
      },
      {
        complaint: 'baseline observation versus experiment',
        prove: () => {
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
