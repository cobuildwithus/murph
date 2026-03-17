import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'
import {
  createSetupCli,
  detectSetupProgramName,
  isSetupInvocation,
  shouldAutoLaunchAssistantAfterSetup,
  type SuccessfulSetupContext,
} from '../src/setup-cli.js'
import { resolveOperatorConfigPath, saveDefaultVaultConfig } from '../src/operator-config.js'
import { createSetupServices } from '../src/setup-services.js'
import type { SetupResult } from '../src/setup-cli-contracts.js'
import {
  repoRoot,
  requireData,
  type CliEnvelope,
} from './cli-test-helpers.js'

const execFileAsync = promisify(execFile)

async function writeExecutable(
  absolutePath: string,
  body = '#!/usr/bin/env bash\nexit 0\n',
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, body, 'utf8')
  await chmod(absolutePath, 0o755)
}

function makeBootstrapResult(vault: string, options?: {
  parserToolchainPath?: string
  whisperModelPath?: string
  whisperCommand?: string
  createdPaths?: string[]
  doctorChecks?: Array<{
    name: string
    status: 'pass' | 'warn' | 'fail'
    message: string
    details?: Record<string, unknown>
  }>
}) {
  return {
    vault,
    init: {
      runtimeDirectory: '.runtime/inboxd',
      databasePath: '.runtime/inboxd.sqlite',
      configPath: '.runtime/inboxd/config.json',
      createdPaths: options?.createdPaths ?? ['.runtime', '.runtime/inboxd'],
      rebuiltCaptures: 0,
    },
    setup: {
      configPath: '.runtime/parsers/toolchain.json',
      updatedAt: '2026-03-13T12:00:00.000Z',
      tools: {
        ffmpeg: {
          available: true,
          command: '/usr/local/bin/ffmpeg',
          reason: 'ffmpeg CLI available.',
          source: 'config' as const,
        },
        pdftotext: {
          available: true,
          command: '/usr/local/bin/pdftotext',
          reason: 'pdftotext CLI available.',
          source: 'config' as const,
        },
        whisper: {
          available: true,
          command: options?.whisperCommand ?? '/usr/local/bin/whisper-cli',
          modelPath: options?.whisperModelPath ?? '/tmp/model.bin',
          reason: 'whisper.cpp CLI and model path configured.',
          source: 'config' as const,
        },
        paddleocr: {
          available: true,
          command: '/usr/local/bin/paddlex',
          reason: 'PaddleOCR CLI available.',
          source: 'config' as const,
        },
      },
    },
    doctor: {
      configPath: '.runtime/inboxd/config.json',
      databasePath: '.runtime/inboxd.sqlite',
      target: null,
      ok: true,
      checks: options?.doctorChecks ?? [],
      connectors: [],
      parserToolchain: options?.parserToolchainPath
        ? {
            configPath: '.runtime/parsers/toolchain.json',
            discoveredAt: '2026-03-13T12:05:00.000Z',
            tools: {
              ffmpeg: {
                available: true,
                command: '/usr/local/bin/ffmpeg',
                reason: 'ffmpeg CLI available.',
                source: 'config' as const,
              },
              pdftotext: {
                available: true,
                command: '/usr/local/bin/pdftotext',
                reason: 'pdftotext CLI available.',
                source: 'config' as const,
              },
              whisper: {
                available: true,
                command: options.whisperCommand ?? options.parserToolchainPath,
                modelPath: options.whisperModelPath ?? options.parserToolchainPath,
                reason: 'whisper.cpp CLI and model path configured.',
                source: 'config' as const,
              },
              paddleocr: {
                available: true,
                command: options.parserToolchainPath,
                reason: 'PaddleOCR CLI available.',
                source: 'config' as const,
              },
            },
          }
        : null,
    },
  }
}

function makeSetupResult(vault: string): SetupResult {
  return {
    arch: 'arm64',
    bootstrap: makeBootstrapResult(vault),
    dryRun: false,
    notes: [],
    platform: 'darwin',
    steps: [
      {
        detail: `Initialized a new vault scaffold at ${vault}.`,
        id: 'vault-init',
        kind: 'configure',
        status: 'completed',
        title: 'Vault initialization',
      },
      {
        detail: 'Wrote parser toolchain config under .runtime/parsers and completed inbox doctor checks.',
        id: 'inbox-bootstrap',
        kind: 'configure',
        status: 'completed',
        title: 'Inbox bootstrap',
      },
    ],
    toolchainRoot: '~/.healthybob/toolchain',
    tools: {
      ffmpegCommand: '/usr/local/bin/ffmpeg',
      paddleocrCommand: '/usr/local/bin/paddlex',
      pdftotextCommand: '/usr/local/bin/pdftotext',
      whisperCommand: '/usr/local/bin/whisper-cli',
      whisperModelPath: '~/.healthybob/toolchain/models/whisper/ggml-base.en.bin',
    },
    vault,
    whisperModel: 'base.en',
  }
}

async function runSetupCli<TData>(
  args: string[],
  services: ReturnType<typeof createSetupServices> | { setupMacos(input: any): Promise<any> },
  commandName = 'healthybob',
): Promise<CliEnvelope<TData>> {
  const cli = createSetupCli({
    commandName,
    services: services as ReturnType<typeof createSetupServices>,
  })
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runSetupAliasRaw(
  aliasName: string,
  args: string[],
): Promise<string> {
  const aliasRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-alias-'))
  const aliasPath = path.join(aliasRoot, aliasName)

  try {
    await writeFile(
      aliasPath,
      `#!/usr/bin/env node
;(async () => {
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  await import(pathToFileURL(join(process.cwd(), 'packages/cli/src/bin.ts')).href)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
`,
      'utf8',
    )
    await chmod(aliasPath, 0o755)

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import=tsx', aliasPath, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )
    return stdout.trim()
  } finally {
    await rm(aliasRoot, { recursive: true, force: true })
  }
}

async function runSetupWrapper(
  args: string[],
  envOverrides: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync('bash', [path.join(repoRoot, 'scripts/setup-macos.sh'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...envOverrides,
    },
  })
}

async function readOptionalText(absolutePath: string): Promise<string> {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return ''
    }
    throw error
  }
}

test.sequential('setup CLI dry-run returns a macOS plan without mutating services', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-home-'))
  const vaultRoot = path.join(homeRoot, 'vault')
  let coreInitCalls = 0
  let bootstrapCalls = 0

  const services = createSetupServices({
    arch: () => 'x64',
    env: () => ({ PATH: '' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        bootstrapCalls += 1
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    runCommand: async ({ file, args }) => {
      if (path.basename(file) === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        return {
          exitCode: 1,
          stderr: '',
          stdout: '',
        }
      }

      if (path.basename(file) === 'brew' && args[0] === '--prefix') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: '',
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init() {
          coreInitCalls += 1
          return {
            created: true,
            directories: [],
            files: [],
            vault: vaultRoot,
          }
        },
      },
    } as any,
  })

  try {
    const result = await runSetupCli<SetupResult>(
      ['setup', '--dryRun', '--vault', vaultRoot],
      services,
    )
    const data = requireData(result)

    assert.equal(data.dryRun, true)
    assert.equal(data.vault, '~/vault')
    assert.equal(coreInitCalls, 0)
    assert.equal(bootstrapCalls, 0)
    assert.equal(
      data.steps.some(
        (step) =>
          step.id === 'homebrew' &&
          (step.status === 'planned' || step.status === 'reused'),
      ),
      true,
    )
    assert.equal(
      data.steps.some((step) => step.id === 'paddlex-ocr' && step.status === 'skipped'),
      true,
    )
    assert.equal(
      data.steps.some((step) => step.id === 'inbox-bootstrap' && step.status === 'planned'),
      true,
    )
    assert.equal(
      data.steps.some((step) => step.id === 'cli-shims' && step.status === 'planned'),
      true,
    )
    assert.equal(
      data.steps.some((step) => step.id === 'default-vault' && step.status === 'planned'),
      true,
    )
  } finally {
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('setup CLI dry-run reuses an existing vault without mutating services', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-existing-dryrun-home-'))
  const vaultRoot = path.join(homeRoot, 'vault')
  let coreInitCalls = 0
  let bootstrapCalls = 0

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')

  const services = createSetupServices({
    arch: () => 'x64',
    env: () => ({ PATH: '' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        bootstrapCalls += 1
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    runCommand: async ({ file, args }) => {
      if (path.basename(file) === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        return {
          exitCode: 1,
          stderr: '',
          stdout: '',
        }
      }

      if (path.basename(file) === 'brew' && args[0] === '--prefix') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: '',
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init() {
          coreInitCalls += 1
          return {
            created: true,
            directories: [],
            files: [],
            vault: vaultRoot,
          }
        },
      },
    } as any,
  })

  try {
    const result = await runSetupCli<SetupResult>(
      ['setup', '--dryRun', '--vault', vaultRoot],
      services,
    )
    const data = requireData(result)
    const vaultInitStep = data.steps.find((step) => step.id === 'vault-init')
    const inboxBootstrapStep = data.steps.find((step) => step.id === 'inbox-bootstrap')

    assert.equal(data.dryRun, true)
    assert.equal(coreInitCalls, 0)
    assert.equal(bootstrapCalls, 0)
    assert.equal(vaultInitStep?.status, 'reused')
    assert.match(String(vaultInitStep?.detail), /Would reuse the existing vault/u)
    assert.equal(inboxBootstrapStep?.status, 'planned')
  } finally {
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('setup CLI defaults the vault to ./vault when omitted', async () => {
  let receivedVault: string | null = null

  const result = await runSetupCli<SetupResult>(
    ['setup'],
    {
      async setupMacos(input: { vault: string }) {
        receivedVault = input.vault
        return makeSetupResult(input.vault)
      },
    },
  )

  assert.equal(result.ok, true)
  assert.equal(receivedVault, './vault')
})

test.sequential('setup CLI keeps post-setup CTAs usable when invoked as healthybob', async () => {
  const result = await runSetupCli<SetupResult>(
    ['setup', '--vault', './vault'],
    {
      async setupMacos() {
        return makeSetupResult('./vault')
      },
    },
  )

  assert.equal(result.ok, true)
  assert.equal(
    result.meta.cta?.commands[0]?.command,
    'healthybob assistant chat',
  )
  assert.equal(
    result.meta.cta?.commands[1]?.command,
    'healthybob inbox doctor',
  )
  assert.equal(
    result.meta.cta?.commands[2]?.command,
    'healthybob inbox source add imessage --id imessage:self --account self --includeOwn',
  )
})

test.sequential('setup CLI reports successful setup metadata for post-setup chat handoff', async () => {
  const handoffContext = {
    current: null as SuccessfulSetupContext | null,
  }

  const cli = createSetupCli({
    commandName: 'healthybob',
    onSetupSuccess(context) {
      handoffContext.current = context
    },
    services: {
      async setupMacos(input) {
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
  })

  await cli.serve(['setup', '--format', 'json', '--verbose'], {
    env: process.env,
    exit: () => {},
    stdout() {},
  })

  assert.notEqual(handoffContext.current, null)
  const reportedContext = handoffContext.current
  if (reportedContext === null) {
    throw new Error('Expected setup handoff context to be reported.')
  }

  assert.equal(reportedContext.result.vault, './vault')
  assert.equal(reportedContext.format, 'json')
  assert.equal(reportedContext.formatExplicit, true)
})

test.sequential('setup CLI does not report a handoff for dry-run setup', async () => {
  let handoffCalls = 0

  const cli = createSetupCli({
    commandName: 'healthybob',
    onSetupSuccess() {
      handoffCalls += 1
    },
    services: {
      async setupMacos(input) {
        return {
          ...makeSetupResult(input.vault),
          dryRun: true,
        }
      },
    } as ReturnType<typeof createSetupServices>,
  })

  await cli.serve(['setup', '--dryRun', '--format', 'json', '--verbose'], {
    env: process.env,
    exit: () => {},
    stdout() {},
  })

  assert.equal(handoffCalls, 0)
})

test('setup auto-chat gating only enables the handoff for interactive default-format runs', () => {
  const context = {
    agent: false,
    format: 'toon' as const,
    formatExplicit: false,
    result: makeSetupResult('./vault'),
  }

  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(context, {
      stdinIsTTY: true,
      stderrIsTTY: true,
    }),
    true,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(
      {
        ...context,
        formatExplicit: true,
      },
      {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
    ),
    false,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(
      {
        ...context,
        agent: true,
      },
      {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
    ),
    false,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(
      {
        ...context,
        result: {
          ...context.result,
          dryRun: true,
        },
      },
      {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
    ),
    false,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(context, {
      stdinIsTTY: false,
      stderrIsTTY: true,
    }),
    false,
  )
})

test.sequential('setup service provisions formulas, downloads the model, and bootstraps the vault', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-real-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  const expectedWhisperModelPath = path.join(
    homeRoot,
    '.healthybob',
    'toolchain',
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  const operatorConfigPath = resolveOperatorConfigPath(homeRoot)
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
    'python@3.12': path.join(tempRoot, 'Cellar', 'python@3.12'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const pythonCommand = path.join(formulaPrefixes['python@3.12'], 'bin', 'python3.12')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const healthybobShimPath = path.join(homeRoot, '.local', 'bin', 'healthybob')
  const vaultCliShimPath = path.join(homeRoot, '.local', 'bin', 'vault-cli')
  const shellProfilePath = path.join(homeRoot, '.zshrc')
  const installedFormulas = new Set<string>()
  const runCalls: Array<{ file: string; args: string[] }> = []
  const initCalls: Array<{ requestId: string | null; vault: string }> = []
  const bootstrapCalls: Array<Record<string, unknown>> = []

  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
  await writeExecutable(whisperCommand)
  await writeExecutable(pythonCommand)

  const services = createSetupServices({
    arch: () => 'arm64',
    downloadFile: async (_url, destinationPath) => {
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: homebrewBin, SHELL: '/bin/zsh' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap(input) {
        bootstrapCalls.push(input as unknown as Record<string, unknown>)
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => cliBinPath,
    runCommand: async ({ file, args }) => {
      runCalls.push({ args, file })
      const baseName = path.basename(file)

      if (baseName === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        const formula = args[2] ?? ''
        return installedFormulas.has(formula)
          ? {
              exitCode: 0,
              stderr: '',
              stdout: `${formula} 1.0.0\n`,
            }
          : {
              exitCode: 1,
              stderr: '',
              stdout: '',
            }
      }

      if (baseName === 'brew' && args[0] === 'install') {
        installedFormulas.add(args[1] ?? '')
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'installed\n',
        }
      }

      if (baseName === 'brew' && args[0] === '--prefix') {
        const formula = args[1] as keyof typeof formulaPrefixes
        return {
          exitCode: 0,
          stderr: '',
          stdout: `${formulaPrefixes[formula]}\n`,
        }
      }

      if (file === pythonCommand && args[0] === '-m' && args[1] === 'venv') {
        const venvRoot = args[2] ?? ''
        await writeExecutable(path.join(venvRoot, 'bin', 'python'))
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'venv created\n',
        }
      }

      if (
        path.basename(file) === 'python' &&
        args[0] === '-m' &&
        args[1] === 'pip' &&
        args[2] === 'install'
      ) {
        if (args.includes('paddlex[ocr]')) {
          await writeExecutable(path.join(path.dirname(file), 'paddlex'))
        }
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'pip ok\n',
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init(input: { requestId: string | null; vault: string }) {
          initCalls.push(input)
          return {
            created: true,
            directories: [],
            files: [],
            vault: input.vault,
          }
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      requestId: 'req-123',
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(result.bootstrap?.vault, '~/vault')
    assert.equal(initCalls.length, 1)
    assert.deepEqual(initCalls[0], { requestId: 'req-123', vault: vaultRoot })
    assert.equal(bootstrapCalls.length, 1)
    assert.equal(bootstrapCalls[0]?.vault, vaultRoot)
    assert.equal(bootstrapCalls[0]?.ffmpegCommand, ffmpegCommand)
    assert.equal(bootstrapCalls[0]?.pdftotextCommand, pdftotextCommand)
    assert.equal(bootstrapCalls[0]?.whisperCommand, whisperCommand)
    assert.equal(
      bootstrapCalls[0]?.whisperModelPath,
      expectedWhisperModelPath,
    )
    assert.equal(
      result.tools.whisperModelPath,
      '~/.healthybob/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.match(
      String(bootstrapCalls[0]?.paddleocrCommand),
      /paddlex-ocr\/bin\/paddlex$/u,
    )
    assert.equal(result.toolchainRoot, '~/.healthybob/toolchain')
    assert.equal(
      result.tools.paddleocrCommand,
      '~/.healthybob/toolchain/venvs/paddlex-ocr/bin/paddlex',
    )
    assert.equal(installedFormulas.has('ffmpeg'), true)
    assert.equal(installedFormulas.has('poppler'), true)
    assert.equal(installedFormulas.has('whisper-cpp'), true)
    assert.equal(installedFormulas.has('python@3.12'), true)
    assert.equal(
      result.steps.some((step) => step.id === 'paddlex-ocr' && step.status === 'completed'),
      true,
    )
    assert.equal(
      result.steps.some((step) => step.id === 'cli-shims' && step.status === 'completed'),
      true,
    )
    assert.equal(
      result.steps.some((step) => step.id === 'default-vault' && step.status === 'completed'),
      true,
    )
    assert.equal(
      result.notes.includes('Open a new shell or run source ~/.zshrc to use healthybob immediately.'),
      true,
    )

    const modelText = await readFile(expectedWhisperModelPath, 'utf8')
    const operatorConfig = JSON.parse(await readFile(operatorConfigPath, 'utf8')) as {
      defaultVault: string | null
    }
    const healthybobShim = await readFile(healthybobShimPath, 'utf8')
    const vaultCliShim = await readFile(vaultCliShimPath, 'utf8')
    const shellProfile = await readFile(shellProfilePath, 'utf8')
    assert.equal(modelText, 'model')
    assert.equal(operatorConfig.defaultVault, '~/vault')
    assert.match(healthybobShim, /exec node/u)
    assert.match(healthybobShim, new RegExp(escapeRegExp(cliBinPath)))
    assert.match(vaultCliShim, new RegExp(escapeRegExp(cliBinPath)))
    assert.match(shellProfile, /export PATH="\$HOME\/\.local\/bin:\$PATH"/u)
    assert.equal(
      runCalls.some(
        ({ args, file }) => path.basename(file) === 'brew' && args.join(' ') === 'install ffmpeg',
      ),
      true,
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service reuses existing Healthy Bob shims and PATH wiring', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-shim-reuse-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const userBinDirectory = path.join(homeRoot, '.local', 'bin')
  const shellProfilePath = path.join(homeRoot, '.zshrc')
  const installedFormulas = new Set(['ffmpeg', 'poppler', 'whisper-cpp'])
  let bootstrapCalls = 0

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
  await writeExecutable(whisperCommand)
  await mkdir(userBinDirectory, { recursive: true })
  await writeExecutable(
    path.join(userBinDirectory, 'healthybob'),
    `#!/usr/bin/env bash
set -euo pipefail

exec node '${cliBinPath}' "$@"
`,
  )
  await writeExecutable(
    path.join(userBinDirectory, 'vault-cli'),
    `#!/usr/bin/env bash
set -euo pipefail

exec node '${cliBinPath}' "$@"
`,
  )
  await writeFile(
    shellProfilePath,
    `# >>> Healthy Bob PATH >>>
export PATH="$HOME/.local/bin:$PATH"
# <<< Healthy Bob PATH <<<
`,
    'utf8',
  )
  await saveDefaultVaultConfig(vaultRoot, homeRoot)

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: `${userBinDirectory}${path.delimiter}${homebrewBin}`, SHELL: '/bin/zsh' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        bootstrapCalls += 1
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => cliBinPath,
    runCommand: async ({ file, args }) => {
      const baseName = path.basename(file)

      if (baseName === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        const formula = args[2] ?? ''
        return {
          exitCode: installedFormulas.has(formula) ? 0 : 1,
          stderr: '',
          stdout: installedFormulas.has(formula) ? `${formula} 1.0.0\n` : '',
        }
      }

      if (baseName === 'brew' && args[0] === '--prefix') {
        const formula = args[1] as keyof typeof formulaPrefixes
        return {
          exitCode: 0,
          stderr: '',
          stdout: `${formulaPrefixes[formula]}\n`,
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init() {
          throw new Error('init should not be called for an existing vault')
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      skipOcr: true,
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(bootstrapCalls, 1)
    assert.equal(
      result.steps.some((step) => step.id === 'cli-shims' && step.status === 'reused'),
      true,
    )
    assert.equal(
      result.steps.some((step) => step.id === 'default-vault' && step.status === 'reused'),
      true,
    )
    assert.equal(
      result.notes.includes('Open a new shell or run source ~/.zshrc to use healthybob immediately.'),
      false,
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service reuses an existing vault and still bootstraps inbox runtime', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-existing-vault-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const installedFormulas = new Set(['ffmpeg', 'poppler', 'whisper-cpp'])
  const initCalls: Array<{ requestId: string | null; vault: string }> = []
  const bootstrapCalls: Array<Record<string, unknown>> = []

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
  await writeExecutable(whisperCommand)

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: homebrewBin }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap(input) {
        bootstrapCalls.push(input as unknown as Record<string, unknown>)
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    runCommand: async ({ file, args }) => {
      const baseName = path.basename(file)

      if (baseName === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        const formula = args[2] ?? ''
        return installedFormulas.has(formula)
          ? {
              exitCode: 0,
              stderr: '',
              stdout: `${formula} 1.0.0\n`,
            }
          : {
              exitCode: 1,
              stderr: '',
              stdout: '',
            }
      }

      if (baseName === 'brew' && args[0] === '--prefix') {
        const formula = args[1] as keyof typeof formulaPrefixes
        return {
          exitCode: 0,
          stderr: '',
          stdout: `${formulaPrefixes[formula]}\n`,
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init(input: { requestId: string | null; vault: string }) {
          initCalls.push(input)
          return {
            created: true,
            directories: [],
            files: [],
            vault: input.vault,
          }
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      requestId: 'req-existing',
      skipOcr: true,
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(initCalls.length, 0)
    assert.equal(bootstrapCalls.length, 1)
    assert.equal(bootstrapCalls[0]?.vault, vaultRoot)
    assert.equal(bootstrapCalls[0]?.ffmpegCommand, ffmpegCommand)
    assert.equal(bootstrapCalls[0]?.pdftotextCommand, pdftotextCommand)
    assert.equal(bootstrapCalls[0]?.whisperCommand, whisperCommand)
    assert.equal(result.bootstrap?.vault, vaultRoot)
    assert.equal(
      result.steps.some(
        (step) =>
          step.id === 'vault-init' &&
          step.status === 'reused' &&
          /Reusing the existing vault/u.test(step.detail),
      ),
      true,
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service redacts nested bootstrap toolchain paths under the home directory', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-redaction-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperFormulaCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const homeWhisperCommand = path.join(homeRoot, '.healthybob', 'toolchain', 'bin', 'whisper-cli')
  const homeWhisperModel = path.join(
    homeRoot,
    '.healthybob',
    'toolchain',
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  const homePaddle = path.join(homeRoot, '.healthybob', 'toolchain', 'venvs', 'paddlex-ocr', 'bin', 'paddlex')
  const siblingPrefixPath = path.join(tempRoot, 'homebrew', 'bin', 'ffmpeg')
  const installedFormulas = new Set(['ffmpeg', 'poppler', 'whisper-cpp'])
  let bootstrapCalls = 0

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
  await writeExecutable(whisperFormulaCommand)

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: homebrewBin }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        bootstrapCalls += 1
        return makeBootstrapResult(vaultRoot, {
          createdPaths: [path.join(homeRoot, '.healthybob', 'toolchain'), '.runtime/inboxd'],
          doctorChecks: [
            {
              details: {
                artifactPaths: [homeWhisperModel, homePaddle, siblingPrefixPath],
              },
              message: 'Configured parser assets were discovered.',
              name: 'parser-assets',
              status: 'pass',
            },
          ],
          parserToolchainPath: homePaddle,
          whisperCommand: homeWhisperCommand,
          whisperModelPath: homeWhisperModel,
        })
      },
    },
    log() {},
    platform: () => 'darwin',
    runCommand: async ({ file, args }) => {
      if (path.basename(file) === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        const formula = args[2] ?? ''
        return {
          exitCode: installedFormulas.has(formula) ? 0 : 1,
          stderr: '',
          stdout: installedFormulas.has(formula) ? `${formula} 1.0.0\n` : '',
        }
      }

      if (path.basename(file) === 'brew' && args[0] === '--prefix') {
        const formula = args[1] as keyof typeof formulaPrefixes
        return {
          exitCode: 0,
          stderr: '',
          stdout: `${formulaPrefixes[formula]}\n`,
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init() {
          throw new Error('init should not be called for an existing vault')
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      skipOcr: true,
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(bootstrapCalls, 1)
    assert.equal(result.bootstrap?.vault, '~/vault')
    assert.deepEqual(result.bootstrap?.init.createdPaths, ['~/.healthybob/toolchain', '.runtime/inboxd'])
    assert.equal(
      result.bootstrap?.setup.tools.whisper.command,
      '~/.healthybob/toolchain/bin/whisper-cli',
    )
    assert.equal(
      result.bootstrap?.setup.tools.whisper.modelPath,
      '~/.healthybob/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.equal(
      result.bootstrap?.doctor.parserToolchain?.tools.whisper.command,
      '~/.healthybob/toolchain/bin/whisper-cli',
    )
    assert.equal(
      result.bootstrap?.doctor.parserToolchain?.tools.whisper.modelPath,
      '~/.healthybob/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.equal(
      result.bootstrap?.doctor.parserToolchain?.tools.paddleocr.command,
      '~/.healthybob/toolchain/venvs/paddlex-ocr/bin/paddlex',
    )
    assert.deepEqual(
      result.bootstrap?.doctor.checks[0]?.details?.artifactPaths,
      [
        '~/.healthybob/toolchain/models/whisper/ggml-base.en.bin',
        '~/.healthybob/toolchain/venvs/paddlex-ocr/bin/paddlex',
        siblingPrefixPath,
      ],
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('setup routing helpers keep the setup alias stable', () => {
  assert.equal(isSetupInvocation(['setup', '--dryRun']), true)
  assert.equal(isSetupInvocation(['inbox', 'doctor']), false)
  assert.equal(isSetupInvocation([], 'healthybob'), true)
  assert.equal(isSetupInvocation(['--help'], 'healthybob'), true)
  assert.equal(isSetupInvocation(['--verbose', '--format', 'json'], 'healthybob'), true)
  assert.equal(
    isSetupInvocation(['--format', 'json', 'setup', '--dry-run'], 'healthybob'),
    true,
  )
  assert.equal(
    isSetupInvocation(['--filter-output', 'steps[0].title', '--help'], 'healthybob'),
    true,
  )
  assert.equal(
    isSetupInvocation(['--token-limit', '10', '--help'], 'healthybob'),
    true,
  )
  assert.equal(
    isSetupInvocation(['--token-offset', '5', 'setup', '--dry-run'], 'healthybob'),
    true,
  )
  assert.equal(isSetupInvocation(['inbox', 'doctor'], 'healthybob'), false)
  assert.equal(
    isSetupInvocation(['--format', 'json', 'inbox', 'doctor'], 'healthybob'),
    false,
  )
  assert.equal(
    isSetupInvocation(['--token-limit', '10', 'inbox', 'doctor'], 'healthybob'),
    false,
  )
  assert.equal(
    detectSetupProgramName('/usr/local/bin/healthybob'),
    'healthybob',
  )
  assert.equal(
    detectSetupProgramName('/tmp/packages/cli/dist/bin.js'),
    'vault-cli',
  )

  const cli = createSetupCli({ commandName: 'healthybob' })
  assert.ok(cli)
})

test.sequential('healthybob alias routes empty and help invocations to setup help', async () => {
  const help = await runSetupAliasRaw('healthybob', ['--help'])
  const emptyInvocation = await runSetupAliasRaw('healthybob', [])
  const inboxHelp = await runSetupAliasRaw('healthybob', ['inbox', 'doctor', '--help'])

  assert.match(help, /Healthy Bob local machine setup helpers\./u)
  assert.match(help, /setup\s+Provision the macOS parser\/runtime toolchain/u)
  assert.doesNotMatch(help, /search\s+Search commands for the local read model/u)
  assert.match(emptyInvocation, /Healthy Bob local machine setup helpers\./u)
  assert.doesNotMatch(inboxHelp, /Healthy Bob local machine setup helpers\./u)
  assert.match(inboxHelp, /vault-cli inbox doctor/u)
})

test.sequential('setup-macos wrapper rejects non-macOS hosts before bootstrapping', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-wrapper-linux-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`

  await writeExecutable(path.join(stubBin, 'uname'), '#!/usr/bin/env bash\necho Linux\n')
  await writeExecutable(
    path.join(stubBin, 'brew'),
    '#!/usr/bin/env bash\nprintf "brew\\n" >> "${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    '#!/usr/bin/env bash\nprintf "node\\n" >> "${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    '#!/usr/bin/env bash\nprintf "corepack\\n" >> "${CALL_LOG}"\nexit 99\n',
  )

  try {
    await assert.rejects(
      runSetupWrapper(['--vault', './vault'], {
        CALL_LOG: callLog,
        HOME: tempRoot,
        PATH: pathValue,
      }),
      (error: unknown) => {
        assert.equal(typeof error, 'object')
        assert.match(String((error as { stderr?: string }).stderr ?? ''), /macOS only/u)
        return true
      },
    )
    assert.equal(await readOptionalText(callLog), '')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup-macos wrapper stays macOS-only even for dry-run invocations', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-wrapper-linux-dryrun-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`

  await writeExecutable(path.join(stubBin, 'uname'), '#!/usr/bin/env bash\necho Linux\n')
  await writeExecutable(
    path.join(stubBin, 'brew'),
    '#!/usr/bin/env bash\nprintf "brew\\n" >> "${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    '#!/usr/bin/env bash\nprintf "node\\n" >> "${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    '#!/usr/bin/env bash\nprintf "corepack\\n" >> "${CALL_LOG}"\nexit 99\n',
  )

  try {
    await assert.rejects(
      runSetupWrapper(['--dryRun', '--vault', './vault'], {
        CALL_LOG: callLog,
        HOME: tempRoot,
        PATH: pathValue,
      }),
      (error: unknown) => {
        assert.equal(typeof error, 'object')
        assert.match(String((error as { stderr?: string }).stderr ?? ''), /macOS only/u)
        return true
      },
    )
    assert.equal(await readOptionalText(callLog), '')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup-macos wrapper dry-run prints a plan without mutating the machine', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-wrapper-dryrun-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`

  await writeExecutable(path.join(stubBin, 'uname'), '#!/usr/bin/env bash\necho Darwin\n')
  await writeExecutable(
    path.join(stubBin, 'brew'),
    '#!/usr/bin/env bash\nprintf "brew\\n" >> "${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    '#!/usr/bin/env bash\nprintf "node\\n" >> "${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    '#!/usr/bin/env bash\nprintf "corepack\\n" >> "${CALL_LOG}"\nexit 99\n',
  )

  try {
    const result = await runSetupWrapper(['--dry-run', '--vault', './vault'], {
      CALL_LOG: callLog,
      HOME: tempRoot,
      PATH: pathValue,
    })

    assert.match(result.stdout, /Dry run requested/u)
    assert.match(result.stdout, /Healthy Bob macOS setup will install or reuse:/u)
    assert.match(
      result.stdout,
      /Homebrew, Node >= 22\.16\.0, and pnpm@9\.15\.9 via corepack/u,
    )
    assert.match(
      result.stdout,
      /ffmpeg, poppler\/pdftotext, whisper\.cpp, and a local Whisper model/u,
    )
    assert.match(
      result.stdout,
      /the final Healthy Bob setup flow: vault bootstrap, default vault config, user-level healthybob\/vault-cli shims, and assistant chat/u,
    )
    assert.match(result.stdout, /Ensure Node >= 22\.16\.0/u)
    assert.match(result.stdout, /corepack pnpm install/u)
    assert.match(
      result.stdout,
      /node packages\/cli\/dist\/bin\.js setup --dry-run --vault \.\/vault/u,
    )
    assert.equal(result.stderr, '')
    assert.equal(await readOptionalText(callLog), '')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('setup service rejects non-macOS hosts', async () => {
  const services = createSetupServices({
    platform: () => 'linux',
    log() {},
  })

  await assert.rejects(
    services.setupMacos({ vault: './vault' }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.match(String(error), /macOS only/u)
      return true
    },
  )
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
