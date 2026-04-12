import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { afterAll, beforeAll, test as baseTest, vi } from 'vitest'

import type {
  AssistantAskResult,
  AssistantChatResult,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

const test = baseTest.sequential

const runtimeMocks = vi.hoisted(() => ({
  runAssistantChatWithInk: vi.fn(),
}))

vi.mock('../src/assistant-chat-ink.js', () => ({
  runAssistantChatWithInk: runtimeMocks.runAssistantChatWithInk,
}))

import {
  canUseAssistantDaemonForMessage,
  maybeSendAssistantMessageViaDaemon,
  resolveAssistantDaemonClientConfig,
} from '../src/assistant-daemon-client.js'
import { runAssistantChat } from '../src/assistant-runtime.js'
import {
  formatForegroundLogLine,
  resolveForegroundTerminalLogOptions,
} from '../src/run-terminal-logging.js'

const fetchMock = vi.fn<typeof fetch>(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), 'http://127.0.0.1:50242/message')
    assert.equal(init?.method, 'POST')
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer assistant-test-token',
    )
    assert.deepEqual(JSON.parse(String(init?.body)), {
      prompt: 'hello from daemon',
      vault: '/tmp/vault',
    })

    return new Response(
      JSON.stringify(TEST_ASK_RESULT),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      },
    )
  },
)

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const TEST_SESSION = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session-command-runtime-test',
  target: {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
  },
  resumeState: null,
  provider: 'codex-cli',
  providerOptions: {
    continuityFingerprint: 'fingerprint-command-runtime',
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    executionDriver: 'codex-cli',
    resumeKind: 'codex-session',
  },
  providerBinding: null,
  alias: 'chat:test',
  binding: {
    conversationKey: 'chat:test',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 0,
} satisfies AssistantSession

const TEST_ASK_RESULT = {
  vault: '/tmp/vault',
  status: 'completed',
  prompt: 'hello from daemon',
  response: 'daemon response',
  session: TEST_SESSION,
  delivery: null,
  deliveryDeferred: false,
  deliveryIntentId: null,
  deliveryError: null,
} satisfies AssistantAskResult

const TEST_CHAT_RESULT = {
  vault: '/tmp/vault',
  startedAt: '2026-03-28T00:00:00.000Z',
  stoppedAt: '2026-03-28T00:00:05.000Z',
  turns: 1,
  session: TEST_SESSION,
} satisfies AssistantChatResult

test('package manifest exposes the assistant command and runtime logging subpaths', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports?: Record<string, { default?: string; types?: string } | undefined>
    main?: string
    name?: string
    private?: boolean
    type?: string
    types?: string
  }

  assert.equal(packageManifest.name, '@murphai/assistant-cli')
  assert.equal(packageManifest.private, true)
  assert.equal(packageManifest.type, 'module')
  assert.equal(packageManifest.main, './dist/index.js')
  assert.equal(packageManifest.types, './dist/index.d.ts')
  assert.deepEqual(packageManifest.exports?.['./commands/assistant'], {
    types: './dist/commands/assistant.d.ts',
    default: './dist/commands/assistant.js',
  })
  assert.deepEqual(packageManifest.exports?.['./run-terminal-logging'], {
    types: './dist/run-terminal-logging.d.ts',
    default: './dist/run-terminal-logging.js',
  })
})

test('runAssistantChat delegates to the Ink runner and returns its result', async () => {
  runtimeMocks.runAssistantChatWithInk.mockResolvedValueOnce(TEST_CHAT_RESULT)

  const input = {
    vault: '/tmp/vault',
    initialPrompt: 'hello',
  } satisfies Parameters<typeof runAssistantChat>[0]

  const result = await runAssistantChat(input)

  assert.deepEqual(result, TEST_CHAT_RESULT)
  assert.equal(runtimeMocks.runAssistantChatWithInk.mock.calls.length, 1)
  assert.deepEqual(runtimeMocks.runAssistantChatWithInk.mock.calls[0]?.[0], input)
})

test('resolveAssistantDaemonClientConfig trims loopback URLs, honors disable flags, and rejects remote hosts', () => {
  assert.deepEqual(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
    }),
    {
      baseUrl: 'http://127.0.0.1:50241',
      token: 'assistant-test-token',
    },
  )

  assert.equal(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
      MURPH_ASSISTANTD_DISABLE_CLIENT: '1',
    }),
    null,
  )

  assert.deepEqual(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: ' http://localhost:50241/ ',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
    }),
    {
      baseUrl: 'http://localhost:50241',
      token: 'assistant-test-token',
    },
  )

  assert.throws(
    () =>
      resolveAssistantDaemonClientConfig({
        MURPH_ASSISTANTD_BASE_URL: 'http://example.com:50241/',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
      }),
    /loopback-only http:\/\//u,
  )
})

test('canUseAssistantDaemonForMessage declines turns that need local-only state', () => {
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        vault: '/tmp/vault',
        prompt: 'hello from daemon',
      },
      {
        MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50242',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
      },
    ),
    true,
  )

  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        vault: '/tmp/vault',
        prompt: 'hello from daemon',
        abortSignal: new AbortController().signal,
      },
      {
        MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50242',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
      },
    ),
    false,
  )
})

test('maybeSendAssistantMessageViaDaemon sends the prompt through the daemon and parses the response', async () => {
  const result = await maybeSendAssistantMessageViaDaemon(
    {
      vault: '/tmp/vault',
      prompt: 'hello from daemon',
    },
    {
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50242',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
    },
  )

  assert.deepEqual(result, TEST_ASK_RESULT)
})

test('resolveForegroundTerminalLogOptions follows the unsafe details flag and formats a stable log line', () => {
  assert.deepEqual(resolveForegroundTerminalLogOptions({}), {
    unsafeDetails: false,
  })
  assert.deepEqual(
    resolveForegroundTerminalLogOptions({
      UNSAFE_FOREGROUND_LOG_DETAILS: '1',
    }),
    {
      unsafeDetails: true,
    },
  )

  const now = new Date('2026-03-28T00:00:00.000Z')
  now.getHours = () => 1
  now.getMinutes = () => 2
  now.getSeconds = () => 3

  assert.equal(
    formatForegroundLogLine('assistant', 'ready to run', now),
    '[assistant 01:02:03] ready to run',
  )
})
