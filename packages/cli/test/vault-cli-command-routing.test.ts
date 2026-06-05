import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

const mockedModules = [
  '../src/commands/commons.js',
  '../src/commands/device.js',
  '../src/commands/experiment.js',
  '../src/commands/vault.js',
  '../src/device-services.js',
  '../src/vault-cli-bootstrap.js',
] as const

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  for (const moduleId of mockedModules) {
    vi.doUnmock(moduleId)
  }
})

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
  const services = {
    core: {},
    importers: {},
    query: {},
  }
  const registerExperimentCommands = vi.fn()
  const createDefaultVaultServices = vi.fn(() => services)
  vi.doMock('../src/commands/experiment.js', () => ({
    registerExperimentCommands,
  }))
  vi.doMock('../src/vault-cli-bootstrap.js', () => ({
    createDefaultVaultServices,
  }))

  const { registerScopedVaultCliCommand } = await import(
    '../src/vault-cli-command-routing.ts'
  )
  await registerScopedVaultCliCommand({
    cli,
    root: 'experiment',
  })

  assert.equal(createDefaultVaultServices.mock.calls.length, 1)
  assert.deepEqual(registerExperimentCommands.mock.calls, [[cli, services]])
})

for (const root of ['init', 'validate', 'vault'] as const) {
  test(`scoped command routing maps ${root} to the vault command family`, async () => {
    const cli = Cli.create('vault-cli', { description: 'test cli' })
    const services = {
      core: {},
      importers: {},
      query: {},
    }
    const registerVaultCommands = vi.fn()
    const createDefaultVaultServices = vi.fn(() => services)
    vi.doMock('../src/commands/vault.js', () => ({
      registerVaultCommands,
    }))
    vi.doMock('../src/vault-cli-bootstrap.js', () => ({
      createDefaultVaultServices,
    }))

    const { registerScopedVaultCliCommand } = await import(
      '../src/vault-cli-command-routing.ts'
    )
    await registerScopedVaultCliCommand({
      cli,
      root,
    })

    assert.equal(createDefaultVaultServices.mock.calls.length, 1)
    assert.deepEqual(registerVaultCommands.mock.calls, [[cli, services]])
  })
}
