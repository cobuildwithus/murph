import { createHash } from 'node:crypto'
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type {
  AssistantOutboxIntent,
  AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../src/assistant/generated-delivery-files.ts'
import {
  buildAssistantGeneratedDeliveryRetirement,
} from '../src/assistant/generated-export-pack-retirement.ts'
import {
  createAssistantOutboxIntent,
  markAssistantOutboxIntentSentById,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { pruneAssistantRuntimeResidue } from '../src/assistant/runtime-residue.ts'
import {
  resolveAssistantVaultFileResponseMedia,
} from '../src/assistant/vault-file-send.ts'
import { createTempVaultContext } from './test-helpers.ts'
import { createTestZip } from './zip-test-helpers.ts'

const tempRoots: string[] = []
const PRUNE_NOW = new Date('2026-08-06T20:00:00.000Z')

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

  it('retires the exact pack immediately after its generated ZIP reaches sent', async () => {
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
    await expect(stat(setup.packPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(setup.archivePath)).resolves.toMatchObject({
      size: setup.archive.byteLength,
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
    }
  })
})

async function createExportPackDelivery(seed: string): Promise<{
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
  const context = await createTempVaultContext(`assistant-export-pack-${seed}-`)
  tempRoots.push(context.parentRoot)
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

function createSha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
