import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardSchema,
  encodeCompactTableAppCardUrl,
  buildLinqIMessageAppCardImageUrl,
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

const APP_CARD_URL_PREFIX = 'https://www.withmurph.ai/#murph-card='

function encodeEnvelopeUrl(card: unknown): string {
  return `${APP_CARD_URL_PREFIX}${Buffer.from(
    JSON.stringify({ schemaVersion: 3, card }),
    'utf8',
  ).toString('base64url')}`
}

function decodeAppCardUrl(url: string): unknown {
  expect(url.startsWith(APP_CARD_URL_PREFIX)).toBe(true)
  return JSON.parse(
    Buffer.from(url.slice(APP_CARD_URL_PREFIX.length), 'base64url').toString('utf8'),
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

  it('keeps schema acceptance aligned with the canonical URL boundary', () => {
    const makeBoundaryCard = (lastCellLength: number) => ({
      ...TRACKED_WORKOUT_CARD,
      title: 'Eight-exercise workout',
      subtitle: 'Verified canonical workout snapshot for today',
      columns: ['Set 1', 'Set 2', 'Set 3', 'Set 4'],
      rows: Array.from({ length: 8 }, (_, rowIndex) => ({
        label: `Exercise ${rowIndex + 1} movement pattern`,
        values: Array.from({ length: 4 }, (_, columnIndex) => {
          const cellLength = rowIndex === 7 && columnIndex === 3
            ? lastCellLength
            : 22
          return `${rowIndex + columnIndex + 1}`.padEnd(cellLength, 'x')
        }),
      })),
      footer: 'Assists and spotted reps remain on the exact set note.',
    })

    const acceptedCard = makeBoundaryCard(17)
    const { tracking: _acceptedTracking, ...acceptedPresentation } = acceptedCard
    expect(encodeEnvelopeUrl(acceptedPresentation).length).toBe(2_037)
    expect(assistantResponseCardSchema.parse(acceptedCard)).toEqual(acceptedCard)
    expect(encodeCompactTableAppCardUrl(acceptedCard).length).toBe(2_037)
    expect(buildLinqIMessageAppCardImageUrl(acceptedCard).length).toBe(2_046)

    const rejectedCard = makeBoundaryCard(18)
    const { tracking: _rejectedTracking, ...rejectedPresentation } = rejectedCard
    expect(encodeEnvelopeUrl(rejectedPresentation).length).toBe(2_039)
    expect(
      `https://www.withmurph.ai/imessage/card/v1/${Buffer.from(
        JSON.stringify({ schemaVersion: 3, card: rejectedPresentation }),
        'utf8',
      ).toString('base64url')}.png`.length,
    ).toBe(2_048)
    expect(assistantResponseCardSchema.safeParse(rejectedCard).success).toBe(false)
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
