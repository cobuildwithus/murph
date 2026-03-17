import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerEventCommands } from '../src/commands/event.js'
import { registerProviderCommands } from '../src/commands/provider.js'
import { registerSamplesCommands } from '../src/commands/samples.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { createIntegratedVaultCliServices } from '../src/vault-cli-services.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'provider/event/samples slice test cli',
    version: '0.0.0-test',
  })
  const services = createIntegratedVaultCliServices()

  registerVaultCommands(cli, services)
  registerProviderCommands(cli, services)
  registerEventCommands(cli, services)
  registerSamplesCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
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

test('provider and event scaffold schemas expose the new noun entrypoints', async () => {
  const providerSchema = JSON.parse(
    await runSliceCliRaw(['provider', 'upsert', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const eventSchema = JSON.parse(
    await runSliceCliRaw(['event', 'scaffold', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const samplesSchema = JSON.parse(
    await runSliceCliRaw(['samples', 'add', '--schema']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.equal('input' in providerSchema.options.properties, true)
  assert.equal('kind' in eventSchema.options.properties, true)
  assert.deepEqual(eventSchema.options.required, ['vault', 'kind'])
  assert.equal('input' in samplesSchema.options.properties, true)
})

test('provider/event/samples help uses generic id selectors for read commands', async () => {
  const providerHelp = await runSliceCliRaw(['provider', 'show', '--help'])
  const eventHelp = await runSliceCliRaw(['event', 'show', '--help'])
  const sampleHelp = await runSliceCliRaw(['samples', 'show', '--help'])
  const batchHelp = await runSliceCliRaw(['samples', 'batch', 'show', '--help'])

  assert.match(providerHelp, /Usage: vault-cli provider show <id> \[options\]/u)
  assert.match(eventHelp, /Usage: vault-cli event show <id> \[options\]/u)
  assert.match(sampleHelp, /Usage: vault-cli samples show <id> \[options\]/u)
  assert.match(batchHelp, /Usage: vault-cli samples batch show <id> \[options\]/u)
})

test.sequential(
  'provider upsert/show/list, event upsert/show/list, and samples add work through the slice commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-provider-'))
    const providerPayloadPath = path.join(vaultRoot, 'provider.json')
    const eventPayloadPath = path.join(vaultRoot, 'event.json')
    const samplesPayloadPath = path.join(vaultRoot, 'samples.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        providerPayloadPath,
        JSON.stringify({
          title: 'Labcorp',
          slug: 'labcorp',
          status: 'active',
          specialty: 'lab',
          organization: 'Labcorp',
          location: 'Research Triangle Park',
          website: 'https://labcorp.example.test',
          phone: '555-0101',
          note: 'Primary lab partner.',
          aliases: ['Laboratory Corporation'],
          body: '# Labcorp\n\nPrimary lab partner.\n',
        }),
        'utf8',
      )

      const providerUpsert = await runSliceCli<{
        providerId: string
        path: string
        created: boolean
      }>([
        'provider',
        'upsert',
        '--input',
        `@${providerPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(providerUpsert.ok, true, JSON.stringify(providerUpsert))
      assert.equal(providerUpsert.meta?.command, 'provider upsert')
      assert.match(requireData(providerUpsert).providerId, /^prov_/u)
      assert.equal(requireData(providerUpsert).path, 'bank/providers/labcorp.md')
      assert.equal(requireData(providerUpsert).created, true)
      await access(path.join(vaultRoot, requireData(providerUpsert).path))

      const providerShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
          title: string | null
          data: {
            specialty?: string
          }
        }
      }>([
        'provider',
        'show',
        requireData(providerUpsert).providerId,
        '--vault',
        vaultRoot,
      ])
      const providerShowBySlug = await runSliceCli<{
        entity: {
          id: string
        }
      }>([
        'provider',
        'show',
        'labcorp',
        '--vault',
        vaultRoot,
      ])
      const providerList = await runSliceCli<{
        filters: {
          status: string | null
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
        }>
      }>([
        'provider',
        'list',
        '--status',
        'active',
        '--vault',
        vaultRoot,
      ])

      assert.equal(providerShow.ok, true)
      assert.equal(requireData(providerShow).entity.id, requireData(providerUpsert).providerId)
      assert.equal(requireData(providerShow).entity.kind, 'provider')
      assert.equal(requireData(providerShow).entity.title, 'Labcorp')
      assert.equal(requireData(providerShow).entity.data.specialty, 'lab')
      assert.equal(providerShowBySlug.ok, true)
      assert.equal(
        requireData(providerShowBySlug).entity.id,
        requireData(providerUpsert).providerId,
      )

      assert.equal(providerList.ok, true)
      assert.equal(requireData(providerList).filters.status, 'active')
      assert.equal(requireData(providerList).count, 1)
      assert.equal(requireData(providerList).items.length, 1)
      assert.equal(requireData(providerList).items[0]?.kind, 'provider')
      assert.equal(requireData(providerList).items[0]?.data.specialty, 'lab')

      await writeFile(
        eventPayloadPath,
        JSON.stringify({
          kind: 'symptom',
          occurredAt: '2026-03-12T08:15:00.000Z',
          title: 'Morning headache',
          symptom: 'headache',
          intensity: 4,
          bodySite: 'temple',
          note: 'Resolved after breakfast.',
          tags: ['symptom', 'morning'],
          relatedIds: [requireData(providerUpsert).providerId],
        }),
        'utf8',
      )

      const eventUpsert = await runSliceCli<{
        eventId: string
        ledgerFile: string
      }>([
        'event',
        'upsert',
        '--input',
        `@${eventPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(eventUpsert.ok, true)
      assert.equal(eventUpsert.meta?.command, 'event upsert')
      assert.match(requireData(eventUpsert).eventId, /^evt_/u)
      assert.match(requireData(eventUpsert).ledgerFile, /^ledger\/events\//u)

      const eventShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
          data: {
            symptom?: string
            providerId?: string
          }
          links: Array<{
            id: string
            kind: string
          }>
        }
      }>([
        'event',
        'show',
        requireData(eventUpsert).eventId,
        '--vault',
        vaultRoot,
      ])
      const eventList = await runSliceCli<{
        filters: {
          kind: string | null
          tag: string[]
        }
        count: number
        items: Array<{
          id: string
          kind: string
          data: Record<string, unknown>
          links: Array<{
            id: string
            kind: string
          }>
        }>
      }>([
        'event',
        'list',
        '--kind',
        'symptom',
        '--tag',
        'symptom',
        '--tag',
        ' morning ',
        '--tag',
        'morning',
        '--vault',
        vaultRoot,
      ])

      assert.equal(eventShow.ok, true)
      assert.equal(requireData(eventShow).entity.id, requireData(eventUpsert).eventId)
      assert.equal(requireData(eventShow).entity.kind, 'symptom')
      assert.equal(requireData(eventShow).entity.data.symptom, 'headache')
      assert.equal(
        requireData(eventShow).entity.links.some(
          (link) =>
            link.id === requireData(providerUpsert).providerId &&
            link.kind === 'provider',
        ),
        true,
      )

      assert.equal(eventList.ok, true)
      assert.equal(requireData(eventList).filters.kind, 'symptom')
      assert.deepEqual(requireData(eventList).filters.tag, [
        'symptom',
        'morning',
      ])
      assert.equal(requireData(eventList).count, 1)
      assert.equal(requireData(eventList).items.length, 1)
      assert.equal(requireData(eventList).items[0]?.kind, 'symptom')
      assert.equal(requireData(eventList).items[0]?.data.symptom, 'headache')
      assert.equal(requireData(eventList).items[0]?.links[0]?.id, requireData(providerUpsert).providerId)

      const csvEventList = await runSliceCli([
        'event',
        'list',
        '--tag',
        'symptom,morning',
        '--vault',
        vaultRoot,
      ])
      assert.equal(csvEventList.ok, false)
      assert.match(
        csvEventList.error.message ?? '',
        /repeat the flag instead|comma-delimited values are not supported/iu,
      )

      await writeFile(
        samplesPayloadPath,
        JSON.stringify({
          stream: 'heart_rate',
          unit: 'bpm',
          source: 'manual',
          quality: 'raw',
          samples: [
            {
              recordedAt: '2026-03-12T08:00:00.000Z',
              value: 61,
            },
            {
              recordedAt: '2026-03-12T08:01:00.000Z',
              value: 63,
            },
          ],
        }),
        'utf8',
      )

      const samplesAdd = await runSliceCli<{
        stream: string
        source: string
        quality: string
        addedCount: number
        lookupIds: string[]
        ledgerFiles: string[]
      }>([
        'samples',
        'add',
        '--input',
        `@${samplesPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(samplesAdd.ok, true)
      assert.equal(samplesAdd.meta?.command, 'samples add')
      assert.equal(requireData(samplesAdd).stream, 'heart_rate')
      assert.equal(requireData(samplesAdd).source, 'manual')
      assert.equal(requireData(samplesAdd).quality, 'raw')
      assert.equal(requireData(samplesAdd).addedCount, 2)
      assert.equal(requireData(samplesAdd).lookupIds.length, 2)
      assert.equal(requireData(samplesAdd).ledgerFiles.length, 1)

      const sampleShow = await runSliceCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'samples',
        'show',
        requireData(samplesAdd).lookupIds[0] as string,
        '--vault',
        vaultRoot,
      ])
      const sampleList = await runSliceCli<{
        filters: {
          stream: string | null
          quality: string | null
        }
        count: number
        items: Array<{
          id: string
          kind: string
          stream: string | null
          quality: string | null
          data: Record<string, unknown>
        }>
      }>([
        'samples',
        'list',
        '--stream',
        'heart_rate',
        '--quality',
        'raw',
        '--vault',
        vaultRoot,
      ])

      assert.equal(sampleShow.ok, true)
      assert.equal(requireData(sampleShow).entity.id, requireData(samplesAdd).lookupIds[0])
      assert.equal(requireData(sampleShow).entity.kind, 'sample')
      assert.equal(sampleList.ok, true)
      assert.equal(requireData(sampleList).filters.stream, 'heart_rate')
      assert.equal(requireData(sampleList).filters.quality, 'raw')
      assert.equal(requireData(sampleList).count, 2)
      assert.equal(requireData(sampleList).items.length, 2)
      assert.equal(requireData(sampleList).items[0]?.kind, 'sample')
      assert.equal(requireData(sampleList).items[0]?.stream, 'heart_rate')
      assert.equal(requireData(sampleList).items[0]?.quality, 'raw')
      assert.equal(requireData(sampleList).items[0]?.data.stream, 'heart_rate')

      const providerMarkdown = await readFile(
        path.join(vaultRoot, requireData(providerUpsert).path),
        'utf8',
      )
      assert.match(providerMarkdown, /providerId:/u)
      assert.match(providerMarkdown, /Labcorp/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider upsert rejects slug collisions against another provider id',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-provider-collision-'))
    const alphaPayloadPath = path.join(vaultRoot, 'provider-alpha.json')
    const betaPayloadPath = path.join(vaultRoot, 'provider-beta.json')
    const collisionPayloadPath = path.join(vaultRoot, 'provider-collision.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        alphaPayloadPath,
        JSON.stringify({
          title: 'Alpha Clinic',
          slug: 'alpha',
          status: 'active',
          body: '# Alpha Clinic\n',
        }),
        'utf8',
      )
      await writeFile(
        betaPayloadPath,
        JSON.stringify({
          title: 'Beta Clinic',
          slug: 'beta',
          status: 'active',
          body: '# Beta Clinic\n',
        }),
        'utf8',
      )

      const alpha = await runSliceCli<{ providerId: string }>([
        'provider',
        'upsert',
        '--input',
        `@${alphaPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
      const beta = await runSliceCli<{ providerId: string }>([
        'provider',
        'upsert',
        '--input',
        `@${betaPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(alpha.ok, true)
      assert.equal(beta.ok, true)

      await writeFile(
        collisionPayloadPath,
        JSON.stringify({
          providerId: requireData(alpha).providerId,
          title: 'Alpha Clinic Renamed',
          slug: 'beta',
          status: 'active',
          body: '# Alpha Clinic Renamed\n',
        }),
        'utf8',
      )

      const collision = await runSliceCli([
        'provider',
        'upsert',
        '--input',
        `@${collisionPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(collision.ok, false)
      assert.equal(collision.error?.code, 'conflict')
      assert.match(
        collision.error?.message ?? '',
        /Provider slug "beta" is already owned by/u,
      )

      const alphaMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/alpha.md'),
        'utf8',
      )
      const betaMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/beta.md'),
        'utf8',
      )

      assert.match(alphaMarkdown, new RegExp(requireData(alpha).providerId, 'u'))
      assert.match(alphaMarkdown, /title: "Alpha Clinic"/u)
      assert.match(betaMarkdown, new RegExp(requireData(beta).providerId, 'u'))
      assert.match(betaMarkdown, /title: "Beta Clinic"/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'provider upsert renames the provider document when the same provider id moves to a new slug',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-provider-rename-'))
    const initialPayloadPath = path.join(vaultRoot, 'provider-initial.json')
    const renamedPayloadPath = path.join(vaultRoot, 'provider-renamed.json')

    try {
      await runSliceCli(['init', '--vault', vaultRoot])

      await writeFile(
        initialPayloadPath,
        JSON.stringify({
          title: 'Alpha Clinic',
          slug: 'alpha',
          status: 'active',
          body: '# Alpha Clinic\n',
        }),
        'utf8',
      )

      const created = await runSliceCli<{ providerId: string; path: string }>([
        'provider',
        'upsert',
        '--input',
        `@${initialPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(created.ok, true)

      await writeFile(
        renamedPayloadPath,
        JSON.stringify({
          providerId: requireData(created).providerId,
          title: 'Alpha Clinic Renamed',
          slug: 'beta',
          status: 'active',
          body: '# Alpha Clinic Renamed\n',
        }),
        'utf8',
      )

      const renamed = await runSliceCli<{ path: string; created: boolean }>([
        'provider',
        'upsert',
        '--input',
        `@${renamedPayloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(renamed.ok, true)
      assert.equal(requireData(renamed).path, 'bank/providers/beta.md')
      assert.equal(requireData(renamed).created, false)

      await access(path.join(vaultRoot, 'bank/providers/beta.md'))
      await assert.rejects(() => access(path.join(vaultRoot, 'bank/providers/alpha.md')))

      const renamedMarkdown = await readFile(
        path.join(vaultRoot, 'bank/providers/beta.md'),
        'utf8',
      )
      assert.match(renamedMarkdown, new RegExp(requireData(created).providerId, 'u'))
      assert.match(renamedMarkdown, /Alpha Clinic Renamed/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
