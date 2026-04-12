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

  await cli.serve([...args, '--format', 'json', '--verbose'], {
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

  await cli.serve([...args, '--verbose'], {
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

test('isSetupInvocation treats onboard and murph root help as setup entrypoints', () => {
  assert.equal(isSetupInvocation(['onboard']), true)
  assert.equal(isSetupInvocation([], 'murph'), true)
  assert.equal(isSetupInvocation(['help'], 'murph'), true)
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
      'murph inbox doctor',
      'murph inbox source add telegram --id telegram:bot --account bot',
      'murph inbox source add linq --id linq:default --account default --linqWebhookPort 8789 --linqWebhookPath /linq-webhook',
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
              assistantApiKeyEnv: input.assistantApiKeyEnv,
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
              linqLocalWebhookUrl: input.linqLocalWebhookUrl,
              platform: input.platform,
              publicBaseUrl: input.publicBaseUrl,
              vault: input.vault,
              wearableStatuses: input.wearableStatuses,
            })

            return {
              assistantPreset: 'skip',
              channels: ['linq'],
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
      linqLocalWebhookUrl: 'http://127.0.0.1:8789/linq-webhook',
      platform: 'linux',
      publicBaseUrl: 'https://public.example',
      vault: './wizard-vault',
      wearableStatuses: wizardCalls[0]?.wearableStatuses,
    })
    assert.deepEqual(promptCalls, [
      {
        assistantApiKeyEnv: undefined,
        channels: ['linq'],
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
          apiKeyEnv: null,
          approvalPolicy: null,
          baseUrl: null,
          codexCommand: null,
          detail:
            'Skipped assistant setup. Murph will keep your current assistant settings as they are.',
          enabled: false,
          model: null,
          oss: null,
          preset: 'skip',
          presetId: null,
          profile: null,
          provider: null,
          providerName: null,
          reasoningEffort: null,
          sandbox: null,
        },
        channels: ['linq'],
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

test('interactive onboard carries assistant API key defaults from the wizard into runtime prompts and assistant setup', async () => {
  const promptCalls: Array<Record<string, unknown>> = []
  const assistantCalls: Array<Record<string, unknown>> = []
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY

  delete process.env.OPENAI_API_KEY

  try {
    await runSetupCli(
      ['onboard', '--vault', './assistant-api-key-vault'],
      {
        assistantSetup: {
          async resolve(input) {
            assistantCalls.push({
              assistantApiKeyEnv: input.options.assistantApiKeyEnv,
              assistantBaseUrl: input.options.assistantBaseUrl,
              assistantProviderName: input.options.assistantProviderName,
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
            promptCalls.push({
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
      },
    )

    assert.deepEqual(promptCalls, [
      {
        assistantApiKeyEnv: 'OPENAI_API_KEY',
        channels: [],
        env: {},
        wearables: [],
      },
    ])
    assert.deepEqual(assistantCalls, [
      {
        assistantApiKeyEnv: 'OPENAI_API_KEY',
        assistantBaseUrl: 'https://api.openai.com/v1',
        assistantProviderName: 'OpenAI',
        preset: 'openai-compatible',
      },
    ])
    assert.equal(process.env.OPENAI_API_KEY, 'sk-openai-key')
  } finally {
    if (previousOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiApiKey
    }
  }
})

test('interactive onboard clears stale assistant endpoint defaults when the wizard switches back to Codex sign-in', async () => {
  const promptCalls: Array<Record<string, unknown>> = []
  const assistantCalls: Array<Record<string, unknown>> = []

  await runSetupCli(
    [
      'onboard',
      '--vault',
      './assistant-codex-vault',
      '--assistantBaseUrl',
      'https://api.openai.com/v1',
      '--assistantApiKeyEnv',
      'OPENAI_API_KEY',
      '--assistantProviderName',
      'OpenAI',
    ],
    {
      assistantSetup: {
        async resolve(input) {
          assistantCalls.push({
            assistantApiKeyEnv: input.options.assistantApiKeyEnv,
            assistantBaseUrl: input.options.assistantBaseUrl,
            assistantProviderName: input.options.assistantProviderName,
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
          promptCalls.push({
            assistantApiKeyEnv: input.assistantApiKeyEnv,
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
            assistantApiKeyEnv: null,
            assistantBaseUrl: null,
            assistantPreset: 'codex',
            assistantProviderName: null,
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
      assistantApiKeyEnv: null,
      channels: [],
      env: {},
      wearables: [],
    },
  ])
  assert.deepEqual(assistantCalls, [
    {
      assistantApiKeyEnv: null,
      assistantBaseUrl: null,
      assistantProviderName: null,
      preset: 'codex',
    },
  ])
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

test('setup CLI initial wizard channels reuse saved state, fall back to inbox config, and rethrow invalid state', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'setup-cli-automation-state-'))
  const automationPath = resolveAssistantStatePaths(vaultRoot).automationStatePath
  const inboxConfigPath = path.join(
    vaultRoot,
    '.runtime',
    'operations',
    'inbox',
    'config.json',
  )

  await mkdir(path.dirname(automationPath), { recursive: true })
  await writeFile(
    automationPath,
    JSON.stringify({
      version: 1,
      inboxScanCursor: null,
      autoReply: [
        { channel: 'telegram', cursor: null },
        { channel: 'linq', cursor: null },
        { channel: 'unknown-channel', cursor: null },
      ],
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  assert.deepEqual(
    await resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    ['telegram', 'linq'],
  )

  await writeFile(
    automationPath,
    JSON.stringify({
      version: 1,
      inboxScanCursor: null,
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
      inboxScanCursor: null,
      autoReply: [
        { channel: 'telegram', cursor: null },
        { channel: 'linq', cursor: null },
        { channel: 'unknown-channel', cursor: null },
      ],
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  await mkdir(path.dirname(inboxConfigPath), { recursive: true })
  await writeFile(
    inboxConfigPath,
    JSON.stringify({
      schema: 'murph.inbox-runtime-config.v1',
      schemaVersion: 1,
      value: {
        connectors: [
          {
            id: 'email:primary',
            source: 'email',
            enabled: true,
            accountId: 'primary',
            options: {},
          },
        ],
      },
    }),
    'utf8',
  )

  await rm(automationPath, { force: true })

  assert.deepEqual(
    await resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    ['email'],
  )

  await writeFile(automationPath, '{not json', 'utf8')

  await assert.rejects(
    resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    /Expected property name|JSON/u,
  )

  await rm(automationPath, { force: true })
  await writeFile(
    inboxConfigPath,
    JSON.stringify({
      connectors: [
        {
          id: 'email:primary',
          source: 'email',
          enabled: true,
          accountId: 'primary',
          options: {},
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    /schema|schemaVersion|value/u,
  )

  await writeFile(inboxConfigPath, '{not json', 'utf8')

  await assert.rejects(
    resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
    /Expected property name|JSON/u,
  )
})
