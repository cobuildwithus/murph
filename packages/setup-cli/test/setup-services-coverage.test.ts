import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { Errors } from 'incur'
import { afterEach, test, vi } from 'vitest'

const readlineMockState = vi.hoisted(() => ({
  answers: [] as string[],
  prompts: [] as string[],
}))

const toolchainMockState = vi.hoisted(() => ({
  unavailableCommands: new Set<string>(),
}))

vi.mock('node:readline/promises', () => ({
  default: {
    createInterface: () => ({
      async question(prompt: string) {
        readlineMockState.prompts.push(prompt)
        return readlineMockState.answers.shift() ?? ''
      },
      close() {},
    }),
  },
}))

vi.mock('../src/setup-services/toolchain.ts', async () => {
  const actual = await vi.importActual<
    typeof import('../src/setup-services/toolchain.ts')
  >('../src/setup-services/toolchain.ts')

  return {
    ...actual,
    async resolveExecutablePath(
      candidates: string[],
      env: NodeJS.ProcessEnv,
      absoluteFallbacks: string[] = [],
    ): Promise<string | null> {
      const requestedCandidates = [...absoluteFallbacks, ...candidates].map(
        (candidate) => candidate.trim(),
      )
      if (
        requestedCandidates.some((candidate) =>
          toolchainMockState.unavailableCommands.has(candidate),
        )
      ) {
        return null
      }

      return actual.resolveExecutablePath(candidates, env, absoluteFallbacks)
    },
  }
})

import {
  listAssistantCronPresets,
} from '@murphai/assistant-engine/assistant-cron'
import {
  resolveAssistantStatePaths,
} from '@murphai/assistant-engine/assistant-state'
import {
  createIntegratedVaultServices,
  showWearablePreferences,
} from '@murphai/vault-usecases'
import type {
  InboxSourceSetEnabledResult,
} from '@murphai/inbox-services'
import type {
  InboxBootstrapResult,
  InboxConnectorConfig,
  InboxDoctorResult,
  InboxSourceAddResult,
  InboxSourceListResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import type {
  SetupConfiguredAssistant,
  SetupStepResult,
} from '@murphai/operator-config/setup-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  incurErrorBridge,
} from '../src/incur-error-bridge.ts'
import {
  discoverCodexHomes,
  resolveSetupCodexHomeSelection,
} from '../src/setup-codex-home.ts'
import {
  createSetupServices,
} from '../src/setup-services.ts'
import {
  configureSetupChannels,
} from '../src/setup-services/channels.ts'
import {
  createDefaultCommandRunner,
  assertCommandSucceeded,
  defaultDownloadFile,
  defaultLogger,
} from '../src/setup-services/process.ts'
import {
  configureSetupScheduledUpdates,
} from '../src/setup-services/scheduled-updates.ts'
import {
  ensureCliShims,
  hasNonEmptyFile,
  redactHomePath,
  redactHomePathsInValue,
  redactNullableHomePath,
  resolveShellProfilePath,
} from '../src/setup-services/shell.ts'
import {
  ensureBrewFormula,
  ensureHomebrew,
  ensureWhisperModel,
  resolveExecutablePath,
  withPrependedPath,
} from '../src/setup-services/toolchain.ts'

afterEach(() => {
  readlineMockState.answers = []
  readlineMockState.prompts = []
  toolchainMockState.unavailableCommands.clear()
})

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await readFile(absolutePath)
    return true
  } catch {
    return false
  }
}

const TEST_TIMESTAMP = '2026-04-08T00:00:00.000Z'

function makeInboxConnector(
  overrides: Partial<InboxConnectorConfig> & Pick<InboxConnectorConfig, 'id' | 'source'>,
): InboxConnectorConfig {
  const { options, ...rest } = overrides

  return {
    accountId: null,
    enabled: true,
    ...rest,
    options: {
      ...(options ?? {}),
    },
  }
}

function makeInboxSourceListResult(
  vault: string,
  connectors: InboxConnectorConfig[],
): InboxSourceListResult {
  return {
    vault,
    configPath: path.join(vault, '.runtime', 'config.json'),
    connectors,
  }
}

function makeInboxDoctorResult(
  vault: string,
  overrides: Partial<InboxDoctorResult> & Pick<InboxDoctorResult, 'checks'>,
): InboxDoctorResult {
  return {
    vault,
    configPath: null,
    databasePath: null,
    target: null,
    ok: true,
    connectors: [],
    ...overrides,
  }
}

function makeInboxSourceAddResult(
  vault: string,
  connector: InboxConnectorConfig,
  overrides: Partial<InboxSourceAddResult> = {},
): InboxSourceAddResult {
  return {
    vault,
    configPath: path.join(vault, '.runtime', 'config.json'),
    connector,
    connectorCount: 1,
    ...overrides,
  }
}

function makeInboxSourceSetEnabledResult(
  vault: string,
  connector: InboxConnectorConfig,
  connectorCount = 1,
): InboxSourceSetEnabledResult {
  return {
    vault,
    configPath: path.join(vault, '.runtime', 'config.json'),
    connector,
    connectorCount,
  }
}

function makeInboxBootstrapResult(
  vault: string,
  configPath: string,
): InboxBootstrapResult {
  const databasePath = path.join(vault, '.runtime', 'projections', 'inbox.sqlite')

  return {
    vault,
    init: {
      configPath,
      createdPaths: [],
      databasePath,
      rebuiltCaptures: 0,
      runtimeDirectory: path.dirname(configPath),
    },
    setup: {
      configPath,
      updatedAt: TEST_TIMESTAMP,
      tools: {
        ffmpeg: {
          available: true,
          command: '/usr/bin/ffmpeg',
          reason: 'configured for tests',
          source: 'config',
        },
        whisper: {
          available: true,
          command: '/usr/bin/whisper-cli',
          modelPath: '/tmp/whisper.bin',
          reason: 'configured for tests',
          source: 'config',
        },
      },
    },
    doctor: {
      checks: [],
      configPath,
      connectors: [],
      databasePath,
      ok: true,
      target: null,
    },
  }
}

test('configureSetupScheduledUpdates skips empty selections and deduplicates preset order', async () => {
  const emptySteps: SetupStepResult[] = []
  assert.deepEqual(
    await configureSetupScheduledUpdates({
      dryRun: false,
      presetIds: [],
      steps: emptySteps,
    }),
    [],
  )
  assert.equal(emptySteps[0]?.status, 'skipped')

  const presets = listAssistantCronPresets()
  assert.ok(presets.length >= 2)

  const steps: SetupStepResult[] = []
  const scheduledUpdates = await configureSetupScheduledUpdates({
    dryRun: true,
    presetIds: [presets[1]!.id, presets[0]!.id, presets[1]!.id],
    steps,
    vault: '/tmp/vault',
  })

  assert.deepEqual(
    scheduledUpdates.map((entry) => entry.preset.id),
    [presets[0]!.id, presets[1]!.id],
  )
  assert.equal(steps[0]?.status, 'skipped')
  assert.match(
    steps[0]?.detail ?? '',
    /Would defer 2 assistant scheduled updates:/,
  )
})

test('configureSetupScheduledUpdates describes a single deferred update outside dry-run', async () => {
  const preset = listAssistantCronPresets()[0]
  assert.ok(preset)

  const steps: SetupStepResult[] = []
  const scheduledUpdates = await configureSetupScheduledUpdates({
    dryRun: false,
    presetIds: [preset.id],
    steps,
    vault: '/tmp/vault',
  })

  assert.deepEqual(scheduledUpdates, [
    {
      preset,
      jobName: preset.suggestedName,
      status: 'skipped',
    },
  ])
  assert.equal(steps[0]?.status, 'skipped')
  assert.match(
    steps[0]?.detail ?? '',
    /^Deferred 1 assistant scheduled update:/,
  )
})

test('configureSetupChannels describes Telegram-only dry-run readiness', async () => {
  const missingSteps: SetupStepResult[] = []
  const missing = await configureSetupChannels({
    channels: ['telegram'],
    dryRun: true,
    env: {},
    inboxServices: {
      async bootstrap() {
        throw new Error('bootstrap should not run in this test')
      },
    },
    requestId: 'req-dry-run-missing',
    steps: missingSteps,
    vault: '/tmp/vault',
  })

  assert.equal(missing[0]?.autoReply, false)
  assert.equal(missing[0]?.channel, 'telegram')
  assert.equal(missing[0]?.configured, false)
  assert.equal(missing[0]?.connectorId, 'telegram:bot')
  assert.match(missing[0]?.detail ?? '', /TELEGRAM_BOT_TOKEN/u)
  assert.deepEqual(missing[0]?.missingEnv, ['TELEGRAM_BOT_TOKEN'])
  assert.equal(missingSteps[0]?.status, 'planned')

  const readySteps: SetupStepResult[] = []
  const ready = await configureSetupChannels({
    channels: ['telegram'],
    dryRun: true,
    env: { TELEGRAM_BOT_TOKEN: 'telegram-token' },
    inboxServices: {
      async bootstrap() {
        throw new Error('bootstrap should not run in this test')
      },
    },
    requestId: 'req-dry-run-ready',
    steps: readySteps,
    vault: '/tmp/vault',
  })

  assert.equal(ready[0]?.channel, 'telegram')
  assert.equal(ready[0]?.autoReply, true)
  assert.equal(ready[0]?.configured, false)
  assert.deepEqual(ready[0]?.missingEnv, [])
  assert.equal(readySteps[0]?.status, 'planned')
})

test('configureSetupChannels reuses and enables the Telegram connector while preserving unmanaged state', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'setup-cli-channel-reuse-'))
  const automationStatePath = resolveAssistantStatePaths(vaultRoot).automationStatePath
  await mkdir(path.dirname(automationStatePath), { recursive: true })
  await writeFile(
    automationStatePath,
    JSON.stringify({
      version: 1,
      autoReply: [
        { channel: 'linq', enabledAt: TEST_TIMESTAMP, eligibleAfter: null },
      ],
      updatedAt: TEST_TIMESTAMP,
    }),
    'utf8',
  )

  try {
    const setEnabledCalls: Array<{ connectorId: string; enabled: boolean }> = []
    const steps: SetupStepResult[] = []
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: { TELEGRAM_BOT_TOKEN: 'telegram-token' },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not run in this test')
        },
        async doctor() {
          return makeInboxDoctorResult(vaultRoot, {
            checks: [
              { message: 'driver ready', name: 'driver-import', status: 'pass' },
              { message: 'bot authenticated', name: 'probe', status: 'pass' },
            ],
          })
        },
        async sourceAdd() {
          throw new Error('sourceAdd should not run when Telegram already exists')
        },
        async sourceList() {
          return makeInboxSourceListResult(vaultRoot, [
            makeInboxConnector({
              accountId: 'bot',
              enabled: false,
              id: 'telegram:bot',
              source: 'telegram',
            }),
          ])
        },
        async sourceSetEnabled(input) {
          setEnabledCalls.push({
            connectorId: input.connectorId,
            enabled: input.enabled,
          })
          return makeInboxSourceSetEnabledResult(
            vaultRoot,
            makeInboxConnector({
              accountId: 'bot',
              enabled: input.enabled,
              id: input.connectorId,
              source: 'telegram',
            }),
          )
        },
      },
      requestId: 'req-reuse',
      steps,
      vault: vaultRoot,
    })

    assert.deepEqual(configured, [
      {
        autoReply: true,
        channel: 'telegram',
        configured: true,
        connectorId: 'telegram:bot',
        detail:
          'Reused the Telegram connector "telegram:bot" and enabled assistant auto-reply for Telegram direct chats.',
        enabled: true,
        missingEnv: [],
      },
    ])
    assert.deepEqual(setEnabledCalls, [
      { connectorId: 'telegram:bot', enabled: true },
    ])
    assert.equal(steps[0]?.status, 'reused')

    const saved = JSON.parse(await readFile(automationStatePath, 'utf8')) as {
      autoReply: Array<{ channel: string }>
    }
    assert.deepEqual(
      saved.autoReply.map((entry) => entry.channel).sort(),
      ['linq', 'telegram'],
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('configureSetupChannels adds Telegram without provider-specific stubs', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'setup-cli-channel-add-'))

  try {
    const sourceAdd = vi.fn(async (input: {
      account?: string | null
      id: string
      source: InboxConnectorConfig['source']
    }) =>
      makeInboxSourceAddResult(
        vaultRoot,
        makeInboxConnector({
          accountId: input.account ?? null,
          id: input.id,
          source: input.source,
        }),
      ),
    )
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: { TELEGRAM_BOT_TOKEN: 'telegram-token' },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not run in this test')
        },
        async doctor() {
          return makeInboxDoctorResult(vaultRoot, {
            checks: [{ message: 'bot authenticated', name: 'probe', status: 'pass' }],
          })
        },
        sourceAdd,
        async sourceList() {
          return makeInboxSourceListResult(vaultRoot, [])
        },
      },
      requestId: 'req-add',
      steps: [],
      vault: vaultRoot,
    })

    assert.equal(configured[0]?.connectorId, 'telegram:bot')
    assert.equal(configured[0]?.autoReply, true)
    assert.deepEqual(sourceAdd.mock.calls[0]?.[0], {
      account: 'bot',
      id: 'telegram:bot',
      requestId: 'req-add',
      source: 'telegram',
      vault: vaultRoot,
    })
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('configureSetupChannels fails clearly when Telegram source management is unavailable', async () => {
  await assert.rejects(
    () =>
      configureSetupChannels({
        channels: ['telegram'],
        dryRun: false,
        env: { TELEGRAM_BOT_TOKEN: 'telegram-token' },
        inboxServices: {
          async bootstrap() {
            throw new Error('bootstrap should not run in this test')
          },
        },
        requestId: null,
        steps: [],
        vault: '/tmp/vault',
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'runtime_unavailable' &&
      error.message.includes('Telegram'),
  )
})

test('process, shell, and toolchain helpers exercise installation and download flows deterministically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-service-helpers-'))
  const homeDirectory = path.join(root, 'home')
  const cliBinPath = path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js')
  const destinationPath = path.join(root, 'downloads', 'file.txt')
  const whisperModelPath = path.join(root, 'models', 'ggml-base.en.bin')
  const formulaPrefix = path.join(root, 'formula-prefix')
  const formulaBinDirectory = path.join(formulaPrefix, 'bin')
  const formulaCommandPath = path.join(formulaBinDirectory, 'ffmpeg')

  await mkdir(homeDirectory, { recursive: true })
  await mkdir(path.dirname(cliBinPath), { recursive: true })
  await writeFile(cliBinPath, '// cli stub\n', 'utf8')

  const steps: SetupStepResult[] = []
  const notes: string[] = []
  await ensureCliShims({
    cliBinPath,
    dryRun: false,
    env: {
      PATH: '/usr/bin',
      SHELL: '/bin/zsh',
    },
    fileExists: async (absolutePath) => {
      try {
        await readFile(absolutePath)
        return true
      } catch {
        return false
      }
    },
    homeDirectory,
    notes,
    steps,
  })

  const userBinDirectory = path.join(homeDirectory, '.local', 'bin')
  const shellProfilePath = path.join(homeDirectory, '.zshrc')
  const murphShimPath = path.join(userBinDirectory, 'murph')
  assert.equal(steps[0]?.status, 'completed')
  assert.match(notes[0] ?? '', /source ~\/\.zshrc/u)
  assert.equal(await hasNonEmptyFile(murphShimPath, fileExists), true)
  assert.match(await readFile(shellProfilePath, 'utf8'), /# >>> Murph PATH >>>/)
  assert.equal(
    resolveShellProfilePath(homeDirectory, { SHELL: '/bin/bash' }),
    path.join(homeDirectory, '.bashrc'),
  )
  assert.equal(
    resolveShellProfilePath(homeDirectory, { SHELL: '/bin/fish' }),
    path.join(homeDirectory, '.profile'),
  )
  assert.doesNotMatch(await readFile(murphShimPath, 'utf8'), /MURPH_REPO_ROOT/u)
  assert.doesNotMatch(await readFile(murphShimPath, 'utf8'), /resolve_repo_root/u)

  const reusedSteps: SetupStepResult[] = []
  await ensureCliShims({
    cliBinPath,
    dryRun: true,
    env: {
      PATH: `${userBinDirectory}${path.delimiter}/usr/bin`,
      SHELL: '/bin/zsh',
    },
    fileExists,
    homeDirectory,
    notes: [],
    steps: reusedSteps,
  })
  assert.equal(reusedSteps[0]?.status, 'reused')

  await writeFile(murphShimPath, '#!/usr/bin/env bash\nexit 1\n', 'utf8')
  await chmod(murphShimPath, 0o755)
  const correctedSteps: SetupStepResult[] = []
  await ensureCliShims({
    cliBinPath,
    dryRun: false,
    env: {
      PATH: `${userBinDirectory}${path.delimiter}/usr/bin`,
      SHELL: '/bin/zsh',
    },
    fileExists,
    homeDirectory,
    notes: [],
    steps: correctedSteps,
  })
  assert.equal(correctedSteps[0]?.status, 'completed')
  assert.match(await readFile(murphShimPath, 'utf8'), /SETUP_PROGRAM_NAME='murph'/)

  const logs: string[] = []
  const runCommand = createDefaultCommandRunner((message) => {
    logs.push(message.trim())
  })
  const commandResult = await runCommand({
    args: [
      '-e',
      'process.stdout.write("out\\n"); process.stderr.write("err\\n"); process.exit(3)',
    ],
    file: process.execPath,
  })
  assert.equal(commandResult.exitCode, 3)
  assert.equal(commandResult.stdout, 'out\n')
  assert.equal(commandResult.stderr, 'err\n')
  assert.deepEqual(logs, ['out', 'err'])
  assert.doesNotThrow(() => {
    assertCommandSucceeded({ exitCode: 0, stdout: '', stderr: '' }, 'noop')
  })
  await assert.rejects(
    async () =>
      Promise.resolve(
        assertCommandSucceeded(
          { exitCode: 9, stdout: 'stdout detail', stderr: '' },
          'stdout-only-failure',
        ),
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'stdout-only-failure' &&
      error.message === 'stdout detail',
  )
  await assert.rejects(
    async () =>
      Promise.resolve(
        assertCommandSucceeded(
          { exitCode: 8, stdout: 'stdout detail', stderr: 'stderr detail' },
          'stderr-preferred-failure',
        ),
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'stderr-preferred-failure' &&
      error.message === 'stderr detail',
  )
  await assert.rejects(
    async () =>
      Promise.resolve(
        assertCommandSucceeded(
          { exitCode: 7, stdout: '   ', stderr: '' },
          'fallback-failure',
        ),
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'fallback-failure' &&
      error.message === 'External setup command failed.',
  )
  const largeOutputResult = await runCommand({
    args: [
      '-e',
      'process.stdout.write("x".repeat(12000), () => { process.stdout.write("y".repeat(12000), () => process.exit(0)) })',
    ],
    file: process.execPath,
  })
  assert.equal(largeOutputResult.exitCode, 0)
  assert.ok(largeOutputResult.stdout.length > 0)
  assert.ok(largeOutputResult.stdout.length <= 16000)
  assert.match(largeOutputResult.stdout, /^[xy]+$/u)
  assert.ok(largeOutputResult.stdout.includes('y'))
  assert.equal(largeOutputResult.stderr, '')

  const logCountBeforeWhitespace = logs.length
  const whitespaceOutputResult = await runCommand({
    args: [
      '-e',
      'process.stdout.write("   \\n"); process.stderr.write("\\t\\n"); process.exit(0)',
    ],
    file: process.execPath,
  })
  assert.equal(whitespaceOutputResult.exitCode, 0)
  assert.equal(whitespaceOutputResult.stdout, '   \n')
  assert.equal(whitespaceOutputResult.stderr, '\t\n')
  assert.equal(logs.length, logCountBeforeWhitespace)

  const interruptedCommandResult = await runCommand({
    args: ['-e', 'process.kill(process.pid, "SIGTERM")'],
    file: process.execPath,
  })
  assert.equal(interruptedCommandResult.exitCode, 1)
  assert.equal(interruptedCommandResult.stdout, '')
  assert.equal(interruptedCommandResult.stderr, '')

  const stderrWriteSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        logs.push(`stderr:${JSON.stringify(chunk)}`)
      } else {
        logs.push(`stderr-bytes:${chunk.byteLength}`)
      }
      return true
    }) as typeof process.stderr.write)
  try {
    defaultLogger('already newline\n')
    defaultLogger('missing newline')
  } finally {
    stderrWriteSpy.mockRestore()
  }
  assert.ok(logs.includes('stderr:"already newline\\n"'))
  assert.ok(logs.includes('stderr:"missing newline\\n"'))

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('downloaded', { status: 200 })
  try {
    await defaultDownloadFile('https://example.test/file.txt', destinationPath)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(await readFile(destinationPath, 'utf8'), 'downloaded')

  globalThis.fetch = async () =>
    new Response(null, { status: 503, statusText: 'Service Unavailable' })
  try {
    await assert.rejects(
      async () =>
        defaultDownloadFile('https://example.test/fail.txt', path.join(root, 'fail.txt')),
      (error: unknown) =>
        error instanceof VaultCliError &&
        error.code === 'download_failed' &&
        error.message.includes('503 Service Unavailable'),
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  const interruptedDestinationPath = path.join(root, 'downloads', 'interrupted.txt')
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'))
          controller.error(new Error('stream failed'))
        },
      }),
      { status: 200 },
    )
  try {
    await assert.rejects(
      async () =>
        defaultDownloadFile(
          'https://example.test/interrupted.txt',
          interruptedDestinationPath,
        ),
      /stream failed/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(
    await hasNonEmptyFile(`${interruptedDestinationPath}.download`, fileExists),
    false,
  )

  const brewSteps: SetupStepResult[] = []
  const unavailableFormula = await ensureBrewFormula({
    brewState: {
      available: false,
      brewCommand: null,
      env: {},
    },
    commandCandidates: ['ffmpeg'],
    dryRun: false,
    formula: 'ffmpeg',
    id: 'ffmpeg',
    installDetail: 'Installed ffmpeg.',
    kind: 'install',
    missingPlanDetail: 'Would install ffmpeg.',
    runCommand: async () => {
      throw new Error('brew should not run when unavailable')
    },
    steps: brewSteps,
    title: 'FFmpeg',
  })
  assert.equal(unavailableFormula.command, null)
  assert.equal(brewSteps[0]?.status, 'planned')

  await mkdir(formulaBinDirectory, { recursive: true })
  await writeFile(formulaCommandPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
  await chmod(formulaCommandPath, 0o755)

  const reusedFormula = await ensureBrewFormula({
    brewState: {
      available: true,
      brewCommand: '/tmp/fake-brew',
      env: {},
    },
    commandCandidates: ['ffmpeg'],
    dryRun: false,
    formula: 'ffmpeg',
    id: 'ffmpeg',
    installDetail: 'Installed ffmpeg.',
    kind: 'install',
    missingPlanDetail: 'Would install ffmpeg.',
    runCommand: async (input) => {
      if (input.args[0] === 'list') {
        return { exitCode: 0, stdout: 'ffmpeg 1.0.0\n', stderr: '' }
      }
      if (input.args[0] === '--prefix') {
        return { exitCode: 0, stdout: formulaPrefix, stderr: '' }
      }
      throw new Error(`Unexpected brew invocation: ${input.args.join(' ')}`)
    },
    steps: [],
    title: 'FFmpeg',
  })
  assert.equal(reusedFormula.command, formulaCommandPath)

  const installSteps: SetupStepResult[] = []
  const installedFormula = await ensureBrewFormula({
    brewState: {
      available: true,
      brewCommand: '/tmp/fake-brew',
      env: {
        PATH: formulaBinDirectory,
      },
    },
    commandCandidates: ['ffmpeg'],
    dryRun: false,
    formula: 'ffmpeg',
    id: 'ffmpeg-install',
    installDetail: 'Installed ffmpeg.',
    kind: 'install',
    missingPlanDetail: 'Would install ffmpeg.',
    runCommand: async (input) => {
      if (input.args[0] === 'list') {
        return { exitCode: 0, stdout: 'ffmpeg 1.0.0\n', stderr: '' }
      }
      if (input.args[0] === '--prefix') {
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      throw new Error(`Unexpected brew invocation: ${input.args.join(' ')}`)
    },
    steps: installSteps,
    title: 'FFmpeg',
  })
  assert.equal(installedFormula.command, formulaCommandPath)
  assert.equal(installSteps[0]?.status, 'reused')

  await assert.rejects(
    async () =>
      ensureBrewFormula({
        brewState: {
          available: true,
          brewCommand: '/tmp/fake-brew',
          env: {},
        },
        commandCandidates: ['ffmpeg'],
        dryRun: false,
        formula: 'ffmpeg',
        id: 'ffmpeg-missing',
        installDetail: 'Installed ffmpeg.',
        kind: 'install',
        missingPlanDetail: 'Would install ffmpeg.',
        runCommand: async (input) => {
          if (input.args[0] === 'list') {
            return { exitCode: 1, stdout: '', stderr: '' }
          }
          if (input.args[0] === 'install') {
            return { exitCode: 0, stdout: '', stderr: '' }
          }
          if (input.args[0] === '--prefix') {
            return { exitCode: 1, stdout: '', stderr: '' }
          }
          throw new Error(`Unexpected brew invocation: ${input.args.join(' ')}`)
        },
        steps: [],
        title: 'FFmpeg',
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'formula_command_missing',
  )

  const homebrewSteps: SetupStepResult[] = []
  const dryRunHomebrew = await ensureHomebrew({
    arch: 'arm64',
    dryRun: true,
    env: {
      PATH: '',
    },
    log: () => {},
    runCommand: async () => {
      throw new Error('homebrew install should not run during dry-run')
    },
    steps: homebrewSteps,
  })
  assert.ok(typeof dryRunHomebrew.available === 'boolean')
  assert.match(homebrewSteps[0]?.status ?? '', /^(planned|reused)$/)

  const whisperSteps: SetupStepResult[] = []
  await ensureWhisperModel({
    destinationPath: whisperModelPath,
    dryRun: false,
    downloadFile: async (_url, filePath) => {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, 'model', 'utf8')
    },
    downloadUrl: 'https://example.test/model.bin',
    fileExists: async (absolutePath) => {
      try {
        await readFile(absolutePath)
        return true
      } catch {
        return false
      }
    },
    id: 'whisper-model',
    model: 'base.en',
    steps: whisperSteps,
    title: 'Whisper model',
  })
  assert.equal(whisperSteps[0]?.status, 'completed')
  assert.equal(await hasNonEmptyFile(whisperModelPath, fileExists), true)

  const reusedWhisperSteps: SetupStepResult[] = []
  await ensureWhisperModel({
    destinationPath: whisperModelPath,
    dryRun: false,
    downloadFile: async () => {
      throw new Error('download should not run when file already exists')
    },
    downloadUrl: 'https://example.test/model.bin',
    fileExists,
    id: 'whisper-model-reused',
    model: 'base.en',
    steps: reusedWhisperSteps,
    title: 'Whisper model',
  })
  assert.equal(reusedWhisperSteps[0]?.status, 'reused')

  const plannedWhisperSteps: SetupStepResult[] = []
  await ensureWhisperModel({
    destinationPath: path.join(root, 'models', 'ggml-tiny.bin'),
    dryRun: true,
    downloadFile: async () => {
      throw new Error('download should not run during dry-run')
    },
    downloadUrl: 'https://example.test/model.bin',
    fileExists,
    id: 'whisper-model-planned',
    model: 'tiny',
    steps: plannedWhisperSteps,
    title: 'Whisper model',
  })
  assert.equal(plannedWhisperSteps[0]?.status, 'planned')

  assert.equal(redactHomePath(homeDirectory, homeDirectory), '~')
  assert.equal(redactNullableHomePath(null, homeDirectory), null)
  const redactedValue = redactHomePathsInValue<{
    nested: [string, { toolchain: string }]
  }>(
    {
      nested: [homeDirectory, { toolchain: path.join(homeDirectory, '.murph') }],
    },
    homeDirectory,
  )
  assert.equal(
    redactedValue.nested[1].toolchain,
    '~/.murph',
  )
  assert.equal(
    await resolveExecutablePath(['', formulaCommandPath], { PATH: '' }),
    formulaCommandPath,
  )
  assert.equal(
    await resolveExecutablePath(
      ['missing'],
      { PATH: `${formulaBinDirectory}${path.delimiter}/usr/bin` },
    ),
    null,
  )
  assert.deepEqual(
    withPrependedPath(
      { PATH: `/usr/bin${path.delimiter}${formulaBinDirectory}` },
      [formulaBinDirectory, '', '/custom/bin', formulaBinDirectory],
    ).PATH?.split(path.delimiter),
    [formulaBinDirectory, '/custom/bin', '/usr/bin'],
  )

  await rm(root, { recursive: true, force: true })
})

test('codex home prompting supports manual entry and rejects invalid explicit homes', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'setup-cli-codex-home-'))
  const ambientHome = path.join(homeDirectory, '.codex')
  const teamHome = path.join(homeDirectory, '.codex-team')
  const manualHome = path.join(homeDirectory, 'codex-manual')
  const input = new PassThrough()
  const output = new PassThrough()
  let transcript = ''
  output.on('data', (chunk) => {
    transcript += chunk.toString()
  })

  try {
    readlineMockState.answers = ['999', '3', '~/codex-manual']
    await mkdir(path.join(ambientHome, 'sessions'), { recursive: true })
    await mkdir(teamHome, { recursive: true })
    await writeFile(path.join(teamHome, 'auth.json'), '{}', 'utf8')
    await mkdir(manualHome, { recursive: true })

    const selectionPromise = resolveSetupCodexHomeSelection({
      allowPrompt: true,
      currentCodexHome: null,
      explicitCodexHome: null,
      input,
      output,
      dependencies: {
        env: () => ({
          CODEX_HOME: ambientHome,
        }),
        getHomeDirectory: () => homeDirectory,
      },
    })
    const selected = await selectionPromise

    assert.deepEqual(selected, {
      codexHome: manualHome,
      discoveredHomes: [teamHome],
    })
    assert.match(transcript, /Enter a number between 1 and 3\./)

    await assert.rejects(
      async () =>
        resolveSetupCodexHomeSelection({
          allowPrompt: false,
          currentCodexHome: null,
          explicitCodexHome: '~/missing-home',
          input: new PassThrough(),
          output: new PassThrough(),
          dependencies: {
            getHomeDirectory: () => homeDirectory,
          },
        }),
      (error: unknown) =>
        error instanceof VaultCliError &&
        error.code === 'invalid_option' &&
        error.message.includes('missing-home'),
    )
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('codex home selection accepts the default current home', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'setup-cli-codex-home-default-'))
  const ambientHome = path.join(homeDirectory, '.codex')
  const currentHome = path.join(homeDirectory, '.codex-team')

  try {
    await mkdir(path.join(ambientHome, 'sessions'), { recursive: true })
    await mkdir(path.join(currentHome, 'archived_sessions'), { recursive: true })

    const defaultInput = new PassThrough()
    const defaultOutput = new PassThrough()
    const defaultSelectionPromise = resolveSetupCodexHomeSelection({
      allowPrompt: true,
      currentCodexHome: currentHome,
      explicitCodexHome: null,
      input: defaultInput,
      output: defaultOutput,
      dependencies: {
        env: () => ({
          CODEX_HOME: ambientHome,
        }),
        getHomeDirectory: () => homeDirectory,
      },
    })
    setImmediate(() => {
      defaultInput.end('\n')
    })
    const defaultSelection = await defaultSelectionPromise
    assert.deepEqual(defaultSelection, {
      codexHome: currentHome,
      discoveredHomes: [currentHome],
    })
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('codex home selection covers explicit home validation, unreadable current homes, and missing discovery roots', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'setup-cli-codex-home-loops-'))
  const ambientHome = path.join(homeDirectory, '.codex')
  const currentFile = path.join(homeDirectory, '.codex-current')

  try {
    await mkdir(path.join(ambientHome, 'sessions'), { recursive: true })
    await writeFile(currentFile, 'not a directory', 'utf8')

    const explicitSelection = await resolveSetupCodexHomeSelection({
      allowPrompt: false,
      currentCodexHome: null,
      explicitCodexHome: '~',
      input: new PassThrough(),
      output: new PassThrough(),
      dependencies: {
        getHomeDirectory: () => homeDirectory,
      },
    })
    assert.equal(explicitSelection.codexHome, homeDirectory)

    assert.deepEqual(
      await resolveSetupCodexHomeSelection({
        allowPrompt: false,
        currentCodexHome: currentFile,
        explicitCodexHome: null,
        input: new PassThrough(),
        output: new PassThrough(),
        dependencies: {
          getHomeDirectory: () => homeDirectory,
        },
      }),
      {
        codexHome: currentFile,
        discoveredHomes: [],
      },
    )

    assert.deepEqual(
      await discoverCodexHomes({
        env: {
          CODEX_HOME: ambientHome,
        },
        homeDirectory: path.join(homeDirectory, 'missing'),
      }),
      [],
    )
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

test('incur error bridge maps VaultCliError metadata and preserves typed defaults', async () => {
  const middlewareContext: Parameters<typeof incurErrorBridge>[0] = {
    agent: false,
    command: 'setup',
    displayName: 'setup',
    env: {},
    error(options) {
      throw new Error(options.message)
    },
    format: 'json',
    formatExplicit: true,
    name: 'setup',
    set() {},
    var: {},
    version: undefined,
  }

  await assert.rejects(
    async () =>
      incurErrorBridge(
        middlewareContext,
        async () => {
          throw new VaultCliError('setup_bridge', 'bridge failure', {
            retryable: true,
            exitCode: 7,
            ignored: 'value',
          })
        },
      ),
    (error: unknown) =>
      error instanceof Errors.IncurError &&
      error.code === 'setup_bridge' &&
      error.message === 'bridge failure' &&
      error.retryable === true &&
      error.exitCode === 7,
  )

  await assert.rejects(
    async () =>
      incurErrorBridge(
        middlewareContext,
        async () => {
          throw new VaultCliError('setup_bridge_invalid', 'bridge failure', {
            retryable: 'yes',
            exitCode: '7',
          })
        },
      ),
    (error: unknown) =>
      error instanceof Errors.IncurError &&
      error.code === 'setup_bridge_invalid' &&
      error.retryable === false &&
      error.exitCode === undefined,
  )
})

test('createSetupServices reuses deterministic linux toolchain inputs and writes setup state safely', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-services-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const binDirectory = path.join(root, 'bin')
  const toolchainRoot = path.join(root, 'toolchain')
  const vaultPath = path.join(cwd, 'vault')
  const cliBinPath = path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js')

  await mkdir(cwd, { recursive: true })
  await mkdir(homeDirectory, { recursive: true })
  await mkdir(binDirectory, { recursive: true })
  await mkdir(path.dirname(cliBinPath), { recursive: true })
  await writeFile(cliBinPath, '// cli stub\n', 'utf8')

  for (const tool of ['ffmpeg', 'whisper-cli']) {
    const toolPath = path.join(binDirectory, tool)
    await writeFile(toolPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await chmod(toolPath, 0o755)
  }

  const whisperModelPath = path.join(
    toolchainRoot,
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  await mkdir(path.dirname(whisperModelPath), { recursive: true })
  await writeFile(whisperModelPath, 'model', 'utf8')

  const initCalls: string[] = []
  const bootstrapCalls: string[] = []
  const assistant: SetupConfiguredAssistant = {
    preset: 'skip',
    enabled: false,
    provider: null,
    model: null,
    codexCommand: null,
    codexHome: undefined,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    oss: false,
    account: null,
    detail: 'Skipped',
  }

  try {
    const vaultCore = createIntegratedVaultServices().core
    const services = createSetupServices({
      arch: () => 'x64',
      env: () => ({
        PATH: binDirectory,
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      platform: () => 'linux',
      resolveCliBinPath: () => cliBinPath,
      inboxServices: {
        async bootstrap(input) {
          bootstrapCalls.push(input.vault)
          return makeInboxBootstrapResult(
            input.vault,
            path.join(homeDirectory, '.runtime', 'toolchain.json'),
          )
        },
      },
      vaultServices: {
        core: {
          ...vaultCore,
          async init(input) {
            initCalls.push(input.vault)
            await mkdir(input.vault, { recursive: true })
            await writeFile(path.join(input.vault, 'vault.json'), '{}', 'utf8')
            return {
              created: true,
              directories: [input.vault],
              files: [path.join(input.vault, 'vault.json')],
              vault: input.vault,
            }
          },
        },
      },
    })

    const result = await services.setupHost({
      assistant,
      channels: [],
      dryRun: false,
      requestId: 'req-setup',
      scheduledUpdatePresetIds: [
        listAssistantCronPresets()[1]!.id,
        listAssistantCronPresets()[0]!.id,
      ],
      strict: false,
      toolchainRoot,
      vault: './vault',
    })

    assert.deepEqual(initCalls, [vaultPath])
    assert.deepEqual(bootstrapCalls, [vaultPath])
    assert.equal(result.platform, 'linux')
    assert.equal(result.vault, vaultPath)
    assert.equal(result.toolchainRoot, toolchainRoot)
    assert.equal(
      result.bootstrap?.setup.configPath,
      path.join('~', '.runtime', 'toolchain.json'),
    )
    assert.equal(result.assistant?.enabled, false)
    assert.equal(
      result.steps.find((step) => step.id === 'assistant-defaults')?.status,
      'skipped',
    )
    assert.equal(
      result.steps.find((step) => step.id === 'default-vault')?.status,
      'completed',
    )
    assert.deepEqual(
      result.steps
        .filter((step) => step.id.startsWith('channel-'))
        .map((step) => step.id),
      [],
    )
    assert.equal(result.scheduledUpdates.length, 2)

    const secondResult = await services.setupHost({
      assistant,
      dryRun: false,
      toolchainRoot,
      vault: './vault',
    })

    assert.deepEqual(initCalls, [vaultPath])
    assert.deepEqual(bootstrapCalls, [vaultPath, vaultPath])
    assert.equal(
      secondResult.steps.find((step) => step.id === 'vault-init')?.status,
      'reused',
    )
    assert.equal(
      secondResult.steps.find((step) => step.id === 'default-vault')?.status,
      'reused',
    )

    await assert.rejects(
      async () =>
        createSetupServices({
          getHomeDirectory: () => homeDirectory,
          getCwd: () => cwd,
          platform: () => 'linux',
        }).setupHost({
          vault: './vault',
        }),
      (error: unknown) =>
        error instanceof VaultCliError &&
        error.code === 'setup_cli_binary_path_missing' &&
        error.message.includes('published Murph CLI binary path'),
    )

    await assert.rejects(
      async () =>
        createSetupServices({
          platform: () => 'win32',
        }).setupHost({
          vault: './vault',
        }),
      (error: unknown) =>
        error instanceof VaultCliError &&
        error.code === 'unsupported_platform',
    )

    await assert.rejects(
      async () =>
        createSetupServices({
          platform: () => 'linux',
        }).setupMacos({
          vault: './vault',
        }),
      (error: unknown) =>
        error instanceof VaultCliError &&
        error.code === 'unsupported_platform' &&
        error.message.includes('setupMacos'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createSetupServices keeps prompted provider credentials out of provisioning subprocess envs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-provider-env-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const binDirectory = path.join(root, 'bin')
  const toolchainRoot = path.join(root, 'toolchain')
  const cliBinPath = path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js')

  await mkdir(cwd, { recursive: true })
  await mkdir(homeDirectory, { recursive: true })
  await mkdir(binDirectory, { recursive: true })
  await mkdir(path.dirname(cliBinPath), { recursive: true })
  await writeFile(cliBinPath, '// cli stub\n', 'utf8')
  for (const tool of ['apt-get', 'sudo']) {
    const toolPath = path.join(binDirectory, tool)
    await writeFile(toolPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await chmod(toolPath, 0o755)
  }
  const whisperModelPath = path.join(
    toolchainRoot,
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  await mkdir(path.dirname(whisperModelPath), { recursive: true })
  await writeFile(whisperModelPath, 'model', 'utf8')

  const commandEnvs: NodeJS.ProcessEnv[] = []
  const setupCredentialEnv: NodeJS.ProcessEnv = {
    JUNCTION_API_KEY: 'junction_key_SENTINEL',
    JUNCTION_CLIENT_USER_ID_SECRET: 'junction_user_secret_SENTINEL',
    OURA_CLIENT_ID: 'oura_client_id_SENTINEL',
    OURA_CLIENT_SECRET: 'oura_client_secret_SENTINEL',
    STRAVA_CLIENT_ID: 'strava_client_id_SENTINEL',
    STRAVA_CLIENT_SECRET: 'strava_client_secret_SENTINEL',
    TELEGRAM_BOT_TOKEN: 'telegram_token_SENTINEL',
    WHOOP_CLIENT_ID: 'whoop_client_id_SENTINEL',
    WHOOP_CLIENT_SECRET: 'whoop_client_secret_SENTINEL',
  }
  const setupNonCredentialEnv: NodeJS.ProcessEnv = {
    JUNCTION_ENV: 'sandbox',
    JUNCTION_REGION: 'us',
  }

  try {
    const services = createSetupServices({
      arch: () => 'x64',
      env: () => ({
        ...setupNonCredentialEnv,
        ...setupCredentialEnv,
        OPENAI_API_KEY: 'openai_secret_SENTINEL',
        PATH: binDirectory,
        VENICE_API_KEY: 'venice_secret_SENTINEL',
        VERCEL_AI_API_KEY: 'vercel_secret_SENTINEL',
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      platform: () => 'linux',
      resolveCliBinPath: () => cliBinPath,
      async runCommand(input) {
        commandEnvs.push({ ...input.env })
        return {
          exitCode: 1,
          stderr: 'install unavailable',
          stdout: '',
        }
      },
      inboxServices: {
        async bootstrap(input) {
          return makeInboxBootstrapResult(
            input.vault,
            path.join(homeDirectory, '.runtime', 'toolchain.json'),
          )
        },
      },
    })

    const result = await services.setupHost({
      assistant: {
        preset: 'skip',
        enabled: false,
        provider: null,
        model: null,
        modelProvider: null,
        codexCommand: null,
        codexHome: undefined,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        oss: false,
        account: null,
        detail: 'Skipped',
      },
      channels: [],
      dryRun: false,
      envOverrides: {
        ...setupNonCredentialEnv,
        ...setupCredentialEnv,
      },
      localEnvOverrides: {
        ...setupNonCredentialEnv,
        ...setupCredentialEnv,
        VENICE_API_KEY: 'venice_secret_SENTINEL',
      },
      strict: false,
      toolchainRoot,
      vault: './vault',
      wearables: ['oura', 'whoop', 'strava', 'garmin'],
    })

    assert.ok(commandEnvs.length > 0)
    for (const env of commandEnvs) {
      assert.equal(env.OPENAI_API_KEY, undefined)
      assert.equal(env.VENICE_API_KEY, undefined)
      assert.equal(env.VERCEL_AI_API_KEY, undefined)
      for (const key of Object.keys(setupCredentialEnv)) {
        assert.equal(env[key], undefined)
      }
    }
    assert.equal(JSON.stringify(result).includes('venice_secret_SENTINEL'), false)
    for (const value of Object.values(setupCredentialEnv)) {
      assert.equal(JSON.stringify(result).includes(value ?? ''), false)
    }
    assert.deepEqual(
      result.wearables.map((wearable) => [wearable.wearable, wearable.ready]),
      [
        ['garmin', true],
        ['oura', true],
        ['strava', true],
        ['whoop', true],
      ],
    )
    assert.match(
      await readFile(path.join(cwd, '.env.local'), 'utf8'),
      /VENICE_API_KEY="venice_secret_SENTINEL"/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createSetupServices saves canonical wearable preferences, including explicit empty selections', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-services-wearable-prefs-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const binDirectory = path.join(root, 'bin')
  const toolchainRoot = path.join(root, 'toolchain')
  const vaultPath = path.join(cwd, 'vault')
  const cliBinPath = path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js')

  await mkdir(cwd, { recursive: true })
  await mkdir(homeDirectory, { recursive: true })
  await mkdir(binDirectory, { recursive: true })
  await mkdir(path.dirname(cliBinPath), { recursive: true })
  await writeFile(cliBinPath, '// cli stub\n', 'utf8')

  for (const tool of ['ffmpeg', 'whisper-cli']) {
    const toolPath = path.join(binDirectory, tool)
    await writeFile(toolPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await chmod(toolPath, 0o755)
  }

  const whisperModelPath = path.join(
    toolchainRoot,
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  await mkdir(path.dirname(whisperModelPath), { recursive: true })
  await writeFile(whisperModelPath, 'model', 'utf8')

  const assistant: SetupConfiguredAssistant = {
    preset: 'skip',
    enabled: false,
    provider: null,
    model: null,
    codexCommand: null,
    codexHome: undefined,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    oss: false,
    account: null,
    detail: 'Skipped',
  }

  try {
    const vaultCore = createIntegratedVaultServices().core
    const services = createSetupServices({
      arch: () => 'x64',
      env: () => ({
        PATH: binDirectory,
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      platform: () => 'linux',
      resolveCliBinPath: () => cliBinPath,
      inboxServices: {
        async bootstrap(input) {
          return makeInboxBootstrapResult(
            input.vault,
            path.join(homeDirectory, '.runtime', 'toolchain.json'),
          )
        },
      },
      vaultServices: {
        core: {
          ...vaultCore,
          async init(input) {
            await mkdir(input.vault, { recursive: true })
            await writeFile(path.join(input.vault, 'vault.json'), '{}', 'utf8')
            return {
              created: true,
              directories: [input.vault],
              files: [path.join(input.vault, 'vault.json')],
              vault: input.vault,
            }
          },
        },
      },
    })

    const firstResult = await services.setupHost({
      assistant,
      dryRun: false,
      strict: false,
      toolchainRoot,
      vault: './vault',
      wearables: ['whoop', 'garmin'],
    })

    assert.equal(
      firstResult.steps.find((step) => step.id === 'wearable-preferences')?.status,
      'completed',
    )
    assert.deepEqual(
      (await showWearablePreferences(vaultPath)).wearablePreferences,
      {
        desiredProviders: ['garmin', 'whoop'],
      },
    )

    const secondResult = await services.setupHost({
      assistant,
      dryRun: false,
      strict: false,
      toolchainRoot,
      vault: './vault',
      wearables: [],
    })

    assert.equal(
      secondResult.steps.find((step) => step.id === 'wearable-preferences')?.status,
      'completed',
    )
    assert.deepEqual(
      (await showWearablePreferences(vaultPath)).wearablePreferences,
      {
        desiredProviders: [],
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createSetupServices dry-run on macOS plans toolchain and assistant defaults without mutating state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-services-macos-dry-run-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const vaultPath = path.join(cwd, 'vault')
  const cliBinPath = path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js')
  const preset = listAssistantCronPresets()[0]
  assert.ok(preset)

  const assistant: SetupConfiguredAssistant = {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    codexCommand: 'codex',
    codexHome: null,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: null,
    detail: 'Configured Codex gpt-5.6-terra.',
  }

  try {
    await mkdir(vaultPath, { recursive: true })
    await writeFile(path.join(vaultPath, 'vault.json'), '{}', 'utf8')
    await mkdir(path.dirname(cliBinPath), { recursive: true })
    await writeFile(cliBinPath, '// cli stub\n', 'utf8')

    const services = createSetupServices({
      arch: () => 'arm64',
      env: () => ({
        PATH: '',
        SHELL: '/bin/zsh',
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      platform: () => 'darwin',
      resolveCliBinPath: () => cliBinPath,
      runCommand: async (input) => {
        if (input.args[0] === 'list' && input.args[1] === '--versions') {
          return { exitCode: 1, stdout: '', stderr: '' }
        }
        throw new Error(`unexpected dry-run macOS command: ${input.file} ${input.args.join(' ')}`)
      },
    })

    const result = await services.setupMacos({
      assistant,
      dryRun: true,
      scheduledUpdatePresetIds: [preset.id],
      vault: './vault',
    })

    assert.equal(result.platform, 'darwin')
    assert.equal(result.vault, path.join(cwd, 'vault'))
    assert.equal(result.toolchainRoot, '~/.murph/toolchain')
    assert.match(
      result.steps.find((step) => step.id === 'homebrew')?.status ?? '',
      /^(planned|reused)$/,
    )
    assert.equal(
      result.steps.find((step) => step.id === 'vault-init')?.status,
      'reused',
    )
    assert.equal(
      result.steps.find((step) => step.id === 'inbox-bootstrap')?.status,
      'planned',
    )
    assert.equal(
      result.steps.find((step) => step.id === 'default-vault')?.status,
      'planned',
    )
    assert.equal(
      result.steps.find((step) => step.id === 'assistant-defaults')?.status,
      'planned',
    )
    assert.equal(result.scheduledUpdates.length, 1)
    assert.doesNotMatch(result.notes.join('\n'), /assistant backend/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('createSetupServices on linux records apt provisioning failures and saves assistant/default-vault state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-services-linux-failures-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const vaultPath = path.join(cwd, 'vault')
  const binDirectory = path.join(root, 'bin')
  const aptGetPath = path.join(binDirectory, 'apt-get')
  const sudoPath = path.join(binDirectory, 'sudo')
  const toolchainRoot = path.join(homeDirectory, '.murph', 'toolchain')
  const bootstrapConfigPath = path.join(homeDirectory, '.runtime', 'toolchain.json')
  const runCalls: string[] = []

  const assistant: SetupConfiguredAssistant = {
    account: null,
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome: null,
    detail: 'Configured Codex.',
    enabled: true,
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    preset: 'codex',
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'high',
    sandbox: 'danger-full-access',
  }

  try {
    await mkdir(binDirectory, { recursive: true })
    await mkdir(cwd, { recursive: true })
    await mkdir(homeDirectory, { recursive: true })
    await writeFile(aptGetPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await writeFile(sudoPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await chmod(aptGetPath, 0o755)
    await chmod(sudoPath, 0o755)

    const vaultCore = createIntegratedVaultServices().core
    const services = createSetupServices({
      downloadFile: async (_url, destinationPath) => {
        await mkdir(path.dirname(destinationPath), { recursive: true })
        await writeFile(destinationPath, 'whisper model', 'utf8')
      },
      env: () => ({
        PATH: binDirectory,
        SHELL: '/bin/zsh',
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      inboxServices: {
        async bootstrap(input) {
          return makeInboxBootstrapResult(input.vault, bootstrapConfigPath)
        },
      },
      platform: () => 'linux',
      resolveCliBinPath: () => path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js'),
      runCommand: async (input) => {
        runCalls.push(`${input.file} ${input.args.join(' ')}`)
        if (input.args.at(-1) === 'update') {
          return {
            exitCode: 1,
            stderr: 'apt update denied',
            stdout: '',
          }
        }
        if (input.args.includes('whisper-cpp')) {
          return {
            exitCode: 0,
            stderr: '',
            stdout: '',
          }
        }
        return {
          exitCode: 0,
          stderr: '',
          stdout: '',
        }
      },
      vaultServices: {
        core: {
          ...vaultCore,
          async init(input) {
            await mkdir(input.vault, { recursive: true })
            await writeFile(path.join(input.vault, 'vault.json'), '{}', 'utf8')
            return {
              created: true,
              directories: [input.vault],
              files: [path.join(input.vault, 'vault.json')],
              vault: input.vault,
            }
          },
        },
      },
    })

    const result = await services.setupHost({
      assistant,
      dryRun: false,
      envOverrides: {
        MURPH_SETUP_TEST_KEY: 'test-local-env-value',
      },
      strict: false,
      toolchainRoot,
      vault: './vault',
    })

    assert.equal(result.platform, 'linux')
    assert.equal(result.vault, vaultPath)
    assert.equal(result.steps.find((step) => step.id === 'ffmpeg')?.status, 'skipped')
    assert.equal(result.steps.find((step) => step.id === 'whisper-cpp')?.status, 'skipped')
    assert.equal(
      result.steps.find((step) => step.id === 'assistant-defaults')?.status,
      'completed',
    )
    assert.equal(
      result.steps.find((step) => step.id === 'default-vault')?.status,
      'completed',
    )
    assert.match(result.notes.join('\n'), /apt update denied/u)
    assert.match(
      await readFile(path.join(cwd, '.env.local'), 'utf8'),
      /MURPH_SETUP_TEST_KEY="test-local-env-value"/u,
    )
    assert.equal((await stat(path.join(cwd, '.env.local'))).mode & 0o777, 0o600)
    assert.equal(
      result.steps.find((step) => step.id === 'local-env')?.status,
      'completed',
    )
    assert.equal(result.tools.ffmpegCommand, null)
    assert.equal(result.tools.whisperCommand, null)
    assert.equal(
      result.bootstrap?.setup.configPath,
      path.join('~', '.runtime', 'toolchain.json'),
    )
    assert.ok(runCalls.some((call) => call.includes(' update')))
    assert.ok(runCalls.some((call) => call.includes(' install -y whisper-cpp')))

    toolchainMockState.unavailableCommands = new Set([
      'apt-get',
      '/usr/bin/apt-get',
      '/bin/apt-get',
      'sudo',
      '/usr/bin/sudo',
      '/bin/sudo',
    ])

    const noAptServices = createSetupServices({
      downloadFile: async (_url, destinationPath) => {
        await mkdir(path.dirname(destinationPath), { recursive: true })
        await writeFile(destinationPath, 'whisper model', 'utf8')
      },
      env: () => ({
        PATH: '',
        SHELL: '/bin/zsh',
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      inboxServices: {
        async bootstrap(input) {
          return makeInboxBootstrapResult(input.vault, bootstrapConfigPath)
        },
      },
      platform: () => 'linux',
      resolveCliBinPath: () => path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js'),
      runCommand: async () => {
        throw new Error('apt should not run when unavailable')
      },
      vaultServices: {
        core: {
          ...vaultCore,
          async init(input) {
            await mkdir(input.vault, { recursive: true })
            await writeFile(path.join(input.vault, 'vault.json'), '{}', 'utf8')
            return {
              created: true,
              directories: [input.vault],
              files: [path.join(input.vault, 'vault.json')],
              vault: input.vault,
            }
          },
        },
      },
    })
    const noAptResult = await noAptServices.setupHost({
      dryRun: false,
      strict: false,
      toolchainRoot: path.join(homeDirectory, '.murph', 'toolchain-no-apt'),
      vault: './vault-no-apt',
    })
    assert.match(
      noAptResult.notes.join('\n'),
      /apt-get or passwordless sudo is unavailable on this host\./u,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('createSetupServices refuses to write setup keys through a symlinked local env file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-services-env-symlink-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const targetEnvPath = path.join(root, 'outside-env')
  const bootstrapConfigPath = path.join(homeDirectory, '.runtime', 'toolchain.json')

  try {
    await mkdir(cwd, { recursive: true })
    await mkdir(homeDirectory, { recursive: true })
    await writeFile(targetEnvPath, 'EXISTING=true\n', 'utf8')
    await symlink(targetEnvPath, path.join(cwd, '.env.local'))

    const vaultCore = createIntegratedVaultServices().core
    const services = createSetupServices({
      downloadFile: async (_url, destinationPath) => {
        await mkdir(path.dirname(destinationPath), { recursive: true })
        await writeFile(destinationPath, 'whisper model', 'utf8')
      },
      env: () => ({
        PATH: '',
        SHELL: '/bin/zsh',
      }),
      getCwd: () => cwd,
      getHomeDirectory: () => homeDirectory,
      inboxServices: {
        async bootstrap(input) {
          return makeInboxBootstrapResult(input.vault, bootstrapConfigPath)
        },
      },
      platform: () => 'linux',
      resolveCliBinPath: () => path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js'),
      runCommand: async () => ({
        exitCode: 0,
        stderr: '',
        stdout: '',
      }),
      vaultServices: {
        core: {
          ...vaultCore,
          async init(input) {
            await mkdir(input.vault, { recursive: true })
            await writeFile(path.join(input.vault, 'vault.json'), '{}', 'utf8')
            return {
              created: true,
              directories: [input.vault],
              files: [path.join(input.vault, 'vault.json')],
              vault: input.vault,
            }
          },
        },
      },
    })

    await assert.rejects(
      services.setupHost({
        dryRun: false,
        envOverrides: {
          CUSTOM_API_KEY: 'test-api-key',
        },
        strict: false,
        toolchainRoot: path.join(homeDirectory, '.murph', 'toolchain'),
        vault: './vault',
      }),
      (error) =>
        error instanceof VaultCliError &&
        error.code === 'setup_local_env_unsafe_path',
    )
    assert.equal(await readFile(targetEnvPath, 'utf8'), 'EXISTING=true\n')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('createSetupServices on linux covers root apt install success paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setup-cli-services-linux-success-'))
  const cwd = path.join(root, 'workspace')
  const homeDirectory = path.join(root, 'home')
  const bootstrapConfigPath = path.join(homeDirectory, '.runtime', 'toolchain.json')
  const rootBinDirectory = path.join(root, 'bin-root')
  const rootAptPath = path.join(rootBinDirectory, 'apt-get')
  const rootToolchainRoot = path.join(homeDirectory, '.murph', 'toolchain-root')
  const rootVaultPath = path.join(cwd, 'vault-root')

  try {
    await mkdir(cwd, { recursive: true })
    await mkdir(homeDirectory, { recursive: true })
    await mkdir(rootBinDirectory, { recursive: true })
    await writeFile(rootAptPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await chmod(rootAptPath, 0o755)

    const vaultCore = createIntegratedVaultServices().core
    const getuidMock =
      typeof process.getuid === 'function'
        ? vi.spyOn(process, 'getuid').mockReturnValue(0)
        : null

    try {
      const rootServices = createSetupServices({
        downloadFile: async (_url, destinationPath) => {
          await mkdir(path.dirname(destinationPath), { recursive: true })
          await writeFile(destinationPath, 'whisper model', 'utf8')
        },
        env: () => ({
          PATH: rootBinDirectory,
          SHELL: '/bin/zsh',
        }),
        getCwd: () => cwd,
        getHomeDirectory: () => homeDirectory,
        inboxServices: {
          async bootstrap(input) {
            return makeInboxBootstrapResult(input.vault, bootstrapConfigPath)
          },
        },
        platform: () => 'linux',
        resolveCliBinPath: () => path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js'),
        runCommand: async (input) => {
          if (input.args.at(-1) === 'update') {
            return { exitCode: 0, stderr: '', stdout: '' }
          }

          if (input.args.includes('install') && input.args.includes('ffmpeg')) {
            await writeFile(path.join(rootBinDirectory, 'ffmpeg'), '#!/usr/bin/env bash\nexit 0\n', 'utf8')
            await chmod(path.join(rootBinDirectory, 'ffmpeg'), 0o755)
            return { exitCode: 0, stderr: '', stdout: '' }
          }

          if (input.args.includes('install') && input.args.includes('whisper-cpp')) {
            await writeFile(path.join(rootBinDirectory, 'whisper-cli'), '#!/usr/bin/env bash\nexit 0\n', 'utf8')
            await chmod(path.join(rootBinDirectory, 'whisper-cli'), 0o755)
            return { exitCode: 0, stderr: '', stdout: '' }
          }

          throw new Error(`unexpected root apt command: ${input.file} ${input.args.join(' ')}`)
        },
        vaultServices: {
          core: {
            ...vaultCore,
            async init(input) {
              await mkdir(input.vault, { recursive: true })
              await writeFile(path.join(input.vault, 'vault.json'), '{}', 'utf8')
              return {
                created: true,
                directories: [input.vault],
                files: [path.join(input.vault, 'vault.json')],
                vault: input.vault,
              }
            },
          },
        },
      })

      const rootResult = await rootServices.setupHost({
        dryRun: false,
        strict: false,
        toolchainRoot: rootToolchainRoot,
        vault: './vault-root',
      })

      assert.equal(rootResult.vault, rootVaultPath)
      assert.equal(
        rootResult.steps.find((step) => step.id === 'ffmpeg')?.status,
        'completed',
      )
      assert.equal(
        rootResult.steps.find((step) => step.id === 'whisper-cpp')?.status,
        'completed',
      )
      assert.match(rootResult.tools.ffmpegCommand ?? '', /ffmpeg$/u)
      assert.match(rootResult.tools.whisperCommand ?? '', /whisper-cli$/u)
    } finally {
      getuidMock?.mockRestore()
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
