import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { beforeEach, test, vi } from 'vitest'
import {
  type AssistantOnboardingState,
  assistantOnboardingCompletionReasonValues,
  assistantOnboardingResultSchema,
  assistantOnboardingResumeContextResultSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createUnwiredVaultServices, type VaultServices } from '@murphai/vault-usecases'

const commandMocks = vi.hoisted(() => ({
  completeAssistantOnboarding: vi.fn(),
  readAssistantOnboardingState: vi.fn(),
  reopenAssistantOnboarding: vi.fn(),
  redactAssistantDisplayPath: vi.fn((value: string) => `redacted:${value}`),
  resolveAssistantOnboardingStatePath: vi.fn((vault: string) => `${vault}/.runtime/operations/assistant/state/onboarding/conversation.json`),
  resolveAssistantStatePaths: vi.fn((vault: string) => ({ assistantStateRoot: `${vault}/.runtime/operations/assistant` })),
}))
vi.mock('@murphai/assistant-engine/assistant-state', () => commandMocks)
import { registerAssistantOnboardingCommands } from '../src/commands/assistant-onboarding.js'
beforeEach(() => { vi.clearAllMocks() })

const TEST_ONBOARDING_STATE: AssistantOnboardingState = {
  schemaVersion: 'murph.assistant-onboarding.v1',
  status: 'completed',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:05:00.000Z',
  completedAt: '2026-04-23T00:05:00.000Z',
  completedReason: 'user_answered',
}

function createAssistantCli(services?: VaultServices) {
  const cli = Cli.create('assistant-cli-test', {
    description: 'assistant cli test',
  })

  registerAssistantOnboardingCommands(cli, services)

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

test('assistant owns only the four hosted onboarding commands', () => {
  const commands = createAssistantCli()
  assert.deepEqual([...commands.keys()], ['assistant'])
  const assistant = readCommandGroup(commands, 'assistant')
  assert.deepEqual([...assistant.commands.keys()], ['onboarding'])
  assert.deepEqual([...readCommandGroup(assistant.commands, 'onboarding').commands.keys()], ['status', 'resume-context', 'complete', 'reopen'])
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
    items: [{
      id: 'goal_sleep',
      kind: 'goal',
      title: 'Sleep better',
      occurredAt: null,
      path: 'bank/goals/sleep-better.md',
      excerpt: 'Sleep better Status: active',
      data: { goalId: 'goal_sleep', title: 'Sleep better', status: 'active' },
      links: [],
    }],
  })
  const listRegimens = vi.fn().mockResolvedValue({
    count: 0,
    items: [],
  })
  const listSupplements = vi.fn().mockResolvedValue({
    count: 2,
    items: ['reg_creatine', 'reg_magnesium'].map((id) => ({
      id, kind: 'supplement', title: id, occurredAt: null, path: null, data: {}, links: [],
    })),
  })
  const listConditions = vi.fn().mockRejectedValue(new Error('boom'))
  const listAllergies = vi.fn().mockResolvedValue({
    count: 0,
    items: [],
  })
  const listExperiments = vi.fn().mockResolvedValue({
    count: 1,
    items: [{
      id: 'exp_walks',
      kind: 'experiment',
      title: 'Walks',
      occurredAt: null,
      path: 'bank/experiments/walks.md',
      data: { status: 'active' },
      links: [],
    }],
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
  assert.deepEqual(result.goals.items, [{
    id: 'goal_sleep',
    kind: 'goal',
    title: 'Sleep better',
    data: { status: 'active' },
  }])
  assert.equal(result.supplements.status, 'ok')
  assert.equal(result.supplements.count, 2)
  assert.equal(result.supplements.items.length, 1)
  assert.equal(result.supplements.truncated, true)
  assert.deepEqual(result.conditions, {
    status: 'error',
    code: 'read_failed',
    message: 'This onboarding context surface could not be read.',
    retryable: true,
    hint: 'Retry the context read; use the individual vault command if it continues to fail.',
  })
  assert.equal(JSON.stringify(result).includes('boom'), false)
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

test('assistant onboarding resume-context marks missing service surfaces unavailable', async () => {
  const services = createUnwiredVaultServices()
  const commands = createAssistantCli(services)
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

  assert.deepEqual(result.deviceAccounts, {
    status: 'unavailable',
    code: 'service_unavailable',
    message: 'This onboarding context surface is not available in the current runtime.',
    retryable: false,
    hint: 'Use a runtime with the matching service enabled to inspect this surface.',
  })
})
