import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const {
  createAgentmailApiClientMock,
  listAllAgentmailInboxesMock,
  matchesAgentmailHttpErrorMock,
  resolveAgentmailApiKeyMock,
  resolveAgentmailBaseUrlMock,
  ensureImessageMessagesDbReadableMock,
  resolveTelegramApiBaseUrlMock,
  resolveTelegramBotTokenMock,
  resolveTelegramFileBaseUrlMock,
  loadQueryRuntimeMock,
  loadRuntimeModuleMock,
} = vi.hoisted(() => ({
  createAgentmailApiClientMock: vi.fn(),
  listAllAgentmailInboxesMock: vi.fn(),
  matchesAgentmailHttpErrorMock: vi.fn(),
  resolveAgentmailApiKeyMock: vi.fn(),
  resolveAgentmailBaseUrlMock: vi.fn(),
  ensureImessageMessagesDbReadableMock: vi.fn(),
  resolveTelegramApiBaseUrlMock: vi.fn(),
  resolveTelegramBotTokenMock: vi.fn(),
  resolveTelegramFileBaseUrlMock: vi.fn(),
  loadQueryRuntimeMock: vi.fn(),
  loadRuntimeModuleMock: vi.fn(),
}))

vi.mock('@murphai/operator-config/agentmail-runtime', () => ({
  createAgentmailApiClient: createAgentmailApiClientMock,
  listAllAgentmailInboxes: listAllAgentmailInboxesMock,
  matchesAgentmailHttpError: matchesAgentmailHttpErrorMock,
  resolveAgentmailApiKey: resolveAgentmailApiKeyMock,
  resolveAgentmailBaseUrl: resolveAgentmailBaseUrlMock,
}))

vi.mock('@murphai/operator-config/imessage-readiness', () => ({
  ensureImessageMessagesDbReadable: ensureImessageMessagesDbReadableMock,
}))

vi.mock('@murphai/operator-config/setup-runtime-env', () => ({
  SETUP_RUNTIME_ENV_NOTICE: 'setup runtime env notice',
}))

vi.mock('@murphai/operator-config/telegram-runtime', () => ({
  resolveTelegramApiBaseUrl: resolveTelegramApiBaseUrlMock,
  resolveTelegramBotToken: resolveTelegramBotTokenMock,
  resolveTelegramFileBaseUrl: resolveTelegramFileBaseUrlMock,
}))

vi.mock('@murphai/vault-usecases/runtime', () => ({
  loadQueryRuntime: loadQueryRuntimeMock,
  loadRuntimeModule: loadRuntimeModuleMock,
}))

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { createInboxAppEnvironment } from '../src/inbox-app/environment.ts'
import { describeLinqConnectorEndpoint } from '../src/inbox-app/linq-endpoint.ts'
import type { InboxConnectorConfig } from '../src/inbox-app/types.ts'

const IMESSAGE_CONNECTOR = {
  accountId: 'imessage-account',
  enabled: true,
  id: 'imessage:primary',
  options: {},
  source: 'imessage',
} satisfies InboxConnectorConfig

const EMAIL_CONNECTOR = {
  accountId: 'mailbox-1',
  enabled: true,
  id: 'email:primary',
  options: {},
  source: 'email',
} satisfies InboxConnectorConfig

beforeEach(() => {
  createAgentmailApiClientMock.mockReset()
  listAllAgentmailInboxesMock.mockReset()
  matchesAgentmailHttpErrorMock.mockReset()
  resolveAgentmailApiKeyMock.mockReset()
  resolveAgentmailBaseUrlMock.mockReset()
  ensureImessageMessagesDbReadableMock.mockReset()
  resolveTelegramApiBaseUrlMock.mockReset()
  resolveTelegramBotTokenMock.mockReset()
  resolveTelegramFileBaseUrlMock.mockReset()
  loadQueryRuntimeMock.mockReset()
  loadRuntimeModuleMock.mockReset()

  resolveAgentmailApiKeyMock.mockReturnValue('env-key')
  resolveAgentmailBaseUrlMock.mockReturnValue(null)
  resolveTelegramApiBaseUrlMock.mockReturnValue(null)
  resolveTelegramBotTokenMock.mockReturnValue(null)
  resolveTelegramFileBaseUrlMock.mockReturnValue(null)
  matchesAgentmailHttpErrorMock.mockReturnValue(false)
  loadQueryRuntimeMock.mockResolvedValue({ kind: 'query-runtime' })
  loadRuntimeModuleMock.mockImplementation(async (specifier: string) => ({
    specifier,
  }))
})

test('describeLinqConnectorEndpoint covers both configured and default endpoint branches', () => {
  assert.deepEqual(describeLinqConnectorEndpoint({ options: {} }), {
    host: '0.0.0.0',
    path: '/linq-webhook',
    port: 8789,
  })

  assert.deepEqual(
    describeLinqConnectorEndpoint({
      options: {
        linqWebhookHost: '127.0.0.1',
        linqWebhookPath: '/custom-hook',
        linqWebhookPort: 9001,
      },
    }),
    {
      host: '127.0.0.1',
      path: '/custom-hook',
      port: 9001,
    },
  )
})

test('default helper methods expose live process values and the no-op auto-reply default', async () => {
  const env = createInboxAppEnvironment()

  assert.ok(env.clock() instanceof Date)
  assert.equal(env.getPid(), process.pid)
  assert.equal(env.getPlatform(), process.platform)
  assert.ok(env.getHomeDirectory().length > 0)

  const killSpy = vi
    .spyOn(process, 'kill')
    .mockImplementation(() => true)
  try {
    env.killProcess(123, 'SIGTERM')
    assert.deepEqual(killSpy.mock.calls[0], [123, 'SIGTERM'])
  } finally {
    killSpy.mockRestore()
  }

  await env.sleep(0)
  assert.equal(await env.enableAssistantAutoReplyChannel('/tmp/vault', 'linq'), false)
})

test('loadConfiguredImessageDriver returns an injected driver without loading runtime modules', async () => {
  const expectedDriver = { kind: 'imessage-driver' }
  const loadImessageDriver = vi.fn(async () => expectedDriver)
  const env = createInboxAppEnvironment({
    loadImessageDriver,
  })

  assert.equal(await env.loadConfiguredImessageDriver(IMESSAGE_CONNECTOR), expectedDriver)
  assert.equal(loadImessageDriver.mock.calls.length, 1)
  assert.equal(loadRuntimeModuleMock.mock.calls.length, 0)
})

test('loadConfiguredImessageDriver preserves runtime_unavailable failures from loading the iMessage runtime', async () => {
  const env = createInboxAppEnvironment({
    loadInboxImessageModule: async () => {
      throw new Error('missing runtime package')
    },
  })

  await assert.rejects(
    () => env.loadConfiguredImessageDriver(IMESSAGE_CONNECTOR),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.match(error.message, /the iMessage inbox connector/)
      assert.deepEqual(error.context, {
        cause: 'missing runtime package',
        packages: ['@murphai/inboxd-imessage'],
      })
      return true
    },
  )
})

test('loadConfiguredImessageDriver wraps runtime driver failures with connector-specific context', async () => {
  const env = createInboxAppEnvironment({
    inboxImessageModule: {
      loadImessageKitDriver() {
        throw new Error('driver boot failed')
      },
    },
  })

  await assert.rejects(
    () => env.loadConfiguredImessageDriver(IMESSAGE_CONNECTOR),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.match(error.message, /"imessage:primary"/)
      assert.deepEqual(error.context, {
        cause: 'driver boot failed',
        packages: ['@murphai/inboxd-imessage'],
      })
      return true
    },
  )
})

test('requireParsers wraps non-Error runtime failures with parser package guidance', async () => {
  const env = createInboxAppEnvironment({
    loadParsersModule: async () => {
      throw 'parsers unavailable'
    },
  })

  await assert.rejects(
    () => env.requireParsers('attachment parsing'),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.equal(
        error.message,
        'packages/cli can describe attachment parsing, but local execution is blocked until the integrating workspace builds and links @murphai/inboxd and @murphai/parsers.',
      )
      assert.deepEqual(error.context, {
        packages: ['@murphai/inboxd', '@murphai/parsers'],
      })
      return true
    },
  )
})

test('loadConfiguredEmailDriver prefers an injected driver when present', async () => {
  const expectedDriver = { kind: 'email-driver' }
  const loadEmailDriver = vi.fn(async () => expectedDriver)
  const env = createInboxAppEnvironment({
    loadEmailDriver,
  })

  assert.equal(await env.loadConfiguredEmailDriver(EMAIL_CONNECTOR), expectedDriver)
  assert.equal(env.usesInjectedEmailDriver, true)
  assert.equal(loadEmailDriver.mock.calls.length, 1)
})

test('tryResolveAgentmailInboxAddress returns the looked-up inbox email when discovery succeeds', async () => {
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: null,
    getInbox: vi.fn(async () => ({
      email: ' resolved@example.com ',
    })),
  })

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  assert.equal(
    await env.tryResolveAgentmailInboxAddress({
      accountId: 'mailbox-lookup',
      emailAddress: null,
    }),
    'resolved@example.com',
  )
})

test('provisionOrRecoverAgentmailInbox reuses the only discovered inbox after a forbidden create', async () => {
  const createInboxError = new Error('forbidden-create')
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: null,
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
  })
  listAllAgentmailInboxesMock.mockResolvedValue([
    {
      inbox_id: 'mailbox-reused',
      email: 'existing@example.com',
      display_name: 'Existing Inbox',
      client_id: 'client-7',
    },
  ])
  matchesAgentmailHttpErrorMock.mockImplementation((error, match) =>
    error === createInboxError &&
    match.status === 403 &&
    match.method === 'POST' &&
    match.path === '/inboxes',
  )

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  assert.deepEqual(await env.provisionOrRecoverAgentmailInbox({}), {
    accountId: 'mailbox-reused',
    emailAddress: 'existing@example.com',
    provisionedMailbox: null,
    reusedMailbox: {
      clientId: 'client-7',
      displayName: 'Existing Inbox',
      emailAddress: 'existing@example.com',
      inboxId: 'mailbox-reused',
      provider: 'agentmail',
    },
  })
})

test('provisionOrRecoverAgentmailInbox requires an explicit account when discovery returns no inboxes', async () => {
  const createInboxError = new Error('forbidden-create')
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: null,
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
  })
  listAllAgentmailInboxesMock.mockResolvedValue([])
  matchesAgentmailHttpErrorMock.mockImplementation((error, match) =>
    error === createInboxError &&
    match.status === 403 &&
    match.method === 'POST' &&
    match.path === '/inboxes',
  )

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  await assert.rejects(
    () => env.provisionOrRecoverAgentmailInbox({}),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_EMAIL_ACCOUNT_REQUIRED')
      return true
    },
  )
})

test('provisionOrRecoverAgentmailInbox rethrows unexpected inbox discovery failures', async () => {
  const createInboxError = new Error('forbidden-create')
  const listInboxesError = new Error('list failed')

  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: null,
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
  })
  listAllAgentmailInboxesMock.mockRejectedValue(listInboxesError)
  matchesAgentmailHttpErrorMock.mockImplementation((error, match) =>
    error === createInboxError &&
    match.status === 403 &&
    match.method === 'POST' &&
    match.path === '/inboxes',
  )

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  await assert.rejects(() => env.provisionOrRecoverAgentmailInbox({}), listInboxesError)
})

test('provisionOrRecoverAgentmailInbox rethrows non-forbidden create failures', async () => {
  const createInboxError = new Error('create failed')

  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: null,
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
  })

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  await assert.rejects(() => env.provisionOrRecoverAgentmailInbox({}), createInboxError)
})
