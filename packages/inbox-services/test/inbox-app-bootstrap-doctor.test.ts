import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const {
  ensureConfigFileMock,
  ensureDirectoryMock,
  fileExistsMock,
  findConnectorMock,
  readConfigMock,
  rebuildRuntimeMock,
  resolveRuntimePathsMock,
  toCliParserToolchainMock,
  toParserToolChecksMock,
} = vi.hoisted(() => ({
  ensureConfigFileMock: vi.fn(),
  ensureDirectoryMock: vi.fn(),
  fileExistsMock: vi.fn(),
  findConnectorMock: vi.fn(),
  readConfigMock: vi.fn(),
  rebuildRuntimeMock: vi.fn(),
  resolveRuntimePathsMock: vi.fn(),
  toCliParserToolchainMock: vi.fn(),
  toParserToolChecksMock: vi.fn(),
}))

vi.mock('@murphai/runtime-state/node', () => ({
  resolveRuntimePaths: resolveRuntimePathsMock,
}))

vi.mock('../src/inbox-services/state.ts', () => ({
  ensureConfigFile: ensureConfigFileMock,
  ensureDirectory: ensureDirectoryMock,
  findConnector: findConnectorMock,
  async readConfigWithReconciliation(...args: unknown[]) {
    return {
      config: await readConfigMock(...args),
      removedLegacyEmailConnectorCount: 0,
    }
  },
  rebuildRuntime: rebuildRuntimeMock,
}))

vi.mock('../src/inbox-services/parser.ts', () => ({
  toCliParserToolchain: toCliParserToolchainMock,
  toParserToolChecks: toParserToolChecksMock,
}))

vi.mock('../src/inbox-services/shared.ts', async (importActual) => {
  const actual =
    await importActual<typeof import('../src/inbox-services/shared.ts')>()
  return {
    ...actual,
    fileExists: fileExistsMock,
  }
})

import {
  passCheck,
  warnCheck,
} from '../src/inbox-services/shared.ts'
import { createInboxBootstrapDoctorOps } from '../src/inbox-app/bootstrap-doctor.ts'
import { runTelegramDoctorChecks } from '../src/inbox-app/bootstrap-doctor-strategies.ts'
import type {
  DoctorContext,
  InboxAppEnvironment,
  InboxConnectorConfig,
  InboxRuntimeModule,
  ParsersRuntimeModule,
  RuntimeStore,
  TelegramDriver,
} from '../src/inbox-app/types.ts'

function createPaths() {
  return {
    absoluteVaultRoot: '/vault',
    cacheRoot: '/vault/.runtime/cache',
    clinicalRecordsRuntimeRoot: '/vault/.runtime/operations/clinical-records',
    deviceSyncDbPath: '/vault/.runtime/operations/device-sync/state.sqlite',
    deviceSyncLauncherStatePath: '/vault/.runtime/operations/device-sync/launcher.json',
    deviceSyncRuntimeRoot: '/vault/.runtime/operations/device-sync',
    deviceSyncStderrLogPath: '/vault/.runtime/operations/device-sync/stderr.log',
    deviceSyncStdoutLogPath: '/vault/.runtime/operations/device-sync/stdout.log',
    runtimeRoot: '/vault/.runtime',
    operationalRoot: '/vault/.runtime/operations',
    projectionsRoot: '/vault/.runtime/projections',
    inboxRuntimeRoot: '/vault/.runtime/operations/inbox',
    inboxDbPath: '/vault/.runtime/projections/inboxd.sqlite',
    inboxConfigPath: '/vault/.runtime/operations/inbox/config.json',
    inboxStatePath: '/vault/.runtime/operations/inbox/state.json',
    inboxPromotionsPath: '/vault/.runtime/operations/inbox/promotions.json',
    parserRuntimeRoot: '/vault/.runtime/operations/parsers',
    parserToolchainConfigPath: '/vault/.runtime/operations/parsers/toolchain.json',
    queryDbPath: '/vault/.runtime/projections/query.sqlite',
    tempRoot: '/vault/.runtime/tmp',
  }
}

function createConnector(
  source: InboxConnectorConfig['source'],
  id = `${source}:primary`,
  overrides: Partial<InboxConnectorConfig> = {},
): InboxConnectorConfig {
  return {
    accountId: null,
    enabled: true,
    id,
    options: {},
    source,
    ...overrides,
  }
}

function createParserDoctor() {
  return {
    configPath: createPaths().parserToolchainConfigPath,
    discoveredAt: '2026-04-08T00:00:00.000Z',
    tools: {
      ffmpeg: {
        available: true,
        command: '/usr/bin/ffmpeg',
        reason: 'ffmpeg configured',
        source: 'config' as const,
      },
      whisper: {
        available: true,
        command: '/usr/bin/whisper',
        modelPath: '/models/base.bin',
        reason: 'whisper configured',
        source: 'config' as const,
      },
    },
  }
}

function createParserToolchain() {
  return {
    configPath: '.runtime/operations/parsers/toolchain.json',
    discoveredAt: '2026-04-08T00:00:00.000Z',
    tools: {
      ffmpeg: {
        available: true,
        command: '/usr/bin/ffmpeg',
        reason: 'ffmpeg configured',
        source: 'config' as const,
      },
      whisper: {
        available: true,
        command: '/usr/bin/whisper',
        modelPath: '/models/base.bin',
        reason: 'whisper configured',
        source: 'config' as const,
      },
    },
  }
}

function createRuntimeStore(): RuntimeStore {
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
    listCaptures() {
      return []
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

function createInboxRuntimeModule(
  overrides: Partial<InboxRuntimeModule> = {},
): InboxRuntimeModule {
  return {
    async ensureInboxVault() {},
    async openInboxRuntime() {
      return createRuntimeStore()
    },
    async createInboxPipeline() {
      throw new Error('not used in bootstrap tests')
    },
    async createParsedInboxPipeline() {
      throw new Error('not used in bootstrap tests')
    },
    createTelegramPollConnector() {
      throw new Error('not used in bootstrap tests')
    },
    createTelegramBotApiPollDriver() {
      throw new Error('not used in bootstrap tests')
    },
    async rebuildRuntimeFromVault() {},
    async runInboxEnvelopeMigration() {
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
        mode: 'dry-run' as const,
        mutated: false,
        scannedEnvelopeCount: 0,
      }
    },
    async runInboxDaemon() {
      throw new Error('not used in bootstrap tests')
    },
    async runPollConnectorBackfill() {
      throw new Error('not used in bootstrap tests')
    },
    async runInboxDaemonWithParsers() {
      throw new Error('not used in bootstrap tests')
    },
    ...overrides,
  }
}

function createParsersModule(
  overrides: Partial<ParsersRuntimeModule> = {},
): ParsersRuntimeModule {
  return {
    async compactLegacyParserAttempts() {
      throw new Error('not used in bootstrap tests')
    },
    async createConfiguredParserRegistry() {
      throw new Error('not used in bootstrap tests')
    },
    createInboxParserService() {
      throw new Error('not used in bootstrap tests')
    },
    async discoverParserToolchain() {
      return createParserDoctor()
    },
    async writeParserToolchainConfig() {
      return {
        config: {
          updatedAt: '2026-04-08T00:00:00.000Z',
        },
        configPath: createPaths().parserToolchainConfigPath,
      }
    },
    ...overrides,
  }
}

async function unusedAsync<T>(): Promise<T> {
  throw new Error('not used in bootstrap tests')
}

function createEnvironment(
  overrides: Partial<InboxAppEnvironment> = {},
): InboxAppEnvironment {
  return {
    clock: () => new Date('2026-04-08T00:00:00.000Z'),
    enableAssistantAutoReplyChannel: unusedAsync,
    getEnvironment: () => ({}),
    getHomeDirectory: () => '/tmp',
    getPid: () => 1,
    getPlatform: () => 'linux',
    journalPromotionEnabled: false,
    killProcess() {},
    loadConfiguredTelegramDriver: unusedAsync,
    loadCore: unusedAsync,
    loadImporters: unusedAsync,
    loadInbox: async () => createInboxRuntimeModule(),
    loadParsers: async () => createParsersModule(),
    loadQuery: unusedAsync,
    requireParsers: async () => createParsersModule(),
    sleep: async () => undefined,
    usesInjectedTelegramDriver: false,
    ...overrides,
  }
}

function createDoctorContext(
  input: Partial<DoctorContext['input']> = {},
): DoctorContext {
  return {
    checks: [],
    config: null,
    databaseAvailable: true,
    inboxd: createInboxRuntimeModule(),
    input: {
      requestId: null,
      sourceId: null,
      vault: '/vault',
      ...input,
    },
    parserToolchain: null,
    paths: createPaths(),
  }
}

async function runDoctorCheck<TResult>(
  context: DoctorContext,
  input: {
    run: () => Promise<TResult>
    onSuccess: (result: TResult) => ReturnType<typeof passCheck> | ReturnType<typeof passCheck>[]
    onError: (error: unknown) => ReturnType<typeof passCheck> | ReturnType<typeof passCheck>[]
  },
): Promise<TResult | null> {
  try {
    const result = await input.run()
    const checks = input.onSuccess(result)
    context.checks.push(...(Array.isArray(checks) ? checks : [checks]))
    return result
  } catch (error) {
    const checks = input.onError(error)
    context.checks.push(...(Array.isArray(checks) ? checks : [checks]))
    return null
  }
}

function findCheck(
  context: Pick<DoctorContext, 'checks'>,
  name: string,
) {
  return context.checks.find((check) => check.name === name) ?? null
}

beforeEach(() => {
  vi.clearAllMocks()

  resolveRuntimePathsMock.mockReturnValue(createPaths())
  ensureDirectoryMock.mockImplementation(
    async (absolutePath: string, createdPaths: string[]) => {
      createdPaths.push(absolutePath.replace('/vault/', ''))
    },
  )
  ensureConfigFileMock.mockImplementation(
    async (_paths: ReturnType<typeof createPaths>, createdPaths: string[]) => {
      createdPaths.push('.runtime/operations/inbox/config.json')
      return {
        config: { connectors: [] },
        removedLegacyEmailConnectorCount: 0,
      }
    },
  )
  readConfigMock.mockResolvedValue({ connectors: [] })
  findConnectorMock.mockImplementation(
    (
      config: { connectors: InboxConnectorConfig[] },
      sourceId: string,
    ) => config.connectors.find((connector) => connector.id === sourceId) ?? null,
  )
  rebuildRuntimeMock.mockResolvedValue(0)
  fileExistsMock.mockImplementation(async (absolutePath: string) =>
    absolutePath === createPaths().inboxConfigPath
      ? true
      : absolutePath === createPaths().inboxDbPath
        ? false
        : false,
  )
  toCliParserToolchainMock.mockImplementation(() => createParserToolchain())
  toParserToolChecksMock.mockImplementation(() => [
    passCheck('parser-ffmpeg', 'ffmpeg configured'),
    warnCheck('parser-whisper', 'whisper configured but optional'),
  ])
})

test('bootstrap initializes runtime, writes parser config, and returns doctor readiness', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('telegram', 'telegram:bot')],
  })
  rebuildRuntimeMock.mockResolvedValue(4)

  const telegramDriver: TelegramDriver = {
    async deleteWebhook() {},
    async downloadFile() {
      return new Uint8Array()
    },
    async getFile() {
      return {}
    },
    async getMe() {
      return { username: 'murphbot' }
    },
    async getMessages() {
      return []
    },
    async getWebhookInfo() {
      return { url: '' }
    },
    async startWatching() {
      return undefined
    },
  }

  const openInboxRuntime = vi.fn(async () => createRuntimeStore())
  const writeParserToolchainConfig = vi.fn(async (input: {
    vaultRoot: string
    tools?: Record<string, { command?: string | null; modelPath?: string | null }>
  }) => ({
    config: {
      updatedAt: '2026-04-08T12:00:00.000Z',
    },
    configPath: `${input.vaultRoot}/.runtime/operations/parsers/toolchain.json`,
  }))
  const discoverParserToolchain = vi.fn(async () => createParserDoctor())

  const env = createEnvironment({
    getEnvironment: () => ({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
    }),
    loadInbox: async () =>
      createInboxRuntimeModule({
        openInboxRuntime,
      }),
    loadConfiguredTelegramDriver: async () => telegramDriver,
    loadParsers: async () =>
      createParsersModule({
        discoverParserToolchain,
      }),
    requireParsers: async () =>
      createParsersModule({
        discoverParserToolchain,
        writeParserToolchainConfig,
      }),
  })
  const ops = createInboxBootstrapDoctorOps(env)

  const nonStrict = await ops.bootstrap({
    ffmpegCommand: '/usr/bin/ffmpeg',
    rebuild: true,
    requestId: null,
    vault: '/vault',
    whisperModelPath: '/models/base.bin',
  })
  assert.deepEqual(nonStrict.init.createdPaths, [
    '.runtime',
    '.runtime/operations/inbox',
    '.runtime/operations/inbox/config.json',
    '.runtime/projections/inboxd.sqlite',
  ])
  assert.equal(nonStrict.init.rebuiltCaptures, 4)
  assert.deepEqual(rebuildRuntimeMock.mock.calls[0]?.[2], {
    enqueueParserJobs: true,
  })
  await ops.init({
    rebuild: true,
    rebuildParserJobs: false,
    requestId: null,
    vault: '/vault',
  })
  const latestRebuildCall =
    rebuildRuntimeMock.mock.calls[rebuildRuntimeMock.mock.calls.length - 1]
  assert.deepEqual(latestRebuildCall?.[2], {
    enqueueParserJobs: false,
  })
  assert.equal(nonStrict.setup.updatedAt, '2026-04-08T12:00:00.000Z')
  assert.deepEqual(writeParserToolchainConfig.mock.calls[0]?.[0], {
    tools: {
      ffmpeg: {
        command: '/usr/bin/ffmpeg',
      },
      whisper: {
        modelPath: '/models/base.bin',
      },
    },
    vaultRoot: '/vault',
  })
  assert.equal(nonStrict.doctor.ok, true)
  assert.equal(nonStrict.doctor.target, null)

  const repeated = await ops.bootstrap({
    requestId: null,
    vault: '/vault',
  })
  assert.equal(repeated.doctor.ok, true)
  assert.equal(openInboxRuntime.mock.calls.length > 0, true)
  assert.equal(discoverParserToolchain.mock.calls.length > 0, true)
})

test('bootstrap reports unhealthy configured connectors in doctor output', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('telegram', 'telegram:bot')],
  })

  const ops = createInboxBootstrapDoctorOps(createEnvironment())

  const nonStrict = await ops.bootstrap({
    requestId: null,
    vault: '/vault',
  })
  assert.equal(nonStrict.doctor.ok, false)
  assert.equal(
    nonStrict.doctor.checks.some(
      (check) => check.name === 'token' && check.status === 'fail',
    ),
    true,
  )
})

test('doctor stops after a vault failure and keeps missing config and database paths null', async () => {
  const ensureInboxVault = vi.fn(async () => {
    throw new Error('vault unreadable')
  })
  fileExistsMock.mockResolvedValue(false)

  const env = createEnvironment({
    loadInbox: async () =>
      createInboxRuntimeModule({
        ensureInboxVault,
      }),
  })
  const ops = createInboxBootstrapDoctorOps(env)

  const result = await ops.doctor({
    requestId: null,
    sourceId: 'telegram:bot',
    vault: '/vault',
  })

  assert.equal(result.ok, false)
  assert.equal(result.configPath, null)
  assert.equal(result.databasePath, null)
  assert.equal(result.target, 'telegram:bot')
  assert.equal(result.checks.length, 1)
  assert.equal(result.checks[0]?.name, 'vault')
  assert.equal(result.checks[0]?.status, 'fail')
  assert.equal(readConfigMock.mock.calls.length, 0)
})

test('doctor reports config, runtime-db, and parser discovery failures using the existing config path', async () => {
  readConfigMock.mockRejectedValue(new Error('invalid config'))

  const env = createEnvironment({
    loadInbox: async () =>
      createInboxRuntimeModule({
        async openInboxRuntime() {
          throw new Error('sqlite unavailable')
        },
      }),
    loadParsers: async () => {
      throw new Error('parsers unavailable')
    },
  })
  const ops = createInboxBootstrapDoctorOps(env)

  const result = await ops.doctor({
    requestId: null,
    sourceId: 'missing',
    vault: '/vault',
  })

  assert.equal(result.ok, false)
  assert.equal(result.configPath, '.runtime/operations/inbox/config.json')
  assert.equal(result.databasePath, null)
  assert.equal(result.target, 'missing')
  assert.equal(
    result.checks.some((check) => check.name === 'config' && check.status === 'fail'),
    true,
  )
  assert.equal(
    result.checks.some(
      (check) => check.name === 'runtime-db' && check.status === 'fail',
    ),
    true,
  )
  assert.equal(
    result.checks.some(
      (check) =>
        check.name === 'parser-runtime' && check.status === 'warn',
    ),
    true,
  )
})

test('doctor warns when no connectors are configured and fails when a requested connector is missing', async () => {
  const env = createEnvironment()
  const ops = createInboxBootstrapDoctorOps(env)

  const noConnectors = await ops.doctor({
    requestId: null,
    vault: '/vault',
  })
  assert.equal(noConnectors.ok, true)
  assert.equal(
    noConnectors.checks.some(
      (check) => check.name === 'connectors' && check.status === 'warn',
    ),
    true,
  )

  readConfigMock.mockResolvedValue({
    connectors: [createConnector('telegram', 'telegram:primary')],
  })

  const missingConnector = await ops.doctor({
    requestId: null,
    sourceId: 'telegram:bot',
    vault: '/vault',
  })
  assert.equal(missingConnector.ok, false)
  assert.equal(
    missingConnector.checks.some(
      (check) => check.name === 'connector' && check.status === 'fail',
    ),
    true,
  )
})

test('doctor rebuilds runtime and runs the telegram strategy for a configured connector', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('telegram', 'telegram:bot')],
  })
  rebuildRuntimeMock.mockResolvedValue(2)

  const driver: TelegramDriver = {
    async deleteWebhook() {},
    async downloadFile() {
      return new Uint8Array()
    },
    async getFile() {
      return {}
    },
    async getMe() {
      return { username: 'murphbot' }
    },
    async getMessages() {
      return []
    },
    async getWebhookInfo() {
      return { url: 'https://hooks.example.test/telegram' }
    },
    async startWatching() {
      return undefined
    },
  }

  const env = createEnvironment({
    getEnvironment: () => ({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
    }),
    loadConfiguredTelegramDriver: async () => driver,
  })
  const ops = createInboxBootstrapDoctorOps(env)

  const result = await ops.doctor({
    requestId: null,
    sourceId: 'telegram:bot',
    vault: '/vault',
  })

  assert.equal(result.ok, true)
  assert.equal(result.target, 'telegram:bot')
  assert.equal(rebuildRuntimeMock.mock.calls.length, 1)
  assert.equal(rebuildRuntimeMock.mock.calls[0]?.[2], undefined)
  assert.equal(
    result.checks.some(
      (check) => check.name === 'rebuild' && check.status === 'pass',
    ),
    true,
  )
  assert.equal(
    result.checks.some(
      (check) => check.name === 'token' && check.status === 'pass',
    ),
    true,
  )
  assert.equal(
    result.checks.some(
      (check) => check.name === 'webhook' && check.status === 'warn',
    ),
    true,
  )
})

test('doctor runs the supported strategy and reports removed local sources in all-connectors mode', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [
      createConnector('telegram', 'telegram:bot'),
      createConnector('linq', 'linq:primary'),
    ],
  })
  rebuildRuntimeMock.mockResolvedValue(2)

  const loadConfiguredTelegramDriver = vi.fn(async () => ({
    async deleteWebhook() {},
    async downloadFile() {
      return new Uint8Array()
    },
    async getFile() {
      return {}
    },
    async getMe() {
      return { username: 'murphbot' }
    },
    async getMessages() {
      return []
    },
    async getWebhookInfo() {
      return { url: '' }
    },
    async startWatching() {
      return undefined
    },
  }))

  const ops = createInboxBootstrapDoctorOps(
    createEnvironment({
      getEnvironment: () => ({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
      }),
      loadConfiguredTelegramDriver,
    }),
  )

  const result = await ops.doctor({
    requestId: null,
    vault: '/vault',
  })

  assert.equal(result.target, null)
  assert.equal(result.ok, false)
  assert.equal(rebuildRuntimeMock.mock.calls.length, 1)
  assert.equal(loadConfiguredTelegramDriver.mock.calls.length, 1)
  assert.equal(findCheck(result, 'connectors')?.status, 'pass')
  assert.equal(findCheck(result, 'unsupported-connectors')?.status, 'fail')
  assert.equal(
    result.checks.filter((check) => check.name === 'connector').length,
    1,
  )
  assert.equal(
    result.checks.filter(
      (check) => check.name === 'probe' && check.status === 'pass',
    ).length,
    1,
  )
})

test('doctor continues the Telegram strategy when rebuild fails', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('telegram', 'telegram:bot')],
  })
  rebuildRuntimeMock.mockRejectedValue(new Error('rebuild failed'))

  const loadConfiguredTelegramDriver = vi.fn(async () => ({
    async deleteWebhook() {},
    async downloadFile() {
      return new Uint8Array()
    },
    async getFile() {
      return {}
    },
    async getMe() {
      return { username: 'murphbot' }
    },
    async getMessages() {
      return []
    },
    async getWebhookInfo() {
      return { url: '' }
    },
    async startWatching() {
      return undefined
    },
  }))

  const ops = createInboxBootstrapDoctorOps(
    createEnvironment({
      getEnvironment: () => ({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
      }),
      loadConfiguredTelegramDriver,
    }),
  )

  const result = await ops.doctor({
    requestId: null,
    vault: '/vault',
  })

  assert.equal(result.ok, false)
  assert.equal(findCheck(result, 'rebuild')?.status, 'fail')
  assert.equal(loadConfiguredTelegramDriver.mock.calls.length, 1)
  assert.equal(
    result.checks.filter(
      (check) => check.name === 'probe' && check.status === 'pass',
    ).length,
    1,
  )
})

test('telegram strategy covers missing token, delegated drivers, webhook passes, and webhook warnings', async () => {
  const telegramConnector = createConnector('telegram', 'telegram:bot')

  const missingTokenContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await runTelegramDoctorChecks(missingTokenContext, telegramConnector, {
    env: createEnvironment(),
    runDoctorCheck,
  })
  assert.equal(findCheck(missingTokenContext, 'platform')?.status, 'pass')
  assert.equal(findCheck(missingTokenContext, 'token')?.status, 'fail')
  assert.equal(findCheck(missingTokenContext, 'driver-import'), null)

  const delegatedContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await runTelegramDoctorChecks(delegatedContext, telegramConnector, {
    env: createEnvironment({
      loadConfiguredTelegramDriver: async () => ({
        async deleteWebhook() {},
        async downloadFile() {
          return new Uint8Array()
        },
        async getFile() {
          return {}
        },
        async getMe() {
          return 'bot'
        },
        async getMessages() {
          return []
        },
        async startWatching() {
          return undefined
        },
      }),
      usesInjectedTelegramDriver: true,
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(delegatedContext, 'token')?.status, 'pass')
  assert.equal(findCheck(delegatedContext, 'probe')?.status, 'pass')
  assert.equal(findCheck(delegatedContext, 'webhook'), null)

  const webhookPassContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await runTelegramDoctorChecks(webhookPassContext, telegramConnector, {
    env: createEnvironment({
      getEnvironment: () => ({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
      }),
      loadConfiguredTelegramDriver: async () => ({
        async deleteWebhook() {},
        async downloadFile() {
          return new Uint8Array()
        },
        async getFile() {
          return {}
        },
        async getMe() {
          return { username: 'murphbot' }
        },
        async getMessages() {
          return []
        },
        async getWebhookInfo() {
          return { url: '' }
        },
        async startWatching() {
          return undefined
        },
      }),
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(webhookPassContext, 'webhook')?.status, 'pass')

  const webhookWarnContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await runTelegramDoctorChecks(webhookWarnContext, telegramConnector, {
    env: createEnvironment({
      getEnvironment: () => ({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
      }),
      loadConfiguredTelegramDriver: async () => ({
        async deleteWebhook() {},
        async downloadFile() {
          return new Uint8Array()
        },
        async getFile() {
          return {}
        },
        async getMe() {
          return { username: 'murphbot' }
        },
        async getMessages() {
          return []
        },
        async getWebhookInfo() {
          throw new Error('webhook unavailable')
        },
        async startWatching() {
          return undefined
        },
      }),
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(webhookWarnContext, 'webhook')?.status, 'warn')

  const probeFailureContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await runTelegramDoctorChecks(probeFailureContext, telegramConnector, {
    env: createEnvironment({
      getEnvironment: () => ({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
      }),
      loadConfiguredTelegramDriver: async () => ({
        async deleteWebhook() {},
        async downloadFile() {
          return new Uint8Array()
        },
        async getFile() {
          return {}
        },
        async getMe() {
          throw new Error('getMe failed')
        },
        async getMessages() {
          return []
        },
        async getWebhookInfo() {
          return { url: '' }
        },
        async startWatching() {
          return undefined
        },
      }),
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(probeFailureContext, 'probe')?.status, 'fail')
})

test('doctor reports unsupported local sources without invoking a strategy', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('linq', 'linq:primary')],
  })

  const doctor = createInboxBootstrapDoctorOps(createEnvironment())

  const result = await doctor.doctor({
    requestId: null,
    sourceId: 'linq:primary',
    vault: '/vault',
  })

  assert.equal(result.ok, false)
  assert.equal(findCheck(result, 'source-unsupported')?.status, 'fail')
  assert.match(
    findCheck(result, 'source-unsupported')?.message ?? '',
    /no longer supports the "linq" inbox source/u,
  )
})

test('doctor reports unsupported local sources in all-connectors mode', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('linq', 'linq:primary')],
  })

  const doctor = createInboxBootstrapDoctorOps(createEnvironment())

  const result = await doctor.doctor({
    requestId: null,
    vault: '/vault',
  })

  assert.equal(result.ok, false)
  assert.equal(findCheck(result, 'unsupported-connectors')?.status, 'fail')
  assert.match(
    findCheck(result, 'unsupported-connectors')?.message ?? '',
    /"linq:primary" \(linq\)/u,
  )
})
