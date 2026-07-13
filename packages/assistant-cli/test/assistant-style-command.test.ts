import assert from 'node:assert/strict'

import type { InboxServices } from '@murphai/inbox-services'
import { assistantPersonalityResultSchema } from '@murphai/operator-config/assistant-style-cli-contracts'
import {
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { Cli, z } from 'incur'
import { afterEach, beforeEach, test, vi } from 'vitest'

const usecaseMocks = vi.hoisted(() => ({
  moduleLoads: 0,
  resetAllAssistantPersonalitySettings: vi.fn(),
  resetAssistantPersonalitySetting: vi.fn(),
  setAssistantPersonalitySetting: vi.fn(),
  showAssistantPersonality: vi.fn(),
}))

vi.mock('@murphai/vault-usecases/preferences', () => {
  usecaseMocks.moduleLoads += 1
  return usecaseMocks
})

import { registerAssistantCommands } from '../src/commands/assistant.js'

interface CommandDefinition {
  args: z.ZodType
  run(context: {
    args: Record<string, unknown>
    options: Record<string, unknown>
  }): Promise<unknown>
}

interface CommandGroup {
  commands: Map<string, unknown>
}

const DEFAULT_RESULT = {
  vault: '/tmp/vault',
  preferencesPath: 'bank/preferences.json',
  updated: false,
  recordedAt: null,
  settings: {
    humor: { value: 3, source: 'default' },
    push: { value: 3, source: 'default' },
    detail: { value: 5, source: 'default' },
  },
} as const

function readGroup(commands: Map<string, unknown>, name: string): CommandGroup {
  const group = commands.get(name)
  if (!group || typeof group !== 'object' || !('commands' in group)) {
    throw new Error(`Expected command group ${name}.`)
  }
  return group as CommandGroup
}

function readCommand(
  commands: Map<string, unknown>,
  name: string,
): CommandDefinition {
  const command = commands.get(name)
  if (
    !command ||
    typeof command !== 'object' ||
    !('args' in command) ||
    !('run' in command)
  ) {
    throw new Error(`Expected command ${name}.`)
  }
  return command as CommandDefinition
}

function createStyleCommands(): Map<string, unknown> {
  const cli = Cli.create('assistant-style-test', {
    description: 'assistant style command test',
  })
  registerAssistantCommands(cli, {} as InboxServices)
  const commands = Cli.toCommands.get(cli)
  if (!commands) {
    throw new Error('Expected assistant commands to be registered.')
  }

  return readGroup(readGroup(commands, 'assistant').commands, 'style').commands
}

beforeEach(() => {
  for (const mock of [
    usecaseMocks.resetAllAssistantPersonalitySettings,
    usecaseMocks.resetAssistantPersonalitySetting,
    usecaseMocks.setAssistantPersonalitySetting,
    usecaseMocks.showAssistantPersonality,
  ]) {
    mock.mockReset()
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('assistant style registers the closed show, set, and reset command surface', () => {
  const commands = createStyleCommands()
  assert.equal(usecaseMocks.moduleLoads, 0)
  assert.deepEqual([...commands.keys()], ['show', 'set', 'reset'])

  const set = readCommand(commands, 'set')
  assert.deepEqual(set.args.parse({ setting: 'humor', value: 0 }), {
    setting: 'humor',
    value: 0,
  })
  assert.deepEqual(set.args.parse({ setting: 'humor', value: '0' }), {
    setting: 'humor',
    value: 0,
  })
  assert.throws(() => set.args.parse({ setting: 'humor', value: -1 }))
  assert.throws(() => set.args.parse({ setting: 'humor', value: 11 }))
  assert.throws(() => set.args.parse({ setting: 'humor', value: 2.5 }))
  assert.throws(() => set.args.parse({ setting: 'honesty', value: 10 }))

  const reset = readCommand(commands, 'reset')
  assert.deepEqual(reset.args.parse({ setting: 'all' }), { setting: 'all' })
  assert.throws(() => reset.args.parse({ setting: 'everything' }))
})

test('assistant style delegates show and zero-valued set through the preference usecases', async () => {
  const commands = createStyleCommands()
  const show = readCommand(commands, 'show')
  const set = readCommand(commands, 'set')
  usecaseMocks.showAssistantPersonality.mockResolvedValueOnce(DEFAULT_RESULT)
  usecaseMocks.setAssistantPersonalitySetting.mockResolvedValueOnce({
    ...DEFAULT_RESULT,
    updated: true,
    recordedAt: '2026-07-10T12:00:00.000Z',
    settings: {
      ...DEFAULT_RESULT.settings,
      humor: { value: 0, source: 'custom' },
    },
  })

  const shown = assistantPersonalityResultSchema.parse(
    await show.run({ args: {}, options: { vault: '/tmp/vault' } }),
  )
  assert.equal(shown.updated, false)
  assert.deepEqual(usecaseMocks.showAssistantPersonality.mock.calls, [
    ['/tmp/vault'],
  ])

  const updated = assistantPersonalityResultSchema.parse(
    await set.run({
      args: { setting: 'humor', value: 0 },
      options: { vault: '/tmp/vault' },
    }),
  )
  assert.equal(updated.settings.humor.value, 0)
  assert.deepEqual(usecaseMocks.setAssistantPersonalitySetting.mock.calls, [
    [{ vault: '/tmp/vault', setting: 'humor', value: 0 }],
  ])
})

test('assistant style binds hosted writes to the active bridge causal sequence', async () => {
  vi.stubEnv(HOSTED_RUNTIME_PROCESS_ENV, '1')
  vi.stubEnv(HOSTED_CLI_BRIDGE_URL_ENV, 'http://127.0.0.1:43123/')
  vi.stubEnv(HOSTED_CLI_BRIDGE_TOKEN_ENV, 'bridge-token')
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ causalSeq: '42' }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200,
    },
  ))
  vi.stubGlobal('fetch', fetchMock)
  const set = readCommand(createStyleCommands(), 'set')
  usecaseMocks.setAssistantPersonalitySetting.mockResolvedValueOnce(DEFAULT_RESULT)

  await set.run({
    args: { setting: 'humor', value: 8 },
    options: { vault: '/tmp/vault' },
  })

  assert.deepEqual(usecaseMocks.setAssistantPersonalitySetting.mock.calls, [[{
    causalSeq: '42',
    vault: '/tmp/vault',
    setting: 'humor',
    value: 8,
  }]])
  assert.equal(fetchMock.mock.calls.length, 1)
  const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
  assert.equal(String(requestUrl), 'http://127.0.0.1:43123/assistant/preference-causal-seq')
  assert.equal(requestInit?.method, 'POST')
  assert.equal(requestInit?.body, '{}')
})

test('assistant style routes one-setting and all-setting resets explicitly', async () => {
  const reset = readCommand(createStyleCommands(), 'reset')
  usecaseMocks.resetAssistantPersonalitySetting.mockResolvedValueOnce(DEFAULT_RESULT)
  usecaseMocks.resetAllAssistantPersonalitySettings.mockResolvedValueOnce(DEFAULT_RESULT)

  await reset.run({
    args: { setting: 'detail' },
    options: { vault: '/tmp/vault' },
  })
  await reset.run({
    args: { setting: 'all' },
    options: { vault: '/tmp/vault' },
  })

  assert.deepEqual(usecaseMocks.resetAssistantPersonalitySetting.mock.calls, [
    [{ vault: '/tmp/vault', setting: 'detail' }],
  ])
  assert.deepEqual(usecaseMocks.resetAllAssistantPersonalitySettings.mock.calls, [
    [{ vault: '/tmp/vault' }],
  ])
})
