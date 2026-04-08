import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import * as vaultRuntime from '@murphai/vault-usecases/runtime'
import type {
  ImportersFactoryRuntimeModule,
  ImportersRuntime,
} from '@murphai/vault-usecases/runtime'

import { registerDocumentCommands } from '../src/commands/document.js'
import { registerInterventionCommands } from '../src/commands/intervention.js'
import { registerMealCommands } from '../src/commands/meal.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { createTempVaultContext, requireData, runInProcessJsonCli } from './cli-test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

function createCoverageCli() {
  const cli = Cli.create('vault-cli', {
    description: 'document/meal/intervention coverage cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerDocumentCommands(cli, services)
  registerMealCommands(cli, services)
  registerInterventionCommands(cli, services)

  return cli
}

function createCoverageCliAndServices() {
  const cli = Cli.create('vault-cli', {
    description: 'document/meal/intervention coverage cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerDocumentCommands(cli, services)
  registerMealCommands(cli, services)
  registerInterventionCommands(cli, services)

  return { cli, services }
}

async function writeFixtureFile(
  root: string,
  fileName: string,
  content: string,
): Promise<string> {
  const filePath = path.join(root, fileName)
  await writeFile(filePath, content, 'utf8')
  return filePath
}

async function getGroupCommandRun<Context>(
  cli: Cli.Cli,
  groupName: string,
  commandName: string,
) {
  const { toCommands } = await import(
    new URL('./Cli.js', import.meta.resolve('incur')).href
  )
  const group = toCommands.get(cli)?.get(groupName)
  if (!group || !('commands' in group)) {
    throw new Error(`Missing command group: ${groupName}`)
  }

  const command = group.commands.get(commandName)
  if (!command || typeof command !== 'object' || typeof command.run !== 'function') {
    throw new Error(`Missing command handler: ${groupName} ${commandName}`)
  }

  return command.run as (context: Context) => Promise<unknown>
}

test('document and meal commands exercise import, read, edit, list, manifest, and delete paths in-process', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-document-meal-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createCoverageCli()
  const documentSource = await writeFixtureFile(
    parentRoot,
    'document-source.md',
    '# Document coverage fixture\n\nFasted lipid panel.\n',
  )
  const mealPhoto = await writeFixtureFile(
    parentRoot,
    'meal-photo.jpg',
    'meal-photo-bytes',
  )
  const mealAudio = await writeFixtureFile(
    parentRoot,
    'meal-audio.m4a',
    'meal-audio-bytes',
  )

  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.exitCode, null)
  assert.equal(requireData(initResult.envelope).created, true)

  const firstDocument = requireData(
    (
      await runInProcessJsonCli<{
        documentId: string
        eventId: string
        lookupId: string
        manifestFile: string
      }>(cli, [
        'document',
        'import',
        documentSource,
        '--title',
        'Lab Report',
        '--occurred-at',
        '2026-03-12T09:30:00Z',
        '--note',
        'Fasted lipid panel.',
        '--source',
        'device',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  const olderDocument = requireData(
    (
      await runInProcessJsonCli<{
        documentId: string
        eventId: string
        lookupId: string
        manifestFile: string
      }>(cli, [
        'document',
        'import',
        documentSource,
        '--title',
        'Older Report',
        '--occurred-at',
        '2026-03-10T07:15:00Z',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )

  const shownDocument = await runInProcessJsonCli<{
    entity: {
      id: string
      kind: string
      title: string | null
      occurredAt: string | null
      data: Record<string, unknown>
      links: Array<{ id: string; kind: string; queryable: boolean }>
    }
  }>(cli, [
    'document',
    'show',
    firstDocument.documentId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(shownDocument.exitCode, null)
  assert.equal(shownDocument.envelope.ok, true)
  assert.equal(requireData(shownDocument.envelope).entity.title, 'Lab Report')
  assert.equal(requireData(shownDocument.envelope).entity.data.source, 'device')

  const listedDocuments = await runInProcessJsonCli<{
    filters: {
      from?: string
      to?: string
      limit: number
    }
    count: number
    items: Array<{
      id: string
    }>
  }>(cli, [
    'document',
    'list',
    '--from',
    '2026-03-12',
    '--to',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ])
  assert.equal(listedDocuments.exitCode, null)
  assert.equal(requireData(listedDocuments.envelope).count, 1)
  assert.equal(requireData(listedDocuments.envelope).items[0]?.id, firstDocument.documentId)
  assert.equal(
    requireData(listedDocuments.envelope).items.some((item) => item.id === olderDocument.documentId),
    false,
  )

  const manifest = await runInProcessJsonCli<{
    entityId: string
    lookupId: string
    kind: string
    manifestFile: string
    manifest: {
      importKind: string
      importId: string
      provenance: {
        lookupId?: string
        title?: string
        note?: string
      }
    }
  }>(cli, [
    'document',
    'manifest',
    firstDocument.lookupId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(manifest.exitCode, null)
  assert.equal(requireData(manifest.envelope).entityId, firstDocument.documentId)
  assert.equal(requireData(manifest.envelope).manifest.importKind, 'document')
  assert.equal(requireData(manifest.envelope).manifest.provenance.title, 'Lab Report')

  const editedDocument = await runInProcessJsonCli<{
    entity: {
      id: string
      title: string | null
      data: Record<string, unknown>
    }
  }>(cli, [
    'document',
    'edit',
    firstDocument.documentId,
    '--set',
    'title=Updated Lab Report',
    '--set',
    'note=Reviewed with PCP.',
    '--vault',
    vaultRoot,
  ])
  assert.equal(editedDocument.exitCode, null)
  assert.equal(requireData(editedDocument.envelope).entity.title, 'Updated Lab Report')
  assert.equal(requireData(editedDocument.envelope).entity.data.note, 'Reviewed with PCP.')

  const deletedDocument = await runInProcessJsonCli<{
    entityId: string
    kind: string
    deleted: true
    retainedPaths: string[]
  }>(cli, [
    'document',
    'delete',
    firstDocument.lookupId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(deletedDocument.exitCode, null)
  assert.equal(requireData(deletedDocument.envelope).deleted, true)

  const missingDocument = await runInProcessJsonCli(cli, [
    'document',
    'show',
    firstDocument.lookupId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingDocument.envelope.ok, false)
  if (missingDocument.envelope.ok) {
    throw new Error('Expected document show to fail after delete.')
  }
  assert.equal(missingDocument.envelope.error.code, 'not_found')

  const firstMeal = requireData(
    (
      await runInProcessJsonCli<{
        mealId: string
        eventId: string
        lookupId: string
        manifestFile: string
      }>(cli, [
        'meal',
        'add',
        'Green smoothie after training.',
        '--photo',
        mealPhoto,
        '--audio',
        mealAudio,
        '--note',
        'Post-workout recovery meal.',
        '--occurred-at',
        '2026-03-12T12:15:00Z',
        '--source',
        'device',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  const secondMeal = requireData(
    (
      await runInProcessJsonCli<{
        mealId: string
        eventId: string
        lookupId: string
        manifestFile: string
      }>(cli, [
        'meal',
        'add',
        'Eggs and avocado.',
        '--note',
        'Simple recovery breakfast.',
        '--occurred-at',
        '2026-03-10T18:00:00Z',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )

  const shownMeal = await runInProcessJsonCli<{
    entity: {
      id: string
      kind: string
      title: string | null
      occurredAt: string | null
      data: Record<string, unknown>
      links: Array<{ id: string; kind: string; queryable: boolean }>
    }
  }>(cli, [
    'meal',
    'show',
    firstMeal.mealId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(shownMeal.exitCode, null)
  assert.equal(requireData(shownMeal.envelope).entity.kind, 'meal')
  assert.equal(requireData(shownMeal.envelope).entity.data.note, 'Post-workout recovery meal.')

  const listedMeals = await runInProcessJsonCli<{
    filters: {
      from?: string
      to?: string
      limit: number
    }
    count: number
    items: Array<{
      id: string
    }>
  }>(cli, [
    'meal',
    'list',
    '--from',
    '2026-03-12',
    '--to',
    '2026-03-12',
    '--vault',
    vaultRoot,
  ])
  assert.equal(listedMeals.exitCode, null)
  assert.equal(requireData(listedMeals.envelope).count, 1)
  assert.equal(requireData(listedMeals.envelope).items[0]?.id, firstMeal.mealId)
  assert.equal(
    requireData(listedMeals.envelope).items.some((item) => item.id === secondMeal.mealId),
    false,
  )

  const mealManifest = await runInProcessJsonCli<{
    entityId: string
    lookupId: string
    kind: string
    manifestFile: string
    manifest: {
      importKind: string
      importId: string
    }
  }>(cli, [
    'meal',
    'manifest',
    firstMeal.mealId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(mealManifest.exitCode, null)
  assert.equal(requireData(mealManifest.envelope).manifest.importKind, 'meal')

  const editedMeal = await runInProcessJsonCli<{
    entity: {
      id: string
      title: string | null
      data: Record<string, unknown>
    }
  }>(cli, [
    'meal',
    'edit',
    firstMeal.mealId,
    '--set',
    'note=Green smoothie with extra protein.',
    '--vault',
    vaultRoot,
  ])
  assert.equal(editedMeal.exitCode, null)
  assert.equal(requireData(editedMeal.envelope).entity.data.note, 'Green smoothie with extra protein.')

  const deletedMeal = await runInProcessJsonCli<{
    entityId: string
    kind: string
    deleted: true
    retainedPaths: string[]
  }>(cli, [
    'meal',
    'delete',
    firstMeal.lookupId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(deletedMeal.exitCode, null)
  assert.equal(requireData(deletedMeal.envelope).deleted, true)
})

test('intervention commands exercise add, edit, and delete paths in-process', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-intervention-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createCoverageCli()
  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
  ])
  assert.equal(initResult.exitCode, null)
  assert.equal(requireData(initResult.envelope).created, true)

  const created = requireData(
    (
      await runInProcessJsonCli<{
        eventId: string
        lookupId: string
        kind: string
        title: string
        interventionType: string
        durationMinutes: number | null
        protocolId: string | null
      }>(cli, [
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--type',
        'sauna',
        '--duration',
        '20',
        '--protocol-id',
        'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
        '--occurred-at',
        '2026-03-12T18:15:00Z',
        '--source',
        'manual',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  const secondary = requireData(
    (
      await runInProcessJsonCli<{
        eventId: string
        lookupId: string
        kind: string
        title: string
        interventionType: string
        durationMinutes: number | null
        protocolId: string | null
      }>(cli, [
        'intervention',
        'add',
        'Recovery session at the clinic.',
        '--type',
        'skin laser therapy',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  const inferred = requireData(
    (
      await runInProcessJsonCli<{
        eventId: string
        lookupId: string
        kind: string
        title: string
        interventionType: string
        durationMinutes: number | null
        protocolId: string | null
      }>(cli, [
        'intervention',
        'add',
        'Recovery sauna with no explicit type override.',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )

  const edited = await runInProcessJsonCli<{
    entity: {
      id: string
      kind: string
      title: string | null
      data: Record<string, unknown>
    }
  }>(cli, [
    'intervention',
    'edit',
    created.eventId,
    '--set',
    'note=Cooldown sauna after lifting.',
    '--set',
    'durationMinutes=25',
    '--set',
    'title=25-minute sauna',
    '--vault',
    vaultRoot,
  ])
  assert.equal(edited.exitCode, null)
  assert.equal(requireData(edited.envelope).entity.title, '25-minute sauna')
  assert.equal(requireData(edited.envelope).entity.data.durationMinutes, 25)

  const deleted = await runInProcessJsonCli<{
    entityId: string
    kind: string
    deleted: true
    retainedPaths: string[]
  }>(cli, [
    'intervention',
    'delete',
    created.eventId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(deleted.exitCode, null)
  assert.equal(requireData(deleted.envelope).deleted, true)

  assert.equal(secondary.interventionType, 'skin-laser-therapy')
  assert.equal(secondary.durationMinutes, null)
  assert.equal(typeof inferred.interventionType, 'string')
})

test('document and meal command handlers exercise nullish fallbacks directly', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-document-meal-direct-coverage-',
  )
  cleanupPaths.push(parentRoot)

  const { cli, services } = createCoverageCliAndServices()

  const documentImport = await getGroupCommandRun<{
    args: {
      file?: string
    }
    options: {
      vault?: string
      title?: string
      occurredAt?: string
      note?: string
      source?: string
    }
    requestId: string
  }>(cli, 'document', 'import')
  const importSpy = vi
    .spyOn(services.importers, 'importDocument')
    .mockResolvedValue({
      vault: vaultRoot,
      sourceFile: '/tmp/document-source.md',
      rawFile: '/tmp/document-source.raw',
      documentId: 'doc_01JNV422Y2M5ZBV64ZP4N1DRB1',
      eventId: 'evt_01JNV422Y2M5ZBV64ZP4N1DRB1',
      lookupId: 'doc_01JNV422Y2M5ZBV64ZP4N1DRB1',
      manifestFile: 'raw/documents/doc_01JNV422Y2M5ZBV64ZP4N1DRB1/manifest.json',
    })

  await documentImport({
    args: {},
    options: {},
    requestId: 'req_document_direct_branch',
  })
  assert.equal(importSpy.mock.calls.length, 1)
  assert.deepEqual(importSpy.mock.calls[0]?.[0], {
    file: '',
    vault: '',
    requestId: null,
    title: undefined,
    occurredAt: undefined,
    note: undefined,
    source: undefined,
  })

  const mealAdd = await getGroupCommandRun<{
    options: {
      vault?: string
      photo?: string
      audio?: string
      note?: string
      occurredAt?: string
      source?: string
    }
  }>(cli, 'meal', 'add')

  const fakeImporters: ImportersRuntime = {
    async importDocument() {
      return {
        raw: {
          relativePath: 'raw/document-source.raw',
        },
        manifestPath: 'raw/documents/document-source/manifest.json',
        documentId: 'doc_01JNV422Y2M5ZBV64ZP4N1DRB1',
        event: {
          id: 'evt_01JNV422Y2M5ZBV64ZP4N1DRB1',
        },
      }
    },
    async addMeal() {
      return {
        mealId: 'meal_01JNV422Y2M5ZBV64ZP4N1DRB1',
        event: {
          id: 'evt_01JNV422Y2M5ZBV64ZP4N1DRB1',
          occurredAt: null,
          note: null,
        },
        photo: {
          relativePath: 'raw/meals/meal-direct-photo.jpg',
        },
        audio: null,
        manifestPath: 'raw/meals/meal_01JNV422Y2M5ZBV64ZP4N1DRB1/manifest.json',
      }
    },
    async importCsvSamples() {
      return {
        count: 0,
        records: [],
        transformId: 'transform_01JNV422Y2M5ZBV64ZP4N1DRB1',
        manifestPath: 'raw/samples/transform.json',
        shardPaths: [],
      }
    },
    async importAssessmentResponse() {
      return {
        assessment: {
          id: 'assess_01JNV422Y2M5ZBV64ZP4N1DRB1',
        },
        manifestPath: 'raw/assessment/manifest.json',
        raw: {
          relativePath: 'raw/assessment/raw.json',
        },
        ledgerPath: 'raw/assessment/ledger.json',
      }
    },
  }
  const fakeRuntime: ImportersFactoryRuntimeModule = {
    createImporters() {
      return fakeImporters
    },
  }
  vi.spyOn(vaultRuntime, 'loadImportersRuntimeModule').mockResolvedValue(fakeRuntime)

  const mealResult = await mealAdd({
    options: {
      vault: undefined,
      photo: await writeFixtureFile(parentRoot, 'meal-direct-photo.jpg', 'meal-direct-photo-bytes'),
      audio: await writeFixtureFile(parentRoot, 'meal-direct-audio.m4a', 'meal-direct-audio-bytes'),
    },
  })
  assert.equal(typeof mealResult, 'object')
})
