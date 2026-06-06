import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerEventCommands } from '../src/commands/event.js'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerInterventionCommands } from '../src/commands/intervention.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData, runCli } from './cli-test-helpers.js'

interface SchemaEnvelope {
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface InterventionAddEnvelope {
  eventId: string
  lookupId: string
  ledgerFile: string
  created: boolean
  occurredAt: string
  kind: 'intervention_session'
  title: string
  interventionType: string
  durationMinutes: number | null
  regimenId: string | null
  experimentId: string | null
  experimentSlug: string | null
  experimentLinkMode: 'auto' | 'explicit' | null
  note: string
}

interface EventScaffoldEnvelope {
  noun: 'event'
  kind: 'intervention_session'
  payload: Record<string, unknown>
}

interface ShowEnvelope {
  entity: {
    id: string
    kind: string
    title: string | null
    occurredAt: string | null
    data: Record<string, unknown>
    links: Array<{
      id: string
      kind: string
      queryable: boolean
    }>
  }
}

interface DeleteEnvelope {
  entityId: string
  lookupId: string
  kind: string
  deleted: true
  retainedPaths: string[]
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'intervention slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerEventCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerInterventionCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
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

async function runSliceCliRaw(args: string[]) {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

async function createActiveExperiment(
  vaultRoot: string,
  slug: string,
  modality = 'sauna',
) {
  const result = await runSliceCli<{
    experimentId: string
    slug: string
  }>([
    'experiment',
    'start',
    slug,
    '--custom',
    '--no-public-protocol',
    '--title',
    slug,
    '--started-on',
    '2026-04-01',
    '--status',
    'active',
    '--intervention-start',
    '2026-04-01',
    '--intervention-end',
    '2026-04-14',
    '--modality',
    modality,
    '--primary-biomarker-key',
    'biomarker:resting-heart-rate',
    '--vault',
    vaultRoot,
  ])
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message)
  return requireData(result)
}

async function createActiveSaunaExperiment(vaultRoot: string, slug: string) {
  return createActiveExperiment(vaultRoot, slug, 'sauna')
}

function assertEntityExperimentLink(
  entity: ShowEnvelope['entity'],
  expectedExperimentId: string | null,
  expectedExperimentSlug?: string,
) {
  assert.equal(entity.data.experimentId, expectedExperimentId ?? undefined)
  assert.equal(entity.data.experimentSlug, expectedExperimentSlug)
  assert.equal(
    entity.links.some((link) => link.id === expectedExperimentId),
    expectedExperimentId !== null,
  )
}

test('intervention add schema exposes the freeform intervention capture surface', async () => {
  const schema = JSON.parse(
    await runSliceCliRaw(['intervention', 'add', '--schema']),
  ) as SchemaEnvelope

  assert.equal('duration' in schema.options.properties, true)
  assert.equal('type' in schema.options.properties, true)
  assert.equal('regimenId' in schema.options.properties, true)
  assert.equal('experiment' in schema.options.properties, true)
  assert.equal('skipExperimentLink' in schema.options.properties, true)
  assert.equal('allowOutOfWindow' in schema.options.properties, true)
  assert.equal('occurredAt' in schema.options.properties, true)
  assert.equal('source' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('intervention edit/delete schemas expose typed mutation options', async () => {
  const editSchema = JSON.parse(
    await runSliceCliRaw(['intervention', 'edit', '--schema']),
  ) as SchemaEnvelope
  const deleteSchema = JSON.parse(
    await runSliceCliRaw(['intervention', 'delete', '--schema']),
  ) as SchemaEnvelope

  assert.equal('input' in editSchema.options.properties, false)
  assert.equal('set' in editSchema.options.properties, false)
  assert.equal('clear' in editSchema.options.properties, false)
  assert.equal('note' in editSchema.options.properties, true)
  assert.equal('duration' in editSchema.options.properties, true)
  assert.equal('type' in editSchema.options.properties, true)
  assert.equal('dayKeyPolicy' in editSchema.options.properties, true)
  assert.deepEqual(editSchema.options.required, ['vault'])
  assert.deepEqual(deleteSchema.options.required, ['vault'])
})

test('experiment session attach schema exposes repair flags', async () => {
  const schema = JSON.parse(
    await runSliceCliRaw(['experiment', 'session', 'attach', '--schema']),
  ) as SchemaEnvelope

  assert.equal('replace' in schema.options.properties, true)
  assert.equal('allowOutOfWindow' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('intervention add help uses a positional text argument', async () => {
  const help = await runSliceCliRaw(['intervention', 'add', '--help'])
  const llms = await runSliceCliRaw(['intervention', 'add', '--llms-full'])

  assert.match(help, /Usage: vault-cli intervention add <text> \[options\]/u)
  assert.match(llms, /intervention add '20 min sauna after lifting\.'/u)
  assert.doesNotMatch(llms, /intervention add 20 min sauna after lifting\./u)
})

test.sequential(
  'intervention add captures intervention_session events and fails fast on ambiguous types and durations',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-'),
    )

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const scaffold = await runCli<EventScaffoldEnvelope>([
        'event',
        'scaffold',
        '--kind',
        'intervention_session',
        '--vault',
        vaultRoot,
      ])
      assert.equal(scaffold.ok, true)
      assert.equal(requireData(scaffold).kind, 'intervention_session')
      assert.equal(
        requireData(scaffold).payload.interventionType,
        'sauna',
      )
      assert.equal(requireData(scaffold).payload.durationMinutes, 20)

      const sauna = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(sauna.ok, true)
      assert.equal(sauna.meta?.command, 'intervention add')
      assert.match(requireData(sauna).eventId, /^evt_/u)
      assert.equal(requireData(sauna).lookupId, requireData(sauna).eventId)
      assert.equal(requireData(sauna).kind, 'intervention_session')
      assert.equal(requireData(sauna).interventionType, 'sauna')
      assert.equal(requireData(sauna).durationMinutes, 20)
      assert.equal(requireData(sauna).regimenId, null)
      assert.equal(requireData(sauna).title, '20-minute sauna')
      assert.equal(requireData(sauna).note, '20 min sauna after lifting.')

      const showSauna = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(sauna).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showSauna.ok, true)
      assert.equal(requireData(showSauna).entity.kind, 'intervention_session')
      assert.equal(requireData(showSauna).entity.title, '20-minute sauna')
      assert.equal(requireData(showSauna).entity.data.interventionType, 'sauna')
      assert.equal(requireData(showSauna).entity.data.durationMinutes, 20)
      assert.equal(requireData(showSauna).entity.data.regimenId, undefined)
      assert.equal(
        requireData(showSauna).entity.data.note,
        '20 min sauna after lifting.',
      )

      const hbot = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        'HBOT session at the clinic.',
        '--duration',
        '60',
        '--regimen-id',
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
        '--vault',
        vaultRoot,
      ])
      assert.equal(hbot.ok, true)
      assert.equal(requireData(hbot).interventionType, 'hbot')
      assert.equal(requireData(hbot).durationMinutes, 60)
      assert.equal(
        requireData(hbot).regimenId,
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
      )
      assert.equal(requireData(hbot).title, '60-minute HBOT')

      const showHbot = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(hbot).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showHbot.ok, true)
      assert.equal(requireData(showHbot).entity.data.interventionType, 'hbot')
      assert.equal(requireData(showHbot).entity.data.durationMinutes, 60)
      assert.equal(
        requireData(showHbot).entity.data.regimenId,
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
      )
      assert.deepEqual(requireData(showHbot).entity.links.map((link) => link.id), [
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
      ])

      const noDuration = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        'Recovery session at the clinic.',
        '--type',
        'skin laser therapy',
        '--vault',
        vaultRoot,
      ])
      assert.equal(noDuration.ok, true)
      assert.equal(requireData(noDuration).interventionType, 'skin-laser-therapy')
      assert.equal(requireData(noDuration).durationMinutes, null)
      assert.equal(requireData(noDuration).title, 'Skin laser therapy')

      const ambiguousType = await runCli([
        'intervention',
        'add',
        'Contrast session with sauna and cold plunge.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(ambiguousType.ok, false)
      assert.equal(ambiguousType.error.code, 'invalid_option')
      assert.match(
        ambiguousType.error.message ?? '',
        /Pass --type <type> to record it explicitly/u,
      )

      const ambiguousDuration = await runCli([
        'intervention',
        'add',
        'Sauna for 10 or 20 minutes after training.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(ambiguousDuration.ok, false)
      assert.equal(ambiguousDuration.error.code, 'invalid_option')
      assert.match(
        ambiguousDuration.error.message ?? '',
        /Pass --duration <minutes> to record it explicitly/u,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention add auto-links exactly one active matching experiment',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-experiment-'),
    )

    try {
      const initResult = await runSliceCli<{ created: boolean }>([
        'init',
        '--timezone',
        'UTC',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const experiment = await createActiveSaunaExperiment(vaultRoot, 'sauna-rhr')

      const sauna = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--occurred-at',
        '2026-04-03T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(sauna.ok, true, sauna.ok ? undefined : sauna.error.message)
      assert.equal(requireData(sauna).experimentId, experiment.experimentId)
      assert.equal(requireData(sauna).experimentSlug, 'sauna-rhr')
      assert.equal(requireData(sauna).experimentLinkMode, 'auto')

      const shown = await runSliceCli<ShowEnvelope>([
        'event',
        'show',
        requireData(sauna).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, true)
      assert.equal(
        requireData(shown).entity.data.experimentId,
        experiment.experimentId,
      )
      assert.equal(requireData(shown).entity.data.experimentSlug, 'sauna-rhr')
      assertEntityExperimentLink(
        requireData(shown).entity,
        experiment.experimentId,
        'sauna-rhr',
      )

      const typeEdit = await runSliceCli<unknown>([
        'intervention',
        'edit',
        requireData(sauna).eventId,
        '--type',
        'hbot',
        '--vault',
        vaultRoot,
      ])
      assert.equal(typeEdit.ok, false)
      assert.match(typeEdit.error.message ?? '', /experiment session detach <eventId>/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention add fails before write on ambiguous automatic experiment matches',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-ambiguous-'),
    )

    try {
      await runSliceCli<unknown>(['init', '--timezone', 'UTC', '--vault', vaultRoot])
      for (const slug of ['sauna-a', 'sauna-b']) {
        await createActiveSaunaExperiment(vaultRoot, slug)
      }

      const ambiguous = await runSliceCli<unknown>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--occurred-at',
        '2026-04-03T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(ambiguous.ok, false)
      assert.equal(ambiguous.error.code, 'invalid_option')
      assert.match(ambiguous.error.message ?? '', /Multiple active experiments match/u)

      const list = await runSliceCli<{ count: number }>([
        'event',
        'list',
        '--kind',
        'intervention_session',
        '--vault',
        vaultRoot,
      ])
      assert.equal(list.ok, true)
      assert.equal(requireData(list).count, 0)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention add supports explicit experiment links and opt-out',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-explicit-'),
    )

    try {
      await runSliceCli<unknown>(['init', '--timezone', 'UTC', '--vault', vaultRoot])
      const experiment = await createActiveSaunaExperiment(
        vaultRoot,
        'explicit-sauna',
      )
      await createActiveSaunaExperiment(vaultRoot, 'alternate-sauna')
      await createActiveExperiment(vaultRoot, 'explicit-hbot', 'hbot')

      const explicit = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--experiment',
        experiment.experimentId,
        '--occurred-at',
        '2026-04-03T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(explicit.ok, true)
      assert.equal(requireData(explicit).experimentId, experiment.experimentId)
      assert.equal(requireData(explicit).experimentSlug, 'explicit-sauna')
      assert.equal(requireData(explicit).experimentLinkMode, 'explicit')

      const mismatch = await runSliceCli<unknown>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--experiment',
        'explicit-hbot',
        '--occurred-at',
        '2026-04-03T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(mismatch.ok, false)
      assert.match(mismatch.error.message ?? '', /does not match experiment/u)

      const optedOut = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--skip-experiment-link',
        '--occurred-at',
        '2026-04-04T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(optedOut.ok, true)
      assert.equal(requireData(optedOut).experimentId, null)
      assert.equal(requireData(optedOut).experimentSlug, null)
      assert.equal(requireData(optedOut).experimentLinkMode, null)

      const shownOptOut = await runSliceCli<ShowEnvelope>([
        'event',
        'show',
        requireData(optedOut).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shownOptOut.ok, true)
      assertEntityExperimentLink(requireData(shownOptOut).entity, null)

      const list = await runSliceCli<{ count: number }>([
        'event',
        'list',
        '--kind',
        'intervention_session',
        '--vault',
        vaultRoot,
      ])
      assert.equal(list.ok, true)
      assert.equal(requireData(list).count, 2)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention add requires an override for explicit out-of-window links',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-window-'),
    )

    try {
      await runSliceCli<unknown>(['init', '--timezone', 'UTC', '--vault', vaultRoot])
      const experiment = await createActiveSaunaExperiment(vaultRoot, 'sauna-window')

      const unlinked = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(unlinked.ok, true)
      assert.equal(requireData(unlinked).experimentId, null)
      assert.equal(requireData(unlinked).experimentSlug, null)
      assert.equal(requireData(unlinked).experimentLinkMode, null)

      const shownUnlinked = await runSliceCli<ShowEnvelope>([
        'event',
        'show',
        requireData(unlinked).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shownUnlinked.ok, true)
      assertEntityExperimentLink(requireData(shownUnlinked).entity, null)

      const blocked = await runSliceCli<unknown>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--experiment',
        'sauna-window',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(blocked.ok, false)
      assert.match(blocked.error.message ?? '', /outside the intervention window/u)

      const linked = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--experiment',
        'sauna-window',
        '--allow-out-of-window',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(linked.ok, true)
      assert.equal(requireData(linked).experimentId, experiment.experimentId)
      assert.equal(requireData(linked).experimentSlug, 'sauna-window')
      assert.equal(requireData(linked).experimentLinkMode, 'explicit')

      const unusedOverride = await runSliceCli<unknown>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--allow-out-of-window',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(unusedOverride.ok, false)
      assert.match(unusedOverride.error.message ?? '', /only applies with --experiment/u)

      const explicitSkipConflict = await runSliceCli<unknown>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--experiment',
        'sauna-window',
        '--skip-experiment-link',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(explicitSkipConflict.ok, false)
      assert.match(explicitSkipConflict.error.message ?? '', /either --experiment/u)

      const skipOverrideConflict = await runSliceCli<unknown>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--skip-experiment-link',
        '--allow-out-of-window',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(skipOverrideConflict.ok, false)
      assert.match(skipOverrideConflict.error.message ?? '', /either --allow-out-of-window/u)

      const list = await runSliceCli<{ count: number }>([
        'event',
        'list',
        '--kind',
        'intervention_session',
        '--vault',
        vaultRoot,
      ])
      assert.equal(list.ok, true)
      assert.equal(requireData(list).count, 2)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'experiment session attach, replace, detach preserve non-experiment intervention links',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-attach-'),
    )

    try {
      await runSliceCli<unknown>(['init', '--timezone', 'UTC', '--vault', vaultRoot])
      const experiments: Record<string, string> = {}
      for (const slug of ['sauna-one', 'sauna-two']) {
        const created = await createActiveSaunaExperiment(vaultRoot, slug)
        experiments[slug] = created.experimentId
      }
      const hbotExperiment = await createActiveExperiment(vaultRoot, 'hbot-one', 'hbot')

      const created = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--skip-experiment-link',
        '--regimen-id',
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
        '--occurred-at',
        '2026-04-03T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const mismatchedAttach = await runSliceCli<unknown>([
        'experiment',
        'session',
        'attach',
        hbotExperiment.slug,
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(mismatchedAttach.ok, false)
      assert.match(mismatchedAttach.error.message ?? '', /does not match experiment/u)

      const outOfWindow = await runSliceCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--skip-experiment-link',
        '--occurred-at',
        '2026-04-20T18:00:00.000Z',
        '--vault',
        vaultRoot,
      ])
      assert.equal(outOfWindow.ok, true)

      const attachOutOfWindowBlocked = await runSliceCli<unknown>([
        'experiment',
        'session',
        'attach',
        'sauna-one',
        requireData(outOfWindow).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(attachOutOfWindowBlocked.ok, false)
      assert.match(
        attachOutOfWindowBlocked.error.message ?? '',
        /outside the intervention window/u,
      )

      const attachOutOfWindow = await runSliceCli<{
        experimentId: string
        experimentSlug: string
        linked: boolean
      }>([
        'experiment',
        'session',
        'attach',
        'sauna-one',
        requireData(outOfWindow).eventId,
        '--allow-out-of-window',
        '--vault',
        vaultRoot,
      ])
      assert.equal(
        attachOutOfWindow.ok,
        true,
        attachOutOfWindow.ok ? undefined : attachOutOfWindow.error.message,
      )
      assert.equal(requireData(attachOutOfWindow).experimentId, experiments['sauna-one'])
      assert.equal(requireData(attachOutOfWindow).experimentSlug, 'sauna-one')
      assert.equal(requireData(attachOutOfWindow).linked, true)

      const attached = await runSliceCli<{
        eventId: string
        experimentId: string
        experimentSlug: string
        linked: boolean
      }>([
        'experiment',
        'session',
        'attach',
        'sauna-one',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(attached.ok, true, attached.ok ? undefined : attached.error.message)
      assert.equal(requireData(attached).experimentId, experiments['sauna-one'])
      assert.equal(requireData(attached).experimentSlug, 'sauna-one')
      assert.equal(requireData(attached).linked, true)

      const slugOnlyPayloadPath = path.join(vaultRoot, 'slug-only-event.json')
      await writeFile(
        slugOnlyPayloadPath,
        JSON.stringify({
          kind: 'intervention_session',
          occurredAt: '2026-04-03T18:00:00.000Z',
          source: 'manual',
          title: '20-minute sauna',
          interventionType: 'sauna',
          durationMinutes: 20,
          experimentSlug: 'sauna-one',
          note: 'Imported sauna session with a partial experiment link.',
        }),
        'utf8',
      )
      const slugOnly = await runSliceCli<{ eventId: string }>([
        'event',
        'import-json',
        '--input',
        `@${slugOnlyPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(slugOnly.ok, true)

      const slugOnlyTypeEdit = await runSliceCli<unknown>([
        'intervention',
        'edit',
        requireData(slugOnly).eventId,
        '--type',
        'hbot',
        '--vault',
        vaultRoot,
      ])
      assert.equal(slugOnlyTypeEdit.ok, false)
      assert.match(
        slugOnlyTypeEdit.error.message ?? '',
        /experiment session attach <experiment> <eventId> --replace/u,
      )

      const repairedSlugOnly = await runSliceCli<{
        experimentId: string
        experimentSlug: string
      }>([
        'experiment',
        'session',
        'attach',
        'sauna-one',
        requireData(slugOnly).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(repairedSlugOnly.ok, true)
      assert.equal(requireData(repairedSlugOnly).experimentId, experiments['sauna-one'])
      assert.equal(requireData(repairedSlugOnly).experimentSlug, 'sauna-one')

      const relinkBlocked = await runSliceCli<unknown>([
        'experiment',
        'session',
        'attach',
        'sauna-two',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(relinkBlocked.ok, false)
      assert.match(relinkBlocked.error.message ?? '', /already linked/u)

      const replaced = await runSliceCli<{
        experimentId: string
        experimentSlug: string
      }>([
        'experiment',
        'session',
        'attach',
        'sauna-two',
        requireData(created).eventId,
        '--replace',
        '--vault',
        vaultRoot,
      ])
      assert.equal(replaced.ok, true)
      assert.equal(requireData(replaced).experimentId, experiments['sauna-two'])
      assert.equal(requireData(replaced).experimentSlug, 'sauna-two')

      const editedRegimen = await runSliceCli<ShowEnvelope>([
        'intervention',
        'edit',
        requireData(created).eventId,
        '--regimen-id',
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB2',
        '--vault',
        vaultRoot,
      ])
      assert.equal(editedRegimen.ok, true)
      assert.equal(
        requireData(editedRegimen).entity.data.experimentId,
        experiments['sauna-two'],
      )
      assert.deepEqual(
        new Set(requireData(editedRegimen).entity.links.map((link) => link.id)),
        new Set([
          experiments['sauna-two'],
          'reg_01JNV422Y2M5ZBV64ZP4N1DRB2',
        ]),
      )

      const detached = await runSliceCli<{ linked: boolean }>([
        'experiment',
        'session',
        'detach',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(detached.ok, true)
      assert.equal(requireData(detached).linked, false)

      const shown = await runSliceCli<ShowEnvelope>([
        'event',
        'show',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.data.experimentId, undefined)
      assert.equal(requireData(shown).entity.data.experimentSlug, undefined)
      assert.deepEqual(requireData(shown).entity.links.map((link) => link.id), [
        'reg_01JNV422Y2M5ZBV64ZP4N1DRB2',
      ])
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention add surfaces invalid timestamps without needing a custom intervention read surface',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-'),
    )

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const invalidTimestamp = await runCli([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--occurred-at',
        'not-a-timestamp',
        '--vault',
        vaultRoot,
      ])

      assert.equal(invalidTimestamp.ok, false)
      assert.equal(invalidTimestamp.error.code, 'VALIDATION_ERROR')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention edit/delete mutate and remove the saved intervention_session event',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-edit-'),
    )

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const created = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const edited = await runCli<ShowEnvelope>([
        'intervention',
        'edit',
        requireData(created).eventId,
        '--note',
        'Cooldown sauna after lifting.',
        '--duration',
        '25',
        '--title',
        '25-minute sauna',
        '--vault',
        vaultRoot,
      ])
      assert.equal(edited.ok, true)
      assert.equal(edited.meta?.command, 'intervention edit')
      assert.equal(requireData(edited).entity.kind, 'intervention_session')
      assert.equal(requireData(edited).entity.data.note, 'Cooldown sauna after lifting.')
      assert.equal(requireData(edited).entity.data.durationMinutes, 25)
      assert.equal(requireData(edited).entity.title, '25-minute sauna')

      const deleted = await runCli<DeleteEnvelope>([
        'intervention',
        'delete',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(deleted.ok, true)
      assert.equal(deleted.meta?.command, 'intervention delete')
      assert.equal(requireData(deleted).entityId, requireData(created).eventId)
      assert.equal(requireData(deleted).kind, 'intervention_session')
      assert.equal(requireData(deleted).deleted, true)

      const missing = await runCli([
        'event',
        'show',
        requireData(created).eventId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(missing.ok, false)
      assert.equal(missing.error?.code, 'not_found')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention edit repairs stale regimen links when clearing regimen state',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-intervention-regimen-repair-'),
    )

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const payloadPath = path.join(vaultRoot, 'stale-regimen-event.json')
      await writeFile(
        payloadPath,
        JSON.stringify({
          kind: 'intervention_session',
          occurredAt: '2026-04-03T18:00:00.000Z',
          source: 'manual',
          title: '20-minute sauna',
          interventionType: 'sauna',
          durationMinutes: 20,
          note: 'Imported sauna session with a stale regimen link.',
          links: [
            {
              type: 'related_to',
              targetId: 'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
            },
          ],
        }),
        'utf8',
      )

      const imported = await runSliceCli<{ eventId: string }>([
        'event',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(imported.ok, true)

      const edited = await runSliceCli<ShowEnvelope>([
        'intervention',
        'edit',
        requireData(imported).eventId,
        '--clear-regimen-id',
        '--vault',
        vaultRoot,
      ])
      assert.equal(edited.ok, true)
      assert.deepEqual(requireData(edited).entity.links.map((link) => link.id), [])
      assert.equal(requireData(edited).entity.data.regimenId, undefined)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
