import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTrustedSleepSummaryCard } from '../src/assistant-codex/dynamic-tools/sleep-summary-card.js'
import { MURPH_ATTACH_SLEEP_CARD_TOOL, executeMurphDynamicToolRequest, resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.js'
import { SYNTHETIC_SLEEP_NIGHT_VALUES, seedSyntheticSleepNight } from './support/sleep-card-fixture.js'
import type { AssistantResponseCard } from '@murphai/contracts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function seed(provider: string, values: Record<string, number>, options: { window?: boolean; timeZone?: string; vaultZone?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'sleep-card-builder-')); roots.push(root)
  await seedSyntheticSleepNight(root, provider, values, options)
  return root
}
const values: Record<string, number> = { ...SYNTHETIC_SLEEP_NIGHT_VALUES }
const run = (vaultRoot: string | null, overrides: Partial<Parameters<typeof executeMurphDynamicToolRequest>[0]> = {}) => executeMurphDynamicToolRequest({ env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, privateDirectResponseCardAllowed: true, progressDelivery: null, currentResponseCard: null, currentResponseMedia: [], vaultRoot, request: { kind: 'attach-sleep-card', date: '2026-11-03' }, ...overrides })

describe('host-built sleep summary attachment', () => {
  it('builds Oura with rounded metrics and never manufactures wake-ups', async () => {
    const card = await resolveTrustedSleepSummaryCard({ vaultRoot: await seed('oura', values, { timeZone: 'UTC' }), date: '2026-11-03' })
    expect(card).toEqual({ kind: 'sleep_summary', version: 1, localDate: '2026-11-03', bedtime: '00:18', wakeTime: '08:02', totalSleepMinutes: 436, score: 85, stages: { deepMinutes: 141, remMinutes: 118, lightMinutes: 177 }, awakeMinutes: 28, efficiencyPercent: 94, hrv: { milliseconds: 66, method: 'rmssd' }, restingHeartRate: 45, wakeUps: null })
  })
  it('uses WHOOP performance and the canonical reporting zone', async () => {
    const { sleepScore: _score, ...other } = values
    const card = await resolveTrustedSleepSummaryCard({ vaultRoot: await seed('whoop', { ...other, sleepPerformance: 85 }, { vaultZone: 'Asia/Tokyo' }), date: '2026-11-03' })
    expect(card).toMatchObject({ bedtime: '09:18', wakeTime: '17:02', score: 85 })
  })
  it('enriches Apple Watch from in-window SDNN without inventing a score', async () => {
    const { sleepScore: _score, hrv: _hrv, ...other } = values
    const card = await resolveTrustedSleepSummaryCard({ vaultRoot: await seed('apple_health', { ...other, 'hrv-sdnn': 66 }), date: '2026-11-03' })
    expect(card).toMatchObject({ score: null, hrv: { milliseconds: 66, method: 'sdnn' } })
  })
  it.each(['apple_health', 'garmin'])('keeps %s without a score or HRV sparse', async (provider) => {
    const { sleepScore: _score, hrv: _hrv, ...other } = values
    const card = await resolveTrustedSleepSummaryCard({ vaultRoot: await seed(provider, other), date: '2026-11-03' })
    expect(card).toMatchObject({ totalSleepMinutes: 436, score: null, hrv: null, wakeUps: null })
  })
  it('preserves total-only phone evidence and hides zero-filled stages, awake and efficiency', async () => {
    const card = await resolveTrustedSleepSummaryCard({ vaultRoot: await seed('apple_health', { totalSleepMinutes: 436 }, { window: false }), date: '2026-11-03' })
    expect(card).toMatchObject({ bedtime: null, wakeTime: null, stages: null, score: null, hrv: null, restingHeartRate: null })
    const zero = await resolveTrustedSleepSummaryCard({ vaultRoot: await seed('garmin', { totalSleepMinutes: 436, deepMinutes: 0, remMinutes: 0, lightMinutes: 0, awakeMinutes: 0, sleepEfficiency: 0 }), date: '2026-11-03' })
    expect(zero).toMatchObject({ stages: null, awakeMinutes: null, efficiencyPercent: null })
  })
  it.each([
    { total: 360.25, deep: 60.75, rem: 80.5, light: 219, expected: { deepMinutes: 61, remMinutes: 80, lightMinutes: 219 } },
    { total: 390, deep: 60.25, rem: 80.375, light: 219.25, expected: { deepMinutes: 60, remMinutes: 81, lightMinutes: 219 } },
  ])('keeps fractional stages at their measured subtotal for a $total-minute night', async ({ total, deep, rem, light, expected }) => {
    const vaultRoot = await seed('whoop', { totalSleepMinutes: total, deepMinutes: deep, remMinutes: rem, lightMinutes: light })
    expect(await resolveTrustedSleepSummaryCard({ vaultRoot, date: '2026-11-03' }))
      .toMatchObject({ totalSleepMinutes: Math.round(total), stages: expected })
  })

  it('omits sleep stages that exceed the measured night', async () => {
    const vaultRoot = await seed('garmin', { totalSleepMinutes: 215, deepMinutes: 130, remMinutes: 95, lightMinutes: 75 })
    expect(await resolveTrustedSleepSummaryCard({ vaultRoot, date: '2026-11-03' }))
      .toMatchObject({ totalSleepMinutes: 215, stages: null })
  })

  it('has a tiny selector-only schema and shares private card availability', () => {
    expect(MURPH_ATTACH_SLEEP_CARD_TOOL.description).toContain('{"date":"YYYY-MM-DD"}')
    expect(JSON.stringify(MURPH_ATTACH_SLEEP_CARD_TOOL.inputSchema).length).toBeLessThan(5000)
    expect(resolveMurphDynamicTools({ responseCardsAvailable: true })).toContain(MURPH_ATTACH_SLEEP_CARD_TOOL)
    expect(resolveMurphDynamicTools({ responseCardsAvailable: false })).not.toContain(MURPH_ATTACH_SLEEP_CARD_TOOL)
    expect(readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: { tool: 'attach_sleep_card', namespace: 'murph', arguments: { date: '2026-11-03' } } })).toEqual({ kind: 'attach-sleep-card', date: '2026-11-03' })
    expect(readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: { tool: 'attach_sleep_card', namespace: 'murph', arguments: { date: '2026-11-03', score: 99 } } })).toMatchObject({ kind: 'invalid-tool-arguments', errorCode: 'invalid_response_card_arguments' })
  })
  it('uses the existing audience, single-card and media guards and safe missing-data result', async () => {
    const root = await seed('oura', values)
    const result = await run(root)
    expect(result.rpcResult.success).toBe(true)
    expect(result.rpcResult.contentItems).toEqual([{ type: 'inputText', text: expect.stringContaining('Restorative (deep + REM): 4h 19m') }])
    const card = result.responseCardPatch?.card
    expect(card?.kind).toBe('sleep_summary')
    expect((await run(root, { currentResponseCard: card as AssistantResponseCard })).rpcResult.success).toBe(false)
    expect((await run(root, { privateDirectResponseCardAllowed: false, telegramPresentationResponseCardAllowed: true })).rpcResult.success).toBe(false)
    expect((await run(root, { currentResponseMedia: [{ kind: 'image', url: 'https://example.test/synthetic.png', alt: null, source: null }] })).rpcResult.success).toBe(false)
    const missing = await run(null)
    expect(missing.rpcResult.success).toBe(false)
    expect(JSON.stringify(missing.rpcResult)).toContain('no_sleep_for_date')
    expect(missing.responseCardPatch).toBeUndefined()
  })
})
