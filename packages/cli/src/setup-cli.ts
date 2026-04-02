import { readFile } from 'node:fs/promises'
import { Cli, z } from 'incur'
import { listAssistantCronPresets } from '@murphai/assistant-core/assistant-cron'
import { assistantAutomationStateSchema } from '@murphai/assistant-core/assistant-cli-contracts'
import { resolveAssistantStatePaths } from '@murphai/assistant-core/assistant-state'
import {
  type SetupAssistantPreset,
  type SetupAssistantProviderPreset,
  type SetupChannel,
  type SetupCommandOptions,
  type SetupConfiguredWearable,
  type SetupResult,
  type SetupWearable,
  setupChannelValues,
  setupCommandOptionsSchema,
  setupResultSchema,
  setupWearableValues,
} from '@murphai/assistant-core/setup-cli-contracts'
import {
  createSetupAssistantResolver,
  getDefaultSetupAssistantPreset,
  hasExplicitSetupAssistantOptions,
  inferSetupAssistantPresetFromOptions,
  type SetupAssistantResolver,
} from './setup-assistant.js'
import {
  applySetupRuntimeEnvOverridesToProcess,
  createSetupRuntimeEnvResolver,
  describeSetupChannelStatus,
  describeSetupWearableStatus,
  SETUP_RUNTIME_ENV_NOTICE,
  type SetupRuntimeEnvResolver,
  type SetupWizardRuntimeStatus,
} from '@murphai/assistant-core/setup-runtime-env'
import {
  createSetupServices,
  detectSetupProgramName,
  isSetupInvocation,
} from './setup-services.js'
import {
  getDefaultSetupWizardChannels,
  getDefaultSetupWizardScheduledUpdates,
  getDefaultSetupWizardWearables,
  runSetupWizard,
  type SetupWizardResult,
} from './setup-wizard.js'
import { incurErrorBridge } from './incur-error-bridge.js'

export interface SuccessfulSetupContext {
  agent: boolean
  format: 'toon' | 'json' | 'yaml' | 'md' | 'jsonl'
  formatExplicit: boolean
  result: SetupResult
}

export interface SetupWizardRunner {
  run(input: {
    channelStatuses?: Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
    commandName: string
    deviceSyncLocalBaseUrl?: string | null
    initialAssistantApiKeyEnv?: string | null
    initialAssistantBaseUrl?: string | null
    initialAssistantOss?: boolean | null
    initialAssistantPreset?: SetupAssistantPreset
    initialAssistantProviderPreset?: SetupAssistantProviderPreset | null
    initialAssistantProviderName?: string | null
    initialChannels: readonly SetupChannel[]
    initialScheduledUpdates: readonly string[]
    initialWearables: readonly SetupWearable[]
    linqLocalWebhookUrl?: string | null
    platform?: NodeJS.Platform
    publicBaseUrl?: string | null
    vault: string
    wearableStatuses?: Partial<Record<SetupWearable, SetupWizardRuntimeStatus>>
  }): Promise<SetupWizardResult>
}

export interface SetupCliOptions {
  assistantSetup?: SetupAssistantResolver
  commandName?: string
  onSetupSuccess?: ((context: SuccessfulSetupContext) => void | Promise<void>) | undefined
  runtimeEnv?: SetupRuntimeEnvResolver
  platform?: () => NodeJS.Platform
  services?: ReturnType<typeof createSetupServices>
  terminal?: {
    stderrIsTTY: boolean
    stdinIsTTY: boolean
  }
  wizard?: SetupWizardRunner
}

export type SetupPostLaunchAction = 'assistant-chat' | 'assistant-run' | null

export function createSetupCli(options: SetupCliOptions = {}): Cli.Cli {
  const commandName = options.commandName ?? 'vault-cli'
  const services = options.services ?? createSetupServices()
  const assistantSetup =
    options.assistantSetup ?? createSetupAssistantResolver()
  const runtimeEnv = options.runtimeEnv ?? createSetupRuntimeEnvResolver()
  const terminal =
    options.terminal ??
    ({
      stderrIsTTY: Boolean(process.stderr.isTTY),
      stdinIsTTY: Boolean(process.stdin.isTTY),
    } as const)
  const wizard = options.wizard ?? {
    run: runSetupWizard,
  }
  const getPlatform = options.platform ?? (() => process.platform)
  const cli = Cli.create(commandName, {
    description: 'Murph local machine onboarding helpers.',
  })
  cli.use(incurErrorBridge)

  const runSetupCommand = async (context: any) => {
    const interactiveWizard = shouldRunSetupWizard(
      {
        agent: context.agent,
        dryRun: context.options.dryRun,
        format: context.format,
      },
      terminal,
    )

    let selectedChannels: SetupChannel[] | null = null
    let selectedScheduledUpdates: string[] | null = null
    let selectedWearables: SetupWearable[] | null = null
    let selectedAssistantPreset: SetupAssistantPreset | null = null
    let selectedAssistantProviderPreset: SetupAssistantProviderPreset | null | undefined =
      context.options.assistantProviderPreset
    let selectedAssistantBaseUrl: string | null | undefined =
      context.options.assistantBaseUrl
    let selectedAssistantApiKeyEnv: string | null | undefined =
      context.options.assistantApiKeyEnv
    let selectedAssistantOss: boolean | undefined = context.options.assistantOss
    let selectedAssistantProviderName: string | null | undefined =
      context.options.assistantProviderName
    let envOverrides: NodeJS.ProcessEnv | undefined

    if (interactiveWizard) {
      const currentEnv = runtimeEnv.getCurrentEnv()
      const wizardResult = await wizard.run({
        channelStatuses: buildSetupWizardChannelStatuses(currentEnv, getPlatform()),
        commandName,
        deviceSyncLocalBaseUrl:
          resolveSetupWizardDeviceSyncLocalBaseUrl(currentEnv),
        initialAssistantApiKeyEnv: context.options.assistantApiKeyEnv,
        initialAssistantBaseUrl: context.options.assistantBaseUrl,
        initialAssistantOss: context.options.assistantOss ?? null,
        initialAssistantPreset:
          inferSetupAssistantPresetFromOptions(context.options) ??
          getDefaultSetupAssistantPreset(),
        initialAssistantProviderPreset:
          context.options.assistantProviderPreset ?? null,
        initialAssistantProviderName: context.options.assistantProviderName,
        initialChannels: await resolveInitialSetupWizardChannels(
          context.options.vault,
          getPlatform(),
        ),
        initialScheduledUpdates: await resolveInitialSetupWizardScheduledUpdates(
          context.options.vault,
        ),
        initialWearables: getDefaultSetupWizardWearables(),
        linqLocalWebhookUrl: resolveSetupWizardLinqLocalWebhookUrl(),
        platform: getPlatform(),
        publicBaseUrl: resolveSetupWizardPublicBaseUrl(currentEnv),
        vault: context.options.vault,
        wearableStatuses: buildSetupWizardWearableStatuses(currentEnv),
      })

      selectedChannels = wizardResult.channels
      selectedScheduledUpdates = wizardResult.scheduledUpdates
      selectedWearables = wizardResult.wearables
      selectedAssistantPreset =
        wizardResult.assistantPreset ??
        context.options.assistantPreset ??
        null
      if ('assistantBaseUrl' in wizardResult) {
        selectedAssistantBaseUrl = wizardResult.assistantBaseUrl
      }
      if ('assistantApiKeyEnv' in wizardResult) {
        selectedAssistantApiKeyEnv = wizardResult.assistantApiKeyEnv
      }
      if ('assistantOss' in wizardResult) {
        selectedAssistantOss = wizardResult.assistantOss ?? false
      }
      if ('assistantProviderName' in wizardResult) {
        selectedAssistantProviderName = wizardResult.assistantProviderName
      }

      selectedAssistantProviderPreset = undefined
      envOverrides = await runtimeEnv.promptForMissing({
        assistantApiKeyEnv: selectedAssistantApiKeyEnv,
        channels: selectedChannels,
        env: currentEnv,
        wearables: selectedWearables,
      })
      applySetupRuntimeEnvOverridesToProcess(envOverrides)
    } else if (hasExplicitSetupAssistantOptions(context.options)) {
      selectedAssistantPreset = inferSetupAssistantPresetFromOptions(context.options)
    }

    const resolvedAssistantOptions = {
      ...context.options,
      assistantProviderPreset: selectedAssistantProviderPreset,
      assistantApiKeyEnv: selectedAssistantApiKeyEnv,
      assistantBaseUrl: selectedAssistantBaseUrl,
      assistantOss: selectedAssistantOss,
      assistantProviderName: selectedAssistantProviderName,
    }

    const selectedAssistant =
      selectedAssistantPreset === null
        ? null
        : await assistantSetup.resolve({
            allowPrompt: interactiveWizard,
            commandName,
            options: resolvedAssistantOptions,
            preset: selectedAssistantPreset,
          })

    const setupHost =
      'setupHost' in services && typeof services.setupHost === 'function'
        ? services.setupHost.bind(services)
        : services.setupMacos.bind(services)

    const result = await setupHost({
      assistant: selectedAssistant,
      allowChannelPrompts: interactiveWizard,
      channels: selectedChannels,
      dryRun: context.options.dryRun,
      envOverrides,
      rebuild: context.options.rebuild,
      requestId: context.options.requestId ?? null,
      strict: context.options.strict,
      scheduledUpdatePresetIds: selectedScheduledUpdates,
      toolchainRoot: context.options.toolchainRoot,
      vault: context.options.vault,
      wearables: selectedWearables,
      whisperModel: context.options.whisperModel,
    })

    if (result.dryRun) {
      return context.ok(result)
    }
    await options.onSetupSuccess?.({
      agent: context.agent,
      format: context.format,
      formatExplicit: context.formatExplicit,
      result,
    })

    return context.ok(result, {
      cta: {
        description: 'Suggested next commands:',
        commands: buildSetupCtaCommands(result),
      },
    })
  }

  registerSetupCommand(cli, 'onboard', {
    description:
      'Provision the local parser/runtime toolchain for macOS or Linux, initialize the vault, and open the interactive onboarding flow when the terminal supports it.',
    run: runSetupCommand,
  })

  return cli
}

export function shouldRunSetupWizard(
  context: {
    agent: boolean
    dryRun?: boolean
    format: 'toon' | 'json' | 'yaml' | 'md' | 'jsonl'
  },
  terminal = {
    stderrIsTTY: Boolean(process.stderr.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
  },
): boolean {
  if (context.dryRun || context.format !== 'toon') {
    return false
  }

  return Boolean(terminal.stdinIsTTY && terminal.stderrIsTTY)
}

export function resolveSetupPostLaunchAction(
  context: SuccessfulSetupContext,
  terminal = {
    stderrIsTTY: Boolean(process.stderr.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
  },
): SetupPostLaunchAction {
  if (context.result.dryRun || context.agent || context.format !== 'toon') {
    return null
  }

  if (!(terminal.stdinIsTTY && terminal.stderrIsTTY)) {
    return null
  }

  return context.result.channels.some(
    (channel) => channel.autoReply && channel.configured,
  )
    ? 'assistant-run'
    : 'assistant-chat'
}

export function shouldAutoLaunchAssistantAfterSetup(
  context: SuccessfulSetupContext,
  terminal = {
    stderrIsTTY: Boolean(process.stderr.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
  },
): boolean {
  return resolveSetupPostLaunchAction(context, terminal) !== null
}

export function listSetupReadyWearables(result: SetupResult): SetupWearable[] {
  return result.wearables
    .filter((wearable) => wearable.enabled && wearable.ready)
    .map((wearable) => wearable.wearable)
}

export function listSetupPendingWearables(
  result: SetupResult,
): SetupConfiguredWearable[] {
  return result.wearables.filter(
    (wearable) => wearable.enabled && (!wearable.ready || wearable.missingEnv.length > 0),
  )
}

export function formatSetupWearableLabel(wearable: SetupWearable): string {
  return wearable === 'oura' ? 'Oura' : 'WHOOP'
}

export async function resolveInitialSetupWizardChannels(
  vault: string,
  platform: NodeJS.Platform = process.platform,
): Promise<SetupChannel[]> {
  const state = await readInitialSetupWizardAutomationState(vault)

  if (state === null) {
    return getDefaultSetupWizardChannels(platform)
  }

  const preferredChannels = setupChannelValues.filter((channel) =>
    state.preferredChannels.includes(channel),
  )
  const savedChannels =
    preferredChannels.length > 0
      ? preferredChannels
      : setupChannelValues.filter((channel) => state.autoReplyChannels.includes(channel))
  return savedChannels.length > 0
    ? savedChannels
    : getDefaultSetupWizardChannels(platform)
}

export async function resolveInitialSetupWizardScheduledUpdates(
  vault: string,
): Promise<string[]> {
  const state = await readInitialSetupWizardAutomationState(vault)

  if (state?.preferredScheduledUpdates === undefined) {
    return getDefaultSetupWizardScheduledUpdates()
  }

  if (state.preferredScheduledUpdates.length === 0) {
    return []
  }

  const available = new Set(
    listAssistantCronPresets().map((preset) => preset.id),
  )

  const savedScheduledUpdates = state.preferredScheduledUpdates.filter((presetId) =>
    available.has(presetId),
  )

  return savedScheduledUpdates.length > 0
    ? savedScheduledUpdates
    : getDefaultSetupWizardScheduledUpdates()
}

async function readInitialSetupWizardAutomationState(vault: string) {
  const automationPath = resolveAssistantStatePaths(vault).automationPath

  try {
    const raw = await readFile(automationPath, 'utf8')
    return assistantAutomationStateSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }

    throw error
  }
}

function buildSetupCtaCommands(result: SetupResult): Array<{
  command: string
  description: string
}> {
  const commands: Array<{
    command: string
    description: string
  }> = []

  if (result.channels.some((channel) => channel.autoReply && channel.configured)) {
    commands.push({
      command: 'assistant run',
      description:
        'Start the assistant automation loop so configured channels like iMessage, Telegram, Linq, or email can receive automatic replies.',
    })
  }

  if (
    result.scheduledUpdates.some(
      (scheduledUpdate) =>
        scheduledUpdate.status === 'completed' ||
        scheduledUpdate.status === 'reused',
    )
  ) {
    commands.push({
      command: 'assistant cron list',
      description:
        'Inspect the scheduled assistant jobs installed during onboarding and confirm their next run times.',
    })
  }

  commands.push(
    {
      command: 'assistant chat',
      description: 'Open the local assistant chat against the default vault.',
    },
    {
      command: 'inbox doctor',
      description: 'Verify the local runtime after setup.',
    },
  )

  if (
    result.platform === 'darwin' &&
    !result.channels.some((channel) => channel.channel === 'imessage' && channel.configured)
  ) {
    commands.push({
      command: 'inbox source add imessage --id imessage:self --account self --includeOwn',
      description:
        'Add a local iMessage connector when you are ready to ingest captures and deliver assistant replies.',
    })
  }

  if (!result.channels.some((channel) => channel.channel === 'telegram' && channel.configured)) {
    commands.push({
      command: 'inbox source add telegram --id telegram:bot --account bot',
      description:
        'Add the Telegram poll connector after setting TELEGRAM_BOT_TOKEN in the shell or local `.env`.',
    })
  }

  if (!result.channels.some((channel) => channel.channel === 'linq' && channel.configured)) {
    commands.push({
      command:
        'inbox source add linq --id linq:default --account default --linqWebhookPort 8789 --linqWebhookPath /linq-webhook',
      description:
        'Add the Linq webhook connector after setting LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET in the shell or local `.env`, then point Linq at the local listener or a tunnel that forwards to it.',
    })
  }

  if (!result.channels.some((channel) => channel.channel === 'email' && channel.configured)) {
    commands.push({
      command: 'inbox source add email --id email:agentmail --provision --emailDisplayName "Murph"',
      description:
        'Reuse an existing AgentMail inbox or provision a new one after setting AGENTMAIL_API_KEY in the shell or local `.env`. Use `--account <inbox_id>` when the API key is scoped to an existing inbox.',
    })
  }

  for (const wearable of listSetupReadyWearables(result)) {
    commands.push({
      command: `device connect ${wearable} --open`,
      description: `Open the ${formatSetupWearableLabel(wearable)} OAuth connect flow in your browser.`,
    })
  }

  for (const key of collectSetupMissingEnvKeys(result)) {
    commands.push({
      command: `export ${key}=...`,
      description: `Set this in the current environment before retrying the related setup step. ${SETUP_RUNTIME_ENV_NOTICE}`,
    })
  }

  commands.push({
    command: 'assistant cron preset list',
    description:
      'Browse built-in cron templates for environment checks, condition research, ingestible watchlists, longevity roundups, and weekly health compass summaries.',
  })

  return commands
}

function collectSetupMissingEnvKeys(result: SetupResult): string[] {
  const keys = new Set<string>()

  for (const channel of result.channels) {
    for (const key of channel.missingEnv) {
      keys.add(key)
    }
  }

  for (const wearable of result.wearables) {
    for (const key of wearable.missingEnv) {
      keys.add(key)
    }
  }

  return [...keys].sort()
}

function buildSetupWizardChannelStatuses(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Partial<Record<SetupChannel, SetupWizardRuntimeStatus>> {
  return Object.fromEntries(
    setupChannelValues.map((channel) => [
      channel,
      describeSetupChannelStatus(channel, env, platform),
    ]),
  ) as Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
}

function buildSetupWizardWearableStatuses(
  env: NodeJS.ProcessEnv,
): Partial<Record<SetupWearable, SetupWizardRuntimeStatus>> {
  return Object.fromEntries(
    setupWearableValues.map((wearable) => [wearable, describeSetupWearableStatus(wearable, env)]),
  ) as Partial<Record<SetupWearable, SetupWizardRuntimeStatus>>
}

function resolveSetupWizardPublicBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return readSetupEnvValue(env, ['DEVICE_SYNC_PUBLIC_BASE_URL'])
}

function resolveSetupWizardDeviceSyncLocalBaseUrl(
  env: NodeJS.ProcessEnv,
): string {
  return (
    readSetupEnvValue(env, ['DEVICE_SYNC_BASE_URL']) ??
    'http://localhost:8788'
  )
}

function resolveSetupWizardLinqLocalWebhookUrl(): string {
  return 'http://127.0.0.1:8789/linq-webhook'
}

function readSetupEnvValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) {
      return value
    }
  }

  return null
}

function registerSetupCommand(
  cli: Cli.Cli,
  name: 'onboard',
  input: {
    description: string
    run: (context: any) => Promise<any>
  },
): void {
  cli.command(name, {
    args: z.object({}),
    description: input.description,
    examples: [
      {
        description: 'Bootstrap a local vault with the default base.en Whisper model.',
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Preview the actions without mutating the machine or vault.',
        options: {
          dryRun: true,
          vault: './vault',
        },
      },
      {
        description: 'Choose a different Whisper model.',
        options: {
          vault: './vault',
          whisperModel: 'small.en',
        },
      },
      {
        description:
          'Save a local Ollama-compatible assistant during setup without using the interactive wizard.',
        options: {
          assistantPreset: 'openai-compatible',
          assistantBaseUrl: 'http://127.0.0.1:11434/v1',
          assistantModel: 'gpt-oss:20b',
          vault: './vault',
        },
      },
    ],
    hint:
      'Use the repo-local scripts/setup-host.sh wrapper when the workspace itself still needs Node, pnpm, and a build before this command can run.',
    options: setupCommandOptionsSchema,
    output: setupResultSchema,
    async run(context) {
      return await input.run(context)
    },
  })
}

export { detectSetupProgramName, isSetupInvocation }
export type { SetupCommandOptions }
