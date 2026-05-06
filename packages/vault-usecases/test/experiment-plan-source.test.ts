import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createIntegratedVaultServices } from '../src/vault-services.ts'

function baseExperimentPlanPayload() {
  return {
    experiment: {
      slug: 'sleep-reset',
      title: 'Sleep Reset',
    },
    runPlan: {
      interventionStart: '2026-05-01',
      interventionEnd: '2026-05-07',
    },
    analysisPlan: {
      primaryBiomarkerKey: 'biomarker:sleep-efficiency',
    },
  }
}

test('experiment plan payloads require an explicit source kind', async () => {
  const services = createIntegratedVaultServices()

  await assert.rejects(
    services.core.planExperiment({
      vault: '/tmp/murph-vault',
      requestId: null,
      payload: baseExperimentPlanPayload(),
    }),
    /source/u,
  )
})

test('custom experiment plans reject protocol lineage fields', async () => {
  const services = createIntegratedVaultServices()

  await assert.rejects(
    services.core.planExperiment({
      vault: '/tmp/murph-vault',
      requestId: null,
      payload: {
        ...baseExperimentPlanPayload(),
        source: { kind: 'custom' },
        commonsProtocolRef: {
          key: 'protocol_variant:dry-sauna/murph-finnish-standard-3x-week',
          pageRevisionId:
            'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          runSpecRevisionId:
            'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        },
      },
    }),
    /Custom experiment plans must not include protocol references/u,
  )
})

test('Health Commons protocol-backed experiment plans require commonsProtocolRef', async () => {
  const services = createIntegratedVaultServices()

  await assert.rejects(
    services.core.planExperiment({
      vault: '/tmp/murph-vault',
      requestId: null,
      payload: {
        ...baseExperimentPlanPayload(),
        source: { kind: 'health_commons_protocol' },
      },
    }),
    /commonsProtocolRef/u,
  )
})

test('custom experiment plans can be planned once explicitly marked custom', async () => {
  const services = createIntegratedVaultServices()

  const result = await services.core.planExperiment({
    vault: '/tmp/murph-vault',
    requestId: null,
    payload: {
      ...baseExperimentPlanPayload(),
      source: { kind: 'custom' },
    },
  })

  assert.deepEqual(result.plan.operations, ['experiment_create', 'experiment_update'])
})
