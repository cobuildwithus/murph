import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { MURPH_NATIVE_SLEEP_CARD_ENABLED_ENV } from '../src/hosted-assistant-config-constants.js'
import { describe, expect, it, vi } from 'vitest'
import { sleepSummaryResponseCardV1Schema, type AssistantResponseCard } from '@murphai/contracts'
import { buildLinqIMessageAppCardImageUrl, buildLinqIMessageAppCardUrl, buildLinqIMessageAppFallbackText, buildLinqIMessageAppLayout, buildTelegramRichMessage, readSleepSummaryNote, renderAssistantResponseCardText, renderAssistantResponseCardTranscriptText } from '../src/assistant-response-cards.js'
import { sendLinqIMessageAppCard, type LinqFetch } from '../src/linq-runtime.js'

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
  it.each([undefined, '', '0', 'true', ' 1 ', '1'])('enables sleep interactivity only for the exact flag %s', async (flag) => {
    const bodies: unknown[] = []
    const fetchImplementation: LinqFetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ message: { id: 'synthetic-message' } }), { headers: { 'Content-Type': 'application/json' } })
    }
    const env = { LINQ_API_TOKEN: 'synthetic-token', [MURPH_NATIVE_SLEEP_CARD_ENABLED_ENV]: flag }
    await sendLinqIMessageAppCard({ card: complete, chatId: 'synthetic-chat', idempotencyKey: 'synthetic-sleep' }, { env, fetchImplementation })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ message: { parts: [{ interactive: flag === '1', fallback_text: 'Your sleep summary.', url: COMPLETE_URL }] } })
    const otherCards: AssistantResponseCard[] = [
      { kind: 'compact_table', version: 1, title: 'Summary', subtitle: null, rowHeader: 'Item', columns: ['Value'], rows: [{ label: 'Example', values: ['Present'] }], tracking: null, footer: null },
      { kind: 'daily_nutrition', version: 2, localDate: '2026-11-03', mealCount: 1,
        totals: { calories: { total: 600, mealCount: 1 }, proteinGrams: { total: 30, mealCount: 1 }, carbsGrams: { total: 60, mealCount: 1 }, fatGrams: { total: 20, mealCount: 1 }, fiberGrams: { total: 8, mealCount: 1 } },
        goals: { calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null, fiberGrams: null } },
    ]
    for (const card of otherCards) {
      await sendLinqIMessageAppCard({ card, chatId: 'synthetic-chat', idempotencyKey: `synthetic-${card.kind}` }, { env, fetchImplementation })
      expect(bodies.at(-1)).toMatchObject({ message: { parts: [{ interactive: true }] } })
    }
    expect(bodies).toHaveLength(3)
  })
})


describe('sleep summary companion note', () => {
  const note = 'This synthetic night follows the recent pattern. See https://example.test/sleep'
  const summary = renderAssistantResponseCardText(totalOnly)
  const composed = `${summary}\n\n${note}`
  const env = { LINQ_API_TOKEN: 'synthetic-token' }

  it.each([undefined, null, '', '  ', summary, `  ${summary}  `])(
    'keeps absent and legacy companions card-only case %#', (message) => {
      expect(readSleepSummaryNote(totalOnly, message)).toBeNull()
      expect(renderAssistantResponseCardText(totalOnly, message)).toBe(summary)
      expect(renderAssistantResponseCardTranscriptText(totalOnly, message)).toBe(summary)
    },
  )
  it.each([note, `  ${note}  `, composed])('composes exactly once case %#', (message) => {
    expect(readSleepSummaryNote(totalOnly, message)).toBe(note)
    expect(renderAssistantResponseCardText(totalOnly, message)).toBe(composed)
    expect(renderAssistantResponseCardTranscriptText(totalOnly, message)).toBe(composed)
    expect(buildLinqIMessageAppLayout(totalOnly, message)).toEqual(buildLinqIMessageAppLayout(totalOnly))
  })
  it('escapes the note after the Telegram table', () => {
    const html = buildTelegramRichMessage(totalOnly, '<note> & context').html
    expect(html).toMatch(/<\/table><p>&lt;note&gt; &amp; context<\/p>$/u)
  })
  it.each(['0', '1'])('sends card then one plain note with long unhashed keys (native %s)', async (flag) => {
    const bodies: Array<{ message: { idempotency_key: string; parts: unknown[] } }> = []
    const fetchImplementation: LinqFetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ message: { id: bodies.length === 1 ? 'synthetic-card' : 'synthetic-note' } }))
    }
    const key = 'synthetic-delivery:'.repeat(20)
    const hash = (value: string) => `linq-idempotency:sha256:${createHash('sha256').update(value).digest('hex')}`
    const result = await sendLinqIMessageAppCard({ card: totalOnly, chatId: 'synthetic-chat', idempotencyKey: key, companionMessage: composed }, {
      env: { ...env, [MURPH_NATIVE_SLEEP_CARD_ENABLED_ENV]: flag }, fetchImplementation,
    })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({ message: { idempotency_key: hash(key), parts: [{ type: 'imessage_app', interactive: flag === '1' }] } })
    expect(bodies[1]).toEqual({ message: { idempotency_key: hash(`${key}:note`), parts: [{ type: 'text', value: note }] } })
    expect(result).toMatchObject({
      message: { id: 'synthetic-note' }, providerMessageIds: ['synthetic-card', 'synthetic-note'],
      providerMessageEffects: [{ message: null, providerMessageId: 'synthetic-card' }, { message: note, providerMessageId: 'synthetic-note' }],
    })
  })
  it.each(['rejected', 'missing', 'duplicate'])('preserves only accepted card evidence on a %s note and dedupes replay', async (failure) => {
    const accepted = new Map<string, string>()
    const keys: string[] = []
    let failNote = true
    const fetchImplementation: LinqFetch = async (_url, init) => {
      const { message } = JSON.parse(String(init.body))
      keys.push(message.idempotency_key)
      const isNote = message.idempotency_key.endsWith(':note')
      if (isNote && failNote) {
        if (failure === 'rejected') return new Response('{}', { status: 422 })
        return new Response(JSON.stringify({ message: failure === 'missing' ? {} : { id: 'synthetic-card' } }))
      }
      const id = accepted.get(message.idempotency_key) ?? (isNote ? 'synthetic-note' : 'synthetic-card')
      accepted.set(message.idempotency_key, id)
      return new Response(JSON.stringify({ message: { id } }))
    }
    const input = { card: totalOnly, chatId: 'synthetic-chat', idempotencyKey: 'synthetic-pair', companionMessage: note }
    await expect(sendLinqIMessageAppCard(input, { env, fetchImplementation })).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY', deliveryMayHaveSucceeded: true,
      providerMessageIds: ['synthetic-card'],
      context: { idempotencyKey: 'synthetic-pair', providerMessageEffects: [{ message: null, providerMessageId: 'synthetic-card' }] },
    })
    failNote = false
    await expect(sendLinqIMessageAppCard(input, { env, fetchImplementation })).resolves.toMatchObject({ providerMessageIds: ['synthetic-card', 'synthetic-note'] })
    expect(keys).toEqual(['synthetic-pair', 'synthetic-pair:note', 'synthetic-pair', 'synthetic-pair:note'])
    expect(accepted.size).toBe(2)
  })
  it('rejects an oversized note before accepting the card', async () => {
    const fetchImplementation = vi.fn<LinqFetch>()
    await expect(sendLinqIMessageAppCard({ card: totalOnly, chatId: 'synthetic-chat', idempotencyKey: 'synthetic-pair', companionMessage: 'x'.repeat(1_000_001) }, { env, fetchImplementation }))
      .rejects.toMatchObject({ code: 'LINQ_INVALID_INPUT', deliveryMayHaveSucceeded: false })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })
})
