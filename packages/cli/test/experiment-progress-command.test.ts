import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { test, vi } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { experimentProgressResultSchema } from '../src/commands/experiment-progress-output.js'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { requireData, runInProcessJsonCli } from './cli-test-helpers.js'

const experimentId = 'exp_01JNV422Y2M5ZBV64ZP4N1DRB1'

function createProgressResult() {
  const signal = {
    baselineDayCount: 6,
    baselineMean: 81.25,
    biomarkerKey: 'biomarker:deep-sleep',
    completeness: 'good',
    deltaAbs: 3.5,
    deltaPct: 4.31,
    expectedDirection: 'increase',
    interventionDayCount: 8,
    interventionMean: 84.75,
    label: 'Deep Sleep',
    movedAsExpected: true,
    unit: 'minutes',
    baseline: { mean: 81.25, daysWithData: 6, totalDays: 7, unit: 'minutes' },
    intervention: { mean: 84.75, daysWithData: 8, totalDays: 8, unit: 'minutes' },
  }
  const readiness = { status: 'ready', blockingReasons: [] }
  return {
    vault: '/tmp/experiment-progress-vault',
    experimentId,
    lookupId: experimentId,
    slug: 'caffeine-cutoff',
    asOf: '2026-11-13',
    progress: {
      schemaVersion: 'murph.experiment-progress.v2',
      schema: 'murph.experiment-progress.v2',
      asOf: '2026-11-13',
      adherence: {
        completedSessions: 0,
        evidence: { eventKind: 'intervention_session' },
        expectedSessionsByNow: null,
        minimumUsefulSessions: null,
        status: 'not_started',
        targetSessions: null,
      },
      confounders: [],
      dataCoverage: {
        activityProviders: ['oura'],
        baselineDaysAvailable: 6,
        interventionDaysAvailable: 8,
        primaryBiomarkerKey: 'biomarker:deep-sleep',
        primaryMetricDaysAvailable: 14,
        status: 'sufficient_for_progress',
        wearableProviders: ['oura'],
      },
      dayInRun: 15,
      setupReadiness: readiness,
      analysisReadiness: readiness,
      experiment: {
        id: experimentId,
        slug: 'caffeine-cutoff',
        status: 'active',
        title: 'Caffeine cutoff at 2pm',
      },
      phase: 'intervention',
      commonsProtocolRef: null,
      protocolRef: null,
      recommendation: {
        action: 'skip',
        reason: 'Too early; no action is needed.',
        shouldNotifyUser: false,
      },
      signals: [
        signal,
        {
          ...signal,
          biomarkerKey: 'biomarker:hrv',
          label: 'HRV',
          unit: null,
          baseline: { mean: 40, daysWithData: 6, totalDays: 7, unit: 'ms' },
          intervention: { mean: 0.04, daysWithData: 8, totalDays: 8, unit: 's' },
        },
      ],
      earlySignals: [{
        biomarkerKey: 'biomarker:deep-sleep',
        label: 'Deep Sleep',
        unit: 'minutes',
        baselineMean: 81.25,
        currentInterventionMean: 84.75,
        deltaAbs: 3.5,
        expectedDirection: 'increase',
        movedAsExpected: true,
        confidence: 'medium',
        reason: 'Only 8 intervention day(s) are available so far.',
        baselineDaysAvailable: 6,
        interventionDaysAvailable: 8,
      }],
      windows: {
        baselineEnd: '2026-11-05',
        baselineStart: '2026-10-30',
        interventionEnd: '2026-11-19',
        interventionStart: '2026-11-06',
      },
      effectiveProtocolSnapshot: null,
    },
  }
}

test('experiment progress names each id, mean, and unit once', async () => {
  const cli = Cli.create('vault-cli', { description: 'experiment progress cli', version: '0.0.0-test' })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()
  registerExperimentCommands(cli, services)
  const source = createProgressResult()
  Object.defineProperty(services.query, 'showExperimentProgress', {
    configurable: true,
    value: vi.fn(async () => source),
    writable: true,
  })

  const result = await runInProcessJsonCli(cli, [
    'experiment',
    'progress',
    'caffeine-cutoff',
    '--vault',
    '/tmp/experiment-progress-vault',
  ])

  assert.equal(result.exitCode, null)
  const data = experimentProgressResultSchema.parse(requireData(result.envelope))
  assert.deepEqual(Object.keys(requireData(result.envelope)).sort(), ['asOf', 'experimentId', 'progress', 'slug'])
  assert.equal(data.experimentId, experimentId)
  assert.equal(data.slug, 'caffeine-cutoff')
  assert.equal(data.asOf, '2026-11-13')
  const progress = data.progress
  for (const omitted of ['schema', 'asOf', 'earlySignals']) {
    assert.equal(omitted in progress, false, omitted)
  }
  assert.equal(progress.schemaVersion, 'murph.experiment-progress.v2')
  assert.deepEqual(progress.experiment, { status: 'active', title: 'Caffeine cutoff at 2pm' })
  assert.deepEqual(progress.setupReadiness, source.progress.setupReadiness)
  assert.deepEqual(progress.analysisReadiness, source.progress.analysisReadiness)
  assert.deepEqual(progress.recommendation, source.progress.recommendation)
  assert.deepEqual(progress.windows, source.progress.windows)
  assert.deepEqual(progress.adherence, source.progress.adherence)
  assert.deepEqual(progress.dataCoverage, source.progress.dataCoverage)
  assert.deepEqual(progress.signals, [
    {
      biomarkerKey: 'biomarker:deep-sleep',
      completeness: 'good',
      deltaAbs: 3.5,
      deltaPct: 4.31,
      expectedDirection: 'increase',
      label: 'Deep Sleep',
      movedAsExpected: true,
      unit: 'minutes',
      baseline: { mean: 81.25, daysWithData: 6, totalDays: 7 },
      intervention: { mean: 84.75, daysWithData: 8, totalDays: 8 },
      confidence: 'medium',
    },
    {
      biomarkerKey: 'biomarker:hrv',
      completeness: 'good',
      deltaAbs: 3.5,
      deltaPct: 4.31,
      expectedDirection: 'increase',
      label: 'HRV',
      movedAsExpected: true,
      unit: null,
      // Incompatible window units stay on their periods.
      baseline: { mean: 40, daysWithData: 6, totalDays: 7, unit: 'ms' },
      intervention: { mean: 0.04, daysWithData: 8, totalDays: 8, unit: 's' },
    },
  ])
  assert.ok(
    JSON.stringify(data).length < JSON.stringify(source).length * 0.75,
    'experiment progress should shed its duplicated fields',
  )
})
