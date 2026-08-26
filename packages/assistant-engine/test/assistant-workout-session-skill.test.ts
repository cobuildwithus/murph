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
  subtitle: null,
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
      'A newly started session contains unlogged set coordinates',
    )
    expect(skill).toContain('vault-cli workout set log')
    expect(skill).toContain('vault-cli workout finish')
    expect(skill).toContain('Never use `workout format log` to start a live workout')
    expect(skill).toContain('A target is not a completed set')
    expect(skill).toContain('Commands inserted by an iMessage card use explicit one-based presentation coordinates')
    expect(skill).toContain('Only the normal Murph message path may mutate canonical workout state')
    expect(skill).toContain(
      'The candidate is causal identity, not write authority.',
    )
    expect(skill).toContain('Never choose a workout by recency.')
    expect(skill).toContain('Map presentation positions to canonical exercise and set `order` values')
    expect(skill).toContain('use exact exercise order or the exact canonical name')
    expect(skill).toContain('--require-existing-set')
    expect(skill).toContain('`workout` detail')
    expect(skill).toContain('Set the outer `subtitle` to `null`')
  })

  it('accepts the synthetic active workout card', () => {
    expect(assistantResponseCardSchema.parse(ACTIVE_WORKOUT_CARD)).toEqual(
      ACTIVE_WORKOUT_CARD,
    )
  })

  it('expands clear coordinated exercise modifiers before asking', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'tracked-table', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain(
      'expand each modifier into one distinct exercise by carrying the shared exercise head across the list',
    )
    expect(skill).toContain(
      'When one exact count clearly applies to every exercise in a coordinated list, apply it to each.',
    )
    expect(skill).toContain(
      'Ask one narrow question when the count conflicts, is not exact, or its allocation across multiple exercises is unclear.',
    )
    expect(skill).toContain(
      'Ask one narrow question only when the exercise identities remain genuinely ambiguous',
    )
    expect(skill).toContain(
      'immediately attach exactly one structured workout card from that verified snapshot and end with no companion prose',
    )
    expect(skill).toContain(
      'Never stop after the start command with a text-only acknowledgement',
    )
    expect(skill).toContain(
      'For a complete unambiguous new-workout request, run exactly one `vault-cli workout start`',
    )
    expect(skill).toContain(
      'A single total set count shared by multiple exercises without a per-exercise allocation is not complete or unambiguous.',
    )
    expect(skill).toContain(
      'Ask how many sets belong to each exercise and create nothing',
    )
    expect(skill).toContain(
      'never retry the start after a card or reply problem.',
    )
    expect(skill).toContain(
      'Never pass an inline exercise plan as `--routine`',
    )
    expect(skill).toContain(
      "For each returned exercise with `memberRepsPerSet`, copy `<n> reps` into every pending set's card target",
    )
    expect(skill).not.toContain('count conflicts, could apply to multiple exercises')
  })
})
