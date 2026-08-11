import { describe, expect, it } from 'vitest'

import {
  LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
  buildLinqIMessageAppLayout,
  renderAssistantResponseCardText,
  type CompactTableResponseCardV1,
} from '../src/assistant-response-cards.js'

const ONE_OFF_TABLE: CompactTableResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Weekly plan',
  subtitle: null,
  rowHeader: 'Day',
  columns: ['Focus'],
  rows: [{ label: 'Monday', values: ['Upper body'] }],
  footer: null,
  tracking: null,
}

const TRACKED_TABLE: CompactTableResponseCardV1 = {
  ...ONE_OFF_TABLE,
  title: 'Live workout',
  rowHeader: 'Exercise',
  columns: ['Set 1'],
  rows: [{ label: 'Exercise A', values: ['10'] }],
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
}

describe('response-card static Linq layouts', () => {
  it('uses generic value-free fallback copy across card kinds', () => {
    expect(LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT).toBe(
      'Ask Murph for this card in text',
    )
  })

  it('preserves generic provider details without exposing tracking authority', () => {
    expect(buildLinqIMessageAppLayout(ONE_OFF_TABLE)).toEqual({
      caption: 'Weekly plan',
      image_url: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
      ),
      subcaption: 'Monday: Focus: Upper body',
    })
    expect(buildLinqIMessageAppLayout(TRACKED_TABLE)).toEqual({
      caption: 'Live workout',
      image_url: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
      ),
      subcaption: 'Exercise A: Set 1: 10',
    })

    expect(renderAssistantResponseCardText(TRACKED_TABLE)).toMatch(
      /Exercise A|10/u,
    )
    expect(JSON.stringify(buildLinqIMessageAppLayout(TRACKED_TABLE))).not.toMatch(
      /evt_|2026/u,
    )
  })
})
