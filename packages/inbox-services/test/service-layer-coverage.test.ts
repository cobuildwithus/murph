import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  InboxConnectorConfig,
  InboxRuntimeConfig,
} from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  resolveRuntimePaths,
  type RuntimePaths,
} from '@murphai/runtime-state/node'
import { afterEach, test, vi } from 'vitest'

import {
  normalizeAssistantCaptureId,
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import {
  buildCaptureCursor,
  detailCapture,
  hasStoredPath,
  isStoredAudioAttachment,
  isStoredDocumentAttachment,
  isStoredImageAttachment,
  requireAttachmentRecord,
  requireCapture,
  resolveSourceFilter,
  summarizeCapture,
  toCliAttachment,
} from '../src/inbox-services/query.ts'
import {
  fileExists,
  normalizeLimit,
  occurredDayFromCapture,
  relativeToVault,
  resolveAttachmentParseState,
  runtimeNamespaceAccountId,
} from '../src/inbox-services/shared.ts'
import {
  ensureConfigFile,
  ensureDirectory,
  findConnector,
  readConfig,
  rebuildRuntime,
  requireConnector,
} from '../src/inbox-services/state.ts'
import type {
  InboxPaths,
  InboxRuntimeModule,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../src/index.ts'
import { createIntegratedInboxServices } from '../src/index.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(tempRoot, { force: true, recursive: true }),
      )
    }),
  )
})

async function createTempVault(): Promise<RuntimePaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-'))
  tempRoots.push(tempRoot)
  await mkdir(tempRoot, { recursive: true })
  return resolveRuntimePaths(tempRoot)
}

function createConnector(
  overrides: Partial<InboxConnectorConfig> & Pick<InboxConnectorConfig, 'id' | 'source'>,
): InboxConnectorConfig {
  return {
    accountId: null,
    enabled: true,
    options: {},
    ...overrides,
  }
}

function createCapture(
  overrides: Partial<RuntimeCaptureRecord> = {},
): RuntimeCaptureRecord {
  return {
    accountId: 'default',
    actor: {
      displayName: 'Ada',
      id: 'actor-1',
      isSelf: false,
    },
    attachments: [],
    captureId: 'capture-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    sourceDirectory: 'raw/inbox/telegram/default/capture-1',
    eventId: 'event-1',
    externalId: 'external-1',
    occurredAt: '2025-01-01T00:00:00.000Z',
    raw: {},
    receivedAt: '2025-01-01T00:00:01.000Z',
    source: 'telegram',
    text: 'hello',
    thread: {
      id: 'thread-1',
      isDirect: true,
      title: 'Thread',
    },
    ...overrides,
  }
}

async function runInboxEnvelopeMigration(): Promise<
  Awaited<ReturnType<InboxRuntimeModule['runInboxEnvelopeMigration']>>
> {
  return {
    activeOperationCount: 0,
    blockerCount: 0,
    candidateBytes: 0,
    candidateCount: 0,
    deletedBytes: 0,
    deletedCount: 0,
    hasMore: false,
    hasWork: false,
    mismatchCount: 0,
    missingLedgerCount: 0,
    mode: 'dry-run',
    mutated: false,
    scannedEnvelopeCount: 0,
  }
}

function createRuntimeStore(
  captures: RuntimeCaptureRecord[],
): RuntimeStore {
  return {
    claimNextAttachmentParseJob() {
      return null
    },
    close() {},
    completeAttachmentParseJob() {
      return {
        applied: false,
        job: {
          attachmentId: 'attachment-1',
          attempts: 1,
          captureId: 'capture-1',
          createdAt: '2026-04-08T00:00:00.000Z',
          jobId: 'job-1',
          pipeline: 'attachment_text',
          state: 'succeeded',
        },
      }
    },
    failAttachmentParseJob() {
      return {
        applied: false,
        job: {
          attachmentId: 'attachment-1',
          attempts: 1,
          captureId: 'capture-1',
          createdAt: '2026-04-08T00:00:00.000Z',
          jobId: 'job-1',
          pipeline: 'attachment_text',
          state: 'failed',
        },
      }
    },
    getCapture(captureId) {
      return captures.find((capture) => capture.captureId === captureId) ?? null
    },
    getAttachment(attachmentId: string) {
      for (const capture of captures) {
        const attachment = capture.attachments.find(
          (candidate) => candidate.attachmentId === attachmentId,
        )
        if (attachment) {
          return { capture, attachment }
        }
      }
      return null
    },
    getCursor() {
      return null
    },
    listAttachmentParseJobs() {
      return []
    },
    listCaptures(filters) {
      return captures.slice(0, filters?.limit)
    },
    requeueAttachmentParseJobs() {
      return 0
    },
    searchCaptures(filters) {
      return captures.slice(0, filters.limit).map((capture) => ({
        accountId: capture.accountId ?? null,
        captureId: capture.captureId,
        sourceDirectory: capture.sourceDirectory,
        occurredAt: capture.occurredAt,
        score: 1,
        snippet: capture.text ?? '',
        source: capture.source,
        text: capture.text,
        threadId: capture.thread.id,
        threadTitle: capture.thread.title ?? null,
      }))
    },
    setCursor() {},
  }
}

test('service-layer helpers cover query, state, and vault path branches', async () => {
  assert.equal(typeof createIntegratedInboxServices, 'function')

  const paths = await createTempVault()
  const absoluteNested = await resolveAssistantVaultPath(paths.absoluteVaultRoot, 'derived/inbox')
  assert.match(absoluteNested, /derived[\\/]inbox$/)
  await assert.rejects(
    () => resolveAssistantVaultPath(paths.absoluteVaultRoot, '../escape'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
  )
  assert.equal(normalizeAssistantCaptureId(' capture-1 '), 'capture-1')
  assert.throws(() => normalizeAssistantCaptureId('../bad'), /outside the vault root/)
  const artifactPath = await resolveAssistantInboxArtifactPath(
    paths.absoluteVaultRoot,
    'capture-1',
    'attachment.txt',
  )
  assert.match(artifactPath.relativePath, /derived\/inbox\/capture-1\/assistant\/attachment\.txt$/)
  const symlinkRoot = await createTempVault()
  await symlink('/tmp', path.join(symlinkRoot.absoluteVaultRoot, 'escape'))
  await assert.rejects(
    () => resolveAssistantVaultPath(symlinkRoot.absoluteVaultRoot, 'escape/child.txt', 'file path'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
  )

  const connector = createConnector({
    id: 'telegram:bot',
    source: 'telegram',
    accountId: null,
    options: { backfillLimit: 10 },
  })
  assert.equal(runtimeNamespaceAccountId(connector), 'bot')
  assert.equal(normalizeLimit(undefined, 20, 50), 20)
  assert.equal(normalizeLimit(25, 20, 50), 25)
  assert.throws(() => normalizeLimit(100, 20, 50), /Limit must be an integer/)
  assert.equal(relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath), '.runtime/projections/inboxd.sqlite')

  const tempJson = path.join(paths.absoluteVaultRoot, 'sample.json')
  await writeFile(tempJson, '{}')
  assert.equal(await fileExists(tempJson), true)

  const attachment: RuntimeAttachmentRecord = {
    attachmentId: 'attachment-1',
    byteSize: 42,
    derivedPath: 'derived.txt',
    externalId: 'external-attachment-1',
    extractedText: 'hello',
    fileName: 'file.txt',
    kind: 'image',
    mime: 'image/png',
    ordinal: 0,
    originalPath: '/tmp/original',
    parseState: 'succeeded',
    parserProviderId: 'provider-1',
    sha256: 'abc',
    storedPath: 'derived/inbox/file.png',
    transcriptText: 'hello',
  }
  assert.equal(hasStoredPath(attachment), true)
  assert.equal(isStoredImageAttachment(attachment), true)
  assert.equal(isStoredAudioAttachment({ ...attachment, kind: 'audio' }), true)
  assert.equal(isStoredDocumentAttachment({ ...attachment, kind: 'document' }), true)
  assert.deepEqual(buildCaptureCursor(createCapture()), {
    occurredAt: '2025-01-01T00:00:00.000Z',
    externalId: 'external-1',
    receivedAt: '2025-01-01T00:00:01.000Z',
  })
  const promotions = [{ id: 'promotion-1' }] as Array<{ id: string }>
  const detailedCapture = createCapture({ attachments: [attachment] })
  assert.equal(summarizeCapture(detailedCapture, promotions as never).attachmentCount, 1)
  assert.equal(detailCapture(detailedCapture, promotions as never).attachments.length, 1)
  assert.equal(toCliAttachment(attachment).storedPath, 'derived/inbox/file.png')
  const runtime = createRuntimeStore([detailedCapture])
  assert.equal(requireCapture(runtime, 'capture-1').captureId, 'capture-1')
  assert.throws(() => requireCapture(runtime, 'missing'), /was not found/)
  assert.equal(requireAttachmentRecord(runtime, 'attachment-1').attachment.attachmentId, 'attachment-1')
  assert.throws(() => requireAttachmentRecord(runtime, 'missing'), /was not found/)
  const config: InboxRuntimeConfig = {
    connectors: [connector],
  }
  assert.equal(resolveSourceFilter(config, null), null)
  assert.deepEqual(resolveSourceFilter(config, 'telegram:bot'), {
    accountId: 'bot',
    source: 'telegram',
  })
  assert.deepEqual(
    resolveSourceFilter(
      {
        connectors: [
          createConnector({
            id: 'linq:legacy',
            source: 'linq',
            accountId: null,
          }),
        ],
      },
      'linq:legacy',
    ),
    {
      accountId: 'default',
      source: 'linq',
    },
  )

  assert.equal(resolveAttachmentParseState(attachment, []), 'succeeded')
  assert.equal(
    occurredDayFromCapture(detailedCapture),
    '2025-01-01',
  )

  const configPaths = await createTempVault()
  await ensureDirectory(path.dirname(configPaths.inboxConfigPath), [], configPaths.absoluteVaultRoot)
  await ensureConfigFile(configPaths as InboxPaths, [])
  assert.deepEqual(await readConfig(configPaths as InboxPaths), { connectors: [] })
  const persistedConfig = { connectors: [{ ...connector, accountId: 'bot' }] }
  assert.equal(findConnector(persistedConfig, 'telegram:bot')?.accountId, 'bot')
  assert.equal(findConnector(persistedConfig, 'telegram:bot')?.id, 'telegram:bot')
  assert.equal(requireConnector(persistedConfig, 'telegram:bot').id, 'telegram:bot')
  assert.throws(() => requireConnector(persistedConfig, 'missing'), /is not configured/)
  const rebuildRuntimeFromVaultMock = vi.fn(
    async (input: Parameters<InboxRuntimeModule['rebuildRuntimeFromVault']>[0]) => {
      assert.equal(input.enqueueParserJobs, true)
    },
  )
  const rebuildCount = await rebuildRuntime(
    configPaths as InboxPaths,
    {
      async ensureInboxVault() {},
      async openInboxRuntime() {
        return {
          claimNextAttachmentParseJob() {
            return null
          },
          close() {},
          completeAttachmentParseJob() {
            return {
              applied: false,
              job: {
                attachmentId: 'attachment-1',
                attempts: 1,
                captureId: 'capture-1',
                createdAt: '2026-04-08T00:00:00.000Z',
                jobId: 'job-1',
                pipeline: 'attachment_text',
                state: 'succeeded',
              },
            }
          },
          failAttachmentParseJob() {
            return {
              applied: false,
              job: {
                attachmentId: 'attachment-1',
                attempts: 1,
                captureId: 'capture-1',
                createdAt: '2026-04-08T00:00:00.000Z',
                jobId: 'job-1',
                pipeline: 'attachment_text',
                state: 'failed',
              },
            }
          },
          getCapture() {
            return null
          },
          getAttachment() {
            return null
          },
          getCursor() {
            return null
          },
          listAttachmentParseJobs() {
            return []
          },
          listCaptures(filters) {
            const limit = filters?.limit ?? 0
            const count = limit < 800 ? limit : 400
            return Array.from({ length: count }, () => createCapture())
          },
          requeueAttachmentParseJobs() {
            return 0
          },
          searchCaptures() {
            return []
          },
          setCursor() {},
        }
      },
      async rebuildRuntimeFromVault(input) {
        await rebuildRuntimeFromVaultMock(input)
      },
      runInboxEnvelopeMigration,
    } as InboxRuntimeModule,
  )
  assert.equal(rebuildCount, 400)
  assert.equal(rebuildRuntimeFromVaultMock.mock.calls.length, 1)

})
