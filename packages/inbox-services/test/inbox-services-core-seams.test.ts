import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'

import {
  resolveRuntimePaths,
  tryKillProcess,
  type ProcessIdentity,
} from '@murphai/runtime-state/node'
import * as z from '@murphai/contracts/zod-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { test } from 'vitest'

import type {
  InboxRuntimeModule,
  InboxRuntimeConfig,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../src/index.ts'
import {
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import {
  buildDaemonState,
  createProcessSignalBridge,
  idleState,
  normalizeDaemonState,
  verifyDaemonStateForExpectedOwner,
  writeDaemonState,
} from '../src/inbox-services/daemon.ts'
import { instantiateConnector } from '../src/inbox-services/connectors.ts'
import {
  assertBootstrapStrictReady,
  buildAttachmentParseStatus,
  createParserServiceContext,
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
  summarizeInboxFailure,
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
  readConfigWithReconciliation,
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

function createPollConnector(id: string) {
  return {
    async backfill() {
      return null
    },
    id,
    source: 'test',
    kind: 'poll' as const,
    capabilities: {
      attachments: true,
      backfill: true,
      watch: false,
      webhooks: false,
    },
    async watch() {},
  }
}

test('shared utility helpers normalize inbox metadata and paths', async () => {
  assert.equal(
    runtimeNamespaceAccountId({ source: 'telegram', accountId: null }),
    'bot',
  )
  assert.equal(
    connectorNamespaceKey({ source: 'telegram', accountId: null }),
    'telegram::bot',
  )
  assert.throws(
    () => normalizeConnectorAccountId('unsupported' as never, undefined),
    (error: unknown) => error instanceof VaultCliError && error.code === 'INBOX_SOURCE_UNSUPPORTED',
  )
  assert.equal(normalizeConnectorAccountId('telegram', undefined), 'bot')
  assert.equal(normalizeConnectorAccountId('linq', undefined), 'default')
  assert.equal(normalizeConnectorAccountId('linq', ' account-main '), 'account-main')
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

test('inbox failure summaries preserve domain codes and redact message causes', () => {
  const domainError = Object.assign(
    new VaultCliError(
      'INBOX_DOMAIN_FAILED',
      "domain failed for https://provider.example.test/inboxes/user@example.test "
        + "at '/home/tester/vault/.runtime/state' and file:///private/tmp/inbox/log",
    ),
    {
      cause: new Error(
        'transport failed with api_key=value and 415-555-0100 at C:\\inbox\\state '
          + 'while reading /v2/usercollection/daily_sleep',
      ),
    },
  )

  assert.deepEqual(summarizeInboxFailure(domainError, 'INBOX_FALLBACK_FAILED'), {
    category: 'vault_cli_error',
    code: 'INBOX_DOMAIN_FAILED',
    cause: 'transport failed with api_key=[redacted] and <redacted-phone> '
      + 'at <redacted-path> while reading /v2/usercollection/daily_sleep',
    message: "domain failed for <redacted-url> at '<redacted-path>' and <redacted-path>",
  })

  assert.deepEqual(summarizeInboxFailure('plain failure', 'INBOX_FALLBACK_FAILED'), {
    category: 'non_error_throw',
    code: 'INBOX_FALLBACK_FAILED',
    cause: null,
    message: 'plain failure',
  })
})

test('connector helpers instantiate Telegram and reject non-runtime sources', async () => {
  const telegramConnector = createPollConnector('telegram:bot')
  const telegramDriver = {
    downloadFile: async () => new Uint8Array(),
    getFile: async () => ({}),
    getMe: async () => ({}),
    getMessages: async () => [],
    startWatching: async () => undefined,
  }
  let telegramInput: unknown
  const inboxd = {
    createTelegramPollConnector(input: unknown) {
      telegramInput = input
      return telegramConnector
    },
  }

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
    async loadTelegramDriver() {
      return telegramDriver as never
    },
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

  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'linq:primary',
          source: 'linq',
          enabled: true,
          accountId: null,
          options: {},
        },
        async loadInbox() {
          return inboxd as never
        },
        async loadTelegramDriver() {
          throw new Error('unexpected Telegram driver load')
        },
      }),
    /Unsupported inbox connector source: linq/u,
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
        async loadTelegramDriver() {
          return telegramDriver as never
        },
      }),
    /Unsupported inbox connector source: unsupported/u,
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
        resultPath: '/vault/derived/inbox/capture-1/result.json',
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
          resultPath: 'derived/inbox/capture-1/result.json',
          providerId: 'whisper',
          status: 'succeeded',
        },
        {
          attachmentId: 'attachment-2',
          captureId: 'capture-2',
          errorCode: 'PARSE_FAILED',
          errorMessage: 'boom',
          resultPath: null,
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
          id: 'linq:primary',
          source: 'linq',
          enabled: true,
          accountId: 'line-1',
          options: {},
        },
      ],
    }
    sortConnectors(updatedConfig)
    assert.deepEqual(updatedConfig.connectors.map((connector) => connector.id), [
      'linq:primary',
      'telegram:bot',
    ])
    await writeConfig(paths, updatedConfig)
    assert.equal(findConnector(updatedConfig, 'linq:primary')?.source, 'linq')
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
          id: 'linq:dupe',
          source: 'linq',
          enabled: true,
          accountId: 'line-1',
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

test('readConfig rejects unsupported connector sources in the stored config', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-state-invalid-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    await ensureDirectory(
      path.dirname(paths.inboxConfigPath),
      [],
      paths.absoluteVaultRoot,
    )
    await writeFile(
      paths.inboxConfigPath,
      JSON.stringify({
        schema: 'murph.inbox-runtime-config.v1',
        schemaVersion: 1,
        value: {
          connectors: [
            {
              id: 'legacy:self',
              source: 'legacy',
              enabled: true,
              accountId: 'self',
              options: {},
            },
            {
              id: 'telegram:bot',
              source: 'telegram',
              enabled: true,
              accountId: 'bot',
              options: {},
            },
          ],
        },
      }),
      'utf8',
    )

    await assert.rejects(
      () => readConfig(paths),
      (error: unknown) =>
        error instanceof VaultCliError &&
        error.code === 'INBOX_CONFIG_INVALID',
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('readConfig removes prior local email sources while preserving supported connectors exactly once', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-state-upgrade-'))
  try {
    const paths = resolveRuntimePaths(tempDir)
    await ensureDirectory(
      path.dirname(paths.inboxConfigPath),
      [],
      paths.absoluteVaultRoot,
    )
    await writeFile(
      paths.inboxConfigPath,
      JSON.stringify({
        schema: 'murph.inbox-runtime-config.v1',
        schemaVersion: 1,
        value: {
          connectors: [
            {
              id: 'email:primary',
              source: 'email',
              enabled: true,
              accountId: 'primary@example.test',
              options: { emailAddress: 'primary@example.test' },
            },
            {
              id: 'email:disabled',
              source: 'email',
              enabled: false,
              accountId: 'disabled@example.test',
              options: { emailAddress: 'disabled@example.test' },
            },
            {
              id: 'telegram:bot',
              source: 'telegram',
              enabled: true,
              accountId: 'bot',
              options: { backfillLimit: 25 },
            },
          ],
        },
      }),
      'utf8',
    )

    const first = await readConfigWithReconciliation(paths)
    assert.equal(first.removedLegacyEmailConnectorCount, 2)
    assert.deepEqual(first.config, {
      connectors: [
        {
          id: 'telegram:bot',
          source: 'telegram',
          enabled: true,
          accountId: 'bot',
          options: { backfillLimit: 25 },
        },
      ],
    })
    const afterFirstRead = await readFile(paths.inboxConfigPath, 'utf8')
    assert.equal(JSON.parse(afterFirstRead).schemaVersion, 2)

    const second = await readConfigWithReconciliation(paths)
    assert.equal(second.removedLegacyEmailConnectorCount, 0)
    assert.deepEqual(second.config, first.config)
    assert.equal(await readFile(paths.inboxConfigPath, 'utf8'), afterFirstRead)
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
    let rebuildEnqueueParserJobs: boolean | null = null
    const normalizedConfig = await readConfig(paths)
    assert.equal(normalizedConfig.connectors[0]?.accountId, 'bot')
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
        accountId: 'bot',
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
      connectorIds: ['telegram:primary'],
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

    const aliveIdentity: ProcessIdentity = {
      pid: 456,
      platform: 'linux',
      startToken: 'linux-proc-start:456',
    }
    const aliveState = buildDaemonState(paths, {
      status: 'running',
      running: true,
      pid: 456,
    })
    await writeDaemonState(paths, aliveState, {
      processIdentity: aliveIdentity,
    })
    const aliveNormalized = await normalizeDaemonState(paths, {
      clock: () => new Date('2026-04-08T00:00:00.000Z'),
      getPid: () => 999,
      killProcess() {},
    })
    assert.equal(aliveNormalized.pid, 456)
    assert.equal('processIdentity' in aliveNormalized, false)
    const aliveOwner = await verifyDaemonStateForExpectedOwner(paths, aliveNormalized, {
      clock: () => new Date('2026-04-08T00:00:00.000Z'),
      getPid: () => 999,
      killProcess() {},
      async matchProcessIdentity(pid, expected) {
        assert.equal(pid, 456)
        assert.deepEqual(expected, aliveIdentity)
        return { matches: true, reason: 'matched' }
      },
    })
    assert.equal(aliveOwner.verified, true)
    assert.equal(aliveOwner.state.pid, 456)

    const changedGeneration = buildDaemonState(paths, {
      status: 'running',
      running: true,
      pid: 456,
      startedAt: '2026-04-08T00:01:00.000Z',
    })
    await writeDaemonState(paths, changedGeneration, {
      processIdentity: aliveIdentity,
    })
    const expectedOwnerMismatch = await verifyDaemonStateForExpectedOwner(
      paths,
      aliveNormalized,
      {
        clock: () => new Date('2026-04-08T00:00:00.000Z'),
        getPid: () => 999,
        killProcess() {},
        async matchProcessIdentity() {
          return { matches: true, reason: 'matched' }
        },
      },
    )
    assert.equal(expectedOwnerMismatch.verified, false)
    assert.equal(expectedOwnerMismatch.reason, 'owner-changed')
    assert.equal(expectedOwnerMismatch.state.status, 'running')

    const mismatchedState = buildDaemonState(paths, {
      status: 'running',
      running: true,
      pid: 789,
    })
    await writeDaemonState(paths, mismatchedState, {
      processIdentity: {
        pid: 789,
        platform: 'linux',
        startToken: 'linux-proc-start:old',
      },
    })
    const mismatchedNormalized = await normalizeDaemonState(paths, {
      clock: () => new Date('2026-04-08T00:00:00.000Z'),
      getPid: () => 999,
      killProcess() {},
    })
    assert.equal(mismatchedNormalized.status, 'running')
    const mismatched = await verifyDaemonStateForExpectedOwner(
      paths,
      mismatchedNormalized,
      {
        clock: () => new Date('2026-04-08T00:00:00.000Z'),
        getPid: () => 999,
        killProcess() {},
        async matchProcessIdentity() {
          return { matches: false, reason: 'mismatched' }
        },
      },
    )
    assert.equal(mismatched.verified, false)
    assert.equal(mismatched.reason, 'identity-mismatched')
    assert.equal(mismatched.state.status, 'running')

    await writeDaemonState(paths, mismatchedState, {
      processIdentity: {
        pid: 789,
        platform: 'linux',
        startToken: 'linux-proc-start:old',
      },
    })
    const currentPidMismatch = await verifyDaemonStateForExpectedOwner(
      paths,
      mismatchedState,
      {
        clock: () => new Date('2026-04-08T00:00:00.000Z'),
        getPid: () => 789,
        killProcess() {},
        async matchProcessIdentity() {
          return { matches: false, reason: 'mismatched' }
        },
      },
    )
    assert.equal(currentPidMismatch.verified, false)
    assert.equal(currentPidMismatch.reason, 'identity-mismatched')
    assert.equal(currentPidMismatch.state.status, 'running')

    const unverifiableState = buildDaemonState(paths, {
      status: 'running',
      running: true,
      pid: 790,
    })
    await writeDaemonState(paths, unverifiableState)
    const unverifiableNormalized = await normalizeDaemonState(paths, {
      clock: () => new Date('2026-04-08T00:00:00.000Z'),
      getPid: () => 999,
      killProcess() {},
    })
    assert.equal(unverifiableNormalized.status, 'running')
    const unverifiable = await verifyDaemonStateForExpectedOwner(
      paths,
      unverifiableNormalized,
      {
        clock: () => new Date('2026-04-08T00:00:00.000Z'),
        getPid: () => 999,
        killProcess() {},
      },
    )
    assert.equal(unverifiable.verified, false)
    assert.equal(unverifiable.reason, 'identity-unverifiable')
    assert.equal(unverifiable.state.status, 'running')

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
