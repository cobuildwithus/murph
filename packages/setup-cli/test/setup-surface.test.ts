import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'

import { Cli, z } from 'incur'
import { test } from 'vitest'

import { listAssistantCronPresets } from '@murphai/assistant-engine/assistant-cron'
import { resolveAssistantStatePaths } from '@murphai/assistant-engine/assistant-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { SetupResult } from '@murphai/operator-config/setup-cli-contracts'

import * as packageSurface from '../src/index.ts'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createSetupCli,
  formatSetupWearableLabel,
  resolveInitialSetupWizardChannels,
  resolveSetupPostLaunchAction,
  shouldAutoLaunchAssistantAfterSetup,
  shouldRunSetupWizard,
} from '../src/setup-cli.ts'
import type { SetupCliOptions } from '../src/setup-cli.js'
import {
  createSetupAgentmailSelectionResolver,
} from '../src/setup-agentmail.js'
import {
  detectSetupProgramName,
  isSetupInvocation,
} from '../src/setup-services.js'
import { makeSetupResult, runSetupCliJson } from './helpers.ts'

async function runJsonCli(args: string[]): Promise<{
  envelope: {
    ok: boolean
    data?: unknown
    error?: {
      code?: string
      message?: string
      retryable?: boolean
    }
  }
  exitCode: number | null
}> {
  const cli = Cli.create('setup-bridge-test', {
    description: 'setup bridge test',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  cli.command('fail', {
    args: z.object({}),
    async run() {
      throw new VaultCliError('SETUP_BRIDGE', 'setup bridge preserved the error', {
        exitCode: 9,
        retryable: true,
      })
    },
  })
  cli.command('fail-invalid-context', {
    args: z.object({}),
    async run() {
      throw new VaultCliError(
        'SETUP_BRIDGE_INVALID',
        'setup bridge drops invalid context types',
        {
          exitCode: '9',
          retryable: 'yes',
        },
      )
    },
  })

  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve([...args, '--format', 'json', '--full-output'], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    envelope: JSON.parse(output.join('').trim()) as {
      ok: boolean
      data?: unknown
      error?: {
        code?: string
        message?: string
        retryable?: boolean
      }
    },
    exitCode,
  }
}

async function runSetupCli(args: string[], options: SetupCliOptions): Promise<void> {
  const cli = createSetupCli(options)

  await cli.serve([...args, '--full-output'], {
    env: process.env,
    exit: () => {},
    stdout: () => {},
  })
}

test('package surface re-exports the setup entrypoints', () => {
  assert.ok(createSetupCli())
  assert.equal(packageSurface.createSetupCli, createSetupCli)
  assert.equal(
    packageSurface.createSetupAgentmailSelectionResolver,
    createSetupAgentmailSelectionResolver,
  )
  assert.equal(
    packageSurface.detectSetupProgramName,
    detectSetupProgramName,
  )
  assert.equal(packageSurface.shouldRunSetupWizard, shouldRunSetupWizard)
  assert.equal(
    packageSurface.resolveSetupPostLaunchAction,
    resolveSetupPostLaunchAction,
  )
})

test('detectSetupProgramName prefers the shim program name when set to murph', () => {
  assert.equal(detectSetupProgramName('/tmp/vault-cli', 'murph'), 'murph')
  assert.equal(detectSetupProgramName('/tmp/murph', undefined), 'murph')
  assert.equal(detectSetupProgramName('/tmp/anything-else', undefined), 'vault-cli')
})

test('isSetupInvocation treats murph onboarding and active-vault selection as setup entrypoints', () => {
  assert.equal(isSetupInvocation(['onboard']), true)
  assert.equal(isSetupInvocation([], 'murph'), true)
  assert.equal(isSetupInvocation(['help'], 'murph'), true)
  assert.equal(isSetupInvocation(['--help'], 'murph'), false)
  assert.equal(isSetupInvocation(['--llms-full', '--format', 'json'], 'murph'), false)
  assert.equal(isSetupInvocation(['--version'], 'murph'), false)
  assert.equal(isSetupInvocation(['use', './vault'], 'murph'), true)
  assert.equal(isSetupInvocation(['status'], 'murph'), false)
  assert.equal(isSetupInvocation([], 'vault-cli'), false)
})

test('VaultCliError remains a typed incur envelope through the setup bridge', async () => {
  const result = await runJsonCli(['fail'])

  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error?.code, 'SETUP_BRIDGE')
  assert.equal(
    result.envelope.error?.message,
    'setup bridge preserved the error',
  )
  assert.equal(result.envelope.error?.retryable, true)
  assert.equal(result.exitCode, 9)
})

test('setup bridge omits invalid retryable and exitCode context types', async () => {
  const result = await runJsonCli(['fail-invalid-context'])

  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error?.code, 'SETUP_BRIDGE_INVALID')
  assert.equal(result.envelope.error?.retryable, false)
  assert.equal(result.exitCode, 1)
})

test('onboard CLI builds setup CTAs from configured channels, updates, wearables, and missing env', async () => {
  const preset = listAssistantCronPresets()[0]
  assert.ok(preset)

  const result = await runSetupCliJson<SetupResult>(
    ['onboard', '--vault', './vault'],
    {
      commandName: 'murph',
      services: {
        async setupHost() {
          return makeSetupResult('./vault', {
            channels: [
              {
                autoReply: true,
                channel: 'email',
                configured: true,
                connectorId: 'email:agentmail',
                detail: 'Configured email.',
                enabled: true,
                missingEnv: ['AGENTMAIL_API_KEY'],
              },
              {
                autoReply: false,
                channel: 'telegram',
                configured: false,
                connectorId: null,
                detail: 'Not configured.',
                enabled: false,
                missingEnv: ['TELEGRAM_BOT_TOKEN'],
              },
            ],
            scheduledUpdates: [
              {
                jobName: preset.suggestedName,
                preset,
                status: 'completed',
              },
            ],
            wearables: [
              {
                detail: 'Ready to connect.',
                enabled: true,
                missingEnv: [],
                ready: true,
                wearable: 'oura',
              },
              {
                detail: 'Missing credentials.',
                enabled: true,
                missingEnv: ['OURA_CLIENT_ID'],
                ready: false,
                wearable: 'whoop',
              },
            ],
          })
        },
        async setupMacos() {
          return makeSetupResult('./vault', {
            channels: [
              {
                autoReply: true,
                channel: 'email',
                configured: true,
                connectorId: 'email:agentmail',
                detail: 'Configured email.',
                enabled: true,
                missingEnv: ['AGENTMAIL_API_KEY'],
              },
              {
                autoReply: false,
                channel: 'telegram',
                configured: false,
                connectorId: null,
                detail: 'Not configured.',
                enabled: false,
                missingEnv: ['TELEGRAM_BOT_TOKEN'],
              },
            ],
            scheduledUpdates: [
              {
                jobName: preset.suggestedName,
                preset,
                status: 'completed',
              },
            ],
            wearables: [
              {
                detail: 'Ready to connect.',
                enabled: true,
                missingEnv: [],
                ready: true,
                wearable: 'oura',
              },
              {
                detail: 'Missing credentials.',
                enabled: true,
                missingEnv: ['OURA_CLIENT_ID'],
                ready: false,
                wearable: 'whoop',
              },
            ],
          })
        },
      } satisfies NonNullable<SetupCliOptions['services']>,
    },
  )

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.meta.cta?.commands?.map((command) => command.command),
    [
      'murph assistant run',
      'murph automation list',
      'murph assistant chat',
      'murph device connect oura --open',
      'murph export AGENTMAIL_API_KEY=...',
      'murph export OURA_CLIENT_ID=...',
      'murph export TELEGRAM_BOT_TOKEN=...',
      'murph automation scaffold',
    ],
  )
})

test('interactive onboard uses wizard defaults, runtime env hints, and setupHost when available', async () => {
  const wizardCalls: Array<Record<string, unknown>> = []
  const promptCalls: Array<Record<string, unknown>> = []
  const setupHostCalls: Array<Record<string, unknown>> = []
  const successResults: SetupResult[] = []
  let setupMacosCalls = 0
  const previousOuraClientId = process.env.OURA_CLIENT_ID

  try {
    await runSetupCli(
      ['onboard', '--vault', './wizard-vault'],
      {
        commandName: 'murph',
        async onSetupSuccess(context) {
          successResults.push(context.result)
        },
        platform: () => 'linux',
        runtimeEnv: {
          getCurrentEnv() {
            return {
              DEVICE_SYNC_BASE_URL: ' http://127.0.0.1:9000 ',
              DEVICE_SYNC_PUBLIC_BASE_URL: ' https://public.example ',
            }
          },
          async promptForMissing(input) {
            promptCalls.push({
              channels: [...input.channels],
              env: { ...input.env },
              wearables: [...input.wearables],
            })
            return {
              OURA_CLIENT_ID: 'oura-client',
            }
          },
        },
        services: {
          async setupHost(input) {
            setupHostCalls.push({
              allowChannelPrompts: input.allowChannelPrompts,
              assistant: input.assistant,
              channels: input.channels == null ? null : [...input.channels],
              envOverrides: input.envOverrides,
              scheduledUpdatePresetIds:
                input.scheduledUpdatePresetIds == null
                  ? null
                  : [...input.scheduledUpdatePresetIds],
              wearables: input.wearables == null ? null : [...input.wearables],
            })
            return makeSetupResult(input.vault, {
              platform: 'linux',
            })
          },
          async setupMacos(input) {
            setupMacosCalls += 1
            return makeSetupResult(input.vault)
          },
        } satisfies NonNullable<SetupCliOptions['services']>,
        terminal: {
          stdinIsTTY: true,
          stderrIsTTY: true,
        },
        wizard: {
          async run(input) {
            wizardCalls.push({
              channelStatuses: input.channelStatuses,
              deviceSyncLocalBaseUrl: input.deviceSyncLocalBaseUrl,
              initialChannels: [...input.initialChannels],
              initialScheduledUpdates: [...input.initialScheduledUpdates],
              initialWearables: [...input.initialWearables],
              platform: input.platform,
              publicBaseUrl: input.publicBaseUrl,
              vault: input.vault,
              wearableStatuses: input.wearableStatuses,
            })

            return {
              assistantOss: null,
              assistantPreset: 'skip',
              channels: [],
              scheduledUpdates: ['weekly-health-snapshot'],
              wearables: ['oura'],
            }
          },
        },
      },
    )

    assert.equal(successResults.length, 1)
    assert.equal(setupMacosCalls, 0)
    assert.equal(wizardCalls.length, 1)
    assert.deepEqual(wizardCalls[0], {
      channelStatuses: wizardCalls[0]?.channelStatuses,
      deviceSyncLocalBaseUrl: 'http://127.0.0.1:9000',
      initialChannels: [],
      initialScheduledUpdates: [
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      initialWearables: [],
      platform: 'linux',
      publicBaseUrl: 'https://public.example',
      vault: './wizard-vault',
      wearableStatuses: wizardCalls[0]?.wearableStatuses,
    })
    assert.deepEqual(promptCalls, [
      {
        channels: [],
        env: {
          DEVICE_SYNC_BASE_URL: ' http://127.0.0.1:9000 ',
          DEVICE_SYNC_PUBLIC_BASE_URL: ' https://public.example ',
        },
        wearables: ['oura'],
      },
    ])
    assert.deepEqual(setupHostCalls, [
      {
        allowChannelPrompts: true,
        assistant: {
          account: null,
          approvalPolicy: null,
          codexCommand: null,
          codexHome: null,
          detail:
            'Skipped assistant setup. Murph will keep your current assistant settings as they are.',
          enabled: false,
          model: null,
          modelProvider: null,
          oss: null,
          preset: 'skip',
          profile: null,
          provider: null,
          reasoningEffort: null,
          sandbox: null,
        },
        channels: [],
        envOverrides: {
          OURA_CLIENT_ID: 'oura-client',
        },
        scheduledUpdatePresetIds: ['weekly-health-snapshot'],
        wearables: ['oura'],
      },
    ])
    assert.equal(process.env.OURA_CLIENT_ID, 'oura-client')
  } finally {
    if (previousOuraClientId === undefined) {
      delete process.env.OURA_CLIENT_ID
    } else {
      process.env.OURA_CLIENT_ID = previousOuraClientId
    }
  }
})

test('interactive onboard restores canonical wearable preferences into the wizard', async () => {
  const wizardCalls: Array<{
    initialWearables: string[]
  }> = []
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-setup-surface-wearables-'))

  try {
    await mkdir(path.join(vaultRoot, 'bank'), { recursive: true })
    await writeFile(
      path.join(vaultRoot, 'bank', 'preferences.json'),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: '2026-04-10T00:00:00.000Z',
        workoutUnitPreferences: {},
        wearablePreferences: {
          desiredProviders: ['whoop', 'garmin'],
        },
      }),
      'utf8',
    )

    await runSetupCli(
      ['onboard', '--vault', vaultRoot],
      {
        platform: () => 'linux',
        services: {
          async setupHost(input) {
            return makeSetupResult(input.vault, {
              platform: 'linux',
            })
          },
          async setupMacos(input) {
            return makeSetupResult(input.vault)
          },
        } satisfies NonNullable<SetupCliOptions['services']>,
        terminal: {
          stdinIsTTY: true,
          stderrIsTTY: true,
        },
        wizard: {
          async run(input) {
            wizardCalls.push({
              initialWearables: [...input.initialWearables],
            })

            return {
              assistantPreset: 'skip',
              channels: [],
              scheduledUpdates: [],
              wearables: [],
            }
          },
        },
      },
    )

    assert.deepEqual(wizardCalls, [
      {
        initialWearables: ['garmin', 'whoop'],
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('interactive onboard carries Codex wizard choices into runtime prompts and assistant setup', async () => {
  const promptCalls: Array<Record<string, unknown>> = []
  const assistantCalls: Array<Record<string, unknown>> = []

  await runSetupCli(
    ['onboard', '--vault', './assistant-codex-local-vault'],
    {
      assistantSetup: {
        async resolve(input) {
          assistantCalls.push({
            assistantOss: input.options.assistantOss,
            preset: input.preset,
          })

          return {
            account: null,
            approvalPolicy: 'never',
            codexCommand: null,
            codexHome: null,
            detail: 'configured',
            enabled: true,
            model: 'gpt-oss:20b',
            modelProvider: null,
            oss: input.options.assistantOss === true,
            preset: input.preset,
            profile: null,
            provider: 'codex-cli',
            reasoningEffort: 'medium',
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
          promptCalls.push({
            channels: [...input.channels],
            env: { ...input.env },
            wearables: [...input.wearables],
          })
          return {}
        },
      },
      services: {
        async setupHost(input) {
          return makeSetupResult(input.vault, {
            assistant: input.assistant,
          })
        },
        async setupMacos(input) {
          return makeSetupResult(input.vault, {
            assistant: input.assistant,
          })
        },
      } satisfies NonNullable<SetupCliOptions['services']>,
      terminal: {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
      wizard: {
        async run() {
          return {
            assistantOss: true,
            assistantPreset: 'codex',
            channels: [],
            scheduledUpdates: [],
            wearables: [],
          }
        },
      },
    },
  )

  assert.deepEqual(promptCalls, [
    {
      channels: [],
      env: {},
      wearables: [],
    },
  ])
  assert.deepEqual(assistantCalls, [
    {
      assistantOss: true,
      preset: 'codex',
    },
  ])
})

test('interactive onboard lets the wizard switch a local Codex flag back to cloud Codex', async () => {
  const promptCalls: Array<Record<string, unknown>> = []
  const assistantCalls: Array<Record<string, unknown>> = []

  await runSetupCli(
    [
      'onboard',
      '--vault',
      './assistant-codex-vault',
      '--assistantOss',
    ],
    {
      assistantSetup: {
        async resolve(input) {
          assistantCalls.push({
            assistantOss: input.options.assistantOss,
            preset: input.preset,
          })

          return {
            account: null,
            approvalPolicy: 'never',
            codexCommand: null,
            codexHome: null,
            detail: 'configured',
            enabled: true,
            model: 'gpt-5.6-terra',
            modelProvider: null,
            oss: false,
            preset: input.preset,
            profile: null,
            provider: 'codex-cli',
            reasoningEffort: 'medium',
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
          promptCalls.push({
            channels: [...input.channels],
            env: { ...input.env },
            wearables: [...input.wearables],
          })
          return {}
        },
      },
      services: {
        async setupHost(input) {
          return makeSetupResult(input.vault, {
            assistant: input.assistant,
          })
        },
        async setupMacos(input) {
          return makeSetupResult(input.vault, {
            assistant: input.assistant,
          })
        },
      } satisfies NonNullable<SetupCliOptions['services']>,
      terminal: {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
      wizard: {
        async run() {
          return {
            assistantOss: false,
            assistantPreset: 'codex',
            channels: [],
            scheduledUpdates: [],
            wearables: [],
          }
        },
      },
    },
  )

  assert.deepEqual(promptCalls, [
    {
      channels: [],
      env: {},
      wearables: [],
    },
  ])
  assert.deepEqual(assistantCalls, [
    {
      assistantOss: false,
      preset: 'codex',
    },
  ])
})

test('interactive onboard resolves Venice model provider before prompting for provider keys', async () => {
  const order: string[] = []
  const promptCalls: Array<Record<string, unknown>> = []
  const setupHostCalls: Array<{
    envOverrides?: NodeJS.ProcessEnv
    localEnvOverrides?: NodeJS.ProcessEnv
  }> = []
  const sentinelKey = 'venice_secret_SENTINEL'

  await runSetupCli(
    ['onboard', '--vault', './assistant-venice-vault'],
    {
      assistantSetup: {
        async resolve(input) {
          order.push('assistant')
          assert.equal(input.options.assistantModelProvider, 'venice')
          return {
            account: null,
            approvalPolicy: 'never',
            codexCommand: null,
            codexHome: null,
            detail: 'configured',
            enabled: true,
            model: 'venice-model',
            modelProvider: 'venice',
            oss: false,
            preset: input.preset,
            profile: null,
            provider: 'codex-cli',
            reasoningEffort: 'medium',
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
          order.push('env')
          promptCalls.push({
            assistantModelProvider: input.assistantModelProvider,
            channels: [...input.channels],
            env: { ...input.env },
            wearables: [...input.wearables],
          })
          return {
            VENICE_API_KEY: sentinelKey,
          }
        },
      },
      services: {
        async setupHost(input) {
          setupHostCalls.push({
            envOverrides: input.envOverrides,
            localEnvOverrides: input.localEnvOverrides,
          })
          return makeSetupResult(input.vault, {
            assistant: input.assistant,
          })
        },
        async setupMacos(input) {
          return makeSetupResult(input.vault, {
            assistant: input.assistant,
          })
        },
      } satisfies NonNullable<SetupCliOptions['services']>,
      terminal: {
        stdinIsTTY: true,
        stderrIsTTY: true,
      },
      wizard: {
        async run() {
          return {
            assistantModelProvider: 'venice',
            assistantOss: false,
            assistantPreset: 'codex',
            channels: [],
            scheduledUpdates: [],
            wearables: [],
          }
        },
      },
    },
  )

  assert.deepEqual(order, ['assistant', 'env'])
  assert.deepEqual(promptCalls, [
    {
      assistantModelProvider: 'venice',
      channels: [],
      env: {},
      wearables: [],
    },
  ])
  assert.deepEqual(setupHostCalls, [
    {
      envOverrides: undefined,
      localEnvOverrides: {
        VENICE_API_KEY: sentinelKey,
      },
    },
  ])
})

test('noninteractive Venice setup requires provider key in the effective environment', async () => {
  let setupHostCalls = 0
  const result = await runSetupCliJson<SetupResult>(
    [
      'onboard',
      '--vault',
      './assistant-venice-vault',
      '--assistantPreset',
      'codex',
      '--assistantModelProvider',
      'venice',
      '--assistantModel',
      'venice-model',
    ],
    {
      commandName: 'murph',
      runtimeEnv: {
        getCurrentEnv() {
          return {}
        },
        async promptForMissing() {
          throw new Error('noninteractive setup must not prompt for provider keys')
        },
      },
      services: {
        async setupHost(input) {
          setupHostCalls += 1
          return makeSetupResult(input.vault)
        },
        async setupMacos(input) {
          setupHostCalls += 1
          return makeSetupResult(input.vault)
        },
      } satisfies NonNullable<SetupCliOptions['services']>,
      terminal: {
        stdinIsTTY: false,
        stderrIsTTY: false,
      },
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.error?.code, 'SETUP_ASSISTANT_PROVIDER_ENV_MISSING')
  assert.match(result.error?.message ?? '', /VENICE_API_KEY/u)
  assert.equal(setupHostCalls, 0)
})

test('setup CLI helper exports keep interactive and post-launch decisions stable', () => {
  const successContext = {
    agent: false,
    format: 'toon' as const,
    formatExplicit: false,
    result: makeSetupResult('./vault', {
      channels: [
        {
          autoReply: true,
          channel: 'telegram',
          configured: true,
          connectorId: 'telegram:bot',
          detail: 'Configured Telegram.',
          enabled: true,
          missingEnv: [],
        },
      ],
    }),
  }

  assert.equal(
    shouldRunSetupWizard(
      { agent: false, format: 'toon' },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    true,
  )
  assert.equal(
    shouldRunSetupWizard(
      { agent: false, dryRun: true, format: 'toon' },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    false,
  )
  assert.equal(
    shouldRunSetupWizard(
      { agent: false, format: 'json' },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    false,
  )
  assert.equal(
    resolveSetupPostLaunchAction(successContext, {
      stdinIsTTY: true,
      stderrIsTTY: true,
    }),
    'assistant-run',
  )
  assert.equal(
    resolveSetupPostLaunchAction(
      {
        ...successContext,
        result: makeSetupResult('./vault', { channels: [] }),
      },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    'assistant-chat',
  )
  assert.equal(
    resolveSetupPostLaunchAction(successContext, {
      stdinIsTTY: false,
      stderrIsTTY: true,
    }),
    null,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(successContext, {
      stdinIsTTY: true,
      stderrIsTTY: true,
    }),
    true,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(
      {
        ...successContext,
        agent: true,
      },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    false,
  )
  assert.equal(formatSetupWearableLabel('garmin'), 'Garmin')
  assert.equal(formatSetupWearableLabel('oura'), 'Oura')
  assert.equal(formatSetupWearableLabel('whoop'), 'WHOOP')
})

test('setup CLI initial wizard channels reuse saved assistant state and rethrow invalid state', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'setup-cli-automation-state-'))
  const automationPath = resolveAssistantStatePaths(vaultRoot).automationStatePath

  await mkdir(path.dirname(automationPath), { recursive: true })
  await writeFile(
    automationPath,
    JSON.stringify({
      version: 1,
      autoReply: [
        { channel: 'telegram', enabledAt: '2026-04-08T00:00:00.000Z', eligibleAfter: null },
        { channel: 'linq', enabledAt: '2026-04-08T00:00:00.000Z', eligibleAfter: null },
        { channel: 'unknown-channel', enabledAt: '2026-04-08T00:00:00.000Z', eligibleAfter: null },
      ],
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  assert.deepEqual(
    await resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    ['telegram'],
  )

  await writeFile(
    automationPath,
    JSON.stringify({
      version: 1,
      autoReply: [],
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  assert.deepEqual(
    await resolveInitialSetupWizardChannels(vaultRoot, 'darwin'),
    [],
  )

  await writeFile(
    automationPath,
    JSON.stringify({
      version: 1,
      autoReply: [
        { channel: 'telegram', enabledAt: '2026-04-08T00:00:00.000Z', eligibleAfter: null },
        { channel: 'linq', enabledAt: '2026-04-08T00:00:00.000Z', eligibleAfter: null },
        { channel: 'unknown-channel', enabledAt: '2026-04-08T00:00:00.000Z', eligibleAfter: null },
      ],
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  await rm(automationPath, { force: true })

  assert.deepEqual(
    await resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    [],
  )

  await writeFile(automationPath, '{not json', 'utf8')

  await assert.rejects(
    resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    /Expected property name|JSON/u,
  )

})
