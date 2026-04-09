import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'

import { resolveRuntimePaths, tryKillProcess } from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { test } from 'vitest'

import type {
  InboxRuntimeConfig,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../src/index.ts'
import { describeLinqConnectorEndpoint } from '../src/linq-endpoint.ts'
import {
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import {
  buildDaemonState,
  createProcessSignalBridge,
  idleState,
  normalizeDaemonState,
  writeDaemonState,
} from '../src/inbox-services/daemon.ts'
import { instantiateConnector } from '../src/inbox-services/connectors.ts'
import {
  assertBootstrapStrictReady,
  buildAttachmentParseStatus,
  createParserServiceContext,
  requireAttachmentParseJobs,
  requireAttachmentReparseSupport,
  summarizeParserDrain,
  toCliParserToolchain,
  toParserToolChecks,
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
  ensureInitialized,
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

function createPollConnector(id: string) {
  return {
    id,
    source: 'test',
    kind: 'poll' as const,
    capabilities: {
      attachments: true,
      backfill: true,
      watch: false,
      webhooks: false,
    },
  }
}

test('shared utility helpers normalize inbox metadata and paths', async () => {
  assert.equal(runtimeNamespaceAccountId({ accountId: null }), null)
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

test('connector helpers instantiate every supported source and reject missing prerequisites', async () => {
  const calls: string[] = []
  const imessageConnector = createPollConnector('imessage:primary')
  const telegramConnector = createPollConnector('telegram:bot')
  const emailConnector = createPollConnector('email:primary')
  const linqConnector = createPollConnector('linq:default')
  const imessageDriver = {
    getMessages: async () => [],
  }
  const telegramDriver = {
    downloadFile: async () => new Uint8Array(),
    getFile: async () => ({}),
    getMe: async () => ({}),
    getMessages: async () => [],
    startWatching: async () => undefined,
  }
  const emailDriver = {
    downloadAttachment: async () => null,
    inboxId: 'inbox-1',
    listUnreadMessages: async () => [],
    markProcessed: async () => undefined,
  }
  let imessageInput: unknown
  let telegramInput: unknown
  let emailInput: unknown
  let linqInput: unknown
  const inboxd = {
    createTelegramPollConnector(input: unknown) {
      calls.push('telegram')
      telegramInput = input
      return telegramConnector
    },
    createEmailPollConnector(input: unknown) {
      calls.push('email')
      emailInput = input
      return emailConnector
    },
    createLinqWebhookConnector(input: unknown) {
      calls.push('linq')
      linqInput = input
      return linqConnector
    },
  }
  const inboxImessage = {
    createImessageConnector(input: unknown) {
      calls.push('imessage')
      imessageInput = input
      return imessageConnector
    },
  }

  const imessage = await instantiateConnector({
    connector: {
      id: 'imessage:primary',
      source: 'imessage',
      enabled: true,
      accountId: null,
      options: {
        includeOwnMessages: false,
      },
    },
    inputLimit: 12,
    async ensureImessageReady() {
      calls.push('imessage-ready')
    },
    async loadInbox() {
      return inboxd as never
    },
    async loadInboxImessage() {
      calls.push('load-imessage-runtime')
      return inboxImessage as never
    },
    async loadImessageDriver() {
      calls.push('load-imessage-driver')
      return imessageDriver as never
    },
    async loadTelegramDriver() {
      throw new Error('unexpected telegram driver load')
    },
    linqWebhookSecret: null,
  })
  assert.equal(imessage, imessageConnector)
  assert.deepEqual(calls.slice(0, 4), [
    'imessage-ready',
    'load-imessage-runtime',
    'load-imessage-driver',
    'imessage',
  ])
  assert.deepEqual(imessageInput, {
    accountId: 'self',
    backfillLimit: 12,
    driver: imessageDriver,
    id: 'imessage:primary',
    includeOwnMessages: false,
  })

  const telegram = await instantiateConnector({
    connector: {
      id: 'telegram:bot',
      source: 'telegram',
      enabled: true,
      accountId: null,
      options: {},
    },
    async loadInbox() {
      return inboxd as never
    },
    async loadImessageDriver() {
      throw new Error('unexpected imessage driver load')
    },
    async loadTelegramDriver() {
      calls.push('load-telegram-driver')
      return telegramDriver as never
    },
    linqWebhookSecret: null,
  })
  assert.equal(telegram, telegramConnector)
  assert.deepEqual(telegramInput, {
    accountId: 'bot',
    backfillLimit: 500,
    downloadAttachments: true,
    driver: telegramDriver,
    id: 'telegram:bot',
    transportMode: 'take-over-webhook',
  })

  const email = await instantiateConnector({
    connector: {
      id: 'email:primary',
      source: 'email',
      enabled: true,
      accountId: 'account-1',
      options: {},
    },
    async loadInbox() {
      return inboxd as never
    },
    async loadImessageDriver() {
      throw new Error('unexpected imessage driver load')
    },
    async loadTelegramDriver() {
      throw new Error('unexpected telegram driver load')
    },
    async loadEmailDriver() {
      calls.push('load-email-driver')
      return emailDriver as never
    },
    linqWebhookSecret: null,
  })
  assert.equal(email, emailConnector)
  assert.deepEqual(emailInput, {
    accountAddress: null,
    accountId: 'account-1',
    backfillLimit: 500,
    driver: emailDriver,
    id: 'email:primary',
  })

  const linq = await instantiateConnector({
    connector: {
      id: 'linq:default',
      source: 'linq',
      enabled: true,
      accountId: 'line-1',
      options: {
        linqWebhookHost: '127.0.0.1',
        linqWebhookPath: '/webhook',
        linqWebhookPort: 9000,
      },
    },
    async loadInbox() {
      return inboxd as never
    },
    async loadImessageDriver() {
      throw new Error('unexpected imessage driver load')
    },
    async loadTelegramDriver() {
      throw new Error('unexpected telegram driver load')
    },
    linqWebhookSecret: '  secret  ',
  })
  assert.equal(linq, linqConnector)
  assert.deepEqual(linqInput, {
    accountId: 'line-1',
    downloadAttachments: true,
    host: '127.0.0.1',
    id: 'linq:default',
    path: '/webhook',
    port: 9000,
    webhookSecret: 'secret',
  })

  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'imessage:missing',
          source: 'imessage',
          enabled: true,
          accountId: null,
          options: {},
        },
        async loadInbox() {
          return inboxd as never
        },
        async loadImessageDriver() {
          return { getMessages: async () => [] } as never
        },
        async loadTelegramDriver() {
          throw new Error('unexpected telegram driver load')
        },
        linqWebhookSecret: null,
      }),
    /loadInboxImessage/,
  )

  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'email:missing',
          source: 'email',
          enabled: true,
          accountId: 'account-1',
          options: {},
        },
        async loadInbox() {
          return inboxd as never
        },
        async loadImessageDriver() {
          return { getMessages: async () => [] } as never
        },
        async loadTelegramDriver() {
          throw new Error('unexpected telegram driver load')
        },
        linqWebhookSecret: null,
      }),
    /loadEmailDriver/,
  )

  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'linq:missing-secret',
          source: 'linq',
          enabled: true,
          accountId: null,
          options: {},
        },
        async loadInbox() {
          return inboxd as never
        },
        async loadImessageDriver() {
          return { getMessages: async () => [] } as never
        },
        async loadTelegramDriver() {
          throw new Error('unexpected telegram driver load')
        },
        linqWebhookSecret: '   ',
      }),
    /Linq webhook secret is required/,
  )

  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'unsupported:primary',
          source: 'unsupported' as never,
          enabled: true,
          accountId: null,
          options: {},
        },
        async loadInbox() {
          return inboxd as never
        },
        async loadImessageDriver() {
          return imessageDriver as never
        },
        async loadTelegramDriver() {
          return telegramDriver as never
        },
        linqWebhookSecret: null,
      }),
    /Unsupported inbox connector source: unsupported/,
  )
})

test('parser helpers build service context, summarize drains, and enforce runtime capabilities', async () => {
  const runtime = createRuntimeStore([
    createCapture({
      attachments: [
        {
          attachmentId: 'attachment-1',
          ordinal: 1,
          externalId: 'attachment-1',
          kind: 'document',
          parseState: 'failed',
          storedPath: 'derived/inbox/capture-1/document.pdf',
        },
      ],
    }),
  ])
  const configuredRegistry = {
    ffmpeg: {
      allowSystemLookup: true,
      commandCandidates: ['ffmpeg'],
    },
    registry: { name: 'registry' },
  }
  const parserService = {
    drain: async () => [],
  }
  const parserModule = {
    async createConfiguredParserRegistry(input: { vaultRoot: string }) {
      assert.equal(input.vaultRoot, '/vault')
      return configuredRegistry
    },
    createInboxParserService(input: {
      ffmpeg?: { allowSystemLookup?: boolean; commandCandidates?: string[] }
      registry: unknown
      runtime: RuntimeStore
      vaultRoot: string
    }) {
      assert.equal(input.vaultRoot, '/vault')
      assert.equal(input.runtime, runtime)
      assert.equal(input.registry, configuredRegistry.registry)
      assert.equal(input.ffmpeg, configuredRegistry.ffmpeg)
      return parserService
    },
  }

  const context = await createParserServiceContext('/vault', runtime, parserModule as never)
  assert.equal(context, parserService)

  assert.deepEqual(
    summarizeParserDrain('/vault', [
      {
        errorCode: undefined,
        errorMessage: undefined,
        job: {
          attachmentId: 'attachment-1',
          captureId: 'capture-1',
        },
        manifestPath: '/vault/derived/inbox/capture-1/manifest.json',
        providerId: 'whisper',
        status: 'succeeded',
      },
      {
        errorCode: 'PARSE_FAILED',
        errorMessage: 'boom',
        job: {
          attachmentId: 'attachment-2',
          captureId: 'capture-2',
        },
        providerId: undefined,
        status: 'failed',
      },
    ]),
    {
      attempted: 2,
      failed: 1,
      results: [
        {
          attachmentId: 'attachment-1',
          captureId: 'capture-1',
          errorCode: null,
          errorMessage: null,
          manifestPath: 'derived/inbox/capture-1/manifest.json',
          providerId: 'whisper',
          status: 'succeeded',
        },
        {
          attachmentId: 'attachment-2',
          captureId: 'capture-2',
          errorCode: 'PARSE_FAILED',
          errorMessage: 'boom',
          manifestPath: null,
          providerId: null,
          status: 'failed',
        },
      ],
      succeeded: 1,
    },
  )

  const doctorTools = {
    ffmpeg: {
      available: true,
      command: '/usr/local/bin/ffmpeg',
      reason: 'found',
      source: 'system' as const,
    },
    pdftotext: {
      available: false,
      command: '/usr/local/bin/pdftotext',
      reason: 'missing dependency',
      source: 'config' as const,
    },
    whisper: {
      available: true,
      command: '/Users/example/bin/whisper',
      modelPath: '/Users/example/models/base.bin',
      reason: 'configured',
      source: 'config' as const,
    },
  }

  assert.doesNotThrow(() =>
    assertBootstrapStrictReady({
      checks: [
        {
          message: 'ok',
          name: 'parser-ffmpeg',
          status: 'pass',
        },
      ],
      configPath: 'inbox/config.json',
      databasePath: 'inbox.sqlite',
      parserToolchain: {
        configPath: '.runtime/operations/parsers/toolchain.json',
        discoveredAt: '2026-04-08T00:00:00.000Z',
        tools: {
          ffmpeg: {
            available: true,
            command: 'ffmpeg',
            reason: 'ok',
            source: 'system',
          },
          pdftotext: {
            available: true,
            command: 'pdftotext',
            reason: 'ok',
            source: 'system',
          },
          whisper: {
            available: true,
            command: 'whisper',
            modelPath: 'models/base.bin',
            reason: 'ok',
            source: 'config',
          },
        },
      },
    } as never),
  )

  assert.throws(
    () =>
      assertBootstrapStrictReady({
        checks: [
          {
            message: 'runtime degraded',
            name: 'parser-runtime',
            status: 'warn',
          },
        ],
        parserToolchain: null,
      } as never),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_BOOTSTRAP_STRICT_FAILED' &&
      Array.isArray(error.context?.unavailableConfiguredTools) &&
      error.context.unavailableConfiguredTools.includes(
        'parser toolchain discovery did not return structured tool status',
      ),
  )

  assert.throws(
    () =>
      assertBootstrapStrictReady({
        checks: [
          {
            message: 'ffmpeg failed',
            name: 'parser-ffmpeg',
            status: 'fail',
          },
        ],
        parserToolchain: {
          configPath: '.runtime/operations/parsers/toolchain.json',
          discoveredAt: '2026-04-08T00:00:00.000Z',
          tools: {
            ffmpeg: {
              available: true,
              command: 'ffmpeg',
              reason: 'ok',
              source: 'system',
            },
            pdftotext: {
              available: false,
              command: 'pdftotext',
              reason: 'not configured',
              source: 'config',
            },
            whisper: {
              available: true,
              command: 'whisper',
              modelPath: null,
              reason: 'ok',
              source: 'system',
            },
          },
        },
      } as never),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_BOOTSTRAP_STRICT_FAILED' &&
      Array.isArray(error.context?.blockingChecks) &&
      error.context.blockingChecks.length === 1,
  )

  assert.deepEqual(
    toCliParserToolchain('/vault', {
      configPath: resolveRuntimePaths('/vault').parserToolchainConfigPath,
      discoveredAt: '2026-04-08T00:00:00.000Z',
      tools: doctorTools,
    }),
    {
      configPath: '.runtime/operations/parsers/toolchain.json',
      discoveredAt: '2026-04-08T00:00:00.000Z',
      tools: {
        ffmpeg: {
          available: true,
          command: '/usr/local/bin/ffmpeg',
          modelPath: undefined,
          reason: 'found',
          source: 'system',
        },
        pdftotext: {
          available: false,
          command: '/usr/local/bin/pdftotext',
          modelPath: undefined,
          reason: 'missing dependency',
          source: 'config',
        },
        whisper: {
          available: true,
          command: '<REDACTED_PATH>',
          modelPath: '<REDACTED_PATH>',
          reason: 'configured',
          source: 'config',
        },
      },
    },
  )

  assert.deepEqual(toParserToolChecks(doctorTools), [
    {
      details: {
        command: '/usr/local/bin/ffmpeg',
        source: 'system',
      },
      message: 'found',
      name: 'parser-ffmpeg',
      status: 'pass',
    },
    {
      details: {
        command: '/usr/local/bin/pdftotext',
        source: 'config',
      },
      message: 'missing dependency',
      name: 'parser-pdftotext',
      status: 'warn',
    },
    {
      details: {
        command: '<REDACTED_PATH>',
        modelPath: '<REDACTED_PATH>',
        source: 'config',
      },
      message: 'configured',
      name: 'parser-whisper',
      status: 'pass',
    },
  ])

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

  assert.equal(
    requireAttachmentParseJobs({ ...runtime, listAttachmentParseJobs }, 'show status'),
    listAttachmentParseJobs,
  )
  assert.equal(
    requireAttachmentReparseSupport({
      ...runtime,
      listAttachmentParseJobs,
      requeueAttachmentParseJobs,
    }).requeueAttachmentParseJobs,
    requeueAttachmentParseJobs,
  )
  assert.throws(
    () => requireAttachmentParseJobs(runtime, 'parse'),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PARSE_UNSUPPORTED' &&
      error.message.includes('parse'),
  )
  assert.throws(
    () =>
      requireAttachmentReparseSupport({
        ...runtime,
        listAttachmentParseJobs,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PARSE_UNSUPPORTED' &&
      error.message.includes('reparse'),
  )

  const status = buildAttachmentParseStatus({
    attachmentId: 'attachment-1',
    captureId: 'capture-1',
    fallbackAttachment: {
      attachmentId: 'attachment-1',
      kind: 'document',
      ordinal: 1,
      parseState: 'pending',
      storedPath: 'derived/inbox/capture-1/fallback.pdf',
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
              kind: 'document',
              ordinal: 1,
              parseState: null,
              storedPath: 'derived/inbox/capture-1/final.pdf',
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

test('state helpers initialize config, sort connectors, and guard namespace conflicts', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-state-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    const createdPaths: string[] = []
    const inboxd = {
      async ensureInboxVault() {},
      async openInboxRuntime() {
        throw new Error('unexpected runtime open')
      },
    }
    await ensureDirectory(paths.runtimeRoot, createdPaths, paths.absoluteVaultRoot)
    await ensureConfigFile(paths, createdPaths)
    const config = await readConfig(paths)
    assert.deepEqual(config, { connectors: [] })
    await ensureConfigFile(paths, createdPaths)
    assert.deepEqual(createdPaths, [
      path.relative(paths.absoluteVaultRoot, paths.runtimeRoot),
      '.runtime/operations/inbox/config.json',
    ])

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

    const ensured = await ensureInitialized(async () => inboxd as never, tempDir)
    assert.equal(ensured.absoluteVaultRoot, paths.absoluteVaultRoot)
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
    const idlePaths = resolveRuntimePaths(await mkdtemp(path.join(os.tmpdir(), 'inbox-services-daemon-idle-')))
    assert.equal(
      (
        await normalizeDaemonState(idlePaths, {
          clock: () => new Date('2026-04-08T00:00:00.000Z'),
          getPid: () => 999,
        })
      ).status,
      'idle',
    )
    await rm(idlePaths.absoluteVaultRoot, { recursive: true, force: true })

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
    await writeDaemonState(paths, staleState)
    assert.equal(
      (
        await normalizeDaemonState(paths, {
          clock: () => new Date('2026-04-08T00:00:00.000Z'),
          getPid: () => 123,
        })
      ).pid,
      123,
    )

    const aliveState = buildDaemonState(paths, {
      status: 'running',
      running: true,
      pid: 456,
    })
    await writeDaemonState(paths, aliveState)
    assert.equal(
      (
        await normalizeDaemonState(paths, {
          clock: () => new Date('2026-04-08T00:00:00.000Z'),
          getPid: () => 999,
          killProcess() {},
        })
      ).pid,
      456,
    )

    const stoppedState = buildDaemonState(paths, {
      status: 'stopped',
      message: 'stopped',
      running: false,
    })
    await writeDaemonState(paths, stoppedState)
    assert.equal(
      (
        await normalizeDaemonState(paths, {
          clock: () => new Date('2026-04-08T00:00:00.000Z'),
          getPid: () => 999,
        })
      ).status,
      'stopped',
    )

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

    const invalidPaths = resolveRuntimePaths(await mkdtemp(path.join(os.tmpdir(), 'inbox-services-invalid-daemon-')))
    await ensureDirectory(path.dirname(invalidPaths.inboxStatePath), [], invalidPaths.absoluteVaultRoot)
    await writeFile(
      invalidPaths.inboxStatePath,
      JSON.stringify({
        schema: 'murph.inbox-daemon-state.v1',
        schemaVersion: 1,
        value: {
          status: 'running',
        },
      }),
      'utf8',
    )
    await assert.rejects(
      () =>
        normalizeDaemonState(invalidPaths, {
          clock: () => new Date(),
          getPid: () => 1,
        }),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'INBOX_STATE_INVALID',
    )
    await rm(invalidPaths.absoluteVaultRoot, { recursive: true, force: true })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('state helpers fail cleanly for missing and invalid config files', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-state-errors-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    const inboxd = {
      async ensureInboxVault() {},
      async openInboxRuntime() {
        throw new Error('unexpected runtime open')
      },
    }

    await assert.rejects(
      () => ensureInitializedWithInbox(inboxd as never, tempDir),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'INBOX_NOT_INITIALIZED',
    )

    await ensureDirectory(path.dirname(paths.inboxConfigPath), [], paths.absoluteVaultRoot)
    await writeFile(
      paths.inboxConfigPath,
      JSON.stringify({
        schema: 'murph.inbox-runtime-config.v1',
        schemaVersion: 1,
        value: {
          connectors: [{ id: 'broken' }],
        },
      }),
      'utf8',
    )
    await assert.rejects(
      () => readConfig(paths),
      (error: unknown) =>
        error instanceof VaultCliError && error.code === 'INBOX_CONFIG_INVALID',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
