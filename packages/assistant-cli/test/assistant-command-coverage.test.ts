import assert from 'node:assert/strict'

import { Cli } from 'incur'
import { beforeEach, test as baseTest, vi } from 'vitest'

import type {
  AssistantOnboardingState,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantOnboardingCompletionReasonValues,
  assistantOnboardingResultSchema,
  assistantOnboardingResumeContextResultSchema,
  assistantSessionListResultSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { InboxServices } from '@murphai/inbox-services'
import {
  createUnwiredVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'

const test = baseTest.sequential

const commandMocks = vi.hoisted(() => ({
  access: vi.fn(),
  assertAssistantInkInteractiveInputAvailable: vi.fn(),
  applyAssistantSelfDeliveryTargetDefaults: vi.fn(),
  clearAssistantSelfDeliveryTargets: vi.fn(),
  completeAssistantOnboarding: vi.fn(),
  deliverAssistantMessage: vi.fn(),
  getAssistantSession: vi.fn(),
  getAssistantStatus: vi.fn(),
  listAssistantSelfDeliveryTargets: vi.fn(),
  listAssistantSessions: vi.fn(),
  readAssistantOnboardingState: vi.fn(),
  redactAssistantDisplayPath: vi.fn((value: string) => `redacted:${value}`),
  redactAssistantSessionForDisplay: vi.fn((value) => value),
  redactAssistantSessionsForDisplay: vi.fn((value) => value),
  resolveAssistantSelfDeliveryTarget: vi.fn(),
  reopenAssistantOnboarding: vi.fn(),
  resolveAssistantConversationAudience: vi.fn(),
  resolveAssistantConversationPolicy: vi.fn(),
  resolveAssistantOnboardingStatePath: vi.fn((vault: string) =>
    `${vault}/.runtime/operations/assistant/state/onboarding/conversation.json`
  ),
  resolveAssistantStatePaths: vi.fn((vault: string) => ({
    assistantStateRoot: `${vault}/.runtime/operations/assistant`,
  })),
  resolveOperatorConfigPath: vi.fn(() => '/tmp/operator-config.json'),
  runAssistantAutomation: vi.fn(),
  runAssistantChat: vi.fn(),
  runAssistantDoctor: vi.fn(),
  saveAssistantSelfDeliveryTarget: vi.fn(),
  sendAssistantMessage: vi.fn(),
  stopAssistantAutomation: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  access: commandMocks.access,
}))

vi.mock('../src/assistant-runtime.js', () => ({
  runAssistantAutomation: commandMocks.runAssistantAutomation,
  runAssistantChat: commandMocks.runAssistantChat,
  sendAssistantMessage: commandMocks.sendAssistantMessage,
  stopAssistantAutomation: commandMocks.stopAssistantAutomation,
}))

vi.mock('../src/assistant-chat-ink.js', () => ({
  assertAssistantInkInteractiveInputAvailable:
    commandMocks.assertAssistantInkInteractiveInputAvailable,
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
      resolveAssistantSelfDeliveryTarget:
        commandMocks.resolveAssistantSelfDeliveryTarget,
      resolveOperatorConfigPath: commandMocks.resolveOperatorConfigPath,
      saveAssistantSelfDeliveryTarget:
        commandMocks.saveAssistantSelfDeliveryTarget,
    }
  },
)

vi.mock('@murphai/assistant-engine/assistant-state', () => ({
  completeAssistantOnboarding: commandMocks.completeAssistantOnboarding,
  readAssistantOnboardingState: commandMocks.readAssistantOnboardingState,
  redactAssistantDisplayPath: commandMocks.redactAssistantDisplayPath,
  getAssistantSession: commandMocks.getAssistantSession,
  listAssistantSessions: commandMocks.listAssistantSessions,
  reopenAssistantOnboarding: commandMocks.reopenAssistantOnboarding,
  resolveAssistantOnboardingStatePath:
    commandMocks.resolveAssistantOnboardingStatePath,
  resolveAssistantStatePaths: commandMocks.resolveAssistantStatePaths,
}))

vi.mock('@murphai/assistant-engine/assistant-runtime', () => ({
  redactAssistantSessionForDisplay: commandMocks.redactAssistantSessionForDisplay,
  redactAssistantSessionsForDisplay: commandMocks.redactAssistantSessionsForDisplay,
  resolveAssistantConversationAudience:
    commandMocks.resolveAssistantConversationAudience,
  resolveAssistantConversationPolicy:
    commandMocks.resolveAssistantConversationPolicy,
}))

import {
  registerAssistantCommands,
} from '../src/commands/assistant.js'

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-conversation.v2',
  conversationId: 'session-command-coverage',
  sessionId: 'session-command-coverage',
  codexTarget: {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
  },
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
  codexResume: null,
  resumeState: null,
  provider: 'codex-cli',
  providerOptions: {
    continuityFingerprint: 'fingerprint-command-coverage',
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    executionDriver: 'codex-app-server',
    provider: 'codex-cli',
    resumeKind: 'codex-thread',
  },
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

const TEST_ONBOARDING_STATE: AssistantOnboardingState = {
  schemaVersion: 'murph.assistant-onboarding.v1',
  status: 'completed',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:05:00.000Z',
  completedAt: '2026-04-23T00:05:00.000Z',
  completedReason: 'user_answered',
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

function createAssistantCli(services?: VaultServices) {
  const cli = Cli.create('assistant-cli-test', {
    description: 'assistant cli test',
  })

  registerAssistantCommands(cli, {} as InboxServices, services)

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

  commandMocks.access.mockResolvedValue(undefined)
  commandMocks.redactAssistantDisplayPath.mockImplementation(
    (value: string) => `redacted:${value}`,
  )
  commandMocks.redactAssistantSessionForDisplay.mockImplementation((value) => value)
  commandMocks.redactAssistantSessionsForDisplay.mockImplementation((value) => value)
  commandMocks.resolveAssistantStatePaths.mockImplementation((vault: string) => ({
    assistantStateRoot: `${vault}/.runtime/operations/assistant`,
  }))
  commandMocks.resolveAssistantOnboardingStatePath.mockImplementation(
    (vault: string) =>
      `${vault}/.runtime/operations/assistant/state/onboarding/conversation.json`,
  )
  commandMocks.resolveOperatorConfigPath.mockReturnValue('/tmp/operator-config.json')
})

test('assistant command registration exposes the owned subcommands and root aliases', () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const ask = readCommand(assistant.commands, 'ask')
  const chat = readCommand(assistant.commands, 'chat')
  const selfTarget = readCommandGroup(assistant.commands, 'self-target')
  const session = readCommandGroup(assistant.commands, 'session')
  const run = readCommand(commands, 'run')

  assert.deepEqual([...assistant.commands.keys()], [
    'ask',
    'chat',
    'deliver',
    'run',
    'self-target',
    'status',
    'doctor',
    'stop',
    'onboarding',
    'session',
  ])
  assert.deepEqual([...selfTarget.commands.keys()], ['list', 'show', 'set', 'clear'])
  assert.deepEqual([...session.commands.keys()], ['list', 'show'])
  assert.equal(Object.hasOwn(run.options?.shape ?? {}, 'skipDaemon'), false)
  assert.equal(Object.hasOwn(ask.options?.shape ?? {}, 'provider'), false)
  assert.equal(Object.hasOwn(ask.options?.shape ?? {}, 'oss'), false)
  assert.equal(Object.hasOwn(chat.options?.shape ?? {}, 'provider'), false)
  assert.equal(Object.hasOwn(chat.options?.shape ?? {}, 'oss'), false)
  assert.equal(readCommand(assistant.commands, 'chat').outputPolicy, 'agent-only')
  assert.equal(readCommand(commands, 'chat').description?.includes('assistant chat'), true)
  assert.equal(readCommand(commands, 'run').description?.includes('assistant run'), true)
  assert.equal(readCommand(commands, 'status').description?.includes('assistant status'), true)
  assert.equal(readCommand(commands, 'doctor').description?.includes('assistant doctor'), true)
  assert.equal(readCommand(commands, 'stop').description?.includes('assistant stop'), true)
})

test('assistant onboarding commands read and write the shared lifecycle state', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const onboarding = readCommandGroup(assistant.commands, 'onboarding')
  const status = readCommand(onboarding.commands, 'status')
  const resumeContext = readCommand(onboarding.commands, 'resume-context')
  const complete = readCommand(onboarding.commands, 'complete')
  const reopen = readCommand(onboarding.commands, 'reopen')

  assert.deepEqual([...assistantOnboardingCompletionReasonValues], [
    'user_answered',
    'user_declined',
    'manual',
  ])

  commandMocks.readAssistantOnboardingState.mockResolvedValueOnce(TEST_ONBOARDING_STATE)
  commandMocks.completeAssistantOnboarding.mockResolvedValueOnce({
    ...TEST_ONBOARDING_STATE,
    completedReason: 'user_declined',
  })
  commandMocks.reopenAssistantOnboarding.mockResolvedValueOnce({
    ...TEST_ONBOARDING_STATE,
    status: 'open',
    updatedAt: '2026-04-23T00:10:00.000Z',
    completedAt: null,
    completedReason: null,
  })

  const statusResult = assistantOnboardingResultSchema.parse(
    await status.run({
      args: {},
      options: {
        vault: '/tmp/vault',
      },
    }),
  )
  assert.equal(
    statusResult.statePath,
    'redacted:/tmp/vault/.runtime/operations/assistant/state/onboarding/conversation.json',
  )
  assert.equal(statusResult.onboarding.status, 'completed')

  const completeResult = assistantOnboardingResultSchema.parse(
    await complete.run({
      args: {},
      options: {
        reason: 'user_declined',
        vault: '/tmp/vault',
      },
    }),
  )
  assert.equal(commandMocks.completeAssistantOnboarding.mock.calls.length, 1)
  assert.deepEqual(commandMocks.completeAssistantOnboarding.mock.calls[0]?.[0], {
    reason: 'user_declined',
    vault: '/tmp/vault',
  })
  assert.equal(completeResult.onboarding.completedReason, 'user_declined')

  const reopenResult = assistantOnboardingResultSchema.parse(
    await reopen.run({
      args: {},
      options: {
        vault: '/tmp/vault',
      },
    }),
  )
  assert.equal(commandMocks.reopenAssistantOnboarding.mock.calls.length, 1)
  assert.deepEqual(commandMocks.reopenAssistantOnboarding.mock.calls[0]?.[0], {
    vault: '/tmp/vault',
  })
  assert.equal(reopenResult.onboarding.status, 'open')
  assert.equal(
    resumeContext.description?.includes('resume first-run onboarding'),
    true,
  )
})

test('assistant onboarding resume-context batches setup reads into one snapshot', async () => {
  const readMemoryDocument = vi.fn().mockResolvedValue({
    vault: '/tmp/vault',
    document: {
      exists: true,
      markdown: '',
      records: [
        {
          id: 'mem_name',
          section: 'identity',
          sourceLine: 1,
          text: 'Name is saved.',
        },
      ],
      sourcePath: 'bank/memory.md',
      updatedAt: '2026-04-23T00:00:00.000Z',
      frontmatter: {
        schemaVersion: 'murph.memory.v1',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    },
  })
  const listGoals = vi.fn().mockResolvedValue({
    count: 1,
    items: [{ id: 'goal_sleep', title: 'Sleep better' }],
  })
  const listRegimens = vi.fn().mockResolvedValue({
    count: 0,
    items: [],
  })
  const listSupplements = vi.fn().mockResolvedValue({
    count: 2,
    items: [{ id: 'reg_creatine' }, { id: 'reg_magnesium' }],
  })
  const listConditions = vi.fn().mockRejectedValue(new Error('boom'))
  const listAllergies = vi.fn().mockResolvedValue({
    count: 0,
    items: [],
  })
  const listExperiments = vi.fn().mockResolvedValue({
    count: 1,
    items: [{ id: 'exp_walks', status: 'active' }],
  })
  const listAccounts = vi.fn().mockResolvedValue({
    accounts: [{ id: 'dev_oura', provider: 'oura', status: 'active' }],
  })
  const services = createUnwiredVaultServices()
  services.query.readMemoryDocument = readMemoryDocument
  services.query.listGoals = listGoals
  services.query.listRegimens = listRegimens
  services.query.listSupplements = listSupplements
  services.query.listConditions = listConditions
  services.query.listAllergies = listAllergies
  services.query.listExperiments = listExperiments
  const servicesWithDevices = Object.assign(services, {
    devices: {
      listAccounts,
    },
  })
  const commands = createAssistantCli(servicesWithDevices)
  const assistant = readCommandGroup(commands, 'assistant')
  const onboarding = readCommandGroup(assistant.commands, 'onboarding')
  const resumeContext = readCommand(onboarding.commands, 'resume-context')

  commandMocks.readAssistantOnboardingState.mockResolvedValueOnce({
    ...TEST_ONBOARDING_STATE,
    status: 'open',
    completedAt: null,
    completedReason: null,
  })

  const result = assistantOnboardingResumeContextResultSchema.parse(
    await resumeContext.run({
      args: {},
      options: {
        limit: 1,
        vault: '/tmp/vault',
      },
    }),
  )

  assert.equal(result.vault, 'redacted:/tmp/vault')
  assert.equal(result.onboarding.status, 'open')
  assert.equal(result.memory.status, 'ok')
  assert.equal(result.memory.recordCount, 1)
  assert.equal(result.goals.status, 'ok')
  assert.equal(result.goals.count, 1)
  assert.equal(result.supplements.status, 'ok')
  assert.equal(result.supplements.count, 2)
  assert.equal(result.supplements.items.length, 1)
  assert.equal(result.supplements.truncated, true)
  assert.equal(result.conditions.status, 'error')
  assert.equal(result.deviceAccounts.status, 'ok')
  assert.equal(result.deviceAccounts.count, 1)
  assert.deepEqual(readMemoryDocument.mock.calls[0]?.[0], {
    requestId: null,
    vault: '/tmp/vault',
  })
  assert.deepEqual(listGoals.mock.calls[0]?.[0], {
    requestId: null,
    vault: '/tmp/vault',
    limit: 1,
  })
  assert.deepEqual(listAccounts.mock.calls[0]?.[0], {
    vault: '/tmp/vault',
  })
})

test('assistant ask resolves saved delivery defaults and forwards Codex overrides', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const ask = readCommand(assistant.commands, 'ask')

  commandMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
    channel: 'telegram',
    identityId: 'identity_saved',
    participantId: 'participant_saved',
    threadId: 'thread_saved',
    deliveryTarget: 'telegram:thread_saved',
  })
  commandMocks.sendAssistantMessage.mockResolvedValueOnce(TEST_ASK_RESULT)

  const result = await ask.run({
    args: {
      prompt: 'hello from command coverage',
    },
    options: {
      alias: 'chat:demo',
      approvalPolicy: 'never',
      channel: 'telegram',
      codexCommand: 'codex-bin',
      deliverResponse: true,
      deliveryTarget: 'chat_original',
      identity: 'identity_cli',
      model: 'gpt-5.4',
      participant: 'participant_cli',
      profile: 'ops',
      sandbox: 'workspace-write',
      session: undefined,
      thread: 'thread_cli',
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
      channel: 'telegram',
      deliveryTarget: 'chat_original',
      identityId: 'identity_cli',
      participantId: 'participant_cli',
      threadId: 'thread_cli',
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
    approvalPolicy: 'never',
    channel: 'telegram',
    codexCommand: 'codex-bin',
    codexHome: undefined,
    deliverResponse: true,
    deliveryTarget: 'telegram:thread_saved',
    identityId: 'identity_saved',
    model: 'gpt-5.4',
    modelProvider: undefined,
    participantId: 'participant_saved',
    profile: 'ops',
    prompt: 'hello from command coverage',
    reasoningEffort: undefined,
    sandbox: 'workspace-write',
    sessionId: undefined,
    threadId: 'thread_saved',
    vault: '/tmp/vault',
  })
})

test('assistant ask rejects saved Linq delivery routes for the local assistant surface', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const ask = readCommand(assistant.commands, 'ask')

  commandMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
    channel: 'linq',
    identityId: 'identity_saved',
    participantId: 'participant_saved',
    threadId: 'thread_saved',
    deliveryTarget: 'chat_saved',
  })

  await assert.rejects(
    () =>
      ask.run({
        args: {
          prompt: 'hello from command coverage',
        },
        options: {
          deliverResponse: true,
          session: undefined,
          vault: '/tmp/vault',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.match(error.message, /Linq\/iMessage routes are no longer supported/u)
      return true
    },
  )

  assert.equal(commandMocks.sendAssistantMessage.mock.calls.length, 0)
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
  assert.equal(
    commandMocks.assertAssistantInkInteractiveInputAvailable.mock.calls.length,
    2,
  )
  assert.equal(stderrWrite.mock.calls.length, 1)
  assert.equal(
    String(stderrWrite.mock.calls[0]?.[0]),
    'Resume chat by typing: murph chat --session "session-command-coverage"\n',
  )
})

test('assistant chat fails before delegating to the runtime when interactive input is unavailable', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const chat = readCommand(assistant.commands, 'chat')
  const inputError = new Error('interactive input unavailable')

  commandMocks.assertAssistantInkInteractiveInputAvailable.mockImplementationOnce(
    () => {
      throw inputError
    },
  )

  await assert.rejects(
    () =>
      chat.run({
        agent: false,
        args: {
          prompt: 'hello',
        },
        formatExplicit: false,
        options: {
          vault: '/tmp/vault',
        },
      }),
    inputError,
  )

  assert.equal(commandMocks.runAssistantChat.mock.calls.length, 0)
})

test('assistant deliver resolves saved routes unless a session is provided', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const deliver = readCommand(assistant.commands, 'deliver')

  commandMocks.applyAssistantSelfDeliveryTargetDefaults.mockResolvedValueOnce({
    channel: 'email',
    identityId: 'inbox_saved',
    participantId: 'recipient_saved@example.com',
    threadId: 'thread_saved',
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
      thread: 'thread_cli',
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
    threadId: 'thread_saved',
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
    threadId: undefined,
    target: 'session_override',
    vault: '/tmp/vault',
  })
})

test('assistant deliver rejects serialized object delivery targets before sending', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const deliver = readCommand(assistant.commands, 'deliver')

  await assert.rejects(
    () =>
      deliver.run({
        args: {
          message: 'Delivery test message',
        },
        options: {
          channel: 'telegram',
          deliveryTarget: '[object Object]',
          vault: '/tmp/vault',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'invalid_option')
      assert.match(error.message, /transport-native string/u)
      return true
    },
  )

  assert.equal(commandMocks.deliverAssistantMessage.mock.calls.length, 0)
})

test('assistant deliver validates overrides against the session channel before sending', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const deliver = readCommand(assistant.commands, 'deliver')

  commandMocks.getAssistantSession.mockResolvedValueOnce({
    ...TEST_SESSION,
    binding: {
      ...TEST_SESSION.binding,
      channel: 'email',
      identityId: 'inbox_123',
      threadId: 'thread_123',
      delivery: {
        kind: 'thread',
        target: 'thread_123',
      },
    },
  } satisfies AssistantSession)

  await assert.rejects(
    () =>
      deliver.run({
        args: {
          message: 'Reuse the existing email session',
        },
        options: {
          deliveryTarget: 'not-an-email-target',
          session: 'session-email',
          vault: '/tmp/vault',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'invalid_option')
      assert.match(error.message, /Email delivery targets/u)
      return true
    },
  )

  assert.equal(commandMocks.deliverAssistantMessage.mock.calls.length, 0)
})

test('assistant deliver preflights existing sessions before sending', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const deliver = readCommand(assistant.commands, 'deliver')
  const sessionError = new VaultCliError(
    'assistant_session_not_found',
    'Assistant session "session_missing" does not exist.',
  )

  commandMocks.getAssistantSession.mockRejectedValueOnce(sessionError)

  await assert.rejects(
    () =>
      deliver.run({
        args: {
          message: 'Reuse the existing session',
        },
        options: {
          deliveryTarget: 'session_override',
          session: 'session_missing',
          vault: '/tmp/vault',
        },
      }),
    sessionError,
  )

  assert.deepEqual(commandMocks.getAssistantSession.mock.calls[0], [
    '/tmp/vault',
    'session_missing',
  ])
  assert.equal(commandMocks.deliverAssistantMessage.mock.calls.length, 0)
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
        inputId?: string
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
      inputId: 'ain_123',
      details: 'raw provider output',
      type: 'input.replied',
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
      maxPerScan: 3,
      once: true,
      requestId: 'req_assistant_run',
      sessionRolloverHours: 2,
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
    once: true,
    requestId: 'req_assistant_run',
    sessionMaxAgeMs: 7_200_000,
    startDaemon: false,
    vault: '/tmp/vault',
    vaultServices: undefined,
    onEvent: commandMocks.runAssistantAutomation.mock.calls[0]?.[0].onEvent,
    onInboxEvent:
      commandMocks.runAssistantAutomation.mock.calls[0]?.[0].onInboxEvent,
  })
  assert.equal(consoleError.mock.calls.length, 2)
  assert.match(String(consoleError.mock.calls[0]?.[0]), /^\[assistant \d{2}:\d{2}:\d{2}\] replied ain_123$/u)
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
  assert.deepEqual(commandMocks.getAssistantSession.mock.calls[0], [
    '/tmp/vault',
    'session_status',
  ])
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

test('assistant status and session commands reject uninitialized vault roots before runtime reads', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const session = readCommandGroup(assistant.commands, 'session')
  const missingVaultError = Object.assign(new Error('missing vault metadata'), {
    code: 'ENOENT',
  })
  const assertInvalidVaultError = (error: unknown) => {
    assert.ok(error instanceof VaultCliError)
    assert.equal(error.code, 'invalid_vault')
    assert.match(error.message, /not initialized/u)
    return true
  }

  commandMocks.access.mockRejectedValue(missingVaultError)

  await assert.rejects(
    () =>
      readCommand(assistant.commands, 'status').run({
        options: {
          limit: 3,
          vault: '/tmp/not-vault',
        },
      }),
    assertInvalidVaultError,
  )
  await assert.rejects(
    () =>
      readCommand(session.commands, 'list').run({
        args: {},
        options: {
          vault: '/tmp/not-vault',
        },
      }),
    assertInvalidVaultError,
  )
  await assert.rejects(
    () =>
      readCommand(session.commands, 'show').run({
        args: {
          sessionId: 'session_missing',
        },
        options: {
          vault: '/tmp/not-vault',
        },
      }),
    assertInvalidVaultError,
  )

  assert.equal(commandMocks.getAssistantStatus.mock.calls.length, 0)
  assert.equal(commandMocks.getAssistantSession.mock.calls.length, 0)
  assert.equal(commandMocks.listAssistantSessions.mock.calls.length, 0)
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
  commandMocks.resolveAssistantSelfDeliveryTarget.mockResolvedValueOnce({
    channel: 'linq',
    deliveryTarget: 'chat-123',
    identityId: 'identity-1',
    participantId: null,
    threadId: 'chat-123',
  })
  commandMocks.saveAssistantSelfDeliveryTarget.mockResolvedValueOnce({
    channel: 'email',
    deliveryTarget: 'recipient@example.com',
    identityId: 'inbox_123',
    participantId: null,
    threadId: null,
  })
  commandMocks.clearAssistantSelfDeliveryTargets.mockResolvedValueOnce(['linq'])

  const listResult = await readCommand(selfTarget.commands, 'list').run({
    args: {},
    options: {},
  })
  const showResult = await readCommand(selfTarget.commands, 'show').run({
    args: {
      channel: '  iMessage  ',
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
          'require at least --participant, --thread, or --deliveryTarget',
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

  await assert.rejects(
    () =>
      readCommand(selfTarget.commands, 'set').run({
        args: {
          channel: 'linq',
        },
        options: {
          deliveryTarget: 'chat_123',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.match(error.message, /Linq\/iMessage routes are no longer supported/u)
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
      channel: 'i-message',
    },
    options: {},
  })

  assert.deepEqual(listResult, {
    configPath: 'redacted:/tmp/operator-config.json',
    targets: savedTargets,
  })
  assert.deepEqual(showResult, {
    configPath: 'redacted:/tmp/operator-config.json',
    target: {
      channel: 'linq',
      deliveryTarget: 'chat-123',
      identityId: 'identity-1',
      participantId: null,
      threadId: 'chat-123',
    },
  })
  assert.deepEqual(setResult, {
    configPath: 'redacted:/tmp/operator-config.json',
    target: {
      channel: 'email',
      deliveryTarget: 'recipient@example.com',
      identityId: 'inbox_123',
      participantId: null,
      threadId: null,
    },
  })
  assert.deepEqual(clearResult, {
    clearedChannels: ['linq'],
    configPath: 'redacted:/tmp/operator-config.json',
  })
  assert.deepEqual(
    commandMocks.resolveAssistantSelfDeliveryTarget.mock.calls[0]?.[0],
    '  iMessage  ',
  )
  assert.deepEqual(
    commandMocks.clearAssistantSelfDeliveryTargets.mock.calls[0]?.[0],
    'linq',
  )
  assert.deepEqual(commandMocks.saveAssistantSelfDeliveryTarget.mock.calls[0]?.[0], {
    channel: 'email',
    deliverySource: null,
    deliveryTarget: 'recipient@example.com',
    identityId: 'inbox_123',
    participantId: null,
    threadId: null,
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
    readOptionDescription(ask, 'thread')?.includes(
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
    readOptionDescription(ask, 'headersJson'),
    undefined,
  )
  assert.equal(
    readOptionDescription(run, 'headersJson'),
    undefined,
  )
  assert.equal(
    run.description?.includes('Telegram, Linq, or email'),
    false,
  )
  assert.equal(
    run.description?.includes('Telegram or email'),
    true,
  )
  assert.equal(
    selfTargetSet.description?.includes(
      'Provide at least one of --participant, --thread, or --deliveryTarget',
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
  commandMocks.redactAssistantSessionForDisplay
    .mockReturnValueOnce({
      ...TEST_SESSION,
      alias: 'redacted-alias',
    })
    .mockReturnValueOnce({
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
    filters: {
      limit: 5,
    },
    count: 1,
    sessions: [
      {
        schema: TEST_SESSION.schema,
        conversationId: TEST_SESSION.conversationId,
        sessionId: TEST_SESSION.sessionId,
        alias: 'redacted-alias',
        binding: TEST_SESSION.binding,
        createdAt: TEST_SESSION.createdAt,
        updatedAt: TEST_SESSION.updatedAt,
        lastTurnAt: TEST_SESSION.lastTurnAt,
        turnCount: TEST_SESSION.turnCount,
        provider: TEST_SESSION.provider,
        model: null,
        modelProvider: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        executionDriver: 'codex-app-server',
        resumeKind: 'codex-thread',
        resumeThreadId: null,
      },
    ],
    stateRoot: 'redacted:/tmp/vault/.runtime/operations/assistant',
    vault: 'redacted:/tmp/vault',
  })
  assert.deepEqual(commandMocks.listAssistantSessions.mock.calls, [
    ['/tmp/vault', { limit: 5 }],
  ])
  assert.deepEqual(showResult, {
    session: {
      ...TEST_SESSION,
      alias: 'redacted-single',
    },
    stateRoot: 'redacted:/tmp/vault/.runtime/operations/assistant',
    vault: 'redacted:/tmp/vault',
  })
})

test('session list requests a bounded source-of-truth page', async () => {
  const commands = createAssistantCli()
  const assistant = readCommandGroup(commands, 'assistant')
  const session = readCommandGroup(assistant.commands, 'session')

  commandMocks.listAssistantSessions.mockResolvedValueOnce([TEST_SESSION])

  const listResult = assistantSessionListResultSchema.parse(
    await readCommand(session.commands, 'list').run({
      options: {
        vault: '/tmp/vault',
        limit: 1,
      },
    }),
  )

  assert.equal(listResult.count, 1)
  assert.equal(listResult.filters.limit, 1)
  assert.equal(listResult.sessions[0]?.sessionId, TEST_SESSION.sessionId)
  assert.deepEqual(commandMocks.listAssistantSessions.mock.calls, [
    ['/tmp/vault', { limit: 1 }],
  ])
})
