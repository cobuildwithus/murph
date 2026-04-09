import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const {
  assertBootstrapStrictReadyMock,
  ensureConfigFileMock,
  ensureDirectoryMock,
  fileExistsMock,
  findConnectorMock,
  probeLinqApiMock,
  readConfigMock,
  rebuildRuntimeMock,
  resolveRuntimePathsMock,
  toCliParserToolchainMock,
  toParserToolChecksMock,
} = vi.hoisted(() => ({
  assertBootstrapStrictReadyMock: vi.fn(),
  ensureConfigFileMock: vi.fn(),
  ensureDirectoryMock: vi.fn(),
  fileExistsMock: vi.fn(),
  findConnectorMock: vi.fn(),
  probeLinqApiMock: vi.fn(),
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
  readConfig: readConfigMock,
  rebuildRuntime: rebuildRuntimeMock,
}))

vi.mock('../src/inbox-services/parser.ts', () => ({
  assertBootstrapStrictReady: assertBootstrapStrictReadyMock,
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

vi.mock('@murphai/operator-config/linq-runtime', async (importActual) => {
  const actual =
    await importActual<typeof import('@murphai/operator-config/linq-runtime')>()
  return {
    ...actual,
    probeLinqApi: probeLinqApiMock,
  }
})

import {
  passCheck,
  warnCheck,
} from '../src/inbox-services/shared.ts'
import { createInboxBootstrapDoctorOps } from '../src/inbox-app/bootstrap-doctor.ts'
import { DOCTOR_STRATEGIES } from '../src/inbox-app/bootstrap-doctor-strategies.ts'
import type {
  DoctorContext,
  ImessageDriver,
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
    deviceSyncDbPath: '/vault/.runtime/operations/device-sync/state.sqlite',
    deviceSyncLauncherStatePath: '/vault/.runtime/operations/device-sync/launcher.json',
    deviceSyncRuntimeRoot: '/vault/.runtime/operations/device-sync',
    deviceSyncStderrLogPath: '/vault/.runtime/operations/device-sync/stderr.log',
    deviceSyncStdoutLogPath: '/vault/.runtime/operations/device-sync/stdout.log',
    gatewayDbPath: '/vault/.runtime/projections/gateway.sqlite',
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
      pdftotext: {
        available: true,
        command: '/usr/bin/pdftotext',
        reason: 'pdftotext configured',
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
      pdftotext: {
        available: true,
        command: '/usr/bin/pdftotext',
        reason: 'pdftotext configured',
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
    close() {},
    getCapture() {
      return null
    },
    getCursor() {
      return null
    },
    listCaptures() {
      return []
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
    createTelegramPollConnector() {
      throw new Error('not used in bootstrap tests')
    },
    createEmailPollConnector() {
      throw new Error('not used in bootstrap tests')
    },
    createLinqWebhookConnector() {
      throw new Error('not used in bootstrap tests')
    },
    createTelegramBotApiPollDriver() {
      throw new Error('not used in bootstrap tests')
    },
    createAgentmailApiPollDriver() {
      throw new Error('not used in bootstrap tests')
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon() {
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
    createConfiguredAgentmailClient() {
      throw new Error('not used in bootstrap tests')
    },
    enableAssistantAutoReplyChannel: unusedAsync,
    ensureConfiguredImessageReady: async () => undefined,
    getEnvironment: () => ({}),
    getHomeDirectory: () => '/tmp',
    getPid: () => 1,
    getPlatform: () => 'linux',
    journalPromotionEnabled: false,
    killProcess() {},
    loadConfiguredEmailDriver: unusedAsync,
    loadConfiguredImessageDriver: unusedAsync,
    loadConfiguredTelegramDriver: unusedAsync,
    loadCore: unusedAsync,
    loadImporters: unusedAsync,
    loadInbox: async () => createInboxRuntimeModule(),
    loadInboxImessage: unusedAsync,
    loadParsers: async () => createParsersModule(),
    loadQuery: unusedAsync,
    provisionOrRecoverAgentmailInbox: unusedAsync,
    requireParsers: async () => createParsersModule(),
    sleep: async () => undefined,
    tryResolveAgentmailInboxAddress: unusedAsync,
    usesInjectedEmailDriver: false,
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
  context: DoctorContext,
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
  assertBootstrapStrictReadyMock.mockImplementation(() => undefined)
  toCliParserToolchainMock.mockImplementation(() => createParserToolchain())
  toParserToolChecksMock.mockImplementation(() => [
    passCheck('parser-ffmpeg', 'ffmpeg configured'),
    passCheck('parser-pdftotext', 'pdftotext configured'),
    warnCheck('parser-whisper', 'whisper configured but optional'),
  ])
  probeLinqApiMock.mockResolvedValue({
    phoneNumbers: ['+15551234567'],
  })
})

test('bootstrap initializes runtime, writes parser config, and optionally enforces strict readiness', async () => {
  readConfigMock.mockResolvedValue({
    connectors: [createConnector('telegram', 'telegram:bot')],
  })
  rebuildRuntimeMock.mockResolvedValue(4)

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
    loadInbox: async () =>
      createInboxRuntimeModule({
        openInboxRuntime,
      }),
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
  assert.equal(assertBootstrapStrictReadyMock.mock.calls.length, 0)
  assert.deepEqual(nonStrict.init.createdPaths, [
    '.runtime',
    '.runtime/operations/inbox',
    '.runtime/operations/inbox/config.json',
    '.runtime/projections/inboxd.sqlite',
  ])
  assert.equal(nonStrict.init.rebuiltCaptures, 4)
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

  const strict = await ops.bootstrap({
    requestId: null,
    strict: true,
    vault: '/vault',
  })
  assert.equal(assertBootstrapStrictReadyMock.mock.calls.length, 1)
  assert.equal(assertBootstrapStrictReadyMock.mock.calls[0]?.[0]?.ok, strict.doctor.ok)
  assert.deepEqual(
    assertBootstrapStrictReadyMock.mock.calls[0]?.[0]?.checks,
    strict.doctor.checks,
  )
  assert.equal(openInboxRuntime.mock.calls.length > 0, true)
  assert.equal(discoverParserToolchain.mock.calls.length > 0, true)
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
    connectors: [createConnector('email', 'email:primary')],
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

test('iMessage strategy covers platform, driver, Messages DB, and probe branches', async () => {
  const imessageConnector = createConnector('imessage', 'imessage:self', {
    accountId: 'self',
    options: {
      includeOwnMessages: true,
    },
  })

  const failureContext = createDoctorContext({
    sourceId: imessageConnector.id,
  })
  await DOCTOR_STRATEGIES.imessage(failureContext, imessageConnector, {
    env: createEnvironment({
      ensureConfiguredImessageReady: async () => {
        throw new Error('messages unavailable')
      },
      getPlatform: () => 'linux',
      loadConfiguredImessageDriver: async () => {
        throw new Error('driver unavailable')
      },
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(failureContext, 'platform')?.status, 'fail')
  assert.equal(findCheck(failureContext, 'driver-import')?.status, 'fail')
  assert.equal(findCheck(failureContext, 'messages-db')?.status, 'fail')
  assert.equal(findCheck(failureContext, 'probe'), null)

  const warningContext = createDoctorContext({
    sourceId: imessageConnector.id,
  })
  const quietDriver: ImessageDriver = {
    async getMessages() {
      return []
    },
    async listChats() {
      return []
    },
  }
  await DOCTOR_STRATEGIES.imessage(warningContext, imessageConnector, {
    env: createEnvironment({
      ensureConfiguredImessageReady: async () => undefined,
      getPlatform: () => 'darwin',
      loadConfiguredImessageDriver: async () => quietDriver,
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(warningContext, 'platform')?.status, 'pass')
  assert.equal(findCheck(warningContext, 'messages-db')?.status, 'pass')
  assert.equal(findCheck(warningContext, 'probe')?.status, 'warn')

  const successContext = createDoctorContext({
    sourceId: imessageConnector.id,
  })
  const activeDriver: ImessageDriver = {
    async getMessages() {
      return [{}]
    },
    async listChats() {
      return []
    },
  }
  await DOCTOR_STRATEGIES.imessage(successContext, imessageConnector, {
    env: createEnvironment({
      ensureConfiguredImessageReady: async () => undefined,
      getPlatform: () => 'darwin',
      loadConfiguredImessageDriver: async () => activeDriver,
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(successContext, 'probe')?.status, 'pass')
})

test('telegram strategy covers missing token, delegated drivers, webhook passes, and webhook warnings', async () => {
  const telegramConnector = createConnector('telegram', 'telegram:bot')

  const missingTokenContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await DOCTOR_STRATEGIES.telegram(missingTokenContext, telegramConnector, {
    env: createEnvironment(),
    runDoctorCheck,
  })
  assert.equal(findCheck(missingTokenContext, 'platform')?.status, 'pass')
  assert.equal(findCheck(missingTokenContext, 'token')?.status, 'fail')
  assert.equal(findCheck(missingTokenContext, 'driver-import'), null)

  const delegatedContext = createDoctorContext({
    sourceId: telegramConnector.id,
  })
  await DOCTOR_STRATEGIES.telegram(delegatedContext, telegramConnector, {
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
  await DOCTOR_STRATEGIES.telegram(webhookPassContext, telegramConnector, {
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
  await DOCTOR_STRATEGIES.telegram(webhookWarnContext, telegramConnector, {
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
  await DOCTOR_STRATEGIES.telegram(probeFailureContext, telegramConnector, {
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

test('email strategy covers missing configuration, delegated drivers, and unread probe results', async () => {
  const missingEmailContext = createDoctorContext({
    sourceId: 'email:missing',
  })
  await DOCTOR_STRATEGIES.email(
    missingEmailContext,
    createConnector('email', 'email:missing'),
    {
      env: createEnvironment(),
      runDoctorCheck,
    },
  )
  assert.equal(findCheck(missingEmailContext, 'account')?.status, 'fail')
  assert.equal(findCheck(missingEmailContext, 'token')?.status, 'fail')
  assert.equal(findCheck(missingEmailContext, 'driver-import'), null)

  const delegatedEmailContext = createDoctorContext({
    sourceId: 'email:delegated',
  })
  await DOCTOR_STRATEGIES.email(
    delegatedEmailContext,
    createConnector('email', 'email:delegated', {
      accountId: 'mailbox-1',
      options: {
        emailAddress: 'reader@example.com',
      },
    }),
    {
      env: createEnvironment({
        loadConfiguredEmailDriver: async () => ({
          inboxId: 'mailbox-1',
          async downloadAttachment() {
            return null
          },
          async listUnreadMessages() {
            return []
          },
          async markProcessed() {},
        }),
        usesInjectedEmailDriver: true,
      }),
      runDoctorCheck,
    },
  )
  assert.equal(findCheck(delegatedEmailContext, 'account')?.status, 'pass')
  assert.equal(findCheck(delegatedEmailContext, 'token')?.status, 'pass')
  assert.equal(findCheck(delegatedEmailContext, 'probe')?.status, 'warn')

  const successEmailContext = createDoctorContext({
    sourceId: 'email:primary',
  })
  await DOCTOR_STRATEGIES.email(
    successEmailContext,
    createConnector('email', 'email:primary', {
      accountId: 'mailbox-2',
    }),
    {
      env: createEnvironment({
        getEnvironment: () => ({
          AGENTMAIL_API_KEY: 'agentmail-key',
        }),
        loadConfiguredEmailDriver: async () => ({
          inboxId: 'mailbox-2',
          async downloadAttachment() {
            return null
          },
          async listUnreadMessages() {
            return [{ id: 'message-1' }]
          },
          async markProcessed() {},
        }),
      }),
      runDoctorCheck,
    },
  )
  assert.equal(findCheck(successEmailContext, 'probe')?.status, 'pass')
})

test('linq strategy covers missing credentials plus successful, empty, and failing probes', async () => {
  const linqConnector = createConnector('linq', 'linq:primary', {
    options: {
      linqWebhookHost: '127.0.0.1',
      linqWebhookPath: '/hooks/linq',
      linqWebhookPort: 9010,
    },
  })

  const missingCredentialsContext = createDoctorContext({
    sourceId: linqConnector.id,
  })
  await DOCTOR_STRATEGIES.linq(missingCredentialsContext, linqConnector, {
    env: createEnvironment(),
    runDoctorCheck,
  })
  assert.equal(findCheck(missingCredentialsContext, 'token')?.status, 'fail')
  assert.equal(
    findCheck(missingCredentialsContext, 'webhook-secret')?.status,
    'fail',
  )
  assert.equal(
    findCheck(missingCredentialsContext, 'webhook-listener')?.status,
    'fail',
  )
  assert.equal(findCheck(missingCredentialsContext, 'probe'), null)

  const successContext = createDoctorContext({
    sourceId: linqConnector.id,
  })
  probeLinqApiMock.mockResolvedValueOnce({
    phoneNumbers: ['+15551234567'],
  })
  await DOCTOR_STRATEGIES.linq(successContext, linqConnector, {
    env: createEnvironment({
      getEnvironment: () => ({
        LINQ_API_TOKEN: 'linq-token',
        LINQ_WEBHOOK_SECRET: 'linq-secret',
      }),
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(successContext, 'token')?.status, 'pass')
  assert.equal(
    findCheck(successContext, 'webhook-listener')?.status,
    'pass',
  )
  assert.equal(findCheck(successContext, 'probe')?.status, 'pass')

  const emptyContext = createDoctorContext({
    sourceId: linqConnector.id,
  })
  probeLinqApiMock.mockResolvedValueOnce({
    phoneNumbers: [],
  })
  await DOCTOR_STRATEGIES.linq(emptyContext, linqConnector, {
    env: createEnvironment({
      getEnvironment: () => ({
        LINQ_API_TOKEN: 'linq-token',
        LINQ_WEBHOOK_SECRET: 'linq-secret',
      }),
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(emptyContext, 'probe')?.status, 'warn')

  const failureContext = createDoctorContext({
    sourceId: linqConnector.id,
  })
  probeLinqApiMock.mockRejectedValueOnce(new Error('probe failed'))
  await DOCTOR_STRATEGIES.linq(failureContext, linqConnector, {
    env: createEnvironment({
      getEnvironment: () => ({
        LINQ_API_TOKEN: 'linq-token',
        LINQ_WEBHOOK_SECRET: 'linq-secret',
      }),
    }),
    runDoctorCheck,
  })
  assert.equal(findCheck(failureContext, 'probe')?.status, 'fail')
})
