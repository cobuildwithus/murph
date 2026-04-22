import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  registerWearablesCommands,
} from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function createWearablesCliAndServices() {
  const cli = Cli.create('vault-cli', {
    description: 'wearables additive coverage cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerWearablesCommands(cli, services)

  return { cli, services }
}

function createMetricConfidence() {
  return {
    candidateCount: 1,
    conflictingProviders: [],
    exactDuplicateCount: 0,
    level: 'high' as const,
    reasons: [],
  }
}

function createWindowStats(overrides: Partial<{
  average: number | null
  count: number
  from: string | null
  max: number | null
  min: number | null
  to: string | null
}> = {}) {
  return {
    average: null,
    count: 0,
    from: null,
    max: null,
    min: null,
    to: null,
    ...overrides,
  }
}

function createLatestSummary() {
  return {
    activity: null,
    bodyState: null,
    day: {
      activity: null,
      bodyState: null,
      date: '2026-04-05',
      notes: ['Latest wearable day was sourced from oura.'],
      providers: ['oura'],
      recovery: null,
      sleep: null,
      sourceHealth: [],
      summaryConfidence: 'high' as const,
    },
    latestDate: '2026-04-05',
    notes: ['Latest wearable day was sourced from oura.'],
    providers: ['oura'],
    recovery: null,
    sleep: null,
    sourceHealth: [],
  }
}

function createMetricLatestSummary(overrides: Partial<{
  date: string | null
  delta: number | null
  max: number | null
  metric: 'hrv' | 'restingHeartRate'
  min: number | null
  notes: string[]
  paths: string[]
  percentChange: number | null
  priorWindow: ReturnType<typeof createWindowStats>
  provider: string | null
  recentWindow: ReturnType<typeof createWindowStats>
  recordedAt: string | null
  recordIds: string[]
  requestedMetric: string
  resolvedAlias: string | null
  summaryKind: 'activity' | 'bodyState' | 'recovery' | 'sleep'
  unit: string | null
  value: number | null
  windowDays: number
}> = {}) {
  return {
    confidence: createMetricConfidence(),
    date: '2026-04-05',
    delta: null,
    max: 48,
    metric: 'hrv' as const,
    min: 48,
    notes: [],
    paths: ['derived/query/wearables.json'],
    percentChange: null,
    priorWindow: createWindowStats(),
    provider: 'oura',
    recentWindow: createWindowStats({
      average: 48,
      count: 1,
      from: '2026-04-05',
      max: 48,
      min: 48,
      to: '2026-04-05',
    }),
    recordedAt: '2026-04-05T07:05:00.000Z',
    recordIds: ['wearable_metric_01'],
    requestedMetric: 'hrv',
    resolvedAlias: null,
    summaryKind: 'sleep' as const,
    unit: 'ms',
    value: 48,
    windowDays: 7,
    ...overrides,
  }
}

test('wearables additive commands return the shared normalized result envelopes', async () => {
  const { cli, services } = createWearablesCliAndServices()
  const vault = '/tmp/wearables-additive-vault'
  const showWearableLatest = vi.fn(
    async (_input: { requestId: string | null; vault: string }) => ({
      filters: {
        date: null,
        from: null,
        to: null,
        providers: [],
      },
      summary: createLatestSummary(),
      vault,
    }),
  )
  const showWearableMetricLatest = vi.fn(
    async (_input: { metric: string; requestId: string | null; vault: string }) => ({
      filters: {
        date: null,
        from: null,
        to: null,
        providers: [],
        metric: 'hrv',
        windowDays: 7,
      },
      summary: createMetricLatestSummary(),
      vault,
    }),
  )
  const showWearableMetricTrend = vi.fn(
    async (_input: { metric: string; requestId: string | null; vault: string }) => ({
      filters: {
        date: null,
        from: null,
        to: null,
        providers: [],
        metric: 'resting-heart-rate',
        windowDays: 7,
      },
      summary: {
        ...createMetricLatestSummary({
          delta: -3,
          max: 55,
          metric: 'restingHeartRate',
          min: 48,
          notes: ['Resting heart rate recovered over the recent window.'],
          percentChange: -5.17,
          priorWindow: createWindowStats({
            average: 58,
            count: 2,
            from: '2026-04-01',
            max: 59,
            min: 57,
            to: '2026-04-02',
          }),
          recentWindow: createWindowStats({
            average: 55,
            count: 2,
            from: '2026-04-04',
            max: 56,
            min: 54,
            to: '2026-04-05',
          }),
          requestedMetric: 'resting-heart-rate',
          resolvedAlias: 'resting-heart-rate',
          summaryKind: 'recovery',
          unit: 'bpm',
          value: 54,
        }),
        points: [
          {
            confidence: 'high' as const,
            date: '2026-04-03',
            paths: ['derived/query/wearables.json'],
            provider: 'oura',
            recordedAt: '2026-04-03T07:05:00.000Z',
            recordIds: ['wearable_metric_00'],
            unit: 'bpm',
            value: 56,
          },
          {
            confidence: 'high' as const,
            date: '2026-04-05',
            paths: ['derived/query/wearables.json'],
            provider: 'oura',
            recordedAt: '2026-04-05T07:05:00.000Z',
            recordIds: ['wearable_metric_01'],
            unit: 'bpm',
            value: 54,
          },
        ],
      },
      vault,
    }),
  )
  const showWearableDrift = vi.fn(
    async (_input: { requestId: string | null; vault: string }) => ({
      filters: {
        date: null,
        from: null,
        to: null,
        providers: [],
        windowDays: 7,
      },
      summary: {
        latest: createLatestSummary(),
        notes: ['HRV improved meaningfully over the recent window.'],
        signals: [
          createMetricLatestSummary({
            notes: ['HRV rose versus the baseline window.'],
          }),
        ],
        windowDays: 7,
      },
      vault,
    }),
  )

  Object.defineProperties(services.query, {
    showWearableDrift: {
      configurable: true,
      value: showWearableDrift,
      writable: true,
    },
    showWearableLatest: {
      configurable: true,
      value: showWearableLatest,
      writable: true,
    },
    showWearableMetricLatest: {
      configurable: true,
      value: showWearableMetricLatest,
      writable: true,
    },
    showWearableMetricTrend: {
      configurable: true,
      value: showWearableMetricTrend,
      writable: true,
    },
  })

  const latestResult = await runInProcessJsonCli<{
    filters: {
      date: string | null
      from: string | null
      providers: string[]
      to: string | null
    }
    summary: {
      latestDate: string
      notes: string[]
    } | null
    vault: string
  }>(cli, [
    'wearables',
    'latest',
    '--vault',
    vault,
    '--from',
    '2026-04-01',
    '--to',
    '2026-04-05',
    '--provider',
    ' oura ',
    '--provider',
    'oura',
  ])
  assert.equal(latestResult.exitCode, null)
  assert.equal(requireData(latestResult.envelope).vault, vault)
  assert.equal(requireData(latestResult.envelope).summary?.latestDate, '2026-04-05')
  assert.deepEqual(showWearableLatest.mock.calls[0]?.[0], {
    date: undefined,
    from: '2026-04-01',
    providers: ['oura'],
    requestId: null,
    to: '2026-04-05',
    vault,
  })

  const metricLatestResult = await runInProcessJsonCli<{
    filters: {
      metric: string
      windowDays: number
    }
    summary: {
      metric: string
      requestedMetric: string
      value: number | null
    } | null
  }>(cli, [
    'wearables',
    'metric',
    'latest',
    'hrv',
    '--vault',
    vault,
    '--date',
    '2026-04-05',
    '--provider',
    'whoop',
    '--window-days',
    '5',
  ])
  assert.equal(metricLatestResult.exitCode, null)
  assert.equal(requireData(metricLatestResult.envelope).summary?.metric, 'hrv')
  assert.equal(requireData(metricLatestResult.envelope).summary?.requestedMetric, 'hrv')
  assert.deepEqual(showWearableMetricLatest.mock.calls[0]?.[0], {
    date: '2026-04-05',
    from: undefined,
    metric: 'hrv',
    providers: ['whoop'],
    requestId: null,
    to: undefined,
    vault,
    windowDays: 5,
  })

  const metricTrendResult = await runInProcessJsonCli<{
    filters: {
      metric: string
    }
    summary: {
      metric: string
      points: Array<{
        date: string
      }>
    } | null
  }>(cli, [
    'wearables',
    'metric',
    'trend',
    'resting-heart-rate',
    '--vault',
    vault,
    '--from',
    '2026-04-01',
    '--to',
    '2026-04-05',
    '--provider',
    'oura',
    '--window-days',
    '9',
  ])
  assert.equal(metricTrendResult.exitCode, null)
  assert.equal(requireData(metricTrendResult.envelope).summary?.metric, 'restingHeartRate')
  assert.deepEqual(requireData(metricTrendResult.envelope).summary?.points.map((point) => point.date), [
    '2026-04-03',
    '2026-04-05',
  ])
  assert.deepEqual(showWearableMetricTrend.mock.calls[0]?.[0], {
    date: undefined,
    from: '2026-04-01',
    metric: 'resting-heart-rate',
    providers: ['oura'],
    requestId: null,
    to: '2026-04-05',
    vault,
    windowDays: 9,
  })

  const driftResult = await runInProcessJsonCli<{
    summary: {
      notes: string[]
    } | null
  }>(cli, [
    'wearables',
    'drift',
    '--vault',
    vault,
    '--date',
    '2026-04-05',
    '--provider',
    'whoop',
    '--window-days',
    '6',
  ])
  assert.equal(driftResult.exitCode, null)
  assert.deepEqual(requireData(driftResult.envelope).summary?.notes, [
    'HRV improved meaningfully over the recent window.',
  ])
  assert.deepEqual(showWearableDrift.mock.calls[0]?.[0], {
    date: '2026-04-05',
    from: undefined,
    providers: ['whoop'],
    requestId: null,
    to: undefined,
    vault,
    windowDays: 6,
  })
})
