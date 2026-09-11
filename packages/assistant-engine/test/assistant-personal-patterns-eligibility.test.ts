import { rm } from 'node:fs/promises'
import { initializeVault } from '@murphai/core'
import { emptyPersonalPatternReport, type PersonalPatternReport } from '@murphai/query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  canSkipManagedPersonalPatterns,
  parsePersonalPatternNotificationLedger,
  personalPatternReportAlreadyReviewed,
  type PersonalPatternNotificationLedger,
} from '../src/assistant/personal-patterns-eligibility.js'
import { MURPH_MANAGED_AUTOMATIONS, MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID } from '../src/assistant/managed-automations.js'
import { getKnowledgePage, upsertKnowledgePage } from '../src/knowledge/service.js'
import { createTempVaultContext } from './test-helpers.js'

const query = vi.hoisted(() => vi.fn())
vi.mock('@murphai/query', async (original) => ({
  ...await original<typeof import('@murphai/query')>(),
  buildPersonalPatternReportRuntime: query,
}))
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
beforeEach(() => { query.mockReset().mockResolvedValue(report()) })

function ledger(): PersonalPatternNotificationLedger {
  return {
    version: 1, initialDigestSent: true, reviewedFactorIds: ['walking'], mutedFactorIds: [],
    results: [{
      factorId: 'walking', outcomeId: 'hrv', comparisonBasis: 'confirmed_absence',
      lagDays: 1, lastSeenGrade: 'C', firstSharedDate: '2026-08-01', muted: false,
    }],
  }
}
function report(): PersonalPatternReport {
  return {
    ...emptyPersonalPatternReport('2026-08-20'),
    factors: [{ id: 'walking', kind: 'activity', label: 'Walking', observedDays: 6 }],
    outcomes: [{ id: 'hrv', label: 'HRV', unit: 'ms', lagDays: 1 }],
    cells: [{
      factorId: 'walking', outcomeId: 'hrv', comparisonBasis: 'confirmed_absence',
      grade: 'C', stage: 'new_clue', comparisonDays: 6, comparisonMean: 50,
      exposedDays: 6, exposedMean: 55, delta: 5, deltaPercent: 10, direction: 'higher',
      firstExposedDate: '2026-08-01', lastExposedDate: '2026-08-19', repeatedDirection: true,
    }],
  }
}
async function setup(body = JSON.stringify(ledger())) {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-patterns-eligibility-')
  roots.push(parentRoot)
  await initializeVault({ vaultRoot })
  await upsertKnowledgePage({ vault: vaultRoot, slug: 'personal-pattern-notifications', pageType: 'ledger', body })
  return {
    automationId: MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID,
    instructions: MURPH_MANAGED_AUTOMATIONS.find((entry) => entry.automationId === MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID)!.instructions,
    nowIso: '2026-08-20T00:30:00.000Z', timeZone: 'America/Los_Angeles', vaultRoot,
  }
}

test('skips a reviewed report using canonical history without writing or calling a provider', async () => {
  const input = await setup()
  const before = await getKnowledgePage({ vault: input.vaultRoot, slug: 'personal-pattern-notifications' })
  expect(before.degradation).toBeNull()
  expect(parsePersonalPatternNotificationLedger(before.page.body)).toEqual(ledger())
  expect(await canSkipManagedPersonalPatterns(input)).toBe(true)
  expect(query).toHaveBeenCalledExactlyOnceWith(input.vaultRoot, { asOf: '2026-08-19' })
  expect(await getKnowledgePage({ vault: input.vaultRoot, slug: 'personal-pattern-notifications' })).toEqual(before)
})

test.each(['Legacy history with a saved factor mute.', '{}', JSON.stringify({ ...ledger(), version: 2 }), JSON.stringify({ ...ledger(), extraPreference: 'retain' })])(
  'retains model review for uncertain history: %s', async (body) => {
    expect(await canSkipManagedPersonalPatterns(await setup(body))).toBe(false)
    expect(query).not.toHaveBeenCalled()
  },
)
test('keeps an incomplete first digest eligible even when pending identities are known', async () => {
  expect(await canSkipManagedPersonalPatterns(await setup(JSON.stringify({ ...ledger(), initialDigestSent: false })))).toBe(false)
  expect(query).not.toHaveBeenCalled()
})
test('does not apply the gate to a custom automation', async () => {
  const input = await setup()
  expect(await canSkipManagedPersonalPatterns({ ...input, automationId: 'custom-patterns' })).toBe(false)
  expect(query).not.toHaveBeenCalled()
})
test('retains model review when canonical history is missing', async () => {
  const input = await setup()
  await rm(input.vaultRoot, { recursive: true, force: true })
  expect(await canSkipManagedPersonalPatterns(input)).toBe(false)
  expect(query).not.toHaveBeenCalled()
})
test('retains model review on query failure and propagates cancellation', async () => {
  const input = await setup()
  query.mockRejectedValueOnce(new Error('Synthetic report unavailable'))
  expect(await canSkipManagedPersonalPatterns(input)).toBe(false)
  const controller = new AbortController()
  query.mockImplementationOnce(async () => {
    controller.abort(new Error('Occurrence canceled'))
    return report()
  })
  await expect(canSkipManagedPersonalPatterns({ ...input, signal: controller.signal })).rejects.toThrow('Occurrence canceled')
})

test.each([
  ['new factor', (value: PersonalPatternReport) => { value.factors.push({ id: 'cycling', kind: 'activity', label: 'Cycling', observedDays: 1 }) }],
  ['new outcome', (value: PersonalPatternReport) => { value.cells[0]!.outcomeId = 'sleep-score' }],
  ['new comparison', (value: PersonalPatternReport) => { value.cells[0]!.comparisonBasis = 'unobserved_baseline' }],
  ['same-day outcome', (value: PersonalPatternReport) => { value.outcomes[0]!.lagDays = 0 }],
  ['grade change', (value: PersonalPatternReport) => { value.cells[0]!.grade = 'B' }],
  ['downgrade to observation', (value: PersonalPatternReport) => { value.cells[0]!.grade = 'E' }],
  ['unknown comparison', (value: PersonalPatternReport) => { delete value.cells[0]!.comparisonBasis }],
] as const)('keeps %s eligible for model review', (_name, change) => {
  const current = report()
  change(current)
  expect(personalPatternReportAlreadyReviewed(current, ledger())).toBe(false)
})

test('does not reopen reviewed identities for extra observations or effect-size changes', () => {
  const current = report()
  current.cells[0]!.exposedDays = 20
  current.cells[0]!.delta = 7
  current.cells[0]!.stage = 'seen_again'
  current.asOfDate = '2026-08-21'
  expect(personalPatternReportAlreadyReviewed(current, ledger())).toBe(true)
})
test('preserves mutes and first-shared dates in strict ledger parsing', () => {
  const history = ledger()
  history.mutedFactorIds = ['walking']
  history.results[0]!.muted = true
  expect(parsePersonalPatternNotificationLedger(JSON.stringify(history))).toEqual(history)
  expect(personalPatternReportAlreadyReviewed(report(), history)).toBe(true)
})
test('rejects duplicate identities and missing mute/history fields', () => {
  const history = ledger()
  history.results.push({ ...history.results[0]!, lastSeenGrade: 'D' })
  expect(parsePersonalPatternNotificationLedger(JSON.stringify(history))).toBeNull()
  expect(parsePersonalPatternNotificationLedger(JSON.stringify({ ...ledger(), mutedFactorIds: undefined }))).toBeNull()
})
test('an established empty report remains quiet; a new ungraded factor still gets reviewed', () => {
  const current = emptyPersonalPatternReport('2026-08-20')
  expect(personalPatternReportAlreadyReviewed(current, ledger())).toBe(true)
  current.factors.push({ id: 'gardening', label: 'Gardening', kind: 'activity', observedDays: 1 })
  expect(personalPatternReportAlreadyReviewed(current, ledger())).toBe(false)
})


test('keeps member-edited managed instructions eligible for their requested work', async () => {
  const input = await setup()
  expect(await canSkipManagedPersonalPatterns({ ...input, instructions: 'Investigate changes in recovery each day.' })).toBe(false)
  expect(query).not.toHaveBeenCalled()
})
