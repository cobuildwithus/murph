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

  it('uses targeted canonical commands for live workout mutations', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('vault-cli workout start')
    expect(skill).toContain('vault-cli workout active')
    expect(skill).toContain('vault-cli workout exercise add')
    expect(skill).toContain('[--sets <n>]')
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
    expect(skill).toContain(
      'The sole carry-forward exception is one exact repetition count the member explicitly applied to every set of one exercise',
    )
    expect(skill).toContain(
      'while the same workout is active and its establishing message remains available in the current direct conversation',
    )
    expect(skill).toContain(
      'pass only `--reps` with that count instead of asking again or writing a note-only completion',
    )
    expect(skill).toContain(
      'Do not carry forward weight, duration, distance, RPE, bodyweight, assistance, added weight, or any other actual field',
    )
    expect(skill).toContain(
      'A repetition count stated with the completion overrides the earlier count',
    )
    expect(skill).toContain(
      'range, AMRAP or qualitative instruction, conflicts with another count',
    )
    expect(skill).toContain(
      'Never treat a saved-plan target, prior workout, card target, or assistant-authored suggestion as this repetition prescription',
    )
    expect(skill).not.toContain('pass the prescribed actual field')
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
    expect(skill).toContain('member explicitly or unmistakably closes that session')
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
      "The card tool's validation of the actual encoded envelope is authoritative",
    )
    expect(skill).toContain(
      'Never ask the member to delete, merge, or simplify canonical workout data merely to fit the presentation',
    )
    expect(skill).toContain(
      "the complete card is rejected by the card tool's actual encoded-envelope validation",
    )
    expect(skill).toContain(
      'Do not preempt that validation from an estimated exercise or set count',
    )
  })

  it('keeps bare acknowledgements from advancing or inventing a workout set', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain(
      'A bare acknowledgement such as “ok,” “yes,” or “got it” is not a set completion',
    )
    expect(skill).toContain(
      'never advance to another set from that acknowledgement',
    )
    expect(skill).toContain(
      'Keep the last set coordinate the member explicitly identified',
    )
    expect(skill).toContain(
      'Do not start a workout to reconcile a prior assistant claim or confirmation',
    )
    expect(skill).toContain(
      'do not claim that any set was saved',
    )
    expect(skill).not.toContain('or clearly began a workout')
    expect(skill).toContain(
      'the member accepts the exact bounded recovery offer below',
    )
    expect(skill).toContain(
      'create only enough pending set coordinates through the named set',
    )
    expect(skill).toContain(
      'the same response must then ask one bounded recovery question',
    )
    expect(skill).toContain(
      'Do not stop after the no-active statement',
    )
    expect(skill).toContain(
      'A contextual affirmative answer to that exact offer authorizes only the proposed start and exact set write',
    )
    expect(skill).toContain(
      'If an active workout now exists, do not retarget the accepted recovery',
    )
  })

  it('uses generic reminder references with the ordinary workout lifecycle', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('## Scheduled reminder relationship context')
    expect(skill).toContain('host-preserved `automationId`')
    expect(skill).toContain('exact `contextReferences`')
    expect(skill).toContain('routing and interpretation context only')
    expect(skill).toContain('do not require native iMessage Reply')
    expect(skill).toContain('next ordinary direct message after the reminder')
    expect(skill).toContain('one exact `workout_format` reference')
    expect(skill).toContain('successful current `vault-cli workout format show <lookup> --format json` read or format-creation result')
    expect(skill).toContain('If current evidence does not identify exactly one format, save no reference')
    expect(skill).toContain('vault-cli workout format show <exact_format_id> --format json')
    expect(skill).toContain('vault-cli workout active --format json')
    expect(skill).toContain('the exact inspected reminder reference authorizes starting only that routine')
    expect(skill).toContain('the reminder identifies the new set but does not establish when the earlier workout ended')
    expect(skill).toContain('Never derive an end from active `durationMinutes`')
    expect(skill).toContain("the earlier workout's exact end time or exact total duration")
    expect(skill).toContain('make no workout mutation')
    expect(skill).toContain('the new set was not saved yet')
    expect(skill).toContain("ask one narrow question for the earlier workout's end time or total duration")
    expect(skill).toContain('Make that question text-bearing even when voice is preferred')
    expect(skill).toContain('`Routine reference: <exact_format_id>`')
    expect(skill).toContain(
      '`Active workout reference: <exact_active_workout_id>`',
    )
    expect(skill).toContain('committed transcript replay preserves the complete proposal')
    expect(skill).toContain('Only the immediate answer to that question may continue it')
    expect(skill).toContain('exact-read the recorded format id')
    expect(skill).toContain(
      'vault-cli workout active --workout-id <exact_active_workout_id> --format json',
    )
    expect(skill).toContain('separately read the sole active workout before acting')
    expect(skill).toContain(
      'that exact event remains active and is still the sole active workout',
    )
    expect(skill).toContain('fails closed without mutation')
    expect(skill).toContain('unrelated later message fails closed')
    expect(skill).toContain('Missing or conflicting references')
    expect(skill).toContain('multiple active workouts')
    expect(skill).toContain('Explicit historical intent remains explicit targeting')
    expect(skill).toContain('existing exact-id path')
    expect(skill).toContain('one current message contains both a set result and unmistakable session-closure intent')
    expect(skill).toContain('“Last set, 45 × 6; I’m done.”')
    expect(skill).toContain('finish the same workout in the same turn')
    expect(skill).toContain('no separate finish message is needed')
    expect(skill).toContain('Filling every planned placeholder without independent closure language does not finish the workout')
    expect(skill).toContain('targetless extra sets')
    expect(skill).not.toContain('filled the final unlogged placeholder across the workout')
    expect(skill).not.toContain('startedAt` plus stored elapsed `durationMinutes`')
    expect(skill).not.toContain('exact recorded end time')
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
