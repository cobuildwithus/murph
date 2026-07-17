import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { test, vi } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  registerWearablesCommands,
  wearablesSleepPatternResultSchema,
} from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

function createSleepPatternResult() {
  const numericPattern = {
    average: null,
    count: 0,
    median: null,
    standardDeviation: null,
  }
  const clockPattern = {
    count: 0,
    medianLocalMinutes: null,
    medianLocalTime: null,
    standardDeviationMinutes: null,
  }

  return {
    filters: {
      date: null,
      from: '2026-06-13',
      providers: ['oura'],
      timeZone: null,
      to: '2026-07-10',
      windowDays: 28,
    },
    summary: {
      allSourcesStale: true,
      asOfDate: '2026-07-16',
      asOfInstant: '2026-07-16T12:00:00.000Z',
      awakeMinutes: numericPattern,
      bedtime: clockPattern,
      conflictingNightCount: 0,
      coveragePercent: 0,
      expectedNightCount: 28,
      excludedNapOnlyDateCount: 0,
      reportingTimeZoneFallbackNightCount: 0,
      from: '2026-06-13',
      lateArrivingNightCount: 0,
      latestRecordedAt: null,
      latestSleepEndAt: null,
      latestNightAgeDays: null,
      latestNightDate: null,
      midpoint: clockPattern,
      missingNightCount: 28,
      notes: [
        'Missing wearable dates do not mean the user did not sleep.',
        'No validated reporting time zone was available; clock timing was omitted.',
      ],
      overlappingNightCount: 0,
      providerMix: false,
      providers: ['oura'],
      reportingTimeZone: null,
      reportingTimeZoneSource: 'none' as const,
      sameDateSessionSuppressedCount: 0,
      sessionDurationMinutes: numericPattern,
      sleepLatencyMinutes: numericPattern,
      sourceFreshness: [{
        lastSleepEvidenceDate: '2026-07-01',
        provider: 'oura',
        stalenessVsNewestDays: 0,
        stalenessVsNowDays: 15,
      }],
      staleAfterDays: 2,
      suppressedExactDuplicateCount: 0,
      timeZones: [],
      timingTimeZoneMode: 'per_night_canonical_with_reporting_fallback' as const,
      timingOmittedNightCount: 0,
      to: '2026-07-10',
      totalSleepMinutes: numericPattern,
      unknownSleepTypeNightCount: 0,
      validNightCount: 0,
      wakeTime: clockPattern,
      weekdayWeekendMidpointDriftMinutes: null,
      weekdayWeekendMidpointSampleCounts: {
        weekday: 0,
        weekend: 0,
      },
    },
    vault: '/tmp/wearables-sleep-pattern-vault',
  }
}

function createSleepPatternCli() {
  const cli = Cli.create('vault-cli', {
    description: 'wearables sleep pattern cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()
  registerWearablesCommands(cli, services)
  return { cli, services }
}

test('wearables sleep pattern is assistant-callable and forwards explicit analysis controls', async () => {
  const { cli, services } = createSleepPatternCli()
  const showWearableSleepPattern = vi.fn(async (_input: unknown) => createSleepPatternResult())
  Object.defineProperty(services.query, 'showWearableSleepPattern', {
    configurable: true,
    value: showWearableSleepPattern,
    writable: true,
  })

  const result = await runInProcessJsonCli(cli, [
    'wearables',
    'sleep',
    'pattern',
    '--vault',
    '/tmp/wearables-sleep-pattern-vault',
    '--from',
    '2026-06-13',
    '--to',
    '2026-07-10',
    '--provider',
    ' oura ',
    '--time-zone',
    'America/New_York',
    '--window-days',
    '28',
  ])

  assert.equal(result.exitCode, null)
  const data = requireData(result.envelope)
  assert.equal('vault' in data, false)
  assert.equal(showWearableSleepPattern.mock.calls.length, 1)
  const firstCall = showWearableSleepPattern.mock.calls[0]
  assert.ok(firstCall)
  assert.deepEqual(firstCall[0], {
    date: undefined,
    from: '2026-06-13',
    providers: ['oura'],
    requestId: null,
    timeZone: 'America/New_York',
    to: '2026-07-10',
    vault: '/tmp/wearables-sleep-pattern-vault',
    windowDays: 28,
  })
  assert.deepEqual(
    wearablesSleepPatternResultSchema.parse(data).summary.notes,
    createSleepPatternResult().summary.notes,
  )
})

test('wearables sleep pattern rejects an invalid IANA fallback before invoking the service', async () => {
  const { cli, services } = createSleepPatternCli()
  const showWearableSleepPattern = vi.fn()
  Object.defineProperty(services.query, 'showWearableSleepPattern', {
    configurable: true,
    value: showWearableSleepPattern,
    writable: true,
  })

  const result = await runInProcessJsonCli(cli, [
    'wearables',
    'sleep',
    'pattern',
    '--vault',
    '/tmp/wearables-sleep-pattern-vault',
    '--time-zone',
    'not-a-zone',
  ])

  assert.notEqual(result.exitCode, null)
  assert.equal(showWearableSleepPattern.mock.calls.length, 0)
})
