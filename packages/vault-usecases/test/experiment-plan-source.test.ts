import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(typeof value, 'object', `${label} must be an object`)
  assert.notEqual(value, null, `${label} must be an object`)
  return value as Record<string, unknown>
}

async function withInitializedVault<T>(
  callback: (input: {
    services: ReturnType<typeof createIntegratedVaultServices>
    vault: string
  }) => Promise<T>,
): Promise<T> {
  const vault = await mkdtemp(path.join(tmpdir(), 'vault-usecases-experiment-start-'))
  try {
    const services = createIntegratedVaultServices()
    await services.core.init({ vault, requestId: null, timezone: 'UTC' })
    return await callback({ services, vault })
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
}

async function readPersistedRunPlan(input: {
  services: ReturnType<typeof createIntegratedVaultServices>
  vault: string
  lookup: string
}) {
  const shown = await input.services.query.showExperiment({
    vault: input.vault,
    requestId: null,
    lookup: input.lookup,
  })
  const data = requireRecord(shown.entity.data, 'experiment data')
  return requireRecord(data.runPlan, 'experiment runPlan')
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

  assert.deepEqual(result.plan.operations, ['experiment_create'])
})

test('custom experiment starts keep calendar-less synthesized adherence read-time only', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    const result = await services.core.startExperiment({
      vault,
      requestId: null,
      payload: {
        source: { kind: 'custom' },
        experiment: {
          slug: 'running-window-count',
          title: 'Running Window Count',
          startedOn: '2026-06-01',
        },
        runPlan: {
          modality: 'Run',
          targetSessions: 4,
          interventionStart: '2026-06-01',
          interventionEnd: '2026-06-14',
        },
        analysisPlan: {
          primaryBiomarkerKey: 'biomarker:resting-heart-rate',
        },
      },
    })

    const runPlan = await readPersistedRunPlan({
      services,
      vault,
      lookup: 'running-window-count',
    })
    const markdown = await readFile(
      path.join(vault, result.experiment.experimentPath),
      'utf8',
    )

    assert.equal(runPlan.adherenceTargets, undefined)
    assert.equal(markdown.includes('adherenceTargets:'), false)
  })
})

test('custom experiment starts still persist calendar-ful synthesized adherence targets', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    const result = await services.core.startExperiment({
      vault,
      requestId: null,
      payload: {
        source: { kind: 'custom' },
        experiment: {
          slug: 'running-schedule',
          title: 'Running Schedule',
          startedOn: '2026-06-01',
        },
        runPlan: {
          modality: 'Run',
          targetSessions: 4,
          minimumUsefulSessions: 3,
          interventionStart: '2026-06-01',
          interventionEnd: '2026-06-14',
          schedule: {
            kind: 'dailyLocal',
            localTime: '07:30',
            timeZone: 'America/New_York',
          },
        },
        analysisPlan: {
          primaryBiomarkerKey: 'biomarker:resting-heart-rate',
        },
      },
    })

    const runPlan = await readPersistedRunPlan({
      services,
      vault,
      lookup: 'running-schedule',
    })
    const adherenceTargets = runPlan.adherenceTargets
    const markdown = await readFile(
      path.join(vault, result.experiment.experimentPath),
      'utf8',
    )

    assert.equal(markdown.includes('adherenceTargets:'), true)
    assert.deepEqual(adherenceTargets, [
      {
        targetId: 'run',
        label: 'Run',
        phase: 'intervention',
        evidence: {
          kind: 'linkedEventCount',
          eventKind: 'activity_session',
          activityKind: 'running',
          missing: 'missed_after_grace',
        },
        grace: { hours: 24 },
        rollup: {
          targetCompletions: 4,
          minimumUsefulCompletions: 3,
        },
        calendar: {
          kind: 'daily',
          timeZone: 'America/New_York',
          localTime: '07:30',
          targetCountPerDay: 1,
        },
      },
    ])
  })
})

test('active experiment starts reject ambiguous primary session metrics before writing', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    await assert.rejects(
      services.core.startExperiment({
        vault,
        requestId: null,
        payload: {
          source: { kind: 'custom' },
          experiment: {
            slug: 'ambiguous-sleep-latency',
            title: 'Ambiguous Sleep Latency',
            startedOn: '2026-06-01',
          },
          runPlan: {
            interventionStart: '2026-06-01',
            interventionEnd: '2026-06-14',
            logging: {
              sessionFields: [
                'sleep-onset-latency',
                'sleep_onset_latency_minutes',
              ],
            },
          },
          analysisPlan: {
            primaryBiomarkerKey: 'biomarker:sleep-onset-latency',
          },
        },
      }),
      /exactly one matching session field/u,
    )

    await assert.rejects(
      services.query.showExperiment({
        vault,
        requestId: null,
        lookup: 'ambiguous-sleep-latency',
      }),
    )
  })
})

test('active experiment edits reject ambiguous primary session metrics atomically', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    const result = await services.core.startExperiment({
      vault,
      requestId: null,
      payload: {
        source: { kind: 'custom' },
        experiment: {
          slug: 'sleep-latency-capture',
          title: 'Sleep Latency Capture',
          startedOn: '2026-06-01',
        },
        runPlan: {
          interventionStart: '2026-06-01',
          interventionEnd: '2026-06-14',
          logging: {
            sessionFields: ['sleep-onset-latency'],
          },
        },
        analysisPlan: {
          primaryBiomarkerKey: 'biomarker:sleep-onset-latency',
        },
      },
    })
    const experimentPath = path.join(vault, result.experiment.experimentPath)
    const before = await readFile(experimentPath, 'utf8')

    await assert.rejects(
      services.core.updateExperiment({
        vault,
        requestId: null,
        lookup: 'sleep-latency-capture',
        runPlan: {
          interventionStart: '2026-06-01',
          interventionEnd: '2026-06-14',
          logging: {
            sessionFields: [
              'sleep-onset-latency',
              'sleep_onset_latency_minutes',
            ],
          },
        },
      }),
      /exactly one matching session field/u,
    )

    assert.equal(await readFile(experimentPath, 'utf8'), before)
  })
})
