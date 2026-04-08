import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'

import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { test } from 'vitest'

import type {
  InboxRuntimeConfig,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../src/index.ts'
import { describeLinqConnectorEndpoint } from '../src/linq-endpoint.ts'
import { tryKillProcess } from '../src/process-kill.ts'
import {
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '../src/vault-paths.ts'
import {
  buildDaemonState,
  createProcessSignalBridge,
  idleState,
  normalizeDaemonState,
  writeDaemonState,
} from '../src/inbox-services/daemon.ts'
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
  connectorNamespaceKey,
  countRuntimeCaptures,
  failCheck,
  isParseableAttachment,
  listAllCaptures,
  normalizeBackfillLimit,
  normalizeConnectorAccountId,
  normalizeLimit,
  normalizeOptionalCommandLimit,
  normalizeVaultPathOutput,
  occurredDayFromCapture,
  passCheck,
  redactSensitivePath,
  relativeToVault,
  resolveAttachmentParseState,
  runtimeNamespaceAccountId,
  warnCheck,
  writeJsonFile,
  readJsonWithSchema,
  fileExists,
} from '../src/inbox-services/shared.ts'
import {
  ensureConfigFile,
  ensureConnectorNamespaceAvailable,
  ensureDirectory,
  ensureInitializedWithInbox,
  findConnector,
  readConfig,
  rebuildRuntime,
  requireConnector,
  sortConnectors,
  withInitializedInboxRuntime,
  writeConfig,
} from '../src/inbox-services/state.ts'

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
    envelopePath: 'derived/inbox/capture-1/envelope.json',
    createdAt: '2026-04-08T10:12:30.000Z',
    ...overrides,
  }
}

function createRuntimeStore(captures: RuntimeCaptureRecord[]): RuntimeStore {
  return {
    close() {},
    getCapture(captureId: string) {
      return captures.find((capture) => capture.captureId === captureId) ?? null
    },
    getCursor() {
      return null
    },
    listCaptures(filters) {
      const limit = filters?.limit ?? captures.length
      return captures.slice(0, limit)
    },
    searchCaptures() {
      return []
    },
    setCursor() {},
  }
}

test('shared utility helpers normalize inbox metadata and paths', async () => {
  assert.equal(runtimeNamespaceAccountId({ accountId: undefined }), null)
  assert.equal(connectorNamespaceKey({ source: 'telegram', accountId: null }), 'telegram::default')
  assert.equal(normalizeConnectorAccountId('imessage', undefined), 'self')
  assert.equal(normalizeConnectorAccountId('telegram', undefined), 'bot')
  assert.equal(normalizeConnectorAccountId('linq', undefined), 'default')
  assert.equal(normalizeConnectorAccountId('email', ' inbox@example.com '), 'inbox@example.com')
  assert.throws(
    () => normalizeConnectorAccountId('unknown' as never, 'x'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_SOURCE_UNSUPPORTED',
  )

  assert.equal(normalizeBackfillLimit(undefined), undefined)
  assert.equal(normalizeBackfillLimit(5), 5)
  assert.equal(normalizeLimit(undefined, 20, 50), 20)
  assert.equal(normalizeLimit(10, 20, 50), 10)
  assert.equal(normalizeOptionalCommandLimit(undefined, 25), undefined)
  assert.equal(normalizeOptionalCommandLimit(5, 25), 5)
  assert.throws(
    () => normalizeBackfillLimit(0),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_INVALID_LIMIT',
  )
  assert.throws(
    () => normalizeLimit(99, 20, 50),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_INVALID_LIMIT',
  )
  assert.throws(
    () => normalizeOptionalCommandLimit(99, 25),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_INVALID_LIMIT',
  )

  assert.equal(relativeToVault('/vault', '/vault/inbox/file.json'), 'inbox/file.json')
  assert.equal(normalizeVaultPathOutput('/vault', '/vault/inbox/file.json'), 'inbox/file.json')
  assert.equal(normalizeVaultPathOutput('/vault', 'inbox\\file.json'), 'inbox/file.json')
  assert.equal(redactSensitivePath('/Users/example/Documents/file.txt'), '<REDACTED_PATH>')
  assert.equal(redactSensitivePath('/home/example/file.txt'), '<REDACTED_PATH>')
  assert.equal(redactSensitivePath(' C:\\Users\\Example\\file.txt '), '<REDACTED_PATH>')
  assert.equal(redactSensitivePath('relative/path.txt'), 'relative/path.txt')
  assert.equal(redactSensitivePath('   '), null)

  assert.deepEqual(passCheck('vault', 'ok'), {
    details: undefined,
    name: 'vault',
    status: 'pass',
    message: 'ok',
  })
  assert.deepEqual(warnCheck('vault', 'warn'), {
    details: undefined,
    name: 'vault',
    status: 'warn',
    message: 'warn',
  })
  assert.deepEqual(failCheck('vault', 'fail'), {
    details: undefined,
    name: 'vault',
    status: 'fail',
    message: 'fail',
  })

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-shared-'))
  try {
    const jsonPath = path.join(tempDir, 'nested', 'value.json')
    await writeJsonFile(jsonPath, { ok: true })
    assert.equal(await fileExists(jsonPath), true)
    const { z } = await import('zod')
    assert.deepEqual(
      await readJsonWithSchema(jsonPath, z.object({ ok: z.boolean() }), 'BROKEN', 'broken'),
      { ok: true },
    )
    await assert.rejects(
      () => readJsonWithSchema(path.join(tempDir, 'missing.json'), z.object({ ok: z.boolean() }), 'BROKEN', 'broken'),
      (error: unknown) => error instanceof VaultCliError && error.code === 'BROKEN',
    )
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
  assert.equal(countRuntimeCaptures(runtime), 1)
  assert.equal(listAllCaptures(runtime).length, 1)

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
    receivedAt: '2026-04-08T10:12:00.000Z',
    text: 'hello',
    attachmentCount: 1,
    envelopePath: 'derived/inbox/capture-1/envelope.json',
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

test('state helpers initialize config, sort connectors, and guard namespace conflicts', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-state-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    const createdPaths: string[] = []
    await ensureDirectory(paths.runtimeRoot, createdPaths, paths.absoluteVaultRoot)
    await ensureConfigFile(paths, createdPaths)
    const config = await readConfig(paths)
    assert.deepEqual(config, { connectors: [] })

    const updatedConfig: InboxRuntimeConfig = {
      connectors: [
        {
          id: 'telegram:bot',
          source: 'telegram',
          enabled: true,
          accountId: 'bot',
          options: {},
        },
        {
          id: 'email:primary',
          source: 'email',
          enabled: true,
          accountId: 'inbox-1',
          options: {},
        },
      ],
    }
    sortConnectors(updatedConfig)
    assert.deepEqual(updatedConfig.connectors.map((connector) => connector.id), [
      'email:primary',
      'telegram:bot',
    ])
    await writeConfig(paths, updatedConfig)
    assert.equal(findConnector(updatedConfig, 'email:primary')?.source, 'email')
    assert.equal(requireConnector(updatedConfig, 'telegram:bot').accountId, 'bot')
    assert.throws(
      () => requireConnector(updatedConfig, 'missing'),
      (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_SOURCE_NOT_FOUND',
    )
    ensureConnectorNamespaceAvailable(updatedConfig, {
      id: 'linq:other',
      source: 'linq',
      enabled: true,
      accountId: 'secondary',
      options: {},
    })
    assert.throws(
      () =>
        ensureConnectorNamespaceAvailable(updatedConfig, {
          id: 'email:dupe',
          source: 'email',
          enabled: true,
          accountId: 'inbox-1',
          options: {},
        }),
      (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_SOURCE_NAMESPACE_EXISTS',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('initialized inbox helpers open runtime, rebuild captures, and normalize filters', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-runtime-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    await ensureDirectory(path.dirname(paths.inboxConfigPath), [], paths.absoluteVaultRoot)
    await writeFile(
      paths.inboxConfigPath,
      JSON.stringify({
        schema: 'murph.inbox-runtime-config.v1',
        schemaVersion: 1,
        value: {
          connectors: [
            {
              id: 'telegram:bot',
              source: 'telegram',
              enabled: true,
              accountId: null,
              options: {},
            },
          ],
        },
      }),
      'utf8',
    )

    let closed = 0
    let rebuildCalls = 0
    const runtime = createRuntimeStore([createCapture(), createCapture({ captureId: 'capture-2' })])
    runtime.close = () => {
      closed += 1
    }
    const inboxd = {
      async ensureInboxVault() {},
      async openInboxRuntime() {
        return runtime
      },
      async rebuildRuntimeFromVault() {
        rebuildCalls += 1
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
    assert.ok(closed >= 2)

    assert.deepEqual(
      resolveSourceFilter(
        {
          connectors: [
            {
              id: 'telegram:bot',
              source: 'telegram',
              enabled: true,
              accountId: null,
              options: {},
            },
          ],
        },
        'telegram:bot',
      ),
      {
        source: 'telegram',
        accountId: null,
      },
    )
    assert.equal(resolveSourceFilter({ connectors: [] }, null), null)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('daemon, process, and assistant vault-path helpers handle stale and invalid paths', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-daemon-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    const staleState = buildDaemonState(paths, {
      status: 'running',
      running: true,
      pid: 123,
      connectorIds: ['email:primary'],
    })
    await writeDaemonState(paths, staleState)

    const normalized = await normalizeDaemonState(paths, {
      clock: () => new Date('2026-04-08T00:00:00.000Z'),
      getPid: () => 999,
      killProcess() {
        const error = Object.assign(new Error('gone'), { code: 'ESRCH' })
        throw error
      },
    })
    assert.equal(normalized.status, 'stale')
    assert.equal(normalized.stale, true)
    assert.equal(idleState(paths).status, 'idle')

    const bridge = createProcessSignalBridge()
    assert.equal(bridge.signal.aborted, false)
    bridge.cleanup()

    tryKillProcess(() => {}, 1, 'SIGTERM')
    tryKillProcess(
      () => {
        const error = Object.assign(new Error('gone'), { code: 'ESRCH' })
        throw error
      },
      1,
      'SIGTERM',
    )
    assert.throws(
      () =>
        tryKillProcess(
          () => {
            throw new Error('boom')
          },
          1,
          'SIGTERM',
        ),
      /boom/,
    )

    assert.deepEqual(
      describeLinqConnectorEndpoint({ options: {} }),
      {
        host: '0.0.0.0',
        path: '/linq-webhook',
        port: 8789,
      },
    )

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
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
