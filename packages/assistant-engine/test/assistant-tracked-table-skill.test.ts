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
    expect(matches[0]?.triggerHint).toContain(
      'continues a live-workout exchange with a short follow-up',
    )
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
    expect(strengthSkill).toContain(
      'continues one with a short follow-up',
    )
    expect(strengthSkill).toContain('instead of Markdown table syntax')
  })

  it('uses exact-record commands and durable exercise-owned repetitions', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('vault-cli workout start')
    expect(skill).toContain('vault-cli workout show <evt_id> --format json')
    expect(skill).toContain('vault-cli workout exercise add')
    expect(skill).toContain('[--sets <n>]')
    expect(skill).toContain('vault-cli workout exercise set-reps')
    expect(skill).toContain('vault-cli workout set log')
    expect(skill).toContain('vault-cli workout set clear')
    expect(skill).toContain('vault-cli workout finish --workout-id <evt_id>')
    expect(skill).not.toContain('vault-cli workout active')
    expect(skill).toContain(
      'There is no global active or focused workout selector. Never choose a workout by recency.',
    )
    expect(skill).toContain(
      'Pass `--workout-id`, one explicit exercise selector, and `--set-order` on every set mutation.',
    )
    expect(skill).toContain(
      'immediately persist that smallest exercise-owned fact with `workout exercise set-reps`',
    )
    expect(skill).toContain(
      'The fact survives provider-thread loss and bounded transcript replay because it belongs to the workout exercise, not assistant memory.',
    )
    expect(skill).toContain(
      "copies the stored member fact into that completed set's actual `reps` field",
    )
    expect(skill).toContain(
      "The stored fact fills only an unlogged coordinate; a note, load, or other correction on an already logged set preserves that set's explicit repetitions unless the member supplies a new repetition result.",
    )
    expect(skill).toContain(
      'never derived from a saved-plan target, prior workout, card target, assistant suggestion, range, AMRAP, or qualitative instruction',
    )
    expect(skill).toContain(
      'Never carry forward weight, duration, distance, RPE, bodyweight, assistance, added weight, or any other actual field.',
    )
    expect(skill).toContain(
      'Logging the last pending set of an explicitly finite workout closes that exact workout in the same canonical write.',
    )
    expect(skill).toContain(
      'The accepted set completion time is the observed end boundary',
    )
    expect(skill).toContain(
      'A later explicit extra set remains valid when it names that completed workout and exact exercise/set',
    )
    expect(skill).toContain(
      'Complete all workout mutations requested by the current member message in order',
    )
    expect(skill).toContain(
      'attach exactly one refreshed structured workout card from the final verified exact snapshot',
    )
    expect(skill).toContain(
      'A final write that closes a finite workout remains card-eligible as that just-finished workout.',
    )
    expect(skill).toContain(
      'Starting a new workout is independent of every older unfinished workout',
    )
    expect(skill).toContain(
      'Presentation order never proves exercise identity.',
    )
    expect(skill).toContain('Saved target values remain in the workout format')
    expect(skill).toContain('no planned target value is copied into an actual set field')
    expect(skill).toContain(
      'Do not reconstruct and replace the complete nested exercise/set array',
    )
    expect(skill).toContain(
      'refuses a structured replacement that omits, ambiguously matches, or semantically replaces a saved exercise',
    )
    expect(skill).toContain(
      'After completing all ordinary free-form workout mutations requested by the current message',
    )
    expect(skill).toContain(
      'use one verified structured workout card as the complete response on a supported private card route',
    )
  })

  it('keeps bare acknowledgements from advancing or inventing a workout set', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain(
      'A bare acknowledgement such as “ok,” “yes,” or “got it” is not a set completion.',
    )
    expect(skill).toContain('Keep the last exact coordinate the member identified.')
    expect(skill).toContain('Never advance to another set from an acknowledgement.')
    expect(skill).toContain(
      'When the exact workout id or set coordinate is genuinely unavailable, ask which workout, exercise, or set the member means.',
    )
    expect(skill).toContain(
      'Do not block unrelated new work, demand closure metadata for another workout, or create a workout merely to make an earlier assistant claim appear true.',
    )
    expect(skill).toContain(
      'An isolated completion with no exact causal workout identity does not authorize choosing an unfinished workout or inventing one.',
    )
    expect(skill).not.toContain('bounded recovery offer')
    expect(skill).not.toContain('No active live workout was found')
  })

  it('uses reminder references without reviving a workout singleton', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('## Scheduled reminder relationship context')
    expect(skill).toContain('host-preserved `automationId`')
    expect(skill).toContain('exact `contextReferences`')
    expect(skill).toContain('not read or write authority')
    expect(skill).toContain('native iMessage Reply is not required')
    expect(skill).toContain('An exact `workout_format` reference')
    expect(skill).toContain(
      'successful current `vault-cli workout format show <lookup> --format json` read or format-creation result',
    )
    expect(skill).toContain(
      'Run `workout start --routine <exact_format_id>`, preserve the returned workout id, and apply only the stated set to that new exact record.',
    )
    expect(skill).toContain(
      'An older unfinished workout neither blocks this start nor needs to be closed first.',
    )
    expect(skill).toContain(
      "The reminder does not establish any older workout's end time",
    )
    expect(skill).toContain(
      'When immediate causal context instead names an existing exact workout id, exact-read it with `vault-cli workout show <evt_id> --format json` and mutate only that record.',
    )
    expect(skill).toContain(
      'If the message and relationship context do not identify one exact workout and coordinate, ask which one is intended.',
    )
    expect(skill).toContain(
      'a completed exact workout may still accept a clearly requested extra set',
    )
    expect(skill).toContain('Explicit historical intent remains explicit targeting.')
    expect(skill).not.toContain('sole active workout')
    expect(skill).not.toContain('multiple active workouts')
    expect(skill).not.toContain('ask one narrow question for the earlier workout')
    expect(skill).toContain(
      'The canonical set-log owner closes an explicitly finite workout when the accepted write completes its final pending planned set.',
    )
    expect(skill).toContain(
      'Do not require independent “I am done” language',
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
      'durable tracking marker or immediate causal context identifies one exact workout',
    )
    expect(skill).toContain(
      'do not choose a workout by recency or invent one from an update-like message',
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
