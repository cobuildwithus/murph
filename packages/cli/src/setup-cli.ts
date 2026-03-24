import { readFile } from 'node:fs/promises'
import { Cli, z } from 'incur'
import { assistantAutomationStateSchema } from './assistant-cli-contracts.js'
import { resolveAssistantStatePaths } from './assistant/store/paths.js'
import {
  type SetupAssistantPreset,
  type SetupChannel,
  type SetupCommandOptions,
  type SetupConfiguredWearable,
  type SetupResult,
  type SetupWearable,
  setupChannelValues,
  setupCommandOptionsSchema,
  setupResultSchema,
  setupWearableValues,
} from './setup-cli-contracts.js'
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
} from './setup-runtime-env.js'
import {
  createSetupServices,
  detectSetupProgramName,
  isSetupInvocation,
} from './setup-services.js'
import {
  getDefaultSetupWizardChannels,
  getDefaultSetupWizardWearables,
  runSetupWizard,
  type SetupWizardResult,
} from './setup-wizard.js'

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
    initialAssistantPreset?: SetupAssistantPreset
    initialChannels: readonly SetupChannel[]
    initialWearables: readonly SetupWearable[]
    vault: string
    wearableStatuses?: Partial<Record<SetupWearable, SetupWizardRuntimeStatus>>
  }): Promise<SetupWizardResult>
}

export interface SetupCliOptions {
  assistantSetup?: SetupAssistantResolver
  commandName?: string
  onSetupSuccess?: ((context: SuccessfulSetupContext) => void | Promise<void>) | undefined
  runtimeEnv?: SetupRuntimeEnvResolver
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
  const cli = Cli.create(commandName, {
    description: 'Healthy Bob local machine setup helpers.',
  })

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
    let selectedWearables: SetupWearable[] | null = null
    let selectedAssistantPreset: SetupAssistantPreset | null = null
    let envOverrides: NodeJS.ProcessEnv | undefined

    if (interactiveWizard) {
      const currentEnv = runtimeEnv.getCurrentEnv()
      const wizardResult = await wizard.run({
        channelStatuses: buildSetupWizardChannelStatuses(currentEnv),
        commandName,
        initialAssistantPreset:
          context.options.assistantPreset ?? getDefaultSetupAssistantPreset(),
        initialChannels: await resolveInitialSetupWizardChannels(
          context.options.vault,
        ),
        initialWearables: getDefaultSetupWizardWearables(),
        vault: context.options.vault,
        wearableStatuses: buildSetupWizardWearableStatuses(currentEnv),
      })

      selectedChannels = wizardResult.channels
      selectedWearables = wizardResult.wearables
      selectedAssistantPreset =
        wizardResult.assistantPreset ??
        context.options.assistantPreset ??
        null

      envOverrides = await runtimeEnv.promptForMissing({
        channels: selectedChannels,
        env: currentEnv,
        wearables: selectedWearables,
      })
      applySetupRuntimeEnvOverridesToProcess(envOverrides)
    } else if (hasExplicitSetupAssistantOptions(context.options)) {
      selectedAssistantPreset = inferSetupAssistantPresetFromOptions(context.options)
    }

    const selectedAssistant =
      selectedAssistantPreset === null
        ? null
        : await assistantSetup.resolve({
            allowPrompt: interactiveWizard,
            commandName,
            options: context.options,
            preset: selectedAssistantPreset,
          })

    const result = await services.setupMacos({
      assistant: selectedAssistant,
      allowChannelPrompts: interactiveWizard,
      channels: selectedChannels,
      dryRun: context.options.dryRun,
      envOverrides,
      rebuild: context.options.rebuild,
      requestId: context.options.requestId ?? null,
      skipOcr: context.options.skipOcr,
      strict: context.options.strict,
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

  registerSetupCommand(cli, 'setup', {
    description:
      'Provision the macOS parser/runtime toolchain, initialize the vault, and run inbox bootstrap in one command.',
    run: runSetupCommand,
  })
  registerSetupCommand(cli, 'onboard', {
    description:
      'Alias for setup that opens the interactive onboarding flow before provisioning the local toolchain and vault runtime.',
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
): Promise<SetupChannel[]> {
  const automationPath = resolveAssistantStatePaths(vault).automationPath

  try {
    const raw = await readFile(automationPath, 'utf8')
    const state = assistantAutomationStateSchema.parse(JSON.parse(raw) as unknown)
    const preferredChannels = setupChannelValues.filter((channel) =>
      state.preferredChannels.includes(channel),
    )
    const savedChannels =
      preferredChannels.length > 0
        ? preferredChannels
        : setupChannelValues.filter((channel) => state.autoReplyChannels.includes(channel))
    return savedChannels.length > 0
      ? savedChannels
      : getDefaultSetupWizardChannels()
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return getDefaultSetupWizardChannels()
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
        'Start the assistant automation loop so configured channels like iMessage, Telegram, or email can receive automatic replies.',
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

  if (!result.channels.some((channel) => channel.channel === 'imessage' && channel.configured)) {
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

  if (!result.channels.some((channel) => channel.channel === 'email' && channel.configured)) {
    commands.push({
      command: 'inbox source add email --id email:agentmail --provision --emailDisplayName "Healthy Bob"',
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
): Partial<Record<SetupChannel, SetupWizardRuntimeStatus>> {
  return Object.fromEntries(
    setupChannelValues.map((channel) => [channel, describeSetupChannelStatus(channel, env)]),
  ) as Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
}

function buildSetupWizardWearableStatuses(
  env: NodeJS.ProcessEnv,
): Partial<Record<SetupWearable, SetupWizardRuntimeStatus>> {
  return Object.fromEntries(
    setupWearableValues.map((wearable) => [wearable, describeSetupWearableStatus(wearable, env)]),
  ) as Partial<Record<SetupWearable, SetupWizardRuntimeStatus>>
}

function registerSetupCommand(
  cli: Cli.Cli,
  name: 'onboard' | 'setup',
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
        description: 'Skip OCR and choose a different Whisper model.',
        options: {
          skipOcr: true,
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
      'Use the repo-local scripts/setup-macos.sh wrapper when the workspace itself still needs Node, pnpm, and a build before this command can run.',
    options: setupCommandOptionsSchema,
    output: setupResultSchema,
    async run(context) {
      return await input.run(context)
    },
  })
}

export { detectSetupProgramName, isSetupInvocation }
export type { SetupCommandOptions }
