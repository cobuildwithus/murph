import { beforeEach, expect, test, vi } from 'vitest'

const serve = vi.fn(async () => undefined)
const createVaultCliWithOptions = vi.fn(() => ({
  serve,
}))
const resolveDefaultVault = vi.fn(async (): Promise<string | null> => '/vaults/default')
const resolveOperatorHomeDirectory = vi.fn(() => '/home/operator')
const detectSetupProgramName = vi.fn((argv0: string | undefined) =>
  argv0?.includes('murph') ? 'murph' : 'vault-cli',
)
const isSetupInvocation = vi.fn(() => false)

vi.mock('../src/vault-cli.js', () => ({
  CLI_CONFIG_FILES: [],
  createVaultCliWithOptions,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  expandConfiguredVaultPath: vi.fn((vault: string) => vault),
  resolveConfiguredDefaultVault: vi.fn(async () => '/vaults/default'),
  resolveEffectiveTopLevelToken: vi.fn(
    (argv: readonly string[]) => argv.find((token) => !token.startsWith('-')) ?? null,
  ),
  resolveDefaultVault,
  resolveOperatorHomeDirectory,
}))

vi.mock('@murphai/setup-cli/setup-cli', () => ({
  createSetupCli: vi.fn(() => ({ serve: vi.fn(async () => undefined) })),
  createSetupServices: vi.fn(() => ({ setupHost: vi.fn(), setupMacos: vi.fn() })),
  detectSetupProgramName,
  formatSetupWearableLabel: vi.fn((wearable: string) => wearable),
  isSetupInvocation,
  listSetupPendingWearables: vi.fn(() => []),
  listSetupReadyWearables: vi.fn(() => []),
  resolveSetupPostLaunchAction: vi.fn(() => null),
}))

vi.mock('@murphai/operator-config/setup-runtime-env', () => ({
  SETUP_RUNTIME_ENV_NOTICE: 'Set runtime env first.',
}))

import { runMurphCliAction } from '../src/cli-entry.ts'

beforeEach(() => {
  vi.clearAllMocks()
  serve.mockResolvedValue(undefined)
  createVaultCliWithOptions.mockReturnValue({
    serve,
  })
})

test('murph launcher keeps the primary command name on the shared CLI surface', async () => {
  await runMurphCliAction(['model'], {
    argv0: '/usr/local/bin/murph',
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'murph',
    vaultContext: expect.objectContaining({
      current: '/vaults/default',
    }),
  })
  expect(serve).toHaveBeenCalledWith(
    ['model'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})

test('vault-cli launcher keeps the secondary alias on the shared CLI surface', async () => {
  await runMurphCliAction(['model'], {
    argv0: '/usr/local/bin/vault-cli',
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'vault-cli',
    vaultContext: expect.objectContaining({
      current: '/vaults/default',
    }),
  })
})

test('vault-cli launcher lets the command context report a missing vault at execution time', async () => {
  resolveDefaultVault.mockResolvedValueOnce(null)

  await runMurphCliAction(['model'], {
    argv0: '/usr/local/bin/vault-cli',
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'vault-cli',
    vaultContext: expect.objectContaining({
      current: null,
    }),
  })
  expect(serve).toHaveBeenCalledWith(
    ['model'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})

test('vault-cli launcher honors explicit vaults without a default vault', async () => {
  resolveDefaultVault.mockResolvedValueOnce(null)

  await runMurphCliAction(['model', '--vault', '/vaults/explicit'], {
    argv0: '/usr/local/bin/vault-cli',
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'vault-cli',
    vaultContext: expect.objectContaining({
      current: '/vaults/explicit',
    }),
  })
  expect(serve).toHaveBeenCalledWith(
    ['model'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})
