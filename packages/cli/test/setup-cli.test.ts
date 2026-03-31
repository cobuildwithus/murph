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
  listSetupPendingWearables,
  listSetupReadyWearables,
  resolveSetupPostLaunchAction,
  resolveInitialSetupWizardChannels,
  shouldAutoLaunchAssistantAfterSetup,
  shouldRunSetupWizard,
  type SuccessfulSetupContext,
} from '../src/setup-cli.js'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '../src/assistant-state.js'
import { listAssistantCronJobs } from '../src/assistant/cron.js'
import {
  readOperatorConfig,
  resolveOperatorConfigPath,
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
} from '../src/operator-config.js'
import {
  createSetupAssistantAccountResolver,
  detectCodexAccountFromAuthJson,
} from '../src/setup-assistant-account.js'
import { createSetupServices } from '../src/setup-services.js'
import { configureSetupScheduledUpdates } from '../src/setup-services/scheduled-updates.js'
import {
  describeSelectedSetupWearables,
  resolveSetupChannelMissingEnv,
  resolveSetupWearableMissingEnv,
} from '../src/setup-runtime-env.js'
import type { InboxSourceSetEnabledResult } from '../src/inbox-app/types.js'
import type { InboxConnectorConfig } from '../src/inbox-cli-contracts.js'
import type { SetupResult } from '../src/setup-cli-contracts.js'
import {
  buildSetupWizardPublicUrlReview,
  createSetupWizardCompletionController,
  describeSetupWizardPublicUrlStrategyChoice,
  getDefaultSetupWizardScheduledUpdates,
  inferSetupWizardAssistantProvider,
  resolveSetupWizardAssistantSelection,
  type SetupWizardResult,
} from '../src/setup-wizard.js'
import {
  commandOutputFromError,
  ensureCliRuntimeArtifacts,
  ensureCliRuntimeArtifactsWithOptions,
  isRetryableCliRuntimeArtifactError,
  repoRoot,
  requireData,
  type CliEnvelope,
  withoutNodeV8Coverage,
} from './cli-test-helpers.js'

const execFileAsync = promisify(execFile)
const SETUP_ALIAS_TIMEOUT_MS = 45_000

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

test('setup wizard completion waits for Ink exit before resolving the selected flow', async () => {
  const completion = createSetupWizardCompletionController()
  const selected = {
    assistantPreset: 'codex-cli' as const,
    channels: ['email'] as const,
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
    assistantPreset: 'codex-cli',
    channels: ['email'],
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

test('setup scheduled updates defer preset-backed jobs until an explicit delivery route is configured', async () => {
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
    assert.match(steps[0]?.detail ?? '', /require an explicit outbound channel route/i)

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

test('setup scheduled updates surface deferred recommendation details without prompt templates and keep dry-run wording', () => {
  const steps: SetupResult['steps'] = []
  const scheduledUpdates = configureSetupScheduledUpdates({
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
    /assistant cron preset install --channel \.\.\./u,
  )
})

test('setup scheduled updates propagate unknown preset errors without mutating steps', () => {
  const steps: SetupResult['steps'] = []

  assert.throws(
    () =>
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
  const steps: SetupResult['steps'] = []

  const scheduledUpdates = await configureSetupScheduledUpdates({
    dryRun: false,
    presetIds: [],
    steps,
  })

  assert.deepEqual(scheduledUpdates, [])
  assert.equal(steps[0]?.status, 'skipped')
  assert.match(steps[0]?.detail ?? '', /No assistant scheduled updates selected/u)
})

test('public URL review recommends hosted apps/web for wearable ingress when no public base is configured', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura', 'whoop'],
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'hosted')
  assert.match(review.summary, /Hosted `apps\/web`/u)
  assert.deepEqual(
    review.targets.map((target) => target.url),
    [
      'http://localhost:8788/oauth/whoop/callback',
      'http://localhost:8788/webhooks/whoop',
      'http://localhost:8788/oauth/oura/callback',
      'http://localhost:8788/webhooks/oura',
    ],
  )
  assert.match(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    /hosted `apps\/web`/u,
  )
})

test('public URL review recommends tunnel mode for Linq-only ingress and keeps the local webhook target explicit', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: ['linq'],
    wearables: [],
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'tunnel')
  assert.match(review.summary, /local inbox webhook/u)
  assert.deepEqual(review.targets, [
    {
      detail:
        'Point your tunnel here. Hosted `apps/web` does not replace this Linq webhook yet.',
      label: 'Linq webhook',
      url: 'http://127.0.0.1:8789/linq-webhook',
    },
  ])
  assert.match(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'tunnel',
    }),
    /does not have a hosted Linq webhook yet/u,
  )
})

test('public URL review keeps hosted wearable guidance while preserving the local Linq webhook when both are selected', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: ['linq'],
    wearables: ['oura', 'whoop'],
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'hosted')
  assert.match(review.summary, /hosted `apps\/web`/u)
  assert.match(review.summary, /local inbox webhook/u)
  assert.deepEqual(
    review.targets.map((target) => target.label),
    [
      'WHOOP callback',
      'WHOOP webhook',
      'Oura callback',
      'Oura webhook',
      'Linq webhook',
    ],
  )
  assert.match(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    /keep Linq on the local webhook path/u,
  )
})

test('public URL review stays hidden when a public device-sync base is already configured', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: ['linq'],
    wearables: ['whoop'],
    publicBaseUrl: 'https://health.example.test/api/device-sync',
  })

  assert.equal(review.enabled, false)
  assert.equal(review.targets.length, 0)
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
          channels: ['linq'],
          publicUrlStrategy: 'hosted',
          scheduledUpdates: [],
          wearables: ['whoop'],
        } as any
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--verbose'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(receivedInputs, [
      {
        channels: ['linq'],
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
      preset: 'codex-cli',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      profile: null,
      reasoningEffort: null,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
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

async function writeExecutable(
  absolutePath: string,
  body = '#!/usr/bin/env bash\nexit 0\n',
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, body, 'utf8')
  await chmod(absolutePath, 0o755)
}

function buildExpectedCliShimScript(
  cliBinPath: string,
  shimName: 'murph' | 'vault-cli' = 'murph',
): string {
  const cliSourceBinPath = path.resolve(path.dirname(cliBinPath), '..', 'src', 'bin.ts')
  const cliPackageRoot = path.resolve(path.dirname(cliBinPath), '..')
  const repoRoot = path.resolve(path.dirname(cliBinPath), '..', '..', '..')
  const cliRequiredDistPaths = [
    cliBinPath,
    path.join(cliPackageRoot, 'dist', 'index.js'),
    path.join(cliPackageRoot, 'dist', 'vault-cli-contracts.js'),
    path.join(cliPackageRoot, 'dist', 'inbox-cli-contracts.js'),
  ]
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
  const cliDistCheckLines = cliRequiredDistPaths
    .map((requiredPath) => {
      return `if [ ! -f '${requiredPath}' ]; then
  cli_dist_ready=false
fi`
    })
    .join('\n')

  return `#!/usr/bin/env bash
set -euo pipefail

run_supervised() {
  if [[ -t 0 && -t 2 ]]; then
    exec "$@"
  fi

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

cli_dist_ready=true
${cliDistCheckLines}

is_discovery_invocation() {
  for arg in "$@"; do
    case "$arg" in
      --help|--schema|--llms|--llms-full)
        return 0
        ;;
    esac
  done

  return 1
}

if is_discovery_invocation "$@"; then
  if [ "$cli_dist_ready" = true ]; then
    run_supervised env SETUP_PROGRAM_NAME='${shimName}' node '${cliBinPath}' "$@"
    exit $?
  fi

  if [ -f '${cliSourceBinPath}' ]; then
    if command -v pnpm >/dev/null 2>&1; then
      run_supervised env SETUP_PROGRAM_NAME='${shimName}' pnpm --dir '${repoRoot}' exec tsx '${cliSourceBinPath}' "$@"
      exit $?
    fi

    if command -v corepack >/dev/null 2>&1; then
      run_supervised env SETUP_PROGRAM_NAME='${shimName}' corepack pnpm --dir '${repoRoot}' exec tsx '${cliSourceBinPath}' "$@"
      exit $?
    fi
  fi
fi

missing_packages=()
if [ "$cli_dist_ready" != true ]; then
  missing_packages+=('${cliPackageRoot}')
fi

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

cli_dist_ready=true
${cliDistCheckLines}

if [ "$cli_dist_ready" = true ]; then
  run_supervised env SETUP_PROGRAM_NAME='${shimName}' node '${cliBinPath}' "$@"
  exit $?
fi

if [ -f '${cliSourceBinPath}' ]; then
  if command -v pnpm >/dev/null 2>&1; then
    run_supervised env SETUP_PROGRAM_NAME='${shimName}' pnpm --dir '${repoRoot}' exec tsx '${cliSourceBinPath}' "$@"
    exit $?
  fi

  if command -v corepack >/dev/null 2>&1; then
    run_supervised env SETUP_PROGRAM_NAME='${shimName}' corepack pnpm --dir '${repoRoot}' exec tsx '${cliSourceBinPath}' "$@"
    exit $?
  fi
fi

printf '%s\n' 'Murph CLI build output is unavailable. Run \`pnpm --dir <repo> build\` or \`pnpm --dir <repo> chat\` from the repo checkout.' >&2
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
        detail: 'Wrote parser toolchain config under .runtime/parsers and completed inbox doctor checks.',
        id: 'inbox-bootstrap',
        kind: 'configure',
        status: 'completed',
        title: 'Inbox bootstrap',
      },
    ],
    toolchainRoot: '~/.murph/toolchain',
    tools: {
      ffmpegCommand: '/usr/local/bin/ffmpeg',
      pdftotextCommand: '/usr/local/bin/pdftotext',
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

  const aliasRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-alias-'))
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

    const execOptions = {
      cwd: options?.cwd ?? repoRoot,
      encoding: 'utf8' as const,
      env: withoutNodeV8Coverage({
        ...process.env,
        ...options?.env,
      }),
    }

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [aliasPath, ...args],
        execOptions,
      )
      return stdout.trim()
    } catch (error) {
      const output = commandOutputFromError(error)
      const shouldRetry = isRetryableCliRuntimeArtifactError(output)

      if (!shouldRetry) {
        throw error
      }

      await ensureCliRuntimeArtifactsWithOptions({ forceReverify: true })
      const { stdout } = await execFileAsync(
        process.execPath,
        [aliasPath, ...args],
        execOptions,
      )
      return stdout.trim()
    }
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

test.sequential('setup CLI dry-run returns a macOS plan without mutating services', async () => {
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

test.sequential('setup CLI keeps post-setup CTAs usable when invoked as murph', async () => {
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
    'murph assistant chat',
  )
  assert.equal(
    result.meta.cta?.commands[1]?.command,
    'murph inbox doctor',
  )
  assert.equal(
    result.meta.cta?.commands[2]?.command,
    'murph inbox source add imessage --id imessage:self --account self --includeOwn',
  )
})

test.sequential('setup CLI reports successful setup metadata for post-setup chat handoff', async () => {
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
          channels: ['imessage'],
          scheduledUpdates: ['environment-health-watch'],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'json', '--verbose'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.equal(wizardCalls, 0)
    assert.deepEqual(receivedChannels[0], null)
    assert.deepEqual(receivedScheduledUpdates[0], null)
    assert.deepEqual(receivedWearables[0], null)

    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--verbose'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.equal(wizardCalls, 1)
    assert.deepEqual(wizardInitialChannels, [['imessage']])
    assert.deepEqual(wizardInitialScheduledUpdates, [[
      'environment-health-watch',
      'weekly-health-snapshot',
    ]])
    assert.deepEqual(receivedChannels[1], ['imessage'])
    assert.deepEqual(receivedScheduledUpdates[1], ['environment-health-watch'])
    assert.deepEqual(receivedWearables[1], [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('interactive onboarding on Linux starts without the macOS-only iMessage default', async () => {
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
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--verbose'], {
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

test('resolveInitialSetupWizardChannels reuses saved preferred email channels even when auto-reply is disabled', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-wizard-'))
  const initialState = await readAssistantAutomationState(vaultRoot)

  await saveAssistantAutomationState(vaultRoot, {
    ...initialState,
    autoReplyChannels: [],
    preferredChannels: ['email'],
    autoReplyPrimed: true,
    updatedAt: '2026-03-24T00:00:00.000Z',
  })

  try {
    assert.deepEqual(
      await resolveInitialSetupWizardChannels(vaultRoot),
      ['email'],
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
    resolveSetupChannelMissingEnv('email', {
      AGENTMAIL_API_KEY: 'agentmail-key',
    }),
    [],
  )
  assert.deepEqual(
    resolveSetupChannelMissingEnv('linq', {
      LINQ_API_TOKEN: 'linq-token',
      LINQ_WEBHOOK_SECRET: 'linq-secret',
    }),
    [],
  )
  assert.deepEqual(resolveSetupChannelMissingEnv('telegram', {}), [
    'TELEGRAM_BOT_TOKEN',
  ])
  assert.deepEqual(resolveSetupChannelMissingEnv('linq', {}), [
    'LINQ_API_TOKEN',
    'LINQ_WEBHOOK_SECRET',
  ])
  assert.deepEqual(
    resolveSetupWearableMissingEnv('oura', {
      OURA_CLIENT_ID: 'oura-client',
    }),
    ['OURA_CLIENT_SECRET'],
  )
  assert.deepEqual(
    describeSelectedSetupWearables({
      env: {
        WHOOP_CLIENT_ID: 'whoop-client',
        WHOOP_CLIENT_SECRET: 'whoop-secret',
      },
      wearables: ['whoop'],
    }),
    [
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
    wearables: string[]
  }> = []
  const receivedInputs: Array<{
    allowChannelPrompts: boolean | undefined
    channels: string[] | null
    envOverrides: NodeJS.ProcessEnv | undefined
    scheduledUpdatePresetIds: string[] | null
    wearables: string[] | null
  }> = []
  const previousEnv = {
    AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY,
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
          wearables: [...input.wearables],
        })
        return {
          AGENTMAIL_API_KEY: 'agentmail-key',
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
          allowChannelPrompts: input.allowChannelPrompts,
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
          channels: ['email'],
          scheduledUpdates: ['weekly-health-snapshot'],
          wearables: ['oura'],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--verbose'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(promptedInputs, [
      {
        channels: ['email'],
        env: {},
        wearables: ['oura'],
      },
    ])
    assert.deepEqual(receivedInputs, [
      {
        allowChannelPrompts: true,
        channels: ['email'],
        envOverrides: {
          AGENTMAIL_API_KEY: 'agentmail-key',
          OURA_CLIENT_ID: 'oura-client',
          OURA_CLIENT_SECRET: 'oura-secret',
        },
        scheduledUpdatePresetIds: ['weekly-health-snapshot'],
        wearables: ['oura'],
      },
    ])
    assert.equal(process.env.AGENTMAIL_API_KEY, 'agentmail-key')
    assert.equal(process.env.OURA_CLIENT_ID, 'oura-client')
    assert.equal(process.env.OURA_CLIENT_SECRET, 'oura-secret')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })

    if (previousEnv.AGENTMAIL_API_KEY === undefined) {
      delete process.env.AGENTMAIL_API_KEY
    } else {
      process.env.AGENTMAIL_API_KEY = previousEnv.AGENTMAIL_API_KEY
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

test('interactive onboarding carries assistant API key defaults from the wizard into runtime prompts and assistant setup', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-assistant-api-key-'))
  const promptedInputs: Array<{
    assistantApiKeyEnv: string | null | undefined
    channels: string[]
    env: NodeJS.ProcessEnv
    wearables: string[]
  }> = []
  const assistantCalls: Array<{
    options: {
      assistantApiKeyEnv: string | null | undefined
      assistantBaseUrl: string | null | undefined
      assistantProviderName: string | null | undefined
    }
    preset: string
  }> = []
  const previousEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  }
  delete process.env.OPENAI_API_KEY

  const cli = createSetupCli({
    assistantSetup: {
      async resolve(input: any) {
        assistantCalls.push({
          options: {
            assistantApiKeyEnv: input.options.assistantApiKeyEnv,
            assistantBaseUrl: input.options.assistantBaseUrl,
            assistantProviderName: input.options.assistantProviderName,
          },
          preset: input.preset,
        })

        return {
          account: null,
          apiKeyEnv: input.options.assistantApiKeyEnv ?? null,
          approvalPolicy: null,
          baseUrl: input.options.assistantBaseUrl ?? null,
          codexCommand: null,
          detail: 'configured',
          enabled: true,
          model: 'gpt-5.4',
          oss: false,
          preset: input.preset,
          profile: null,
          provider: 'openai-compatible',
          providerName: input.options.assistantProviderName ?? null,
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
          assistantApiKeyEnv: input.assistantApiKeyEnv,
          channels: [...input.channels],
          env: { ...input.env },
          wearables: [...input.wearables],
        })
        return {
          OPENAI_API_KEY: 'sk-openai-key',
        }
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
          assistantApiKeyEnv: 'OPENAI_API_KEY',
          assistantBaseUrl: 'https://api.openai.com/v1',
          assistantPreset: 'openai-compatible',
          assistantProviderName: 'OpenAI',
          channels: [],
          scheduledUpdates: [],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(['onboard', '--vault', vaultRoot, '--format', 'toon', '--verbose'], {
      env: process.env,
      exit: () => {},
      stdout() {},
    })

    assert.deepEqual(promptedInputs, [
      {
        assistantApiKeyEnv: 'OPENAI_API_KEY',
        channels: [],
        env: {},
        wearables: [],
      },
    ])
    assert.deepEqual(assistantCalls, [
      {
        options: {
          assistantApiKeyEnv: 'OPENAI_API_KEY',
          assistantBaseUrl: 'https://api.openai.com/v1',
          assistantProviderName: 'OpenAI',
        },
        preset: 'openai-compatible',
      },
    ])
    assert.equal(process.env.OPENAI_API_KEY, 'sk-openai-key')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })

    if (previousEnv.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previousEnv.OPENAI_API_KEY
    }
  }
})

test('interactive onboarding clears stale assistant endpoint defaults when the wizard switches back to Codex sign-in', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-assistant-clear-'))
  const promptedInputs: Array<{
    assistantApiKeyEnv: string | null | undefined
    channels: string[]
    env: NodeJS.ProcessEnv
    wearables: string[]
  }> = []
  const assistantCalls: Array<{
    options: {
      assistantApiKeyEnv: string | null | undefined
      assistantBaseUrl: string | null | undefined
      assistantProviderName: string | null | undefined
    }
    preset: string
  }> = []

  const cli = createSetupCli({
    assistantSetup: {
      async resolve(input: any) {
        assistantCalls.push({
          options: {
            assistantApiKeyEnv: input.options.assistantApiKeyEnv,
            assistantBaseUrl: input.options.assistantBaseUrl,
            assistantProviderName: input.options.assistantProviderName,
          },
          preset: input.preset,
        })

        return {
          account: null,
          apiKeyEnv: null,
          approvalPolicy: null,
          baseUrl: null,
          codexCommand: null,
          detail: 'configured',
          enabled: true,
          model: 'gpt-5.4',
          oss: false,
          preset: input.preset,
          profile: null,
          provider: 'codex-cli',
          providerName: null,
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
          assistantApiKeyEnv: input.assistantApiKeyEnv,
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
          assistantApiKeyEnv: null,
          assistantBaseUrl: null,
          assistantPreset: 'codex-cli',
          assistantProviderName: null,
          channels: [],
          scheduledUpdates: [],
          wearables: [],
        }
      },
    },
  })

  try {
    await cli.serve(
      [
        'onboard',
        '--vault',
        vaultRoot,
        '--format',
        'toon',
        '--verbose',
        '--assistantBaseUrl',
        'https://api.openai.com/v1',
        '--assistantApiKeyEnv',
        'OPENAI_API_KEY',
        '--assistantProviderName',
        'OpenAI',
      ],
      {
        env: process.env,
        exit: () => {},
        stdout() {},
      },
    )

    assert.deepEqual(promptedInputs, [
      {
        assistantApiKeyEnv: null,
        channels: [],
        env: {},
        wearables: [],
      },
    ])
    assert.deepEqual(assistantCalls, [
      {
        options: {
          assistantApiKeyEnv: null,
          assistantBaseUrl: null,
          assistantProviderName: null,
        },
        preset: 'codex-cli',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('wizard infers Ollama from the default local endpoint even when it reuses OPENAI_API_KEY', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'http://127.0.0.1:11434/v1',
      preset: 'openai-compatible',
      providerName: null,
    }),
    'ollama',
  )
})

test('wizard still falls back to a custom endpoint when a non-OpenAI base URL reuses OPENAI_API_KEY', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://models.example.test/v1',
      preset: 'openai-compatible',
      providerName: null,
    }),
    'custom',
  )
})

test('wizard preserves existing named provider metadata when that provider stays selected', () => {
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      initialApiKeyEnv: 'OPENROUTER_API_KEY',
      initialBaseUrl: 'https://openrouter.ai/api/v1',
      initialProvider: 'openrouter',
      initialProviderName: 'OpenRouter',
      method: 'compatible-provider',
      provider: 'openrouter',
    }),
    {
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      detail: 'Murph will use OpenRouter and read the key from OPENROUTER_API_KEY. It will ask which model to save next.',
      methodLabel: null,
      preset: 'openai-compatible',
      providerLabel: 'OpenRouter',
      providerName: 'OpenRouter',
      summary: 'OpenRouter',
    },
  )
})

test('setup wearable helpers split ready and pending selections', () => {
  const result = {
    ...makeSetupResult('./vault'),
    wearables: [
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

  assert.deepEqual(listSetupReadyWearables(result), ['oura'])
  assert.deepEqual(listSetupPendingWearables(result), [result.wearables[1]])
})

test('setup resolves assistant defaults from explicit assistant options when the wizard is skipped', async () => {
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
      TELEGRAM_BOT_TOKEN: 'token-123',
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-telegram-fail-'))
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
      TELEGRAM_BOT_TOKEN: 'token-123',
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
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const murphShimPath = path.join(homeRoot, '.local', 'bin', 'murph')
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
        preset: 'codex-cli',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        codexCommand: null,
        profile: null,
        reasoningEffort: null,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
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
    assert.equal(bootstrapCalls[0]?.pdftotextCommand, pdftotextCommand)
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
    assert.equal(installedFormulas.has('poppler'), true)
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
    assert.equal(
      result.notes.includes('Open a new shell or run source ~/.zshrc to use murph immediately.'),
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
        defaultsByProvider?: {
          'codex-cli'?: {
            model?: string | null
          } | null
        } | null
        provider?: string | null
      } | null
      defaultVault: string | null
    }
    const murphShim = await readFile(murphShimPath, 'utf8')
    const vaultCliShim = await readFile(vaultCliShimPath, 'utf8')
    const shellProfile = await readFile(shellProfilePath, 'utf8')
    assert.equal(modelText, 'model')
    assert.equal(operatorConfig.defaultVault, '~/vault')
    assert.equal(operatorConfig.assistant?.provider, 'codex-cli')
    assert.equal(operatorConfig.assistant?.defaultsByProvider?.['codex-cli']?.model, 'gpt-5.4')
    assert.equal(operatorConfig.assistant?.account?.kind, 'account')
    assert.equal(operatorConfig.assistant?.account?.planCode, 'plus')
    assert.equal(operatorConfig.assistant?.account?.planName, 'Plus')
    assert.equal(operatorConfig.assistant?.account?.quota?.creditsRemaining, 18)
    assert.equal(operatorConfig.assistant?.account?.quota?.primaryWindow?.remainingPercent, 55)
    assert.equal(murphShim, buildExpectedCliShimScript(cliBinPath, 'murph'))
    assert.equal(vaultCliShim, buildExpectedCliShimScript(cliBinPath, 'vault-cli'))
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

test.sequential('setup preserves saved OpenAI-compatible headers when re-saving assistant defaults', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-openai-compatible-headers-'))
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
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')

  await saveAssistantOperatorDefaultsPatch(
    {
      provider: 'openai-compatible',
      defaultsByProvider: {
        'openai-compatible': {
          codexCommand: null,
          model: 'llama3.2:latest',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
          providerName: 'ollama',
          headers: {
            Authorization: 'Bearer override-token',
            'X-Foo': 'bar',
          },
        },
      },
      identityId: null,
      failoverRoutes: null,
      account: null,
      selfDeliveryTargets: null,
    },
    homeRoot,
  )

  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
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
        account: null,
        detail: 'Use gpt-oss:20b through Ollama.',
      },
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    const operatorConfig = await readOperatorConfig(homeRoot)
    assert.equal(operatorConfig?.assistant?.provider, 'openai-compatible')
    assert.equal(
      operatorConfig?.assistant?.defaultsByProvider?.['openai-compatible']?.model,
      'gpt-oss:20b',
    )
    assert.deepEqual(
      operatorConfig?.assistant?.defaultsByProvider?.['openai-compatible']?.headers,
      {
        Authorization: 'Bearer override-token',
        'X-Foo': 'bar',
      },
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
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')

  await saveAssistantOperatorDefaultsPatch(
    {
      provider: 'codex-cli',
      defaultsByProvider: {
        'codex-cli': {
          codexCommand: '/opt/bin/codex-old',
          model: 'gpt-5.4',
          reasoningEffort: null,
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          profile: null,
          oss: false,
          baseUrl: null,
          apiKeyEnv: null,
          providerName: null,
          headers: null,
        },
      },
      identityId: null,
      failoverRoutes: null,
      account: null,
      selfDeliveryTargets: null,
    },
    homeRoot,
  )

  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
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
        preset: 'codex-cli',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        codexCommand: '/opt/bin/codex-new',
        profile: null,
        reasoningEffort: null,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        oss: false,
        account: null,
        detail: 'Use Codex CLI with gpt-5.4.',
      },
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    const operatorConfig = await readOperatorConfig(homeRoot)
    assert.equal(operatorConfig?.assistant?.provider, 'codex-cli')
    assert.equal(
      operatorConfig?.assistant?.defaultsByProvider?.['codex-cli']?.codexCommand,
      '/opt/bin/codex-new',
    )

    await services.setupMacos({
      assistant: {
        preset: 'codex-cli',
        enabled: true,
        provider: 'codex-cli',
        model: 'gpt-5.4',
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        codexCommand: null,
        profile: null,
        reasoningEffort: null,
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        oss: false,
        account: null,
        detail: 'Use Codex CLI with gpt-5.4.',
      },
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    const preservedOperatorConfig = await readOperatorConfig(homeRoot)
    assert.equal(
      preservedOperatorConfig?.assistant?.defaultsByProvider?.['codex-cli']?.codexCommand,
      '/opt/bin/codex-new',
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim rebuilds missing workspace package dist outputs before launching the built CLI', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-repair-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'murph')
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

    await writeFile(path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js'), 'export {}\n', 'utf8')
    await writeFile(
      path.join(repoRoot, 'packages', 'cli', 'dist', 'vault-cli-contracts.js'),
      'export {}\n',
      'utf8',
    )
    await writeFile(
      path.join(repoRoot, 'packages', 'cli', 'dist', 'inbox-cli-contracts.js'),
      'export {}\n',
      'utf8',
    )

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
    await writeExecutable(shimPath, buildExpectedCliShimScript(cliBinPath, 'murph'))

    const result = await execFileAsync(shimPath, [], {
      env: withoutNodeV8Coverage({
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      }),
    })

    assert.equal(result.stdout.trim(), 'built-ok')
    await readFile(runtimeStateDistIndexPath, 'utf8')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim serves discovery commands without rebuilding missing workspace dist artifacts', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-discovery-help-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliPackageRoot = path.join(repoRoot, 'packages', 'cli')
  const cliDistRoot = path.join(cliPackageRoot, 'dist')
  const cliBinPath = path.join(cliDistRoot, 'bin.js')
  const shimPath = path.join(tempRoot, 'vault-cli')
  const fakeBinDirectory = path.join(tempRoot, 'bin')
  const buildMarkerPath = path.join(tempRoot, 'build-invoked.txt')
  const missingWorkspaceDistIndexPath = path.join(
    repoRoot,
    'packages',
    'runtime-state',
    'dist',
    'index.js',
  )

  try {
    await mkdir(cliDistRoot, { recursive: true })
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
      await writeFile(packageDistIndexPath, 'export {}\n', 'utf8')
    }

    await writeFile(cliBinPath, `console.log('cli-help')\n`, 'utf8')
    await writeFile(path.join(cliDistRoot, 'index.js'), 'export {}\n', 'utf8')
    await writeFile(path.join(cliDistRoot, 'vault-cli-contracts.js'), 'export {}\n', 'utf8')
    await writeFile(path.join(cliDistRoot, 'inbox-cli-contracts.js'), 'export {}\n', 'utf8')

    await writeExecutable(
      path.join(fakeBinDirectory, 'pnpm'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' invoked > ${JSON.stringify(buildMarkerPath)}
exit 23
`,
    )
    await writeExecutable(shimPath, buildExpectedCliShimScript(cliBinPath, 'murph'))

    const result = await execFileAsync(shimPath, ['assistant', 'memory', 'upsert', '--help'], {
      env: withoutNodeV8Coverage({
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      }),
    })

    assert.equal(result.stdout.trim(), 'cli-help')
    await assert.rejects(readFile(buildMarkerPath, 'utf8'), /ENOENT/u)
    await assert.rejects(readFile(missingWorkspaceDistIndexPath, 'utf8'), /ENOENT/u)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim rebuilds missing cli dist artifacts before launching the built CLI', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-cli-repair-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliPackageRoot = path.join(repoRoot, 'packages', 'cli')
  const cliDistRoot = path.join(cliPackageRoot, 'dist')
  const cliBinPath = path.join(cliDistRoot, 'bin.js')
  const shimPath = path.join(tempRoot, 'murph')
  const fakeBinDirectory = path.join(tempRoot, 'bin')
  const rebuiltMarkerPath = path.join(tempRoot, 'cli-rebuilt.txt')

  try {
    await mkdir(cliDistRoot, { recursive: true })
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

    await writeFile(
      path.join(cliDistRoot, 'index.js'),
      `import './vault-cli-contracts.js'
console.log('built-ok')
`,
      'utf8',
    )
    await writeFile(cliBinPath, `import './index.js'\n`, 'utf8')
    await writeFile(path.join(cliDistRoot, 'inbox-cli-contracts.js'), 'export {}\n', 'utf8')

    await writeExecutable(
      path.join(fakeBinDirectory, 'pnpm'),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "--dir" ] && [ "$3" = "build" ]; then
  mkdir -p "$2/dist"
  if [ "$2" = ${JSON.stringify(cliPackageRoot)} ]; then
    printf '%s\\n' 'export {}' > "$2/dist/vault-cli-contracts.js"
    printf '%s\\n' rebuilt > ${JSON.stringify(rebuiltMarkerPath)}
  else
    printf '%s\\n' 'export {}' > "$2/dist/index.js"
  fi
  exit 0
fi
exit 1
`,
    )
    await writeExecutable(shimPath, buildExpectedCliShimScript(cliBinPath, 'murph'))

    const result = await execFileAsync(shimPath, [], {
      env: withoutNodeV8Coverage({
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      }),
    })

    assert.equal(result.stdout.trim(), 'built-ok')
    assert.equal((await readFile(rebuiltMarkerPath, 'utf8')).trim(), 'rebuilt')
    await readFile(path.join(cliDistRoot, 'vault-cli-contracts.js'), 'utf8')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test.sequential('CLI shim force-stops a stubborn built child after SIGINT', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-shim-sigint-'))
  const repoRoot = path.join(tempRoot, 'repo')
  const cliBinPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
  const shimPath = path.join(tempRoot, 'murph')
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

    await writeFile(path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js'), 'export {}\n', 'utf8')
    await writeFile(
      path.join(repoRoot, 'packages', 'cli', 'dist', 'vault-cli-contracts.js'),
      'export {}\n',
      'utf8',
    )
    await writeFile(
      path.join(repoRoot, 'packages', 'cli', 'dist', 'inbox-cli-contracts.js'),
      'export {}\n',
      'utf8',
    )

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
    await writeExecutable(shimPath, buildExpectedCliShimScript(cliBinPath, 'murph'))

    const child = spawn(shimPath, [], {
      detached: true,
      env: withoutNodeV8Coverage({
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      }),
      stdio: 'ignore',
    })

    for (let attempt = 0; attempt < 100; attempt += 1) {
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
        }, 10000)

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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-existing-vault-'))
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-redaction-'))
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
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('setup routing helpers keep the setup alias stable', () => {
  assert.equal(isSetupInvocation(['setup', '--dryRun']), true)
  assert.equal(isSetupInvocation(['inbox', 'doctor']), false)
  assert.equal(isSetupInvocation([], 'murph'), true)
  assert.equal(isSetupInvocation(['--help'], 'murph'), true)
  assert.equal(isSetupInvocation(['--verbose', '--format', 'json'], 'murph'), true)
  assert.equal(
    isSetupInvocation(['--format', 'json', 'setup', '--dry-run'], 'murph'),
    true,
  )
  assert.equal(
    isSetupInvocation(['--filter-output', 'steps[0].title', '--help'], 'murph'),
    true,
  )
  assert.equal(
    isSetupInvocation(['--token-limit', '10', '--help'], 'murph'),
    true,
  )
  assert.equal(
    isSetupInvocation(['--token-offset', '5', 'setup', '--dry-run'], 'murph'),
    true,
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

test.sequential('murph alias routes empty and help invocations to setup help', async () => {
  const help = await runSetupAliasRaw('murph', ['--help'])
  const onboardHelp = await runSetupAliasRaw('murph', ['onboard', '--help'])
  const emptyInvocation = await runSetupAliasRaw('murph', [])
  const inboxHelp = await runSetupAliasRaw('murph', ['inbox', 'doctor', '--help'])

  assert.match(help, /Murph local machine setup helpers\./u)
  assert.match(help, /setup\s+Provision the local parser\/runtime toolchain for macOS or Linux/u)
  assert.match(onboardHelp, /onboard\s+[—-]\s+Alias for setup/u)
  assert.doesNotMatch(help, /search\s+Search commands for the local read model/u)
  assert.match(emptyInvocation, /Murph local machine setup helpers\./u)
  assert.doesNotMatch(inboxHelp, /Murph local machine setup helpers\./u)
  assert.match(inboxHelp, /vault-cli inbox doctor/u)
}, SETUP_ALIAS_TIMEOUT_MS)

test.sequential('murph loads VAULT from a local .env file', async () => {
  const originalVault = process.env.VAULT
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-vault-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-home-'))
  const envVault = path.join(tempRoot, 'vault-from-dotenv')

  delete process.env.VAULT
  await writeFile(path.join(tempRoot, '.env'), 'VAULT=./vault-from-dotenv\n', 'utf8')

  try {
    await runSetupAliasRaw('murph', ['init'], {
      cwd: tempRoot,
      env: {
        HOME: homeRoot,
      },
    })

    await readFile(path.join(envVault, 'vault.json'), 'utf8')
    await readFile(path.join(envVault, 'CORE.md'), 'utf8')
  } finally {
    if (originalVault === undefined) {
      delete process.env.VAULT
    } else {
      process.env.VAULT = originalVault
    }

    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('murph keeps exported VAULT values ahead of local .env files', async () => {
  const originalVault = process.env.VAULT
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-precedence-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-precedence-home-'))
  const shellVault = path.join(tempRoot, 'vault-from-shell')
  const dotenvVault = path.join(tempRoot, 'vault-from-dotenv')

  delete process.env.VAULT
  await writeFile(path.join(tempRoot, '.env'), 'VAULT=./vault-from-dotenv\n', 'utf8')

  try {
    await runSetupAliasRaw('murph', ['init'], {
      cwd: tempRoot,
      env: {
        VAULT: './vault-from-shell',
        HOME: homeRoot,
      },
    })

    await readFile(path.join(shellVault, 'vault.json'), 'utf8')
    await assert.rejects(readFile(path.join(dotenvVault, 'vault.json'), 'utf8'))
  } finally {
    if (originalVault === undefined) {
      delete process.env.VAULT
    } else {
      process.env.VAULT = originalVault
    }

    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('murph prefers .env.local values over .env defaults', async () => {
  const originalVault = process.env.VAULT
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-local-'))
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-dotenv-local-home-'))
  const localVault = path.join(tempRoot, 'vault-from-dotenv-local')
  const dotenvVault = path.join(tempRoot, 'vault-from-dotenv')

  delete process.env.VAULT
  await writeFile(path.join(tempRoot, '.env'), 'VAULT=./vault-from-dotenv\n', 'utf8')
  await writeFile(
    path.join(tempRoot, '.env.local'),
    'VAULT=./vault-from-dotenv-local\n',
    'utf8',
  )

  try {
    await runSetupAliasRaw('murph', ['init'], {
      cwd: tempRoot,
      env: {
        HOME: homeRoot,
      },
    })

    await readFile(path.join(localVault, 'vault.json'), 'utf8')
    await assert.rejects(readFile(path.join(dotenvVault, 'vault.json'), 'utf8'))
  } finally {
    if (originalVault === undefined) {
      delete process.env.VAULT
    } else {
      process.env.VAULT = originalVault
    }

    await rm(tempRoot, { recursive: true, force: true })
    await rm(homeRoot, { recursive: true, force: true })
  }
})

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
    assert.match(result.stdout, /Node requirement: >= 22\.16\.0/u)
    assert.match(result.stdout, /pnpm: 9\.15\.9 via corepack/u)
    assert.match(
      result.stdout,
      /ffmpeg, poppler\/pdftotext, whisper\.cpp, and a local Whisper model/u,
    )
    assert.match(
      result.stdout,
      /vault bootstrap, default config, user-level murph\/vault-cli shims, onboarding channel selection, wearables, and assistant automation\/chat handoff/u,
    )
    assert.match(result.stdout, /Ensure Homebrew is available/u)
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

test.sequential('setup service dry-run on Linux keeps cross-platform channels and skips iMessage cleanly', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-linux-home-'))
  const services = createSetupServices({
    arch: () => 'x64',
    env: () => ({ AGENTMAIL_API_KEY: 'agentmail-key', PATH: '' }),
    getHomeDirectory: () => homeRoot,
    log() {},
    platform: () => 'linux',
  })

  try {
    const result = await services.setupHost({
      vault: './vault',
      channels: ['imessage', 'email'],
      dryRun: true,
    })

    assert.equal(result.platform, 'linux')
    assert.equal(result.dryRun, true)
    assert.equal(result.channels[0]?.channel, 'imessage')
    assert.equal(result.channels[0]?.configured, false)
    assert.match(result.channels[0]?.detail ?? '', /requires macOS/u)
    assert.equal(result.channels[1]?.channel, 'email')
    assert.equal(result.channels[1]?.autoReply, true)
    assert.ok(result.steps.some((step) => step.id === 'channel-imessage' && step.status === 'skipped'))
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
  const pdftotextCommand = path.join(binRoot, 'pdftotext')
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
  const bootstrapCalls: Array<Record<string, unknown>> = []

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
      async bootstrap(input) {
        bootstrapCalls.push(input as unknown as Record<string, unknown>)
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
          } else if (packageName === 'poppler-utils') {
            await writeExecutable(pdftotextCommand)
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
        'install -y poppler-utils',
        'install -y whisper-cpp',
      ],
    )
    assert.equal(bootstrapCalls.length, 1)
    assert.equal(bootstrapCalls[0]?.ffmpegCommand, ffmpegCommand)
    assert.equal(bootstrapCalls[0]?.pdftotextCommand, pdftotextCommand)
    assert.equal(bootstrapCalls[0]?.whisperCommand, whisperCommand)
    assert.equal(bootstrapCalls[0]?.whisperModelPath, expectedWhisperModelPath)
    assert.equal(result.tools.ffmpegCommand, ffmpegCommand)
    assert.equal(result.tools.pdftotextCommand, pdftotextCommand)
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
        (step) => step.id === 'pdftotext' && step.status === 'completed',
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

test.sequential('Linux setup preserves existing iMessage state while adding Telegram on the same vault', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-linux-preserve-imessage-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const binRoot = path.join(tempRoot, 'bin')
  const ffmpegCommand = path.join(binRoot, 'ffmpeg')
  const pdftotextCommand = path.join(binRoot, 'pdftotext')
  const whisperCommand = path.join(binRoot, 'whisper-cli')
  const cliBinPath = path.join(tempRoot, 'packages', 'cli', 'dist', 'bin.js')
  const connectors: InboxConnectorConfig[] = [
    {
      accountId: 'self',
      enabled: true,
      id: 'imessage:self',
      options: {
        includeOwnMessages: true,
      },
      source: 'imessage' as const,
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
  await writeExecutable(pdftotextCommand)
  await writeExecutable(whisperCommand)
  await saveAssistantAutomationState(vaultRoot, {
    version: 2,
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: ['imessage'],
    preferredChannels: ['imessage'],
    autoReplyBacklogChannels: [],
    autoReplyPrimed: false,
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
      async doctor(input) {
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
      async sourceAdd(input) {
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
      async sourceList(input) {
        return {
          configPath: '.runtime/inboxd/config.json',
          connectors: connectors.map((connector) => ({
            ...connector,
            options: { ...connector.options },
          })),
          vault: input.vault,
        }
      },
      async sourceSetEnabled(input): Promise<InboxSourceSetEnabledResult> {
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
    assert.equal(connectors.find((connector) => connector.id === 'imessage:self')?.enabled, true)

    const automationState = await readAssistantAutomationState(vaultRoot)
    assert.deepEqual(automationState.autoReplyChannels, ['telegram', 'imessage'])
    assert.deepEqual(automationState.preferredChannels, ['telegram', 'imessage'])
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
    assert.match(result.stdout, /download Node 22\.16\.0 under ~\/\.murph\/bootstrap/u)
    assert.match(result.stdout, /corepack pnpm install/u)
    assert.match(result.stdout, /node packages\/cli\/dist\/bin\.js onboard --dry-run --vault \.\/vault/u)
    assert.match(result.stdout, /iMessage stays macOS-only/u)
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
