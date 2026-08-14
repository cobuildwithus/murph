import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Cli, z } from 'incur'
import { assistantAutomationStateSchema } from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeVaultForConfig,
  readOperatorConfig,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  saveDefaultVaultConfig,
} from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  LOCAL_SETUP_CODEX_PROVIDER_CONFIGS,
} from '@murphai/operator-config/assistant/target-runtime'
import { resolveAssistantStatePaths } from '@murphai/assistant-engine/assistant-state'
import { showWearablePreferences } from '@murphai/vault-usecases'
import {
  normalizeSetupWearables,
  type SetupAssistantPreset,
  type SetupChannel,
  type SetupCommandOptions,
  type SetupConfiguredWearable,
  type SetupResult,
  type SetupVaultSelectionResult,
  type SetupWearable,
  setupChannelValues,
  setupCommandOptionsSchema,
  setupVaultSelectionResultSchema,
  setupWearableValues,
  setupResultSchema,
} from '@murphai/operator-config/setup-cli-contracts'
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
  describeSetupAssistantModelProviderStatus,
  resolveSetupAssistantModelProviderEnvKeys,
  resolveSetupAssistantModelProviderMissingEnv,
  describeSetupChannelStatus,
  describeSetupWearableStatus,
  SETUP_RUNTIME_ENV_NOTICE,
  type SetupRuntimeEnvResolver,
  type SetupWizardRuntimeStatus,
} from '@murphai/operator-config/setup-runtime-env'
import {
  createSetupServices,
  detectSetupProgramName,
  isSetupInvocation,
} from './setup-services.js'
import {
  createSetupAssistantAccountResolver,
  detectCodexAccountFromAuthJson,
} from './setup-assistant-account.js'
import {
  buildSetupWizardPublicUrlHelpText,
  buildSetupWizardPublicUrlReview,
  createSetupWizardCompletionController,
  describeSetupWizardPublicUrlStrategyChoice,
  getDefaultSetupWizardChannels,
  getDefaultSetupWizardScheduledUpdates,
  inferSetupWizardAssistantProvider,
  resolveSetupWizardInitialScheduledUpdates,
  resolveSetupWizardAssistantSelection,
  runSetupWizard,
  type SetupWizardResult,
} from './setup-wizard.js'
import { configureSetupChannels } from './setup-services/channels.js'
import { configureSetupScheduledUpdates } from './setup-services/scheduled-updates.js'
import { redactHomePath } from './setup-services/shell.js'
import { incurErrorBridge } from './incur-error-bridge.js'

export {
  buildSetupWizardPublicUrlReview,
  configureSetupChannels,
  configureSetupScheduledUpdates,
  createSetupWizardCompletionController,
  createSetupAssistantAccountResolver,
  createSetupServices,
  detectCodexAccountFromAuthJson,
  describeSetupWizardPublicUrlStrategyChoice,
  getDefaultSetupWizardScheduledUpdates,
  inferSetupWizardAssistantProvider,
  resolveSetupWizardInitialScheduledUpdates,
  resolveSetupWizardAssistantSelection,
  type SetupWizardResult,
}

export interface SuccessfulSetupContext {
  agent: boolean
  format: 'toon' | 'json' | 'yaml' | 'md' | 'jsonl'
  formatExplicit: boolean
  result: SetupResult
}

export interface SetupWizardRunner {
  run(input: {
    assistantProviderStatuses?: Partial<Record<string, SetupWizardRuntimeStatus>>
    channelStatuses?: Partial<Record<SetupChannel, SetupWizardRuntimeStatus>>
    commandName: string
    deviceSyncLocalBaseUrl?: string | null
    enableApiKeyProviderOnboarding?: boolean
    initialAssistantModelProvider?: string | null
    initialAssistantOss?: boolean | null
    initialAssistantPreset?: SetupAssistantPreset
    initialChannels: readonly SetupChannel[]
    initialScheduledUpdates: readonly string[]
    initialWearables: readonly SetupWearable[]
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
    let selectedAssistantOss: boolean | undefined = context.options.assistantOss
    let selectedAssistantModelProvider: string | null | undefined =
      context.options.assistantModelProvider
    let envOverrides: NodeJS.ProcessEnv | undefined
    let provisioningEnvOverrides: NodeJS.ProcessEnv | undefined
    let assistantEnvOverrides: NodeJS.ProcessEnv | undefined

    if (interactiveWizard) {
      const currentEnv = runtimeEnv.getCurrentEnv()
      const wizardResult = await wizard.run({
        assistantProviderStatuses:
          buildSetupWizardAssistantProviderStatuses(currentEnv),
        channelStatuses: buildSetupWizardChannelStatuses(currentEnv, getPlatform()),
        commandName,
        deviceSyncLocalBaseUrl:
          resolveSetupWizardDeviceSyncLocalBaseUrl(currentEnv),
        enableApiKeyProviderOnboarding: true,
        initialAssistantModelProvider:
          context.options.assistantModelProvider ?? null,
        initialAssistantOss: context.options.assistantOss ?? null,
        initialAssistantPreset:
          inferSetupAssistantPresetFromOptions(context.options) ??
          getDefaultSetupAssistantPreset(),
        initialChannels: await resolveInitialSetupWizardChannels(
          context.options.vault,
          getPlatform(),
        ),
        initialScheduledUpdates: await resolveInitialSetupWizardScheduledUpdates(
          context.options.vault,
        ),
        initialWearables: await resolveInitialSetupWizardWearables(
          context.options.vault,
        ),
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
      if ('assistantOss' in wizardResult) {
        selectedAssistantOss = wizardResult.assistantOss ?? undefined
      }
      if ('assistantModelProvider' in wizardResult) {
        selectedAssistantModelProvider = wizardResult.assistantModelProvider ?? null
      }
    } else if (hasExplicitSetupAssistantOptions(context.options)) {
      selectedAssistantPreset = inferSetupAssistantPresetFromOptions(context.options)
    }

    const resolvedAssistantOptions = {
      ...context.options,
      assistantModelProvider: selectedAssistantModelProvider ?? undefined,
      assistantOss: selectedAssistantOss,
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

    if (!interactiveWizard && selectedAssistant?.modelProvider) {
      const missingProviderEnv = resolveSetupAssistantModelProviderMissingEnv(
        selectedAssistant.modelProvider,
        runtimeEnv.getCurrentEnv(),
      )
      if (missingProviderEnv.length > 0) {
        throw new VaultCliError(
          'SETUP_ASSISTANT_PROVIDER_ENV_MISSING',
          `${missingProviderEnv.join(', ')} must be set in the environment when --assistant-model-provider ${selectedAssistant.modelProvider} is selected.`,
        )
      }
    }

    if (interactiveWizard) {
      const currentEnv = runtimeEnv.getCurrentEnv()
      const publicUrlHelpText = buildSetupWizardPublicUrlHelpText({
        review: buildSetupWizardPublicUrlReview({
          channels: selectedChannels ?? [],
          wearables: selectedWearables ?? [],
          publicBaseUrl: resolveSetupWizardPublicBaseUrl(currentEnv),
          deviceSyncLocalBaseUrl:
            resolveSetupWizardDeviceSyncLocalBaseUrl(currentEnv),
        }),
      })
      envOverrides = await runtimeEnv.promptForMissing({
        assistantModelProvider: selectedAssistant?.modelProvider ?? null,
        channels: selectedChannels ?? [],
        env: currentEnv,
        helpText: publicUrlHelpText,
        wearables: selectedWearables ?? [],
      })
      const splitEnvOverrides = splitSetupAssistantProviderEnvOverrides({
        assistantModelProvider: selectedAssistant?.modelProvider ?? null,
        envOverrides,
      })
      provisioningEnvOverrides = splitEnvOverrides.provisioningEnvOverrides
      assistantEnvOverrides = splitEnvOverrides.assistantEnvOverrides
      applySetupRuntimeEnvOverridesToProcess(provisioningEnvOverrides)
    }

    const setupHost =
      'setupHost' in services && typeof services.setupHost === 'function'
        ? services.setupHost.bind(services)
        : services.setupMacos.bind(services)

    const result = await setupHost({
      assistant: selectedAssistant,
      channels: selectedChannels,
      dryRun: context.options.dryRun,
      envOverrides: provisioningEnvOverrides,
      localEnvOverrides: envOverrides,
      rebuild: context.options.rebuild,
      requestId: context.options.requestId ?? null,
      strict: context.options.strict,
      scheduledUpdatePresetIds: selectedScheduledUpdates,
      toolchainRoot: context.options.toolchainRoot,
      vault: context.options.vault,
      wearables: selectedWearables,
      whisperModel: context.options.whisperModel,
    })
    applySetupRuntimeEnvOverridesToProcess(assistantEnvOverrides)

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

  cli.command('use', {
    args: z.object({
      vault: z
        .string()
        .min(1)
        .describe('Existing Murph vault path to make active for future `murph` commands.'),
    }),
    description:
      'Set the active Murph vault for future `murph` commands without rerunning onboarding.',
    examples: [
      {
        description: 'Select an existing local vault as the active Murph vault.',
        args: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `murph onboard --vault <path>` when the vault does not exist yet. `murph use` only selects an existing vault.',
    options: z.object({}),
    output: setupVaultSelectionResultSchema,
    async run(context): Promise<SetupVaultSelectionResult> {
      return await selectActiveMurphVault(context.args.vault)
    },
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
  switch (wearable) {
    case 'garmin':
      return 'Garmin'
    case 'oura':
      return 'Oura'
    case 'strava':
      return 'Strava'
    case 'whoop':
      return 'WHOOP'
  }
}

export async function resolveInitialSetupWizardChannels(
  vault: string,
  platform: NodeJS.Platform = process.platform,
): Promise<SetupChannel[]> {
  const state = await readInitialSetupWizardAutomationState(vault)

  if (state !== null) {
    return setupChannelValues.filter((channel) =>
      state.autoReply.some((entry) => entry.channel === channel),
    )
  }

  return getDefaultSetupWizardChannels(platform)
}

export async function resolveInitialSetupWizardScheduledUpdates(
  _vault: string,
): Promise<string[]> {
  return getDefaultSetupWizardScheduledUpdates()
}

export async function resolveInitialSetupWizardWearables(
  vault: string,
): Promise<SetupWearable[]> {
  const preferences = await showWearablePreferences(vault)

  return normalizeSetupWearables(
    preferences.wearablePreferences?.desiredProviders,
  )
}

async function readInitialSetupWizardAutomationState(vault: string) {
  const automationPath = resolveAssistantStatePaths(vault).automationStatePath

  try {
    const raw = await readFile(automationPath, 'utf8')
    return assistantAutomationStateSchema.parse(JSON.parse(raw))
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
        'Start the assistant automation loop so configured Telegram channels can receive automatic replies.',
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
      command: 'automation list',
      description:
        'Inspect the canonical automations you already created and confirm their schedules and routes.',
    })
  }

  commands.push(
    {
      command: 'assistant chat',
      description: 'Open the local assistant chat against the default vault.',
    },
  )

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
    command: 'automation scaffold',
    description:
      'Start a canonical automation payload when you are ready to add scheduled summaries or other assistant automations.',
  })

  return commands
}

function collectSetupMissingEnvKeys(result: SetupResult): string[] {
  const keys = new Set<string>()

  for (const key of result.assistant?.missingEnv ?? []) {
    keys.add(key)
  }

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

function buildSetupWizardAssistantProviderStatuses(
  env: NodeJS.ProcessEnv,
): Partial<Record<string, SetupWizardRuntimeStatus>> {
  return Object.fromEntries(
    LOCAL_SETUP_CODEX_PROVIDER_CONFIGS.map((config) => [
      config.providerId,
      describeSetupAssistantModelProviderStatus(config.providerId, env),
    ]),
  )
}

function buildSetupWizardWearableStatuses(
  env: NodeJS.ProcessEnv,
): Partial<Record<SetupWearable, SetupWizardRuntimeStatus>> {
  return Object.fromEntries(
    setupWearableValues.map((wearable) => [wearable, describeSetupWearableStatus(wearable, env)]),
  ) as Partial<Record<SetupWearable, SetupWizardRuntimeStatus>>
}

function splitSetupAssistantProviderEnvOverrides(input: {
  assistantModelProvider?: string | null
  envOverrides?: NodeJS.ProcessEnv
}): {
  assistantEnvOverrides: NodeJS.ProcessEnv | undefined
  provisioningEnvOverrides: NodeJS.ProcessEnv | undefined
} {
  const assistantEnvKeys = new Set(
    resolveSetupAssistantModelProviderEnvKeys(input.assistantModelProvider),
  )
  if (!input.envOverrides || assistantEnvKeys.size === 0) {
    return {
      assistantEnvOverrides: undefined,
      provisioningEnvOverrides: input.envOverrides,
    }
  }

  const assistantEnvOverrides: NodeJS.ProcessEnv = {}
  const provisioningEnvOverrides: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(input.envOverrides)) {
    if (assistantEnvKeys.has(key)) {
      assistantEnvOverrides[key] = value
    } else {
      provisioningEnvOverrides[key] = value
    }
  }

  return {
    assistantEnvOverrides:
      Object.keys(assistantEnvOverrides).length > 0
        ? assistantEnvOverrides
        : undefined,
    provisioningEnvOverrides:
      Object.keys(provisioningEnvOverrides).length > 0
        ? provisioningEnvOverrides
        : undefined,
  }
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
          'Save a local Codex OSS assistant during setup without using the interactive wizard.',
        options: {
          assistantPreset: 'codex',
          assistantOss: true,
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

async function selectActiveMurphVault(
  candidateVault: string,
  input?: {
    cwd?: string
    homeDirectory?: string
  },
): Promise<SetupVaultSelectionResult> {
  const cwd = input?.cwd ?? process.cwd()
  const homeDirectory = input?.homeDirectory ?? resolveOperatorHomeDirectory()
  const absoluteVault = path.resolve(cwd, candidateVault)
  const vaultMetadataPath = path.join(absoluteVault, 'vault.json')

  try {
    const metadataStats = await stat(vaultMetadataPath)
    if (!metadataStats.isFile()) {
      throw new VaultCliError(
        'invalid_option',
        'Murph can only switch to an existing vault. Run `murph onboard --vault <path>` to create one first.',
      )
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      throw new VaultCliError(
        'invalid_option',
        'Murph can only switch to an existing vault. Run `murph onboard --vault <path>` to create one first.',
      )
    }

    throw error
  }

  const existingConfig = await readOperatorConfig(homeDirectory)
  const normalizedVault = normalizeVaultForConfig(absoluteVault, homeDirectory)
  const status =
    existingConfig?.defaultVault === normalizedVault ? 'reused' : 'completed'

  if (status === 'completed') {
    await saveDefaultVaultConfig(absoluteVault, homeDirectory)
  }

  return {
    configPath: redactHomePath(resolveOperatorConfigPath(homeDirectory), homeDirectory),
    status,
    vault: redactHomePath(absoluteVault, homeDirectory),
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export { detectSetupProgramName, isSetupInvocation }
export type { SetupCommandOptions }
