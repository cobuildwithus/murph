import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { sleepSummaryResponseCardV1Schema } from '@murphai/contracts'
import { buildLinqIMessageAppCardImageUrl, buildLinqIMessageAppCardUrl, buildLinqIMessageAppFallbackText, buildLinqIMessageAppLayout, buildTelegramRichMessage, renderAssistantResponseCardText, renderAssistantResponseCardTranscriptText } from '../src/assistant-response-cards.js'
import { LINQ_SLEEP_SUMMARY_CARD_INTERACTIVE, sendLinqIMessageAppCard, type LinqFetch } from '../src/linq-runtime.js'

const complete = sleepSummaryResponseCardV1Schema.parse({
  kind: 'sleep_summary', version: 1, localDate: '2026-11-03', bedtime: '00:18', wakeTime: '08:02', totalSleepMinutes: 436,
  score: 85, stages: { deepMinutes: 141, remMinutes: 118, lightMinutes: 177 }, awakeMinutes: 28, efficiencyPercent: 94,
  hrv: { milliseconds: 66, method: 'rmssd' }, restingHeartRate: 45, wakeUps: 3,
})
const totalOnly = sleepSummaryResponseCardV1Schema.parse({ ...complete, bedtime: null, wakeTime: null, score: null, stages: null, awakeMinutes: null, efficiencyPercent: null, hrv: null, restingHeartRate: null, wakeUps: null })

// Exact cross-platform fixtures. Copy these HTTPS fragments into Swift tests.
const COMPLETE_URL = 'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjo4LCJjYXJkIjp7ImtpbmQiOiJzbGVlcF9zdW1tYXJ5IiwidmVyc2lvbiI6MSwibG9jYWxEYXRlIjoiMjAyNi0xMS0wMyIsImJlZHRpbWUiOiIwMDoxOCIsIndha2VUaW1lIjoiMDg6MDIiLCJ0b3RhbFNsZWVwTWludXRlcyI6NDM2LCJzY29yZSI6ODUsInN0YWdlcyI6eyJkZWVwTWludXRlcyI6MTQxLCJyZW1NaW51dGVzIjoxMTgsImxpZ2h0TWludXRlcyI6MTc3fSwiYXdha2VNaW51dGVzIjoyOCwiZWZmaWNpZW5jeVBlcmNlbnQiOjk0LCJocnYiOnsibWlsbGlzZWNvbmRzIjo2NiwibWV0aG9kIjoicm1zc2QifSwicmVzdGluZ0hlYXJ0UmF0ZSI6NDUsIndha2VVcHMiOjN9fQ'
const TOTAL_ONLY_URL = 'https://www.withmurph.ai/#murph-card=eyJzY2hlbWFWZXJzaW9uIjo4LCJjYXJkIjp7ImtpbmQiOiJzbGVlcF9zdW1tYXJ5IiwidmVyc2lvbiI6MSwibG9jYWxEYXRlIjoiMjAyNi0xMS0wMyIsImJlZHRpbWUiOm51bGwsIndha2VUaW1lIjpudWxsLCJ0b3RhbFNsZWVwTWludXRlcyI6NDM2LCJzY29yZSI6bnVsbCwic3RhZ2VzIjpudWxsLCJhd2FrZU1pbnV0ZXMiOm51bGwsImVmZmljaWVuY3lQZXJjZW50IjpudWxsLCJocnYiOm51bGwsInJlc3RpbmdIZWFydFJhdGUiOm51bGwsIndha2VVcHMiOm51bGx9fQ'

describe('sleep summary delivery', () => {
  it('pins exact complete and total-only Swift fragment fixtures', () => {
    for (const [card, expected] of [[complete, COMPLETE_URL], [totalOnly, TOTAL_ONLY_URL]] as const) {
      expect(buildLinqIMessageAppCardUrl(card)).toBe(expected)
      expect(expected.length).toBeLessThan(2048)
      const decoded = JSON.parse(Buffer.from(expected.split('#murph-card=')[1]!, 'base64url').toString('utf8'))
      expect(decoded).toEqual({ schemaVersion: 8, card })
      const imageUrl = new URL(buildLinqIMessageAppCardImageUrl(card))
      expect(imageUrl.search).toBe('')
      expect(imageUrl.hash).toBe('')
      expect(imageUrl.pathname).toBe(`/imessage/card/v1/${expected.split('#murph-card=')[1]}.png`)
    }
  })
  it('renders complete deterministic recovery and transcript with method labels', () => {
    const text = renderAssistantResponseCardText(complete)
    expect(text).toBe('Sleep, Tue Nov 3\n7h 16m asleep, 12:18 AM to 8:02 AM\nScore 85\nDeep 2h 21m, REM 1h 58m, light 2h 57m, awake 28m\nRestorative (deep + REM) 4h 19m\n3 wake-ups, 94% asleep, HRV 66 ms, resting HR 45 bpm')
    expect(renderAssistantResponseCardTranscriptText(complete)).toBe(text)
    expect(renderAssistantResponseCardText(totalOnly)).toBe('Sleep, Tue Nov 3\n7h 16m asleep')
    expect(renderAssistantResponseCardText({ ...complete, score: null, hrv: { milliseconds: 66, method: 'sdnn' }, wakeUps: null })).toContain('HRV 66 ms')
    expect(renderAssistantResponseCardText({ ...complete, score: null, hrv: null })).not.toMatch(/Score|HRV/u)
  })
  it('has value-free fallback, date-only chrome and Telegram present-value table', () => {
    expect(buildLinqIMessageAppFallbackText(complete)).toBe('Your sleep summary.')
    expect(buildLinqIMessageAppLayout(complete)).toEqual({ caption: 'Tue, Nov 3', image_url: buildLinqIMessageAppCardImageUrl(complete) })
    const html = buildTelegramRichMessage(complete).html
    expect(html).toContain('<h2>Sleep</h2>')
    expect(html).toContain('<img src=')
    expect(html).toContain('<th>HRV</th><td>66 ms</td>')
    expect(buildTelegramRichMessage(totalOnly).html).not.toMatch(/<th>(?:Score|Deep|Awake|HRV)/u)
  })
  it('sends sleep statically while preserving other cards as interactive', async () => {
    const bodies: unknown[] = []
    const fetchImplementation: LinqFetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ message: { id: 'synthetic-message' } }), { headers: { 'Content-Type': 'application/json' } })
    }
    await sendLinqIMessageAppCard({ card: complete, chatId: 'synthetic-chat', idempotencyKey: 'synthetic-sleep' }, { env: { LINQ_API_TOKEN: 'synthetic-token' }, fetchImplementation })
    expect(LINQ_SLEEP_SUMMARY_CARD_INTERACTIVE).toBe(false)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ message: { parts: [{ interactive: false, fallback_text: 'Your sleep summary.', url: COMPLETE_URL }] } })
    await sendLinqIMessageAppCard({ card: { kind: 'compact_table', version: 1, title: 'Summary', subtitle: null, rowHeader: 'Item', columns: ['Value'], rows: [{ label: 'Example', values: ['Present'] }], tracking: null, footer: null }, chatId: 'synthetic-chat', idempotencyKey: 'synthetic-other' }, { env: { LINQ_API_TOKEN: 'synthetic-token' }, fetchImplementation })
    expect(bodies[1]).toMatchObject({ message: { parts: [{ interactive: true }] } })
  })
})
