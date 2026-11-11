import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  resolveRuntimePaths,
} from '@murphai/runtime-state/node'
import { test } from 'vitest'

import {
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import {
  buildAttachmentParseStatus,
} from '../src/inbox-services/parser.ts'
import {
  buildCaptureCursor,
  detailCapture,
  hasStoredPath,
  isStoredAudioAttachment,
  isStoredDocumentAttachment,
  isStoredImageAttachment,
  requireAttachmentRecord,
  requireCapture,
  summarizeCapture,
  toCliAttachment,
} from '../src/inbox-services/query.ts'
import {
  fileExists,
  isParseableAttachment,
  normalizeLimit,
  occurredDayFromCapture,
  relativeToVault,
  resolveAttachmentParseState,
} from '../src/inbox-services/shared.ts'
import {
  ensureDirectory,
  ensureInitializedWithInbox,
  rebuildRuntime,
  withInitializedInboxRuntime,
} from '../src/inbox-services/state.ts'
import type {
  InboxRuntimeModule,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../src/index.ts'

function createCapture(overrides: Partial<RuntimeCaptureRecord> = {}): RuntimeCaptureRecord {
  return {
    captureId: 'capture-1',
    eventId: 'event-1',
    source: 'email',
    externalId: 'external-1',
    accountId: 'inbox-1',
    thread: {
      id: 'thread-1',
      title: 'Inbox thread',
      isDirect: true,
    },
    actor: {
      id: 'actor-1',
      displayName: 'Inbox user',
      isSelf: false,
    },
    occurredAt: '2026-04-08T10:11:12.000Z',
    receivedAt: '2026-04-08T10:12:00.000Z',
    text: 'hello',
    attachments: [],
    raw: {},
    sourceDirectory: 'raw/inbox/email/inbox-1/capture-1',
    createdAt: '2026-04-08T10:12:30.000Z',
    ...overrides,
  }
}

function createRuntimeStore(captures: RuntimeCaptureRecord[]): RuntimeStore {
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
    getCapture(captureId: string) {
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
      const limit = filters?.limit ?? captures.length
      return captures.slice(0, limit)
    },
    requeueAttachmentParseJobs() {
      return 0
    },
    searchCaptures() {
      return []
    },
    setCursor() {},
  }
}

test('shared utility helpers normalize inbox metadata and paths', async () => {

  assert.equal(normalizeLimit(undefined, 20, 50), 20)
  assert.equal(normalizeLimit(10, 20, 50), 10)
  assert.throws(
    () => normalizeLimit(99, 20, 50),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_INVALID_LIMIT',
  )

  assert.equal(relativeToVault('/vault', '/vault/inbox/file.json'), 'inbox/file.json')

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-shared-'))
  try {
    const jsonPath = path.join(tempDir, 'value.json')
    await writeFile(jsonPath, '{}')
    assert.equal(await fileExists(jsonPath), true)
    assert.equal(await fileExists(path.join(tempDir, 'missing.json')), false)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('capture and attachment helpers summarize runtime records', () => {
  const attachment: RuntimeAttachmentRecord = {
    attachmentId: 'attachment-1',
    ordinal: 1,
    externalId: 'external-attachment',
    kind: 'audio',
    storedPath: 'derived/audio.wav',
    parseState: null,
  }
  const capture = createCapture({
    attachments: [attachment],
  })
  const promotions = [{ target: 'document', relatedId: 'doc-1' }] as never[]
  const runtime = createRuntimeStore([capture])

  assert.equal(hasStoredPath(attachment), true)
  assert.equal(isStoredAudioAttachment(attachment), true)
  assert.equal(isStoredImageAttachment(attachment), false)
  assert.equal(isStoredDocumentAttachment({ ...attachment, kind: 'document' }), true)
  assert.equal(isParseableAttachment(attachment), true)
  assert.equal(
    resolveAttachmentParseState(attachment, [{ state: 'running' } as never]),
    'running',
  )
  assert.deepEqual(buildCaptureCursor(capture), {
    occurredAt: capture.occurredAt,
    externalId: capture.externalId,
    receivedAt: capture.receivedAt,
  })
  assert.equal(occurredDayFromCapture(capture), '2026-04-08')
  assert.throws(
    () => occurredDayFromCapture({ ...capture, occurredAt: 'bad-date' }),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_CAPTURE_OCCURRED_AT_INVALID',
  )

  assert.deepEqual(summarizeCapture(capture, promotions), {
    captureId: 'capture-1',
    source: 'email',
    accountId: 'inbox-1',
    externalId: 'external-1',
    threadId: 'thread-1',
    threadTitle: 'Inbox thread',
    threadIsDirect: true,
    actorId: 'actor-1',
    actorName: 'Inbox user',
    actorIsSelf: false,
    occurredAt: '2026-04-08T10:11:12.000Z',
    createdAt: '2026-04-08T10:12:30.000Z',
    receivedAt: '2026-04-08T10:12:00.000Z',
    text: 'hello',
    attachmentCount: 1,
    sourceDirectory: 'raw/inbox/email/inbox-1/capture-1',
    eventId: 'event-1',
    promotions,
  })
  assert.equal(detailCapture(capture, promotions).attachments.length, 1)
  assert.deepEqual(toCliAttachment(attachment).storedPath, 'derived/audio.wav')
  assert.equal(requireCapture(runtime, 'capture-1').captureId, 'capture-1')
  assert.throws(
    () => requireCapture(runtime, 'missing'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_CAPTURE_NOT_FOUND',
  )
  assert.equal(requireAttachmentRecord(runtime, 'attachment-1').capture.captureId, 'capture-1')
  assert.throws(
    () => requireAttachmentRecord(runtime, 'missing'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_ATTACHMENT_NOT_FOUND',
  )
})

test('parser status helpers preserve attachment job evidence', async () => {
  const runtime = createRuntimeStore([])
  const listAttachmentParseJobs = (
    { attachmentId, limit }: { attachmentId?: string; limit?: number } = {},
  ): RuntimeAttachmentParseJobRecord[] => {
    assert.equal(attachmentId, 'attachment-1')
    assert.equal(limit, 20)
    return [
      {
        attachmentId: 'attachment-1',
        attempts: 2,
        captureId: 'capture-1',
        createdAt: '2026-04-08T00:00:00.000Z',
        errorCode: undefined,
        errorMessage: undefined,
        finishedAt: undefined,
        jobId: 'job-1',
        pipeline: 'attachment_text',
        providerId: undefined,
        resultPath: 'derived/inbox/capture-1/result.json',
        startedAt: '2026-04-08T00:00:01.000Z',
        state: 'running',
      },
    ]
  }
  const requeueAttachmentParseJobs = () => 1

  const status = buildAttachmentParseStatus({
    attachmentId: 'attachment-1',
    captureId: 'capture-1',
    fallbackAttachment: {
      attachmentId: 'attachment-1',
      kind: 'audio',
      ordinal: 1,
      parseState: 'pending',
      storedPath: 'raw/inbox/capture-1/fallback.m4a',
    },
    listAttachmentParseJobs,
    runtime: {
      ...runtime,
      getCapture(captureId: string) {
        assert.equal(captureId, 'capture-1')
        return createCapture({
          attachments: [
            {
              attachmentId: 'attachment-1',
              kind: 'audio',
              ordinal: 1,
              parseState: null,
              storedPath: 'raw/inbox/capture-1/final.m4a',
            },
          ],
        })
      },
    },
  })
  assert.deepEqual(status, {
    currentState: 'running',
    jobs: [
      {
        attachmentId: 'attachment-1',
        attempts: 2,
        captureId: 'capture-1',
        createdAt: '2026-04-08T00:00:00.000Z',
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        jobId: 'job-1',
        pipeline: 'attachment_text',
        providerId: null,
        resultPath: 'derived/inbox/capture-1/result.json',
        startedAt: '2026-04-08T00:00:01.000Z',
        state: 'running',
      },
    ],
  })
})

test('initialized inbox helpers open runtime, rebuild captures, and normalize filters', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-runtime-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    let closed = 0
    let rebuildCalls = 0
    let rebuildEnqueueParserJobs: boolean | null = null
    const runtime = createRuntimeStore([createCapture(), createCapture({ captureId: 'capture-2' })])
    runtime.close = () => {
      closed += 1
    }
    const inboxd = {
      async ensureInboxVault() {},
      async openInboxRuntime() {
        return runtime
      },
      async rebuildRuntimeFromVault(input: Parameters<InboxRuntimeModule['rebuildRuntimeFromVault']>[0]) {
        rebuildCalls += 1
        rebuildEnqueueParserJobs = input.enqueueParserJobs
        return 2
      },
    } as never

    const initialized = await ensureInitializedWithInbox(inboxd, tempDir)
    assert.equal(initialized.absoluteVaultRoot, paths.absoluteVaultRoot)

    const result = await withInitializedInboxRuntime(async () => inboxd, tempDir, async ({ paths: currentPaths, runtime: currentRuntime }) => {
      assert.equal(currentPaths.absoluteVaultRoot, paths.absoluteVaultRoot)
      assert.equal(currentRuntime.listCaptures({ limit: 10 }).length, 2)
      return 'ok'
    })
    assert.equal(result, 'ok')
    assert.equal(await rebuildRuntime(paths, inboxd), 2)
    assert.equal(rebuildCalls, 1)
    assert.equal(rebuildEnqueueParserJobs, true)
    assert.ok(closed >= 2)

  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('assistant vault paths reject traversal and symlinks', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-vault-paths-'))
  try {
    const relativePath = await resolveAssistantVaultPath(tempDir, 'derived/inbox/capture-1')
    assert.equal(relativePath, path.join(tempDir, 'derived/inbox/capture-1'))
    const artifact = await resolveAssistantInboxArtifactPath(tempDir, 'capture-1', 'result.json')
    assert.equal(artifact.relativePath, 'derived/inbox/capture-1/assistant/result.json')
    await assert.rejects(
      () => resolveAssistantVaultPath(tempDir, '../outside'),
      (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
    )
    await assert.rejects(
      () => resolveAssistantInboxArtifactPath(tempDir, 'bad/id', 'result.json'),
      (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
    )

    const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-symlink-'))
    const realDir = path.join(symlinkRoot, 'real')
    const linkDir = path.join(symlinkRoot, 'link')
    await ensureDirectory(realDir, [], symlinkRoot)
    await symlink(realDir, linkDir)
    await assert.rejects(
      () => resolveAssistantVaultPath(symlinkRoot, 'link/escape.txt', 'file path'),
      (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
    )
    await rm(symlinkRoot, { recursive: true, force: true })

  } finally { await rm(tempDir, { recursive: true, force: true }) }
})
