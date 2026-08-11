import assert from 'node:assert/strict'

import {
  listMetricDefinitions,
  normalizeMetricKey,
} from '@murphai/health-metrics'
import { test } from 'vitest'

import { normalizeMeasurementEntry } from '../src/usecases/measurement.js'

function toCamelCase(value: string): string {
  return value.replace(/-([a-z0-9])/gu, (_match, character: string) =>
    character.toUpperCase())
}

test('public measurement writes canonicalize the complete body and blood-pressure identity set', () => {
  const relevantDefinitions = listMetricDefinitions().filter((definition) =>
    definition.category === 'body'
    || definition.key === 'systolic-blood-pressure'
    || definition.key === 'diastolic-blood-pressure'
  )

  assert.ok(relevantDefinitions.length >= 6)
  for (const definition of relevantDefinitions) {
    for (const identity of [definition.key, ...definition.aliases]) {
      const normalizedIdentity = normalizeMetricKey(identity)
      for (const inputMetric of new Set([
        identity,
        toCamelCase(normalizedIdentity),
      ])) {
        assert.equal(
          normalizeMeasurementEntry({
            metric: inputMetric,
            unit: 'unit',
            value: 1,
          }).metric,
          definition.key,
          `${inputMetric} must persist as ${definition.key}`,
        )
      }
    }
  }
})

test('public measurement writes preserve unknown custom metric slug behavior', () => {
  assert.equal(
    normalizeMeasurementEntry({
      metric: 'CustomMetric',
      unit: 'score',
      value: 1,
    }).metric,
    'custommetric',
  )
})
