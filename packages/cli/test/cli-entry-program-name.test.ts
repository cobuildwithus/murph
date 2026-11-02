import { beforeEach, expect, test, vi } from 'vitest'

const serve = vi.fn(async () => undefined)
const createVaultCliWithOptions = vi.fn(
  (_options: {
    commandName?: string
    excludeCommandDescriptorIds?: ReadonlySet<string>
    vaultContext?: { current: string | null }
  }) => ({
  serve,
}),
)
const resolveDefaultVault = vi.fn(async (): Promise<string | null> => '/vaults/default')
const resolveOperatorHomeDirectory = vi.fn(() => '/home/operator')

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



import { runMurphCliAction } from '../src/cli-entry.ts'

beforeEach(() => {
  vi.clearAllMocks()
  serve.mockResolvedValue(undefined)
  createVaultCliWithOptions.mockReturnValue({
    serve,
  })
})



test('vault-cli launcher keeps the command name on the shared CLI surface', async () => {
  await runMurphCliAction(['--help'], {
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

  await runMurphCliAction(['--help'], {
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'vault-cli',
    vaultContext: expect.objectContaining({
      current: null,
    }),
  })
  expect(serve).toHaveBeenCalledWith(
    ['--help'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})

test('vault-cli launcher honors explicit vaults without a default vault', async () => {
  resolveDefaultVault.mockResolvedValueOnce(null)

  await runMurphCliAction(['--help', '--vault', '/vaults/explicit'], {
  })

  expect(createVaultCliWithOptions).toHaveBeenCalledWith({
    commandName: 'vault-cli',
    vaultContext: expect.objectContaining({
      current: '/vaults/explicit',
    }),
  })
  expect(serve).toHaveBeenCalledWith(
    ['--help'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})

test('vault-cli mcp server mode excludes batch from the full command surface', async () => {
  await runMurphCliAction(['--mcp'], {
  })

  const options = createVaultCliWithOptions.mock.calls.at(-1)?.[0]
  expect(options).toEqual(
    expect.objectContaining({
      commandName: 'vault-cli',
      vaultContext: expect.objectContaining({
        current: null,
      }),
    }),
  )
  expect(Array.from(options?.excludeCommandDescriptorIds ?? [])).toEqual([
    'batch',
  ])
  expect(serve).toHaveBeenCalledWith(
    ['--mcp'],
    expect.objectContaining({
      env: process.env,
    }),
  )
})

for (const argv of [
  ['--mcp', 'condition'],
  ['condition', '--mcp'],
] as const) {
  test(`vault-cli ${argv.join(' ')} keeps full-tree MCP routing and excludes batch`, async () => {
    await runMurphCliAction([...argv], {
    })

    const options = createVaultCliWithOptions.mock.calls.at(-1)?.[0]
    expect(Array.from(options?.excludeCommandDescriptorIds ?? [])).toEqual([
      'batch',
    ])
    expect(serve).toHaveBeenCalledWith(
      [...argv],
      expect.objectContaining({
        env: process.env,
      }),
    )
  })
}
