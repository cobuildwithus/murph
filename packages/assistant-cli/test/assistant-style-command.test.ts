import assert from 'node:assert/strict'

import type { InboxServices } from '@murphai/inbox-services'
import { assistantPersonalityResultSchema } from '@murphai/operator-config/assistant-style-cli-contracts'
import { Cli, z } from 'incur'
import { beforeEach, test, vi } from 'vitest'

const usecaseMocks = vi.hoisted(() => ({
  moduleLoads: 0,
  resetAllAssistantPersonalitySettings: vi.fn(),
  resetAssistantPersonalitySetting: vi.fn(),
  setAssistantPersonalitySetting: vi.fn(),
  showAssistantPersonality: vi.fn(),
}))
const routeAccessMocks = vi.hoisted(() => ({
  canUseAssistantStyleSettingsForCurrentRoute: vi.fn(),
}))

vi.mock('@murphai/assistant-engine/assistant-runtime', () => routeAccessMocks)

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
  routeAccessMocks.canUseAssistantStyleSettingsForCurrentRoute.mockReset()
  routeAccessMocks.canUseAssistantStyleSettingsForCurrentRoute.mockResolvedValue(true)
  for (const mock of [
    usecaseMocks.resetAllAssistantPersonalitySettings,
    usecaseMocks.resetAssistantPersonalitySetting,
    usecaseMocks.setAssistantPersonalitySetting,
    usecaseMocks.showAssistantPersonality,
  ]) {
    mock.mockReset()
  }
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

test('assistant style denies active non-private routes before loading preferences', async () => {
  const commands = createStyleCommands()
  routeAccessMocks.canUseAssistantStyleSettingsForCurrentRoute.mockResolvedValue(false)

  await assert.rejects(
    readCommand(commands, 'show').run({
      args: {},
      options: { vault: '/tmp/vault' },
    }),
    /available only in a private direct conversation/u,
  )
  await assert.rejects(
    readCommand(commands, 'set').run({
      args: { setting: 'humor', value: 9 },
      options: { vault: '/tmp/vault' },
    }),
    /available only in a private direct conversation/u,
  )
  await assert.rejects(
    readCommand(commands, 'reset').run({
      args: { setting: 'all' },
      options: { vault: '/tmp/vault' },
    }),
    /available only in a private direct conversation/u,
  )

  assert.equal(usecaseMocks.moduleLoads, 0)
  assert.equal(usecaseMocks.showAssistantPersonality.mock.calls.length, 0)
  assert.equal(usecaseMocks.setAssistantPersonalitySetting.mock.calls.length, 0)
  assert.equal(usecaseMocks.resetAssistantPersonalitySetting.mock.calls.length, 0)
  assert.equal(usecaseMocks.resetAllAssistantPersonalitySettings.mock.calls.length, 0)
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
