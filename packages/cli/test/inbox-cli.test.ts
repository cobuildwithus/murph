import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  openSqliteRuntimeDatabase,
  resolveRuntimePaths,
} from '@healthybob/runtime-state'
import { createIntegratedInboxCliServices } from '../src/inbox-services.js'
import { createVaultCli } from '../src/vault-cli.js'
import { createUnwiredVaultCliServices } from '../src/vault-cli-services.js'
import { requireData, type CliEnvelope } from './cli-test-helpers.js'

const builtCoreRuntimeUrl = new URL('../../core/dist/index.js', import.meta.url).href
const builtInboxRuntimeUrl = new URL('../../inboxd/dist/index.js', import.meta.url).href
const builtImportersRuntimeUrl = new URL('../../importers/dist/index.js', import.meta.url).href
const builtParsersRuntimeUrl = new URL('../../parsers/dist/index.js', import.meta.url).href

async function makeVaultFixture(prefix: string): Promise<{
  homeRoot: string
  photoPath: string
  vaultRoot: string
}> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), `${prefix}-vault-`))
  const homeRoot = await mkdtemp(path.join(tmpdir(), `${prefix}-home-`))
  const photoPath = path.join(vaultRoot, 'meal-photo.jpg')
  const messagesDbPath = path.join(homeRoot, 'Library', 'Messages', 'chat.db')

  const coreRuntime = await loadBuiltCoreRuntime()
  await coreRuntime.initializeVault({
    vaultRoot,
    createdAt: '2026-03-13T12:00:00.000Z',
  })
  await writeFile(photoPath, 'photo', 'utf8')
  const messagesDb = openSqliteRuntimeDatabase(messagesDbPath, {
    create: true,
    foreignKeys: false,
  })
  messagesDb.close()

  return {
    homeRoot,
    photoPath,
    vaultRoot,
  }
}

async function loadBuiltCoreRuntime() {
  return (await import(builtCoreRuntimeUrl)) as {
    initializeVault(input: {
      vaultRoot: string
      createdAt: string
    }): Promise<void>
    addMeal(input: {
      vaultRoot: string
      occurredAt?: string
      note?: string
      photoPath?: string
      audioPath?: string
      source?: string
    }): Promise<{
      mealId: string
      event: {
        id: string
      }
      manifestPath: string
    }>
  }
}

async function loadBuiltInboxRuntime() {
  return (await import(builtInboxRuntimeUrl)) as any
}

async function loadBuiltImportersRuntime() {
  return (await import(builtImportersRuntimeUrl)) as any
}

async function loadBuiltParsersRuntime() {
  return (await import(builtParsersRuntimeUrl)) as any
}

function inboxPaths(vaultRoot: string) {
  return resolveRuntimePaths(vaultRoot)
}

async function listMealManifestPaths(vaultRoot: string): Promise<string[]> {
  return listNamedFiles(path.join(vaultRoot, 'raw', 'meals'), 'manifest.json')
}

async function listDocumentManifestPaths(vaultRoot: string): Promise<string[]> {
  return listNamedFiles(path.join(vaultRoot, 'raw', 'documents'), 'manifest.json')
}

async function listNamedFiles(root: string, name: string): Promise<string[]> {
  try {
    const matches: string[] = []
    const stack = [root]

    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) {
        continue
      }

      for (const entry of await readdir(current, { withFileTypes: true })) {
        const absolutePath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(absolutePath)
          continue
        }
        if (entry.isFile() && entry.name === name) {
          matches.push(absolutePath)
        }
      }
    }

    return matches.sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function createFakeInboxRuntimeModule(input?: {
  onCreateImessageConnector?(options: {
    id?: string
    accountId?: string | null
    includeOwnMessages?: boolean
    backfillLimit?: number
  }): void
  onRunInboxDaemon?(payload: {
    connectors: Array<{
      id: string
      source: string
      accountId?: string | null
    }>
    runtime: {
      getCursor(source: string, accountId?: string | null): Record<string, unknown> | null
      setCursor(
        source: string,
        accountId: string | null | undefined,
        cursor: Record<string, unknown> | null,
      ): void
    }
    signal: AbortSignal
  }): Promise<void> | void
  rebuiltCaptureCount?: number
}): any {
  const cursorStore = new Map<string, Record<string, unknown> | null>()
  const runtime = {
    close() {},
    getCursor(source: string, accountId?: string | null) {
      return cursorStore.get(`${source}::${accountId ?? 'default'}`) ?? null
    },
    setCursor(
      source: string,
      accountId: string | null | undefined,
      cursor: Record<string, unknown> | null,
    ) {
      cursorStore.set(`${source}::${accountId ?? 'default'}`, cursor)
    },
    listCaptures(filters?: { limit?: number }) {
      const total = input?.rebuiltCaptureCount ?? 0
      const limit = filters?.limit ?? total
      return Array.from({ length: Math.min(limit, total) }, (_, index) => ({
        captureId: `cap-${index}`,
        eventId: `evt-${index}`,
        source: 'imessage',
        externalId: `ext-${index}`,
        accountId: 'self',
        thread: { id: 'thread-1', title: 'Thread', isDirect: true },
        actor: { id: 'actor-1', displayName: 'Actor', isSelf: false },
        occurredAt: '2026-03-13T08:00:00.000Z',
        receivedAt: '2026-03-13T08:00:01.000Z',
        text: `Capture ${index}`,
        attachments: [],
        raw: {},
        envelopePath: `raw/inbox/imessage/self/${index}.json`,
        createdAt: '2026-03-13T08:00:02.000Z',
      }))
    },
    searchCaptures() {
      return []
    },
    getCapture() {
      return null
    },
  }

  return {
    async ensureInboxVault() {},
    async openInboxRuntime() {
      return runtime
    },
    async createInboxPipeline() {
      return {
        runtime,
        async processCapture() {
          return { deduped: false }
        },
        close() {},
      }
    },
    createImessageConnector(options: {
      id?: string
      accountId?: string | null
      includeOwnMessages?: boolean
      backfillLimit?: number
    }) {
      input?.onCreateImessageConnector?.(options)
      return {
        id: options.id ?? 'imessage:self',
        source: 'imessage',
        accountId: options.accountId ?? null,
        kind: 'poll' as const,
        capabilities: {
          attachments: true,
          backfill: true,
          ownMessages: options.includeOwnMessages,
          watch: true,
          webhooks: false,
        },
        async backfill() {
          return null
        },
        async watch() {},
        async close() {},
      }
    },
    async loadImessageKitDriver() {
      return createFakeImessageDriver({ photoPath: '' })
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon(payload: {
      pipeline: {
        runtime: typeof runtime
      }
      connectors: Array<{
        id: string
        source: string
        accountId?: string | null
      }>
      signal: AbortSignal
    }) {
      await input?.onRunInboxDaemon?.({
        connectors: payload.connectors,
        runtime: payload.pipeline.runtime,
        signal: payload.signal,
      })
    },
  }
}

function createFakeParsersRuntimeModule(input?: {
  discoveredAt?: string
  drainResults?: Array<{
    attachmentId: string
    captureId: string
    errorCode?: string
    errorMessage?: string
    manifestPath?: string
    providerId?: string
    status: 'failed' | 'succeeded'
  }>
  onDrain?(payload: {
    attachmentId?: string
    captureId?: string
    maxJobs?: number
    vaultRoot: string
  }): void
  onWrite?(payload: {
    tools?: Record<string, {
      command?: string | null
      modelPath?: string | null
    }>
    vaultRoot: string
  }): void
  onRunInboxDaemonWithParsers?(payload: {
    connectors: Array<{
      accountId?: string | null
      id: string
      source: string
    }>
    runtime: {
      getCursor(source: string, accountId?: string | null): Record<string, unknown> | null
      setCursor(
        source: string,
        accountId: string | null | undefined,
        cursor: Record<string, unknown> | null,
      ): void
    }
    signal: AbortSignal
    vaultRoot: string
  }): Promise<void> | void
}) {
  const discoveredAt = input?.discoveredAt ?? '2026-03-13T12:34:56.000Z'
  const toolchainByVault = new Map<
    string,
    {
      ffmpeg: {
        available: boolean
        command: string | null
        reason: string
        source: 'config' | 'env' | 'system' | 'missing'
      }
      pdftotext: {
        available: boolean
        command: string | null
        reason: string
        source: 'config' | 'env' | 'system' | 'missing'
      }
      whisper: {
        available: boolean
        command: string | null
        modelPath: string | null
        reason: string
        source: 'config' | 'env' | 'system' | 'missing'
      }
      paddleocr: {
        available: boolean
        command: string | null
        reason: string
        source: 'config' | 'env' | 'system' | 'missing'
      }
    }
  >()

  function getDoctor(vaultRoot: string) {
    const runtimePaths = resolveRuntimePaths(vaultRoot)
    const tools =
      toolchainByVault.get(vaultRoot) ?? {
        ffmpeg: {
          available: true,
          command: '/usr/bin/ffmpeg',
          reason: 'ffmpeg CLI available.',
          source: 'system' as const,
        },
        pdftotext: {
          available: false,
          command: null,
          reason: 'pdftotext CLI not found.',
          source: 'missing' as const,
        },
        whisper: {
          available: false,
          command: null,
          modelPath: null,
          reason: 'Whisper model path is not configured.',
          source: 'missing' as const,
        },
        paddleocr: {
          available: false,
          command: null,
          reason: 'PaddleOCR CLI not found.',
          source: 'missing' as const,
        },
      }

    return {
      configPath: path.join(runtimePaths.runtimeRoot, 'parsers', 'toolchain.json'),
      discoveredAt,
      tools,
    }
  }

  return {
    async createConfiguredParserRegistry(inputPayload: { vaultRoot: string }) {
      return {
        doctor: getDoctor(inputPayload.vaultRoot),
        registry: {},
        ffmpeg: {
          commandCandidates: ['/usr/bin/ffmpeg'],
        },
      }
    },
    createInboxParserService(serviceInput: { vaultRoot: string }) {
      return {
        async drain(drainInput?: {
          attachmentId?: string
          captureId?: string
          maxJobs?: number
        }) {
          input?.onDrain?.({
            vaultRoot: serviceInput.vaultRoot,
            ...(drainInput?.attachmentId
              ? {
                  attachmentId: drainInput.attachmentId,
                }
              : {}),
            ...(drainInput?.captureId
              ? {
                  captureId: drainInput.captureId,
                }
              : {}),
            ...(typeof drainInput?.maxJobs === 'number'
              ? {
                  maxJobs: drainInput.maxJobs,
                }
              : {}),
          })

          if (input?.drainResults) {
            return input.drainResults.map((result) => ({
              status: result.status,
              job: {
                attachmentId: result.attachmentId,
                captureId: result.captureId,
              },
              providerId: result.providerId,
              manifestPath:
                result.manifestPath ??
                path.join(
                  serviceInput.vaultRoot,
                  'derived',
                  'inbox',
                  result.captureId,
                  'attachments',
                  result.attachmentId,
                  'manifest.json',
                ),
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
            }))
          }

          return []
        },
      }
    },
    async runInboxDaemonWithParsers(payload: {
      connectors: Array<{
        accountId?: string | null
        id: string
        source: string
      }>
      runtime: {
        getCursor(source: string, accountId?: string | null): Record<string, unknown> | null
        setCursor(
          source: string,
          accountId: string | null | undefined,
          cursor: Record<string, unknown> | null,
        ): void
        close(): void
      }
      signal: AbortSignal
      vaultRoot: string
    }) {
      try {
        await input?.onRunInboxDaemonWithParsers?.({
          connectors: payload.connectors,
          runtime: payload.runtime,
          signal: payload.signal,
          vaultRoot: payload.vaultRoot,
        })
      } finally {
        payload.runtime.close()
      }
    },
    async discoverParserToolchain(inputPayload: { vaultRoot: string }) {
      return getDoctor(inputPayload.vaultRoot)
    },
    async writeParserToolchainConfig(inputPayload: {
      tools?: Record<string, {
        command?: string | null
        modelPath?: string | null
      }>
      vaultRoot: string
    }) {
      input?.onWrite?.(inputPayload)
      const current = getDoctor(inputPayload.vaultRoot).tools
      const next = {
        ...current,
        ffmpeg: {
          ...current.ffmpeg,
          ...(inputPayload.tools?.ffmpeg?.command
            ? {
                available: true,
                command: inputPayload.tools.ffmpeg.command,
                reason: 'ffmpeg CLI available.',
                source: 'config' as const,
              }
            : {}),
        },
        pdftotext: {
          ...current.pdftotext,
          ...(inputPayload.tools?.pdftotext?.command
            ? {
                available: true,
                command: inputPayload.tools.pdftotext.command,
                reason: 'pdftotext CLI available.',
                source: 'config' as const,
              }
            : {}),
        },
        whisper: {
          ...current.whisper,
          ...(inputPayload.tools?.whisper?.command
            ? {
                command: inputPayload.tools.whisper.command,
              }
            : {}),
          ...(inputPayload.tools?.whisper?.modelPath
            ? {
                modelPath: inputPayload.tools.whisper.modelPath,
              }
            : {}),
        },
        paddleocr: {
          ...current.paddleocr,
          ...(inputPayload.tools?.paddleocr?.command
            ? {
                available: true,
                command: inputPayload.tools.paddleocr.command,
                reason: 'PaddleOCR CLI available.',
                source: 'config' as const,
              }
            : {}),
        },
      }

      if (next.whisper.command && next.whisper.modelPath) {
        next.whisper = {
          ...next.whisper,
          available: true,
          reason: 'whisper.cpp CLI and model path configured.',
          source: 'config',
        }
      }

      toolchainByVault.set(inputPayload.vaultRoot, next)

      return {
        config: {
          updatedAt: discoveredAt,
        },
        configPath: getDoctor(inputPayload.vaultRoot).configPath,
      }
    },
  }
}

async function expectVaultCliError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error) => {
    if (!error || typeof error !== 'object') {
      return false
    }
    assert.equal('code' in error, true)
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

async function initializeImessageSource(input: {
  services: ReturnType<typeof createIntegratedInboxCliServices>
  vaultRoot: string
  includeOwn?: boolean
  backfillLimit?: number
}) {
  await input.services.init({
    vault: input.vaultRoot,
    requestId: null,
  })
  await input.services.sourceAdd({
    vault: input.vaultRoot,
    requestId: null,
    source: 'imessage',
    id: 'imessage:self',
    account: 'self',
    includeOwn: input.includeOwn ?? true,
    backfillLimit: input.backfillLimit,
  })
}

async function captureSingleCaptureId(input: {
  services: ReturnType<typeof createIntegratedInboxCliServices>
  vaultRoot: string
}) {
  const listed = await input.services.list({
    vault: input.vaultRoot,
    requestId: null,
    limit: 10,
  })
  const captureId = listed.items[0]?.captureId
  assert.ok(captureId)
  return captureId
}

async function readJsonFile<T>(absolutePath: string): Promise<T> {
  return JSON.parse(await readFile(absolutePath, 'utf8')) as T
}

async function writeExecutableFile(
  directory: string,
  fileName: string,
  content: string,
): Promise<string> {
  const filePath = path.join(directory, fileName)
  await writeFile(filePath, content, 'utf8')
  await chmod(filePath, 0o755)
  return filePath
}

async function runInProcessInboxCli<TData>(
  args: string[],
  inboxServices: ReturnType<typeof createIntegratedInboxCliServices>,
): Promise<CliEnvelope<TData>> {
  const cli = createVaultCli(createUnwiredVaultCliServices(), inboxServices)
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

function createFakeImessageDriver(input: {
  photoPath: string
  attachments?: Array<{
    guid: string
    fileName: string
    path: string
    mimeType: string
  }>
  listChatsResult?: unknown[]
  messages?: Record<string, unknown>[]
  onGetMessages?: (options?: { limit?: number; cursor?: Record<string, unknown> | null }) => void
  watchDelayMs?: number
}) {
  return {
    async listChats() {
      return (
        input.listChatsResult ?? [
          { guid: 'chat-1', displayName: 'Breakfast', participantCount: 2 },
        ]
      )
    },
    async getMessages(options?: { limit?: number }) {
      input.onGetMessages?.(options)
      const messages = input.messages ?? [
        {
          guid: 'im-1',
          text: 'Toast and eggs',
          date: '2026-03-13T08:00:00.000Z',
          dateRead: '2026-03-13T08:00:10.000Z',
          chatGuid: 'chat-1',
          handleId: 'friend',
          displayName: 'Friend',
          isFromMe: false,
          attachments: input.attachments ?? [
            {
              guid: 'att-1',
              fileName: 'toast.jpg',
              path: input.photoPath,
              mimeType: 'image/jpeg',
            },
          ],
        },
      ]

      return typeof options?.limit === 'number'
        ? messages.slice(0, options.limit)
        : messages
    },
    async startWatching(options: {
      onMessage(message: Record<string, unknown>): Promise<void> | void
    }) {
      const timer = setTimeout(() => {
        void options.onMessage({
          guid: 'im-2',
          text: 'Watching toast',
          date: '2026-03-13T08:10:00.000Z',
          chatGuid: 'chat-1',
          handleId: 'self',
          displayName: 'Self',
          isFromMe: true,
        })
      }, input.watchDelayMs ?? 25)

      return {
        close() {
          clearTimeout(timer)
        },
      }
    },
  }
}

test.sequential(
  'inbox services cover init, source config, doctor, backfill, list/show/search, and meal promotion',
  async () => {
    const fixture = await makeVaultFixture('healthybob-inbox-cli')
    const driver = createFakeImessageDriver({ photoPath: fixture.photoPath })
    const services = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () => driver,
    })

    try {
      const initResult = await services.init({
        vault: fixture.vaultRoot,
        requestId: null,
      })
      assert.equal(initResult.createdPaths.includes('.runtime/inboxd.sqlite'), true)
      assert.equal(initResult.createdPaths.includes('.runtime/inboxd/config.json'), true)

      const addResult = await services.sourceAdd({
        vault: fixture.vaultRoot,
        requestId: null,
        source: 'imessage',
        id: 'imessage:self',
        account: 'self',
        includeOwn: true,
        backfillLimit: 25,
      })
      assert.equal(addResult.connector.id, 'imessage:self')
      assert.equal(addResult.connector.options.backfillLimit, 25)

      const listSources = await services.sourceList({
        vault: fixture.vaultRoot,
        requestId: null,
      })
      assert.equal(listSources.connectors.length, 1)

      const doctorResult = await services.doctor({
        vault: fixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
      })
      assert.equal(doctorResult.ok, true)
      assert.equal(
        doctorResult.checks.some(
          (check) => check.name === 'messages-db' && check.status === 'pass',
        ),
        true,
      )
      assert.equal(
        doctorResult.checks.some(
          (check) => check.name === 'probe' && check.status === 'pass',
        ),
        true,
      )

      const backfillResult = await services.backfill({
        vault: fixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
      })
      assert.equal(backfillResult.importedCount, 1)
      assert.equal(backfillResult.dedupedCount, 0)

      const inboxList = await services.list({
        vault: fixture.vaultRoot,
        requestId: null,
        limit: 10,
      })
      assert.equal(inboxList.items.length, 1)
      assert.equal(inboxList.items[0]?.attachmentCount, 1)

      const captureId = inboxList.items[0]?.captureId
      assert.ok(captureId)

      const showResult = await services.show({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      })
      assert.equal(showResult.capture.text, 'Toast and eggs')
      assert.equal(showResult.capture.attachments[0]?.storedPath?.includes('raw/inbox/'), true)
      assert.equal('raw' in showResult.capture, false)

      const searchResult = await services.search({
        vault: fixture.vaultRoot,
        requestId: null,
        text: 'toast',
      })
      assert.equal(searchResult.hits.length, 1)
      assert.equal(searchResult.hits[0]?.captureId, captureId)

      const promoteResult = await services.promoteMeal({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      })
      assert.equal(promoteResult.created, true)
      assert.match(promoteResult.lookupId, /^evt_/u)
      assert.match(promoteResult.relatedId, /^meal_/u)

      const repeatPromotion = await services.promoteMeal({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      })
      assert.equal(repeatPromotion.created, false)
      assert.equal(repeatPromotion.lookupId, promoteResult.lookupId)

      const promotedShow = await services.show({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      })
      assert.equal(promotedShow.capture.promotions.length, 1)
      assert.equal(promotedShow.capture.promotions[0]?.target, 'meal')
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'vault-cli inbox init/source/doctor/remove emit contract-shaped envelopes',
  async () => {
    const fixture = await makeVaultFixture('healthybob-inbox-command-envelope')
    const services = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
    })

    try {
      const initResult = requireData(
        await runInProcessInboxCli<{
          runtimeDirectory: string
          databasePath: string
          configPath: string
          createdPaths: string[]
          rebuiltCaptures: number
        }>(['inbox', 'init', '--vault', fixture.vaultRoot], services),
      )
      assert.equal(initResult.runtimeDirectory, '.runtime/inboxd')
      assert.equal(initResult.databasePath, '.runtime/inboxd.sqlite')
      assert.equal(initResult.configPath, '.runtime/inboxd/config.json')
      assert.equal(initResult.createdPaths.includes('.runtime/inboxd.sqlite'), true)
      assert.equal(initResult.createdPaths.includes('.runtime/inboxd/config.json'), true)
      assert.equal(initResult.rebuiltCaptures, 0)

      const added = requireData(
        await runInProcessInboxCli<{
          connector: {
            id: string
            source: string
            enabled: boolean
            accountId: string | null
            options: {
              backfillLimit?: number
            }
          }
          connectorCount: number
          configPath: string
        }>([
          'inbox',
          'source',
          'add',
          'imessage',
          '--vault',
          fixture.vaultRoot,
          '--id',
          'imessage:self',
          '--backfillLimit',
          '25',
        ], services),
      )
      assert.equal(added.configPath, '.runtime/inboxd/config.json')
      assert.equal(added.connector.id, 'imessage:self')
      assert.equal(added.connector.source, 'imessage')
      assert.equal(added.connector.enabled, true)
      assert.equal(added.connector.accountId, 'self')
      assert.equal(added.connector.options.backfillLimit, 25)
      assert.equal(added.connectorCount, 1)

      const listed = requireData(
        await runInProcessInboxCli<{
          configPath: string
          connectors: Array<{
            id: string
            source: string
            accountId: string | null
          }>
        }>(['inbox', 'source', 'list', '--vault', fixture.vaultRoot], services),
      )
      assert.equal(listed.configPath, '.runtime/inboxd/config.json')
      assert.equal(listed.connectors.length, 1)
      assert.equal(listed.connectors[0]?.id, 'imessage:self')

      const doctor = requireData(
        await runInProcessInboxCli<{
          ok: boolean
          target: string | null
          configPath: string | null
          databasePath: string | null
          checks: Array<{
            name: string
            status: string
          }>
          connectors: Array<{
            id: string
          }>
        }>(['inbox', 'doctor', '--vault', fixture.vaultRoot], services),
      )
      assert.equal(doctor.ok, true)
      assert.equal(doctor.target, null)
      assert.equal(doctor.configPath, '.runtime/inboxd/config.json')
      assert.equal(doctor.databasePath, '.runtime/inboxd.sqlite')
      assert.equal(
        doctor.checks.some(
          (check) => check.name === 'connectors' && check.status === 'pass',
        ),
        true,
      )
      assert.equal(doctor.connectors[0]?.id, 'imessage:self')

      const removed = requireData(
        await runInProcessInboxCli<{
          removed: boolean
          connectorId: string
          connectorCount: number
          configPath: string
        }>([
          'inbox',
          'source',
          'remove',
          'imessage:self',
          '--vault',
          fixture.vaultRoot,
        ], services),
      )
      assert.equal(removed.removed, true)
      assert.equal(removed.connectorId, 'imessage:self')
      assert.equal(removed.connectorCount, 0)
      assert.equal(removed.configPath, '.runtime/inboxd/config.json')

      const config = await readJsonFile<{
        version: number
        connectors: unknown[]
      }>(inboxPaths(fixture.vaultRoot).inboxConfigPath)
      assert.equal(config.version, 1)
      assert.deepEqual(config.connectors, [])
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'vault-cli inbox bootstrap composes init and setup without cross-wiring options',
  async () => {
    const fixture = await makeVaultFixture('healthybob-inbox-bootstrap-command')
    const writes: Array<{
      tools?: Record<string, {
        command?: string | null
        modelPath?: string | null
      }>
      vaultRoot: string
    }> = []
    const services = createIntegratedInboxCliServices({
      loadInboxModule: async () =>
        createFakeInboxRuntimeModule({
          rebuiltCaptureCount: 257,
        }),
      loadParsersModule: async () =>
        createFakeParsersRuntimeModule({
          onWrite(payload) {
            writes.push(payload)
          },
        }),
    })

    try {
      const bootstrapResult = requireData(
        await runInProcessInboxCli<{
          init: {
            runtimeDirectory: string
            databasePath: string
            configPath: string
            createdPaths: string[]
            rebuiltCaptures: number
          }
          setup: {
            configPath: string
            updatedAt: string
            tools: {
              whisper: {
                available: boolean
                command: string | null
                modelPath: string | null
              }
              paddleocr: {
                available: boolean
                command: string | null
              }
            }
          }
          doctor: {
            ok: boolean
            checks: Array<{
              name: string
              status: string
            }>
          }
        }>([
          'inbox',
          'bootstrap',
          '--vault',
          fixture.vaultRoot,
          '--rebuild',
          '--whisperCommand',
          '/opt/whisper-cli',
          '--whisperModelPath',
          './models/ggml-base.en.bin',
          '--paddleocrCommand',
          'paddleocr',
        ], services),
      )

      assert.equal(bootstrapResult.init.runtimeDirectory, '.runtime/inboxd')
      assert.equal(bootstrapResult.init.databasePath, '.runtime/inboxd.sqlite')
      assert.equal(bootstrapResult.init.configPath, '.runtime/inboxd/config.json')
      assert.equal(
        bootstrapResult.init.createdPaths.includes('.runtime/inboxd/config.json'),
        true,
      )
      assert.equal(bootstrapResult.init.rebuiltCaptures, 257)
      assert.equal(bootstrapResult.setup.configPath, '.runtime/parsers/toolchain.json')
      assert.equal(bootstrapResult.setup.tools.whisper.available, true)
      assert.equal(bootstrapResult.setup.tools.whisper.command, '/opt/whisper-cli')
      assert.equal(
        bootstrapResult.setup.tools.whisper.modelPath,
        './models/ggml-base.en.bin',
      )
      assert.equal(bootstrapResult.setup.tools.paddleocr.available, true)
      assert.equal(bootstrapResult.setup.tools.paddleocr.command, 'paddleocr')
      assert.equal(bootstrapResult.doctor.ok, true)
      assert.equal(
        bootstrapResult.doctor.checks.some(
          (check) => check.name === 'runtime-db' && check.status === 'pass',
        ),
        true,
      )
      assert.equal(writes.length, 1)
      assert.equal(writes[0]?.vaultRoot, fixture.vaultRoot)
      assert.deepEqual(writes[0]?.tools, {
        whisper: {
          command: '/opt/whisper-cli',
          modelPath: './models/ggml-base.en.bin',
        },
        paddleocr: {
          command: 'paddleocr',
        },
      })
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

test.sequential('inbox bootstrap strict mode rejects unavailable configured whisper model paths', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-bootstrap-strict')
  const toolRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-inbox-bootstrap-strict-tool-'))
  const whisperCommand = await writeExecutableFile(
    toolRoot,
    'fake-whisper-cli',
    '#!/usr/bin/env node\nprocess.exit(0)\n',
  )
  const services = createIntegratedInboxCliServices({
    loadInboxModule: async () =>
      createFakeInboxRuntimeModule({
        rebuiltCaptureCount: 3,
      }),
    loadParsersModule: loadBuiltParsersRuntime,
  })

  try {
    const nonStrict = await services.bootstrap({
      vault: fixture.vaultRoot,
      requestId: null,
      whisperCommand,
      whisperModelPath: './models/missing.bin',
    })
    assert.equal(nonStrict.doctor.ok, true)
    assert.equal(nonStrict.doctor.parserToolchain?.tools.whisper.available, false)
    assert.equal(
      nonStrict.doctor.parserToolchain?.tools.whisper.reason,
      'Whisper model path does not exist.',
    )

    await expectVaultCliError(
      services.bootstrap({
        vault: fixture.vaultRoot,
        requestId: null,
        strict: true,
        whisperCommand,
        whisperModelPath: './models/missing.bin',
      }),
      'INBOX_BOOTSTRAP_STRICT_FAILED',
    )

    const modelsRoot = path.join(fixture.vaultRoot, 'models')
    await mkdir(modelsRoot, { recursive: true })
    await writeFile(path.join(modelsRoot, 'missing.bin'), 'model', 'utf8')

    const strictReady = await services.bootstrap({
      vault: fixture.vaultRoot,
      requestId: null,
      strict: true,
      whisperCommand,
      whisperModelPath: './models/missing.bin',
    })
    assert.equal(strictReady.doctor.parserToolchain?.tools.whisper.available, true)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
    await rm(toolRoot, { recursive: true, force: true })
  }
})

test.sequential(
  'vault-cli inbox list/show/search emit contract-shaped envelopes from runtime data',
  async () => {
    const fixture = await makeVaultFixture('healthybob-inbox-runtime-envelope')
    const services = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({ photoPath: fixture.photoPath }),
    })

    try {
      await initializeImessageSource({
        services,
        vaultRoot: fixture.vaultRoot,
      })
      await services.backfill({
        vault: fixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
      })
      const captureId = await captureSingleCaptureId({
        services,
        vaultRoot: fixture.vaultRoot,
      })

      const listed = requireData(
        await runInProcessInboxCli<{
          filters: {
            sourceId: string | null
            limit: number
          }
          items: Array<{
            captureId: string
            source: string
            text: string | null
            attachmentCount: number
          }>
        }>([
          'inbox',
          'list',
          '--vault',
          fixture.vaultRoot,
          '--limit',
          '10',
        ], services),
      )
      assert.equal(listed.filters.sourceId, null)
      assert.equal(listed.filters.limit, 10)
      assert.equal(listed.items.length, 1)
      assert.equal(listed.items[0]?.captureId, captureId)
      assert.equal(listed.items[0]?.source, 'imessage')
      assert.equal(listed.items[0]?.text, 'Toast and eggs')
      assert.equal(listed.items[0]?.attachmentCount, 1)

      const shown = requireData(
        await runInProcessInboxCli<{
          capture: {
            captureId: string
            text: string | null
            attachments: Array<{
              storedPath?: string | null
            }>
          }
        }>(['inbox', 'show', captureId, '--vault', fixture.vaultRoot], services),
      )
      assert.equal(shown.capture.captureId, captureId)
      assert.equal(shown.capture.text, 'Toast and eggs')
      assert.equal(
        shown.capture.attachments[0]?.storedPath?.includes('raw/inbox/'),
        true,
      )

      const searched = requireData(
        await runInProcessInboxCli<{
          filters: {
            text: string
            sourceId: string | null
            limit: number
          }
          hits: Array<{
            captureId: string
            snippet: string
          }>
        }>([
          'inbox',
          'search',
          '--vault',
          fixture.vaultRoot,
          '--text',
          'toast',
          '--limit',
          '5',
        ], services),
      )
      assert.equal(searched.filters.text, 'toast')
      assert.equal(searched.filters.sourceId, null)
      assert.equal(searched.filters.limit, 5)
      assert.equal(searched.hits.length, 1)
      assert.equal(searched.hits[0]?.captureId, captureId)
      assert.match(searched.hits[0]?.snippet ?? '', /toast/iu)
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

test.sequential('source add defaults the iMessage account identity to self when omitted', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-default-account')
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    const added = await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'imessage',
      id: 'imessage:self',
      includeOwn: true,
    })
    assert.equal(added.connector.accountId, 'self')

    const listed = await services.sourceList({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    assert.equal(listed.connectors[0]?.accountId, 'self')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('source add defaults the Telegram account identity to bot when omitted', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-telegram-default-account')
  const services = createIntegratedInboxCliServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    const added = await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'telegram',
      id: 'telegram:bot',
    })
    assert.equal(added.connector.accountId, 'bot')

    const listed = await services.sourceList({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    assert.equal(listed.connectors[0]?.accountId, 'bot')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('source add rejects connector ids that alias the same source/account namespace', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-namespace-alias')
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'imessage',
      id: 'imessage:self',
      account: 'self',
    })

    await expectVaultCliError(
      services.sourceAdd({
        vault: fixture.vaultRoot,
        requestId: null,
        source: 'imessage',
        id: 'imessage:alias',
        account: 'self',
      }),
      'INBOX_SOURCE_NAMESPACE_EXISTS',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('inbox init rebuild reports the full indexed capture count without a 200-item cap', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-rebuild-count')
  const services = createIntegratedInboxCliServices({
    loadInboxModule: async () =>
      createFakeInboxRuntimeModule({
        rebuiltCaptureCount: 425,
      }),
  })

  try {
    const result = await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
      rebuild: true,
    })
    assert.equal(result.rebuiltCaptures, 425)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('run forwards the configured connector id and account namespace into the daemon contract', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-run-namespace')
  let createdConnectorId: string | null = null
  let createdConnectorAccountId: string | null = null
  let seenDaemonConnectorId: string | null = null
  let seenDaemonConnectorAccountId: string | null = null
  const fakeParsers = createFakeParsersRuntimeModule({
    onRunInboxDaemonWithParsers({ connectors, runtime }) {
      seenDaemonConnectorId = connectors[0]?.id ?? null
      seenDaemonConnectorAccountId = connectors[0]?.accountId ?? null
      runtime.setCursor('imessage', connectors[0]?.accountId ?? null, {
        externalId: 'daemon-cursor',
      })
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPid: () => 4242,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: async () =>
      createFakeInboxRuntimeModule({
        onCreateImessageConnector(options) {
          createdConnectorId = options.id ?? null
          createdConnectorAccountId = options.accountId ?? null
        },
        onRunInboxDaemon() {
          throw new Error('expected parser-aware daemon path')
        },
      }),
    loadParsersModule: async () => fakeParsers,
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'imessage',
      id: 'imessage:work',
      account: 'work',
    })

    await services.run({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    assert.equal(createdConnectorId, 'imessage:work')
    assert.equal(createdConnectorAccountId, 'work')
    assert.equal(seenDaemonConnectorId, 'imessage:work')
    assert.equal(seenDaemonConnectorAccountId, 'work')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('run surfaces iMessage permission failures before starting the daemon', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-run-imessage-permissions')
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadParsersModule: async () => createFakeParsersRuntimeModule(),
    loadImessageDriver: async () =>
      createFakeImessageDriver({
        photoPath: fixture.photoPath,
      }),
    probeImessageMessagesDb: async () => {
      const error = new Error('unable to open database file') as Error & {
        code?: string
      }
      error.code = 'DATABASE'
      throw error
    },
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await expectVaultCliError(
      services.run({
        vault: fixture.vaultRoot,
        requestId: null,
      }),
      'INBOX_IMESSAGE_PERMISSION_REQUIRED',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('run writes daemon state and status updates after abort', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-run')
  const fakeParsers = createFakeParsersRuntimeModule({
    async onRunInboxDaemonWithParsers({ signal }) {
      if (signal.aborted) {
        return
      }

      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPid: () => 4242,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({
        photoPath: fixture.photoPath,
        watchDelayMs: 1000,
      }),
    loadParsersModule: async () => fakeParsers,
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'imessage',
      id: 'imessage:self',
      account: 'self',
      includeOwn: true,
    })

    const controller = new AbortController()
    const running = services.run(
      {
        vault: fixture.vaultRoot,
        requestId: null,
      },
      {
        signal: controller.signal,
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 50))

    const runningStatus = await services.status({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    assert.equal(runningStatus.running, true)
    assert.equal(runningStatus.status, 'running')

    controller.abort()
    const runResult = await running
    assert.equal(runResult.reason, 'signal')

    const stoppedStatus = await services.status({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    assert.equal(stoppedStatus.running, false)
    assert.equal(stoppedStatus.status, 'stopped')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('stop signals the recorded pid and waits for state to settle', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-stop')
  let signaledPid: number | null = null
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPid: () => 9999,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    killProcess(pid, signal) {
      if (signal === 'SIGTERM') {
        signaledPid = pid
      }
    },
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    const idleState = await services.status({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    const statePath = path.join(fixture.vaultRoot, idleState.statePath)

    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          ...idleState,
          running: true,
          stale: false,
          pid: 4242,
          startedAt: '2026-03-13T09:00:00.000Z',
          stoppedAt: null,
          status: 'running',
          connectorIds: ['imessage:self'],
          message: null,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    setTimeout(async () => {
      await writeFile(
        statePath,
        `${JSON.stringify(
          {
            ...idleState,
            running: false,
            stale: false,
            pid: 4242,
            startedAt: '2026-03-13T09:00:00.000Z',
            stoppedAt: '2026-03-13T09:00:02.000Z',
            status: 'stopped',
            connectorIds: ['imessage:self'],
            message: 'Inbox daemon stopped by signal.',
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
    }, 50)

    const stopped = await services.stop({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    assert.equal(signaledPid, 4242)
    assert.equal(stopped.running, false)
    assert.equal(stopped.status, 'stopped')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential(
  'run rejects another live daemon, marks dead foreign pid stale, and persists failed runs',
  async () => {
    const fixture = await makeVaultFixture('healthybob-inbox-run-edges')
    const paths = inboxPaths(fixture.vaultRoot)
    const driver = createFakeImessageDriver({ photoPath: fixture.photoPath })

    const aliveServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPid: () => 4242,
      getPlatform: () => 'darwin',
      killProcess(pid, signal) {
        if (signal === 0 && pid === 7777) {
          return
        }
      },
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () => driver,
    })

    const staleServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPid: () => 4242,
      getPlatform: () => 'darwin',
      killProcess(pid, signal) {
        if (signal === 0 && pid === 7777) {
          const error = new Error('missing process') as Error & { code?: string }
          error.code = 'ESRCH'
          throw error
        }
      },
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () => driver,
      loadParsersModule: async () => createFakeParsersRuntimeModule(),
    })

    const failingServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPid: () => 5151,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () => driver,
      loadParsersModule: async () =>
        createFakeParsersRuntimeModule({
          async onRunInboxDaemonWithParsers() {
            throw new Error('daemon failed while polling')
          },
        }),
    })

    try {
      await initializeImessageSource({
        services: aliveServices,
        vaultRoot: fixture.vaultRoot,
      })

      await writeFile(
        paths.inboxStatePath,
        `${JSON.stringify(
          {
            running: true,
            stale: false,
            pid: 7777,
            startedAt: '2026-03-13T09:00:00.000Z',
            stoppedAt: null,
            status: 'running',
            connectorIds: ['imessage:self'],
            statePath: '.runtime/inboxd/state.json',
            configPath: '.runtime/inboxd/config.json',
            databasePath: '.runtime/inboxd.sqlite',
            message: null,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )

      await expectVaultCliError(
        aliveServices.run({
          vault: fixture.vaultRoot,
          requestId: null,
        }),
        'INBOX_ALREADY_RUNNING',
      )

      const staleState = await staleServices.status({
        vault: fixture.vaultRoot,
        requestId: null,
      })
      assert.equal(staleState.running, false)
      assert.equal(staleState.stale, true)
      assert.equal(staleState.status, 'stale')

      const persistedStaleState = await readJsonFile<{
        stale: boolean
        status: string
        message: string | null
      }>(paths.inboxStatePath)
      assert.equal(persistedStaleState.stale, true)
      assert.equal(persistedStaleState.status, 'stale')
      assert.match(
        persistedStaleState.message ?? '',
        /Stale daemon state/u,
      )

      await writeFile(
        paths.inboxStatePath,
        `${JSON.stringify(
          {
            ...persistedStaleState,
            running: false,
            stale: false,
            pid: null,
            startedAt: null,
            stoppedAt: null,
            status: 'idle',
            connectorIds: [],
            statePath: '.runtime/inboxd/state.json',
            configPath: '.runtime/inboxd/config.json',
            databasePath: '.runtime/inboxd.sqlite',
            message: null,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )

      await assert.rejects(
        failingServices.run({
          vault: fixture.vaultRoot,
          requestId: null,
        }),
        /daemon failed while polling/u,
      )

      const failedState = await failingServices.status({
        vault: fixture.vaultRoot,
        requestId: null,
      })
      assert.equal(failedState.running, false)
      assert.equal(failedState.status, 'failed')
      assert.equal(failedState.message, 'daemon failed while polling')
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

test.sequential('stop reports not-running and timeout edge cases', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-stop-edges')
  const paths = inboxPaths(fixture.vaultRoot)
  let sigtermCount = 0
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    killProcess(_pid, signal) {
      if (signal === 'SIGTERM') {
        sigtermCount += 1
        return
      }
      if (signal === 0) {
        return
      }
    },
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    sleep: async () => {},
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await expectVaultCliError(
      services.stop({
        vault: fixture.vaultRoot,
        requestId: null,
      }),
      'INBOX_NOT_RUNNING',
    )

    await writeFile(
      paths.inboxStatePath,
      `${JSON.stringify(
        {
          running: true,
          stale: false,
          pid: 8888,
          startedAt: '2026-03-13T09:00:00.000Z',
          stoppedAt: null,
          status: 'running',
          connectorIds: ['imessage:self'],
          statePath: '.runtime/inboxd/state.json',
          configPath: '.runtime/inboxd/config.json',
          databasePath: '.runtime/inboxd.sqlite',
          message: null,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    await expectVaultCliError(
      services.stop({
        vault: fixture.vaultRoot,
        requestId: null,
      }),
      'INBOX_STOP_TIMEOUT',
    )
    assert.equal(sigtermCount > 0, true)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('doctor reports invalid config, missing source, and connector diagnostics', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-doctor')
  const paths = inboxPaths(fixture.vaultRoot)

  try {
    const baselineServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({ photoPath: fixture.photoPath }),
    })
    await baselineServices.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    await writeFile(paths.inboxConfigPath, '{"version":1,"connectors":"bad"}\n', 'utf8')
    const invalidConfig = await baselineServices.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(invalidConfig.ok, false)
    assert.equal(
      invalidConfig.checks.some(
        (check) => check.name === 'config' && check.status === 'fail',
      ),
      true,
    )

    await writeFile(
      paths.inboxConfigPath,
      `${JSON.stringify(
        {
          version: 1,
          connectors: [
            {
              id: 'imessage:self',
              source: 'imessage',
              enabled: true,
              accountId: 'self',
              options: {
                includeOwnMessages: true,
                backfillLimit: 5,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const missingSource = await baselineServices.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:missing',
    })
    assert.equal(missingSource.ok, false)
    assert.equal(
      missingSource.checks.some(
        (check) => check.name === 'connector' && check.status === 'fail',
      ),
      true,
    )

    const nonMacServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'linux',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({ photoPath: fixture.photoPath }),
    })
    const nonMacDoctor = await nonMacServices.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(
      nonMacDoctor.checks.some(
        (check) => check.name === 'platform' && check.status === 'fail',
      ),
      true,
    )

    const importFailServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () => {
        throw new Error('driver import failed')
      },
    })
    const importFailDoctor = await importFailServices.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(
      importFailDoctor.checks.some(
        (check) => check.name === 'driver-import' && check.status === 'fail',
      ),
      true,
    )

    const missingDbServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => path.join(fixture.homeRoot, 'missing-home'),
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({ photoPath: fixture.photoPath }),
    })
    const missingDbDoctor = await missingDbServices.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(
      missingDbDoctor.checks.some(
        (check) => check.name === 'messages-db' && check.status === 'fail',
      ),
      true,
    )

    const emptyProbeServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({
          photoPath: fixture.photoPath,
          listChatsResult: [],
          messages: [],
        }),
    })
    const emptyProbeDoctor = await emptyProbeServices.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(
      emptyProbeDoctor.checks.some(
        (check) => check.name === 'probe' && check.status === 'warn',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('doctor reports Telegram diagnostics without consuming updates', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-telegram-doctor')
  let getMessagesCalls = 0
  let startWatchingCalls = 0

  const services = createIntegratedInboxCliServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
    loadTelegramDriver: async () => ({
      async getMe() {
        return {
          id: 999,
          username: 'healthybob_bot',
        }
      },
      async getMessages() {
        getMessagesCalls += 1
        return []
      },
      async startWatching() {
        startWatchingCalls += 1
      },
      async getFile() {
        throw new Error('getFile should not run during doctor')
      },
      async downloadFile() {
        throw new Error('downloadFile should not run during doctor')
      },
      async getWebhookInfo() {
        return {
          url: 'https://example.invalid/webhook',
        }
      },
    }),
    getEnvironment: () => ({}),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'telegram',
      id: 'telegram:bot',
    })

    const doctor = await services.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'telegram:bot',
    })
    assert.equal(doctor.ok, true)
    assert.equal(
      doctor.checks.some(
        (check) => check.name === 'token' && check.status === 'pass',
      ),
      true,
    )
    assert.equal(
      doctor.checks.some(
        (check) => check.name === 'probe' && check.status === 'pass',
      ),
      true,
    )
    assert.equal(
      doctor.checks.some(
        (check) => check.name === 'webhook' && check.status === 'warn',
      ),
      true,
    )
    assert.equal(getMessagesCalls, 0)
    assert.equal(startWatchingCalls, 0)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('backfill dedupes repeats, honors limits, and stores cursor under the configured source account', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-backfill')
  const getMessageCalls: Array<{
    limit?: number
    cursor?: Record<string, unknown> | null
  }> = []
  const driver = createFakeImessageDriver({
    photoPath: fixture.photoPath,
    onGetMessages(options) {
      getMessageCalls.push({
        limit: options?.limit,
        cursor: options?.cursor ?? null,
      })
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () => driver,
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
      backfillLimit: 5,
    })

    const firstBackfill = await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
      limit: 1,
    })
    assert.equal(firstBackfill.importedCount, 1)
    assert.equal(firstBackfill.dedupedCount, 0)
    assert.equal(getMessageCalls[0]?.limit, 1)
    assert.equal(getMessageCalls[0]?.cursor ?? null, null)

    const secondBackfill = await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(secondBackfill.importedCount, 0)
    assert.equal(secondBackfill.dedupedCount >= 0, true)
    assert.equal(getMessageCalls[1]?.limit, 5)
    assert.deepEqual(getMessageCalls[1]?.cursor ?? null, firstBackfill.cursor)

    const inboxd = await loadBuiltInboxRuntime()
    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: fixture.vaultRoot,
    })

    try {
      assert.deepEqual(runtime.getCursor('imessage', 'self'), secondBackfill.cursor)
      assert.equal(runtime.getCursor('imessage', 'other'), null)
    } finally {
      runtime.close()
    }
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('backfill can opt into parser drains while remaining queue-first by default', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-backfill-parse')
  const drainCalls: Array<{
    attachmentId?: string
    captureId?: string
    maxJobs?: number
    vaultRoot: string
  }> = []
  const fakeParsers = createFakeParsersRuntimeModule({
    drainResults: [
      {
        attachmentId: 'att-1',
        captureId: 'cap-parser',
        providerId: 'text-file',
        status: 'succeeded',
      },
    ],
    onDrain(payload) {
      drainCalls.push(payload)
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({ photoPath: fixture.photoPath }),
    loadParsersModule: async () => fakeParsers,
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    const queueOnly = await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(queueOnly.importedCount, 1)
    assert.equal(queueOnly.parse, undefined)
    assert.equal(drainCalls.length, 0)

    const reparsed = await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
      parse: true,
    })
    assert.equal(reparsed.importedCount, 0)
    assert.equal(reparsed.dedupedCount >= 0, true)
    assert.equal(reparsed.parse?.attempted, 0)
    assert.equal(drainCalls.length, 0)

    const freshFixture = await makeVaultFixture('healthybob-inbox-backfill-parse-fresh')
    const freshServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => freshFixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({ photoPath: freshFixture.photoPath }),
      loadParsersModule: async () => fakeParsers,
    })

    try {
      await initializeImessageSource({
        services: freshServices,
        vaultRoot: freshFixture.vaultRoot,
      })
      const parsed = await freshServices.backfill({
        vault: freshFixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
        parse: true,
      })
      assert.equal(parsed.importedCount, 1)
      assert.equal(parsed.parse?.attempted, 1)
      assert.equal(parsed.parse?.succeeded, 1)
      assert.equal(parsed.parse?.results[0]?.providerId, 'text-file')
      assert.equal(
        drainCalls.some(
          (call) => call.captureId?.startsWith('cap_') && call.vaultRoot === freshFixture.vaultRoot,
        ),
        true,
      )
    } finally {
      await rm(freshFixture.vaultRoot, { recursive: true, force: true })
      await rm(freshFixture.homeRoot, { recursive: true, force: true })
    }
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('inbox setup and doctor expose additive parser toolchain status', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-parser-setup')
  const writes: Array<{
    tools?: Record<string, {
      command?: string | null
      modelPath?: string | null
    }>
    vaultRoot: string
  }> = []
  const fakeParsers = createFakeParsersRuntimeModule({
    onWrite(payload) {
      writes.push(payload)
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadParsersModule: async () => fakeParsers,
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    const setupResult = await services.setup({
      vault: fixture.vaultRoot,
      requestId: null,
      whisperCommand: '/opt/whisper-cli',
      whisperModelPath: './models/ggml-base.en.bin',
      paddleocrCommand: 'paddleocr',
    })

    assert.equal(setupResult.configPath, '.runtime/parsers/toolchain.json')
    assert.equal(setupResult.tools.whisper.available, true)
    assert.equal(setupResult.tools.whisper.command, '/opt/whisper-cli')
    assert.equal(
      setupResult.tools.whisper.modelPath,
      './models/ggml-base.en.bin',
    )
    assert.equal(writes.length, 1)
    assert.equal(writes[0]?.vaultRoot, fixture.vaultRoot)

    const doctorResult = await services.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    assert.equal(doctorResult.ok, true)
    assert.equal(doctorResult.parserToolchain?.configPath, '.runtime/parsers/toolchain.json')
    assert.equal(
      doctorResult.parserToolchain?.tools.whisper.modelPath,
      './models/ggml-base.en.bin',
    )
    assert.equal(
      doctorResult.checks.some(
        (check) => check.name === 'parser-whisper' && check.status === 'pass',
      ),
      true,
    )
    assert.equal(
      doctorResult.checks.some(
        (check) => check.name === 'parser-pdftotext' && check.status === 'warn',
      ),
      true,
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('inbox parse and requeue drive parser queue controls without real tool binaries', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-parser-queue')
  const drainCalls: Array<{
    attachmentId?: string
    captureId?: string
    maxJobs?: number
    vaultRoot: string
  }> = []
  const fakeParsers = createFakeParsersRuntimeModule({
    drainResults: [
      {
        attachmentId: 'att-1',
        captureId: 'cap-parser',
        providerId: 'text-file',
        status: 'succeeded',
      },
    ],
    onDrain(payload) {
      drainCalls.push(payload)
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({ photoPath: fixture.photoPath }),
    loadParsersModule: async () => fakeParsers,
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    const backfillResult = await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    assert.equal(backfillResult.importedCount, 1)

    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    const inboxd = await loadBuiltInboxRuntime()
    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: fixture.vaultRoot,
    })

    try {
      const [job] = runtime.listAttachmentParseJobs({
        captureId,
        limit: 1,
      })
      assert.ok(job)
      const claimedJob = runtime.claimNextAttachmentParseJob({
        captureId,
      })
      assert.ok(claimedJob)
      runtime.failAttachmentParseJob({
        jobId: job.jobId,
        attempt: claimedJob.attempts,
        errorMessage: 'parser failed',
      })
    } finally {
      runtime.close()
    }

    const requeueResult = await services.requeue({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(requeueResult.count, 1)
    assert.equal(requeueResult.filters.state, 'failed')

    const parseResult = await services.parse({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
      limit: 1,
    })
    assert.equal(parseResult.attempted, 1)
    assert.equal(parseResult.succeeded, 1)
    assert.equal(parseResult.results[0]?.providerId, 'text-file')
    assert.equal(
      parseResult.results[0]?.manifestPath,
      'derived/inbox/cap-parser/attachments/att-1/manifest.json',
    )
    assert.deepEqual(drainCalls, [
      {
        captureId,
        maxJobs: 1,
        vaultRoot: fixture.vaultRoot,
      },
    ])
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('attachment-specific inbox services preserve lookup and parse-status response shapes', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-attachment-services')
  const drainCalls: Array<{
    attachmentId?: string
    captureId?: string
    maxJobs?: number
    vaultRoot: string
  }> = []
  const drainResults: Array<{
    attachmentId: string
    captureId: string
    errorCode?: string
    errorMessage?: string
    manifestPath?: string
    providerId?: string
    status: 'failed' | 'succeeded'
  }> = []
  const fakeParsers = createFakeParsersRuntimeModule({
    drainResults,
    onDrain(payload) {
      drainCalls.push(payload)
    },
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({ photoPath: fixture.photoPath }),
    loadParsersModule: async () => fakeParsers,
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })

    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    const listed = await services.listAttachments({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(listed.captureId, captureId)
    assert.equal(listed.attachmentCount, 1)

    const attachmentId = listed.attachments[0]?.attachmentId
    assert.ok(attachmentId)

    const shown = await services.showAttachment({
      vault: fixture.vaultRoot,
      requestId: null,
      attachmentId,
    })
    assert.equal(shown.captureId, captureId)
    assert.equal(shown.attachment.attachmentId, attachmentId)
    assert.equal(shown.attachment.storedPath?.includes('raw/inbox/'), true)

    const initialStatus = await services.showAttachmentStatus({
      vault: fixture.vaultRoot,
      requestId: null,
      attachmentId,
    })
    assert.equal(initialStatus.captureId, captureId)
    assert.equal(initialStatus.attachmentId, attachmentId)
    assert.equal(initialStatus.parseable, true)
    assert.equal(initialStatus.currentState, 'pending')
    assert.equal(initialStatus.jobs.length, 1)
    assert.equal(initialStatus.jobs[0]?.state, 'pending')

    const inboxd = await loadBuiltInboxRuntime()
    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: fixture.vaultRoot,
    })

    try {
      const claimed = runtime.claimNextAttachmentParseJob({
        captureId,
      })
      assert.ok(claimed)
      runtime.failAttachmentParseJob({
        jobId: claimed.jobId,
        attempt: claimed.attempts,
        errorMessage: 'parser failed',
      })
    } finally {
      runtime.close()
    }

    const failedStatus = await services.showAttachmentStatus({
      vault: fixture.vaultRoot,
      requestId: null,
      attachmentId,
    })
    assert.equal(failedStatus.currentState, 'failed')
    assert.equal(failedStatus.jobs[0]?.state, 'failed')

    const reparsed = await services.reparseAttachment({
      vault: fixture.vaultRoot,
      requestId: null,
      attachmentId,
    })
    assert.equal(reparsed.captureId, captureId)
    assert.equal(reparsed.attachmentId, attachmentId)
    assert.equal(reparsed.parseable, true)
    assert.equal(reparsed.requeuedJobs, 1)
    assert.equal(reparsed.currentState, 'pending')
    assert.equal(reparsed.jobs[0]?.state, 'pending')

    drainResults.push({
      attachmentId,
      captureId,
      providerId: 'text-file',
      status: 'succeeded',
    })

    const parsed = await services.parseAttachment({
      vault: fixture.vaultRoot,
      requestId: null,
      attachmentId,
    })
    assert.equal(parsed.captureId, captureId)
    assert.equal(parsed.attachmentId, attachmentId)
    assert.equal(parsed.parseable, true)
    assert.equal(parsed.attempted, 1)
    assert.equal(parsed.succeeded, 1)
    assert.equal(parsed.failed, 0)
    assert.equal(parsed.currentState, 'pending')
    assert.equal(parsed.jobs[0]?.state, 'pending')
    assert.equal(parsed.results[0]?.attachmentId, attachmentId)
    assert.equal(parsed.results[0]?.captureId, captureId)
    assert.equal(parsed.results[0]?.providerId, 'text-file')
    assert.equal(
      parsed.results[0]?.manifestPath,
      `derived/inbox/${captureId}/attachments/${attachmentId}/manifest.json`,
    )
    assert.deepEqual(drainCalls, [
      {
        attachmentId,
        maxJobs: 1,
        vaultRoot: fixture.vaultRoot,
      },
    ])
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('attachment parse helpers reject non-parseable attachments with stable status output', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-attachment-unsupported')
  const blobPath = path.join(fixture.vaultRoot, 'blob.bin')
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({
        photoPath: fixture.photoPath,
        attachments: [
          {
            guid: 'att-other-1',
            fileName: 'blob.bin',
            path: blobPath,
            mimeType: 'application/octet-stream',
          },
        ],
      }),
  })

  try {
    await writeFile(blobPath, 'blob', 'utf8')
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })

    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    const listed = await services.listAttachments({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    const attachmentId = listed.attachments[0]?.attachmentId
    assert.ok(attachmentId)

    const status = await services.showAttachmentStatus({
      vault: fixture.vaultRoot,
      requestId: null,
      attachmentId,
    })
    assert.equal(status.parseable, false)
    assert.equal(status.currentState, null)
    assert.deepEqual(status.jobs, [])

    await expectVaultCliError(
      services.parseAttachment({
        vault: fixture.vaultRoot,
        requestId: null,
        attachmentId,
      }),
      'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
    )
    await expectVaultCliError(
      services.reparseAttachment({
        vault: fixture.vaultRoot,
        requestId: null,
        attachmentId,
      }),
      'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('inbox requeue can reset running attachment parse jobs', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-requeue-running')
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({ photoPath: fixture.photoPath }),
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })

    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    const inboxd = await loadBuiltInboxRuntime()
    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: fixture.vaultRoot,
    })

    try {
      const claimed = runtime.claimNextAttachmentParseJob({
        captureId,
      })
      assert.ok(claimed)
      assert.equal(claimed.state, 'running')
    } finally {
      runtime.close()
    }

    const requeueResult = await services.requeue({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
      state: 'running',
    })
    assert.equal(requeueResult.count, 1)
    assert.equal(requeueResult.filters.state, 'running')

    const runtimeAfterRequeue = await inboxd.openInboxRuntime({
      vaultRoot: fixture.vaultRoot,
    })
    try {
      const [job] = runtimeAfterRequeue.listAttachmentParseJobs({
        captureId,
        limit: 1,
      })
      assert.equal(job?.state, 'pending')
      assert.equal(
        runtimeAfterRequeue.getCapture(captureId)?.attachments[0]?.parseState,
        'pending',
      )
    } finally {
      runtimeAfterRequeue.close()
    }
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('status and stop reject corrupted daemon state, and inbox operations reject corrupted promotion state', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-corruption')
  const paths = inboxPaths(fixture.vaultRoot)
  const driver = createFakeImessageDriver({ photoPath: fixture.photoPath })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () => driver,
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await writeFile(paths.inboxStatePath, '{"running":"nope"}\n', 'utf8')
    await expectVaultCliError(
      services.status({
        vault: fixture.vaultRoot,
        requestId: null,
      }),
      'INBOX_STATE_INVALID',
    )
    await expectVaultCliError(
      services.stop({
        vault: fixture.vaultRoot,
        requestId: null,
      }),
      'INBOX_STATE_INVALID',
    )

    await rm(paths.inboxStatePath, { force: true })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await writeFile(paths.inboxPromotionsPath, '{"version":1,"entries":"bad"}\n', 'utf8')
    await expectVaultCliError(
      services.list({
        vault: fixture.vaultRoot,
        requestId: null,
        limit: 10,
      }),
      'INBOX_PROMOTIONS_INVALID',
    )
    await expectVaultCliError(
      services.show({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTIONS_INVALID',
    )
    await expectVaultCliError(
      services.search({
        vault: fixture.vaultRoot,
        requestId: null,
        text: 'toast',
      }),
      'INBOX_PROMOTIONS_INVALID',
    )
    await expectVaultCliError(
      services.promoteMeal({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTIONS_INVALID',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('meal promotion remains idempotent after local promotion state is deleted', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-canonical-promotion')
  const paths = inboxPaths(fixture.vaultRoot)
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({ photoPath: fixture.photoPath }),
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    const firstPromotion = await services.promoteMeal({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(firstPromotion.created, true)
    assert.equal((await listMealManifestPaths(fixture.vaultRoot)).length, 1)

    await rm(paths.inboxPromotionsPath, { force: true })

    const retriedPromotion = await services.promoteMeal({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(retriedPromotion.created, false)
    assert.equal(retriedPromotion.lookupId, firstPromotion.lookupId)
    assert.equal(retriedPromotion.relatedId, firstPromotion.relatedId)
    assert.equal((await listMealManifestPaths(fixture.vaultRoot)).length, 1)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('document promotion remains idempotent after local promotion state is deleted', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-document-promotion')
  const paths = inboxPaths(fixture.vaultRoot)
  const documentPath = path.join(fixture.vaultRoot, 'lab-note.pdf')
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadImportersModule: loadBuiltImportersRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({
        photoPath: fixture.photoPath,
        attachments: [
          {
            guid: 'att-doc-1',
            fileName: 'lab-note.pdf',
            path: documentPath,
            mimeType: 'application/pdf',
          },
        ],
      }),
  })

  try {
    await writeFile(documentPath, 'document body', 'utf8')
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    const firstPromotion = await services.promoteDocument({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(firstPromotion.created, true)
    assert.match(firstPromotion.lookupId, /^evt_/u)
    assert.match(firstPromotion.relatedId, /^doc_/u)
    assert.equal((await listDocumentManifestPaths(fixture.vaultRoot)).length, 1)

    await rm(paths.inboxPromotionsPath, { force: true })

    const retriedPromotion = await services.promoteDocument({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(retriedPromotion.created, false)
    assert.equal(retriedPromotion.lookupId, firstPromotion.lookupId)
    assert.equal(retriedPromotion.relatedId, firstPromotion.relatedId)
    assert.equal((await listDocumentManifestPaths(fixture.vaultRoot)).length, 1)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('meal promotion retries do not duplicate canonical meals after a local promotion-store write failure', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-promotion-write-failure')
  const paths = inboxPaths(fixture.vaultRoot)
  const inboxRuntimeRoot = path.dirname(paths.inboxPromotionsPath)
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () =>
      createFakeImessageDriver({ photoPath: fixture.photoPath }),
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await chmod(inboxRuntimeRoot, 0o555)
    try {
      await assert.rejects(
        services.promoteMeal({
          vault: fixture.vaultRoot,
          requestId: null,
          captureId,
        }),
      )
    } finally {
      await chmod(inboxRuntimeRoot, 0o755)
    }
    assert.equal((await listMealManifestPaths(fixture.vaultRoot)).length, 1)

    const retriedPromotion = await services.promoteMeal({
      vault: fixture.vaultRoot,
      requestId: null,
      captureId,
    })
    assert.equal(retriedPromotion.created, false)
    assert.equal((await listMealManifestPaths(fixture.vaultRoot)).length, 1)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})

test.sequential('promotion safeguards cover missing photos, invalid stored ids, and unsupported targets', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-promotion')
  const paths = inboxPaths(fixture.vaultRoot)
  const photoFreeDriver = createFakeImessageDriver({
    photoPath: fixture.photoPath,
    attachments: [],
  })
  const services = createIntegratedInboxCliServices({
    getHomeDirectory: () => fixture.homeRoot,
    getPlatform: () => 'darwin',
    loadCoreModule: loadBuiltCoreRuntime,
    loadInboxModule: loadBuiltInboxRuntime,
    loadImessageDriver: async () => photoFreeDriver,
  })

  try {
    await initializeImessageSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await expectVaultCliError(
      services.promoteMeal({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTION_REQUIRES_PHOTO',
    )
    await expectVaultCliError(
      services.promoteDocument({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTION_REQUIRES_DOCUMENT',
    )

    const photoFixture = await makeVaultFixture('healthybob-inbox-promotion-state')
    const photoServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => photoFixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: loadBuiltInboxRuntime,
      loadImessageDriver: async () =>
        createFakeImessageDriver({ photoPath: photoFixture.photoPath }),
    })

    try {
      await initializeImessageSource({
        services: photoServices,
        vaultRoot: photoFixture.vaultRoot,
      })
      await photoServices.backfill({
        vault: photoFixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
      })
      const photoCaptureId = await captureSingleCaptureId({
        services: photoServices,
        vaultRoot: photoFixture.vaultRoot,
      })

      await writeFile(
        inboxPaths(photoFixture.vaultRoot).inboxPromotionsPath,
        `${JSON.stringify(
          {
            version: 1,
            entries: [
              {
                captureId: photoCaptureId,
                target: 'meal',
                status: 'applied',
                promotedAt: '2026-03-13T09:00:00.000Z',
                lookupId: null,
                relatedId: null,
                note: 'toast',
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      await expectVaultCliError(
        photoServices.promoteMeal({
          vault: photoFixture.vaultRoot,
          requestId: null,
          captureId: photoCaptureId,
        }),
        'INBOX_PROMOTION_STATE_INVALID',
      )
      await expectVaultCliError(
        photoServices.promoteJournal({
          vault: photoFixture.vaultRoot,
          requestId: null,
          captureId: photoCaptureId,
        }),
        'INBOX_PROMOTION_UNSUPPORTED',
      )
      await expectVaultCliError(
        photoServices.promoteExperimentNote({
          vault: photoFixture.vaultRoot,
          requestId: null,
          captureId: photoCaptureId,
        }),
        'INBOX_EXPERIMENT_TARGET_MISSING',
      )
    } finally {
      await rm(photoFixture.vaultRoot, { recursive: true, force: true })
      await rm(photoFixture.homeRoot, { recursive: true, force: true })
    }
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})
