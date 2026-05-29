import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { requireData, runCli } from './cli-test-helpers.js'

const STDIN_INPUT_SMOKE_TIMEOUT_MS = 120_000

test('explicit JSON import commands accept stdin via --input -', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-stdin-'))

  try {
    await runCli(['init', '--vault', vaultRoot])

    const goalImportJson = await runCli<{
      goalId: string
    }>(
      ['goal', 'import-json', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          title: 'Sleep longer',
          status: 'active',
          horizon: 'long_term',
          domains: ['sleep'],
        }),
      },
    )

    assert.equal(goalImportJson.ok, true)
    const goalId = requireData(goalImportJson).goalId
    assert.match(goalId, /^goal_/u)

    assert.equal(goalId.length > 0, true)

    const bloodTestImportJson = await runCli<{
      eventId: string
      lookupId: string
      ledgerFile: string
    }>(
      ['blood-test', 'import-json', '--input', '-', '--vault', vaultRoot],
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

    assert.equal(bloodTestImportJson.ok, true)
    assert.match(requireData(bloodTestImportJson).eventId, /^evt_/u)
    assert.equal(
      requireData(bloodTestImportJson).lookupId,
      requireData(bloodTestImportJson).eventId,
    )
    assert.equal(
      requireData(bloodTestImportJson).ledgerFile,
      'ledger/events/2026/2026-03.jsonl',
    )

    const scheduledLogImportJson = await runCli<{
      scheduledLogId: string
      lookupId: string
      path: string
    }>(
      ['scheduled-log', 'import-json', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          title: 'Daily sauna',
          slug: 'daily-sauna',
          status: 'active',
          schedule: { kind: 'dailyLocal', localTime: '18:00' },
          action: {
            kind: 'intervention_session.add',
            title: 'Sauna',
            interventionType: 'sauna',
            durationMinutes: 20,
          },
          summary: 'Auto-log a daily sauna session.',
          tags: ['scheduled', 'sauna'],
          body: 'Writes a derived sauna session at the scheduled local time.',
        }),
      },
    )

    assert.equal(scheduledLogImportJson.ok, true)
    assert.match(requireData(scheduledLogImportJson).scheduledLogId, /^slog_/u)
    assert.equal(requireData(scheduledLogImportJson).lookupId, 'daily-sauna')
    assert.equal(
      requireData(scheduledLogImportJson).path,
      'bank/scheduled-logs/daily-sauna.md',
    )

    const providerImportJson = await runCli<{
      providerId: string
      path: string
    }>(
      ['provider', 'import-json', '--input', '-', '--vault', vaultRoot],
      {
        stdin: JSON.stringify({
          title: 'Sleep Clinic',
          status: 'active',
          specialty: 'sleep medicine',
        }),
      },
    )

    assert.equal(providerImportJson.ok, true)
    assert.match(requireData(providerImportJson).providerId, /^prov_/u)

    const eventUpsert = await runCli<{
      eventId: string
      ledgerFile: string
    }>(
      ['event', 'import-json', '--input', '-', '--vault', vaultRoot],
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
      ['samples', 'import-json', '--input', '-', '--vault', vaultRoot],
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
      experiment: {
        experimentId: string
        experimentPath: string
      } | null
    }>([
      'experiment',
      'start',
      'sleep-reset',
      '--custom',
      '--no-public-protocol',
      '--title',
      'Sleep Reset Sprint',
      '--hypothesis',
      'Earlier light exposure will improve sleep onset.',
      '--intervention-start',
      '2026-03-12',
      '--intervention-days',
      '7',
      '--primary-biomarker-key',
      'biomarker:sleep-efficiency',
      '--vault',
      vaultRoot,
    ])

    assert.equal(createdExperiment.ok, true)

    const experiment = requireData(createdExperiment).experiment
    assert.ok(experiment)

    const experimentCheckpoint = await runCli<{
      eventId: string
      experimentId: string
    }>([
      'experiment',
      'checkpoint',
      experiment.experimentId,
      '--occurred-at',
      '2026-03-12T22:15:00.000Z',
      '--title',
      'Evening checkpoint',
      '--note',
      'Screens off by 9:30 pm.',
      '--vault',
      vaultRoot,
    ])

    assert.equal(experimentCheckpoint.ok, true)
    assert.match(requireData(experimentCheckpoint).eventId, /^evt_/u)

    const experimentMarkdown = await readFile(
      path.join(vaultRoot, experiment.experimentPath),
      'utf8',
    )

    assert.match(experimentMarkdown, /Sleep Reset Sprint/u)
    assert.match(experimentMarkdown, /Earlier light exposure/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, STDIN_INPUT_SMOKE_TIMEOUT_MS)

test('payload-based commands reject empty stdin with an actionable message', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-stdin-'))

  try {
    await runCli(['init', '--vault', vaultRoot])

    const result = await runCli(
      ['goal', 'import-json', '--input', '-', '--vault', vaultRoot],
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
      ['goal', 'import-json', '--input', '-', '--vault', vaultRoot],
      { stdin: '[]' },
    )

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid_payload')
    assert.equal(result.error.message, 'payload must contain a JSON object.')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
