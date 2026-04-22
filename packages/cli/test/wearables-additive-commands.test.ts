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

function createResolvedMetric(metric: string, value: number) {
  return {
    candidates: [],
    confidence: {
      candidateCount: 1,
      conflictingProviders: [],
      exactDuplicateCount: 0,
      level: 'high' as const,
      reasons: [],
    },
    metric,
    selection: {
      fallbackFromMetric: null,
      fallbackReason: null,
      occurredAt: '2026-04-05T07:00:00.000Z',
      paths: ['derived/query/wearables.json'],
      provider: 'oura',
      recordedAt: '2026-04-05T07:05:00.000Z',
      recordIds: ['wearable_metric_01'],
      resolution: 'direct' as const,
      sourceFamily: 'canonical' as const,
      sourceKind: 'daily_observation',
      title: null,
      unit: metric === 'hrv' ? 'ms' : 'bpm',
      value,
    },
  }
}

test('wearables additive commands call the additive query seam and backfill metric metadata when needed', async () => {
  const { cli, services } = createWearablesCliAndServices()
  const vault = '/tmp/wearables-additive-vault'
  const showWearableLatest = vi.fn(
    async (_input: { requestId: string | null; vault: string }) => ({
    summary: {
      activity: null,
      bodyState: null,
      highlights: ['No wearable summaries were available for the selected range.'],
      latestDate: null,
      providers: [],
      recovery: null,
      sleep: null,
      sourceHealth: [],
    },
    vault,
  }))
  const showWearableMetricLatest = vi.fn(
    async (_input: { metric: string; requestId: string | null; vault: string }) => ({
    latest: {
      date: '2026-04-05',
      resolvedMetric: createResolvedMetric('hrv', 48),
      unit: 'ms',
      value: 48,
    },
    vault,
  }))
  const showWearableMetricTrend = vi.fn(
    async (_input: { metric: string; requestId: string | null; vault: string }) => ({
    trend: {
      notes: ['HRV recovered over the recent window.'],
      points: [
        {
          date: '2026-04-03',
          resolvedMetric: createResolvedMetric('hrv', 42),
          unit: 'ms',
          value: 42,
        },
        {
          date: '2026-04-05',
          resolvedMetric: createResolvedMetric('hrv', 48),
          unit: 'ms',
          value: 48,
        },
      ],
      windowDays: 7,
    },
    vault,
  }))
  const showWearableDrift = vi.fn(
    async (_input: { requestId: string | null; vault: string }) => ({
    drift: {
      latestDate: '2026-04-05',
      metrics: [
        {
          direction: 'up' as const,
          metric: 'hrv' as const,
          notes: ['HRV rose versus the baseline window.'],
        },
      ],
      summary: ['HRV improved meaningfully over the recent window.'],
    },
    vault,
  }))

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
    summary: {
      highlights: string[]
    } | null
    vault: string
  }>(cli, ['wearables', 'latest', '--vault', vault])
  assert.equal(latestResult.exitCode, null)
  assert.equal(requireData(latestResult.envelope).vault, vault)
  assert.deepEqual(showWearableLatest.mock.calls[0]?.[0], {
    requestId: null,
    vault,
  })

  const metricLatestResult = await runInProcessJsonCli<{
    latest: {
      value?: number | null
    } | null
    metric: {
      input: string
      resolved: string | null
    }
  }>(cli, ['wearables', 'metric', 'latest', 'hrv', '--vault', vault])
  assert.equal(metricLatestResult.exitCode, null)
  assert.deepEqual(requireData(metricLatestResult.envelope).metric, {
    input: 'hrv',
    resolved: 'hrv',
  })
  assert.deepEqual(showWearableMetricLatest.mock.calls[0]?.[0], {
    metric: 'hrv',
    requestId: null,
    vault,
  })

  const metricTrendResult = await runInProcessJsonCli<{
    metric: {
      input: string
      resolved: string | null
    }
    trend: {
      points: Array<{
        date: string
      }>
    } | null
  }>(cli, ['wearables', 'metric', 'trend', 'resting-heart-rate', '--vault', vault])
  assert.equal(metricTrendResult.exitCode, null)
  assert.deepEqual(requireData(metricTrendResult.envelope).metric, {
    input: 'resting-heart-rate',
    resolved: 'restingHeartRate',
  })
  assert.deepEqual(showWearableMetricTrend.mock.calls[0]?.[0], {
    metric: 'resting-heart-rate',
    requestId: null,
    vault,
  })

  const driftResult = await runInProcessJsonCli<{
    drift: {
      summary: string[]
    } | null
  }>(cli, ['wearables', 'drift', '--vault', vault])
  assert.equal(driftResult.exitCode, null)
  assert.deepEqual(requireData(driftResult.envelope).drift?.summary, [
    'HRV improved meaningfully over the recent window.',
  ])
  assert.deepEqual(showWearableDrift.mock.calls[0]?.[0], {
    requestId: null,
    vault,
  })
})
