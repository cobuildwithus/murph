import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerJournalCommands } from '../src/commands/journal.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { createIntegratedVaultCliServices } from '../src/vault-cli-services.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'experiment/journal/vault phase2 slice test cli',
    version: '0.0.0-test',
  })
  const services = createIntegratedVaultCliServices()

  registerVaultCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerJournalCommands(cli, services)
  registerReadCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

test.sequential(
  'experiment update, checkpoint, and stop mutate the experiment page and append lifecycle events',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-experiment-phase2-'))
    const updatePayloadPath = path.join(vaultRoot, 'experiment-update.json')
    const checkpointPayloadPath = path.join(vaultRoot, 'experiment-checkpoint.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])
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

      await writeFile(
        updatePayloadPath,
        JSON.stringify({
          lookup: 'focus-sprint',
          title: 'Focus Sprint Updated',
          hypothesis: 'Walking after lunch improves the afternoon energy dip.',
          status: 'paused',
          body: '# Focus Sprint Updated\n\n## Plan\n\nKeep the walks short and consistent.\n',
          tags: ['energy', 'walking'],
        }),
        'utf8',
      )
      await writeFile(
        checkpointPayloadPath,
        JSON.stringify({
          lookup: 'focus-sprint',
          occurredAt: '2026-03-12T14:30:00Z',
          title: 'Midpoint',
          note: 'Energy improved after lunch and the afternoon dip arrived later.',
        }),
        'utf8',
      )

      const updated = await runSliceCli<{
        experimentId: string
        slug: string
        status: string
      }>([
        'experiment',
        'update',
        '--input',
        `@${updatePayloadPath}`,
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
        '--input',
        `@${checkpointPayloadPath}`,
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
        '2026-03-13T18:45:00Z',
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
          data: Record<string, unknown>
        }
      }>([
        'show',
        requireData(stopped).eventId,
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
      assert.equal(requireData(shown).entity.data.endedOn, '2026-03-13')
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
      assert.equal(requireData(eventShown).entity.data.phase, 'stop')
      assert.equal(
        requireData(eventShown).entity.data.experimentId,
        requireData(created).experimentId,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'journal append plus typed link and unlink flags mutate body and frontmatter collections',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-journal-phase2-'))
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
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-vault-phase2-'))

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
        title: string
        timezone: string
      }
      const coreMarkdown = await readFile(path.join(vaultRoot, 'CORE.md'), 'utf8')

      assert.equal(metadata.title, 'Precision Health Vault')
      assert.equal(metadata.timezone, 'UTC')
      assert.match(coreMarkdown, /^# Precision Health Vault/mu)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'journal unlink returns a stable not_found error when the journal day does not exist',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-journal-missing-'))

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
