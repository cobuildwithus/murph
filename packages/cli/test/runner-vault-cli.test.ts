import assert from 'node:assert/strict'
import { afterEach, vi } from 'vitest'
import { createVaultCli } from '../src/vault-cli.js'
import { runRunnerVaultCliEntrypoint } from '../src/runner-vault-cli.js'
import { createRunnerVaultCli } from '../src/runner-vault-cli.js'
import { localParallelCliTest as test } from './local-parallel-test.js'

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('incur')
  vi.doUnmock('@murphai/operator-config/operator-config')
  vi.doUnmock('@murphai/vault-usecases')
  vi.doUnmock('@murphai/assistant-engine/assistant-cron')
  vi.doUnmock('@murphai/inbox-services')
  vi.doUnmock('./cli-entry.js')
  vi.doUnmock('./incur-error-bridge.js')
  vi.doUnmock('./runner-vault-cli-command-manifest.js')
  vi.doUnmock('./vault-cli-command-manifest.js')
  vi.doUnmock('../src/cli-entry.js')
  vi.doUnmock('../src/incur-error-bridge.js')
  vi.doUnmock('../src/runner-vault-cli-command-manifest.js')
  vi.doUnmock('../src/vault-cli-command-manifest.js')
})

async function runRawRunnerCli(args: string[]): Promise<string> {
  const cli = createRunnerVaultCli()
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  assert.equal(exitCode === null || exitCode === 0, true)
  return output.join('').trim()
}

async function runRawVaultCli(args: string[]): Promise<string> {
  const cli = createVaultCli()
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  assert.equal(exitCode === null || exitCode === 0, true)
  return output.join('').trim()
}

test('runner vault cli keeps vault/inbox surfaces and omits local-only assistant setup commands', async () => {
  const help = await runRawRunnerCli(['--help'])

  assert.match(help, /\binbox\b/u)
  assert.match(help, /\bsearch\b/u)
  assert.doesNotMatch(help, /\n\s+assistant\s+/u)
  assert.doesNotMatch(help, /\n\s+model\s+/u)
})

test('vault cli keeps the public help surface available from the default factory', async () => {
  const help = await runRawVaultCli(['--help'])

  assert.match(help, /\binbox\b/u)
  assert.match(help, /\bsearch\b/u)
  assert.match(help, /\bassistant\b/u)
})

test('runRunnerVaultCliEntrypoint loads env files before serving the CLI entrypoint', async () => {
  const loadEnvFileCalls: string[] = []
  const loadEnvFile = vi
    .spyOn(process, 'loadEnvFile')
    .mockImplementation((filePath) => {
      const resolvedPath = String(filePath)
      loadEnvFileCalls.push(resolvedPath)
      if (resolvedPath.endsWith('.env.local')) {
        const error = Object.assign(new Error('missing'), {
          code: 'ENOENT',
        })
        throw error
      }
    })

  await runRunnerVaultCliEntrypoint(['--help'], {
    exit: vi.fn(),
  })

  assert.equal(loadEnvFile.mock.calls.length, 2)
  assert.deepEqual(loadEnvFileCalls, [
    `${process.cwd()}/.env.local`,
    `${process.cwd()}/.env`,
  ])
})

test('runRunnerVaultCliEntrypoint forwards the exit hook into serve options', async () => {
  const fakeCli = {
    serve: vi.fn(async (_argv: readonly string[], options: { exit?: (code?: number) => void }) => {
      options.exit?.(0)
      return undefined
    }),
    use: vi.fn(),
  }
  const loadCliEnvFiles = vi.fn()
  const createCliServeOptions = vi.fn(
    (providedExit?: (code?: number) => void) => ({
      env: process.env,
      ...(providedExit
        ? {
            exit(code: number) {
              providedExit(code)
            },
          }
        : {}),
    }),
  )
  const applyDefaultVaultToArgs = vi.fn(
    (argv: readonly string[], defaultVault: string | null) =>
      defaultVault === null ? [...argv] : [...argv, '--vault', defaultVault],
  )
  const resolveDefaultVault = vi.fn(async () => '/vaults/default')
  const resolveOperatorHomeDirectory = vi.fn(() => '/operator-home')
  const createIntegratedVaultServices = vi.fn(() => ({
    core: {},
    importers: {},
    query: {},
    devices: {},
  }))
  const createIntegratedInboxServices = vi.fn(() => ({}))
  const createAssistantFoodAutoLogHooks = vi.fn(() => ({}))
  const registerRunnerVaultCliCommandDescriptors = vi.fn()
  const exit = vi.fn()

  vi.doMock('incur', () => ({
    Cli: {
      create: vi.fn(() => fakeCli),
    },
  }))
  vi.doMock('@murphai/operator-config/operator-config', () => ({
    applyDefaultVaultToArgs,
    resolveDefaultVault,
    resolveOperatorHomeDirectory,
  }))
  vi.doMock('@murphai/vault-usecases', () => ({
    createIntegratedVaultServices,
  }))
  vi.doMock('@murphai/assistant-engine/assistant-cron', () => ({
    createAssistantFoodAutoLogHooks,
  }))
  vi.doMock('@murphai/inbox-services', () => ({
    createIntegratedInboxServices,
  }))
  vi.doMock('../src/cli-entry.js', () => ({
    createCliServeOptions,
    loadCliEnvFiles,
  }))
  vi.doMock('../src/incur-error-bridge.js', () => ({
    incurErrorBridge: {},
  }))
  vi.doMock('../src/runner-vault-cli-command-manifest.js', () => ({
    registerRunnerVaultCliCommandDescriptors,
  }))

  const { runRunnerVaultCliEntrypoint: runRunnerVaultCliEntrypointMocked } = await import(
    '../src/runner-vault-cli.js'
  )

  await runRunnerVaultCliEntrypointMocked(['inbox', 'run'], {
    exit,
  })

  assert.equal(loadCliEnvFiles.mock.calls.length, 1)
  assert.deepEqual(createCliServeOptions.mock.calls, [[exit]])
  assert.equal(resolveOperatorHomeDirectory.mock.calls.length, 1)
  assert.deepEqual(applyDefaultVaultToArgs.mock.calls, [
    [['inbox', 'run'], '/vaults/default'],
  ])
  assert.equal(typeof fakeCli.serve.mock.calls[0]?.[1]?.exit, 'function')
  assert.equal(exit.mock.calls.length, 1)
  assert.equal(registerRunnerVaultCliCommandDescriptors.mock.calls.length, 1)
})

test('createVaultCli uses the default integrated inbox services wiring', async () => {
  const fakeCli = {
    serve: vi.fn(async () => undefined),
    use: vi.fn(),
  }
  const createIntegratedVaultServices = vi.fn(() => ({
    core: {},
    importers: {},
    query: {},
    devices: {},
  }))
  const createIntegratedInboxServices = vi.fn(
    (dependencies?: {
      loadInboxImessageModule?: () => Promise<unknown>
    }) => {
      void dependencies?.loadInboxImessageModule?.()
      return {}
    },
  )
  const createAssistantFoodAutoLogHooks = vi.fn(() => ({}))
  const registerVaultCliCommandDescriptors = vi.fn()

  vi.doMock('incur', async () => {
    const actual = await vi.importActual<typeof import('incur')>('incur')

    return {
      ...actual,
      Cli: {
        create: vi.fn(() => fakeCli),
      },
    }
  })
  vi.doMock('@murphai/vault-usecases', async () => {
    const actual = await vi.importActual<typeof import('@murphai/vault-usecases')>(
      '@murphai/vault-usecases',
    )

    return {
      ...actual,
      createIntegratedVaultServices,
    }
  })
  vi.doMock('@murphai/assistant-engine/assistant-cron', async () => {
    const actual = await vi.importActual<
      typeof import('@murphai/assistant-engine/assistant-cron')
    >('@murphai/assistant-engine/assistant-cron')

    return {
      ...actual,
      createAssistantFoodAutoLogHooks,
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
  vi.doMock('../src/incur-error-bridge.js', () => ({
    incurErrorBridge: {},
  }))
  vi.doMock('../src/vault-cli-command-manifest.js', () => ({
    registerVaultCliCommandDescriptors,
  }))

  const { createVaultCli: createVaultCliMocked } = await import('../src/vault-cli.js')

  createVaultCliMocked()

  assert.deepEqual(createIntegratedInboxServices.mock.calls, [[]])
  assert.equal(registerVaultCliCommandDescriptors.mock.calls.length, 1)
  assert.equal(fakeCli.use.mock.calls.length, 1)
})
