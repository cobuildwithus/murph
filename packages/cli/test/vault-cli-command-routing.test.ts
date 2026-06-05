import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import type { KnownLazyRootCommand } from '../src/vault-cli-routing.ts'

const mockedModules = [
  '@murphai/assistant-cli/commands/assistant',
  '../src/commands/automation.js',
  '../src/commands/health-blood-test-save.js',
  '../src/commands/commons.js',
  '../src/commands/device.js',
  '../src/commands/experiment.js',
  '../src/commands/health-goal-save.js',
  '../src/commands/measurement.js',
  '../src/commands/memory.js',
  '../src/commands/protocol.js',
  '../src/commands/read.js',
  '../src/commands/search.js',
  '../src/commands/supplement.js',
  '../src/commands/vault.js',
  '../src/commands/wearables.js',
  '../src/device-services.js',
  '../src/vault-cli-inbox-services.js',
  '@murphai/vault-usecases/vault-services',
] as const

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  for (const moduleId of mockedModules) {
    vi.doUnmock(moduleId)
  }
})

function createTestVaultServices() {
  return {
    core: {},
    importers: {},
    query: {},
  }
}

async function assertScopedVaultServiceCommand(input: {
  moduleId: string
  registerName: string
  root: KnownLazyRootCommand
}) {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const services = createTestVaultServices()
  const registerCommands = vi.fn()
  const createIntegratedVaultServices = vi.fn(() => services)
  vi.doMock(input.moduleId, () => ({
    [input.registerName]: registerCommands,
  }))
  vi.doMock('@murphai/vault-usecases/vault-services', () => ({
    createIntegratedVaultServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: input.root,
  })

  assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
  assert.deepEqual(registerCommands.mock.calls, [[cli, services]])
}

async function assertScopedCommandWithoutServices(input: {
  moduleId: string
  registerName: string
  root: KnownLazyRootCommand
}) {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const registerCommands = vi.fn()
  vi.doMock(input.moduleId, () => ({
    [input.registerName]: registerCommands,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: input.root,
  })

  assert.deepEqual(registerCommands.mock.calls, [[cli]])
}

test('scoped command routing mounts assistant commands with inbox and vault services', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const services = createTestVaultServices()
  const inboxServices = {
    readInbox: vi.fn(),
  }
  const registerAssistantCommands = vi.fn()
  const createIntegratedVaultServices = vi.fn(() => services)
  const createDefaultInboxServices = vi.fn(() => inboxServices)
  vi.doMock('@murphai/assistant-cli/commands/assistant', () => ({
    registerAssistantCommands,
  }))
  vi.doMock('@murphai/vault-usecases/vault-services', () => ({
    createIntegratedVaultServices,
  }))
  vi.doMock('../src/vault-cli-inbox-services.js', () => ({
    createDefaultInboxServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'assistant',
  })

  assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
  assert.equal(createDefaultInboxServices.mock.calls.length, 1)
  assert.deepEqual(registerAssistantCommands.mock.calls, [[
    cli,
    inboxServices,
    services,
  ]])
})

for (const input of [
  {
    moduleId: '../src/commands/automation.js',
    registerName: 'registerAutomationCommands',
    root: 'automation',
  },
  {
    moduleId: '../src/commands/measurement.js',
    registerName: 'registerMeasurementCommands',
    root: 'measurement',
  },
  {
    moduleId: '../src/commands/memory.js',
    registerName: 'registerMemoryCommands',
    root: 'memory',
  },
] as const) {
  test(`scoped command routing maps ${input.root} without vault services`, async () => {
    await assertScopedCommandWithoutServices(input)
  })
}

test('scoped command routing mounts the real commons command family', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const registerCommonsCommands = vi.fn()
  vi.doMock('../src/commands/commons.js', () => ({
    registerCommonsCommands,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'commons',
  })

  assert.deepEqual(registerCommonsCommands.mock.calls, [[cli]])
})

test('scoped command routing mounts device commands with device services only', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const deviceServices = {
    listProviders: vi.fn(),
  }
  const registerDeviceCommands = vi.fn()
  const createIntegratedDeviceSyncServices = vi.fn(() => deviceServices)
  vi.doMock('../src/commands/device.js', () => ({
    registerDeviceCommands,
  }))
  vi.doMock('../src/device-services.js', () => ({
    createIntegratedDeviceSyncServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'device',
  })

  assert.equal(createIntegratedDeviceSyncServices.mock.calls.length, 1)
  assert.deepEqual(registerDeviceCommands.mock.calls, [[cli, deviceServices]])
})

test('scoped command routing mounts experiment commands with vault services', async () => {
  const cli = Cli.create('vault-cli', { description: 'test cli' })
  const services = createTestVaultServices()
  const registerExperimentCommands = vi.fn()
  const createIntegratedVaultServices = vi.fn(() => services)
  vi.doMock('../src/commands/experiment.js', () => ({
    registerExperimentCommands,
  }))
  vi.doMock('@murphai/vault-usecases/vault-services', () => ({
    createIntegratedVaultServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'experiment',
  })

  assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
  assert.deepEqual(registerExperimentCommands.mock.calls, [[cli, services]])
})

for (const input of [
  {
    moduleId: '../src/commands/health-blood-test-save.js',
    registerName: 'registerBloodTestCommands',
    root: 'blood-test',
  },
  {
    moduleId: '../src/commands/health-goal-save.js',
    registerName: 'registerGoalCommands',
    root: 'goal',
  },
  {
    moduleId: '../src/commands/supplement.js',
    registerName: 'registerSupplementCommands',
    root: 'supplement',
  },
  {
    moduleId: '../src/commands/wearables.js',
    registerName: 'registerWearablesCommands',
    root: 'wearables',
  },
] as const) {
  test(`scoped command routing maps ${input.root} to its command family`, async () => {
    await assertScopedVaultServiceCommand(input)
  })
}

for (const root of ['list', 'show'] as const) {
  test(`scoped command routing maps ${root} to the generic read command family`, async () => {
    await assertScopedVaultServiceCommand({
      moduleId: '../src/commands/read.js',
      registerName: 'registerReadCommands',
      root,
    })
  })
}

for (const root of ['query', 'search', 'timeline'] as const) {
  test(`scoped command routing maps ${root} to the search command family`, async () => {
    await assertScopedCommandWithoutServices({
      moduleId: '../src/commands/search.js',
      registerName: 'registerSearchCommands',
      root,
    })
  })
}

for (const root of ['protocol', 'regimen'] as const) {
  test(`scoped command routing maps ${root} to the protocol command family`, async () => {
    await assertScopedVaultServiceCommand({
      moduleId: '../src/commands/protocol.js',
      registerName: 'registerProtocolCommands',
      root,
    })
  })
}

for (const root of ['init', 'validate', 'vault'] as const) {
  test(`scoped command routing maps ${root} to the vault command family`, async () => {
    const cli = Cli.create('vault-cli', { description: 'test cli' })
    const services = createTestVaultServices()
    const registerVaultCommands = vi.fn()
    const createIntegratedVaultServices = vi.fn(() => services)
    vi.doMock('../src/commands/vault.js', () => ({
      registerVaultCommands,
    }))
    vi.doMock('@murphai/vault-usecases/vault-services', () => ({
      createIntegratedVaultServices,
    }))

    const { registerScopedVaultCliCommand } = await import(
      '../src/vault-cli-command-routing.ts'
    )
    await registerScopedVaultCliCommand({
      cli,
      root,
    })

    assert.equal(createIntegratedVaultServices.mock.calls.length, 1)
    assert.deepEqual(registerVaultCommands.mock.calls, [[cli, services]])
  })
}
