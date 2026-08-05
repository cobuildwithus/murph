import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardSchema,
  encodeCompactTableAppCardUrl,
  renderAssistantResponseCardText,
  renderAssistantResponseCardTranscriptText,
  type AssistantResponseCard,
} from '../src/assistant-response-cards.js'

const TRACKED_WORKOUT_CARD = {
  kind: 'compact_table',
  version: 1,
  title: 'Upper body A',
  subtitle: '45–55 min',
  rowHeader: 'Exercise',
  columns: ['Sets × reps', 'Rest', 'Effort'],
  rows: [
    {
      label: 'Bench press',
      values: ['3 × 6–8', '2–3 min', 'RPE 8'],
    },
    {
      label: 'One-arm row',
      values: ['3 × 8–10', '90 sec', '2 left'],
    },
  ],
  footer: 'Stop a set if pain rises or form breaks down.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
} satisfies AssistantResponseCard

function decodeAppCardUrl(url: string): unknown {
  const prefix = 'https://murph.ai/#murph-card='
  expect(url.startsWith(prefix)).toBe(true)
  return JSON.parse(
    Buffer.from(url.slice(prefix.length), 'base64url').toString('utf8'),
  )
}

describe('compact table response cards', () => {
  it('accepts one bounded table linked to a canonical workout', () => {
    expect(assistantResponseCardSchema.parse(TRACKED_WORKOUT_CARD)).toEqual(
      TRACKED_WORKOUT_CARD,
    )
  })

  it('rejects rows that do not match the declared columns', () => {
    expect(assistantResponseCardSchema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: [{ label: 'Bench press', values: ['3 × 6–8'] }],
    }).success).toBe(false)
  })

  it('rejects control characters, surrounding whitespace, and unbounded shapes', () => {
    expect(assistantResponseCardSchema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      title: 'Upper\nbody',
    }).success).toBe(false)
    expect(assistantResponseCardSchema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      title: ' Upper body A ',
    }).success).toBe(false)
    expect(assistantResponseCardSchema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      tracking: {
        ...TRACKED_WORKOUT_CARD.tracking,
        snapshotAt: ' 2026-08-04T21:30:00.000Z',
      },
    }).success).toBe(false)
    expect(assistantResponseCardSchema.safeParse({
      ...TRACKED_WORKOUT_CARD,
      rows: Array.from({ length: 9 }, (_, index) => ({
        label: `Exercise ${index + 1}`,
        values: ['3 × 8', '90 sec', 'RPE 8'],
      })),
    }).success).toBe(false)
  })

  it('keeps tracking authority out of the V3 presentation payload', () => {
    const url = encodeCompactTableAppCardUrl(TRACKED_WORKOUT_CARD)
    expect(url.length).toBeLessThan(2_048)
    const { tracking: _tracking, ...presentationCard } = TRACKED_WORKOUT_CARD
    expect(decodeAppCardUrl(url)).toEqual({
      schemaVersion: 3,
      card: presentationCard,
    })
  })

  it('keeps internal tracking out of the pipe-free user fallback', () => {
    const text = renderAssistantResponseCardText(TRACKED_WORKOUT_CARD)
    expect(text).toContain(
      'Bench press: Sets × reps: 3 × 6–8 · Rest: 2–3 min · Effort: RPE 8',
    )
    expect(text).not.toContain('evt_')
    expect(text).not.toContain('snapshot')
    expect(text).not.toContain('|')
  })

  it('retains the exact canonical source only in durable transcript text', () => {
    const text = renderAssistantResponseCardTranscriptText(TRACKED_WORKOUT_CARD)
    expect(text).toContain(
      '[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-04T21:30:00.000Z]',
    )
    expect(text).not.toContain('|')
  })
})
