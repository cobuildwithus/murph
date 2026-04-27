import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerJournalCommands } from '../src/commands/journal.js'
import { registerProtocolCommands } from '../src/commands/protocol.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

type TestExperimentStatus = 'active' | 'planned' | 'paused' | 'completed' | 'abandoned'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'experiment/journal/vault phase2 slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerJournalCommands(cli, services)
  registerProtocolCommands(cli, services)
  registerReadCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
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

async function writeDirectPublicSaunaPlan(input: {
  filePath: string
  slug: string
  title: string
  hypothesis?: string
  startedOn: string
  status: TestExperimentStatus
  pageRevisionId: string
  runSpecRevisionId: string
}) {
  await writeFile(
    input.filePath,
    `${JSON.stringify({
      schemaVersion: 'murph.experiment-plan.v1',
      experiment: {
        slug: input.slug,
        title: input.title,
        ...(input.hypothesis ? { hypothesis: input.hypothesis } : {}),
        startedOn: input.startedOn,
        status: input.status,
      },
      commonsProtocolRef: {
        key: 'protocol_variant:dry-sauna/finnish-standard-3x-week',
        pageRevisionId: input.pageRevisionId,
        runSpecRevisionId: input.runSpecRevisionId,
        testPlanId: 'resting-heart-rate-21d',
      },
      effectiveProtocolSnapshot: {
        effectiveSpecHash: `sha256:${'c'.repeat(64)}`,
        doseSignature: '3x/week dry sauna, 15-20 min',
        modality: 'dry_sauna',
        frequency: {
          sessionsPerWeek: 3,
        },
        durationMinutes: {
          min: 15,
          max: 20,
        },
        targetSessions: 6,
        minimumUsefulSessions: 4,
      },
      decision: {
        materialAdaptation: false,
        needsPrivateProtocol: false,
        reasons: ['Using the public protocol as written.'],
      },
    }, null, 2)}\n`,
    'utf8',
  )
}

async function runRawSliceCli(args: string[]): Promise<string> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve(args, {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(typeof value, 'object', `${label} must be an object`)
  assert.ok(value && !Array.isArray(value), `${label} must be a non-array object`)
  return value as Record<string, unknown>
}

async function rewriteVaultMetadataWithFormatVersion(
  vaultRoot: string,
  formatVersion: number,
): Promise<void> {
  const metadataPath = path.join(vaultRoot, 'vault.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
  metadata.formatVersion = formatVersion
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

test('experiment apply-onboarding schema exposes typed onboarding flags', async () => {
  const schema = JSON.parse(
    await runRawSliceCli([
      'experiment',
      'apply-onboarding',
      '--schema',
      '--format',
      'json',
    ]),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('id' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['id'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal('protocolKey' in schema.options.properties, true)
  assert.equal('pageRevisionId' in schema.options.properties, true)
  assert.equal('runSpecRevisionId' in schema.options.properties, true)
  assert.equal('baselineDays' in schema.options.properties, true)
  assert.equal('interventionDays' in schema.options.properties, true)
  assert.equal('schedule' in schema.options.properties, true)
  assert.equal('dose' in schema.options.properties, true)
  assert.equal('sessionField' in schema.options.properties, true)
  assert.equal('setupAnswer' in schema.options.properties, true)
  assert.equal('missedLogFollowup' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('experiment update schema exposes scalar fields instead of a hidden input payload', async () => {
  const schema = JSON.parse(
    await runRawSliceCli(['experiment', 'update', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('id' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['id'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal('title' in schema.options.properties, true)
  assert.equal('hypothesis' in schema.options.properties, true)
  assert.equal('startedOn' in schema.options.properties, true)
  assert.equal('status' in schema.options.properties, true)
  assert.equal('body' in schema.options.properties, true)
  assert.equal('tag' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('experiment plan/start and private protocol schemas expose explicit JSON inputs', async () => {
  const experimentPlanSchema = JSON.parse(
    await runRawSliceCli(['experiment', 'plan', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
    output: {
      properties: Record<string, unknown>
    }
  }
  const experimentStartSchema = JSON.parse(
    await runRawSliceCli(['experiment', 'start', '--schema', '--format', 'json']),
  ) as typeof experimentPlanSchema
  const protocolImportJsonSchema = JSON.parse(
    await runRawSliceCli(['protocol', 'import-json', '--schema', '--format', 'json']),
  ) as typeof experimentPlanSchema
  const protocolHelp = await runRawSliceCli(['protocol', '--help'])

  assert.equal('input' in experimentPlanSchema.options.properties, true)
  assert.equal('input' in experimentStartSchema.options.properties, true)
  assert.equal('input' in protocolImportJsonSchema.options.properties, true)
  assert.match(protocolHelp, /\bimport-json\b/u)
  assert.doesNotMatch(protocolHelp, /\bupsert\b/u)
  assert.deepEqual([...(experimentPlanSchema.options.required ?? [])].sort(), [
    'input',
    'vault',
  ])
  assert.deepEqual([...(experimentStartSchema.options.required ?? [])].sort(), [
    'input',
    'vault',
  ])
  assert.deepEqual([...(protocolImportJsonSchema.options.required ?? [])].sort(), [
    'input',
    'vault',
  ])
  assert.equal('confirmedPlan' in experimentPlanSchema.output.properties, false)
})

test.sequential('protocol import-json writes a reviewed private protocol payload', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-private-protocol-import-json-'))
  const payloadPath = path.join(vaultRoot, 'protocol.json')
  const pageRevisionId = `sha256:${'c'.repeat(64)}`
  const runSpecRevisionId = `sha256:${'d'.repeat(64)}`

  try {
    await runSliceCli([
      'init',
      '--vault',
      vaultRoot,
      '--timezone',
      'America/Los_Angeles',
    ])
    await writeFile(
      payloadPath,
      `${JSON.stringify({
        slug: 'dry-sauna-evening-2x',
        title: 'Dry sauna evening 2x/week',
        body: 'Private adaptation for evening sauna access.',
        frontmatter: {
          status: 'available',
          commonsProtocolRef: {
            key: 'protocol_variant:dry-sauna/murph-finnish-standard-3x-week',
            pageRevisionId,
            runSpecRevisionId,
            testPlanId: 'rhr-21d',
          },
          lineage: {
            sourceKind: 'health_commons_protocol',
            notes: ['Adapted to available evening access.'],
          },
          diff: [
            {
              path: 'protocol.frequency.sessionsPerWeek',
              op: 'replace',
              before: 3,
              after: 2,
              reason: 'Evening access is realistic twice weekly.',
            },
          ],
          effectiveSpec: {
            doseSignature: '2x/week dry sauna, 15-20 min, about 80 C',
            modality: 'traditional_dry_sauna',
            frequency: {
              sessionsPerWeek: 2,
            },
            durationMinutes: {
              min: 15,
              max: 20,
            },
            temperatureC: {
              min: 80,
              max: 80,
            },
            targetSessions: 4,
            minimumUsefulSessions: 3,
            stopConditions: ['Stop for dizziness, chest pain, or unusual symptoms.'],
          },
          personalization: {
            target: 'recovery',
            constraints: {
              accessKind: 'gym_or_spa_dry_sauna',
            },
            preferences: {
              defaultSchedule: 'Tue/Thu evening when possible',
            },
          },
        },
      }, null, 2)}\n`,
      'utf8',
    )

    const imported = await runSliceCli<{
      created: boolean
      lookupId: string
      path: string
      protocolId: string
      protocolRevisionId: string
      slug: string
    }>([
      'protocol',
      'import-json',
      '--vault',
      vaultRoot,
      '--input',
      `@${payloadPath}`,
    ])
    const shownPrivateProtocol = await runSliceCli<{
      protocol: Record<string, unknown>
    }>([
      'protocol',
      'show',
      'dry-sauna-evening-2x',
      '--vault',
      vaultRoot,
    ])
    const listedPrivateProtocols = await runSliceCli<{
      protocols: Array<Record<string, unknown>>
    }>([
      'protocol',
      'list',
      '--commons-protocol',
      'dry-sauna/murph-finnish-standard-3x-week',
      '--limit',
      '1',
      '--vault',
      vaultRoot,
    ])

    assert.equal(imported.ok, true)
    assert.equal(requireData(imported).created, true)
    assert.equal(requireData(imported).slug, 'dry-sauna-evening-2x')
    assert.equal(requireData(imported).lookupId, requireData(imported).protocolId)
    assert.match(requireData(imported).path, /^bank\/protocols\//u)
    assert.match(requireData(imported).protocolRevisionId, /^sha256:/u)

    assert.equal(shownPrivateProtocol.ok, true)
    assert.equal(requireData(shownPrivateProtocol).protocol.slug, 'dry-sauna-evening-2x')
    assert.equal(listedPrivateProtocols.ok, true)
    assert.equal(requireData(listedPrivateProtocols).protocols.length, 1)
    assert.equal(
      requireData(listedPrivateProtocols).protocols[0]?.slug,
      'dry-sauna-evening-2x',
    )
    assert.equal(
      'effectiveSpec' in (requireData(listedPrivateProtocols).protocols[0] ?? {}),
      false,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('experiment journal write schemas expose typed fields and move JSON to explicit import fallbacks', async () => {
  const checkpointSchema = JSON.parse(
    await runRawSliceCli(['experiment', 'checkpoint', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const sessionLogSchema = JSON.parse(
    await runRawSliceCli(['experiment', 'session', 'log', '--schema', '--format', 'json']),
  ) as typeof checkpointSchema
  const contextLogSchema = JSON.parse(
    await runRawSliceCli(['experiment', 'context', 'log', '--schema', '--format', 'json']),
  ) as typeof checkpointSchema
  const checkpointJsonSchema = JSON.parse(
    await runRawSliceCli([
      'experiment',
      'checkpoint-json',
      '--schema',
      '--format',
      'json',
    ]),
  ) as typeof checkpointSchema
  const sessionLogJsonSchema = JSON.parse(
    await runRawSliceCli([
      'experiment',
      'session',
      'log-json',
      '--schema',
      '--format',
      'json',
    ]),
  ) as typeof checkpointSchema
  const contextLogJsonSchema = JSON.parse(
    await runRawSliceCli([
      'experiment',
      'context',
      'log-json',
      '--schema',
      '--format',
      'json',
    ]),
  ) as typeof checkpointSchema

  assert.equal('lookup' in checkpointSchema.args.properties, true)
  assert.deepEqual(checkpointSchema.args.required, ['lookup'])
  assert.equal('input' in checkpointSchema.options.properties, false)
  assert.equal('occurredAt' in checkpointSchema.options.properties, true)
  assert.equal('title' in checkpointSchema.options.properties, true)
  assert.equal('note' in checkpointSchema.options.properties, true)

  assert.equal('lookup' in sessionLogSchema.args.properties, true)
  assert.deepEqual(sessionLogSchema.args.required, ['lookup'])
  assert.equal('input' in sessionLogSchema.options.properties, false)
  assert.equal('occurredAt' in sessionLogSchema.options.properties, true)
  assert.equal('source' in sessionLogSchema.options.properties, true)
  assert.equal('interventionType' in sessionLogSchema.options.properties, true)
  assert.equal('durationMinutes' in sessionLogSchema.options.properties, true)
  assert.equal('temperatureC' in sessionLogSchema.options.properties, true)
  assert.equal('symptoms' in sessionLogSchema.options.properties, true)
  assert.equal('confounders' in sessionLogSchema.options.properties, true)

  assert.equal('lookup' in contextLogSchema.args.properties, true)
  assert.deepEqual(contextLogSchema.args.required, ['lookup'])
  assert.equal('input' in contextLogSchema.options.properties, false)
  assert.equal('kind' in contextLogSchema.options.properties, true)
  assert.equal('contextType' in contextLogSchema.options.properties, true)
  assert.equal('severity' in contextLogSchema.options.properties, true)
  assert.equal('supplementName' in contextLogSchema.options.properties, true)
  assert.equal('dose' in contextLogSchema.options.properties, true)
  assert.equal('unit' in contextLogSchema.options.properties, true)

  assert.equal('input' in checkpointJsonSchema.options.properties, true)
  assert.equal('input' in sessionLogJsonSchema.options.properties, true)
  assert.equal('input' in contextLogJsonSchema.options.properties, true)
  assert.deepEqual([...(checkpointJsonSchema.options.required ?? [])].sort(), [
    'input',
    'vault',
  ])
  assert.deepEqual([...(sessionLogJsonSchema.options.required ?? [])].sort(), [
    'input',
    'vault',
  ])
  assert.deepEqual([...(contextLogJsonSchema.options.required ?? [])].sort(), [
    'input',
    'vault',
  ])
})

test('experiment onboarding llms discovery exposes apply flags and hides update input', async () => {
  const applyDiscovery = await runRawSliceCli([
    'experiment',
    'apply-onboarding',
    '--llms-full',
  ])
  const updateDiscovery = await runRawSliceCli(['experiment', 'update', '--llms-full'])

  assert.match(applyDiscovery, /experiment apply-onboarding/u)
  assert.match(applyDiscovery, /protocolKey/u)
  assert.match(applyDiscovery, /pageRevisionId/u)
  assert.match(applyDiscovery, /schedule/u)
  assert.match(applyDiscovery, /dose/u)
  assert.match(applyDiscovery, /setupAnswer/u)
  assert.match(applyDiscovery, /missedLogFollowup/u)
  assert.match(updateDiscovery, /experiment update/u)
  assert.match(updateDiscovery, /title/u)
  assert.match(updateDiscovery, /status/u)
  assert.doesNotMatch(updateDiscovery, /input/u)
})

test.sequential(
  'experiment apply-onboarding maps public run options into canonical frontmatter',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-onboarding-'))
    const planPath = path.join(vaultRoot, 'sauna-direct-plan.json')
    const pageRevisionId = `sha256:${'a'.repeat(64)}`
    const runSpecRevisionId = `sha256:${'b'.repeat(64)}`

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
        'create',
        'sauna-daily',
        '--title',
        'Sauna Daily',
        '--hypothesis',
        'Dry sauna sessions improve overnight recovery.',
        '--started-on',
        '2026-05-01',
        '--status',
        'planned',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const noOptions = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--vault',
        vaultRoot,
      ])
      const statusOnly = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])
      const missingProtocolTriplet = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--protocol-key',
        'protocol_variant:dry-sauna/finnish-standard-3x-week',
        '--page-revision-id',
        pageRevisionId,
        '--vault',
        vaultRoot,
      ])
      const invalidRevision = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--protocol-key',
        'protocol_variant:dry-sauna/finnish-standard-3x-week',
        '--page-revision-id',
        'sha256:not-a-real-revision',
        '--run-spec-revision-id',
        runSpecRevisionId,
        '--vault',
        vaultRoot,
      ])
      const invalidProtocolKey = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--protocol-key',
        'biomarker:resting-heart-rate',
        '--page-revision-id',
        pageRevisionId,
        '--run-spec-revision-id',
        runSpecRevisionId,
        '--vault',
        vaultRoot,
      ])
      const conflictingBaselineWindow = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--baseline-start',
        '2026-05-01',
        '--baseline-end',
        '2026-05-10',
        '--baseline-days',
        '7',
        '--vault',
        vaultRoot,
      ])
      const confounderOnly = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--confounder-field',
        'after_exercise',
        '--vault',
        vaultRoot,
      ])
      await writeDirectPublicSaunaPlan({
        filePath: planPath,
        slug: 'sauna-daily',
        title: 'Sauna Daily',
        hypothesis: 'Dry sauna sessions improve overnight recovery.',
        startedOn: '2026-05-01',
        status: 'planned',
        pageRevisionId,
        runSpecRevisionId,
      })
      const started = await runSliceCli([
        'experiment',
        'start',
        '--input',
        `@${planPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(started.ok, true)
      const applied = await runSliceCli<{
        experimentId: string
        slug: string
        status: string
      }>([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--status',
        'active',
        '--protocol-key',
        'protocol_variant:dry-sauna/finnish-standard-3x-week',
        '--page-revision-id',
        pageRevisionId,
        '--run-spec-revision-id',
        runSpecRevisionId,
        '--test-plan-id',
        'resting-heart-rate-21d',
        '--baseline-days',
        '7',
        '--intervention-start',
        '2026-05-08',
        '--intervention-days',
        '14',
        '--modality',
        'dry_sauna',
        '--schedule',
        'Three evening sauna sessions per week.',
        '--dose',
        '20 minutes per session at a comfortable heat.',
        '--sessions-per-week',
        '3',
        '--target-sessions',
        '6',
        '--minimum-useful-sessions',
        '4',
        '--session-field',
        'duration_minutes',
        '--session-field',
        'timing',
        '--confounder-field',
        'after_exercise',
        '--stop-condition',
        'Stop for dizziness or chest pain.',
        '--primary-biomarker-key',
        'biomarker:resting-heart-rate',
        '--secondary-biomarker-key',
        'biomarker:sleep-efficiency',
        '--desired-direction',
        'decrease',
        '--analysis-note',
        'Compare the seven-day baseline to the intervention window.',
        '--onboarding-completed-at',
        '2026-04-30T15:00:00.000Z',
        '--setup-answer',
        'session_timing=Evening after training',
        '--setup-answer',
        'standalone_context=shift work, travel',
        '--safety-caution-level',
        'low',
        '--safety-disposition',
        'continue_with_caution',
        '--positive-question-id',
        'heat_intolerance',
        '--safety-note',
        'No contraindications reported.',
        '--context-note',
        'Keep training load stable where possible.',
        '--reminder-policy',
        'sauna_reminder_policy',
        '--reminder-option-id',
        'evening_reminder',
        '--reminders-enabled',
        '--check-in-cadence',
        'daily',
        '--notification-style',
        'send_scheduled_summary',
        '--missed-log-followup',
        'default_on',
        '--weekly-digest-enabled',
        '--vault',
        vaultRoot,
      ])
      const shown = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'experiment',
        'show',
        'sauna-daily',
        '--vault',
        vaultRoot,
      ])

      assert.equal(noOptions.ok, false)
      assert.match(noOptions.error.message ?? '', /requires at least one/u)
      assert.equal(statusOnly.ok, false)
      assert.match(
        statusOnly.error.message ?? '',
        /Use experiment update for status-only changes/u,
      )
      assert.equal(missingProtocolTriplet.ok, false)
      assert.match(
        missingProtocolTriplet.error.message ?? '',
        /requires --protocol-key, --page-revision-id, and --run-spec-revision-id/u,
      )
      assert.equal(invalidRevision.ok, false)
      assert.match(
        invalidRevision.error.message ?? '',
        /sha256: followed by 64 lowercase hexadecimal characters|sha256:<64 lowercase hex>/u,
      )
      assert.equal(invalidProtocolKey.ok, false)
      assert.match(invalidProtocolKey.error.message ?? '', /protocol_variant key/u)
      assert.equal(conflictingBaselineWindow.ok, false)
      assert.match(conflictingBaselineWindow.error.message ?? '', /conflicts with --baseline-days/u)
      assert.equal(confounderOnly.ok, false)
      assert.match(confounderOnly.error.message ?? '', /--confounder-field requires --session-field/u)

      assert.equal(applied.ok, true)
      assert.equal(applied.meta?.command, 'experiment apply-onboarding')
      assert.equal(requireData(applied).status, 'active')
      assert.equal(requireData(applied).experimentId, requireData(created).experimentId)
      assert.equal(shown.ok, true)

      const experimentData = requireData(shown).entity.data
      assert.equal(experimentData.status, 'active')

      const commonsProtocolRef = requireRecord(
        experimentData.commonsProtocolRef,
        'commonsProtocolRef',
      )
      assert.deepEqual(commonsProtocolRef, {
        key: 'protocol_variant:dry-sauna/finnish-standard-3x-week',
        pageRevisionId,
        runSpecRevisionId,
        testPlanId: 'resting-heart-rate-21d',
      })

      const runPlan = requireRecord(experimentData.runPlan, 'runPlan')
      assert.equal(runPlan.baselineStart, '2026-05-01')
      assert.equal(runPlan.baselineEnd, '2026-05-07')
      assert.equal(runPlan.interventionStart, '2026-05-08')
      assert.equal(runPlan.interventionEnd, '2026-05-21')
      assert.equal(runPlan.modality, 'dry_sauna')
      assert.equal(runPlan.schedule, 'Three evening sauna sessions per week.')
      assert.equal(runPlan.dose, '20 minutes per session at a comfortable heat.')
      assert.equal(runPlan.sessionsPerWeek, 3)
      assert.equal(runPlan.targetSessions, 6)
      assert.equal(runPlan.minimumUsefulSessions, 4)
      assert.equal('baselineDays' in runPlan, false)
      assert.equal('interventionDays' in runPlan, false)
      assert.deepEqual(runPlan.stopConditions, ['Stop for dizziness or chest pain.'])

      const logging = requireRecord(runPlan.logging, 'runPlan.logging')
      assert.deepEqual(logging.sessionFields, ['duration_minutes', 'timing'])
      assert.deepEqual(logging.confounderFields, ['after_exercise'])

      const analysisPlan = requireRecord(experimentData.analysisPlan, 'analysisPlan')
      assert.equal(analysisPlan.primaryBiomarkerKey, 'biomarker:resting-heart-rate')
      assert.deepEqual(analysisPlan.secondaryBiomarkerKeys, [
        'biomarker:sleep-efficiency',
      ])
      assert.equal(analysisPlan.desiredDirection, 'decrease')
      assert.deepEqual(analysisPlan.notes, [
        'Compare the seven-day baseline to the intervention window.',
      ])

      const onboarding = requireRecord(experimentData.onboarding, 'onboarding')
      assert.equal(onboarding.completedAt, '2026-04-30T15:00:00.000Z')
      assert.deepEqual(onboarding.contextNotes, [
        'Keep training load stable where possible.',
      ])
      const setupAnswers = requireRecord(onboarding.setupAnswers, 'onboarding.setupAnswers')
      assert.equal(setupAnswers.session_timing, 'Evening after training')
      assert.equal(setupAnswers.standalone_context, 'shift work, travel')
      const safety = requireRecord(onboarding.safety, 'onboarding.safety')
      assert.equal(safety.cautionLevel, 'low')
      assert.equal(safety.disposition, 'continue_with_caution')
      assert.deepEqual(safety.positiveQuestionIds, ['heat_intolerance'])
      assert.deepEqual(safety.notes, ['No contraindications reported.'])

      const assistantSupport = requireRecord(
        experimentData.assistantSupport,
        'assistantSupport',
      )
      assert.equal(assistantSupport.reminderPolicy, 'sauna_reminder_policy')
      assert.equal(assistantSupport.reminderOptionId, 'evening_reminder')
      assert.equal(assistantSupport.remindersEnabled, true)
      assert.equal(assistantSupport.checkInCadence, 'daily')
      assert.equal(assistantSupport.notificationStyle, 'send_scheduled_summary')
      assert.equal(assistantSupport.missedLogFollowup, 'default_on')
      assert.equal(assistantSupport.weeklyDigestEnabled, true)

      const partialApply = await runSliceCli([
        'experiment',
        'apply-onboarding',
        'sauna-daily',
        '--setup-answer',
        'heat_source=infrared sauna',
        '--missed-log-followup',
        'opt_in_only',
        '--vault',
        vaultRoot,
      ])
      const shownAfterPartial = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'experiment',
        'show',
        'sauna-daily',
        '--vault',
        vaultRoot,
      ])
      const partialData = requireData(shownAfterPartial).entity.data
      const partialCommonsProtocolRef = requireRecord(
        partialData.commonsProtocolRef,
        'commonsProtocolRef',
      )
      const partialRunPlan = requireRecord(partialData.runPlan, 'runPlan')
      const partialOnboarding = requireRecord(partialData.onboarding, 'onboarding')
      const partialSetupAnswers = requireRecord(
        partialOnboarding.setupAnswers,
        'onboarding.setupAnswers',
      )
      const partialAssistantSupport = requireRecord(
        partialData.assistantSupport,
        'assistantSupport',
      )

      assert.equal(partialApply.ok, true)
      assert.deepEqual(partialCommonsProtocolRef, commonsProtocolRef)
      assert.equal(partialRunPlan.schedule, 'Three evening sauna sessions per week.')
      assert.deepEqual(partialRunPlan.stopConditions, ['Stop for dizziness or chest pain.'])
      assert.equal(partialSetupAnswers.session_timing, 'Evening after training')
      assert.equal(partialSetupAnswers.heat_source, 'infrared sauna')
      assert.equal(partialAssistantSupport.reminderOptionId, 'evening_reminder')
      assert.equal(partialAssistantSupport.missedLogFollowup, 'opt_in_only')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment plan/start creates a reusable private protocol and snapshots it onto the run',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-plan-start-'))
    const planPath = path.join(vaultRoot, 'sauna-plan.json')
    const pageRevisionId = `sha256:${'a'.repeat(64)}`
    const runSpecRevisionId = `sha256:${'b'.repeat(64)}`

    try {
      await runSliceCli([
        'init',
        '--vault',
        vaultRoot,
        '--timezone',
        'America/Los_Angeles',
      ])
      await writeFile(
        planPath,
        `${JSON.stringify({
          schemaVersion: 'murph.experiment-plan.v1',
          planId: 'sauna-two-week-plan',
          experiment: {
            slug: 'sauna-two-week',
            title: 'Sauna Two Week',
            hypothesis: 'Two weekly sauna sessions improve recovery.',
            startedOn: '2026-05-01',
            status: 'active',
          },
          commonsProtocolRef: {
            key: 'protocol_variant:dry-sauna/murph-finnish-standard-3x-week',
            pageRevisionId,
            runSpecRevisionId,
            testPlanId: 'rhr-21d',
          },
          protocol: {
            slug: 'dry-sauna-2x-week',
            title: 'Dry sauna 2x/week',
            frontmatter: {
              status: 'available',
              commonsProtocolRef: {
                key: 'protocol_variant:dry-sauna/murph-finnish-standard-3x-week',
                pageRevisionId,
                runSpecRevisionId,
                testPlanId: 'rhr-21d',
              },
              lineage: {
                sourceKind: 'health_commons_protocol',
                notes: ['Frequency adapted for realistic access.'],
              },
              diff: [
                {
                  path: 'protocol.frequency.sessionsPerWeek',
                  op: 'replace',
                  before: 3,
                  after: 2,
                  reason: 'Nearby dry sauna access is realistic twice weekly.',
                },
              ],
              effectiveSpec: {
                doseSignature: '2x/week dry sauna, 15-20 min, about 80 C',
                modality: 'traditional_dry_sauna',
                frequency: {
                  sessionsPerWeek: 2,
                },
                durationMinutes: {
                  min: 15,
                  max: 20,
                },
                temperatureC: {
                  min: 80,
                  max: 80,
                },
                targetSessions: 4,
                minimumUsefulSessions: 3,
                stopConditions: ['Stop for dizziness, chest pain, or unusual symptoms.'],
              },
              personalization: {
                target: 'recovery',
                constraints: {
                  accessKind: 'gym_or_spa_dry_sauna',
                },
                preferences: {
                  defaultSchedule: 'Tue/Thu evening when possible',
                },
              },
            },
          },
          runPlan: {
            baseline: {
              mode: 'retrospective',
              source: 'wearable_history',
              start: '2026-04-24',
              end: '2026-04-30',
            },
            interventionStart: '2026-05-01',
            interventionEnd: '2026-05-14',
            modality: 'traditional_dry_sauna',
            schedule: 'Tue/Thu evening when possible',
            sessionsPerWeek: 2,
            targetSessions: 4,
            minimumUsefulSessions: 3,
          },
          analysisPlan: {
            primaryBiomarkerKey: 'biomarker:resting-heart-rate',
            secondaryBiomarkerKeys: ['biomarker:sleep-efficiency'],
            desiredDirection: 'decrease',
          },
          assistantSupport: {
            remindersEnabled: true,
            reminderPolicy: 'pre_session',
            weeklyDigestEnabled: true,
          },
          decision: {
            materialAdaptation: true,
            needsPrivateProtocol: true,
            reasons: ['Frequency differs from the canonical protocol.'],
          },
        }, null, 2)}\n`,
        'utf8',
      )

      const planned = await runSliceCli<{
        plan: {
          needsPrivateProtocol: boolean
          operations: string[]
        }
      }>([
        'experiment',
        'plan',
        '--input',
        `@${planPath}`,
        '--vault',
        vaultRoot,
      ])
      const started = await runSliceCli<{
        protocol: {
          protocolId: string
          slug: string
          protocolRevisionId: string
          effectiveSpecHash: string
          created: boolean
        } | null
        experiment: {
          experimentId: string
          slug: string
          created: boolean
          updated: boolean
        }
      }>([
        'experiment',
        'start',
        '--input',
        `@${planPath}`,
        '--vault',
        vaultRoot,
      ])
      const shown = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'experiment',
        'show',
        'sauna-two-week',
        '--vault',
        vaultRoot,
      ])
      const shownPrivateProtocol = await runSliceCli<{
        protocol: Record<string, unknown>
      }>([
        'protocol',
        'show',
        'dry-sauna-2x-week',
        '--vault',
        vaultRoot,
      ])
      const restarted = await runSliceCli<{
        protocol: {
          created: boolean
        } | null
        experiment: {
          created: boolean
        }
      }>([
        'experiment',
        'start',
        '--input',
        `@${planPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(planned.ok, true)
      assert.equal(requireData(planned).plan.needsPrivateProtocol, true)
      assert.deepEqual(requireData(planned).plan.operations, [
        'protocol_upsert',
        'experiment_create',
        'experiment_update',
      ])

      assert.equal(started.ok, true)
      assert.equal(requireData(started).protocol?.slug, 'dry-sauna-2x-week')
      assert.equal(requireData(started).protocol?.created, true)
      assert.equal(requireData(started).experiment.slug, 'sauna-two-week')
      assert.equal(requireData(started).experiment.created, true)
      assert.equal(requireData(started).experiment.updated, true)

      const experimentData = requireData(shown).entity.data
      const protocolRef = requireRecord(
        experimentData.protocolRef,
        'protocolRef',
      )
      const effectiveProtocolSnapshot = requireRecord(
        experimentData.effectiveProtocolSnapshot,
        'effectiveProtocolSnapshot',
      )
      const runPlan = requireRecord(experimentData.runPlan, 'runPlan')

      assert.equal(
        protocolRef.protocolId,
        requireData(started).protocol?.protocolId,
      )
      assert.equal(
        protocolRef.protocolRevisionId,
        requireData(started).protocol?.protocolRevisionId,
      )
      assert.equal(
        protocolRef.effectiveSpecHash,
        requireData(started).protocol?.effectiveSpecHash,
      )
      assert.equal(
        effectiveProtocolSnapshot.effectiveSpecHash,
        protocolRef.effectiveSpecHash,
      )
      assert.equal(effectiveProtocolSnapshot.doseSignature, '2x/week dry sauna, 15-20 min, about 80 C')
      assert.deepEqual(runPlan.baseline, {
        mode: 'retrospective',
        source: 'wearable_history',
        start: '2026-04-24',
        end: '2026-04-30',
      })
      assert.equal(runPlan.sessionsPerWeek, 2)
      assert.equal(runPlan.targetSessions, 4)

      assert.equal(shownPrivateProtocol.ok, true)
      assert.equal(requireData(shownPrivateProtocol).protocol.slug, 'dry-sauna-2x-week')

      assert.equal(restarted.ok, true)
      assert.equal(requireData(restarted).protocol?.created, false)
      assert.equal(requireData(restarted).experiment.created, false)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment session/context log can write typed event records without JSON payloads',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-context-'))

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
        'create',
        'context-seam',
        '--title',
        'Context Seam',
        '--started-on',
        '2026-04-01',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const conflictingSessionStatus = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'context-seam',
        '--status',
        'completed',
        '--session-status',
        'missed',
        '--vault',
        vaultRoot,
      ])
      const contextSeverityWithoutType = await runSliceCli<unknown>([
        'experiment',
        'context',
        'log',
        'context-seam',
        '--severity',
        'safety',
        '--note',
        'High stress day.',
        '--vault',
        vaultRoot,
      ])
      const noteWithSupplementFields = await runSliceCli<unknown>([
        'experiment',
        'context',
        'log',
        'context-seam',
        '--kind',
        'note',
        '--note',
        'Supplement detail belongs on supplement_intake.',
        '--supplement-name',
        'Creatine',
        '--dose',
        '5',
        '--unit',
        'g',
        '--vault',
        vaultRoot,
      ])

      assert.equal(conflictingSessionStatus.ok, false)
      assert.match(
        conflictingSessionStatus.error.message ?? '',
        /--status and --session-status must match/u,
      )
      assert.equal(contextSeverityWithoutType.ok, false)
      assert.match(
        contextSeverityWithoutType.error.message ?? '',
        /--context-type is required/u,
      )
      assert.equal(noteWithSupplementFields.ok, false)
      assert.match(
        noteWithSupplementFields.error.message ?? '',
        /not valid for experiment context kind "note"/u,
      )

      const loggedSession = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        eventId: string
        kind: string
      }>([
        'experiment',
        'session',
        'log',
        'context-seam',
        '--occurred-at',
        '2026-04-09T18:30:00.000Z',
        '--title',
        'Evening sauna',
        '--intervention-type',
        'sauna',
        '--duration-minutes',
        '18',
        '--timing',
        'evening',
        '--temperature-c',
        '82',
        '--after-exercise',
        '--symptoms',
        'warm fatigue',
        '--confounders',
        'hard training',
        '--vault',
        vaultRoot,
      ])
      const shownSession = await runSliceCli<{
        entity: {
          kind: string
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(loggedSession).eventId,
        '--vault',
        vaultRoot,
      ])
      const loggedContext = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        eventId: string
        kind: string
      }>([
        'experiment',
        'context',
        'log',
        'context-seam',
        '--occurred-at',
        '2026-04-10T18:00:00.000Z',
        '--title',
        'Travel week',
        '--context-type',
        'travel',
        '--severity',
        'potential_confounder',
        '--note',
        'Hotel sleep and airport meals likely affected recovery.',
        '--tag',
        'travel',
        '--vault',
        vaultRoot,
      ])
      const shownContext = await runSliceCli<{
        entity: {
          kind: string
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(loggedContext).eventId,
        '--vault',
        vaultRoot,
      ])
      const loggedSupplement = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        eventId: string
        kind: string
      }>([
        'experiment',
        'context',
        'log',
        'context-seam',
        '--kind',
        'supplement_intake',
        '--occurred-at',
        '2026-04-11T07:30:00.000Z',
        '--title',
        'Creatine added',
        '--supplement-name',
        'Creatine',
        '--dose',
        '5',
        '--unit',
        'g',
        '--note',
        'Added during the intervention window.',
        '--vault',
        vaultRoot,
      ])
      const shownSupplement = await runSliceCli<{
        entity: {
          kind: string
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(loggedSupplement).eventId,
        '--vault',
        vaultRoot,
      ])

      assert.equal(loggedSession.ok, true)
      assert.equal(loggedSession.meta?.command, 'experiment session log')
      assert.equal(requireData(loggedSession).lookupId, requireData(created).experimentId)
      assert.equal(requireData(loggedSession).slug, 'context-seam')
      assert.equal(requireData(loggedSession).kind, 'intervention_session')
      assert.match(requireData(loggedSession).eventId, /^evt_/u)

      assert.equal(shownSession.ok, true)
      assert.equal(requireData(shownSession).entity.kind, 'intervention_session')
      assert.equal(requireData(shownSession).entity.title, 'Evening sauna')
      assert.equal(
        requireData(shownSession).entity.data.experimentId,
        requireData(created).experimentId,
      )
      assert.equal(requireData(shownSession).entity.data.experimentSlug, 'context-seam')
      assert.equal(requireData(shownSession).entity.data.interventionType, 'sauna')
      assert.equal(requireData(shownSession).entity.data.durationMinutes, 18)
      assert.equal(requireData(shownSession).entity.data.temperatureC, 82)
      assert.equal(requireData(shownSession).entity.data.afterExercise, true)

      assert.equal(loggedContext.ok, true)
      assert.equal(loggedContext.meta?.command, 'experiment context log')
      assert.equal(requireData(loggedContext).lookupId, requireData(created).experimentId)
      assert.equal(requireData(loggedContext).kind, 'experiment_context')
      assert.match(requireData(loggedContext).eventId, /^evt_/u)

      assert.equal(shownContext.ok, true)
      assert.equal(requireData(shownContext).entity.kind, 'experiment_context')
      assert.equal(requireData(shownContext).entity.title, 'Travel week')
      assert.equal(
        requireData(shownContext).entity.data.experimentId,
        requireData(created).experimentId,
      )
      assert.equal(requireData(shownContext).entity.data.experimentSlug, 'context-seam')
      assert.equal(requireData(shownContext).entity.data.contextType, 'travel')
      assert.equal(requireData(shownContext).entity.data.severity, 'potential_confounder')

      assert.equal(loggedSupplement.ok, true)
      assert.equal(loggedSupplement.meta?.command, 'experiment context log')
      assert.equal(requireData(loggedSupplement).lookupId, requireData(created).experimentId)
      assert.equal(requireData(loggedSupplement).kind, 'supplement_intake')
      assert.match(requireData(loggedSupplement).eventId, /^evt_/u)

      assert.equal(shownSupplement.ok, true)
      assert.equal(requireData(shownSupplement).entity.kind, 'supplement_intake')
      assert.equal(requireData(shownSupplement).entity.title, 'Creatine added')
      assert.equal(
        requireData(shownSupplement).entity.data.experimentId,
        requireData(created).experimentId,
      )
      assert.equal(requireData(shownSupplement).entity.data.experimentSlug, 'context-seam')
      assert.equal(requireData(shownSupplement).entity.data.supplementName, 'Creatine')
      assert.equal(requireData(shownSupplement).entity.data.dose, 5)
      assert.equal(requireData(shownSupplement).entity.data.unit, 'g')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment update, checkpoint, and stop mutate the experiment page and append lifecycle events',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-phase2-'))

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
        'create',
        'focus-sprint',
        '--title',
        'Focus Sprint',
        '--started-on',
        '2026-03-10',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const updated = await runSliceCli<{
        experimentId: string
        slug: string
        status: string
      }>([
        'experiment',
        'update',
        'focus-sprint',
        '--title',
        'Focus Sprint Updated',
        '--hypothesis',
        'Walking after lunch improves the afternoon energy dip.',
        '--status',
        'paused',
        '--body',
        '# Focus Sprint Updated\n\n## Plan\n\nKeep the walks short and consistent.\n',
        '--tag',
        'energy',
        '--tag',
        'walking',
        '--vault',
        vaultRoot,
      ])
      const checkpoint = await runSliceCli<{
        experimentId: string
        eventId: string
        ledgerFile: string
        status: string
      }>([
        'experiment',
        'checkpoint',
        'focus-sprint',
        '--occurred-at',
        '2026-03-12T14:30:00Z',
        '--title',
        'Midpoint',
        '--note',
        'Energy improved after lunch and the afternoon dip arrived later.',
        '--vault',
        vaultRoot,
      ])
      const stopped = await runSliceCli<{
        experimentId: string
        eventId: string
        status: string
      }>([
        'experiment',
        'stop',
        'focus-sprint',
        '--occurred-at',
        '2026-03-14',
        '--note',
        'The sprint is complete and the updated routine is stable enough to keep.',
        '--vault',
        vaultRoot,
      ])
      const shown = await runSliceCli<{
        entity: {
          title: string | null
          markdown: string | null
          data: Record<string, unknown>
        }
      }>([
        'experiment',
        'show',
        'focus-sprint',
        '--vault',
        vaultRoot,
      ])
      const eventShown = await runSliceCli<{
        entity: {
          kind: string
          occurredAt: string | null
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(stopped).eventId,
        '--vault',
        vaultRoot,
      ])
      const listed = await runSliceCli<{
        count: number
        items: Array<{
          id: string
          excerpt?: string | null
          markdown?: string | null
        }>
      }>([
        'experiment',
        'list',
        '--status',
        'completed',
        '--vault',
        vaultRoot,
      ])

      assert.equal(updated.ok, true)
      assert.equal(updated.meta?.command, 'experiment update')
      assert.equal(requireData(updated).status, 'paused')
      assert.equal(checkpoint.ok, true)
      assert.equal(checkpoint.meta?.command, 'experiment checkpoint')
      assert.match(requireData(checkpoint).eventId, /^evt_/u)
      assert.match(requireData(checkpoint).ledgerFile, /^ledger\/events\//u)
      assert.equal(stopped.ok, true)
      assert.equal(stopped.meta?.command, 'experiment stop')
      assert.equal(requireData(stopped).status, 'completed')

      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.title, 'Focus Sprint Updated')
      assert.equal(requireData(shown).entity.data.status, 'completed')
      assert.equal(requireData(shown).entity.data.endedOn, '2026-03-14')
      assert.equal(
        requireData(shown).entity.data.hypothesis,
        'Walking after lunch improves the afternoon energy dip.',
      )
      assert.match(requireData(shown).entity.markdown ?? '', /Midpoint/u)
      assert.match(
        requireData(shown).entity.markdown ?? '',
        /The sprint is complete and the updated routine is stable enough to keep\./u,
      )

      assert.equal(eventShown.ok, true)
      assert.equal(requireData(eventShown).entity.kind, 'experiment_event')
      assert.equal(requireData(eventShown).entity.occurredAt, '2026-03-14T19:00:00.000Z')
      assert.equal(requireData(eventShown).entity.data.phase, 'stop')
      assert.equal(
        requireData(eventShown).entity.data.experimentId,
        requireData(created).experimentId,
      )
      assert.equal(listed.ok, true)
      assert.equal(requireData(listed).count, 1)
      assert.match(
        requireData(listed).items[0]?.excerpt ?? '',
        /Focus Sprint Updated Plan Keep the walks short and consistent\./u,
      )
      assert.equal('markdown' in (requireData(listed).items[0] ?? {}), false)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment session/context logging feeds deterministic progress and outcome analysis for the same run',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-experiment-analysis-'))
    const planPath = path.join(vaultRoot, 'focus-sprint-direct-plan.json')
    const pageRevisionId = `sha256:${'c'.repeat(64)}`
    const runSpecRevisionId = `sha256:${'d'.repeat(64)}`

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
        'create',
        'focus-sprint',
        '--title',
        'Focus Sprint',
        '--started-on',
        '2026-04-01',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)
      await writeDirectPublicSaunaPlan({
        filePath: planPath,
        slug: 'focus-sprint',
        title: 'Focus Sprint',
        startedOn: '2026-04-01',
        status: 'active',
        pageRevisionId,
        runSpecRevisionId,
      })
      const started = await runSliceCli([
        'experiment',
        'start',
        '--input',
        `@${planPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(started.ok, true)

      const updated = await runSliceCli<{
        experimentId: string
        slug: string
        status: string
      }>([
        'experiment',
        'apply-onboarding',
        'focus-sprint',
        '--protocol-key',
        'protocol_variant:dry-sauna/finnish-standard-3x-week',
        '--page-revision-id',
        pageRevisionId,
        '--run-spec-revision-id',
        runSpecRevisionId,
        '--test-plan-id',
        'resting-heart-rate-21d',
        '--baseline-start',
        '2026-04-01',
        '--baseline-end',
        '2026-04-07',
        '--intervention-start',
        '2026-04-08',
        '--intervention-end',
        '2026-04-21',
        '--modality',
        'sauna',
        '--target-sessions',
        '4',
        '--minimum-useful-sessions',
        '3',
        '--primary-biomarker-key',
        'biomarker:resting-heart-rate',
        '--desired-direction',
        'decrease',
        '--reminders-enabled',
        '--vault',
        vaultRoot,
      ])
      const sessionBySlug = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        eventId: string
        kind: string
      }>([
        'experiment',
        'session',
        'log',
        'focus-sprint',
        '--occurred-at',
        '2026-04-10T02:00:00.000Z',
        '--title',
        'Sauna Session 1',
        '--intervention-type',
        'sauna',
        '--duration-minutes',
        '20',
        '--timing',
        'evening',
        '--vault',
        vaultRoot,
      ])
      const sessionById = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        eventId: string
        kind: string
      }>([
        'experiment',
        'session',
        'log',
        requireData(created).experimentId,
        '--occurred-at',
        '2026-04-18T20:00:00.000Z',
        '--title',
        'Sauna Session 2',
        '--intervention-type',
        'sauna',
        '--duration-minutes',
        '22',
        '--timing',
        'evening',
        '--after-exercise',
        '--confounders',
        'hard training',
        '--symptoms',
        'lightheaded',
        '--vault',
        vaultRoot,
      ])
      const contextById = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        eventId: string
        kind: string
      }>([
        'experiment',
        'context',
        'log',
        requireData(created).experimentId,
        '--kind',
        'note',
        '--occurred-at',
        '2026-04-19T09:00:00.000Z',
        '--title',
        'Travel day',
        '--note',
        'Hotel sleep and airport food likely affected recovery.',
        '--tag',
        'travel',
        '--vault',
        vaultRoot,
      ])
      const shownSession = await runSliceCli<{
        entity: {
          kind: string
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(sessionById).eventId,
        '--vault',
        vaultRoot,
      ])
      const shownContext = await runSliceCli<{
        entity: {
          kind: string
          title: string | null
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(contextById).eventId,
        '--vault',
        vaultRoot,
      ])
      const progress = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        asOf: string
        progress: {
          schema: string
          dayInRun: number | null
          phase: string
          adherence: {
            completedSessions: number
            expectedSessionsByNow: number | null
            minimumUsefulSessions: number | null
            status: string
            targetSessions: number | null
          }
          dataCoverage: {
            baselineDaysAvailable: number
            interventionDaysAvailable: number
            primaryMetricDaysAvailable: number
            status: string
          }
          recommendation: {
            action: string
            reason: string
            shouldNotifyUser: boolean
          }
          confounders: string[]
          windows: Record<string, string | null>
        }
      }>([
        'experiment',
        'progress',
        'focus-sprint',
        '--as-of',
        '2026-04-20',
        '--vault',
        vaultRoot,
      ])
      const progressAgain = await runSliceCli<{
        progress: Record<string, unknown>
      }>([
        'experiment',
        'progress',
        'focus-sprint',
        '--as-of',
        '2026-04-20',
        '--vault',
        vaultRoot,
      ])
      const missedLogDue = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        kind: string
        date: string
        decision: {
          schema: string
          action: string
          reason: string
          dedupeKey: string
          window: {
            sessionDate: string | null
          }
        }
      }>([
        'experiment',
        'followup',
        'due',
        'focus-sprint',
        '--kind',
        'missed-log',
        '--date',
        '2026-04-20',
        '--vault',
        vaultRoot,
      ])
      const outcome = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        asOf: string
        outcome: {
          schema: string
          outcomeId: string
          adherenceSummary: {
            adherenceLevel?: string
            completedSessions: number
            minimumUsefulSessions: number | null
            status: string
            targetSessions: number | null
          }
          confidence: {
            level: string
            reasons: string[]
          }
          conclusion: {
            caveats: string[]
            headline: string
            plainLanguage: string
          }
          confounders: string[]
          windows: Record<string, string | null>
          metricResults: Array<{
            baselineDayCount: number
            baselineMean: number | null
            biomarkerKey: string
            completeness: string
            deltaAbs: number | null
            deltaPct: number | null
            expectedDirection: string | null
            interventionDayCount: number
            interventionMean: number | null
            label: string
            movedAsExpected: boolean | null
            unit: string | null
          }>
          generatedAt?: string
        }
      }>([
        'experiment',
        'outcome',
        'analyze',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-25',
        '--vault',
        vaultRoot,
      ])
      const outcomeAgain = await runSliceCli<{
        outcome: {
          adherenceSummary: Record<string, unknown>
          confidence: Record<string, unknown>
          conclusion: Record<string, unknown>
          confounders: string[]
          metricResults: unknown
          outcomeId: string
          schema: string
          windows: Record<string, string | null>
        } & Record<string, unknown>
      }>([
        'experiment',
        'outcome',
        'analyze',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-25',
        '--vault',
        vaultRoot,
      ])
      const writtenOutcome = await runSliceCli<{
        experimentId: string
        lookupId: string
        slug: string
        asOf: string
        outcomePath: string
        updatedExperiment: boolean
        outcome: {
          schema: string
          outcomeId: string
          generatedAt?: string
          adherenceSummary: Record<string, unknown>
          confidence: Record<string, unknown>
          conclusion: Record<string, unknown>
          confounders: string[]
          metricResults: unknown
          windows: Record<string, string | null>
        } & Record<string, unknown>
      }>([
        'experiment',
        'outcome',
        'write',
        requireData(created).experimentId,
        '--as-of',
        '2026-04-25',
        '--vault',
        vaultRoot,
      ])
      const shownExperimentAfterWrite = await runSliceCli<{
        entity: {
          data: Record<string, unknown>
        }
      }>([
        'experiment',
        'show',
        'focus-sprint',
        '--vault',
        vaultRoot,
      ])

      assert.equal(updated.ok, true)
      assert.equal(updated.meta?.command, 'experiment apply-onboarding')

      assert.equal(sessionBySlug.ok, true)
      assert.equal(sessionBySlug.meta?.command, 'experiment session log')
      assert.equal(requireData(sessionBySlug).lookupId, requireData(created).experimentId)
      assert.equal(requireData(sessionBySlug).slug, 'focus-sprint')
      assert.equal(requireData(sessionBySlug).kind, 'intervention_session')
      assert.match(requireData(sessionBySlug).eventId, /^evt_/u)

      assert.equal(sessionById.ok, true)
      assert.equal(sessionById.meta?.command, 'experiment session log')
      assert.equal(requireData(sessionById).lookupId, requireData(created).experimentId)
      assert.equal(requireData(sessionById).kind, 'intervention_session')
      assert.notEqual(requireData(sessionById).eventId, requireData(sessionBySlug).eventId)

      assert.equal(contextById.ok, true)
      assert.equal(contextById.meta?.command, 'experiment context log')
      assert.equal(requireData(contextById).lookupId, requireData(created).experimentId)
      assert.equal(requireData(contextById).slug, 'focus-sprint')
      assert.equal(requireData(contextById).kind, 'note')
      assert.match(requireData(contextById).eventId, /^evt_/u)

      assert.equal(shownSession.ok, true)
      assert.equal(requireData(shownSession).entity.kind, 'intervention_session')
      assert.equal(requireData(shownSession).entity.title, 'Sauna Session 2')
      assert.equal(
        requireData(shownSession).entity.data.experimentId,
        requireData(created).experimentId,
      )
      assert.equal(requireData(shownSession).entity.data.experimentSlug, 'focus-sprint')

      assert.equal(shownContext.ok, true)
      assert.equal(requireData(shownContext).entity.kind, 'note')
      assert.equal(requireData(shownContext).entity.title, 'Travel day')
      assert.equal(
        requireData(shownContext).entity.data.experimentId,
        requireData(created).experimentId,
      )
      assert.equal(requireData(shownContext).entity.data.experimentSlug, 'focus-sprint')

      assert.equal(progress.ok, true)
      assert.equal(progress.meta?.command, 'experiment progress')
      assert.equal(requireData(progress).experimentId, requireData(created).experimentId)
      assert.equal(requireData(progress).lookupId, requireData(created).experimentId)
      assert.equal(requireData(progress).slug, 'focus-sprint')
      assert.equal(requireData(progress).asOf, '2026-04-20')
      assert.equal(requireData(progress).progress.schema, 'murph.experiment-progress.v1')
      assert.equal(requireData(progress).progress.phase, 'intervention')
      assert.equal(requireData(progress).progress.dayInRun, 20)
      assert.deepEqual(requireData(progress).progress.adherence, {
        completedSessions: 2,
        expectedSessionsByNow: 3,
        minimumUsefulSessions: 3,
        sessionEventIds: [
          requireData(sessionBySlug).eventId,
          requireData(sessionById).eventId,
        ],
        status: 'behind',
        targetSessions: 4,
      })
      assert.deepEqual(requireData(progress).progress.dataCoverage, {
        baselineDaysAvailable: 0,
        interventionDaysAvailable: 0,
        primaryBiomarkerKey: 'biomarker:resting-heart-rate',
        primaryMetricDaysAvailable: 0,
        status: 'no_wearable_data',
        wearableProviders: [],
      })
      assert.deepEqual(requireData(progress).progress.confounders, [
        'post-exercise session on 2026-04-18',
        'hard training on 2026-04-18',
        'lightheaded reported on 2026-04-18',
        'Travel day on 2026-04-19',
      ])
      assert.deepEqual(requireData(progress).progress.recommendation, {
        action: 'remind',
        reason: 'Logged sessions are behind the current target pace.',
        shouldNotifyUser: true,
      })
      assert.deepEqual(requireData(progress).progress.windows, {
        baselineEnd: '2026-04-07',
        baselineStart: '2026-04-01',
        interventionEnd: '2026-04-21',
        interventionStart: '2026-04-08',
      })
      assert.deepEqual(requireData(progressAgain).progress, requireData(progress).progress)
      assert.equal(missedLogDue.ok, true)
      assert.equal(missedLogDue.meta?.command, 'experiment followup due')
      assert.equal(requireData(missedLogDue).experimentId, requireData(created).experimentId)
      assert.equal(requireData(missedLogDue).lookupId, requireData(created).experimentId)
      assert.equal(requireData(missedLogDue).slug, 'focus-sprint')
      assert.equal(requireData(missedLogDue).kind, 'missed-log')
      assert.equal(requireData(missedLogDue).date, '2026-04-20')
      assert.equal(requireData(missedLogDue).decision.schema, 'murph.experiment-followup-due.v1')
      assert.equal(requireData(missedLogDue).decision.action, 'skip')
      assert.equal(requireData(missedLogDue).decision.reason, 'unsupported_session_schedule')
      assert.equal(requireData(missedLogDue).decision.window.sessionDate, null)
      assert.match(
        requireData(missedLogDue).decision.dedupeKey,
        /^experiment-followup:exp_[A-Z0-9]+:missed-log:2026-04-20$/u,
      )

      assert.equal(outcome.ok, true)
      assert.equal(outcome.meta?.command, 'experiment outcome analyze')
      assert.equal(requireData(outcome).experimentId, requireData(created).experimentId)
      assert.equal(requireData(outcome).lookupId, requireData(created).experimentId)
      assert.equal(requireData(outcome).slug, 'focus-sprint')
      assert.equal(requireData(outcome).asOf, '2026-04-25')
      assert.equal(requireData(outcome).outcome.schema, 'murph.experiment-outcome.v1')
      assert.equal(
        requireData(outcome).outcome.outcomeId,
        `${requireData(created).experimentId}-outcome-2026-04-25`,
      )
      assert.deepEqual(requireData(outcome).outcome.adherenceSummary, {
        adherenceLevel: 'low',
        completedSessions: 2,
        minimumUsefulSessions: 3,
        status: 'behind',
        targetSessions: 4,
      })
      assert.deepEqual(requireData(outcome).outcome.confidence, {
        level: 'low',
        reasons: [
          'Primary biomarker coverage is insufficient for a strong before-and-after read.',
          'Completed session count stayed below the minimum useful target.',
          'Context and confounder logs were present during the run.',
        ],
      })
      assert.deepEqual(requireData(outcome).outcome.conclusion, {
        caveats: [
          'This is an N-of-1 readout, not medical advice.',
          'Sparse wearable coverage or missing sessions can make this directional rather than decisive.',
        ],
        headline: 'The experiment finished, but the primary biomarker readout is incomplete.',
        plainLanguage:
          'Murph reached the end of the run, but there was not enough primary biomarker data to make a trustworthy before-and-after comparison.',
      })
      assert.deepEqual(requireData(outcome).outcome.metricResults, [
        {
          baseline: {
            daysWithData: 0,
            mean: null,
            totalDays: 7,
            unit: null,
          },
          baselineDayCount: 0,
          baselineMean: null,
          biomarkerKey: 'biomarker:resting-heart-rate',
          completeness: 'insufficient',
          deltaAbs: null,
          deltaPct: null,
          expectedDirection: 'decrease',
          intervention: {
            daysWithData: 0,
            mean: null,
            totalDays: 14,
            unit: null,
          },
          interventionDayCount: 0,
          interventionMean: null,
          label: 'Resting Heart Rate',
          movedAsExpected: null,
          unit: null,
        },
      ])
      assert.deepEqual(requireData(outcome).outcome.confounders, [
        'post-exercise session on 2026-04-18',
        'hard training on 2026-04-18',
        'lightheaded reported on 2026-04-18',
        'Travel day on 2026-04-19',
      ])
      assert.deepEqual(requireData(outcome).outcome.windows, {
        baselineEnd: '2026-04-07',
        baselineStart: '2026-04-01',
        interventionEnd: '2026-04-21',
        interventionStart: '2026-04-08',
      })
      assert.deepEqual(
        {
          adherenceSummary: requireData(outcomeAgain).outcome.adherenceSummary,
          confidence: requireData(outcomeAgain).outcome.confidence,
          conclusion: requireData(outcomeAgain).outcome.conclusion,
          confounders: requireData(outcomeAgain).outcome.confounders,
          metricResults: requireData(outcomeAgain).outcome.metricResults,
          outcomeId: requireData(outcomeAgain).outcome.outcomeId,
          schema: requireData(outcomeAgain).outcome.schema,
          windows: requireData(outcomeAgain).outcome.windows,
        },
        {
          adherenceSummary: requireData(outcome).outcome.adherenceSummary,
          confidence: requireData(outcome).outcome.confidence,
          conclusion: requireData(outcome).outcome.conclusion,
          confounders: requireData(outcome).outcome.confounders,
          metricResults: requireData(outcome).outcome.metricResults,
          outcomeId: requireData(outcome).outcome.outcomeId,
          schema: requireData(outcome).outcome.schema,
          windows: requireData(outcome).outcome.windows,
        },
      )

      assert.equal(writtenOutcome.ok, true)
      assert.equal(writtenOutcome.meta?.command, 'experiment outcome write')
      assert.equal(requireData(writtenOutcome).experimentId, requireData(created).experimentId)
      assert.equal(requireData(writtenOutcome).lookupId, requireData(created).experimentId)
      assert.equal(requireData(writtenOutcome).slug, 'focus-sprint')
      assert.equal(requireData(writtenOutcome).asOf, '2026-04-25')
      assert.equal(requireData(writtenOutcome).updatedExperiment, true)
      assert.equal(
        requireData(writtenOutcome).outcomePath,
        'bank/experiments/outcomes/focus-sprint-2026-04-25.json',
      )
      assert.equal(
        requireData(writtenOutcome).outcome.outcomeId,
        `${requireData(created).experimentId}-outcome-2026-04-25`,
      )
      assert.equal(typeof requireData(writtenOutcome).outcome.generatedAt, 'string')
      assert.deepEqual(
        {
          adherenceSummary: requireData(writtenOutcome).outcome.adherenceSummary,
          confidence: requireData(writtenOutcome).outcome.confidence,
          conclusion: requireData(writtenOutcome).outcome.conclusion,
          confounders: requireData(writtenOutcome).outcome.confounders,
          metricResults: requireData(writtenOutcome).outcome.metricResults,
          outcomeId: requireData(writtenOutcome).outcome.outcomeId,
          schema: requireData(writtenOutcome).outcome.schema,
          windows: requireData(writtenOutcome).outcome.windows,
        },
        {
          adherenceSummary: requireData(outcome).outcome.adherenceSummary,
          confidence: requireData(outcome).outcome.confidence,
          conclusion: requireData(outcome).outcome.conclusion,
          confounders: requireData(outcome).outcome.confounders,
          metricResults: requireData(outcome).outcome.metricResults,
          outcomeId: requireData(outcome).outcome.outcomeId,
          schema: requireData(outcome).outcome.schema,
          windows: requireData(outcome).outcome.windows,
        },
      )

      const persistedOutcome = JSON.parse(
        await readFile(
          path.join(vaultRoot, requireData(writtenOutcome).outcomePath),
          'utf8',
        ),
      ) as Record<string, unknown>
      assert.deepEqual(persistedOutcome, requireData(writtenOutcome).outcome)

      const shownExperimentData = requireData(shownExperimentAfterWrite).entity.data
      const outcomeSummary = shownExperimentData.outcome
      assert.equal(typeof outcomeSummary, 'object')
      assert.ok(outcomeSummary && !Array.isArray(outcomeSummary))
      assert.equal(
        (outcomeSummary as Record<string, unknown>).latestOutcomeId,
        requireData(writtenOutcome).outcome.outcomeId,
      )
      assert.equal(
        (outcomeSummary as Record<string, unknown>).finalAnalysisStatus,
        'generated',
      )

      const outcomeRef = shownExperimentData.outcomeRef
      assert.equal(typeof outcomeRef, 'object')
      assert.ok(outcomeRef && !Array.isArray(outcomeRef))
      assert.equal(
        (outcomeRef as Record<string, unknown>).outcomeId,
        requireData(writtenOutcome).outcome.outcomeId,
      )
      assert.equal(
        (outcomeRef as Record<string, unknown>).relativePath,
        requireData(writtenOutcome).outcomePath,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'journal append plus typed link and unlink flags mutate body and frontmatter collections',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-journal-phase2-'))
    const firstEventId = 'evt_01JNV422Y2M5ZBV64ZP4N1DRB1'
    const secondEventId = 'evt_01JNV422Y2M5ZBV64ZP4N1DRB2'

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      const appended = await runSliceCli<{
        created: boolean
        updated: boolean
      }>([
        'journal',
        'append',
        '2026-03-12',
        '--text',
        'Evening note from the CLI append helper.',
        '--vault',
        vaultRoot,
      ])
      const linked = await runSliceCli<{
        changed: number
        eventIds: string[]
      }>([
        'journal',
        'link',
        '2026-03-12',
        '--event-id',
        '   ',
        '--event-id',
        firstEventId,
        '--event-id',
        secondEventId,
        '--vault',
        vaultRoot,
      ])
      const linkedStreams = await runSliceCli<{
        changed: number
        sampleStreams: string[]
      }>([
        'journal',
        'link',
        '2026-03-12',
        '--stream',
        ' glucose ',
        '--stream',
        'glucose',
        '--stream',
        'heart_rate',
        '--vault',
        vaultRoot,
      ])
      const mixedLink = await runSliceCli([
        'journal',
        'link',
        '2026-03-12',
        '--event-id',
        secondEventId,
        '--stream',
        'heart_rate',
        '--vault',
        vaultRoot,
      ])
      const commaDelimitedEventLink = await runSliceCli([
        'journal',
        'link',
        '2026-03-12',
        '--event-id',
        `${firstEventId},${secondEventId}`,
        '--vault',
        vaultRoot,
      ])
      const commaDelimitedStreamLink = await runSliceCli([
        'journal',
        'link',
        '2026-03-12',
        '--stream',
        'glucose,heart_rate',
        '--vault',
        vaultRoot,
      ])
      const unlinked = await runSliceCli<{
        changed: number
        eventIds: string[]
      }>([
        'journal',
        'unlink',
        '2026-03-12',
        '--event-id',
        secondEventId,
        '--vault',
        vaultRoot,
      ])
      const unlinkedStream = await runSliceCli<{
        changed: number
        sampleStreams: string[]
      }>([
        'journal',
        'unlink',
        '2026-03-12',
        '--stream',
        'heart_rate',
        '--vault',
        vaultRoot,
      ])
      const mixedUnlink = await runSliceCli([
        'journal',
        'unlink',
        '2026-03-12',
        '--event-id',
        firstEventId,
        '--stream',
        'glucose',
        '--vault',
        vaultRoot,
      ])
      const invalidLink = await runSliceCli([
        'journal',
        'link',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])
      const whitespaceOnlyStreamLink = await runSliceCli([
        'journal',
        'link',
        '2026-03-12',
        '--stream',
        '   ',
        '--vault',
        vaultRoot,
      ])
      const shown = await runSliceCli<{
        entity: {
          markdown: string | null
          data: Record<string, unknown>
        }
      }>([
        'journal',
        'show',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])
      const listed = await runSliceCli<{
        count: number
        items: Array<{
          id: string
          excerpt?: string | null
          markdown?: string | null
        }>
      }>([
        'journal',
        'list',
        '--from',
        '2026-03-12',
        '--to',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])

      assert.equal(appended.ok, true)
      assert.equal(appended.meta?.command, 'journal append')
      assert.equal(requireData(appended).updated, true)
      assert.equal(linked.ok, true)
      assert.equal(requireData(linked).changed, 2)
      assert.deepEqual(requireData(linked).eventIds, [firstEventId, secondEventId])
      assert.equal(linkedStreams.ok, true)
      assert.equal(requireData(linkedStreams).changed, 2)
      assert.deepEqual(requireData(linkedStreams).sampleStreams, ['glucose', 'heart_rate'])
      assert.equal(mixedLink.ok, false)
      assert.match(
        mixedLink.error?.message ?? '',
        /Pass either --event-id or --stream in one command/u,
      )
      assert.equal(commaDelimitedEventLink.ok, false)
      assert.match(
        commaDelimitedEventLink.error?.message ?? '',
        /repeat the flag instead|comma-delimited values are not supported/iu,
      )
      assert.equal(commaDelimitedStreamLink.ok, false)
      assert.match(
        commaDelimitedStreamLink.error?.message ?? '',
        /repeat the flag instead|comma-delimited values are not supported/iu,
      )
      assert.equal(unlinked.ok, true)
      assert.equal(requireData(unlinked).changed, 1)
      assert.deepEqual(requireData(unlinked).eventIds, [firstEventId])
      assert.equal(unlinkedStream.ok, true)
      assert.equal(requireData(unlinkedStream).changed, 1)
      assert.deepEqual(requireData(unlinkedStream).sampleStreams, ['glucose'])
      assert.equal(mixedUnlink.ok, false)
      assert.match(
        mixedUnlink.error?.message ?? '',
        /Pass either --event-id or --stream in one command/u,
      )
      assert.equal(invalidLink.ok, false)
      assert.match(
        invalidLink.error?.message ?? '',
        /Expected at least one of --event-id or --stream/u,
      )
      assert.equal(whitespaceOnlyStreamLink.ok, false)
      assert.match(
        whitespaceOnlyStreamLink.error?.message ?? '',
        /Expected at least one of --event-id or --stream/u,
      )

      assert.equal(shown.ok, true)
      assert.match(requireData(shown).entity.markdown ?? '', /Evening note from the CLI append helper\./u)
      assert.deepEqual(requireData(shown).entity.data.eventIds, [firstEventId])
      assert.deepEqual(requireData(shown).entity.data.sampleStreams, ['glucose'])
      assert.equal(listed.ok, true)
      assert.equal(requireData(listed).count, 1)
      assert.match(
        requireData(listed).items[0]?.excerpt ?? '',
        /Evening note from the CLI append helper\./u,
      )
      assert.equal('markdown' in (requireData(listed).items[0] ?? {}), false)

      const journalPath = path.join(vaultRoot, 'journal/2026/2026-03-12.md')
      const journalMarkdown = await readFile(journalPath, 'utf8')
      assert.match(journalMarkdown, /Evening note from the CLI append helper\./u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'vault update mutates vault.json and CORE.md title and timezone fields',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-vault-phase2-'))

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      const updated = await runSliceCli<{
        title: string
        timezone: string
        metadataFile: string
        corePath: string
        updatedAt: string
      }>([
        'vault',
        'update',
        '--title',
        'Precision Health Vault',
        '--timezone',
        'UTC',
        '--vault',
        vaultRoot,
      ])
      const shown = await runSliceCli<{
        title: string | null
        timezone: string | null
        coreTitle: string | null
      }>([
        'vault',
        'show',
        '--vault',
        vaultRoot,
      ])

      assert.equal(updated.ok, true)
      assert.equal(updated.meta?.command, 'vault update')
      assert.equal(requireData(updated).title, 'Precision Health Vault')
      assert.equal(requireData(updated).timezone, 'UTC')
      assert.equal(requireData(updated).metadataFile, 'vault.json')
      assert.equal(requireData(updated).corePath, 'CORE.md')
      assert.match(requireData(updated).updatedAt, /^2026|^20\d{2}/u)

      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).title, 'Precision Health Vault')
      assert.equal(requireData(shown).timezone, 'UTC')
      assert.equal(requireData(shown).coreTitle, 'Precision Health Vault')

      const metadata = JSON.parse(
        await readFile(path.join(vaultRoot, 'vault.json'), 'utf8'),
      ) as {
        formatVersion: number
        title: string
        timezone: string
      }
      const coreMarkdown = await readFile(path.join(vaultRoot, 'CORE.md'), 'utf8')

      assert.equal(metadata.title, 'Precision Health Vault')
      assert.equal(metadata.timezone, 'UTC')
      assert.equal(metadata.formatVersion, 1)
      assert.match(coreMarkdown, /^# Precision Health Vault/mu)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'vault repair restores missing scaffold directories without mutating canonical metadata',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-vault-repair-'))

    try {
      await runSliceCli(['init', '--vault', vaultRoot])
      const metadataPath = path.join(vaultRoot, 'vault.json')
      const initialMetadata = JSON.parse(
        await readFile(metadataPath, 'utf8'),
      ) as {
        formatVersion: number
      }
      await rm(path.join(vaultRoot, 'bank/recipes'), { recursive: true, force: true })

      const repaired = await runSliceCli<{
        metadataFile: string
        createdDirectories: string[]
        updated: boolean
        auditPath: string | null
      }>([
        'vault',
        'repair',
        '--vault',
        vaultRoot,
      ])

      assert.equal(repaired.ok, true)
      assert.equal(repaired.meta?.command, 'vault repair')
      assert.equal(requireData(repaired).metadataFile, 'vault.json')
      assert.equal(requireData(repaired).updated, true)
      assert.deepEqual(requireData(repaired).createdDirectories, ['bank/recipes'])
      assert.equal(typeof requireData(repaired).auditPath, 'string')

      const repairedMetadata = JSON.parse(
        await readFile(metadataPath, 'utf8'),
      ) as {
        formatVersion: number
      }

      assert.deepEqual(repairedMetadata, initialMetadata)
      assert.equal(repairedMetadata.formatVersion, 1)
      const validated = await runSliceCli<{
        valid: boolean
        issues: Array<{ code: string }>
      }>([
        'validate',
        '--vault',
        vaultRoot,
      ])

      assert.equal(validated.ok, true)
      assert.equal(requireData(validated).valid, true)
      assert.deepEqual(requireData(validated).issues, [])
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'journal unlink returns a stable not_found error when the journal day does not exist',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-journal-missing-'))

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      const unlinkEvent = await runSliceCli([
        'journal',
        'unlink',
        '2026-03-12',
        '--event-id',
        'evt_01JNV422Y2M5ZBV64ZP4N1DRB1',
        '--vault',
        vaultRoot,
      ])
      const unlinkStream = await runSliceCli([
        'journal',
        'unlink',
        '2026-03-12',
        '--stream',
        'heart_rate',
        '--vault',
        vaultRoot,
      ])

      assert.equal(unlinkEvent.ok, false)
      assert.equal(unlinkEvent.error?.code, 'not_found')
      assert.equal(
        unlinkEvent.error?.message,
        'No journal day found for "2026-03-12".',
      )
      assert.equal(unlinkStream.ok, false)
      assert.equal(unlinkStream.error?.code, 'not_found')
      assert.equal(
        unlinkStream.error?.message,
        'No journal day found for "2026-03-12".',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
