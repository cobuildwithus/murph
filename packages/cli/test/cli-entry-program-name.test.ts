import { beforeEach, expect, test, vi } from 'vitest'

const serve = vi.fn(async () => undefined)
const createVaultCliWithOptions = vi.fn(() => ({
  serve,
}))
const applyDefaultVaultToArgs = vi.fn((argv: string[], defaultVault: string | null) =>
  defaultVault ? [...argv, '--vault', defaultVault] : argv,
)
const hasExplicitVaultOption = vi.fn((argv: readonly string[]) =>
  argv.includes('--vault'),
)
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
  applyDefaultVaultToArgs,
  commandNeedsVaultForExecution: vi.fn(() => true),
  expandConfiguredVaultPath: vi.fn((vault: string) => vault),
  hasExplicitVaultOption,
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
  await runMurphCliAction(['status'], {
    argv0: '/usr/local/bin/murph',
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'murph',
  })
  expect(serve).toHaveBeenCalledWith(
    ['status', '--vault', '/vaults/default'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})

test('vault-cli launcher keeps the secondary alias on the shared CLI surface', async () => {
  await runMurphCliAction(['status'], {
    argv0: '/usr/local/bin/vault-cli',
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'vault-cli',
  })
})

test('vault-cli launcher reports a typed missing-vault error without a default vault', async () => {
  resolveDefaultVault.mockResolvedValueOnce(null)

  await expect(
    runMurphCliAction(['status'], {
      argv0: '/usr/local/bin/vault-cli',
    }),
  ).rejects.toMatchObject({
    code: 'missing_vault',
  })

  expect(serve).not.toHaveBeenCalled()
})

test('vault-cli launcher honors explicit vaults without a default vault', async () => {
  resolveDefaultVault.mockResolvedValueOnce(null)

  await runMurphCliAction(['status', '--vault', '/vaults/explicit'], {
    argv0: '/usr/local/bin/vault-cli',
  })

  expect(serve).toHaveBeenCalledWith(
    ['status', '--vault', '/vaults/explicit'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})
