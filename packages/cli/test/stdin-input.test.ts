import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { requireData, runCli } from './cli-test-helpers.js'

test('payload-based commands accept stdin via --input -', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-stdin-'))

  try {
    await runCli(['init', '--vault', vaultRoot])

    const goalUpsert = await runCli<{
      goalId: string
    }>(
      ['goal', 'upsert', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          title: 'Sleep longer',
          status: 'active',
          horizon: 'long_term',
          domains: ['sleep'],
        }),
      },
    )

    assert.equal(goalUpsert.ok, true)
    const goalId = requireData(goalUpsert).goalId
    assert.match(goalId, /^goal_/u)

    const profileUpsert = await runCli<{
      snapshotId: string
      currentProfilePath: string
      profile: {
        goals: {
          topGoalIds: string[]
        }
      }
    }>(
      ['profile', 'upsert', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          source: 'manual',
          profile: {
            goals: {
              topGoalIds: [goalId],
            },
          },
        }),
      },
    )

    assert.equal(profileUpsert.ok, true)
    assert.match(requireData(profileUpsert).snapshotId, /^psnap_/u)
    assert.equal(
      requireData(profileUpsert).currentProfilePath,
      'bank/profile/current.md',
    )
    assert.deepEqual(requireData(profileUpsert).profile.goals.topGoalIds, [goalId])

    const profileShow = await runCli<{
      entity: {
        id: string
        data: {
          topGoalIds: string[]
        }
      }
    }>(['profile', 'show', 'current', '--vault', vaultRoot])

    assert.equal(profileShow.ok, true)
    assert.equal(requireData(profileShow).entity.id, 'current')
    assert.deepEqual(requireData(profileShow).entity.data.topGoalIds, [goalId])

    const historyUpsert = await runCli<{
      eventId: string
      lookupId: string
      ledgerFile: string
    }>(
      ['history', 'upsert', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          kind: 'encounter',
          occurredAt: '2026-03-12T13:00:00.000Z',
          title: 'Primary care follow-up',
          encounterType: 'office_visit',
          location: 'Primary care clinic',
        }),
      },
    )

    assert.equal(historyUpsert.ok, true)
    assert.match(requireData(historyUpsert).eventId, /^evt_/u)
    assert.equal(
      requireData(historyUpsert).lookupId,
      requireData(historyUpsert).eventId,
    )
    assert.equal(
      requireData(historyUpsert).ledgerFile,
      'ledger/events/2026/2026-03.jsonl',
    )

    const bloodTestUpsert = await runCli<{
      eventId: string
      lookupId: string
      ledgerFile: string
    }>(
      ['blood-test', 'upsert', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          occurredAt: '2026-03-12T14:00:00.000Z',
          title: 'Functional health panel',
          testName: 'functional_health_panel',
          labName: 'Function Health',
          results: [
            {
              analyte: 'Apolipoprotein B',
              value: 87,
              unit: 'mg/dL',
              flag: 'normal',
            },
            {
              analyte: 'LDL Cholesterol',
              value: 134,
              unit: 'mg/dL',
              flag: 'high',
            },
          ],
        }),
      },
    )

    assert.equal(bloodTestUpsert.ok, true)
    assert.match(requireData(bloodTestUpsert).eventId, /^evt_/u)
    assert.equal(
      requireData(bloodTestUpsert).lookupId,
      requireData(bloodTestUpsert).eventId,
    )
    assert.equal(
      requireData(bloodTestUpsert).ledgerFile,
      'ledger/events/2026/2026-03.jsonl',
    )

    const providerUpsert = await runCli<{
      providerId: string
      path: string
    }>(
      ['provider', 'upsert', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          title: 'Sleep Clinic',
          status: 'active',
          specialty: 'sleep medicine',
        }),
      },
    )

    assert.equal(providerUpsert.ok, true)
    assert.match(requireData(providerUpsert).providerId, /^prov_/u)

    const eventUpsert = await runCli<{
      eventId: string
      ledgerFile: string
    }>(
      ['event', 'upsert', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          kind: 'note',
          occurredAt: '2026-03-12T09:30:00.000Z',
          title: 'Slept better after routine change',
          note: 'Fell asleep within twenty minutes.',
          tags: ['sleep'],
        }),
      },
    )

    assert.equal(eventUpsert.ok, true)
    assert.match(requireData(eventUpsert).eventId, /^evt_/u)

    const samplesAdd = await runCli<{
      addedCount: number
      lookupIds: string[]
    }>(
      ['samples', 'add', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          stream: 'heart_rate',
          unit: 'bpm',
          samples: [
            {
              recordedAt: '2026-03-12T08:00:00Z',
              value: 61,
            },
          ],
        }),
      },
    )

    assert.equal(samplesAdd.ok, true)
    assert.equal(requireData(samplesAdd).addedCount, 1)
    assert.equal(requireData(samplesAdd).lookupIds.length, 1)

    const createdExperiment = await runCli<{
      experimentId: string
      experimentPath: string
    }>([
      'experiment',
      'create',
      'sleep-reset',
      '--title',
      'Sleep Reset',
      '--vault',
      vaultRoot,
    ])

    assert.equal(createdExperiment.ok, true)

    const experimentId = requireData(createdExperiment).experimentId
    const experimentPath = requireData(createdExperiment).experimentPath

    const experimentUpdate = await runCli<{
      experimentId: string
      experimentPath: string
      updated: boolean
    }>(
      ['experiment', 'update', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          lookup: experimentId,
          title: 'Sleep Reset Sprint',
          hypothesis: 'Earlier light exposure will improve sleep onset.',
          status: 'active',
          body: '# Sleep Reset Sprint\n\nTrack morning light and evening screens.\n',
          tags: ['sleep-reset', 'light'],
        }),
      },
    )

    assert.equal(experimentUpdate.ok, true)
    assert.equal(requireData(experimentUpdate).updated, true)

    const experimentCheckpoint = await runCli<{
      eventId: string
      experimentId: string
    }>(
      ['experiment', 'checkpoint', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          lookup: experimentId,
          occurredAt: '2026-03-12T22:15:00.000Z',
          title: 'Evening checkpoint',
          note: 'Screens off by 9:30 pm.',
        }),
      },
    )

    assert.equal(experimentCheckpoint.ok, true)
    assert.match(requireData(experimentCheckpoint).eventId, /^evt_/u)

    const experimentMarkdown = await readFile(
      path.join(vaultRoot, experimentPath),
      'utf8',
    )

    assert.match(experimentMarkdown, /Sleep Reset Sprint/u)
    assert.match(experimentMarkdown, /Earlier light exposure/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('payload-based commands reject empty stdin with an actionable message', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-stdin-'))

  try {
    await runCli(['init', '--vault', vaultRoot])

    const result = await runCli(
      ['goal', 'upsert', '--input', '-', '--vault', vaultRoot],
      { stdin: '' },
    )

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'command_failed')
    assert.equal(result.error.message, 'No payload was piped to stdin.')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('payload-based commands reject non-object stdin JSON', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-stdin-'))

  try {
    await runCli(['init', '--vault', vaultRoot])

    const result = await runCli(
      ['goal', 'upsert', '--input', '-', '--vault', vaultRoot],
      { stdin: '[]' },
    )

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid_payload')
    assert.equal(result.error.message, 'payload must contain a JSON object.')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
