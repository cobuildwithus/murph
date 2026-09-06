import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  assistantResponseCardAuthoringSchema,
  assistantResponseCardJsonSchema,
  buildLinqIMessageAppCardImageUrl,
  buildLinqIMessageAppCardUrl,
  buildLinqIMessageAppFallbackText,
  buildLinqIMessageAppLayout,
  buildTelegramRichMessage,
  renderAssistantResponseCardText,
  renderAssistantResponseCardTranscriptText,
  type WearableTrendResponseCardV1,
} from '../src/assistant-response-cards.js'

const CARD: WearableTrendResponseCardV1 = {
  kind: 'wearable_trend',
  version: 1,
  localDates: [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
  ],
  metrics: [
    {
      metricKey: 'steps',
      values: [6_800, 7_900, 9_400, 8_700, 10_200, 7_100, 9_800],
      trend: 'higher',
    },
    {
      metricKey: 'total-sleep-minutes',
      values: [432, 438, 428, 441, 435, 439, 434],
      trend: 'steady',
    },
    {
      metricKey: 'hrv-rmssd',
      values: [37, 41, 39, 45, 47, 44, 50],
      trend: 'higher',
    },
  ],
}

const EXPECTED_TEXT = [
  '7-day health · Aug 24–30',
  'Daily averages · change vs prior 7 days',
  'Days: Mon · Tue · Wed · Thu · Fri · Sat · Sun',
  '',
  'STEPS · 8.6k · higher',
  '6.8k · 7.9k · 9.4k · 8.7k · 10.2k · 7.1k · 9.8k',
  '▁▃▆▅█▂▇',
  '',
  'SLEEP · 7h15m · steady',
  '7h12m · 7h18m · 7h08m · 7h21m · 7h15m · 7h19m · 7h14m',
  '▃▆▁█▅▇▄',
  '',
  'HRV (RMSSD) · 43 ms · higher',
  '37 · 41 · 39 · 45 · 47 · 44 · 50',
  '▁▃▂▅▆▅█',
].join('\n')

describe('wearable trend response cards', () => {
  it('renders the compact requested block deterministically on text routes', () => {
    expect(renderAssistantResponseCardText(CARD)).toBe(EXPECTED_TEXT)
    expect(renderAssistantResponseCardTranscriptText(CARD)).toBe(EXPECTED_TEXT)
  })

  it('preserves sparse calendar slots without treating them as zero', () => {
    const sparse: WearableTrendResponseCardV1 = {
      ...CARD,
      metrics: [{
        metricKey: 'steps',
        values: [6_800, null, null, 8_700, null, null, 9_800],
        trend: 'not_enough_data',
      }],
    }

    expect(renderAssistantResponseCardText(sparse)).toContain([
      'STEPS · 8.4k · unavailable',
      '6.8k · — · — · 8.7k · — · — · 9.8k',
      '▁··▅··█',
    ].join('\n'))
    expect(buildTelegramRichMessage(sparse).html).toContain(
      'STEPS · 8.4k · unavailable',
    )
  })

  it('builds one authority-free V7 static image envelope', () => {
    const imageUrl = buildLinqIMessageAppCardImageUrl(CARD)
    const encoded = imageUrl
      .replace('https://www.withmurph.ai/imessage/card/v1/', '')
      .replace(/\.png$/u, '')
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
      .toEqual({
        schemaVersion: 7,
        card: CARD,
      })
    expect(encoded).not.toMatch(/hview_|provider|source|timeZone|entityId/iu)
  })

  it('keeps provider chrome value-free and exposes the native schema-seven URL', () => {
    expect(buildLinqIMessageAppFallbackText(CARD)).toBe('Your health trend.')
    expect(buildLinqIMessageAppLayout(CARD)).toEqual({
      caption: '7-day health',
      image_url: expect.stringMatching(
        /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
      ),
    })
    expect(JSON.stringify({
      fallback: buildLinqIMessageAppFallbackText(CARD),
      layout: buildLinqIMessageAppLayout(CARD),
    })).not.toMatch(/6,?800|10,?200|RMSSD|2026-08/iu)
    const nativeUrl = buildLinqIMessageAppCardUrl(CARD)
    const nativePrefix = 'https://www.withmurph.ai/#murph-card='
    expect(nativeUrl.startsWith(nativePrefix)).toBe(true)
    expect(nativeUrl.length).toBeLessThan(2_048)
    expect(
      JSON.parse(
        Buffer.from(nativeUrl.slice(nativePrefix.length), 'base64url')
          .toString('utf8'),
      ),
    ).toEqual({ schemaVersion: 7, card: CARD })
  })

  it('provides the same complete block to Telegram without generic authoring', () => {
    const telegram = buildTelegramRichMessage(CARD)
    expect(telegram.html).toContain('7-day health · Aug 24–30')
    expect(telegram.html).toContain('Daily averages · change vs prior 7 days')
    expect(telegram.html).toContain('STEPS · 8.6k · higher')
    expect(telegram.html).toContain('▁▃▆▅█▂▇')
    expect(assistantResponseCardAuthoringSchema.safeParse(CARD).success).toBe(
      false,
    )
    expect(JSON.stringify(assistantResponseCardJsonSchema)).not.toContain(
      'wearable_trend',
    )
  })
})
