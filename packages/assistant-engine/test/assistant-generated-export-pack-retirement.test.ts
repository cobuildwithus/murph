import { createHash, randomBytes } from 'node:crypto'
import {
  link,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import type {
  AssistantOutboxIntent,
  AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { assistantVaultFileMaxBytes } from '@murphai/operator-config/assistant-cli-contracts'
import { withAssistantRuntimeWriteLock } from '@murphai/vault-usecases/assistant-runtime-write-lock'
import { materializeExportPack } from '@murphai/vault-usecases/helpers'

import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
import {
  buildAssistantGeneratedDeliveryRetirement,
} from '../src/assistant/generated-export-pack-retirement.ts'
import {
  createAssistantOutboxIntent,
  markAssistantOutboxIntentSentById,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  pruneAssistantRuntimeResidue,
  pruneQuiescentAssistantGeneratedDeliveryResidue,
} from '../src/assistant/runtime-residue.ts'
import {
  createAssistantTurnReceipt,
  readAssistantTurnReceipt,
} from '../src/assistant/turns.ts'
import {
  resolveAssistantVaultFileResponseMedia,
} from '../src/assistant/vault-file-send.ts'
import { createTempVaultContext } from './test-helpers.ts'
import { createTestZip } from './zip-test-helpers.ts'

const tempRoots: string[] = []
const PRUNE_NOW = new Date('2026-08-06T20:00:00.000Z')
const PRODUCTION_FIXTURE_ROOT = fileURLToPath(
  new URL('./fixtures/generated-export-pack/source/', import.meta.url),
)
const PRODUCTION_FIXTURE_ARCHIVE = fileURLToPath(
  new URL(
    './fixtures/generated-export-pack/production-export-pack.zip.base64',
    import.meta.url,
  ),
)

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })))
})

describe('assistant generated export-pack retirement', () => {
  it('records only an exact generated ZIP copy of an unchanged derived pack', async () => {
    const setup = await createExportPackDelivery('exact')

    expect(setup.retirement).toEqual({
      archiveRef: setup.media.ref,
      archiveSha256: setup.media.sha256,
      kind: 'sent_export_packs_v1',
      packs: [{
        basePath: setup.packBasePath,
        files: expect.arrayContaining(setup.packEntries.map(([filePath, contents]) => ({
          path: filePath,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          sizeBytes: Buffer.byteLength(contents),
        }))),
        packId: setup.packId,
      }],
    })
  })

  it('does not claim arbitrary, incomplete, or stale ZIP exports', async () => {
    const setup = await createExportPackDelivery('unsafe')
    const ordinaryArchive = createTestZip([
      ['exports/user-files/report.json', '{}'],
    ])
    const ordinaryRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/ordinary.zip`
    const ordinaryPath = path.join(setup.vaultRoot, ...ordinaryRef.split('/'))
    await writeFile(ordinaryPath, ordinaryArchive)
    const ordinaryMedia = await resolveAssistantVaultFileResponseMedia({
      ref: ordinaryRef,
      vaultRoot: setup.vaultRoot,
    })

    await expect(buildAssistantGeneratedDeliveryRetirement({
      archiveBytes: ordinaryArchive,
      file: ordinaryMedia,
      vault: setup.vaultRoot,
    })).resolves.toBeNull()

    const incompleteArchive = createTestZip(setup.packEntries.slice(0, 1))
    const incompleteMedia = mediaForArchive(setup.media, incompleteArchive)
    await expect(buildAssistantGeneratedDeliveryRetirement({
      archiveBytes: incompleteArchive,
      file: incompleteMedia,
      vault: setup.vaultRoot,
    })).resolves.toBeNull()

    const entityPath = path.join(
      setup.vaultRoot,
      ...setup.packEntries[1]![0].split('/'),
    )
    await writeFile(entityPath, '{"records":["changed"]}\n')
    await expect(buildAssistantGeneratedDeliveryRetirement({
      archiveBytes: setup.archive,
      file: setup.media,
      vault: setup.vaultRoot,
    })).resolves.toBeNull()
  })

  it('does not claim a live pack file with another hard link', async () => {
    const setup = await createExportPackDelivery('hardlinked')
    const entitiesPath = path.join(setup.packPath, 'entities.json')
    const linkedPath = path.join(setup.vaultRoot, 'exports', 'linked-entities.json')
    await link(entitiesPath, linkedPath)

    await expect(buildAssistantGeneratedDeliveryRetirement({
      archiveBytes: setup.archive,
      file: setup.media,
      vault: setup.vaultRoot,
    })).resolves.toBeNull()
  })

  it('keeps the sent transition free of cleanup and retires the pack at quiescence', async () => {
    const setup = await createExportPackDelivery('immediate-sent')
    const intent = await createDeliveryIntent({
      media: setup.media,
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })

    const sent = await markAssistantOutboxIntentSentById({
      delivery: {
        channel: 'linq',
        idempotencyKey: null,
        messageLength: intent.message.length,
        providerMessageId: 'provider-export-pack',
        providerThreadId: 'thread-export-pack',
        sentAt: '2026-08-06T18:01:00.000Z',
        target: 'thread-export-pack',
        targetKind: 'thread',
      },
      intentId: intent.intentId,
      vault: setup.vaultRoot,
    })

    expect(sent?.status).toBe('sent')
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).resolves.toMatchObject({
      exportPacksPruned: 1,
      filesPruned: 1,
    })
    await expect(stat(setup.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps provider success terminal when immediate cleanup refuses stale evidence', async () => {
    const setup = await createExportPackDelivery('sent-stale-archive')
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'send the export pack',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-export-pack',
      turnId: 'turn-export-pack',
      vault: setup.vaultRoot,
    })
    const intent = await createDeliveryIntent({
      media: setup.media,
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })
    await writeFile(setup.archivePath, 'stale archive bytes')

    const sent = await markExportPackIntentSent(intent, setup.vaultRoot)
    const persisted = await readAssistantOutboxIntent(
      setup.vaultRoot,
      intent.intentId,
    )
    const receipt = await readAssistantTurnReceipt(
      setup.vaultRoot,
      intent.turnId,
    )

    expect(sent).toMatchObject({
      delivery: expect.objectContaining({ providerMessageId: 'provider-export-pack' }),
      lastError: null,
      nextAttemptAt: null,
      status: 'sent',
    })
    expect(persisted).toEqual(sent)
    expect(receipt).toMatchObject({
      deliveryDisposition: 'sent',
      deliveryIntentId: intent.intentId,
      lastError: null,
      status: 'completed',
    })
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
  })

  it('refuses a sent archive whose manifest declares a nested pack path', async () => {
    const setup = await createExportPackDelivery('nested-path')
    const nestedFilePath = `${setup.packBasePath}/nested/payload.json`
    const nestedAbsolutePath = path.join(
      setup.vaultRoot,
      ...nestedFilePath.split('/'),
    )
    const manifest = `${JSON.stringify({
      files: [
        { path: `${setup.packBasePath}/manifest.json` },
        { path: nestedFilePath },
      ],
      format: 'murph.export-pack.v1',
      packId: setup.packId,
    }, null, 2)}\n`
    await mkdir(path.dirname(nestedAbsolutePath), { recursive: true })
    await writeFile(
      path.join(setup.packPath, 'manifest.json'),
      manifest,
    )
    await writeFile(nestedAbsolutePath, '{"private":"outside direct pack inventory"}\n')
    const archive = createTestZip([
      [`${setup.packBasePath}/manifest.json`, manifest],
      [nestedFilePath, '{"private":"outside direct pack inventory"}\n'],
    ])
    await writeFile(setup.archivePath, archive)
    const media = await resolveAssistantVaultFileResponseMedia({
      ref: setup.media.ref,
      vaultRoot: setup.vaultRoot,
    })
    const intent = await createDeliveryIntent({
      media,
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })

    await expect(markExportPackIntentSent(intent, setup.vaultRoot)).resolves
      .toMatchObject({ status: 'sent' })
    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).resolves.toMatchObject({ exportPacksPruned: 0 })
    await expect(readFile(nestedAbsolutePath, 'utf8')).resolves.toBe(
      '{"private":"outside direct pack inventory"}\n',
    )
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
  })

  it('refuses a sent pack containing a symlink and preserves its external target', async () => {
    const setup = await createExportPackDelivery('symlink')
    const externalPath = path.join(setup.vaultRoot, 'external-private.json')
    const packFilePath = path.join(setup.packPath, 'entities.json')
    await writeFile(externalPath, '{"external":"unchanged"}\n')
    await rm(packFilePath)
    await symlink(externalPath, packFilePath)
    const intent = await createDeliveryIntent({
      media: setup.media,
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })

    await expect(markExportPackIntentSent(intent, setup.vaultRoot)).resolves
      .toMatchObject({ status: 'sent' })
    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).resolves.toMatchObject({ exportPacksPruned: 0 })
    await expect(readFile(externalPath, 'utf8')).resolves.toBe(
      '{"external":"unchanged"}\n',
    )
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
  })

  it('recovers a missed terminal retirement during quiescent cleanup', async () => {
    const setup = await createExportPackDelivery('sent')
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })
    const canonicalPath = path.join(setup.vaultRoot, 'journal', 'daily.md')
    await mkdir(path.dirname(canonicalPath), { recursive: true })
    await writeFile(canonicalPath, 'canonical data\n')

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: setup.vaultRoot,
    })

    expect(result).toMatchObject({
      generatedDeliveryFilesPruned: 1,
      generatedExportPackBytesPruned: setup.packEntries.reduce(
        (total, [, contents]) => total + Buffer.byteLength(contents),
        0,
      ),
      generatedExportPacksPruned: 1,
    })
    await expect(stat(setup.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(canonicalPath, 'utf8')).resolves.toBe('canonical data\n')
  })

  it('retires a production-shaped deflated export ZIP after send and local restart', async () => {
    const immediate = await createProductionFixtureDelivery('fixture-sent')
    const pending = await createDeliveryIntent({
      media: immediate.media,
      status: 'pending',
      vaultRoot: immediate.vaultRoot,
    })

    await expect(markExportPackIntentSent(pending, immediate.vaultRoot)).resolves
      .toMatchObject({ status: 'sent' })
    await expect(stat(immediate.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: immediate.vaultRoot,
    })).resolves.toMatchObject({ exportPacksPruned: 1 })
    await expect(stat(immediate.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(immediate.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })

    const restarted = await createProductionFixtureDelivery('fixture-restart')
    await createDeliveryIntent({
      media: restarted.media,
      status: 'sent',
      vaultRoot: restarted.vaultRoot,
    })

    const result = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: restarted.vaultRoot,
    })

    expect(result).toMatchObject({
      exportPacksPruned: 1,
      filesPruned: 1,
    })
    await expect(stat(restarted.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(restarted.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { archiveSurvives: true, status: 'pending' as const },
    { archiveSurvives: false, status: 'failed' as const },
  ])('preserves the pack while delivery is $status', async ({
    archiveSurvives,
    status,
  }) => {
    const setup = await createExportPackDelivery(status)
    await createDeliveryIntent({
      media: setup.media,
      status,
      vaultRoot: setup.vaultRoot,
    })

    const result = await pruneAssistantRuntimeResidue({
      generatedDeliveryFilesQuiescent: true,
      now: PRUNE_NOW,
      pendingInputIds: [],
      vault: setup.vaultRoot,
    })

    expect(result.generatedExportPacksPruned).toBe(0)
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    const archiveExpectation = expect(stat(setup.archivePath))
    if (archiveSurvives) {
      await archiveExpectation.resolves.toMatchObject({ size: setup.archive.byteLength })
    } else {
      await archiveExpectation.rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('preserves a sent pack if either the archive or live pack is stale', async () => {
    const changedPack = await createExportPackDelivery('changed-pack')
    await createDeliveryIntent({
      media: changedPack.media,
      status: 'sent',
      vaultRoot: changedPack.vaultRoot,
    })
    await writeFile(
      path.join(changedPack.packPath, 'entities.json'),
      '{"records":["newer"]}\n',
    )

    const changedArchive = await createExportPackDelivery('changed-archive')
    await createDeliveryIntent({
      media: changedArchive.media,
      status: 'sent',
      vaultRoot: changedArchive.vaultRoot,
    })
    await writeFile(changedArchive.archivePath, 'replacement archive')

    for (const setup of [changedPack, changedArchive]) {
      const result = await pruneQuiescentAssistantGeneratedDeliveryResidue({
        vault: setup.vaultRoot,
      })
      expect(result.exportPacksPruned).toBe(0)
      await expect(stat(setup.packPath)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      })
    }
  })

  it('scans past completed missing archives and retires the next present ZIP', async () => {
    const setup = await createMultiExportPackDelivery(2)
    const missingRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/000-completed.zip`
    const missingPath = path.join(setup.vaultRoot, ...missingRef.split('/'))
    const missingArchive = createTestZip([['ordinary.json', '{}\n']])
    await writeFile(missingPath, missingArchive)
    const missingMedia = await resolveAssistantVaultFileResponseMedia({
      ref: missingRef,
      vaultRoot: setup.vaultRoot,
    })
    await createDeliveryIntent({
      media: missingMedia,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })
    await rm(missingPath)
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    const result = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })

    expect(result.exportPacksPruned).toBe(2)
    for (const packPath of setup.packPaths) {
      await expect(stat(packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed on a symlinked archive before a later valid ZIP', async () => {
    const setup = await createMultiExportPackDelivery(2)
    const unsafeRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/000-unsafe.zip`
    const unsafePath = path.join(setup.vaultRoot, ...unsafeRef.split('/'))
    const externalPath = path.join(setup.vaultRoot, 'external-archive.zip')
    const unsafeArchive = createTestZip([['ordinary.json', '{}\n']])
    await writeFile(unsafePath, unsafeArchive)
    const unsafeMedia = await resolveAssistantVaultFileResponseMedia({
      ref: unsafeRef,
      vaultRoot: setup.vaultRoot,
    })
    await createDeliveryIntent({
      media: unsafeMedia,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })
    await writeFile(externalPath, unsafeArchive)
    await rm(unsafePath)
    await symlink(externalPath, unsafePath)
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).rejects.toThrow(
      'resolves outside the vault root.',
    )
    for (const packPath of setup.packPaths) {
      await expect(stat(packPath)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      })
    }
    await expect(stat(setup.archivePath)).resolves.toMatchObject({
      size: setup.archive.byteLength,
    })
    await expect(readFile(externalPath)).resolves.toEqual(unsafeArchive)
  })

  it('retires a later exact pack when the first archive candidate is stale', async () => {
    const setup = await createMultiExportPackDelivery(2)
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })
    await writeFile(
      path.join(setup.packPaths[0]!, 'entities.json'),
      '{"records":["newer"]}\n',
    )

    const result = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })

    expect(result.exportPacksPruned).toBe(1)
    await expect(stat(setup.packPaths[0]!)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(setup.packPaths[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retires a later unowned pack while the first pack has an active delivery', async () => {
    const setup = await createMultiExportPackDelivery(2)
    const directMedia = await resolveAssistantVaultFileResponseMedia({
      ref: 'exports/packs/pack-many-00/entities.json',
      vaultRoot: setup.vaultRoot,
    })
    const directIntent = await createDirectPackFileIntent({
      deliveryConfirmationPending: false,
      media: directMedia,
      seed: 'multi-active-first',
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    const deferred = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })
    expect(deferred.exportPacksPruned).toBe(1)
    await expect(stat(setup.packPaths[0]!)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(setup.packPaths[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).resolves.toMatchObject({
      size: setup.archive.byteLength,
    })

    await saveAssistantOutboxIntent(setup.vaultRoot, {
      ...directIntent,
      status: 'failed',
      updatedAt: '2026-08-06T18:03:00.000Z',
    })
    const completed = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })
    expect(completed.exportPacksPruned).toBe(1)
    await expect(stat(setup.packPaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('scans past a deferred archive and retires a later independent ZIP', async () => {
    const first = await createExportPackDelivery('000-active-archive')
    const second = await createExportPackDelivery(
      '999-independent-archive',
      first.vaultRoot,
    )
    const directMedia = await resolveAssistantVaultFileResponseMedia({
      ref: `${first.packBasePath}/entities.json`,
      vaultRoot: first.vaultRoot,
    })
    const directIntent = await createDirectPackFileIntent({
      deliveryConfirmationPending: false,
      media: directMedia,
      seed: 'deferred-archive',
      status: 'pending',
      vaultRoot: first.vaultRoot,
    })
    await createDeliveryIntent({
      media: first.media,
      status: 'sent',
      vaultRoot: first.vaultRoot,
    })
    await createDeliveryIntent({
      media: second.media,
      status: 'sent',
      vaultRoot: first.vaultRoot,
    })

    const firstSweep = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: first.vaultRoot,
    })
    expect(firstSweep.exportPacksPruned).toBe(1)
    await expect(stat(first.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(first.archivePath)).resolves.toMatchObject({
      size: first.archive.byteLength,
    })
    await expect(stat(second.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(second.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })

    await saveAssistantOutboxIntent(first.vaultRoot, {
      ...directIntent,
      status: 'failed',
      updatedAt: '2026-08-06T18:04:00.000Z',
    })
    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: first.vaultRoot,
    })).resolves.toMatchObject({ exportPacksPruned: 1 })
    await expect(stat(first.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(first.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { seed: 'approval', status: 'awaiting_approval' as const },
    { seed: 'pending', status: 'pending' as const },
    { seed: 'sending', status: 'sending' as const },
    { seed: 'retryable', status: 'retryable' as const },
    {
      deliveryConfirmationPending: true,
      seed: 'confirmation',
      status: 'failed' as const,
    },
  ])('defers retirement for a $status direct pack-file delivery', async ({
    deliveryConfirmationPending = false,
    seed,
    status,
  }) => {
    const setup = await createExportPackDelivery(`active-direct-${seed}`)
    const directMedia = await resolveAssistantVaultFileResponseMedia({
      ref: `${setup.packBasePath}/entities.json`,
      vaultRoot: setup.vaultRoot,
    })
    const directIntent = await createDirectPackFileIntent({
      deliveryConfirmationPending,
      media: directMedia,
      seed,
      status,
      vaultRoot: setup.vaultRoot,
    })
    const zipIntent = await createDeliveryIntent({
      media: setup.media,
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })

    await expect(markExportPackIntentSent(zipIntent, setup.vaultRoot)).resolves
      .toMatchObject({ status: 'sent' })
    const deferred = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })

    expect(deferred).toMatchObject({
      exportPacksPruned: 0,
      filesPruned: 0,
    })
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(setup.archivePath)).resolves.toMatchObject({
      size: setup.archive.byteLength,
    })

    await saveAssistantOutboxIntent(setup.vaultRoot, {
      ...directIntent,
      deliveryConfirmationPending: false,
      status: 'failed',
      updatedAt: '2026-08-06T18:02:00.000Z',
    })
    const completed = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })

    expect(completed).toMatchObject({
      exportPacksPruned: 1,
      filesPruned: 1,
    })
    await expect(stat(setup.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to persist a direct pack-file obligation after deletion wins the lock race', async () => {
    const setup = await createExportPackDelivery('creation-race')
    const directMedia = await resolveAssistantVaultFileResponseMedia({
      ref: `${setup.packBasePath}/entities.json`,
      vaultRoot: setup.vaultRoot,
    })
    await rm(setup.packPath, { recursive: true })

    await expect(createDirectPackFileIntent({
      deliveryConfirmationPending: false,
      media: directMedia,
      seed: 'creation-race',
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_VAULT_FILE_CHANGED_BEFORE_PERSISTENCE',
    })
  })

  it('retires more than twenty packs in one interruptible quiescent sweep', async () => {
    const setup = await createMultiExportPackDelivery(21)
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })
    for (const packPath of setup.packPaths) {
      await expect(stat(packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retires independent packs whose combined bytes exceed the per-pack ceiling', async () => {
    const setup = await createMultiExportPackDelivery(
      2,
      52 * 1024 * 1024,
    )
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    const result = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })
    expect(result.exportPacksPruned).toBe(2)
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('treats an oversized pack as terminally ineligible and still retires a later exact pack', async () => {
    const setup = await createMultiExportPackDelivery(2, [
      assistantVaultFileMaxBytes + 1,
      0,
    ])
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    const result = await pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })

    expect(result.exportPacksPruned).toBe(1)
    await expect(stat(setup.packPaths[0]!)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(setup.packPaths[1]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).resolves.toMatchObject({ exportPacksPruned: 0, filesPruned: 0 })
  }, 30_000)

  it('retires a pack at the exact aggregate uncompressed-byte limit', async () => {
    const setup = await createMultiExportPackDelivery(1, 'max-aggregate')
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })

    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).resolves.toMatchObject({ exportPacksPruned: 1 })
    await expect(stat(setup.packPaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  it('serializes retirement behind an in-progress canonical pack materialization', async () => {
    const setup = await createExportPackDelivery('materialization-lock')
    await createDeliveryIntent({
      media: setup.media,
      status: 'sent',
      vaultRoot: setup.vaultRoot,
    })
    const replacementFiles = setup.packEntries.map(([filePath, contents]) => ({
      contents: filePath.endsWith('/entities.json')
        ? '{"records":[{"id":"replacement"}]}\n'
        : contents,
      path: filePath,
    }))
    let beginRetirement!: () => void
    const retirementStart = new Promise<void>((resolve) => {
      beginRetirement = resolve
    })
    let retirementSettled = false
    const retirement = retirementStart
      .then(async () => await pruneQuiescentAssistantGeneratedDeliveryResidue({
        vault: setup.vaultRoot,
      }))
      .finally(() => {
        retirementSettled = true
      })

    await withAssistantRuntimeWriteLock(setup.vaultRoot, async () => {
      await rm(setup.packPath, { force: true, recursive: true })
      await materializeExportPack(setup.vaultRoot, [replacementFiles[0]!])
      beginRetirement()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(retirementSettled).toBe(false)
      await materializeExportPack(setup.vaultRoot, replacementFiles.slice(1))
    })

    await expect(retirement).resolves.toMatchObject({ exportPacksPruned: 0 })
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(setup.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('aborts bounded retirement without losing its archive continuation', async () => {
    const setup = await createLargeExportPackDelivery()
    const pending = await createDeliveryIntent({
      media: setup.media,
      status: 'pending',
      vaultRoot: setup.vaultRoot,
    })
    await expect(markExportPackIntentSent(pending, setup.vaultRoot)).resolves
      .toMatchObject({ status: 'sent' })
    // Durable sent never runs optional archive work on the serial dispatch
    // stack; quiescent cleanup owns the interruptible continuation.
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    const controller = new AbortController()
    const cleanup = pruneQuiescentAssistantGeneratedDeliveryResidue({
      signal: controller.signal,
      vault: setup.vaultRoot,
    })
    setImmediate(() => controller.abort())

    await expect(cleanup).rejects.toMatchObject({ name: 'AbortError' })
    await expect(stat(setup.packPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    })
    await expect(stat(setup.archivePath)).resolves.toMatchObject({
      size: setup.archive.byteLength,
    })

    await expect(pruneQuiescentAssistantGeneratedDeliveryResidue({
      vault: setup.vaultRoot,
    })).resolves.toMatchObject({
      exportPacksPruned: 1,
      filesPruned: 1,
    })
  })
})

async function createExportPackDelivery(
  seed: string,
  existingVaultRoot?: string,
): Promise<{
  archive: Buffer
  archivePath: string
  media: AssistantVaultFileResponseMedia
  packBasePath: string
  packEntries: Array<readonly [string, string]>
  packId: string
  packPath: string
  retirement: Awaited<ReturnType<typeof buildAssistantGeneratedDeliveryRetirement>>
  vaultRoot: string
}> {
  const context = existingVaultRoot
    ? { parentRoot: null, vaultRoot: existingVaultRoot }
    : await createTempVaultContext(`assistant-export-pack-${seed}-`)
  if (context.parentRoot) {
    tempRoots.push(context.parentRoot)
  }
  const packId = `pack-${seed}`
  const packBasePath = `exports/packs/${packId}`
  const filePaths = [
    `${packBasePath}/manifest.json`,
    `${packBasePath}/entities.json`,
  ]
  const manifest = `${JSON.stringify({
    files: filePaths.map((filePath) => ({ path: filePath })),
    format: 'murph.export-pack.v1',
    packId,
  }, null, 2)}\n`
  const packEntries: Array<readonly [string, string]> = [
    [filePaths[0]!, manifest],
    [filePaths[1]!, '{"records":[]}\n'],
  ]
  const packPath = path.join(context.vaultRoot, ...packBasePath.split('/'))
  await mkdir(packPath, { recursive: true })
  for (const [filePath, contents] of packEntries) {
    await writeFile(
      path.join(context.vaultRoot, ...filePath.split('/')),
      contents,
    )
  }

  const archive = createTestZip([
    ...packEntries,
    ['journal/samples/2026-08-06.jsonl', '{}\n'],
  ])
  const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/export-${seed}.zip`
  const archivePath = path.join(context.vaultRoot, ...ref.split('/'))
  await mkdir(path.dirname(archivePath), { recursive: true })
  await writeFile(archivePath, archive)
  const media = await resolveAssistantVaultFileResponseMedia({
    ref,
    vaultRoot: context.vaultRoot,
  })
  const retirement = await buildAssistantGeneratedDeliveryRetirement({
    archiveBytes: archive,
    file: media,
    vault: context.vaultRoot,
  })
  return {
    archive,
    archivePath,
    media,
    packBasePath,
    packEntries,
    packId,
    packPath,
    retirement,
    vaultRoot: context.vaultRoot,
  }
}

async function createDeliveryIntent(input: {
  media: AssistantVaultFileResponseMedia
  status: 'failed' | 'pending' | 'sent'
  vaultRoot: string
}): Promise<AssistantOutboxIntent> {
  const intent = await createAssistantOutboxIntent({
    channel: 'linq',
    createdAt: '2026-08-06T18:00:00.000Z',
    identityId: 'participant-export-pack',
    initialState: { status: 'pending' },
    media: [input.media],
    message: input.media.filename,
    sessionId: 'session-export-pack',
    threadId: 'thread-export-pack',
    threadIsDirect: true,
    turnId: 'turn-export-pack',
    vault: input.vaultRoot,
  })
  if (input.status === 'pending') {
    return intent
  }
  return await saveAssistantOutboxIntent(input.vaultRoot, {
    ...intent,
    sentAt: input.status === 'sent' ? '2026-08-06T18:01:00.000Z' : null,
    status: input.status,
    updatedAt: '2026-08-06T18:01:00.000Z',
  })
}

async function createDirectPackFileIntent(input: {
  deliveryConfirmationPending: boolean
  media: AssistantVaultFileResponseMedia
  seed: string
  status: AssistantOutboxIntent['status']
  vaultRoot: string
}): Promise<AssistantOutboxIntent> {
  const intent = await createAssistantOutboxIntent({
    channel: 'linq',
    createdAt: '2026-08-06T17:59:00.000Z',
    identityId: `participant-direct-${input.seed}`,
    initialState: input.status === 'awaiting_approval'
      ? {
          nextAttemptAt: '2026-08-06T18:10:00.000Z',
          status: 'awaiting_approval',
        }
      : { status: 'pending' },
    media: [input.media],
    message: input.media.filename,
    sessionId: `session-direct-${input.seed}`,
    threadId: `thread-direct-${input.seed}`,
    threadIsDirect: true,
    turnId: `turn-direct-${input.seed}`,
    vault: input.vaultRoot,
  })
  if (
    intent.status === input.status
    && intent.deliveryConfirmationPending === input.deliveryConfirmationPending
  ) {
    return intent
  }
  return await saveAssistantOutboxIntent(input.vaultRoot, {
    ...intent,
    deliveryConfirmationPending: input.deliveryConfirmationPending,
    status: input.status,
    updatedAt: '2026-08-06T18:00:00.000Z',
  })
}

async function createMultiExportPackDelivery(
  packCount: number,
  payloadBytes: number | readonly number[] | 'max-aggregate' = 0,
): Promise<{
  archive: Buffer
  archivePath: string
  media: AssistantVaultFileResponseMedia
  packPaths: string[]
  vaultRoot: string
}> {
  const context = await createTempVaultContext('assistant-export-pack-many-')
  tempRoots.push(context.parentRoot)
  const archiveEntries: Array<readonly [string, string | Uint8Array]> = []
  const packPaths: string[] = []
  for (let index = 0; index < packCount; index += 1) {
    const packId = `pack-many-${String(index).padStart(2, '0')}`
    const basePath = `exports/packs/${packId}`
    const fileNames = [
      'manifest.json',
      'question-pack.json',
      'entities.json',
      'daily-samples.json',
      'assistant-context.md',
    ]
    const filePaths = fileNames.map((fileName) => `${basePath}/${fileName}`)
    const manifest = `${JSON.stringify({
        files: filePaths.map((filePath) => ({ path: filePath })),
        format: 'murph.export-pack.v1',
        packId,
      }, null, 2)}\n`
    const questionPack = '{"questions":[]}\n'
    const defaultEntities = '{"records":[]}\n'
    const dailySamples = '{"samples":[]}\n'
    const assistantContext = '# Assistant context\n'
    const fixedBytes = [manifest, questionPack, dailySamples, assistantContext]
      .reduce((total, contents) => total + Buffer.byteLength(contents), 0)
    const configuredPayloadBytes = resolveTestPackPayloadBytes(
      payloadBytes,
      index,
      fixedBytes,
    )
    const values = new Map<string, string | Uint8Array>([
      ['manifest.json', manifest],
      ['question-pack.json', questionPack],
      [
        'entities.json',
        configuredPayloadBytes > 0
          ? Buffer.alloc(configuredPayloadBytes, index + 1)
          : defaultEntities,
      ],
      ['daily-samples.json', dailySamples],
      ['assistant-context.md', assistantContext],
    ])
    const packPath = path.join(context.vaultRoot, ...basePath.split('/'))
    packPaths.push(packPath)
    await mkdir(packPath, { recursive: true })
    for (const [fileName, filePath] of fileNames.map((fileName, fileIndex) => [
      fileName,
      filePaths[fileIndex]!,
    ] as const)) {
      const contents = values.get(fileName)
      if (contents === undefined) {
        throw new Error('Missing export-pack test contents.')
      }
      await writeFile(path.join(packPath, fileName), contents)
      archiveEntries.push([filePath, contents])
    }
  }

  const archive = createTestZip(archiveEntries)
  const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/many-packs.zip`
  const archivePath = path.join(context.vaultRoot, ...ref.split('/'))
  await mkdir(path.dirname(archivePath), { recursive: true })
  await writeFile(archivePath, archive)
  const media = await resolveAssistantVaultFileResponseMedia({
    ref,
    vaultRoot: context.vaultRoot,
  })
  return { archive, archivePath, media, packPaths, vaultRoot: context.vaultRoot }
}

function resolveTestPackPayloadBytes(
  configured: number | readonly number[] | 'max-aggregate',
  index: number,
  fixedBytes: number,
): number {
  if (configured === 'max-aggregate') {
    return assistantVaultFileMaxBytes - fixedBytes
  }
  if (typeof configured === 'number') {
    return configured
  }
  return configured[index] ?? 0
}

async function createLargeExportPackDelivery(): Promise<{
  archive: Buffer
  archivePath: string
  media: AssistantVaultFileResponseMedia
  packPath: string
  vaultRoot: string
}> {
  const context = await createTempVaultContext('assistant-export-pack-abort-')
  tempRoots.push(context.parentRoot)
  const packId = 'pack-abort'
  const basePath = `exports/packs/${packId}`
  const manifestPath = `${basePath}/manifest.json`
  const payloadPath = `${basePath}/entities.json`
  const manifest = `${JSON.stringify({
    files: [{ path: manifestPath }, { path: payloadPath }],
    format: 'murph.export-pack.v1',
    packId,
  }, null, 2)}\n`
  const payload = randomBytes(8 * 1024 * 1024)
  const packPath = path.join(context.vaultRoot, ...basePath.split('/'))
  await mkdir(packPath, { recursive: true })
  await writeFile(path.join(packPath, 'manifest.json'), manifest)
  await writeFile(path.join(packPath, 'entities.json'), payload)
  const archive = createTestZip([
    [manifestPath, manifest],
    [payloadPath, payload],
  ])
  const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/abort-pack.zip`
  const archivePath = path.join(context.vaultRoot, ...ref.split('/'))
  await mkdir(path.dirname(archivePath), { recursive: true })
  await writeFile(archivePath, archive)
  const media = await resolveAssistantVaultFileResponseMedia({
    ref,
    vaultRoot: context.vaultRoot,
  })
  return {
    archive,
    archivePath,
    media,
    packPath,
    vaultRoot: context.vaultRoot,
  }
}

async function createProductionFixtureDelivery(seed: string): Promise<{
  archive: Buffer
  archivePath: string
  media: AssistantVaultFileResponseMedia
  packPath: string
  vaultRoot: string
}> {
  const context = await createTempVaultContext(`assistant-export-pack-${seed}-`)
  tempRoots.push(context.parentRoot)
  const packBasePath = 'exports/packs/fixture-pack'
  const packPath = path.join(context.vaultRoot, ...packBasePath.split('/'))
  const fixtureFiles = [
    'manifest.json',
    'question-pack.json',
    'entities.json',
    'daily-samples.json',
    'assistant-context.md',
  ]
  await mkdir(packPath, { recursive: true })
  for (const fileName of fixtureFiles) {
    await writeFile(
      path.join(packPath, fileName),
      await readFile(path.join(
        PRODUCTION_FIXTURE_ROOT,
        ...packBasePath.split('/'),
        fileName,
      )),
    )
  }

  // This committed fixture was produced once with the same ordinary Info-ZIP
  // toolchain used by supported assistant ZIP creation (`zip -X -9 -r`). Tests
  // consume the bytes directly and never depend on an ambient zip executable.
  const archive = Buffer.from(
    (await readFile(PRODUCTION_FIXTURE_ARCHIVE, 'utf8')).trim(),
    'base64',
  )
  const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/production-${seed}.zip`
  const archivePath = path.join(context.vaultRoot, ...ref.split('/'))
  await mkdir(path.dirname(archivePath), { recursive: true })
  await writeFile(archivePath, archive)
  const media = await resolveAssistantVaultFileResponseMedia({
    ref,
    vaultRoot: context.vaultRoot,
  })
  return {
    archive,
    archivePath,
    media,
    packPath,
    vaultRoot: context.vaultRoot,
  }
}

function mediaForArchive(
  media: AssistantVaultFileResponseMedia,
  archive: Buffer,
): AssistantVaultFileResponseMedia {
  return {
    ...media,
    sha256: createSha256(archive),
    sizeBytes: archive.byteLength,
  }
}

async function markExportPackIntentSent(
  intent: AssistantOutboxIntent,
  vault: string,
): Promise<AssistantOutboxIntent | null> {
  return await markAssistantOutboxIntentSentById({
    delivery: {
      channel: 'linq',
      idempotencyKey: null,
      messageLength: intent.message.length,
      providerMessageId: 'provider-export-pack',
      providerThreadId: 'thread-export-pack',
      sentAt: '2026-08-06T18:01:00.000Z',
      target: 'thread-export-pack',
      targetKind: 'thread',
    },
    intentId: intent.intentId,
    vault,
  })
}

function createSha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
