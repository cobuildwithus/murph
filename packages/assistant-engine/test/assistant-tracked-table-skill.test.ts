import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardSchema,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const FOUR_SET_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Live strength session',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
  rows: [
    {
      label: 'Exercise A',
      values: ['12', '10 (final rep spotted)', '9', '8 (final 2 reps spotted)'],
    },
    {
      label: 'Exercise B',
      values: ['40 × 8', '45 × 8', '45 × 7', '45 × 6 (final rep spotted)'],
    },
  ],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
} satisfies AssistantResponseCard

const AD_HOC_EXERCISE_NAMES = [
  'Bench press',
  'Incline bench press',
  'Push-up',
  'Dip',
] as const

const AD_HOC_TARGETLESS_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Upper body workout',
  subtitle: null,
  footer: 'Reply with the exercise, set, and result.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-11T18:14:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: AD_HOC_EXERCISE_NAMES.map((name) => ({
      name,
      sets: [{ status: 'pending' as const, target: null, actual: null }],
    })),
  },
} satisfies AssistantResponseCard

const AD_HOC_COMPLETED_TARGETLESS_WORKOUT_CARD = {
  ...AD_HOC_TARGETLESS_WORKOUT_CARD,
  workout: {
    version: 1,
    state: 'completed',
    exercises: AD_HOC_EXERCISE_NAMES.map((name) => ({
      name,
      sets: [{ status: 'skipped' as const, target: null, actual: null }],
    })),
  },
} satisfies AssistantResponseCard

describe('assistant tracked workout table skill', () => {
  it('registers direct table and live-workout language with the skill router', () => {
    const matches = ASSISTANT_SKILLS.filter(
      ({ slug }) => slug === 'tracked-table',
    )

    expect(matches).toHaveLength(1)
    expect(matches[0]?.triggerHint).toContain('workout table')
    expect(matches[0]?.triggerHint).toContain('structured tracker')
    expect(matches[0]?.triggerHint).toContain('live workout log')
    expect(matches[0]?.triggerHint).toContain('start or resume a live workout')
    expect(matches[0]?.triggerHint).toContain('updated/refreshed table')
  })

  it('routes strength workout table requests to the native tracked-table skill', async () => {
    const strengthSkill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'strength-training', 'SKILL.md'),
      'utf8',
    )

    expect(strengthSkill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/tracked-table/SKILL.md',
    )
    expect(strengthSkill).toContain('put a workout log in a table')
    expect(strengthSkill).toContain('start or resume a canonical live workout')
    expect(strengthSkill).toContain('instead of Markdown table syntax')
  })

  it('uses targeted canonical commands for live workout mutations', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('vault-cli workout start')
    expect(skill).toContain('vault-cli workout active')
    expect(skill).toContain('vault-cli workout exercise add')
    expect(skill).toContain('vault-cli workout set log')
    expect(skill).toContain('vault-cli workout set clear')
    expect(skill).toContain('vault-cli workout finish')
    expect(skill).toContain(
      'Do not reconstruct and replace the complete nested exercise/set array',
    )
    expect(skill).toContain('pass `--workout-id`')
    expect(skill).toContain(
      'pass `--workout-id` on every live-workout mutation',
    )
    expect(skill).toContain('one explicit exercise selector, and `--set-order`')
    expect(skill).toContain('correct the same set rather than append a duplicate')
    expect(skill).toContain('Saved target values remain in the workout format')
    expect(skill).toContain('preserve every distinct exercise the member named')
    expect(skill).toContain('including closely related variations')
    expect(skill).toContain(
      'one unlogged targetless placeholder as the next log slot',
    )
    expect(skill).toContain('not as a claimed plan or completed set')
    expect(skill).toContain(
      'every canonical event set with no matching format set',
    )
    expect(skill).toContain(
      '`pending` while the workout is live and the slot is empty',
    )
    expect(skill).toContain(
      '`skipped` after the workout ends and the slot remains empty',
    )
    expect(skill).toContain('not evidence of a planned set')
    expect(skill).toContain('vault-cli workout format show')
    expect(skill).toContain(
      'Never copy planned targets into actual set fields',
    )
    expect(skill).toContain(
      'refuses a structured replacement that omits a saved exercise or set',
    )
    expect(skill).toContain('Use `--clear-workout` only')
    expect(skill).toContain('remove the entire record')
    expect(skill).toContain('Finish only when the member explicitly says they are done')
    expect(skill).toContain('already-completed return is convergence')
    expect(skill).not.toContain('Complete workout exercise')
    expect(skill).toContain('Never infer weight, repetitions, effort, assistance')
    expect(skill).toContain(
      'After every verified private workout mutation that changes the snapshot',
    )
    expect(skill).toContain(
      'ordinary set log, correction, clear, exercise addition, start, resume, or finish',
    )
    expect(skill).toContain(
      'Do not send a text-only acknowledgement or companion prose.',
    )
    expect(skill).toContain(
      'After every verified ordinary free-form set log, correction, clear, or exercise addition',
    )
    expect(skill).toContain(
      'When a request does not materially change canonical workout state',
    )
    expect(skill).not.toContain(
      'Do not send a fresh table card after every ordinary set update.',
    )
    expect(skill).not.toContain(
      'For ordinary free-form logging, prefer concise text',
    )
    expect(skill).toContain(
      'use one verified structured workout card as the complete response on a supported private card route',
    )
    expect(skill).toContain(
      'Do not send a text-only start acknowledgement or wait for a separate card request.',
    )
    expect(skill).toContain('the canonical event cannot be verified')
    expect(skill).toContain(
      'any claimed planned targets cannot be verified from their matching format',
    )
    expect(skill).toContain(
      'the bounded card contract cannot represent the workout',
    )
  })

  it('keeps set annotations canonical and preserves a fourth set', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toMatch(/^---\nname: tracked-table\n/)
    expect(skill).toContain('one to four compact value columns')
    expect(skill).toContain('Never emit Markdown-table syntax')
    expect(skill).toContain("that exact set's canonical `note`")
    expect(skill).toContain('note=final rep spotted')
    expect(skill).toContain('Do not collapse or discard the fourth set')
    expect(skill).toContain('do not silently truncate it')
    expect(skill).toContain(
      'single active tracked workout whose table was explicitly established earlier',
    )
    expect(skill).toContain(
      'With no active tracked table, do not invent one from an update-like message',
    )
    expect(skill).toContain('ask one narrow disambiguating question')
    expect(skill).toContain('final 2 reps spotted')
    expect(skill).toContain(
      'Never leave meaningful notation only in conversation text',
    )
  })

  it('accepts a synthetic four-set tracked card', () => {
    expect(assistantResponseCardSchema.parse(FOUR_SET_CARD)).toEqual(
      FOUR_SET_CARD,
    )
  })

  it('accepts distinct ad-hoc exercises with targetless active and finished slots', () => {
    expect(
      assistantResponseCardSchema.parse(AD_HOC_TARGETLESS_WORKOUT_CARD),
    ).toEqual(AD_HOC_TARGETLESS_WORKOUT_CARD)
    expect(
      assistantResponseCardSchema.parse(
        AD_HOC_COMPLETED_TARGETLESS_WORKOUT_CARD,
      ),
    ).toEqual(AD_HOC_COMPLETED_TARGETLESS_WORKOUT_CARD)
  })
})
