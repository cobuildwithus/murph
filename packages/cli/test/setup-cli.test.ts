import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
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
  resolveSetupPostLaunchAction,
  shouldAutoLaunchAssistantAfterSetup,
  shouldRunSetupWizard,
  type SuccessfulSetupContext,
} from '../src/setup-cli.js'
import { readAssistantAutomationState } from '../src/assistant-state.js'
import { resolveOperatorConfigPath, saveDefaultVaultConfig } from '../src/operator-config.js'
import { createSetupServices } from '../src/setup-services.js'
import type { SetupResult } from '../src/setup-cli-contracts.js'
import {
  ensureCliRuntimeArtifacts,
  repoRoot,
  requireData,
  type CliEnvelope,
  withoutNodeV8Coverage,
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

function buildExpectedCliShimScript(cliBinPath: string): string {
  const cliSourceBinPath = path.resolve(path.dirname(cliBinPath), '..', 'src', 'bin.ts')
  const repoRoot = path.resolve(path.dirname(cliBinPath), '..', '..', '..')
  const workspacePackageNames = [
    'contracts',
    'core',
    'device-syncd',
    'importers',
    'inboxd',
    'parsers',
    'query',
    'runtime-state',
  ]
  const workspaceCheckLines = workspacePackageNames
    .map((packageName) => {
      const packageRoot = path.join(repoRoot, 'packages', packageName)
      const packageDistIndexPath = path.join(packageRoot, 'dist', 'index.js')
      return `  if [ ! -f '${packageDistIndexPath}' ]; then
    missing_packages+=('${packageRoot}')
  fi`
    })
    .join('\n')

  return `#!/usr/bin/env bash
set -euo pipefail

run_supervised() {
  "$@" &
  child_pid=$!

  forward_signal() {
    local signal_name="$1"
    local exit_code="$2"
    local attempts=0

    trap - INT TERM
    kill "-$signal_name" "$child_pid" 2>/dev/null || true

    while kill -0 "$child_pid" 2>/dev/null; do
      if [ "$attempts" -ge 20 ]; then
        kill -KILL "$child_pid" 2>/dev/null || true
        break
      fi

      sleep 0.1
      attempts=$((attempts + 1))
    done

    wait "$child_pid" 2>/dev/null || true
    exit "$exit_code"
  }

  trap 'forward_signal INT 130' INT
  trap 'forward_signal TERM 143' TERM

  while kill -0 "$child_pid" 2>/dev/null; do
    sleep 0.1
  done

  wait "$child_pid"
  local exit_code=$?
  trap - INT TERM
  return "$exit_code"
}

if [ -f '${cliBinPath}' ]; then
  missing_packages=()
${workspaceCheckLines}

  if [ "\${#missing_packages[@]}" -gt 0 ]; then
    if command -v pnpm >/dev/null 2>&1; then
      for package_dir in "\${missing_packages[@]}"; do
        pnpm --dir "$package_dir" build >/dev/null
      done
    elif command -v corepack >/dev/null 2>&1; then
      for package_dir in "\${missing_packages[@]}"; do
        corepack pnpm --dir "$package_dir" build >/dev/null
      done
    fi
  fi

  run_supervised node '${cliBinPath}' "$@"
  exit $?
fi

if [ -f '${cliSourceBinPath}' ]; then
  if command -v pnpm >/dev/null 2>&1; then
    run_supervised pnpm --dir '${repoRoot}' exec tsx '${cliSourceBinPath}' "$@"
    exit $?
  fi

  if command -v corepack >/dev/null 2>&1; then
    run_supervised corepack pnpm --dir '${repoRoot}' exec tsx '${cliSourceBinPath}' "$@"
    exit $?
  fi
fi

printf '%s\n' 'Healthy Bob CLI build output is unavailable. Run \`pnpm --dir <repo> build\` or \`pnpm --dir <repo> chat\` from the repo checkout.' >&2
exit 1
`
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
    assistant: null,
    bootstrap: makeBootstrapResult(vault),
    channels: [],
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
  options?: {
    cwd?: string
    env?: NodeJS.ProcessEnv
  },
): Promise<string> {
  await ensureCliRuntimeArtifacts()

  const aliasRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-alias-'))
  const aliasPath = path.join(aliasRoot, aliasName)
  const builtBinPath = JSON.stringify(path.join(repoRoot, 'packages/cli/dist/bin.js'))

  try {
    await writeFile(
      aliasPath,
      `#!/usr/bin/env node
;(async () => {
  const { pathToFileURL } = await import('node:url')
  await import(pathToFileURL(${builtBinPath}).href)
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
      [aliasPath, ...args],
      {
        cwd: options?.cwd ?? repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage({
          ...process.env,
          ...options?.env,
        }),
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
    env: withoutNodeV8Coverage({
      ...process.env,
      ...envOverrides,
    }),
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

test('setup wizard gating only enables interactive human onboarding runs', () => {
  assert.equal(
    shouldRunSetupWizard(
      {
        agent: false,
        dryRun: false,
        format: 'toon',
      },
      {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
    ),
    true,
  )
  assert.equal(
    shouldRunSetupWizard(
      {
        agent: false,
        dryRun: true,
        format: 'toon',
      },
      {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
    ),
    false,
  )
  assert.equal(
    shouldRunSetupWizard(
      {
        agent: false,
        dryRun: false,
        format: 'json',
      },
      {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
    ),
    false,
  )
})

test('onboard invokes the wizard for interactive runs and skips it for explicit JSON output', async () => {
  let wizardCalls = 0
  const receivedChannels: Array<string[] | null> = []
  const cli = createSetupCli({
    commandName: 'healthybob',
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupMacos(input: any) {
        receivedChannels.push(
          input.channels == null ? null : [...input.channels],
        )
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run() {
        wizardCalls += 1
        return {
          channels: ['imessage'],
        }
      },
    },
  })

  await cli.serve(['onboard', '--format', 'json', '--verbose'], {
    env: process.env,
    exit: () => {},
    stdout() {},
  })

  assert.equal(wizardCalls, 0)
  assert.deepEqual(receivedChannels[0], null)

  await cli.serve(['onboard', '--verbose'], {
    env: process.env,
    exit: () => {},
    stdout() {},
  })

  assert.equal(wizardCalls, 1)
  assert.deepEqual(receivedChannels[1], ['imessage'])
})

test('setup resolves assistant defaults from explicit assistant options when the wizard is skipped', async () => {
  const resolvedAssistants: any[] = []
  const receivedAssistants: any[] = []
  const cli = createSetupCli({
    commandName: 'healthybob',
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
    assistantSetup: {
      async resolve(input) {
        resolvedAssistants.push({
          allowPrompt: input.allowPrompt,
          preset: input.preset,
        })

        return {
          preset: 'openai-compatible',
          enabled: true,
          provider: 'openai-compatible',
          model: 'gpt-oss:20b',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
          providerName: 'ollama',
          codexCommand: null,
          profile: null,
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          oss: false,
          detail: 'Use gpt-oss:20b through Ollama.',
        }
      },
    },
    services: {
      async setupMacos(input: any) {
        receivedAssistants.push(input.assistant)
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
  })

  await cli.serve(
    [
      'setup',
      '--assistantPreset',
      'openai-compatible',
      '--assistantBaseUrl',
      'http://127.0.0.1:11434/v1',
      '--assistantModel',
      'gpt-oss:20b',
      '--assistantApiKeyEnv',
      'OLLAMA_API_KEY',
      '--format',
      'json',
      '--verbose',
    ],
    {
      env: process.env,
      exit: () => {},
      stdout() {},
    },
  )

  assert.deepEqual(resolvedAssistants, [
    {
      allowPrompt: false,
      preset: 'openai-compatible',
    },
  ])
  assert.deepEqual(receivedAssistants, [
    {
      preset: 'openai-compatible',
      enabled: true,
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      providerName: 'ollama',
      codexCommand: null,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      detail: 'Use gpt-oss:20b through Ollama.',
    },
  ])
})

test('setup handoff launches assistant automation instead of chat when auto-reply channels are enabled', () => {
  const context = {
    agent: false,
    format: 'toon' as const,
    formatExplicit: false,
    result: {
      ...makeSetupResult('./vault'),
      channels: [
        {
          autoReply: true,
          channel: 'imessage' as const,
          configured: true,
          connectorId: 'imessage:self',
          detail: 'Configured iMessage.',
          enabled: true,
        },
      ],
    },
  }

  assert.equal(
    resolveSetupPostLaunchAction(context, {
      stdinIsTTY: true,
      stderrIsTTY: true,
    }),
    'assistant-run',
  )
})


test('setup handoff keeps the post-setup flow in assistant chat when a selected auto-reply channel is not fully configured yet', () => {
  const context = {
    agent: false,
    format: 'toon' as const,
    formatExplicit: false,
    result: {
      ...makeSetupResult('./vault'),
      channels: [
        {
          autoReply: true,
          channel: 'telegram' as const,
          configured: false,
          connectorId: 'telegram:bot',
          detail: 'Telegram still needs a bot token.',
          enabled: true,
        },
      ],
    },
  }

  assert.equal(
    resolveSetupPostLaunchAction(context, {
      stdinIsTTY: true,
      stderrIsTTY: true,
    }),
    'assistant-chat',
  )
})

test.sequential('setup service configures Telegram and enables assistant auto-reply when a bot token is present', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-telegram-'))
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
  const installedFormulas = new Set(['ffmpeg', 'poppler', 'whisper-cpp'])
  const sourceAddCalls: Array<Record<string, unknown>> = []
  const doctorCalls: Array<Record<string, unknown>> = []

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
    env: () => ({
      HEALTHYBOB_TELEGRAM_BOT_TOKEN: 'token-123',
      PATH: homebrewBin,
    }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        return makeBootstrapResult(vaultRoot)
      },
      async doctor(input) {
        doctorCalls.push(input as unknown as Record<string, unknown>)
        return {
          vault: input.vault,
          configPath: '.runtime/inboxd/config.json',
          databasePath: '.runtime/inboxd.sqlite',
          target: input.sourceId ?? null,
          ok: true,
          checks: [
            {
              name: 'driver-import',
              status: 'pass' as const,
              message: 'The Telegram poll driver initialized successfully.',
            },
            {
              name: 'probe',
              status: 'pass' as const,
              message: 'The Telegram bot token authenticated successfully.',
            },
          ],
          connectors: [],
          parserToolchain: null,
        }
      },
      async sourceAdd(input) {
        sourceAddCalls.push(input as unknown as Record<string, unknown>)
        return {
          configPath: '.runtime/inboxd/config.json',
          connector: {
            accountId: input.account ?? null,
            enabled: true,
            id: input.id,
            options: {},
            source: input.source,
          },
          connectorCount: 1,
          vault: input.vault,
        }
      },
      async sourceList(input) {
        return {
          configPath: '.runtime/inboxd/config.json',
          connectors: [],
          vault: input.vault,
        }
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => cliBinPath,
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
        async init() {
          throw new Error('init should not be called for an existing vault')
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      channels: ['telegram'],
      skipOcr: true,
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(sourceAddCalls.length, 1)
    assert.deepEqual(doctorCalls, [
      {
        requestId: null,
        sourceId: 'telegram:bot',
        vault: vaultRoot,
      },
    ])
    assert.deepEqual(sourceAddCalls[0], {
      account: 'bot',
      id: 'telegram:bot',
      requestId: null,
      source: 'telegram',
      vault: vaultRoot,
    })
    assert.equal(result.channels.length, 1)
    assert.equal(result.channels[0]?.channel, 'telegram')
    assert.equal(result.channels[0]?.configured, true)
    assert.equal(result.channels[0]?.autoReply, true)
    assert.equal(result.channels[0]?.connectorId, 'telegram:bot')
    assert.equal(
      result.steps.some(
        (step) => step.id === 'channel-telegram' && step.status === 'completed',
      ),
      true,
    )

    const automationState = await readAssistantAutomationState(vaultRoot)
    assert.deepEqual(automationState.autoReplyChannels, ['telegram'])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service keeps Telegram configured but disables auto-reply when the bot token fails readiness checks', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-telegram-fail-'))
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
  const installedFormulas = new Set(['ffmpeg', 'poppler', 'whisper-cpp'])

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
    env: () => ({
      HEALTHYBOB_TELEGRAM_BOT_TOKEN: 'token-123',
      PATH: homebrewBin,
    }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        return makeBootstrapResult(vaultRoot)
      },
      async doctor(input) {
        return {
          vault: input.vault,
          configPath: '.runtime/inboxd/config.json',
          databasePath: '.runtime/inboxd.sqlite',
          target: input.sourceId ?? null,
          ok: false,
          checks: [
            {
              name: 'driver-import',
              status: 'pass' as const,
              message: 'The Telegram poll driver initialized successfully.',
            },
            {
              name: 'probe',
              status: 'fail' as const,
              message: 'The Telegram bot token could not authenticate with getMe.',
            },
          ],
          connectors: [],
          parserToolchain: null,
        }
      },
      async sourceAdd(input) {
        return {
          configPath: '.runtime/inboxd/config.json',
          connector: {
            accountId: input.account ?? null,
            enabled: true,
            id: input.id,
            options: {},
            source: input.source,
          },
          connectorCount: 1,
          vault: input.vault,
        }
      },
      async sourceList(input) {
        return {
          configPath: '.runtime/inboxd/config.json',
          connectors: [],
          vault: input.vault,
        }
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => cliBinPath,
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
        async init() {
          throw new Error('init should not be called for an existing vault')
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      channels: ['telegram'],
      skipOcr: true,
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(result.channels[0]?.channel, 'telegram')
    assert.equal(result.channels[0]?.configured, false)
    assert.equal(result.channels[0]?.autoReply, false)
    assert.equal(result.channels[0]?.connectorId, 'telegram:bot')
    assert.match(
      result.channels[0]?.detail ?? '',
      /could not authenticate|getMe/u,
    )

    const automationState = await readAssistantAutomationState(vaultRoot)
    assert.deepEqual(automationState.autoReplyChannels, [])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
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
        format: 'json',
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
    assert.equal(healthybobShim, buildExpectedCliShimScript(cliBinPath))
    assert.equal(vaultCliShim, buildExpectedCliShimScript(cliBinPath))
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
    buildExpectedCliShimScript(cliBinPath),
  )
  await writeExecutable(
    path.join(userBinDirectory, 'vault-cli'),
    buildExpectedCliShimScript(cliBinPath),
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

test.sequential('CLI shim rebuilds missing workspace package dist outputs before launching the built CLI', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-shim-repair-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'healthybob')
  const fakeBinDirectory = path.join(tempRoot, 'bin')
  const childPidPath = path.join(tempRoot, 'child.pid')
  const runtimeStateDistIndexPath = path.join(
    repoRoot,
    'packages',
    'runtime-state',
    'dist',
    'index.js',
  )

  try {
    await mkdir(path.dirname(cliBinPath), { recursive: true })
    await mkdir(path.dirname(runtimeStateDistIndexPath), { recursive: true })
    for (const packageName of [
      'contracts',
      'core',
      'device-syncd',
      'importers',
      'inboxd',
      'parsers',
      'query',
    ]) {
      const packageDistIndexPath = path.join(
        repoRoot,
        'packages',
        packageName,
        'dist',
        'index.js',
      )
      await mkdir(path.dirname(packageDistIndexPath), { recursive: true })
      await writeFile(
        packageDistIndexPath,
        'export {}\n',
        'utf8',
      )
    }

    await writeFile(
      cliBinPath,
      `import fs from 'node:fs'
const target = new URL('../../runtime-state/dist/index.js', import.meta.url)
if (!fs.existsSync(target)) {
  console.error('runtime-state dist missing')
  process.exit(42)
}
console.log('built-ok')
`,
      'utf8',
    )
    await writeExecutable(
      path.join(fakeBinDirectory, 'pnpm'),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "--dir" ] && [ "$3" = "build" ]; then
  mkdir -p "$2/dist"
  printf '%s\\n' 'export {}' > "$2/dist/index.js"
  exit 0
fi
exit 1
`,
    )
    await writeExecutable(shimPath, buildExpectedCliShimScript(cliBinPath))

    const result = await execFileAsync(shimPath, [], {
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    })

    assert.equal(result.stdout.trim(), 'built-ok')
    await readFile(runtimeStateDistIndexPath, 'utf8')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim force-stops a stubborn built child after SIGINT', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-shim-sigint-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'healthybob')
  const fakeBinDirectory = path.join(tempRoot, 'bin')
  const childPidPath = path.join(tempRoot, 'child.pid')

  try {
    await mkdir(path.dirname(cliBinPath), { recursive: true })
    for (const packageName of [
      'contracts',
      'core',
      'device-syncd',
      'importers',
      'inboxd',
      'parsers',
      'query',
      'runtime-state',
    ]) {
      const packageDistIndexPath = path.join(
        repoRoot,
        'packages',
        packageName,
        'dist',
        'index.js',
      )
      await mkdir(path.dirname(packageDistIndexPath), { recursive: true })
      await writeFile(packageDistIndexPath, 'export {}\n', 'utf8')
    }

    await writeFile(cliBinPath, 'console.log("built-ok")\n', 'utf8')
    await writeExecutable(
      path.join(fakeBinDirectory, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$$" > ${JSON.stringify(childPidPath)}
trap '' INT TERM
while true; do
  sleep 1
done
`,
    )
    await writeExecutable(shimPath, buildExpectedCliShimScript(cliBinPath))

    const child = spawn(shimPath, [], {
      detached: true,
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: 'ignore',
    })

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await readFile(childPidPath, 'utf8')
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    process.kill(-child.pid!, 'SIGINT')

    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          process.kill(-child.pid!, 'SIGKILL')
          reject(new Error('shim did not exit after SIGINT'))
        }, 5000)

        child.once('exit', (code, signal) => {
          clearTimeout(timer)
          resolve({ code, signal })
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      },
    )

    const stubbornChildPid = Number.parseInt(
      (await readFile(childPidPath, 'utf8')).trim(),
      10,
    )
    let childStillAlive = true
    try {
      process.kill(stubbornChildPid, 0)
    } catch {
      childStillAlive = false
    }

    assert.equal(childStillAlive, false)
    assert.equal(result.code === 130 || result.signal === 'SIGINT', true)
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
    isSetupInvocation(['onboard', '--dryRun']),
    true,
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
  const onboardHelp = await runSetupAliasRaw('healthybob', ['onboard', '--help'])
  const emptyInvocation = await runSetupAliasRaw('healthybob', [])
  const inboxHelp = await runSetupAliasRaw('healthybob', ['inbox', 'doctor', '--help'])

  assert.match(help, /Healthy Bob local machine setup helpers\./u)
  assert.match(help, /setup\s+Provision the macOS parser\/runtime toolchain/u)
  assert.match(onboardHelp, /onboard\s+[—-]\s+Alias for setup/u)
  assert.doesNotMatch(help, /search\s+Search commands for the local read model/u)
  assert.match(emptyInvocation, /Healthy Bob local machine setup helpers\./u)
  assert.doesNotMatch(inboxHelp, /Healthy Bob local machine setup helpers\./u)
  assert.match(inboxHelp, /vault-cli inbox doctor/u)
})

test.sequential('healthybob loads HEALTHYBOB_VAULT from a local .env file', async () => {
  const originalVault = process.env.HEALTHYBOB_VAULT
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-dotenv-vault-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-dotenv-home-'))
  const envVault = path.join(tempRoot, 'vault-from-dotenv')

  delete process.env.HEALTHYBOB_VAULT
  await writeFile(path.join(tempRoot, '.env'), 'HEALTHYBOB_VAULT=./vault-from-dotenv\n', 'utf8')

  try {
    await runSetupAliasRaw('healthybob', ['init'], {
      cwd: tempRoot,
      env: {
        HOME: homeRoot,
      },
    })

    await readFile(path.join(envVault, 'vault.json'), 'utf8')
    await readFile(path.join(envVault, 'CORE.md'), 'utf8')
  } finally {
    if (originalVault === undefined) {
      delete process.env.HEALTHYBOB_VAULT
    } else {
      process.env.HEALTHYBOB_VAULT = originalVault
    }

    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('healthybob keeps exported HEALTHYBOB_VAULT values ahead of local .env files', async () => {
  const originalVault = process.env.HEALTHYBOB_VAULT
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-dotenv-precedence-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-dotenv-precedence-home-'))
  const shellVault = path.join(tempRoot, 'vault-from-shell')
  const dotenvVault = path.join(tempRoot, 'vault-from-dotenv')

  delete process.env.HEALTHYBOB_VAULT
  await writeFile(path.join(tempRoot, '.env'), 'HEALTHYBOB_VAULT=./vault-from-dotenv\n', 'utf8')

  try {
    await runSetupAliasRaw('healthybob', ['init'], {
      cwd: tempRoot,
      env: {
        HEALTHYBOB_VAULT: './vault-from-shell',
        HOME: homeRoot,
      },
    })

    await readFile(path.join(shellVault, 'vault.json'), 'utf8')
    await assert.rejects(readFile(path.join(dotenvVault, 'vault.json'), 'utf8'))
  } finally {
    if (originalVault === undefined) {
      delete process.env.HEALTHYBOB_VAULT
    } else {
      process.env.HEALTHYBOB_VAULT = originalVault
    }

    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('healthybob prefers .env.local values over .env defaults', async () => {
  const originalVault = process.env.HEALTHYBOB_VAULT
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-dotenv-local-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-dotenv-local-home-'))
  const localVault = path.join(tempRoot, 'vault-from-dotenv-local')
  const dotenvVault = path.join(tempRoot, 'vault-from-dotenv')

  delete process.env.HEALTHYBOB_VAULT
  await writeFile(path.join(tempRoot, '.env'), 'HEALTHYBOB_VAULT=./vault-from-dotenv\n', 'utf8')
  await writeFile(
    path.join(tempRoot, '.env.local'),
    'HEALTHYBOB_VAULT=./vault-from-dotenv-local\n',
    'utf8',
  )

  try {
    await runSetupAliasRaw('healthybob', ['init'], {
      cwd: tempRoot,
      env: {
        HOME: homeRoot,
      },
    })

    await readFile(path.join(localVault, 'vault.json'), 'utf8')
    await assert.rejects(readFile(path.join(dotenvVault, 'vault.json'), 'utf8'))
  } finally {
    if (originalVault === undefined) {
      delete process.env.HEALTHYBOB_VAULT
    } else {
      process.env.HEALTHYBOB_VAULT = originalVault
    }

    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
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
      /the final Healthy Bob setup flow: vault bootstrap, default vault config, user-level healthybob\/vault-cli shims, onboarding channel selection, and assistant automation\/chat handoff/u,
    )
    assert.match(result.stdout, /Ensure Node >= 22\.16\.0/u)
    assert.match(result.stdout, /corepack pnpm install/u)
    assert.match(
      result.stdout,
      /node packages\/cli\/dist\/bin\.js onboard --dry-run --vault \.\/vault/u,
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
