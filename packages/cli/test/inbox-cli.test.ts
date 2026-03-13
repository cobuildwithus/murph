import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { createIntegratedInboxCliServices } from '../src/inbox-services.js'
import { createVaultCli } from '../src/vault-cli.js'
import { createUnwiredVaultCliServices } from '../src/vault-cli-services.js'
import { requireData, type CliEnvelope } from './cli-test-helpers.js'

const builtCoreRuntimeUrl = new URL('../../core/dist/index.js', import.meta.url).href
const builtInboxRuntimeUrl = new URL('../../inboxd/dist/index.js', import.meta.url).href

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
  await mkdir(path.dirname(messagesDbPath), { recursive: true })
  await writeFile(messagesDbPath, 'messages', 'utf8')

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
    }>
  }
}

async function loadBuiltInboxRuntime() {
  return (await import(builtInboxRuntimeUrl)) as any
}

function inboxPaths(vaultRoot: string) {
  return {
    configPath: path.join(vaultRoot, '.runtime', 'inboxd', 'config.json'),
    promotionsPath: path.join(vaultRoot, '.runtime', 'inboxd', 'promotions.json'),
    statePath: path.join(vaultRoot, '.runtime', 'inboxd', 'state.json'),
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
      }>(inboxPaths(fixture.vaultRoot).configPath)
      assert.equal(config.version, 1)
      assert.deepEqual(config.connectors, [])
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

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

test.sequential('run writes daemon state and status updates after abort', async () => {
  const fixture = await makeVaultFixture('healthybob-inbox-run')
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
    })

    const failingServices = createIntegratedInboxCliServices({
      getHomeDirectory: () => fixture.homeRoot,
      getPid: () => 5151,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime,
      loadInboxModule: async () => {
        const inboxd = await loadBuiltInboxRuntime()
        return {
          ...inboxd,
          async runInboxDaemon() {
            throw new Error('daemon failed while polling')
          },
        }
      },
      loadImessageDriver: async () => driver,
    })

    try {
      await initializeImessageSource({
        services: aliveServices,
        vaultRoot: fixture.vaultRoot,
      })

      await writeFile(
        paths.statePath,
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
      }>(paths.statePath)
      assert.equal(persistedStaleState.stale, true)
      assert.equal(persistedStaleState.status, 'stale')
      assert.match(
        persistedStaleState.message ?? '',
        /Stale daemon state/u,
      )

      await writeFile(
        paths.statePath,
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
      paths.statePath,
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

    await writeFile(paths.configPath, '{"version":1,"connectors":"bad"}\n', 'utf8')
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
      paths.configPath,
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
    assert.equal(secondBackfill.dedupedCount, 1)
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

    await writeFile(paths.statePath, '{"running":"nope"}\n', 'utf8')
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

    await rm(paths.statePath, { force: true })
    await services.backfill({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'imessage:self',
    })
    const captureId = await captureSingleCaptureId({
      services,
      vaultRoot: fixture.vaultRoot,
    })

    await writeFile(paths.promotionsPath, '{"version":1,"entries":"bad"}\n', 'utf8')
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

    await writeFile(
      paths.promotionsPath,
      `${JSON.stringify(
        {
          version: 1,
          entries: [
            {
              captureId,
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
      services.promoteMeal({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTION_STATE_INVALID',
    )
    await expectVaultCliError(
      services.promoteJournal({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTION_UNSUPPORTED',
    )
    await expectVaultCliError(
      services.promoteExperimentNote({
        vault: fixture.vaultRoot,
        requestId: null,
        captureId,
      }),
      'INBOX_PROMOTION_UNSUPPORTED',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
    await rm(fixture.homeRoot, { recursive: true, force: true })
  }
})
