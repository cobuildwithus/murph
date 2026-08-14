import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test, vi } from 'vitest'
import type {
  InboxServices,
  InboxSourceSetEnabledResult,
} from '@murphai/inbox-services'
import {
  buildSetupWizardPublicUrlReview,
  configureSetupScheduledUpdates,
  createSetupAssistantAccountResolver,
  createSetupCli,
  createSetupServices,
  createSetupWizardCompletionController,
  describeSetupWizardPublicUrlStrategyChoice,
  detectCodexAccountFromAuthJson,
  detectSetupProgramName,
  getDefaultSetupWizardScheduledUpdates,
  inferSetupWizardAssistantProvider,
  isSetupInvocation,
  listSetupPendingWearables,
  listSetupReadyWearables,
  resolveInitialSetupWizardChannels,
  resolveInitialSetupWizardScheduledUpdates,
  resolveSetupWizardInitialScheduledUpdates,
  resolveSetupWizardAssistantSelection,
  resolveSetupPostLaunchAction,
  shouldAutoLaunchAssistantAfterSetup,
  shouldRunSetupWizard,
  type SuccessfulSetupContext,
  type SetupWizardResult,
} from '@murphai/setup-cli/setup-cli'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '@murphai/assistant-engine/assistant-state'
import { listAssistantCronJobs } from '@murphai/assistant-engine/assistant-cron'
import {
  buildAssistantProviderDefaultsPatch,
  readOperatorConfig,
  resolveOperatorConfigPath,
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
} from '@murphai/operator-config/operator-config'
import {
  describeSelectedSetupWearables,
  resolveSetupChannelMissingEnv,
  resolveSetupWearableMissingEnv,
} from '@murphai/operator-config/setup-runtime-env'
import type { InboxConnectorConfig } from '@murphai/operator-config/inbox-cli-contracts'
import type { SetupResult } from '@murphai/operator-config/setup-cli-contracts'
import { loadCliEnvFiles, runMurphCliAction } from '../src/cli-entry.ts'
import {
  repoRoot,
  requireData,
  type CliEnvelope,
  withoutNodeV8Coverage,
} from './cli-test-helpers.js'

const execFileAsync = promisify(execFile)
const SETUP_ALIAS_TIMEOUT_MS = 90_000
const SETUP_ONBOARD_TIMEOUT_MS = 90_000

type InboxBootstrapInput = Parameters<InboxServices['bootstrap']>[0]
type InboxDoctorInput = Parameters<InboxServices['doctor']>[0]
type InboxSourceAddInput = Parameters<InboxServices['sourceAdd']>[0]
type InboxSourceListInput = Parameters<InboxServices['sourceList']>[0]
type InboxSourceSetEnabledInput = Parameters<InboxServices['sourceSetEnabled']>[0]

function listAutoReplyChannels(
  state: Awaited<ReturnType<typeof readAssistantAutomationState>>,
): string[] {
  return state.autoReply.map((entry) => entry.channel)
}

function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8')
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const encode = (value: Buffer) =>
    value
      .toString('base64')
      .replace(/=/gu, '')
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_')

  return `${encode(header)}.${encode(body)}.`
}

function buildOwnedCliBinPath(root: string): string {
  return path.join(root, 'repo', 'packages', 'cli', 'dist', 'bin.js')
}

test('setup wizard completion waits for Ink exit before resolving the selected flow', async () => {
  const completion = createSetupWizardCompletionController()
  const selected = {
    assistantPreset: 'codex' as const,
    channels: ['telegram'] as const,
    scheduledUpdates: ['weekly-health-snapshot'] as const,
    wearables: [] as const,
  }

  let settled = false
  const pendingResult = completion.waitForResult().then((result: SetupWizardResult) => {
    settled = true
    return result
  })

  completion.submit({
    assistantPreset: selected.assistantPreset,
    channels: [...selected.channels],
    scheduledUpdates: [...selected.scheduledUpdates],
    wearables: [...selected.wearables],
  })
  await Promise.resolve()
  assert.equal(settled, false)

  completion.completeExit()

  assert.deepEqual(await pendingResult, {
    assistantPreset: 'codex',
    channels: ['telegram'],
    scheduledUpdates: ['weekly-health-snapshot'],
    wearables: [],
  })
})

test('setup wizard scheduled updates default to the starter bundle', () => {
  assert.deepEqual(getDefaultSetupWizardScheduledUpdates(), [
    'environment-health-watch',
    'weekly-health-snapshot',
  ])
})

test('setup wizard initial scheduled updates preserve explicit opt-out selections', () => {
  assert.deepEqual(resolveSetupWizardInitialScheduledUpdates(undefined), [
    'environment-health-watch',
    'weekly-health-snapshot',
  ])
  assert.deepEqual(resolveSetupWizardInitialScheduledUpdates([]), [])
  assert.deepEqual(
    resolveSetupWizardInitialScheduledUpdates(['weekly-health-snapshot']),
    ['weekly-health-snapshot'],
  )
})

test('setup scheduled updates defer preset-backed jobs instead of installing runtime config during onboarding', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-scheduled-updates-'))
  const steps: SetupResult['steps'] = []

  try {
    const scheduledUpdates = await configureSetupScheduledUpdates({
      dryRun: false,
      presetIds: [
        'weekly-health-snapshot',
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      steps,
    })

    assert.deepEqual(
      scheduledUpdates.map((entry) => [entry.preset.id, entry.status]),
      [
        ['environment-health-watch', 'skipped'],
        ['weekly-health-snapshot', 'skipped'],
      ],
    )
    assert.equal(steps.length, 1)
    assert.equal(steps[0]?.id, 'assistant-scheduled-updates')
    assert.equal(steps[0]?.status, 'skipped')
    assert.match(
      steps[0]?.detail ?? '',
      /Onboarding does not install them automatically\./i,
    )
    assert.match(
      steps[0]?.detail ?? '',
      /Create the ones you want later as canonical automations\./i,
    )

    const jobs = await listAssistantCronJobs(vaultRoot)
    assert.deepEqual(jobs, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('setup scheduled updates keep returning deferred recommendations on repeated onboarding runs', async () => {
  await configureSetupScheduledUpdates({
    dryRun: false,
    presetIds: ['environment-health-watch'],
    steps: [],
  })

  const steps: SetupResult['steps'] = []
  const scheduledUpdates = await configureSetupScheduledUpdates({
    dryRun: false,
    presetIds: ['environment-health-watch'],
    steps,
  })

  assert.deepEqual(
    scheduledUpdates.map((entry) => [entry.preset.id, entry.status]),
    [['environment-health-watch', 'skipped']],
  )
  assert.equal(steps[0]?.status, 'skipped')
})

test('setup scheduled updates surface deferred recommendation details without prompt templates and keep dry-run wording', async () => {
  const steps: SetupResult['steps'] = []
  const scheduledUpdates = await configureSetupScheduledUpdates({
    dryRun: true,
    presetIds: ['weekly-health-snapshot'],
    steps,
  })

  assert.equal(scheduledUpdates.length, 1)
  assert.equal(scheduledUpdates[0]?.jobName, scheduledUpdates[0]?.preset.suggestedName)
  assert.equal(
    'promptTemplate' in (scheduledUpdates[0]?.preset as Record<string, unknown>),
    false,
  )
  assert.equal(steps[0]?.status, 'skipped')
  assert.match(steps[0]?.detail ?? '', /^Would defer 1 assistant scheduled update:/u)
  assert.match(
    steps[0]?.detail ?? '',
    /Onboarding does not install them automatically\./u,
  )
  assert.match(
    steps[0]?.detail ?? '',
    /Create the ones you want later as canonical automations\./u,
  )
})

test('setup scheduled updates propagate unknown preset errors without mutating steps', async () => {
  const steps: SetupResult['steps'] = []

  await assert.rejects(
    async () =>
      configureSetupScheduledUpdates({
        dryRun: false,
        presetIds: ['missing-preset'],
        steps,
      }),
    (error: unknown) => {
      assert.equal(
        typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: unknown }).code === 'ASSISTANT_CRON_PRESET_NOT_FOUND',
        true,
      )
      assert.match(String(error), /missing-preset/u)
      return true
    },
  )
  assert.deepEqual(steps, [])
})

test('setup scheduled updates can be fully opted out during onboarding', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-scheduled-updates-optout-'))
  const steps: SetupResult['steps'] = []

  try {
    const scheduledUpdates = await configureSetupScheduledUpdates({
      dryRun: false,
      presetIds: [],
      steps,
      vault: vaultRoot,
    })

    assert.deepEqual(scheduledUpdates, [])
    assert.equal(steps[0]?.status, 'skipped')
    assert.match(steps[0]?.detail ?? '', /No assistant scheduled updates selected/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('public URL review keeps wearable callbacks local and webhooks public when no public base is configured', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['garmin', 'oura', 'whoop'],
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'local')
  assert.match(review.summary, /callbacks can stay on localhost/u)
  assert.deepEqual(
    review.targets.map((target) => [
      target.localReceiverUrl,
      target.providerUrl,
      target.requirement,
    ]),
    [
      [
        'http://localhost:8788/connect/junction/callback',
        'http://localhost:8788/connect/junction/callback',
        'required',
      ],
      [
        'http://localhost:8788/oauth/whoop/callback',
        'http://localhost:8788/oauth/whoop/callback',
        'required',
      ],
      [
        'http://localhost:8788/webhooks/whoop',
        'https://<your-public-host>/webhooks/whoop',
        'optional',
      ],
      [
        'http://localhost:8788/oauth/oura/callback',
        'http://localhost:8788/oauth/oura/callback',
        'required',
      ],
      [
        'http://localhost:8788/webhooks/oura',
        'https://<your-public-host>/webhooks/oura',
        'optional',
      ],
    ],
  )
  assert.deepEqual(review.tunnelCommands, [
    'ngrok http 8788',
    'cloudflared tunnel --url http://localhost:8788',
  ])
  assert.match(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'local',
    }),
    /localhost OAuth callback/u,
  )
})

test('public URL review stays hidden when no public callbacks are needed', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: [],
  })

  assert.equal(review.enabled, false)
  assert.equal(review.summary, '')
  assert.deepEqual(review.targets, [])
})

test('public URL review keeps local callback guidance for wearable callbacks only', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['garmin', 'oura', 'whoop'],
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'local')
  assert.match(review.summary, /callbacks can stay on localhost/u)
  assert.deepEqual(
    review.targets.map((target) => `${target.label}:${target.requirement}`),
    [
      'Junction callback:required',
      'WHOOP callback:required',
      'WHOOP webhook:optional',
      'Oura callback:required',
      'Oura webhook:optional',
    ],
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'local',
    }),
    'Register the shown localhost OAuth callback URLs. Only add a public HTTPS URL for optional provider webhooks.',
  )
})

test('public URL review keeps local callback guidance when a public device-sync base is already configured', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['whoop'],
    publicBaseUrl: 'https://health.example.test/api/device-sync',
  })

  assert.equal(review.enabled, true)
  assert.deepEqual(
    review.targets.map((target) => [
      target.label,
      target.localReceiverUrl,
      target.providerUrl,
    ]),
    [
      [
        'WHOOP callback',
        'http://localhost:8788/oauth/whoop/callback',
        'http://localhost:8788/oauth/whoop/callback',
      ],
      [
        'WHOOP webhook',
        'http://localhost:8788/webhooks/whoop',
        'https://health.example.test/api/device-sync/webhooks/whoop',
      ],
    ],
  )
  assert.deepEqual(review.tunnelCommands, [])
})

test('interactive onboarding treats public URL guidance as informational and never forwards a strategy into setup', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-public-url-'))
  const receivedInputs: Array<{
    channels: string[] | null
    publicUrlStrategy: string | null
    scheduledUpdatePresetIds: string[] | null
    wearables: string[] | null
  }> = []
  const cli = createSetupCli({
    commandName: 'murph',
    runtimeEnv: {
      getCurrentEnv() {
        return {}
      },
      async promptForMissing() {
        return {}
      },
    },
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupMacos(input: any) {
        receivedInputs.push({
          channels: input.channels == null ? null : [...input.channels],
          publicUrlStrategy:
            typeof input.publicUrlStrategy === 'string'
              ? input.publicUrlStrategy
              : null,
          scheduledUpdatePresetIds:
            input.scheduledUpdatePresetIds == null
              ? null
              : [...input.scheduledUpdatePresetIds],
          wearables: input.wearables == null ? null : [...input.wearables],
        })
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run() {
        return {
          channels: [],
          publicUrlStrategy: 'hosted',
          scheduledUpdates: [],
          wearables: ['whoop'],
        } as any
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--full-output'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(receivedInputs, [
      {
        channels: [],
        publicUrlStrategy: null,
        scheduledUpdatePresetIds: [],
        wearables: ['whoop'],
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('codex auth account parser captures the local ChatGPT plan without persisting identifiers', () => {
  const account = detectCodexAccountFromAuthJson(
    JSON.stringify({
      tokens: {
        idToken: buildFakeJwt({
          chatgpt_plan_type: 'plus',
        }),
      },
    }),
  )

  assert.deepEqual(account, {
    source: 'codex-auth-json',
    kind: 'account',
    planCode: 'plus',
    planName: 'Plus',
    quota: null,
  })
})

test('setup assistant account resolver merges codex auth plan with rpc quota metadata', async () => {
  const resolver = createSetupAssistantAccountResolver({
    env: () => ({
      CODEX_HOME: '/tmp/fake-codex-home',
    }),
    readTextFile: async () =>
      JSON.stringify({
        tokens: {
          idToken: buildFakeJwt({
            chatgpt_plan_type: 'pro',
          }),
        },
      }),
    probeCodexRpc: async () => ({
      source: 'codex-rpc',
      kind: 'account',
      planCode: null,
      planName: null,
      quota: {
        creditsRemaining: 42,
        creditsUnlimited: false,
        primaryWindow: {
          usedPercent: 35,
          remainingPercent: 65,
          windowMinutes: 300,
          resetsAt: '2026-03-25T10:00:00.000Z',
        },
        secondaryWindow: {
          usedPercent: 60,
          remainingPercent: 40,
          windowMinutes: 10080,
          resetsAt: '2026-03-29T10:00:00.000Z',
        },
      },
    }),
  })

  const account = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      codexCommand: null,
      profile: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Use Codex CLI with gpt-5.4.',
    },
  })

  assert.deepEqual(account, {
    source: 'codex-rpc+codex-auth-json',
    kind: 'account',
    planCode: 'pro',
    planName: 'Pro',
    quota: {
      creditsRemaining: 42,
      creditsUnlimited: false,
      primaryWindow: {
        usedPercent: 35,
        remainingPercent: 65,
        windowMinutes: 300,
        resetsAt: '2026-03-25T10:00:00.000Z',
      },
      secondaryWindow: {
        usedPercent: 60,
        remainingPercent: 40,
        windowMinutes: 10080,
        resetsAt: '2026-03-29T10:00:00.000Z',
      },
    },
  })
})

test('setup assistant account resolver scopes auth and rpc probes to the selected Codex home', async () => {
  let probedEnv: Record<string, string | undefined> | null = null
  let readPath: string | null = null
  const readTextFile = vi.fn(async (filePath: string) => {
    readPath = filePath
    return JSON.stringify({
      tokens: {
        idToken: buildFakeJwt({
          chatgpt_plan_type: 'plus',
        }),
      },
    })
  })
  const probeCodexRpc = vi.fn(async (input: {
    codexCommand: string | null
    env: NodeJS.ProcessEnv
  }) => {
    probedEnv = input.env
    return null
  })
  const resolver = createSetupAssistantAccountResolver({
    env: () => ({
      CODEX_HOME: '/tmp/ambient-codex-home',
    }),
    readTextFile,
    probeCodexRpc,
  })

  await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      codexCommand: null,
      codexHome: '/tmp/codex-1',
      profile: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Use Codex CLI with gpt-5.4.',
    },
  })

  assert.equal(readPath, '/tmp/codex-1/auth.json')
  const capturedProbeEnv = probedEnv
  assert.notEqual(capturedProbeEnv, null)
  if (capturedProbeEnv === null) {
    throw new Error('Expected Codex RPC probe env to be captured.')
  }
  assert.equal(capturedProbeEnv['CODEX_HOME'], '/tmp/codex-1')
})

async function writeExecutable(
  absolutePath: string,
  body = '#!/usr/bin/env bash\nexit 0\n',
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, body, 'utf8')
  await chmod(absolutePath, 0o755)
}

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

function buildExpectedCliShimScript(
  cliBinPath: string,
  shimName: 'murph' | 'vault-cli' = 'murph',
): string {
  return `#!/usr/bin/env bash
set -euo pipefail

cli_bin_path=${quoteShellArgument(cliBinPath)}
if [ ! -f "$cli_bin_path" ]; then
  printf '%s\n' 'Murph CLI build output is unavailable. Re-run setup from the current checkout to refresh the shims.' >&2
  exit 1
fi

exec env SETUP_PROGRAM_NAME=${quoteShellArgument(shimName)} node "$cli_bin_path" "$@"
`
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`
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
      configPath: '.runtime/operations/parsers/toolchain.json',
      updatedAt: '2026-03-13T12:00:00.000Z',
      tools: {
        ffmpeg: {
          available: true,
          command: '/usr/local/bin/ffmpeg',
          reason: 'ffmpeg CLI available.',
          source: 'config' as const,
        },
        whisper: {
          available: true,
          command: options?.whisperCommand ?? '/usr/local/bin/whisper-cli',
          modelPath: options?.whisperModelPath ?? '/tmp/model.bin',
          reason: 'whisper.cpp CLI and model path configured.',
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
            configPath: '.runtime/operations/parsers/toolchain.json',
            discoveredAt: '2026-03-13T12:05:00.000Z',
            tools: {
              ffmpeg: {
                available: true,
                command: '/usr/local/bin/ffmpeg',
                reason: 'ffmpeg CLI available.',
                source: 'config' as const,
              },
              whisper: {
                available: true,
                command: options.whisperCommand ?? options.parserToolchainPath,
                modelPath: options.whisperModelPath ?? options.parserToolchainPath,
                reason: 'whisper.cpp CLI and model path configured.',
                source: 'config' as const,
              },
            },
          }
        : null,
    },
  }
}

function makeSetupResult(
  vault: string,
  overrides: Partial<SetupResult> = {},
): SetupResult {
  return {
    arch: 'arm64',
    assistant: null,
    bootstrap: makeBootstrapResult(vault),
    channels: [],
    dryRun: false,
    notes: [],
    platform: 'darwin',
    scheduledUpdates: [],
    steps: [
      {
        detail: `Initialized a new vault scaffold at ${vault}.`,
        id: 'vault-init',
        kind: 'configure',
        status: 'completed',
        title: 'Vault initialization',
      },
      {
        detail:
          'Wrote parser toolchain config under .runtime/operations/parsers/toolchain.json and completed local runtime checks.',
        id: 'inbox-bootstrap',
        kind: 'configure',
        status: 'completed',
        title: 'Inbox bootstrap',
      },
    ],
    toolchainRoot: '~/.murph/toolchain',
    tools: {
      ffmpegCommand: '/usr/local/bin/ffmpeg',
      whisperCommand: '/usr/local/bin/whisper-cli',
      whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
    },
    vault,
    wearables: [],
    whisperModel: 'base.en',
    ...overrides,
  }
}

async function runSetupCli<TData>(
  args: string[],
  services:
    | ReturnType<typeof createSetupServices>
    | { setupHost?(input: any): Promise<any>; setupMacos(input: any): Promise<any> },
  commandName = 'murph',
): Promise<CliEnvelope<TData>> {
  const cli = createSetupCli({
    commandName,
    services: services as ReturnType<typeof createSetupServices>,
  })
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runMurphAliasActionRaw(
  args: string[],
  options?: {
    cwd?: string
    env?: NodeJS.ProcessEnv
  },
): Promise<string> {
  const output: string[] = []
  const errors: string[] = []
  const previousCwd = process.cwd()
  const previousEnv = { ...process.env }
  const previousExitCode = process.exitCode
  const previousStdoutWrite = process.stdout.write
  const previousStderrWrite = process.stderr.write
  let exitCode: number | undefined
  const captureStdout = ((chunk: string | Uint8Array) => {
    output.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  const captureStderr = ((chunk: string | Uint8Array) => {
    errors.push(String(chunk))
    return true
  }) as typeof process.stderr.write

  try {
    replaceProcessEnvForSetupCliTest({
      ...process.env,
      ...options?.env,
    })
    if (options?.cwd !== undefined) {
      process.chdir(options.cwd)
    }
    process.stdout.write = captureStdout
    process.stderr.write = captureStderr

    await runMurphCliAction(args, {
      argv0: '/usr/local/bin/murph',
      exit(code) {
        exitCode = code
      },
    })

    if (exitCode !== undefined && exitCode !== 0) {
      throw new Error([
        `murph alias action exited with code ${exitCode}`,
        errors.join('').trim(),
      ].filter(Boolean).join('\n'))
    }

    return output.join('').trim()
  } finally {
    process.stdout.write = previousStdoutWrite
    process.stderr.write = previousStderrWrite
    process.exitCode = previousExitCode
    process.chdir(previousCwd)
    replaceProcessEnvForSetupCliTest(previousEnv)
  }
}

async function runSetupCliRawWithEnv(
  commandName: string,
  args: string[],
  options?: {
    cwd?: string
    env?: NodeJS.ProcessEnv
  },
): Promise<string> {
  const cli = createSetupCli({ commandName })
  const output: string[] = []
  const previousCwd = process.cwd()
  const previousEnv = { ...process.env }

  try {
    replaceProcessEnvForSetupCliTest({
      ...process.env,
      ...options?.env,
    })
    if (options?.cwd !== undefined) {
      process.chdir(options.cwd)
    }

    await cli.serve(args, {
      env: process.env,
      exit: () => {},
      stdout(chunk) {
        output.push(chunk)
      },
    })
  } finally {
    process.chdir(previousCwd)
    replaceProcessEnvForSetupCliTest(previousEnv)
  }

  return output.join('').trim()
}

function replaceProcessEnvForSetupCliTest(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
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

async function runSetupHostWrapper(
  args: string[],
  envOverrides: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync('bash', [path.join(repoRoot, 'scripts/setup-host.sh'), ...args], {
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

test.sequential('onboard CLI dry-run returns a macOS plan without mutating services', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-home-'))
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
    resolveCliBinPath: () => buildOwnedCliBinPath(homeRoot),
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
      ['onboard', '--dryRun', '--vault', vaultRoot],
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

test.sequential('onboard CLI dry-run reuses an existing vault without mutating services', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-existing-dryrun-home-'))
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
    resolveCliBinPath: () => buildOwnedCliBinPath(homeRoot),
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
      ['onboard', '--dryRun', '--vault', vaultRoot],
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

test.sequential('onboard CLI defaults the vault to ./vault when omitted', async () => {
  let receivedVault: string | null = null

  const result = await runSetupCli<SetupResult>(
    ['onboard'],
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

test.sequential('onboard CLI keeps post-setup CTAs usable when invoked as murph', async () => {
  const result = await runSetupCli<SetupResult>(
    ['onboard', '--vault', './vault'],
    {
      async setupMacos() {
        return makeSetupResult('./vault')
      },
    },
  )

  assert.equal(result.ok, true)
  assert.equal(
    result.meta.cta?.commands[0]?.command,
    'murph assistant chat',
  )
  assert.equal(
    result.meta.cta?.commands[1]?.command,
    'murph automation scaffold',
  )
})

test.sequential('onboard CLI reports successful setup metadata for post-setup chat handoff', async () => {
  const handoffContext = {
    current: null as SuccessfulSetupContext | null,
  }

  const cli = createSetupCli({
    commandName: 'murph',
    onSetupSuccess(context) {
      handoffContext.current = context
    },
    services: {
      async setupMacos(input) {
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
  })

  await cli.serve(['onboard', '--format', 'json', '--full-output'], {
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

test.sequential('onboard CLI does not report a handoff for dry-run setup', async () => {
  let handoffCalls = 0

  const cli = createSetupCli({
    commandName: 'murph',
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

  await cli.serve(['onboard', '--dryRun', '--format', 'json', '--full-output'], {
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wizard-'))
  let wizardCalls = 0
  const wizardInitialChannels: Array<string[]> = []
  const wizardInitialScheduledUpdates: Array<string[]> = []
  const receivedChannels: Array<string[] | null> = []
  const receivedScheduledUpdates: Array<string[] | null> = []
  const receivedWearables: Array<string[] | null> = []
  const cli = createSetupCli({
    commandName: 'murph',
    platform: () => 'darwin',
    runtimeEnv: {
      getCurrentEnv() {
        return {}
      },
      async promptForMissing() {
        return {}
      },
    },
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupMacos(input: any) {
        receivedChannels.push(
          input.channels == null ? null : [...input.channels],
        )
        receivedScheduledUpdates.push(
          input.scheduledUpdatePresetIds == null
            ? null
            : [...input.scheduledUpdatePresetIds],
        )
        receivedWearables.push(
          input.wearables == null ? null : [...input.wearables],
        )
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run(input: any) {
        wizardCalls += 1
        wizardInitialChannels.push([...input.initialChannels])
        wizardInitialScheduledUpdates.push([...input.initialScheduledUpdates])
        return {
          channels: ['telegram'],
          scheduledUpdates: ['environment-health-watch'],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'json', '--full-output'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.equal(wizardCalls, 0)
    assert.deepEqual(receivedChannels[0], null)
    assert.deepEqual(receivedScheduledUpdates[0], null)
    assert.deepEqual(receivedWearables[0], null)

    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--full-output'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.equal(wizardCalls, 1)
    assert.deepEqual(wizardInitialChannels, [[]])
    assert.deepEqual(wizardInitialScheduledUpdates, [[
      'environment-health-watch',
      'weekly-health-snapshot',
    ]])
    assert.deepEqual(receivedChannels[1], ['telegram'])
    assert.deepEqual(receivedScheduledUpdates[1], ['environment-health-watch'])
    assert.deepEqual(receivedWearables[1], [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('interactive onboarding on Linux starts with no default chat channels', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wizard-linux-'))
  const wizardInitialChannels: Array<string[]> = []
  const wizardInitialScheduledUpdates: Array<string[]> = []
  const wizardPlatforms: Array<string | undefined> = []

  const cli = createSetupCli({
    commandName: 'murph',
    platform: () => 'linux',
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupHost(input: any) {
        return makeSetupResult(input.vault, {
          channels: [],
          platform: 'linux',
        })
      },
      async setupMacos(input: any) {
        return makeSetupResult(input.vault, {
          channels: [],
          platform: 'linux',
        })
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run(input: any) {
        wizardInitialChannels.push([...input.initialChannels])
        wizardInitialScheduledUpdates.push([...input.initialScheduledUpdates])
        wizardPlatforms.push(input.platform)
        return {
          channels: [],
          scheduledUpdates: [],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--full-output'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(wizardInitialChannels, [[]])
    assert.deepEqual(wizardInitialScheduledUpdates, [[
      'environment-health-watch',
      'weekly-health-snapshot',
    ]])
    assert.deepEqual(wizardPlatforms, ['linux'])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('resolveInitialSetupWizardChannels falls back to channel defaults when no auto-reply channels are persisted', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wizard-'))
  const expectedChannels: string[] = []

  try {
    assert.deepEqual(
      await resolveInitialSetupWizardChannels(vaultRoot),
      expectedChannels,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('resolveInitialSetupWizardScheduledUpdates always returns the canonical starter defaults', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wizard-scheduled-updates-'))

  try {
    assert.deepEqual(
      await resolveInitialSetupWizardScheduledUpdates(vaultRoot),
      getDefaultSetupWizardScheduledUpdates(),
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('runtime env helpers honor channel aliases and require explicit wearable client credentials', () => {
  assert.deepEqual(
    resolveSetupChannelMissingEnv('telegram', {
      TELEGRAM_BOT_TOKEN: 'bot-token',
    }),
    [],
  )
  assert.deepEqual(
    resolveSetupChannelMissingEnv('telegram', {}),
    ['TELEGRAM_BOT_TOKEN'],
  )
  assert.deepEqual(
    resolveSetupWearableMissingEnv('garmin', {
      JUNCTION_API_KEY: 'sk_us_junction-test',
      JUNCTION_CLIENT_USER_ID_SECRET: 'junction-user-secret',
      JUNCTION_ENV: 'sandbox',
    }),
    ['JUNCTION_REGION'],
  )
  assert.deepEqual(
    resolveSetupWearableMissingEnv('oura', {
      OURA_CLIENT_ID: 'oura-client',
    }),
    ['OURA_CLIENT_SECRET'],
  )
  assert.deepEqual(
    describeSelectedSetupWearables({
      env: {
        JUNCTION_API_KEY: 'sk_us_junction-test',
        JUNCTION_CLIENT_USER_ID_SECRET: 'junction-user-secret',
        JUNCTION_ENV: 'sandbox',
        JUNCTION_REGION: 'us',
        WHOOP_CLIENT_ID: 'whoop-client',
        WHOOP_CLIENT_SECRET: 'whoop-secret',
      },
      wearables: ['garmin', 'whoop'],
    }),
    [
      {
        detail: 'Selected Garmin. Murph can open the connect flow after setup.',
        enabled: true,
        missingEnv: [],
        ready: true,
        wearable: 'garmin',
      },
      {
        detail: 'Selected WHOOP. Murph can open the connect flow after setup.',
        enabled: true,
        missingEnv: [],
        ready: true,
        wearable: 'whoop',
      },
    ],
  )
})

test('interactive onboarding prompts for missing channel and wearable credentials and passes them into setup', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wizard-'))
  const promptedInputs: Array<{
    channels: string[]
    env: NodeJS.ProcessEnv
    helpText: string[]
    wearables: string[]
  }> = []
  const receivedInputs: Array<{
    channels: string[] | null
    envOverrides: NodeJS.ProcessEnv | undefined
    scheduledUpdatePresetIds: string[] | null
    wearables: string[] | null
  }> = []
  const previousEnv = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    OURA_CLIENT_ID: process.env.OURA_CLIENT_ID,
    OURA_CLIENT_SECRET: process.env.OURA_CLIENT_SECRET,
  }
  const cli = createSetupCli({
    commandName: 'murph',
    runtimeEnv: {
      getCurrentEnv() {
        return {}
      },
      async promptForMissing(input) {
        promptedInputs.push({
          channels: [...input.channels],
          env: { ...input.env },
          helpText: [...(input.helpText ?? [])],
          wearables: [...input.wearables],
        })
        return {
          TELEGRAM_BOT_TOKEN: 'bot-token',
          OURA_CLIENT_ID: 'oura-client',
          OURA_CLIENT_SECRET: 'oura-secret',
        }
      },
    },
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupMacos(input: any) {
        receivedInputs.push({
          channels: input.channels == null ? null : [...input.channels],
          envOverrides: input.envOverrides,
          scheduledUpdatePresetIds:
            input.scheduledUpdatePresetIds == null
              ? null
              : [...input.scheduledUpdatePresetIds],
          wearables: input.wearables == null ? null : [...input.wearables],
        })
        return makeSetupResult(input.vault)
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run() {
        return {
          assistantPreset: 'skip',
          channels: ['telegram'],
          scheduledUpdates: ['weekly-health-snapshot'],
          wearables: ['oura'],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--full-output'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(promptedInputs, [
      {
        channels: ['telegram'],
        env: {},
        helpText: [
          'Device OAuth callbacks can stay on localhost. Only optional webhooks need a public HTTPS URL.',
          '',
          'OAuth callbacks can use Murph’s localhost receiver for local setup. Only provider webhooks need a public HTTPS URL from a tunnel or hosted deployment.',
          '',
          'Webhook tunnel path:',
          '  Use the tunnel URL only for provider webhook fields. Keep OAuth callback fields on localhost; do not use the tunnel for control routes.',
          '  ngrok http 8788',
          '  cloudflared tunnel --url http://localhost:8788',
          '',
          'Oura callback (required)',
          '  Local receiver: http://localhost:8788/oauth/oura/callback',
          '  Paste into provider: http://localhost:8788/oauth/oura/callback',
          '  Required. Oura redirect URIs must match this localhost callback URL exactly.',
          '',
          'Oura webhook (optional)',
          '  Local receiver: http://localhost:8788/webhooks/oura',
          '  Paste into provider: https://<your-public-host>/webhooks/oura',
          '  Optional today. Oura can work without webhooks; use this public URL only if you enable Oura webhooks.',
          '',
          'Provider setup docs:',
          '  Oura auth docs: https://cloud.ouraring.com/docs/authentication',
          '',
          'This step is informational only. Murph does not save a public URL choice yet.',
        ],
        wearables: ['oura'],
      },
    ])
    assert.deepEqual(receivedInputs, [
      {
        channels: ['telegram'],
        envOverrides: {
          TELEGRAM_BOT_TOKEN: 'bot-token',
          OURA_CLIENT_ID: 'oura-client',
          OURA_CLIENT_SECRET: 'oura-secret',
        },
        scheduledUpdatePresetIds: ['weekly-health-snapshot'],
        wearables: ['oura'],
      },
    ])
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, 'bot-token')
    assert.equal(process.env.OURA_CLIENT_ID, 'oura-client')
    assert.equal(process.env.OURA_CLIENT_SECRET, 'oura-secret')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })

    if (previousEnv.TELEGRAM_BOT_TOKEN === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previousEnv.TELEGRAM_BOT_TOKEN
    }

    if (previousEnv.OURA_CLIENT_ID === undefined) {
      delete process.env.OURA_CLIENT_ID
    } else {
      process.env.OURA_CLIENT_ID = previousEnv.OURA_CLIENT_ID
    }

    if (previousEnv.OURA_CLIENT_SECRET === undefined) {
      delete process.env.OURA_CLIENT_SECRET
    } else {
      process.env.OURA_CLIENT_SECRET = previousEnv.OURA_CLIENT_SECRET
    }
  }
})

test('interactive onboarding carries the Codex wizard preset into assistant setup', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-assistant-codex-'))
  const promptedInputs: Array<{
    channels: string[]
    env: NodeJS.ProcessEnv
    wearables: string[]
  }> = []
  const assistantCalls: Array<{
    options: {
      assistantModelProvider: string | null | undefined
    }
    preset: string
  }> = []

  const cli = createSetupCli({
    assistantSetup: {
      async resolve(input: any) {
        assistantCalls.push({
          options: {
            assistantModelProvider: input.options.assistantModelProvider,
          },
          preset: input.preset,
        })

        return {
          account: null,
          approvalPolicy: 'never',
          codexCommand: null,
          detail: 'configured',
          enabled: true,
          model: 'gpt-5.4',
          modelProvider: input.options.assistantModelProvider ?? null,
          oss: false,
          preset: input.preset,
          profile: null,
          provider: 'codex-cli',
          reasoningEffort: null,
          sandbox: 'danger-full-access',
        }
      },
    },
    commandName: 'murph',
    runtimeEnv: {
      getCurrentEnv() {
        return {}
      },
      async promptForMissing(input) {
        promptedInputs.push({
          channels: [...input.channels],
          env: { ...input.env },
          wearables: [...input.wearables],
        })
        return {}
      },
    },
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupMacos(input: any) {
        return makeSetupResult(input.vault, {
          assistant: input.assistant,
        })
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run() {
        return {
          assistantPreset: 'codex',
          channels: [],
          scheduledUpdates: [],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--full-output'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(promptedInputs, [
      {
        channels: [],
        env: {},
        wearables: [],
      },
    ])
    assert.deepEqual(assistantCalls, [
      {
        options: {
          assistantModelProvider: undefined,
        },
        preset: 'codex',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('interactive onboarding keeps Codex selections clear of endpoint defaults', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-assistant-clear-'))
  const promptedInputs: Array<{
    channels: string[]
    env: NodeJS.ProcessEnv
    wearables: string[]
  }> = []
  const assistantCalls: Array<{
    options: Record<string, never>
    preset: string
  }> = []

  const cli = createSetupCli({
    assistantSetup: {
      async resolve(input: any) {
        assistantCalls.push({
          options: {},
          preset: input.preset,
        })

        return {
          account: null,
          approvalPolicy: null,
          codexCommand: null,
          detail: 'configured',
          enabled: true,
          model: 'gpt-5.4',
          oss: false,
          preset: input.preset,
          profile: null,
          provider: 'codex-cli',
          reasoningEffort: null,
          sandbox: null,
        }
      },
    },
    commandName: 'murph',
    runtimeEnv: {
      getCurrentEnv() {
        return {}
      },
      async promptForMissing(input) {
        promptedInputs.push({
          channels: [...input.channels],
          env: { ...input.env },
          wearables: [...input.wearables],
        })
        return {}
      },
    },
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
    services: {
      async setupMacos(input: any) {
        return makeSetupResult(input.vault, {
          assistant: input.assistant,
        })
      },
    } as ReturnType<typeof createSetupServices>,
    wizard: {
      async run() {
        return {
          assistantPreset: 'codex',
          channels: [],
          scheduledUpdates: [],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(
      ['onboard', '--vault', vaultRoot, '--format', 'toon', '--full-output'],
      {
        env: process.env,
        exit: () => {},
        stdout() {},
      },
    )

    assert.deepEqual(promptedInputs, [
      {
        channels: [],
        env: {},
        wearables: [],
      },
    ])
    assert.deepEqual(assistantCalls, [
      {
        options: {},
        preset: 'codex',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('wizard infers Codex cloud for signed-in Codex defaults', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      oss: false,
      preset: 'codex',
    }),
    'codex-cloud',
  )
})

test('wizard infers Codex local for OSS defaults', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      oss: true,
      preset: 'codex',
    }),
    'codex-local',
  )
})

test('wizard resolves Codex cloud selection without endpoint metadata', () => {
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      method: 'codex-cloud',
      provider: 'codex-cloud',
    }),
    {
      detail: 'Murph will use your saved Codex / ChatGPT sign-in.',
      methodLabel: null,
      modelProvider: null,
      oss: false,
      preset: 'codex',
      providerLabel: 'ChatGPT / Codex sign-in',
      summary: 'ChatGPT / Codex sign-in',
    },
  )
})

test('setup wearable helpers split ready and pending selections', () => {
  const result = {
    ...makeSetupResult('./vault'),
    wearables: [
      {
        detail: 'Garmin can connect now.',
        enabled: true,
        missingEnv: [],
        ready: true,
        wearable: 'garmin' as const,
      },
      {
        detail: 'Oura can connect now.',
        enabled: true,
        missingEnv: [],
        ready: true,
        wearable: 'oura' as const,
      },
      {
        detail: 'WHOOP still needs client keys.',
        enabled: true,
        missingEnv: ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET'],
        ready: false,
        wearable: 'whoop' as const,
      },
    ],
  }

  assert.deepEqual(listSetupReadyWearables(result), ['garmin', 'oura'])
  assert.deepEqual(listSetupPendingWearables(result), [result.wearables[2]])
})

test('onboard resolves assistant defaults from explicit Codex options when the wizard is skipped', async () => {
  const resolvedAssistants: any[] = []
  const receivedAssistants: any[] = []
  const cli = createSetupCli({
    commandName: 'murph',
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
    assistantSetup: {
      async resolve(input) {
        resolvedAssistants.push({
          allowPrompt: input.allowPrompt,
          assistantModel: input.options.assistantModel,
          assistantModelProvider: input.options.assistantModelProvider,
          preset: input.preset,
        })

        return {
          preset: 'codex',
          enabled: true,
          provider: 'codex-cli',
          model: input.options.assistantModel ?? 'gpt-5.4',
          modelProvider: input.options.assistantModelProvider ?? null,
          codexCommand: null,
          profile: null,
          reasoningEffort: null,
          sandbox: 'danger-full-access',
          approvalPolicy: 'never',
          oss: false,
          detail: 'Use Codex with the selected model provider.',
        }
      },
    },
    runtimeEnv: {
      getCurrentEnv() {
        return {
          VERCEL_AI_API_KEY: 'vercel-test-key',
        }
      },
      async promptForMissing() {
        throw new Error('noninteractive setup must not prompt for provider keys')
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
      'onboard',
      '--assistantPreset',
      'codex',
      '--assistantModel',
      'gpt-5.6-terra',
      '--assistantModelProvider',
      'vercel-ai-gateway',
      '--format',
      'json',
      '--full-output',
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
      assistantModel: 'gpt-5.6-terra',
      assistantModelProvider: 'vercel-ai-gateway',
      preset: 'codex',
    },
  ])
  assert.deepEqual(receivedAssistants, [
    {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      codexCommand: null,
      profile: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      detail: 'Use Codex with the selected model provider.',
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
          channel: 'telegram' as const,
          configured: true,
          connectorId: 'telegram:bot',
          detail: 'Configured Telegram.',
          enabled: true,
          missingEnv: [],
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
          missingEnv: ['TELEGRAM_BOT_TOKEN'],
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-telegram-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const installedFormulas = new Set(['ffmpeg', 'whisper-cpp'])
  const sourceAddCalls: InboxSourceAddInput[] = []
  const doctorCalls: InboxDoctorInput[] = []

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(whisperCommand)

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({
      TELEGRAM_BOT_TOKEN: 'token-123',
      PATH: homebrewBin,
    }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        return makeBootstrapResult(vaultRoot)
      },
      async doctor(input: InboxDoctorInput) {
        doctorCalls.push(input)
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
      async sourceAdd(input: InboxSourceAddInput) {
        sourceAddCalls.push(input)
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
      async sourceList(input: InboxSourceListInput) {
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
    assert.deepEqual(listAutoReplyChannels(automationState), ['telegram'])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service keeps Telegram configured but disables auto-reply when the bot token fails readiness checks', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-telegram-fail-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const installedFormulas = new Set(['ffmpeg', 'whisper-cpp'])

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(whisperCommand)

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({
      TELEGRAM_BOT_TOKEN: 'token-123',
      PATH: homebrewBin,
    }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        return makeBootstrapResult(vaultRoot)
      },
      async doctor(input: InboxDoctorInput) {
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
      async sourceAdd(input: InboxSourceAddInput) {
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
      async sourceList(input: InboxSourceListInput) {
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
    assert.deepEqual(listAutoReplyChannels(automationState), [])
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-real-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  const expectedWhisperModelPath = path.join(
    homeRoot,
    '.murph',
    'toolchain',
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  const operatorConfigPath = resolveOperatorConfigPath(homeRoot)
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const murphShimPath = path.join(homeRoot, '.local', 'bin', 'murph')
  const vaultCliShimPath = path.join(homeRoot, '.local', 'bin', 'vault-cli')
  const installedFormulas = new Set<string>()
  const runCalls: Array<{ file: string; args: string[] }> = []
  const initCalls: Array<{ requestId: string | null; vault: string }> = []
  const bootstrapCalls: InboxBootstrapInput[] = []

  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(whisperCommand)

  const services = createSetupServices({
    arch: () => 'arm64',
    downloadFile: async (_url, destinationPath) => {
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: homebrewBin, SHELL: '/bin/zsh' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap(input: InboxBootstrapInput) {
        bootstrapCalls.push(input)
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
      assistant: {
        preset: 'codex',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        codexCommand: null,
        profile: null,
        reasoningEffort: null,
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        oss: false,
        account: {
          source: 'codex-rpc+codex-auth-json',
          kind: 'account',
          planCode: 'plus',
          planName: 'Plus',
          quota: {
            creditsRemaining: 18,
            creditsUnlimited: false,
            primaryWindow: {
              usedPercent: 45,
              remainingPercent: 55,
              windowMinutes: 300,
              resetsAt: '2026-03-25T10:00:00.000Z',
            },
            secondaryWindow: null,
          },
        },
        detail: 'Use Codex CLI with gpt-5.4. Detected Plus account from local Codex credentials.',
      },
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
    assert.equal(bootstrapCalls[0]?.whisperCommand, whisperCommand)
    assert.equal(
      bootstrapCalls[0]?.whisperModelPath,
      expectedWhisperModelPath,
    )
    assert.equal(
      result.tools.whisperModelPath,
      '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.equal(result.toolchainRoot, '~/.murph/toolchain')
    assert.equal(installedFormulas.has('ffmpeg'), true)
    assert.equal(installedFormulas.has('whisper-cpp'), true)
    assert.equal(
      result.steps.some((step) => step.id === 'cli-shims' && step.status === 'completed'),
      true,
    )
    assert.equal(
      result.steps.some((step) => step.id === 'default-vault' && step.status === 'completed'),
      true,
    )
    assert.equal(
      result.steps.some((step) => step.id === 'assistant-defaults' && step.status === 'completed'),
      true,
    )
    const modelText = await readFile(expectedWhisperModelPath, 'utf8')
    const operatorConfig = JSON.parse(await readFile(operatorConfigPath, 'utf8')) as {
      assistant?: {
        account?: {
          kind?: string | null
          planCode?: string | null
          planName?: string | null
          quota?: {
            creditsRemaining?: number | null
            primaryWindow?: {
              remainingPercent?: number | null
            } | null
          } | null
        } | null
        backend?: {
          adapter?: string | null
          model?: string | null
          approvalPolicy?: string | null
          sandbox?: string | null
          options?: {
            approvalPolicy?: string | null
            sandbox?: string | null
          } | null
        } | null
      } | null
      defaultVault: string | null
    }
    const murphShim = await readFile(murphShimPath, 'utf8')
    const vaultCliShim = await readFile(vaultCliShimPath, 'utf8')
    assert.equal(modelText, 'model')
    assert.equal(operatorConfig.defaultVault, '~/vault')
    assert.equal(operatorConfig.assistant?.backend?.adapter, 'codex-cli')
    assert.equal(operatorConfig.assistant?.backend?.model, 'gpt-5.4')
    assert.equal(
      operatorConfig.assistant?.backend?.adapter === 'codex-cli'
        ? operatorConfig.assistant.backend.approvalPolicy
        : null,
      'never',
    )
    assert.equal(
      operatorConfig.assistant?.backend?.adapter === 'codex-cli'
        ? operatorConfig.assistant.backend.sandbox
        : null,
      'danger-full-access',
    )
    assert.equal(operatorConfig.assistant?.account?.kind, 'account')
    assert.equal(operatorConfig.assistant?.account?.planCode, 'plus')
    assert.equal(operatorConfig.assistant?.account?.planName, 'Plus')
    assert.equal(operatorConfig.assistant?.account?.quota?.creditsRemaining, 18)
    assert.equal(operatorConfig.assistant?.account?.quota?.primaryWindow?.remainingPercent, 55)
    assert.equal(murphShim, buildExpectedCliShimScript(cliBinPath, 'murph'))
    assert.equal(vaultCliShim, buildExpectedCliShimScript(cliBinPath, 'vault-cli'))
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

test.sequential('setup updates codexCommand when provided and preserves a saved custom path when omitted on rerun', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-codex-command-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  const expectedWhisperModelPath = path.join(
    homeRoot,
    '.murph',
    'toolchain',
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')

  await saveAssistantOperatorDefaultsPatch(
    buildAssistantProviderDefaultsPatch({
      defaults: null,
      providerConfig: {
        codexCommand: '/opt/bin/codex-old',
        model: 'gpt-5.4',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        oss: false,
      },
    }),
    homeRoot,
  )

  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(whisperCommand)
  await mkdir(path.dirname(expectedWhisperModelPath), { recursive: true })
  await writeFile(expectedWhisperModelPath, 'model', 'utf8')

  const services = createSetupServices({
    arch: () => 'arm64',
    env: () => ({ PATH: homebrewBin, SHELL: '/bin/zsh' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => buildOwnedCliBinPath(homeRoot),
    runCommand: async ({ file, args }) => {
      const baseName = path.basename(file)

      if (baseName === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: `${args[2] ?? ''} 1.0.0\n`,
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
        async init(input: { vault: string }) {
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
    await services.setupMacos({
      assistant: {
        preset: 'codex',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        codexCommand: '/opt/bin/codex-new',
        profile: null,
        reasoningEffort: null,
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        oss: false,
        account: null,
        detail: 'Use Codex CLI with gpt-5.4.',
      },
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    const operatorConfig = await readOperatorConfig(homeRoot)
    assert.equal(operatorConfig?.assistant?.backend?.adapter, 'codex-cli')
    assert.equal(
      operatorConfig?.assistant?.backend?.adapter === 'codex-cli'
        ? operatorConfig.assistant.backend.codexCommand
        : null,
      '/opt/bin/codex-new',
    )

    await services.setupMacos({
      assistant: {
        preset: 'codex',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        codexCommand: null,
        profile: null,
        reasoningEffort: null,
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        oss: false,
        account: null,
        detail: 'Use Codex CLI with gpt-5.4.',
      },
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    const preservedOperatorConfig = await readOperatorConfig(homeRoot)
    assert.equal(
      preservedOperatorConfig?.assistant?.backend?.adapter === 'codex-cli'
        ? preservedOperatorConfig.assistant.backend.codexCommand
        : null,
      '/opt/bin/codex-new',
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup persistence can replace unsupported assistant defaults', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-replace-unsupported-assistant-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')

  try {
    await writeLegacySetupAssistantOperatorConfig(homeRoot)

    await saveDefaultVaultConfig(vaultRoot, homeRoot)
    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        providerConfig: {
          model: 'gpt-5.6-terra',
          modelProvider: 'vercel-ai-gateway',
          sandbox: 'danger-full-access',
          approvalPolicy: 'never',
          oss: false,
        },
      }),
      homeRoot,
    )

    const config = await readOperatorConfig(homeRoot)
    assert.equal(config?.defaultVault, '~/vault')
    assert.equal(config?.assistant?.backend?.adapter, 'codex-cli')
    assert.equal(
      config?.assistant?.backend?.adapter === 'codex-cli'
        ? config.assistant.backend.model
        : null,
      'gpt-5.6-terra',
    )
    assert.equal(
      config?.assistant?.backend?.adapter === 'codex-cli'
        ? config.assistant.backend.modelProvider
        : null,
      'vercel-ai-gateway',
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim execs the built CLI directly without invoking repair helpers', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-stdin-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'vault-cli')
  const fakeBinDirectory = path.join(tempRoot, 'bin')
  const repairMarkerPath = path.join(tempRoot, 'repair-invoked.txt')

  try {
    await mkdir(path.dirname(cliBinPath), { recursive: true })
    await writeFile(cliBinPath, 'console.log("built-ok")\n', 'utf8')
    await writeExecutable(
      path.join(fakeBinDirectory, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'program:%s\\n' "\${SETUP_PROGRAM_NAME:-}"
printf 'node:%s\\n' "$1"
`,
    )
    await writeExecutable(
      path.join(fakeBinDirectory, 'pnpm'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'repair\\n' > ${JSON.stringify(repairMarkerPath)}
exit 23
`,
    )
    await writeExecutable(
      path.join(fakeBinDirectory, 'corepack'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'repair\\n' > ${JSON.stringify(repairMarkerPath)}
exit 23
`,
    )
    await writeExecutable(
      shimPath,
      buildExpectedCliShimScript(cliBinPath, 'vault-cli'),
    )

    const result = await execFileAsync(
      shimPath,
      ['assistant', 'memory', 'upsert', '--help'],
      {
        env: withoutNodeV8Coverage({
          ...process.env,
          PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        }),
      },
    )

    const canonicalCliBinPath = path.join(
      await realpath(repoRoot),
      'packages',
      'cli',
      'dist',
      'bin.js',
    )
    const [programLine, nodeLine] = result.stdout.trim().split('\n')
    assert.equal(programLine, 'program:vault-cli')
    assert.equal(nodeLine?.startsWith('node:'), true)
    assert.equal(await realpath(nodeLine.slice('node:'.length)), canonicalCliBinPath)
    await assert.rejects(readFile(repairMarkerPath, 'utf8'), /ENOENT/u)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim fails loudly after a moved repo checkout until setup refreshes the shims', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-moved-checkout-'))
  const staleRepoRoot = path.join(tempRoot, 'old-repo')
  const liveRepoRoot = path.join(tempRoot, 'renamed-repo')
  const liveCliDistRoot = path.join(liveRepoRoot, 'packages', 'cli', 'dist')
  const staleCliBinPath = path.join(staleRepoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'murph')

  try {
    await mkdir(liveCliDistRoot, { recursive: true })
    await writeFile(path.join(liveCliDistRoot, 'bin.js'), `console.log('moved-ok')\n`, 'utf8')
    await writeExecutable(shimPath, buildExpectedCliShimScript(staleCliBinPath, 'murph'))

    await assert.rejects(
      execFileAsync(shimPath, [], {
        cwd: path.join(liveRepoRoot, 'packages', 'cli'),
        env: withoutNodeV8Coverage(process.env),
      }),
      /Murph CLI build output is unavailable\./u,
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim fails loudly when the built entrypoint is missing and does not try to repair it', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-missing-build-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliSourceBinPath = path.join(repoRoot, 'packages', 'cli', 'src', 'bin.ts')
  const shimPath = path.join(tempRoot, 'murph')
  const fakeBinDirectory = path.join(tempRoot, 'bin')
  const repairMarkerPath = path.join(tempRoot, 'repair-invoked.txt')

  try {
    await mkdir(path.dirname(cliSourceBinPath), { recursive: true })
    await writeFile(cliSourceBinPath, 'console.log("source-placeholder")\n', 'utf8')
    await writeExecutable(
      path.join(fakeBinDirectory, 'pnpm'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'repair\\n' > ${JSON.stringify(repairMarkerPath)}
exit 23
`,
    )
    await writeExecutable(
      path.join(fakeBinDirectory, 'corepack'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'repair\\n' > ${JSON.stringify(repairMarkerPath)}
exit 23
`,
    )
    await writeExecutable(
      shimPath,
      buildExpectedCliShimScript(path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js'), 'murph'),
    )

    await assert.rejects(
      execFileAsync(shimPath, ['onboard', '--dryRun', '--vault', './vault'], {
        env: withoutNodeV8Coverage({
          ...process.env,
          PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        }),
      }),
      /Murph CLI build output is unavailable\./u,
    )
    await assert.rejects(readFile(repairMarkerPath, 'utf8'), /ENOENT/u)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim passes piped stdin directly to the built child process', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-stdin-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'vault-cli')
  const fakeBinDirectory = path.join(tempRoot, 'bin')

  try {
    await mkdir(path.dirname(cliBinPath), { recursive: true })
    await writeFile(cliBinPath, 'console.log("built-ok")\n', 'utf8')
    await writeExecutable(
      path.join(fakeBinDirectory, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
cat
`,
    )
    await writeExecutable(
      shimPath,
      buildExpectedCliShimScript(cliBinPath, 'vault-cli'),
    )

    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(
        shimPath,
        ['recipe', 'import-json', '--input', '-'],
        {
          encoding: 'utf8',
          env: withoutNodeV8Coverage({
            ...process.env,
            PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          }),
        },
        (error, stdout, stderr) => {
          if (error) {
            Object.assign(error, { stderr, stdout })
            reject(error)
            return
          }

          resolve({ stderr, stdout })
        },
      )

      child.stdin?.end('{')
    })

    assert.equal(result.stdout.trim(), '{')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service reuses an existing vault and still bootstraps inbox runtime', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-existing-vault-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const installedFormulas = new Set(['ffmpeg', 'whisper-cpp'])
  const initCalls: Array<{ requestId: string | null; vault: string }> = []
  const bootstrapCalls: InboxBootstrapInput[] = []

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
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
      async bootstrap(input: InboxBootstrapInput) {
        bootstrapCalls.push(input)
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => buildOwnedCliBinPath(homeRoot),
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
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(initCalls.length, 0)
    assert.equal(bootstrapCalls.length, 1)
    assert.equal(bootstrapCalls[0]?.vault, vaultRoot)
    assert.equal(bootstrapCalls[0]?.ffmpegCommand, ffmpegCommand)
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-redaction-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const whisperFormulaCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const homeWhisperCommand = path.join(homeRoot, '.murph', 'toolchain', 'bin', 'whisper-cli')
  const homeWhisperModel = path.join(
    homeRoot,
    '.murph',
    'toolchain',
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  const siblingPrefixPath = path.join(tempRoot, 'homebrew', 'bin', 'ffmpeg')
  const installedFormulas = new Set(['ffmpeg', 'whisper-cpp'])
  let bootstrapCalls = 0

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
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
          createdPaths: [path.join(homeRoot, '.murph', 'toolchain'), '.runtime/inboxd'],
          doctorChecks: [
            {
              details: {
                artifactPaths: [homeWhisperModel, siblingPrefixPath],
              },
              message: 'Configured parser assets were discovered.',
              name: 'parser-assets',
              status: 'pass',
            },
          ],
          parserToolchainPath: homeWhisperCommand,
          whisperCommand: homeWhisperCommand,
          whisperModelPath: homeWhisperModel,
        })
      },
    },
    log() {},
    platform: () => 'darwin',
    resolveCliBinPath: () => buildOwnedCliBinPath(homeRoot),
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
      assistant: {
        preset: 'codex',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        modelProvider: null,
        codexCommand: path.join(homeRoot, '.codex', 'bin', 'codex'),
        codexHome: path.join(homeRoot, '.codex'),
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
        approvalPolicy: 'never',
        oss: false,
        account: null,
        detail: `Use Codex at ${path.join(homeRoot, '.codex')}.`,
      },
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(bootstrapCalls, 1)
    assert.equal(result.bootstrap?.vault, '~/vault')
    assert.deepEqual(result.bootstrap?.init.createdPaths, ['~/.murph/toolchain', '.runtime/inboxd'])
    assert.equal(
      result.bootstrap?.setup.tools.whisper.command,
      '~/.murph/toolchain/bin/whisper-cli',
    )
    assert.equal(
      result.bootstrap?.setup.tools.whisper.modelPath,
      '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.equal(
      result.bootstrap?.doctor.parserToolchain?.tools.whisper.command,
      '~/.murph/toolchain/bin/whisper-cli',
    )
    assert.equal(
      result.bootstrap?.doctor.parserToolchain?.tools.whisper.modelPath,
      '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.deepEqual(
      result.bootstrap?.doctor.checks[0]?.details?.artifactPaths,
      [
        '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
        siblingPrefixPath,
      ],
    )
    assert.equal(result.assistant?.codexCommand, '[path]')
    assert.equal(result.assistant?.codexHome, '[path]')
    assert.equal(result.assistant?.detail, 'Use Codex at ~/.codex.')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('setup routing helpers recognize murph onboarding and active-vault selection commands', () => {
  assert.equal(isSetupInvocation(['setup', '--dryRun']), false)
  assert.equal(isSetupInvocation(['inbox', 'doctor']), false)
  assert.equal(isSetupInvocation([], 'murph'), true)
  assert.equal(isSetupInvocation(['--help'], 'murph'), false)
  assert.equal(isSetupInvocation(['--llms-full', '--format', 'json'], 'murph'), false)
  assert.equal(isSetupInvocation(['--schema'], 'murph'), false)
  assert.equal(isSetupInvocation(['--mcp'], 'murph'), false)
  assert.equal(isSetupInvocation(['--version'], 'murph'), false)
  assert.equal(isSetupInvocation(['use', './vault'], 'murph'), true)
  assert.equal(isSetupInvocation(['--full-output', '--format', 'json'], 'murph'), true)
  assert.equal(
    isSetupInvocation(['--format', 'json', 'setup', '--dry-run'], 'murph'),
    false,
  )
  assert.equal(
    isSetupInvocation(['--filter-output', 'steps[0].title', '--help'], 'murph'),
    false,
  )
  assert.equal(
    isSetupInvocation(['--token-limit', '10', '--help'], 'murph'),
    false,
  )
  assert.equal(
    isSetupInvocation(['--token-offset', '5', 'setup', '--dry-run'], 'murph'),
    false,
  )
  assert.equal(isSetupInvocation(['inbox', 'doctor'], 'murph'), false)
  assert.equal(
    isSetupInvocation(['--format', 'json', 'inbox', 'doctor'], 'murph'),
    false,
  )
  assert.equal(
    isSetupInvocation(['--token-limit', '10', 'inbox', 'doctor'], 'murph'),
    false,
  )
  assert.equal(
    isSetupInvocation(['onboard', '--dryRun']),
    true,
  )
  assert.equal(
    detectSetupProgramName('/usr/local/bin/murph'),
    'murph',
  )
  assert.equal(
    detectSetupProgramName('/tmp/packages/cli/dist/bin.js'),
    'vault-cli',
  )

  const cli = createSetupCli({ commandName: 'murph' })
  assert.ok(cli)
})

test.sequential('murph alias keeps empty invocations setup-owned while root help shows the product CLI', async () => {
  const help = await runMurphAliasActionRaw(['--help'])
  const onboardHelp = await runMurphAliasActionRaw(['onboard', '--help'])
  const useHelp = await runMurphAliasActionRaw(['use', '--help'])
  const emptyInvocation = await runMurphAliasActionRaw([])

  assert.match(help, /Typed operator surface for the Murph vault baseline/u)
  assert.match(
    help,
    /device\s+Device sync commands for provider auth/u,
  )
  assert.match(help, /experiment\s+Experiment bank commands/u)
  assert.doesNotMatch(help, /Murph local machine onboarding helpers\./u)
  assert.doesNotMatch(help, /onboard\s+Provision the local parser\/runtime toolchain/u)
  assert.match(
    onboardHelp,
    /onboard\s+[-—]\s+Provision the local parser\/runtime toolchain for macOS or Linux/u,
  )
  assert.match(
    useHelp,
    /murph use\s+[-—]\s+Set the active Murph vault for future `murph` commands/u,
  )
  assert.match(emptyInvocation, /Murph local machine onboarding helpers\./u)
}, SETUP_ALIAS_TIMEOUT_MS)

test.sequential('murph use saves an existing vault as the active default vault', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-use-home-'))
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-use-vault-'))

  try {
    await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')

    const output = await runSetupCliRawWithEnv('murph', ['use', vaultRoot, '--format', 'json'], {
      env: {
        HOME: homeRoot,
      },
    })

    const result = JSON.parse(output) as {
      configPath: string
      status: string
      vault: string
    }
    assert.equal(result.status, 'completed')

    const savedConfig = await readOperatorConfig(homeRoot)
    assert.equal(savedConfig?.defaultVault, vaultRoot)

    const secondOutput = await runSetupCliRawWithEnv(
      'murph',
      ['use', vaultRoot, '--format', 'json'],
      {
        env: {
          HOME: homeRoot,
        },
      },
    )
    const secondResult = JSON.parse(secondOutput) as {
      status: string
    }
    assert.equal(secondResult.status, 'reused')
  } finally {
    await rm(homeRoot, { recursive: true, force: true })
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, SETUP_ALIAS_TIMEOUT_MS)

test.sequential('murph onboard loads VAULT from a local .env file during setup bootstrap', async () => {
  const originalVault = process.env.VAULT
  const originalHome = process.env.HOME
  const originalCwd = process.cwd()
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-vault-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-home-'))
  const envVault = path.join(await realpath(tempRoot), 'vault-from-dotenv')

  delete process.env.VAULT
  await writeFile(path.join(tempRoot, '.env'), 'VAULT=./vault-from-dotenv\n', 'utf8')

  try {
    process.chdir(tempRoot)
    process.env.HOME = homeRoot
    loadCliEnvFiles(tempRoot)

    const result = requireData(
      await runSetupCli<SetupResult>(
        ['onboard'],
        {
          async setupMacos(input: { vault: string }) {
            return makeSetupResult(path.resolve(input.vault))
          },
        },
        'murph',
      ),
    )

    assert.equal(result.vault, envVault)
  } finally {
    process.chdir(originalCwd)
    restoreEnvironmentVariable('HOME', originalHome)
    restoreEnvironmentVariable('VAULT', originalVault)
    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
}, SETUP_ONBOARD_TIMEOUT_MS)

test.sequential('murph onboard keeps exported VAULT values ahead of local .env files during setup bootstrap', async () => {
  const originalVault = process.env.VAULT
  const originalHome = process.env.HOME
  const originalCwd = process.cwd()
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-precedence-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-precedence-home-'))
  const shellVault = path.join(await realpath(tempRoot), 'vault-from-shell')

  delete process.env.VAULT
  await writeFile(path.join(tempRoot, '.env'), 'VAULT=./vault-from-dotenv\n', 'utf8')

  try {
    process.chdir(tempRoot)
    process.env.HOME = homeRoot
    process.env.VAULT = './vault-from-shell'
    loadCliEnvFiles(tempRoot)

    const result = requireData(
      await runSetupCli<SetupResult>(
        ['onboard'],
        {
          async setupMacos(input: { vault: string }) {
            return makeSetupResult(path.resolve(input.vault))
          },
        },
        'murph',
      ),
    )

    assert.equal(result.vault, shellVault)
  } finally {
    process.chdir(originalCwd)
    restoreEnvironmentVariable('HOME', originalHome)
    restoreEnvironmentVariable('VAULT', originalVault)
    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
}, SETUP_ONBOARD_TIMEOUT_MS)

test.sequential('murph onboard prefers .env.local values over .env defaults', async () => {
  const originalVault = process.env.VAULT
  const originalHome = process.env.HOME
  const originalCwd = process.cwd()
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-local-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-local-home-'))
  const localVault = path.join(await realpath(tempRoot), 'vault-from-dotenv-local')

  delete process.env.VAULT
  await writeFile(path.join(tempRoot, '.env'), 'VAULT=./vault-from-dotenv\n', 'utf8')
  await writeFile(
    path.join(tempRoot, '.env.local'),
    'VAULT=./vault-from-dotenv-local\n',
    'utf8',
  )

  try {
    process.chdir(tempRoot)
    process.env.HOME = homeRoot
    loadCliEnvFiles(tempRoot)

    const result = requireData(
      await runSetupCli<SetupResult>(
        ['onboard'],
        {
          async setupMacos(input: { vault: string }) {
            return makeSetupResult(path.resolve(input.vault))
          },
        },
        'murph',
      ),
    )

    assert.equal(result.vault, localVault)
  } finally {
    process.chdir(originalCwd)
    restoreEnvironmentVariable('HOME', originalHome)
    restoreEnvironmentVariable('VAULT', originalVault)
    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
}, SETUP_ONBOARD_TIMEOUT_MS)

test.sequential('setup-macos wrapper rejects non-macOS hosts before bootstrapping', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wrapper-linux-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`

  await writeExecutable(path.join(stubBin, 'uname'), '#!/usr/bin/env bash\necho Linux\n')
  await writeExecutable(
    path.join(stubBin, 'brew'),
    '#!/usr/bin/env bash\nprintf "brew\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    '#!/usr/bin/env bash\nprintf "node\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    '#!/usr/bin/env bash\nprintf "corepack\\n" >> "\${CALL_LOG}"\nexit 99\n',
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wrapper-linux-dryrun-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`

  await writeExecutable(path.join(stubBin, 'uname'), '#!/usr/bin/env bash\necho Linux\n')
  await writeExecutable(
    path.join(stubBin, 'brew'),
    '#!/usr/bin/env bash\nprintf "brew\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    '#!/usr/bin/env bash\nprintf "node\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    '#!/usr/bin/env bash\nprintf "corepack\\n" >> "\${CALL_LOG}"\nexit 99\n',
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wrapper-dryrun-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`
  const workspacePackageJson = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
  ) as {
    packageManager?: string
  }
  const pnpmVersion =
    workspacePackageJson.packageManager?.match(/^pnpm@([^+]+)/u)?.[1] ?? 'UNCONFIRMED'

  await writeExecutable(path.join(stubBin, 'uname'), '#!/usr/bin/env bash\necho Darwin\n')
  await writeExecutable(
    path.join(stubBin, 'brew'),
    '#!/usr/bin/env bash\nprintf "brew\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    '#!/usr/bin/env bash\nprintf "node\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    '#!/usr/bin/env bash\nprintf "corepack\\n" >> "\${CALL_LOG}"\nexit 99\n',
  )

  try {
    const result = await runSetupWrapper(['--dry-run', '--vault', './vault'], {
      CALL_LOG: callLog,
      HOME: tempRoot,
      PATH: pathValue,
    })

    assert.match(result.stdout, /Detected: macos/u)
    assert.match(result.stdout, /Install plan/u)
    assert.match(result.stdout, /Dry run requested/u)
    assert.match(result.stdout, /Node requirement: >= 24\.14\.1/u)
    assert.match(
      result.stdout,
      new RegExp(`pnpm: ${pnpmVersion.replaceAll('.', '\\.')} via corepack`, 'u'),
    )
    assert.match(
      result.stdout,
      /ffmpeg, whisper\.cpp, and a local Whisper model/u,
    )
    assert.match(
      result.stdout,
      /vault bootstrap, default config, user-level murph\/vault-cli shims, onboarding channel selection, wearables, and assistant automation\/chat handoff/u,
    )
    assert.match(result.stdout, /Ensure Homebrew is available/u)
    assert.match(result.stdout, /Ensure Node >= 24\.14\.1/u)
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

test.sequential('setup service dry-run on Linux reports supported channels cleanly', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-linux-home-'))
  const services = createSetupServices({
    arch: () => 'x64',
    env: () => ({ PATH: '', TELEGRAM_BOT_TOKEN: 'bot-token' }),
    getHomeDirectory: () => homeRoot,
    log() {},
    platform: () => 'linux',
    resolveCliBinPath: () => buildOwnedCliBinPath(homeRoot),
  })

  try {
    const result = await services.setupHost({
      vault: './vault',
      channels: ['telegram'],
      dryRun: true,
    })

    assert.equal(result.platform, 'linux')
    assert.equal(result.dryRun, true)
    assert.equal(result.channels[0]?.channel, 'telegram')
    assert.equal(result.channels[0]?.configured, false)
    assert.match(result.channels[0]?.detail ?? '', /enable assistant auto-reply for Telegram direct chats/u)
    assert.equal(result.channels[0]?.autoReply, true)
    assert.ok(result.steps.some((step) => step.id === 'channel-telegram' && step.status === 'planned'))
  } finally {
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('Linux setup reuses one apt update across declarative tool installs', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-linux-apt-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const binRoot = path.join(tempRoot, 'bin')
  const aptGetCommand = path.join(binRoot, 'apt-get')
  const sudoCommand = path.join(binRoot, 'sudo')
  const ffmpegCommand = path.join(binRoot, 'ffmpeg')
  const whisperCommand = path.join(binRoot, 'whisper-cli')
  const expectedWhisperModelPath = path.join(
    homeRoot,
    '.murph',
    'toolchain',
    'models',
    'whisper',
    'ggml-base.en.bin',
  )
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const runCalls: Array<{ file: string; args: string[] }> = []
  const bootstrapCalls: InboxBootstrapInput[] = []

  await writeExecutable(aptGetCommand)
  await writeExecutable(sudoCommand)

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: binRoot, SHELL: '/bin/bash' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap(input: InboxBootstrapInput) {
        bootstrapCalls.push(input)
        return makeBootstrapResult(vaultRoot, {
          whisperCommand,
          whisperModelPath: expectedWhisperModelPath,
        })
      },
    },
    log() {},
    platform: () => 'linux',
    resolveCliBinPath: () => cliBinPath,
    runCommand: async ({ file, args }) => {
      runCalls.push({ args, file })
      const isSudoCommand = path.basename(file) === 'sudo'
      const isAptGetCommand = path.basename(file) === 'apt-get'
      const aptArgs =
        isSudoCommand ? args.slice(2) : isAptGetCommand ? args : null
      if (!aptArgs) {
        throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
      }
      if (isSudoCommand) {
        assert.equal(args[0], '-n')
        assert.equal(path.basename(args[1] ?? ''), 'apt-get')
      }

      if (aptArgs[0] === 'update') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'updated\n',
        }
      }

      if (aptArgs[0] === 'install' && aptArgs[1] === '-y') {
        for (const packageName of aptArgs.slice(2)) {
          if (packageName === 'ffmpeg') {
            await writeExecutable(ffmpegCommand)
          } else if (packageName === 'whisper-cpp') {
            await writeExecutable(whisperCommand)
          } else {
            throw new Error(`Unexpected apt package: ${packageName}`)
          }
        }
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'installed\n',
        }
      }

      throw new Error(`Unexpected apt args: ${aptArgs.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init(input: { vault: string }) {
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
    const result = await services.setupHost({
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    const normalizedAptCalls = runCalls.map(({ args, file }) => ({
      args: path.basename(file) === 'sudo' ? args.slice(2) : args,
      file: path.basename(file) === 'sudo' ? path.basename(args[1] ?? '') : file,
    }))

    assert.equal(result.platform, 'linux')
    assert.deepEqual(
      normalizedAptCalls.map(({ args }) => args.join(' ')),
      [
        'update',
        'install -y ffmpeg',
        'install -y whisper-cpp',
      ],
    )
    assert.equal(bootstrapCalls.length, 1)
    assert.equal(bootstrapCalls[0]?.ffmpegCommand, ffmpegCommand)
    assert.equal(bootstrapCalls[0]?.whisperCommand, whisperCommand)
    assert.equal(bootstrapCalls[0]?.whisperModelPath, expectedWhisperModelPath)
    assert.equal(result.tools.ffmpegCommand, ffmpegCommand)
    assert.equal(result.tools.whisperCommand, whisperCommand)
    assert.equal(
      result.tools.whisperModelPath,
      '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
    )
    assert.equal(
      result.steps.some(
        (step) => step.id === 'ffmpeg' && step.status === 'completed',
      ),
      true,
    )
    assert.equal(
      result.steps.some(
        (step) => step.id === 'whisper-cpp' && step.status === 'completed',
      ),
      true,
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('Linux setup preserves existing Linq state while adding Telegram on the same vault', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-linux-preserve-linq-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const binRoot = path.join(tempRoot, 'bin')
  const ffmpegCommand = path.join(binRoot, 'ffmpeg')
  const whisperCommand = path.join(binRoot, 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const connectors: InboxConnectorConfig[] = [
    {
      accountId: 'default',
      enabled: true,
      id: 'linq:default',
      options: {
        linqWebhookHost: '127.0.0.1',
        linqWebhookPath: '/hooks/linq',
        linqWebhookPort: 9911,
      },
      source: 'linq' as const,
    },
  ]
  const sourceAddCalls: Array<{
    account: string | null | undefined
    id: string
    requestId: string | null | undefined
    source: string
    vault: string
  }> = []
  const sourceSetEnabledCalls: Array<{
    connectorId: string
    enabled: boolean
    requestId: string | null | undefined
    vault: string
  }> = []

  await mkdir(vaultRoot, { recursive: true })
  await writeFile(path.join(vaultRoot, 'vault.json'), '{}\n', 'utf8')
  await writeExecutable(ffmpegCommand)
  await writeExecutable(whisperCommand)
  await saveAssistantAutomationState(vaultRoot, {
    version: 1,
    autoReply: [
      {
        channel: 'linq',
        enabledAt: '2026-03-24T23:00:00.000Z',
        eligibleAfter: null,
      },
    ],
    updatedAt: '2026-03-24T23:00:00.000Z',
  })

  const services = createSetupServices({
    arch: () => 'x64',
    downloadFile: async (_url, destinationPath) => {
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({
      PATH: binRoot,
      TELEGRAM_BOT_TOKEN: 'token-123',
    }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        return makeBootstrapResult(vaultRoot, {
          whisperCommand,
        })
      },
      async doctor(input: InboxDoctorInput) {
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
              message: 'The Telegram bot token authenticated successfully with getMe.',
            },
          ],
          connectors: [],
          parserToolchain: null,
        }
      },
      async sourceAdd(input: InboxSourceAddInput) {
        sourceAddCalls.push({
          account: input.account,
          id: input.id,
          requestId: input.requestId,
          source: input.source,
          vault: input.vault,
        })
        const connector: InboxConnectorConfig = {
          accountId: input.account ?? null,
          enabled: true,
          id: input.id,
          options: {},
          source: input.source,
        }
        connectors.push(connector)
        return {
          configPath: '.runtime/inboxd/config.json',
          connector,
          connectorCount: connectors.length,
          vault: input.vault,
        }
      },
      async sourceList(input: InboxSourceListInput) {
        return {
          configPath: '.runtime/inboxd/config.json',
          connectors: connectors.map((connector) => ({
            ...connector,
            options: { ...connector.options },
          })),
          vault: input.vault,
        }
      },
      async sourceSetEnabled(input: InboxSourceSetEnabledInput): Promise<InboxSourceSetEnabledResult> {
        const connector = connectors.find((entry) => entry.id === input.connectorId)
        if (connector) {
          connector.enabled = input.enabled
        }
        sourceSetEnabledCalls.push({
          connectorId: input.connectorId,
          enabled: input.enabled,
          requestId: input.requestId,
          vault: input.vault,
        })
        return {
          configPath: '.runtime/inboxd/config.json',
          connector:
            connector ??
            ({
              accountId: null,
              enabled: input.enabled,
              id: input.connectorId,
              options: {},
              source: 'telegram',
            } satisfies InboxConnectorConfig),
          connectorCount: connectors.length,
          vault: input.vault,
        }
      },
    },
    log() {},
    platform: () => 'linux',
    resolveCliBinPath: () => cliBinPath,
    vaultServices: {
      core: {
        async init() {
          throw new Error('init should not be called for an existing vault')
        },
      },
    } as any,
  })

  try {
    const result = await services.setupHost({
      channels: ['telegram'],
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(result.platform, 'linux')
    assert.equal(result.channels.length, 1)
    assert.equal(result.channels[0]?.channel, 'telegram')
    assert.equal(result.channels[0]?.configured, true)
    assert.equal(result.channels[0]?.autoReply, true)
    assert.deepEqual(sourceAddCalls, [
      {
        account: 'bot',
        id: 'telegram:bot',
        requestId: null,
        source: 'telegram',
        vault: vaultRoot,
      },
    ])
    assert.deepEqual(sourceSetEnabledCalls, [])
    assert.equal(connectors.find((connector) => connector.id === 'linq:default')?.enabled, true)

    const automationState = await readAssistantAutomationState(vaultRoot)
    assert.deepEqual(listAutoReplyChannels(automationState), ['linq', 'telegram'])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('setup-host wrapper dry-run prints the Linux bootstrap plan without mutating the machine', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-host-linux-dryrun-'))
  const stubBin = path.join(tempRoot, 'bin')
  const callLog = path.join(tempRoot, 'calls.log')
  const pathValue = `${stubBin}${path.delimiter}${process.env.PATH ?? ''}`

  await mkdir(stubBin, { recursive: true })
  await writeExecutable(
    path.join(stubBin, 'uname'),
    `#!/usr/bin/env bash
if [ "\${1:-}" = "-m" ]; then
  echo x86_64
else
  echo Linux
fi
`,
  )
  await writeExecutable(
    path.join(stubBin, 'node'),
    `#!/usr/bin/env bash
printf "node\n" >> "\${CALL_LOG}"
exit 99
`,
  )
  await writeExecutable(
    path.join(stubBin, 'corepack'),
    `#!/usr/bin/env bash
printf "corepack\n" >> "\${CALL_LOG}"
exit 99
`,
  )
  await writeExecutable(
    path.join(stubBin, 'curl'),
    `#!/usr/bin/env bash
printf "curl\n" >> "\${CALL_LOG}"
exit 99
`,
  )
  await writeExecutable(
    path.join(stubBin, 'wget'),
    `#!/usr/bin/env bash
printf "wget\n" >> "\${CALL_LOG}"
exit 99
`,
  )

  try {
    const result = await runSetupHostWrapper(['--dry-run', '--vault', './vault'], {
      CALL_LOG: callLog,
      HOME: tempRoot,
      PATH: pathValue,
    })

    assert.match(result.stdout, /Detected: linux/u)
    assert.match(result.stdout, /Install plan/u)
    assert.match(result.stdout, /Dry run requested/u)
    assert.match(result.stdout, /download Node 24\.14\.1 under ~\/\.murph\/bootstrap/u)
    assert.match(result.stdout, /corepack pnpm install/u)
    assert.match(result.stdout, /node packages\/cli\/dist\/bin\.js onboard --dry-run --vault \.\/vault/u)
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

async function writeLegacySetupAssistantOperatorConfig(homeRoot: string): Promise<void> {
  const configPath = resolveOperatorConfigPath(homeRoot)
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    JSON.stringify({
      schema: 'murph.operator-config.v1',
      defaultVault: null,
      assistant: {
        backend: {
          adapter: 'unsupported-provider',
          apiKeyEnv: 'LEGACY_API_KEY',
          endpoint: 'https://api.legacy.example/v1',
          headers: null,
          model: 'gpt-4.1-mini',
          presetId: 'legacy',
          providerName: 'legacy-provider',
          reasoningEffort: null,
          webSearch: null,
        },
        account: null,
        identityId: null,
        selfDeliveryTargets: null,
      },
      updatedAt: '2026-04-28T00:00:00.000Z',
    }),
    'utf8',
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
