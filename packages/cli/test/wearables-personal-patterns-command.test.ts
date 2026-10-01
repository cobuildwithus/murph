import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { test, vi } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  registerWearablesCommands,
  wearablesPersonalPatternsResultSchema,
} from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

test('wearables patterns exposes the shared report to the assistant', async () => {
  const cli = Cli.create('vault-cli', {
    description: 'personal patterns cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()
  registerWearablesCommands(cli, services)

  const showPersonalPatterns = vi.fn(async () => ({
    filters: {
      date: '2026-08-06',
      windowDays: 90,
    },
    report: {
      asOfDate: '2026-08-06',
      cells: [{
        classification: 'early_signal' as const,
        comparisonBasis: 'confirmed_absence' as const,
        comparisonDates: ['2026-07-20'],
        comparisonDays: 2,
        comparisonMean: 80,
        delta: -20,
        deltaPercent: -25,
        direction: 'lower' as const,
        exposedDates: ['2026-07-13'],
        exposedDays: 2,
        exposedMean: 60,
        factorId: 'late-caffeine',
        firstExposedDate: '2026-07-13',
        grade: 'D' as const,
        lastExposedDate: '2026-07-27',
        outcomeId: 'sleep-score',
        repeatedDirection: true,
        stage: 'new_clue' as const,
      }],
      factors: [{
        confirmedAbsentDays: 2,
        id: 'late-caffeine',
        kind: 'intervention' as const,
        label: 'Late caffeine',
        observedDays: 2,
      }],
      lagDays: 1 as const,
      notes: [],
      outcomes: [{
        id: 'sleep-score',
        label: 'Sleep score',
        lagDays: 1 as const,
        unit: 'score',
      }],
      repeatableCellCount: 1,
      testedCellCount: 1,
      windowDays: 90,
    },
    vault: '/tmp/personal-patterns-vault',
  }))
  Object.defineProperty(services.query, 'showPersonalPatterns', {
    configurable: true,
    value: showPersonalPatterns,
    writable: true,
  })

  const result = await runInProcessJsonCli(cli, [
    'wearables',
    'patterns',
    '--vault',
    '/tmp/personal-patterns-vault',
    '--date',
    '2026-08-06',
    '--window-days',
    '90',
  ])

  assert.equal(result.exitCode, null)
  const data = requireData(result.envelope)
  assert.equal('vault' in data, false)
  assert.deepEqual(showPersonalPatterns.mock.calls, [[{
    date: '2026-08-06',
    requestId: null,
    vault: '/tmp/personal-patterns-vault',
    windowDays: 90,
  }]])
  assert.equal(
    wearablesPersonalPatternsResultSchema.parse(data).report.asOfDate,
    '2026-08-06',
  )
  assert.equal(
    wearablesPersonalPatternsResultSchema.parse(data).report.cells[0]?.grade,
    'D',
  )
})
