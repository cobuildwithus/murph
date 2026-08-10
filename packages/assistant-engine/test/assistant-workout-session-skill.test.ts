import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardSchema,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

const ACTIVE_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: '1 of 3 sets complete',
  rowHeader: 'Exercise',
  columns: ['Progress'],
  rows: [{ label: 'Bench press', values: ['1/3'] }],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [
      {
        name: 'Bench press',
        sets: [
          {
            status: 'completed',
            target: '185 lb × 8',
            actual: '185 lb × 8',
          },
          {
            status: 'pending',
            target: '185 lb × 8',
            actual: null,
          },
          {
            status: 'pending',
            target: null,
            actual: null,
          },
        ],
      },
    ],
  },
} satisfies AssistantResponseCard

describe('assistant live workout card skill', () => {
  it('keeps plan, actuals, and presentation under one canonical workflow', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('A saved workout format owns the plan')
    expect(skill).toContain('One canonical `activity_session` workout event owns what actually happened')
    expect(skill).toContain(
      'start every planned set as an unlogged placeholder',
    )
    expect(skill).toContain('vault-cli workout set log')
    expect(skill).toContain('vault-cli workout finish')
    expect(skill).toContain('Never use `workout format log` to start a live workout')
    expect(skill).toContain('A target is not a completed set')
    expect(skill).toContain('Commands inserted by the iMessage card use explicit one-based coordinates')
    expect(skill).toContain('Only the normal Murph message path may mutate canonical workout state')
    expect(skill).toContain('single unambiguous tracked workout card')
    expect(skill).toContain('choosing by recency alone')
    expect(skill).toContain('presentation positions, not canonical')
    expect(skill).toContain('exact displayed name and mapped order')
    expect(skill).toContain('--require-existing-set')
    expect(skill).toContain('`workout` detail')
  })

  it('accepts the synthetic active workout card', () => {
    expect(assistantResponseCardSchema.parse(ACTIVE_WORKOUT_CARD)).toEqual(
      ACTIVE_WORKOUT_CARD,
    )
  })
})
