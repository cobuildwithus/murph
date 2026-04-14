import { beforeEach, expect, test, vi } from 'vitest'

const serve = vi.fn(async () => undefined)
const createVaultCliWithOptions = vi.fn(() => ({
  serve,
}))
const applyDefaultVaultToArgs = vi.fn((argv: string[], defaultVault: string | null) =>
  defaultVault ? [...argv, '--vault', defaultVault] : argv,
)
const resolveDefaultVault = vi.fn(async () => '/vaults/default')
const resolveOperatorHomeDirectory = vi.fn(() => '/home/operator')
const detectSetupProgramName = vi.fn((argv0: string | undefined) =>
  argv0?.includes('murph') ? 'murph' : 'vault-cli',
)
const isSetupInvocation = vi.fn(() => false)

vi.mock('../src/vault-cli.js', () => ({
  createVaultCliWithOptions,
}))

vi.mock('@murphai/operator-config/operator-config', () => ({
  applyDefaultVaultToArgs,
  commandNeedsVaultForExecution: vi.fn(() => true),
  expandConfiguredVaultPath: vi.fn((vault: string) => vault),
  hasExplicitVaultOption: vi.fn(() => false),
  resolveConfiguredDefaultVault: vi.fn(async () => '/vaults/default'),
  resolveEffectiveTopLevelToken: vi.fn(
    (argv: readonly string[]) => argv.find((token) => !token.startsWith('-')) ?? null,
  ),
  resolveDefaultVault,
  resolveOperatorHomeDirectory,
}))

vi.mock('@murphai/setup-cli/setup-cli', () => ({
  createSetupCli: vi.fn(() => ({ serve: vi.fn(async () => undefined) })),
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
