import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadGeneratedHealthCommonsProtocolRunSpecs } from '@murphai/health-commons/runtime'
import {
  resolveExperimentSessionMetricSpec,
  resolveExperimentSessionMetricSpecForBiomarker,
} from '@murphai/health-metrics'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

interface CommandSchema {
  args: {
    properties: Record<string, unknown>
    required?: string[]
  }
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

function createExperimentConfounderSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'experiment session confounder slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerReadCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: readonly string[],
): Promise<CliEnvelope<TData>> {
  const cli = createExperimentConfounderSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runRawSliceCli(args: readonly string[]): Promise<string> {
  const cli = createExperimentConfounderSliceCli()
  const output: string[] = []

  await cli.serve([...args], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('every generated protocol with a session-captured primary outcome declares exactly one matching field', () => {
  const artifact = loadGeneratedHealthCommonsProtocolRunSpecs()

  for (const protocol of artifact.protocols) {
    const sessionFields = protocol.protocol?.sessionFieldIds ?? []
    for (const plan of protocol.testPlans) {
      const primarySpec = resolveExperimentSessionMetricSpecForBiomarker(
        plan.primaryBiomarkerKey,
      )
      if (!primarySpec) {
        continue
      }

      const matches = sessionFields.filter(
        (fieldId) =>
          resolveExperimentSessionMetricSpec(fieldId)?.key === primarySpec.key,
      )
      assert.equal(
        matches.length,
        1,
        `${protocol.key} primary ${plan.primaryBiomarkerKey} must declare exactly one recognized ${primarySpec.key} session field; fields=${sessionFields.join(', ') || '(none)'}`,
      )
    }
  }
})

test('experiment session log schema exposes typed confounder map entries', async () => {
  const schema = JSON.parse(
    await runRawSliceCli([
      'experiment',
      'session',
      'log',
      '--schema',
      '--format',
      'json',
    ]),
  ) as CommandSchema

  assert.equal('lookup' in schema.args.properties, true)
  assert.equal('reminderIntentId' in schema.options.properties, true)
  assert.equal('confounders' in schema.options.properties, true)
  assert.equal('confounder' in schema.options.properties, true)
  assert.equal('field' in schema.options.properties, true)
  assert.equal('input' in schema.options.properties, false)
})

test.sequential(
  'experiment session log persists typed confounder map values and rejects ambiguous forms',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-session-confounders-'),
    )

    try {
      await runSliceCli([
        'init',
        '--vault',
        vaultRoot,
        '--timezone',
        'America/Los_Angeles',
      ])
      const created = await runSliceCli<{
        experimentId: string
        slug: string
      }>([
        'experiment',
        'start',
        'typed-confounders',
        '--custom',
        '--no-public-protocol',
        '--title',
        'Typed Confounders',
        '--started-on',
        '2026-04-01',
        '--status',
        'active',
        '--intervention-start',
        '2026-04-08',
        '--intervention-days',
        '14',
        '--primary-biomarker-key',
        'biomarker:resting-heart-rate',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const malformed = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'typed-confounders',
        '--intervention-type',
        'sauna',
        '--confounder',
        'travel',
        '--vault',
        vaultRoot,
      ])
      const mixed = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'typed-confounders',
        '--intervention-type',
        'sauna',
        '--confounders',
        'travel',
        '--confounder',
        'travel=true',
        '--vault',
        vaultRoot,
      ])

      assert.equal(malformed.ok, false)
      assert.match(malformed.error.message ?? '', /key=value/u)
      assert.equal(mixed.ok, false)
      assert.match(mixed.error.message ?? '', /--confounders.*--confounder/u)

      const logged = await runSliceCli<{
        eventId: string
        kind: string
      }>([
        'experiment',
        'session',
        'log',
        'typed-confounders',
        '--occurred-at',
        '2026-04-09T18:30:00.000Z',
        '--title',
        'Evening sauna',
        '--intervention-type',
        'sauna',
        '--duration-minutes',
        '18',
        '--confounder',
        'travel=true',
        '--confounder',
        'sleepScore=72.5',
        '--confounder',
        'supplement=null',
        '--confounder',
        'lateMeal=airport dinner',
        '--confounder',
        'highStress=false',
        '--vault',
        vaultRoot,
      ])
      assert.equal(logged.ok, true)
      assert.equal(requireData(logged).kind, 'intervention_session')

      const shown = await runSliceCli<{
        entity: {
          kind: string
          data: Record<string, unknown>
        }
      }>(['show', requireData(logged).eventId, '--vault', vaultRoot])

      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.kind, 'intervention_session')
      assert.deepEqual(requireData(shown).entity.data.confounders, {
        travel: true,
        sleepScore: 72.5,
        supplement: null,
        lateMeal: 'airport dinner',
        highStress: false,
      })
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment session fields flow from run declaration through outcome completion exactly once',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-session-fields-'),
    )

    try {
      await runSliceCli([
        'init',
        '--vault',
        vaultRoot,
        '--timezone',
        'UTC',
      ])
      const duplicateDeclaration = await runSliceCli<unknown>([
        'experiment',
        'start',
        'duplicate-sleep-diary-fields',
        '--custom',
        '--no-public-protocol',
        '--intervention-start',
        '2026-04-04',
        '--intervention-days',
        '3',
        '--primary-biomarker-key',
        'biomarker:sleep-onset-latency',
        '--session-field',
        'estimated_sleep_onset_latency_minutes',
        '--session-field',
        'sleep_onset_latency_minutes',
        '--vault',
        vaultRoot,
      ])
      assert.equal(duplicateDeclaration.ok, false)
      assert.match(
        duplicateDeclaration.error.message ?? '',
        /both resolve to canonical metric sleep-onset-latency/u,
      )

      const created = await runSliceCli<{
        experimentId: string
      }>([
        'experiment',
        'start',
        'sleep-diary',
        '--custom',
        '--no-public-protocol',
        '--title',
        'Sleep Diary',
        '--baseline-start',
        '2026-04-01',
        '--baseline-days',
        '3',
        '--intervention-start',
        '2026-04-04',
        '--intervention-days',
        '3',
        '--modality',
        'sleep-routine',
        '--target-sessions',
        '3',
        '--minimum-useful-sessions',
        '2',
        '--primary-biomarker-key',
        'biomarker:sleep-onset-latency',
        '--secondary-biomarker-key',
        'biomarker:wake-after-sleep-onset',
        '--secondary-biomarker-key',
        'biomarker:sleep-quality',
        '--secondary-biomarker-key',
        'biomarker:daytime-sleepiness',
        '--desired-direction',
        'decrease',
        '--session-field',
        'estimated_sleep_onset_latency_minutes',
        '--session-field',
        'routine-completed',
        '--session-field',
        'sleep-note',
        '--session-field',
        'optional-note',
        '--session-field',
        'wake_after_sleep_onset_minutes',
        '--session-field',
        'subjective_sleep_quality',
        '--session-field',
        'daytime_sleepiness',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true, created.ok ? undefined : created.error.message)

      const unknown = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'sleep-diary',
        '--field',
        'not-declared=10',
        '--vault',
        vaultRoot,
      ])
      const duplicate = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'sleep-diary',
        '--field',
        'estimated_sleep_onset_latency_minutes=30',
        '--field',
        'estimated_sleep_onset_latency_minutes=20',
        '--vault',
        vaultRoot,
      ])
      const outOfRange = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'sleep-diary',
        '--field',
        'estimated_sleep_onset_latency_minutes=721',
        '--vault',
        vaultRoot,
      ])

      assert.equal(unknown.ok, false)
      assert.match(unknown.error.message ?? '', /not declared.*sessionFields/u)
      assert.equal(duplicate.ok, false)
      assert.match(duplicate.error.message ?? '', /more than once/u)
      assert.equal(outOfRange.ok, false)
      assert.match(outOfRange.error.message ?? '', /between 0 and 720/u)

      const values = [45, 40, 35, 25, 20, 15] as const
      const wakeAfterSleepOnsetValues = [30, 25, 20, 20, 15, 10] as const
      const sleepQualityValues = [4, 5, 6, 6, 7, 8] as const
      const daytimeSleepinessValues = [7, 6, 5, 5, 4, 3] as const
      const loggedIds: string[] = []
      for (const [index, value] of values.entries()) {
        const date = `2026-04-0${index + 1}`
        const logged = await runSliceCli<{ eventId: string }>([
          'experiment',
          'session',
          'log',
          'sleep-diary',
          '--date',
          date,
          '--occurred-at',
          `${date}T08:00:00.000Z`,
          '--field',
          `estimated_sleep_onset_latency_minutes=${value}`,
          '--field',
          `routine-completed=${index >= 3 ? 'true' : 'false'}`,
          '--field',
          `sleep-note=${index >= 3 ? 'intervention' : 'baseline'}`,
          '--field',
          'optional-note=null',
          '--field',
          `wake_after_sleep_onset_minutes=${wakeAfterSleepOnsetValues[index]}`,
          '--field',
          `subjective_sleep_quality=${sleepQualityValues[index]}`,
          '--field',
          `daytime_sleepiness=${daytimeSleepinessValues[index]}`,
          '--vault',
          vaultRoot,
        ])
        assert.equal(logged.ok, true, logged.ok ? undefined : logged.error.message)
        loggedIds.push(requireData(logged).eventId)
      }

      const shownSession = await runSliceCli<{
        entity: { data: Record<string, unknown> }
      }>(['show', loggedIds[3] ?? '', '--vault', vaultRoot])
      assert.deepEqual(requireData(shownSession).entity.data.fields, {
        estimated_sleep_onset_latency_minutes: 25,
        'routine-completed': true,
        'sleep-note': 'intervention',
        'optional-note': null,
        wake_after_sleep_onset_minutes: 20,
        subjective_sleep_quality: 6,
        daytime_sleepiness: 5,
      })

      const interimWrite = await runSliceCli<{
        outcome: {
          generatedAt: string
          outcomeId?: string
          metricResults: Array<Record<string, unknown>>
          experiment: { status: string }
        }
        updatedExperiment: boolean
      }>([
        'experiment',
        'outcome',
        'write',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-05',
        '--vault',
        vaultRoot,
      ])
      const interimExperiment = await runSliceCli<{
        entity: { data: Record<string, unknown> }
      }>(['experiment', 'show', 'sleep-diary', '--vault', vaultRoot])

      assert.equal(
        interimWrite.ok,
        true,
        interimWrite.ok ? undefined : interimWrite.error.message,
      )
      assert.equal(requireData(interimWrite).outcome.experiment.status, 'active')
      assert.equal(requireData(interimWrite).updatedExperiment, true)
      assert.equal(requireData(interimExperiment).entity.data.status, 'active')
      assert.equal(requireData(interimExperiment).entity.data.endedOn, undefined)

      const finalWrite = await runSliceCli<{
        outcome: {
          generatedAt: string
          outcomeId?: string
          metricResults: Array<Record<string, unknown>>
          experiment: { status: string }
        }
        updatedExperiment: boolean
      }>([
        'experiment',
        'outcome',
        'write',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-06',
        '--vault',
        vaultRoot,
      ])
      const repeatedFinalWrite = await runSliceCli<{
        outcome: {
          generatedAt: string
          outcomeId?: string
          metricResults: Array<Record<string, unknown>>
          experiment: { status: string }
        }
        updatedExperiment: boolean
      }>([
        'experiment',
        'outcome',
        'write',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-06',
        '--vault',
        vaultRoot,
      ])
      const completedExperiment = await runSliceCli<{
        entity: { data: Record<string, unknown> }
      }>(['experiment', 'show', 'sleep-diary', '--vault', vaultRoot])

      assert.equal(finalWrite.ok, true, finalWrite.ok ? undefined : finalWrite.error.message)
      assert.deepEqual(requireData(finalWrite).outcome.metricResults[0], {
        baseline: { daysWithData: 3, mean: 40, totalDays: 3, unit: 'minutes' },
        baselineDayCount: 3,
        baselineMean: 40,
        biomarkerKey: 'biomarker:sleep-onset-latency',
        completeness: 'good',
        deltaAbs: -20,
        deltaPct: -50,
        expectedDirection: 'decrease',
        intervention: { daysWithData: 3, mean: 20, totalDays: 3, unit: 'minutes' },
        interventionDayCount: 3,
        interventionMean: 20,
        label: 'Sleep Onset Latency',
        movedAsExpected: true,
        points: [
          { date: '2026-04-01', phase: 'baseline', unit: 'minutes', value: 45 },
          { date: '2026-04-02', phase: 'baseline', unit: 'minutes', value: 40 },
          { date: '2026-04-03', phase: 'baseline', unit: 'minutes', value: 35 },
          { date: '2026-04-04', phase: 'intervention', unit: 'minutes', value: 25 },
          { date: '2026-04-05', phase: 'intervention', unit: 'minutes', value: 20 },
          { date: '2026-04-06', phase: 'intervention', unit: 'minutes', value: 15 },
        ],
        unit: 'minutes',
      })
      assert.equal(requireData(finalWrite).outcome.experiment.status, 'completed')
      const metricResults = requireData(finalWrite).outcome.metricResults
      assert.deepEqual(
        metricResults.find(
          (result) => result.biomarkerKey === 'biomarker:wake-after-sleep-onset',
        ),
        {
          baseline: { daysWithData: 3, mean: 25, totalDays: 3, unit: 'minutes' },
          baselineDayCount: 3,
          baselineMean: 25,
          biomarkerKey: 'biomarker:wake-after-sleep-onset',
          completeness: 'good',
          deltaAbs: -10,
          deltaPct: -40,
          expectedDirection: null,
          intervention: { daysWithData: 3, mean: 15, totalDays: 3, unit: 'minutes' },
          interventionDayCount: 3,
          interventionMean: 15,
          label: 'Wake After Sleep Onset',
          movedAsExpected: null,
          points: [
            { date: '2026-04-01', phase: 'baseline', unit: 'minutes', value: 30 },
            { date: '2026-04-02', phase: 'baseline', unit: 'minutes', value: 25 },
            { date: '2026-04-03', phase: 'baseline', unit: 'minutes', value: 20 },
            { date: '2026-04-04', phase: 'intervention', unit: 'minutes', value: 20 },
            { date: '2026-04-05', phase: 'intervention', unit: 'minutes', value: 15 },
            { date: '2026-04-06', phase: 'intervention', unit: 'minutes', value: 10 },
          ],
          unit: 'minutes',
        },
      )
      assert.equal(
        metricResults.find(
          (result) => result.biomarkerKey === 'biomarker:sleep-quality',
        )?.baselineMean,
        5,
      )
      assert.equal(
        metricResults.find(
          (result) => result.biomarkerKey === 'biomarker:sleep-quality',
        )?.interventionMean,
        7,
      )
      assert.equal(
        metricResults.find(
          (result) => result.biomarkerKey === 'biomarker:daytime-sleepiness',
        )?.baselineMean,
        6,
      )
      assert.equal(
        metricResults.find(
          (result) => result.biomarkerKey === 'biomarker:daytime-sleepiness',
        )?.interventionMean,
        4,
      )
      assert.equal(requireData(finalWrite).updatedExperiment, true)
      assert.equal(
        repeatedFinalWrite.ok,
        true,
        repeatedFinalWrite.ok ? undefined : repeatedFinalWrite.error.message,
      )
      assert.equal(requireData(repeatedFinalWrite).updatedExperiment, false)
      assert.equal(
        requireData(repeatedFinalWrite).outcome.generatedAt,
        requireData(finalWrite).outcome.generatedAt,
      )
      const frozenOutcomePath = path.join(
        vaultRoot,
        'bank/experiments/outcomes/sleep-diary-2026-04-06.json',
      )
      const frozenOutcomeBytes = await readFile(frozenOutcomePath, 'utf8')
      assert.equal(requireData(completedExperiment).entity.data.status, 'completed')
      assert.equal(requireData(completedExperiment).entity.data.endedOn, '2026-04-06')

      const correctedSession = await runSliceCli<{ eventId: string }>([
        'experiment',
        'session',
        'log',
        'sleep-diary',
        '--date',
        '2026-04-06',
        '--occurred-at',
        '2026-04-06T20:00:00.000Z',
        '--field',
        'estimated_sleep_onset_latency_minutes=5',
        '--vault',
        vaultRoot,
      ])
      assert.equal(
        correctedSession.ok,
        true,
        correctedSession.ok ? undefined : correctedSession.error.message,
      )

      const correctedFinalWrite = await runSliceCli<{
        outcome: {
          generatedAt: string
          outcomeId?: string
          metricResults: Array<Record<string, unknown>>
          experiment: { status: string }
        }
        updatedExperiment: boolean
      }>([
        'experiment',
        'outcome',
        'write',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-06',
        '--vault',
        vaultRoot,
      ])
      const correctedExperiment = await runSliceCli<{
        entity: { data: Record<string, unknown> }
      }>(['experiment', 'show', 'sleep-diary', '--vault', vaultRoot])

      assert.equal(
        correctedFinalWrite.ok,
        true,
        correctedFinalWrite.ok ? undefined : correctedFinalWrite.error.message,
      )
      assert.equal(requireData(correctedFinalWrite).updatedExperiment, false)
      assert.equal(
        requireData(correctedFinalWrite).outcome.outcomeId,
        requireData(finalWrite).outcome.outcomeId,
      )
      assert.equal(
        requireData(correctedFinalWrite).outcome.generatedAt,
        requireData(finalWrite).outcome.generatedAt,
      )
      assert.deepEqual(
        requireData(correctedFinalWrite).outcome.metricResults,
        requireData(finalWrite).outcome.metricResults,
      )
      assert.equal(await readFile(frozenOutcomePath, 'utf8'), frozenOutcomeBytes)
      assert.equal(
        requireData(correctedFinalWrite).outcome.experiment.status,
        'completed',
      )
      assert.equal(requireData(correctedExperiment).entity.data.status, 'completed')
      assert.equal(requireData(correctedExperiment).entity.data.endedOn, '2026-04-06')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment outcome writes preserve paused lifecycle state after the intervention window',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-paused-experiment-outcome-'),
    )

    try {
      await runSliceCli(['init', '--vault', vaultRoot, '--timezone', 'UTC'])
      const created = await runSliceCli<{ experimentId: string }>([
        'experiment',
        'start',
        'paused-recovery-run',
        '--custom',
        '--no-public-protocol',
        '--status',
        'paused',
        '--baseline-start',
        '2026-05-01',
        '--baseline-days',
        '3',
        '--intervention-start',
        '2026-05-04',
        '--intervention-days',
        '3',
        '--primary-biomarker-key',
        'biomarker:resting-heart-rate',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true, created.ok ? undefined : created.error.message)

      const written = await runSliceCli<{
        outcome: { experiment: { status: string } }
        updatedExperiment: boolean
      }>([
        'experiment',
        'outcome',
        'write',
        requireData(created).experimentId,
        '--as-of',
        '2026-05-06',
        '--vault',
        vaultRoot,
      ])
      const shown = await runSliceCli<{
        entity: { data: Record<string, unknown> }
      }>(['experiment', 'show', 'paused-recovery-run', '--vault', vaultRoot])

      assert.equal(written.ok, true, written.ok ? undefined : written.error.message)
      assert.equal(requireData(written).updatedExperiment, true)
      assert.equal(requireData(written).outcome.experiment.status, 'paused')
      assert.equal(requireData(shown).entity.data.status, 'paused')
      assert.equal(requireData(shown).entity.data.endedOn, undefined)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'draft bedtime transition protocol cannot start through the CLI',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-bedtime-transition-start-'),
    )

    try {
      await runSliceCli(['init', '--vault', vaultRoot, '--timezone', 'UTC'])
      const rejected = await runSliceCli([
        'experiment',
        'start',
        'bedtime-transition-run',
        '--from-protocol',
        'protocol_variant:bedtime-transition/standard-tiny-fallback-transition',
        '--intervention-start',
        '2026-06-01',
        '--onboarding-completed-at',
        '2026-05-31T12:00:00.000Z',
        '--vault',
        vaultRoot,
      ])

      assert.equal(rejected.ok, false)
      if (rejected.ok) {
        throw new Error('Draft bedtime transition protocol must not start.')
      }
      assert.equal(rejected.error.code, 'not_found')
      assert.match(
        rejected.error.message ?? '',
        /No Health Commons protocol variant matched/u,
      )

      const shown = await runSliceCli([
        'experiment',
        'show',
        'bedtime-transition-run',
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, false)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'tomorrow-list protocol starts with only the compact default logging and analysis set',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-tomorrow-list-start-'),
    )

    try {
      await runSliceCli(['init', '--vault', vaultRoot, '--timezone', 'UTC'])
      const created = await runSliceCli<{ experimentId: string; slug: string }>([
        'experiment',
        'start',
        'tomorrow-list-run',
        '--from-protocol',
        'protocol_variant:cognitive-offload-before-bed/five-minute-tomorrow-list',
        '--intervention-start',
        '2026-06-01',
        '--onboarding-completed-at',
        '2026-05-31T12:00:00.000Z',
        '--vault',
        vaultRoot,
      ])

      assert.equal(created.ok, true, created.ok ? undefined : created.error.message)
      const shown = await runSliceCli<{
        entity: {
          data: {
            analysisPlan?: {
              primaryBiomarkerKey?: string
              secondaryBiomarkerKeys?: string[]
            }
            runPlan?: {
              logging?: {
                confounderFields?: string[]
                sessionFields?: string[]
              }
            }
          }
        }
      }>(['experiment', 'show', 'tomorrow-list-run', '--vault', vaultRoot])

      assert.equal(
        requireData(shown).entity.data.analysisPlan?.primaryBiomarkerKey,
        'biomarker:pre-sleep-arousal',
      )
      assert.deepEqual(
        requireData(shown).entity.data.analysisPlan?.secondaryBiomarkerKeys,
        [
          'biomarker:sleep-onset-latency',
          'biomarker:daytime-sleepiness',
        ],
      )
      assert.deepEqual(
        requireData(shown).entity.data.runPlan?.logging?.sessionFields,
        [
          'pre_sleep_arousal',
          'sleep_opportunity_minutes',
          'estimated_sleep_onset_latency_minutes',
          'daytime_sleepiness',
          'writing_burden',
        ],
      )
      assert.equal(
        requireData(shown).entity.data.runPlan?.logging?.confounderFields,
        undefined,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment start rejects either stale protocol revision and persists an exact compare-and-set pair',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-experiment-revision-cas-'),
    )

    try {
      await runSliceCli(['init', '--vault', vaultRoot])
      const protocolKey =
        'protocol_variant:dry-sauna/murph-finnish-standard-3x-week'
      const protocol = loadGeneratedHealthCommonsProtocolRunSpecs().protocols.find(
        (candidate) => candidate.key === protocolKey,
      )
      assert.ok(protocol)
      const runSpecRevisionId = protocol.revision.runSpecRevisionId
      assert.ok(runSpecRevisionId)

      const stalePage = await runSliceCli<unknown>([
        'experiment',
        'start',
        'stale-page-revision',
        '--from-protocol',
        protocolKey,
        '--intervention-start',
        '2026-05-01',
        '--page-revision-id',
        `sha256:${'0'.repeat(64)}`,
        '--run-spec-revision-id',
        runSpecRevisionId,
        '--vault',
        vaultRoot,
      ])
      const staleRunSpec = await runSliceCli<unknown>([
        'experiment',
        'start',
        'stale-run-spec-revision',
        '--from-protocol',
        protocolKey,
        '--intervention-start',
        '2026-05-01',
        '--page-revision-id',
        protocol.revision.pageRevisionId,
        '--run-spec-revision-id',
        `sha256:${'1'.repeat(64)}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(stalePage.ok, false)
      assert.match(stalePage.error.message ?? '', /page-revision-id revision expectation.*does not match/u)
      assert.equal(staleRunSpec.ok, false)
      assert.match(staleRunSpec.error.message ?? '', /run-spec-revision-id revision expectation.*does not match/u)
      for (const slug of ['stale-page-revision', 'stale-run-spec-revision']) {
        const missing = await runSliceCli<unknown>([
          'experiment',
          'show',
          slug,
          '--vault',
          vaultRoot,
        ])
        assert.equal(missing.ok, false)
      }

      const exact = await runSliceCli<{ experimentId: string }>([
        'experiment',
        'start',
        'exact-protocol-revision',
        '--from-protocol',
        protocolKey,
        '--intervention-start',
        '2026-05-01',
        '--page-revision-id',
        protocol.revision.pageRevisionId,
        '--run-spec-revision-id',
        runSpecRevisionId,
        '--onboarding-completed-at',
        '2026-04-30T12:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(exact.ok, true, exact.ok ? undefined : exact.error.message)
      const shown = await runSliceCli<{
        entity: { data: { commonsProtocolRef?: Record<string, unknown> } }
      }>([
        'experiment',
        'show',
        'exact-protocol-revision',
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, true, shown.ok ? undefined : shown.error.message)
      assert.deepEqual(requireData(shown).entity.data.commonsProtocolRef, {
        key: protocolKey,
        pageRevisionId: protocol.revision.pageRevisionId,
        runSpecRevisionId,
        testPlanId: protocol.testPlans[0]?.planId,
      })
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
