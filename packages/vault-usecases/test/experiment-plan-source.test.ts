import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import { importDeviceBatch, upsertProtocol } from '@murphai/core'
import { loadGeneratedHealthCommonsProtocolRunSpecs } from '@murphai/health-commons/runtime'

import { buildEffectiveProtocolSnapshotFromPrivateProtocol } from '../src/usecases/experiment-journal-vault.ts'
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

test('withdrawn Health Commons protocols fail plan and start without creating a run', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    const payload = {
      ...baseExperimentPlanPayload(),
      source: { kind: 'health_commons_protocol' },
      commonsProtocolRef: {
        key: 'protocol_variant:bedtime-transition/standard-tiny-fallback-transition',
        pageRevisionId: `sha256:${'5'.repeat(64)}`,
        runSpecRevisionId: `sha256:${'6'.repeat(64)}`,
      },
      effectiveProtocolSnapshot: {
        effectiveSpecHash: `sha256:${'7'.repeat(64)}`,
        doseSignature: 'Use the standard, tiny, or fallback bedtime transition',
      },
    }

    for (const attempt of [
      () => services.core.planExperiment({ vault, requestId: null, payload }),
      () => services.core.startExperiment({ vault, requestId: null, payload }),
    ]) {
      await assert.rejects(
        attempt(),
        /no longer available to start.*currently runnable protocol/u,
      )
    }

    await assert.rejects(
      services.query.showExperiment({
        vault,
        requestId: null,
        lookup: 'sleep-reset',
      }),
      /No experiment found/u,
    )
  })
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

test('protocol daily frequency persists repeated explicit-occurrence adherence', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    const protocol = loadGeneratedHealthCommonsProtocolRunSpecs().protocols.find(
      (entry) =>
        entry.key ===
        'protocol_variant:dry-sauna/murph-finnish-standard-3x-week',
    )
    assert.ok(protocol?.protocol)

    await services.core.startExperiment({
      vault,
      requestId: null,
      payload: {
        source: { kind: 'health_commons_protocol' },
        experiment: {
          slug: 'synthetic-micro-set-frequency',
          title: 'Synthetic micro-set frequency',
          startedOn: '2026-06-01',
          status: 'active',
        },
        commonsProtocolRef: {
          key: protocol.key,
          pageRevisionId: protocol.revision.pageRevisionId,
          runSpecRevisionId: protocol.revision.runSpecRevisionId,
        },
        effectiveProtocolSnapshot: {
          effectiveSpecHash: protocol.revision.runSpecRevisionId,
          doseSignature: 'Eight synthetic micro-sets daily',
          modality: 'micro set',
          frequency: { sessionsPerDay: 8 },
          targetSessions: 2920,
          minimumUsefulSessions: 2800,
        },
        runPlan: {
          modality: 'Micro set',
          targetSessions: 2920,
          minimumUsefulSessions: 2800,
          interventionStart: '2026-06-01',
          interventionEnd: '2027-05-31',
          schedule: {
            kind: 'dailyLocal',
            localTime: '09:30',
            timeZone: 'America/New_York',
          },
        },
        analysisPlan: {
          primaryBiomarkerKey: 'biomarker:resting-heart-rate',
        },
        onboarding: {
          completedAt: '2026-05-31T12:00:00.000Z',
        },
      },
    })

    const runPlan = await readPersistedRunPlan({
      services,
      vault,
      lookup: 'synthetic-micro-set-frequency',
    })
    const targets = runPlan.adherenceTargets as Array<Record<string, unknown>>
    const target = requireRecord(targets[0], 'adherence target')
    const calendar = requireRecord(target.calendar, 'adherence calendar')
    const evidence = requireRecord(target.evidence, 'adherence evidence')

    assert.equal(calendar.kind, 'daily')
    assert.equal(calendar.targetCountPerDay, 8)
    assert.equal(evidence.eventKind, 'intervention_session')
    assert.equal(evidence.missing, 'missed_after_grace')
  })
})

test('Health Commons protocol starts persist snapshot activity evidence in the adherence target', async () => {
  await withInitializedVault(async ({ services, vault }) => {
    const protocol = loadGeneratedHealthCommonsProtocolRunSpecs().protocols.find(
      (entry) =>
        entry.key ===
        'protocol_variant:dry-sauna/murph-finnish-standard-3x-week',
    )
    assert.ok(protocol?.protocol)
    const activitySessionEvidence = {
      activityKinds: ['walking', 'cycling', 'rowing', 'elliptical'],
      minimumDurationMinutes: 35,
    }

    await services.core.startExperiment({
      vault,
      requestId: null,
      payload: {
        source: { kind: 'health_commons_protocol' },
        experiment: {
          slug: 'multi-activity-cardio',
          title: 'Multi-activity cardio',
          startedOn: '2026-06-01',
          status: 'active',
        },
        commonsProtocolRef: {
          key: protocol.key,
          pageRevisionId: protocol.revision.pageRevisionId,
          runSpecRevisionId: protocol.revision.runSpecRevisionId,
        },
        effectiveProtocolSnapshot: {
          effectiveSpecHash: protocol.revision.runSpecRevisionId,
          doseSignature: 'Three 35-minute easy cardio sessions each week',
          modality: 'cycling',
          activitySessionEvidence,
          targetSessions: 12,
          minimumUsefulSessions: 9,
        },
        runPlan: {
          modality: 'Cycling',
          targetSessions: 12,
          minimumUsefulSessions: 9,
          interventionStart: '2026-06-01',
          interventionEnd: '2026-06-28',
          schedule: {
            kind: 'dailyLocal',
            localTime: '07:00',
            timeZone: 'UTC',
          },
        },
        analysisPlan: {
          primaryBiomarkerKey: 'biomarker:resting-heart-rate',
        },
        onboarding: {
          completedAt: '2026-05-31T12:00:00.000Z',
        },
      },
    })

    await importDeviceBatch({
      vaultRoot: vault,
      provider: 'junction',
      accountId: 'multi-activity-cardio-test',
      importedAt: '2026-06-03T12:00:00.000Z',
      events: [
        {
          kind: 'activity_session',
          occurredAt: '2026-06-01T07:00:00.000Z',
          recordedAt: '2026-06-01T08:00:00.000Z',
          title: 'Rowing',
          externalRef: {
            system: 'junction',
            resourceType: 'test-workouts',
            resourceId: 'qualifying-row',
            facet: 'session',
          },
          fields: {
            activityType: 'rowing',
            durationMinutes: 40,
            workout: {
              sourceApp: 'test',
              sourceWorkoutId: 'qualifying-row',
              startedAt: '2026-06-01T07:00:00.000Z',
              endedAt: '2026-06-01T07:40:00.000Z',
              exercises: [],
            },
          },
        },
        {
          kind: 'activity_session',
          occurredAt: '2026-06-02T07:00:00.000Z',
          recordedAt: '2026-06-02T08:00:00.000Z',
          title: 'Short walk',
          externalRef: {
            system: 'junction',
            resourceType: 'test-workouts',
            resourceId: 'short-walk',
            facet: 'session',
          },
          fields: {
            activityType: 'walking',
            durationMinutes: 20,
            workout: {
              sourceApp: 'test',
              sourceWorkoutId: 'short-walk',
              startedAt: '2026-06-02T07:00:00.000Z',
              endedAt: '2026-06-02T07:20:00.000Z',
              exercises: [],
            },
          },
        },
      ],
    })

    const shown = await services.query.showExperiment({
      vault,
      requestId: null,
      lookup: 'multi-activity-cardio',
    })
    const data = requireRecord(shown.entity.data, 'experiment data')
    const snapshot = requireRecord(
      data.effectiveProtocolSnapshot,
      'effectiveProtocolSnapshot',
    )
    const snapshotEvidence = requireRecord(
      snapshot.activitySessionEvidence,
      'effectiveProtocolSnapshot.activitySessionEvidence',
    )
    const runPlan = requireRecord(data.runPlan, 'runPlan')
    assert.ok(Array.isArray(runPlan.adherenceTargets))
    assert.equal(runPlan.adherenceTargets.length, 1)
    const adherenceTarget = requireRecord(
      runPlan.adherenceTargets[0],
      'runPlan.adherenceTargets[0]',
    )
    const targetEvidence = requireRecord(
      adherenceTarget.evidence,
      'runPlan.adherenceTargets[0].evidence',
    )

    assert.deepEqual(snapshotEvidence, activitySessionEvidence)
    assert.deepEqual(targetEvidence, {
      kind: 'linkedEventCount',
      eventKind: 'activity_session',
      activityKinds: ['walking', 'cycling', 'rowing', 'elliptical'],
      minimumDurationMinutes: 35,
      missing: 'missed_after_grace',
    })

    const progress = await services.query.showExperimentProgress({
      vault,
      requestId: null,
      lookup: 'multi-activity-cardio',
      asOf: '2026-06-03',
    })
    assert.equal(progress.progress.adherence.completedSessions, 1)
    assert.deepEqual(progress.progress.adherence.evidence, {
      eventKind: 'activity_session',
      activityKinds: ['walking', 'cycling', 'rowing', 'elliptical'],
      minimumDurationMinutes: 35,
    })
  })
})

test('private protocol snapshot construction preserves activity evidence', async () => {
  await withInitializedVault(async ({ vault }) => {
    const activitySessionEvidence = {
      activityKinds: ['walking', 'cycling', 'rowing', 'elliptical'],
      minimumDurationMinutes: 35,
    }
    const protocol = await upsertProtocol({
      vaultRoot: vault,
      slug: 'private-multi-activity-cardio',
      title: 'Private multi-activity cardio',
      frontmatter: {
        commonsProtocolRef: {
          key: 'protocol_variant:aerobic-base-training/zone-2-aerobic-base-block',
          pageRevisionId: `sha256:${'1'.repeat(64)}`,
          runSpecRevisionId: `sha256:${'2'.repeat(64)}`,
        },
        lineage: {
          sourceKind: 'health_commons_protocol',
        },
        diff: [],
        effectiveSpec: {
          doseSignature: 'Three 35-minute easy cardio sessions each week',
          modality: 'cycling',
          activitySessionEvidence,
          targetSessions: 12,
          minimumUsefulSessions: 9,
        },
        personalization: {},
      },
    })

    const snapshot = buildEffectiveProtocolSnapshotFromPrivateProtocol(
      protocol.record.entity,
    )

    assert.deepEqual(snapshot.activitySessionEvidence, activitySessionEvidence)
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
