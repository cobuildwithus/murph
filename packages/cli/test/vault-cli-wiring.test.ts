import assert from 'node:assert/strict'
import { afterEach, vi } from 'vitest'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import {
  createUnwiredCliVaultServices,
  ensureCliVaultServices,
  isCliVaultServices,
} from '../src/device-services.js'

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('incur')
  vi.doUnmock('@murphai/vault-usecases')
  vi.doUnmock('@murphai/assistant-engine/assistant-state')
  vi.doUnmock('@murphai/inbox-services')
  vi.doUnmock('../src/vault-cli-bootstrap.js')
  vi.doUnmock('../src/vault-cli-command-manifest.js')
  vi.doUnmock('../src/vault-cli-inbox-services.js')
})

test('createVaultCli uses the default integrated inbox services wiring', async () => {
  const fakeCli = {
    serve: vi.fn(async () => undefined),
    use: vi.fn(),
  }
  const createDefaultVaultServices = vi.fn(() => ({
    core: {},
    importers: {},
    query: {},
    devices: {},
  }))
  const createIntegratedInboxServices = vi.fn(
    (_options?: {
      enableAssistantAutoReplyChannel?: (vault: string, channel: string) => Promise<boolean>
    }) => ({}),
  )
  const enableAssistantAutoReplyChannelLocal = vi.fn(async () => true)
  const registerVaultCliCommandDescriptors = vi.fn()
  const createVaultCliShell = vi.fn(() => fakeCli)

  vi.doMock('@murphai/vault-usecases', async () => {
    const actual = await vi.importActual<typeof import('@murphai/vault-usecases')>(
      '@murphai/vault-usecases',
    )

    return {
      ...actual,
      createIntegratedVaultServices: createDefaultVaultServices,
    }
  })
  vi.doMock('@murphai/assistant-engine/assistant-state', async () => {
    const actual = await vi.importActual<
      typeof import('@murphai/assistant-engine/assistant-state')
    >('@murphai/assistant-engine/assistant-state')

    return {
      ...actual,
      enableAssistantAutoReplyChannelLocal,
    }
  })
  vi.doMock('@murphai/inbox-services', async () => {
    const actual = await vi.importActual<typeof import('@murphai/inbox-services')>(
      '@murphai/inbox-services',
    )

    return {
      ...actual,
      createIntegratedInboxServices,
    }
  })
  vi.doMock('../src/vault-cli-bootstrap.js', async () => {
    const actual = await vi.importActual<typeof import('../src/vault-cli-bootstrap.js')>(
      '../src/vault-cli-bootstrap.js'
    )

    return {
      ...actual,
      createDefaultVaultServices,
      createVaultCliShell,
    }
  })
  vi.doMock('../src/vault-cli-command-manifest.js', () => ({
    registerVaultCliCommandDescriptors,
  }))

  const { createVaultCli } = await import('../src/vault-cli.js')

  createVaultCli()

  assert.equal(createDefaultVaultServices.mock.calls.length, 1)
  assert.equal(createIntegratedInboxServices.mock.calls.length, 1)
  assert.equal(
    typeof createIntegratedInboxServices.mock.calls[0]?.[0]?.enableAssistantAutoReplyChannel,
    'function',
  )

  await createIntegratedInboxServices.mock.calls[0]?.[0]?.enableAssistantAutoReplyChannel?.(
    '/vaults/default',
    'telegram',
  )

  assert.deepEqual(enableAssistantAutoReplyChannelLocal.mock.calls, [[{
    channel: 'telegram',
    vault: '/vaults/default',
  }]])
  assert.equal(registerVaultCliCommandDescriptors.mock.calls.length, 1)
  assert.equal(createVaultCliShell.mock.calls.length, 1)
})

test('cli-owned vault services compose device sync on top of neutral vault services', () => {
  const neutralVaultServices = createUnwiredVaultServices()

  assert.equal(Object.hasOwn(neutralVaultServices, 'devices'), false)
  assert.equal(isCliVaultServices(neutralVaultServices), false)

  const cliVaultServices = ensureCliVaultServices(neutralVaultServices)

  assert.equal(Object.hasOwn(cliVaultServices, 'devices'), true)
  assert.equal(typeof cliVaultServices.devices.listProviders, 'function')
  assert.equal(typeof cliVaultServices.devices.connect, 'function')
  assert.equal(typeof cliVaultServices.devices.daemonStart, 'function')
  assert.equal(isCliVaultServices(cliVaultServices), true)

  const unwiredCliVaultServices = createUnwiredCliVaultServices(neutralVaultServices)

  assert.equal(Object.hasOwn(unwiredCliVaultServices, 'devices'), true)
  assert.equal(typeof unwiredCliVaultServices.devices.listProviders, 'function')
  assert.equal(typeof unwiredCliVaultServices.devices.connect, 'function')
  assert.equal(typeof unwiredCliVaultServices.devices.daemonStart, 'function')
})
