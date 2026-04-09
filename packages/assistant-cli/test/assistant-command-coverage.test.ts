import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { beforeEach, test as baseTest, vi } from 'vitest'

import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { InboxServices } from '@murphai/inbox-services'

const test = baseTest.sequential

const commandMocks = vi.hoisted(() => ({
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  clearAssistantSelfDeliveryTargets: vi.fn(),
  deliverAssistantMessage: vi.fn(),
  getAssistantSession: vi.fn(),
  getAssistantStatus: vi.fn(),
  listAssistantSelfDeliveryTargets: vi.fn(),
  listAssistantSessions: vi.fn(),
  redactAssistantDisplayPath: vi.fn((value: string) => `redacted:${value}`),
  redactAssistantSessionForDisplay: vi.fn((value) => value),
  redactAssistantSessionsForDisplay: vi.fn((value) => value),
  resolveAssistantConversationAudience: vi.fn(),
  resolveAssistantConversationAutoReplyEligibility: vi.fn(),
  resolveAssistantConversationPolicy: vi.fn(),
  resolveAssistantStatePaths: vi.fn((vault: string) => ({
    assistantStateRoot: `${vault}/.runtime/operations/assistant`,
  })),
  resolveOperatorConfigPath: vi.fn(() => '/tmp/operator-config.json'),
  runAssistantAutomation: vi.fn(),
  runAssistantChat: vi.fn(),
  runAssistantDoctor: vi.fn(),
  saveAssistantSelfDeliveryTarget: vi.fn(),
  sendAssistantMessage: vi.fn(),
  shouldExposeSensitiveHealthContext: vi.fn(),
  stopAssistantAutomation: vi.fn(),
}))

vi.mock('../src/assistant/runtime.js', () => ({
  runAssistantAutomation: commandMocks.runAssistantAutomation,
  runAssistantChat: commandMocks.runAssistantChat,
  sendAssistantMessage: commandMocks.sendAssistantMessage,
  stopAssistantAutomation: commandMocks.stopAssistantAutomation,
}))

vi.mock('../src/assistant/doctor.js', () => ({
  runAssistantDoctor: commandMocks.runAssistantDoctor,
}))

vi.mock('../src/assistant/status.js', () => ({
  getAssistantStatus: commandMocks.getAssistantStatus,
}))

vi.mock('@murphai/assistant-engine/outbound-channel', () => ({
  deliverAssistantMessage: commandMocks.deliverAssistantMessage,
}))

vi.mock(
  '@murphai/operator-config/operator-config',
  async () => {
    const actual = await vi.importActual<
      typeof import('@murphai/operator-config/operator-config')
    >('@murphai/operator-config/operator-config')

    return {
      ...actual,
      applyAssistantSelfDeliveryTargetDefaults:
        commandMocks.applyAssistantSelfDeliveryTargetDefaults,
      clearAssistantSelfDeliveryTargets:
        commandMocks.clearAssistantSelfDeliveryTargets,
      listAssistantSelfDeliveryTargets:
        commandMocks.listAssistantSelfDeliveryTargets,
      resolveOperatorConfigPath: commandMocks.resolveOperatorConfigPath,
      saveAssistantSelfDeliveryTarget:
        commandMocks.saveAssistantSelfDeliveryTarget,
    }
  },
)

vi.mock('@murphai/assistant-engine/assistant-state', () => ({
  redactAssistantDisplayPath: commandMocks.redactAssistantDisplayPath,
  getAssistantSession: commandMocks.getAssistantSession,
  listAssistantSessions: commandMocks.listAssistantSessions,
  resolveAssistantStatePaths: commandMocks.resolveAssistantStatePaths,
}))

vi.mock('@murphai/assistant-engine/assistant-runtime', () => ({
  redactAssistantSessionForDisplay: commandMocks.redactAssistantSessionForDisplay,
  redactAssistantSessionsForDisplay: commandMocks.redactAssistantSessionsForDisplay,
  resolveAssistantConversationAutoReplyEligibility:
    commandMocks.resolveAssistantConversationAutoReplyEligibility,
  resolveAssistantConversationAudience:
    commandMocks.resolveAssistantConversationAudience,
  resolveAssistantConversationPolicy:
    commandMocks.resolveAssistantConversationPolicy,
  shouldExposeSensitiveHealthContext:
    commandMocks.shouldExposeSensitiveHealthContext,
}))

import {
  registerAssistantCommands,
} from '../src/commands/assistant.js'

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v4',
  sessionId: 'session-command-coverage',
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
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
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
}

const TEST_ASK_RESULT = {
  vault: '/tmp/vault',
  status: 'completed',
  prompt: 'hello from command coverage',
  response: 'assistant response',
  session: TEST_SESSION,
  delivery: null,
  deliveryDeferred: false,
  deliveryIntentId: null,
  deliveryError: null,
}

function createAssistantCli() {
  const cli = Cli.create('assistant-cli-test', {
    description: 'assistant cli test',
  })

  registerAssistantCommands(cli, {} as InboxServices)

  const commands = Cli.toCommands.get(cli)
  if (!commands) {
    throw new Error('Expected assistant commands to be registered.')
  }
  return commands
}

function readCommandGroup(
  commands: Map<string, unknown>,
  name: string,
): {
  commands: Map<string, unknown>
} {
  const group = commands.get(name) as { commands: Map<string, unknown> } | undefined
  if (!group) {
    throw new Error(`Expected command group ${name} to be registered.`)
  }
  return group
}

function readCommand(
  commands: Map<string, unknown>,
  name: string,
): {
  description?: string
  hint?: string
  options?: {
    shape: Record<string, { description?: string } | undefined>
  }
  outputPolicy?: string
  run: (context: Record<string, unknown>) => Promise<unknown>
} {
  const command = commands.get(name) as
    | {
        description?: string
        hint?: string
        options?: {
          shape: Record<string, { description?: string } | undefined>
        }
        outputPolicy?: string
        run: (context: Record<string, unknown>) => Promise<unknown>
      }
    | undefined
  if (!command) {
    throw new Error(`Expected command ${name} to be registered.`)
  }
  return command
}

function readOptionDescription(
  command: {
    options?: {
      shape: Record<string, { description?: string } | undefined>
    }
  },
  optionName: string,
): string | undefined {
  return command.options?.shape[optionName]?.description
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  for (const mock of Object.values(commandMocks)) {
    mock.mockReset()
  }

  commandMocks.redactAssistantDisplayPath.mockImplementation(
    (value: string) => `redacted:${value}`,
  )
  commandMocks.redactAssistantSessionForDisplay.mockImplementation((value) => value)
  commandMocks.redactAssistantSessionsForDisplay.mockImplementation((value) => value)
  commandMocks.resolveAssistantStatePaths.mockImplementation((vault: string) => ({
    assistantStateRoot: `${vault}/.runtime/operations/assistant`,
  }))
  commandMocks.resolveOperatorConfigPath.mockReturnValue('/tmp/operator-config.json')
})

test('assistant command registration exposes the owned subcommands and root aliases', () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const selfTarget = readCommandGroup(assistant.commands, 'self-target')
  const session = readCommandGroup(assistant.commands, 'session')

  assert.deepEqual([...assistant.commands.keys()], [
    'ask',
    'chat',
    'deliver',
    'run',
    'self-target',
    'status',
    'doctor',
    'stop',
    'session',
  ])
  assert.deepEqual([...selfTarget.commands.keys()], ['list', 'show', 'set', 'clear'])
  assert.deepEqual([...session.commands.keys()], ['list', 'show'])
  assert.equal(readCommand(assistant.commands, 'chat').outputPolicy, 'agent-only')
  assert.equal(readCommand(commands, 'chat').description?.includes('assistant chat'), true)
  assert.equal(readCommand(commands, 'run').description?.includes('assistant run'), true)
  assert.equal(readCommand(commands, 'status').description?.includes('assistant status'), true)
  assert.equal(readCommand(commands, 'doctor').description?.includes('assistant doctor'), true)
  assert.equal(readCommand(commands, 'stop').description?.includes('assistant stop'), true)
})

test('assistant ask resolves saved delivery defaults and forwards parsed provider overrides', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const ask = readCommand(assistant.commands, 'ask')

  commandMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
    channel: 'telegram',
    identityId: 'identity_saved',
    participantId: 'participant_saved',
    sourceThreadId: 'thread_saved',
    deliveryTarget: 'telegram:thread_saved',
  })
  commandMocks.sendAssistantMessage.mockResolvedValueOnce(TEST_ASK_RESULT)

  const result = await ask.run({
    args: {
      prompt: 'hello from command coverage',
    },
    options: {
      alias: 'chat:demo',
      apiKeyEnv: 'OLLAMA_API_KEY',
      approvalPolicy: 'never',
      baseUrl: 'http://127.0.0.1:11434/v1',
      channel: 'linq',
      codexCommand: 'codex-bin',
      deliverResponse: true,
      deliveryTarget: 'chat_original',
      headersJson: '{"x-trace":"1"}',
      identity: 'identity_cli',
      model: 'gpt-5.4',
      oss: true,
      participant: 'participant_cli',
      profile: 'ops',
      provider: 'openai-compatible',
      providerName: 'ollama',
      sandbox: 'workspace-write',
      session: undefined,
      sourceThread: 'thread_cli',
      vault: '/tmp/vault',
    },
  })

  assert.equal(result, TEST_ASK_RESULT)
  assert.equal(
    commandMocks.applyAssistantSelfDeliveryTargetDefaults.mock.calls.length,
    1,
  )
  assert.deepEqual(
    commandMocks.applyAssistantSelfDeliveryTargetDefaults.mock.calls[0]?.[0],
    {
      channel: 'linq',
      deliveryTarget: 'chat_original',
      identityId: 'identity_cli',
      participantId: 'participant_cli',
      sourceThreadId: 'thread_cli',
    },
  )
  assert.deepEqual(
    commandMocks.applyAssistantSelfDeliveryTargetDefaults.mock.calls[0]?.[1],
    {
      allowSingleSavedTargetFallback: true,
    },
  )
  assert.deepEqual(commandMocks.sendAssistantMessage.mock.calls[0]?.[0], {
    alias: 'chat:demo',
    apiKeyEnv: 'OLLAMA_API_KEY',
    approvalPolicy: 'never',
    baseUrl: 'http://127.0.0.1:11434/v1',
    channel: 'telegram',
    codexCommand: 'codex-bin',
    deliverResponse: true,
    deliveryTarget: 'telegram:thread_saved',
    headers: {
      'x-trace': '1',
    },
    identityId: 'identity_saved',
    model: 'gpt-5.4',
    oss: true,
    participantId: 'participant_saved',
    profile: 'ops',
    prompt: 'hello from command coverage',
    provider: 'openai-compatible',
    providerName: 'ollama',
    sandbox: 'workspace-write',
    sessionId: undefined,
    sourceThreadId: 'thread_saved',
    vault: '/tmp/vault',
  })
})

test('assistant chat writes a resume hint only for human non-explicit output', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const chat = readCommand(assistant.commands, 'chat')
  const stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true)

  commandMocks.runAssistantChat.mockResolvedValue({
    session: TEST_SESSION,
    startedAt: '2026-04-08T00:00:00.000Z',
    stoppedAt: '2026-04-08T00:00:01.000Z',
    turns: 1,
    vault: '/tmp/vault',
  })

  await chat.run({
    agent: false,
    args: {
      prompt: 'hello',
    },
    formatExplicit: false,
    options: {
      vault: '/tmp/vault',
    },
  })
  await chat.run({
    agent: true,
    args: {
      prompt: 'hello again',
    },
    formatExplicit: false,
    options: {
      vault: '/tmp/vault',
    },
  })

  assert.equal(commandMocks.runAssistantChat.mock.calls.length, 2)
  assert.equal(stderrWrite.mock.calls.length, 1)
  assert.equal(
    String(stderrWrite.mock.calls[0]?.[0]),
    'Resume chat by typing: murph chat --session "session-command-coverage"\n',
  )
})

test('assistant deliver resolves saved routes unless a session is provided', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const deliver = readCommand(assistant.commands, 'deliver')

  commandMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
    channel: 'email',
    identityId: 'inbox_saved',
    participantId: 'recipient_saved@example.com',
    sourceThreadId: 'thread_saved',
    deliveryTarget: 'recipient_saved@example.com',
  })
  commandMocks.deliverAssistantMessage.mockResolvedValueOnce({
    delivered: true,
  })

  await deliver.run({
    args: {
      message: 'Delivery test message',
    },
    options: {
      channel: 'telegram',
      deliveryTarget: 'ignored_target',
      identity: 'identity_cli',
      participant: 'participant_cli',
      session: undefined,
      sourceThread: 'thread_cli',
      vault: '/tmp/vault',
    },
  })
  await deliver.run({
    args: {
      message: 'Reuse the existing session',
    },
    options: {
      deliveryTarget: 'session_override',
      session: 'session_existing',
      vault: '/tmp/vault',
    },
  })

  assert.equal(
    commandMocks.applyAssistantSelfDeliveryTargetDefaults.mock.calls.length,
    1,
  )
  assert.deepEqual(commandMocks.deliverAssistantMessage.mock.calls[0]?.[0], {
    alias: undefined,
    channel: 'email',
    identityId: 'inbox_saved',
    message: 'Delivery test message',
    participantId: 'recipient_saved@example.com',
    sessionId: undefined,
    sourceThreadId: 'thread_saved',
    target: 'recipient_saved@example.com',
    vault: '/tmp/vault',
  })
  assert.deepEqual(commandMocks.deliverAssistantMessage.mock.calls[1]?.[0], {
    alias: undefined,
    channel: undefined,
    identityId: undefined,
    message: 'Reuse the existing session',
    participantId: undefined,
    sessionId: 'session_existing',
    sourceThreadId: undefined,
    target: 'session_override',
    vault: '/tmp/vault',
  })
})

test('assistant run forwards automation options and emits formatted foreground logs', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const run = readCommand(assistant.commands, 'run')
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)

  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'))
  vi.stubEnv('UNSAFE_FOREGROUND_LOG_DETAILS', '0')
  commandMocks.runAssistantAutomation.mockImplementationOnce(
    async (input: {
      onEvent?: (event: {
        captureId?: string
        details?: string
        type: string
      }) => void
      onInboxEvent?: (event: {
        capture?: {
          text?: string
        }
        phase?: string
        source?: string
        type: string
      }) => void
    }) => {
    input.onEvent?.({
      captureId: 'cap_123',
      details: 'raw provider output',
      type: 'capture.replied',
    })
    input.onInboxEvent?.({
      capture: {
        text: 'Imported message',
      },
      phase: 'watch',
      source: 'telegram',
      type: 'capture.imported',
    })
    return {
      queued: 0,
      scanned: 1,
      status: 'completed',
    }
    },
  )

  const result = await run.run({
    options: {
      allowSelfAuthored: true,
      apiKey: 'secret',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headersJson: '{"x-route":"triage"}',
      maxPerScan: 3,
      model: 'gpt-5.4',
      once: true,
      providerName: 'ollama',
      requestId: 'req_assistant_run',
      scanIntervalMs: 2500,
      sessionRolloverHours: 2,
      skipDaemon: true,
      vault: '/tmp/vault',
    },
  })

  assert.deepEqual(result, {
    queued: 0,
    scanned: 1,
    status: 'completed',
  })
  assert.deepEqual(commandMocks.runAssistantAutomation.mock.calls[0]?.[0], {
    allowSelfAuthored: true,
    inboxServices: {},
    maxPerScan: 3,
    modelSpec: {
      apiKey: 'secret',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: {
        'x-route': 'triage',
      },
      model: 'gpt-5.4',
      providerName: 'ollama',
    },
    once: true,
    requestId: 'req_assistant_run',
    scanIntervalMs: 2500,
    sessionMaxAgeMs: 7_200_000,
    startDaemon: false,
    vault: '/tmp/vault',
    vaultServices: undefined,
    onEvent: commandMocks.runAssistantAutomation.mock.calls[0]?.[0].onEvent,
    onInboxEvent:
      commandMocks.runAssistantAutomation.mock.calls[0]?.[0].onInboxEvent,
  })
  assert.equal(consoleError.mock.calls.length, 2)
  assert.match(String(consoleError.mock.calls[0]?.[0]), /^\[assistant \d{2}:\d{2}:\d{2}\] replied cap_123$/u)
  assert.match(
    String(consoleError.mock.calls[1]?.[0]),
    /^\[assistant \d{2}:\d{2}:\d{2}\] new Telegram capture imported: text$/u,
  )
})

test('status, doctor, and stop commands delegate to their runtime helpers', async () => {
  const commands = createAssistantCli()

  commandMocks.getAssistantStatus.mockResolvedValueOnce({
    limit: 4,
    sessionId: 'session_status',
  })
  commandMocks.runAssistantDoctor.mockResolvedValueOnce({
    repaired: true,
  })
  commandMocks.stopAssistantAutomation.mockResolvedValueOnce({
    stopped: true,
  })

  const statusResult = await readCommand(commands, 'status').run({
    options: {
      limit: 4,
      session: 'session_status',
      vault: '/tmp/vault',
    },
  })
  const doctorResult = await readCommand(commands, 'doctor').run({
    options: {
      repair: true,
      vault: '/tmp/vault',
    },
  })
  const stopResult = await readCommand(commands, 'stop').run({
    options: {
      vault: '/tmp/vault',
    },
  })

  assert.deepEqual(statusResult, {
    limit: 4,
    sessionId: 'session_status',
  })
  assert.deepEqual(doctorResult, {
    repaired: true,
  })
  assert.deepEqual(stopResult, {
    stopped: true,
  })
  assert.deepEqual(commandMocks.getAssistantStatus.mock.calls[0]?.[0], {
    limit: 4,
    sessionId: 'session_status',
    vault: '/tmp/vault',
  })
  assert.deepEqual(commandMocks.runAssistantDoctor.mock.calls[0], [
    '/tmp/vault',
    {
      repair: true,
    },
  ])
  assert.deepEqual(commandMocks.stopAssistantAutomation.mock.calls[0]?.[0], {
    vault: '/tmp/vault',
  })
})

test('self-target commands normalize channels, enforce email identity, and surface config paths', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const selfTarget = readCommandGroup(assistant.commands, 'self-target')

  const savedTargets = [
    {
      channel: 'telegram',
      deliveryTarget: '@murph',
    },
  ]
  commandMocks.listAssistantSelfDeliveryTargets.mockResolvedValue(savedTargets)
  commandMocks.saveAssistantSelfDeliveryTarget.mockResolvedValueOnce({
    channel: 'email',
    deliveryTarget: 'recipient@example.com',
    identityId: 'inbox_123',
    participantId: null,
    sourceThreadId: null,
  })
  commandMocks.clearAssistantSelfDeliveryTargets.mockResolvedValueOnce(['telegram'])

  const listResult = await readCommand(selfTarget.commands, 'list').run({
    args: {},
    options: {},
  })
  const showResult = await readCommand(selfTarget.commands, 'show').run({
    args: {
      channel: '  TELEGRAM  ',
    },
    options: {},
  })

  await assert.rejects(
    () =>
      readCommand(selfTarget.commands, 'set').run({
        args: {
          channel: 'telegram',
        },
        options: {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(
        error.message.includes(
          'require at least --participant, --sourceThread, or --deliveryTarget',
        ),
        true,
      )
      return true
    },
  )

  await assert.rejects(
    () =>
      readCommand(selfTarget.commands, 'set').run({
        args: {
          channel: 'email',
        },
        options: {
          deliveryTarget: 'recipient@example.com',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.message.includes('require --identity'), true)
      return true
    },
  )

  const setResult = await readCommand(selfTarget.commands, 'set').run({
    args: {
      channel: '  Email  ',
    },
    options: {
      deliveryTarget: 'recipient@example.com',
      identity: 'inbox_123',
    },
  })
  const clearResult = await readCommand(selfTarget.commands, 'clear').run({
    args: {
      channel: 'telegram',
    },
    options: {},
  })

  assert.deepEqual(listResult, {
    configPath: 'redacted:/tmp/operator-config.json',
    targets: savedTargets,
  })
  assert.deepEqual(showResult, {
    configPath: 'redacted:/tmp/operator-config.json',
    target: savedTargets[0],
  })
  assert.deepEqual(setResult, {
    configPath: 'redacted:/tmp/operator-config.json',
    target: {
      channel: 'email',
      deliveryTarget: 'recipient@example.com',
      identityId: 'inbox_123',
      participantId: null,
      sourceThreadId: null,
    },
  })
  assert.deepEqual(clearResult, {
    clearedChannels: ['telegram'],
    configPath: 'redacted:/tmp/operator-config.json',
  })
  assert.deepEqual(commandMocks.saveAssistantSelfDeliveryTarget.mock.calls[0]?.[0], {
    channel: 'email',
    deliveryTarget: 'recipient@example.com',
    identityId: 'inbox_123',
    participantId: null,
    sourceThreadId: null,
  })
})

test('assistant command help describes routing shapes and flat header JSON inputs', () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const ask = readCommand(assistant.commands, 'ask')
  const deliver = readCommand(assistant.commands, 'deliver')
  const run = readCommand(assistant.commands, 'run')
  const selfTargetSet = readCommand(
    readCommandGroup(assistant.commands, 'self-target').commands,
    'set',
  )

  assert.equal(
    readOptionDescription(ask, 'participant')?.includes(
      'transport-native participant value',
    ),
    true,
  )
  assert.equal(
    readOptionDescription(ask, 'sourceThread')?.includes(
      '<chatId>:topic:<messageThreadId>',
    ),
    true,
  )
  assert.equal(
    readOptionDescription(deliver, 'deliveryTarget')?.includes(
      'transport-native send format',
    ),
    true,
  )
  assert.equal(
    readOptionDescription(ask, 'headersJson')?.includes(
      'flat JSON object of extra HTTP headers with string values',
    ),
    true,
  )
  assert.equal(
    readOptionDescription(run, 'headersJson')?.includes(
      'flat JSON object of extra HTTP headers with string values',
    ),
    true,
  )
  assert.equal(
    selfTargetSet.description?.includes(
      'Provide at least one of --participant, --sourceThread, or --deliveryTarget',
    ),
    true,
  )
  assert.equal(
    selfTargetSet.hint?.includes(
      'Saved email targets also require --identity with the configured AgentMail inbox id.',
    ),
    true,
  )
  assert.equal(
    readOptionDescription(selfTargetSet, 'identity')?.includes(
      'Email targets require the configured AgentMail inbox id here.',
    ),
    true,
  )
})

test('session commands return redacted state paths and session payloads', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const session = readCommandGroup(assistant.commands, 'session')

  commandMocks.listAssistantSessions.mockResolvedValueOnce([TEST_SESSION])
  commandMocks.getAssistantSession.mockResolvedValueOnce(TEST_SESSION)
  commandMocks.redactAssistantSessionsForDisplay.mockReturnValueOnce([
    {
      ...TEST_SESSION,
      alias: 'redacted-alias',
    },
  ])
  commandMocks.redactAssistantSessionForDisplay.mockReturnValueOnce({
    ...TEST_SESSION,
    alias: 'redacted-single',
  })

  const listResult = await readCommand(session.commands, 'list').run({
    options: {
      vault: '/tmp/vault',
    },
  })
  const showResult = await readCommand(session.commands, 'show').run({
    args: {
      sessionId: TEST_SESSION.sessionId,
    },
    options: {
      vault: '/tmp/vault',
    },
  })

  assert.deepEqual(listResult, {
    sessions: [
      {
        ...TEST_SESSION,
        alias: 'redacted-alias',
      },
    ],
    stateRoot: 'redacted:/tmp/vault/.runtime/operations/assistant',
    vault: 'redacted:/tmp/vault',
  })
  assert.deepEqual(showResult, {
    session: {
      ...TEST_SESSION,
      alias: 'redacted-single',
    },
    stateRoot: 'redacted:/tmp/vault/.runtime/operations/assistant',
    vault: 'redacted:/tmp/vault',
  })
})
