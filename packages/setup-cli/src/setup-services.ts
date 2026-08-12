import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/inbox-services'
import { enableAssistantAutoReplyChannelLocal } from '@murphai/assistant-engine/assistant-state'
import {
  createIntegratedVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveEffectiveTopLevelToken } from '@murphai/operator-config/command-helpers'
import {
  type SetupChannel,
  type SetupConfiguredAssistant,
  type SetupResult,
  type SetupScheduledUpdate,
  type SetupStepKind,
  type SetupStepResult,
  type SetupWearable,
  type WhisperModel,
} from '@murphai/operator-config/setup-cli-contracts'
import type { InboxBootstrapResult } from '@murphai/operator-config/inbox-cli-contracts'
import {
  configureSetupChannels,
  normalizeSetupChannels,
} from './setup-services/channels.js'
import { configureSetupScheduledUpdates } from './setup-services/scheduled-updates.js'
import { configureSetupWearables } from './setup-services/wearables.js'
import {
  createDefaultCommandRunner,
  defaultDownloadFile,
  defaultFileExists,
  defaultLogger,
  type CommandRunInput,
  type CommandRunResult,
} from './setup-services/process.js'
import {
  ensureCliShims,
  redactHomePath,
  redactHomePathInText,
  redactHomePathsInValue,
  redactNullableHomePath,
} from './setup-services/shell.js'
import {
  createStep,
  DEFAULT_TOOLCHAIN_DIRECTORY,
} from './setup-services/steps.js'
import { describeSelectedSetupWearables } from '@murphai/operator-config/setup-runtime-env'
import {
  resolveSetupAssistantModelProviderMissingEnv,
} from '@murphai/operator-config/setup-runtime-env'
import {
  ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  configureSetupOperatorDefaults,
} from './setup-services/operator-defaults.js'
import {
  provisionHostToolchain,
} from './setup-services/tool-provisioning.js'

const SETUP_TOOL_PROVISIONING_CREDENTIAL_ENV_KEYS = [
  'JUNCTION_API_KEY',
  'JUNCTION_CLIENT_USER_ID_SECRET',
  'OURA_CLIENT_ID',
  'OURA_CLIENT_SECRET',
  'STRAVA_CLIENT_ID',
  'STRAVA_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'WHOOP_CLIENT_ID',
  'WHOOP_CLIENT_SECRET',
] as const

interface SetupInput {
  vault: string
  assistant?: SetupConfiguredAssistant | null
  channels?: readonly SetupChannel[] | null
  envOverrides?: NodeJS.ProcessEnv
  localEnvOverrides?: NodeJS.ProcessEnv
  requestId?: string | null
  dryRun?: boolean
  rebuild?: boolean
  scheduledUpdatePresetIds?: readonly string[] | null
  strict?: boolean
  toolchainRoot?: string
  wearables?: readonly SetupWearable[] | null
  whisperModel?: WhisperModel
}

interface SetupServicesDependencies {
  arch?: () => string
  downloadFile?: (url: string, destinationPath: string) => Promise<void>
  env?: () => NodeJS.ProcessEnv
  fileExists?: (absolutePath: string) => Promise<boolean>
  getCwd?: () => string
  getHomeDirectory?: () => string
  log?: (message: string) => void
  platform?: () => NodeJS.Platform
  resolveCliBinPath?: () => string
  runCommand?: (input: CommandRunInput) => Promise<CommandRunResult>
  inboxServices?: Pick<InboxServices, 'bootstrap'> &
    Partial<
      Pick<
        InboxServices,
        'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'
      >
    >
  vaultServices?: Pick<VaultServices, 'core'>
}

interface SetupServices {
  setupHost(input: SetupInput): Promise<SetupResult>
  setupMacos(input: SetupInput): Promise<SetupResult>
}

export function createSetupServices(
  dependencies: SetupServicesDependencies = {},
): SetupServices {
  const getArch = dependencies.arch
  const getBaseEnv = dependencies.env
  const fileExists = dependencies.fileExists ?? defaultFileExists
  const getCwd = dependencies.getCwd
  const getHomeDirectory = dependencies.getHomeDirectory
  const getPlatform = dependencies.platform
  const log = dependencies.log ?? defaultLogger
  const resolveCliBinPath = dependencies.resolveCliBinPath
  const runCommand = dependencies.runCommand ?? createDefaultCommandRunner(log)
  const downloadFile = dependencies.downloadFile ?? defaultDownloadFile
  const vaultServices =
    dependencies.vaultServices ?? createIntegratedVaultServices()
  const inboxServices =
    dependencies.inboxServices ?? createIntegratedInboxServices({
      enableAssistantAutoReplyChannel: async (vault, channel) =>
        enableAssistantAutoReplyChannelLocal({
          channel,
          vault,
        }),
    })

  async function setupHost(input: SetupInput): Promise<SetupResult> {
    const platform = getPlatform?.() ?? process.platform
    if (platform !== 'darwin' && platform !== 'linux') {
      throw unsupportedSetupPlatform(platform)
    }

    const arch = getArch?.() ?? process.arch
    const dryRun = input.dryRun ?? false
    const strict = input.strict ?? true
    const vault = path.resolve(getCwd?.() ?? process.cwd(), input.vault)
    const requestId = input.requestId ?? null
    const whisperModel = input.whisperModel ?? 'base.en'
    const homeDirectory = path.resolve(getHomeDirectory?.() ?? os.homedir())
    const cliBinPath = resolveCliBinPath?.()
    if (typeof cliBinPath !== 'string' || cliBinPath.length === 0) {
      throw new VaultCliError(
        'setup_cli_binary_path_missing',
        'Setup could not resolve the published Murph CLI binary path. Invoke setup through the owning `@murphai/murph` CLI package or construct setup services with `resolveCliBinPath` explicitly.',
      )
    }
    const resolvedCliBinPath = path.resolve(cliBinPath)
    const defaultToolchainRoot = path.join(homeDirectory, DEFAULT_TOOLCHAIN_DIRECTORY)
    const toolchainRoot = path.resolve(
      getCwd?.() ?? process.cwd(),
      input.toolchainRoot ?? defaultToolchainRoot,
    )
    const notes: string[] = []
    const steps: SetupStepResult[] = []
    const rawEffectiveEnv = {
      ...(getBaseEnv?.() ?? { ...process.env }),
      ...(input.envOverrides ?? {}),
    }
    const effectiveEnv = scrubAssistantProviderEnv({
      env: rawEffectiveEnv,
    })
    const toolProvisioningEnv = scrubSetupToolProvisioningCredentialEnv({
      env: effectiveEnv,
    })
    const persistedEnv = {
      ...rawEffectiveEnv,
      ...(input.localEnvOverrides ?? input.envOverrides ?? {}),
    }

    log(
      `Murph setup targeting ${redactHomePathInText(vault, homeDirectory)} on ${describeSetupHost(platform)} (${arch}).`,
    )

    await ensureDirectoryStep({
      absolutePath: toolchainRoot,
      detailWhenCreated: `Created local toolchain root at ${toolchainRoot}.`,
      detailWhenExisting: `Reusing local toolchain root at ${toolchainRoot}.`,
      dryRun,
      fileExists,
      id: 'toolchain-root',
      kind: 'configure',
      steps,
      title: 'Local toolchain root',
    })

    const provisioning = await provisionHostToolchain({
      arch,
      downloadFile,
      dryRun,
      env: toolProvisioningEnv,
      fileExists,
      log,
      notes,
      platform,
      runCommand,
      steps,
      toolchainRoot,
      whisperModel,
    })
    const toolchainEnv = {
      ...effectiveEnv,
      ...provisioning.env,
    }
    const tools = provisioning.tools

    let bootstrap: InboxBootstrapResult | null = null
    const vaultMetadataPath = path.join(vault, 'vault.json')
    const hasExistingVault = await fileExists(vaultMetadataPath)

    if (dryRun) {
      steps.push(
        createStep({
          detail: hasExistingVault
            ? `Would reuse the existing vault at ${vault} and refresh its runtime state.`
            : `Would initialize a new vault at ${vault}.`,
          id: 'vault-init',
          kind: 'configure',
          status: hasExistingVault ? 'reused' : 'planned',
          title: 'Vault initialization',
        }),
      )
      steps.push(
        createStep({
          detail:
            'Would bootstrap the local message runtime and parser toolchain config.',
          id: 'inbox-bootstrap',
          kind: 'configure',
          status: 'planned',
          title: 'Inbox bootstrap',
        }),
      )
    } else {
      if (!hasExistingVault) {
        await vaultServices.core.init({
          requestId,
          vault,
        })
      }
      steps.push(
        createStep({
          detail: hasExistingVault
            ? `Reusing the existing vault at ${vault}.`
            : `Initialized a new vault scaffold at ${vault}.`,
          id: 'vault-init',
          kind: 'configure',
          status: hasExistingVault ? 'reused' : 'completed',
          title: 'Vault initialization',
        }),
      )

      bootstrap = await inboxServices.bootstrap({
        ffmpegCommand: tools.ffmpegCommand ?? undefined,
        rebuild: input.rebuild,
        requestId,
        strict,
        vault,
        whisperCommand: tools.whisperCommand ?? undefined,
        whisperModelPath: tools.whisperModelPath,
      })
      steps.push(
        createStep({
          detail:
            'Wrote parser toolchain config under .runtime/operations/parsers/toolchain.json and completed local runtime checks.',
          id: 'inbox-bootstrap',
          kind: 'configure',
          status: 'completed',
          title: 'Inbox bootstrap',
        }),
      )
    }

    await ensureCliShims({
      cliBinPath: resolvedCliBinPath,
      dryRun,
      env: toolchainEnv,
      fileExists,
      homeDirectory,
      notes,
      steps,
    })
    await persistSetupEnvOverrides({
      cwd: getCwd?.() ?? process.cwd(),
      dryRun,
      envOverrides: input.localEnvOverrides ?? input.envOverrides,
      steps,
    })
    const assistant = await configureSetupOperatorDefaults({
      assistant: input.assistant ?? null,
      dryRun,
      env: toolchainEnv,
      homeDirectory,
      notes,
      steps,
      vault,
    })

    const assistantWithReadiness = assistant
      ? {
          ...assistant,
          missingEnv: resolveSetupAssistantModelProviderMissingEnv(
            assistant.modelProvider,
            persistedEnv,
          ),
        }
      : null

    const channels =
      input.channels == null
        ? []
        : await configureSetupChannels({
            channels: normalizeSetupChannels(input.channels),
            dryRun,
            env: toolchainEnv,
            inboxServices,
            platform,
            requestId,
            steps,
            vault,
          })
    const wearables =
      input.wearables == null
        ? []
        : describeSelectedSetupWearables({
            env: toolchainEnv,
            wearables: input.wearables,
          })
    if (input.wearables != null) {
      await configureSetupWearables({
        dryRun,
        steps,
        vault,
        wearables: wearables.map((wearable) => wearable.wearable),
      })
    }
    const scheduledUpdates =
      input.scheduledUpdatePresetIds == null
        ? []
        : await configureSetupScheduledUpdates({
            dryRun,
            presetIds: input.scheduledUpdatePresetIds,
            steps,
            vault,
          })

    return {
      arch,
      bootstrap:
        bootstrap === null
          ? null
          : redactHomePathsInValue(bootstrap, homeDirectory),
      assistant:
        assistantWithReadiness === null
          ? null
          : redactSetupAssistantForOutput(assistantWithReadiness, homeDirectory),
      scheduledUpdates: scheduledUpdates.map((scheduledUpdate) =>
        redactHomePathsInValue(scheduledUpdate, homeDirectory),
      ) as SetupScheduledUpdate[],
      channels: channels.map((channel) => ({
        ...channel,
        connectorId: channel.connectorId,
        detail: redactHomePathInText(channel.detail, homeDirectory),
      })),
      wearables: wearables.map((wearable) => ({
        ...wearable,
        detail: redactHomePathInText(wearable.detail, homeDirectory),
      })),
      dryRun,
      notes: notes.map((note) => redactHomePathInText(note, homeDirectory)),
      platform,
      steps: steps.map((step) => ({
        ...step,
        detail: redactHomePathInText(step.detail, homeDirectory),
      })),
      toolchainRoot: redactHomePath(toolchainRoot, homeDirectory),
      tools: {
        ffmpegCommand: redactNullableHomePath(tools.ffmpegCommand, homeDirectory),
        whisperCommand: redactNullableHomePath(tools.whisperCommand, homeDirectory),
        whisperModelPath: redactHomePath(tools.whisperModelPath, homeDirectory),
      },
      vault: redactHomePath(vault, homeDirectory),
      whisperModel,
    }
  }

  async function setupMacos(input: SetupInput): Promise<SetupResult> {
    const platform = getPlatform?.() ?? process.platform
    if (platform !== 'darwin') {
      throw unsupportedSetupPlatform(platform, 'Murph setup currently supports macOS only through setupMacos(). Use setupHost() for Linux support.')
    }

    return await setupHost(input)
  }

  return {
    setupHost,
    setupMacos,
  }
}

function scrubAssistantProviderEnv(input: {
  env: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const next = { ...input.env }
  for (const config of ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS) {
    delete next[config.envKey]
  }
  return next
}

function scrubSetupToolProvisioningCredentialEnv(input: {
  env: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const next = { ...input.env }
  for (const key of SETUP_TOOL_PROVISIONING_CREDENTIAL_ENV_KEYS) {
    delete next[key]
  }
  return next
}

function redactSetupAssistantForOutput(
  assistant: SetupConfiguredAssistant,
  homeDirectory: string,
): SetupConfiguredAssistant {
  return {
    ...assistant,
    codexCommand: assistant.codexCommand ? '[path]' : assistant.codexCommand,
    codexHome: assistant.codexHome ? '[path]' : assistant.codexHome,
    detail: redactHomePathInText(assistant.detail, homeDirectory),
  }
}

function unsupportedSetupPlatform(
  platform: NodeJS.Platform,
  message = 'Murph setup currently supports macOS and Linux only.',
): VaultCliError {
  return new VaultCliError('unsupported_platform', message, {
    platform,
  })
}

function describeSetupHost(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'macOS' : platform
}

export function detectSetupProgramName(
  argv0: string | undefined,
  shimProgramName = process.env.SETUP_PROGRAM_NAME,
): string {
  const normalizedShimProgramName = shimProgramName?.trim().toLowerCase()
  if (normalizedShimProgramName === 'murph') {
    return 'murph'
  }

  const baseName = path.basename(argv0 ?? '').toLowerCase()
  return baseName === 'murph' ? 'murph' : 'vault-cli'
}

export function isSetupInvocation(
  args: string[],
  programName = 'vault-cli',
): boolean {
  const commandToken = resolveEffectiveTopLevelToken(args)
  if (commandToken === 'onboard') {
    return true
  }

  if (programName !== 'murph') {
    return false
  }

  if (commandToken === null && hasRootDiscoveryOrVersionFlag(args)) {
    return false
  }

  return commandToken === null || commandToken === 'help' || commandToken === 'use'
}

function hasRootDiscoveryOrVersionFlag(args: readonly string[]): boolean {
  for (const arg of args) {
    if (arg === '--') {
      return false
    }

    if (
      arg === '--help' ||
      arg === '-h' ||
      arg === '--llms' ||
      arg === '--llms-full' ||
      arg === '--mcp' ||
      arg === '--schema' ||
      arg === '--version'
    ) {
      return true
    }
  }

  return false
}

async function persistSetupEnvOverrides(input: {
  cwd: string
  dryRun: boolean
  envOverrides?: NodeJS.ProcessEnv
  steps: SetupStepResult[]
}): Promise<void> {
  const entries = Object.entries(input.envOverrides ?? {}).flatMap(
    ([rawKey, rawValue]) => {
      const key = rawKey.trim()
      const value = rawValue?.trim()
      return key && value && isDotenvKey(key) ? [[key, value] as const] : []
    },
  )

  if (entries.length === 0) {
    return
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail:
          'Would save entered setup keys to local .env.local so future Murph commands can read them.',
        id: 'local-env',
        kind: 'configure',
        status: 'planned',
        title: 'Local environment',
      }),
    )
    return
  }

  const envPath = path.join(input.cwd, '.env.local')
  await mkdir(input.cwd, { recursive: true })
  await assertSafeLocalEnvPath(envPath)
  const previous = await readOptionalTextFile(envPath)
  const next = mergeDotenvEntries(previous, entries)
  await writeTextFileNoFollow(envPath, next)
  input.steps.push(
    createStep({
      detail:
        'Saved entered setup keys to local .env.local so future Murph commands can read them.',
      id: 'local-env',
      kind: 'configure',
      status: previous === null ? 'completed' : 'reused',
      title: 'Local environment',
    }),
  )
}

async function assertSafeLocalEnvPath(filePath: string): Promise<void> {
  try {
    const existing = await lstat(filePath)
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new VaultCliError(
        'setup_local_env_unsafe_path',
        'Refusing to save setup keys because .env.local is not a regular file.',
      )
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
}

async function writeTextFileNoFollow(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await chmod(tempPath, 0o600)
    await rename(tempPath, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function mergeDotenvEntries(
  previous: string | null,
  entries: readonly (readonly [string, string])[],
): string {
  const pending = new Map(entries)
  const lines = previous?.split(/\r?\n/u) ?? []
  const merged = lines.map((line) => {
    const key = parseDotenvAssignmentKey(line)
    if (!key || !pending.has(key)) {
      return line
    }

    const value = pending.get(key)
    pending.delete(key)
    return `${key}=${formatDotenvValue(value ?? '')}`
  })

  if (pending.size > 0) {
    if (merged.length > 0 && merged[merged.length - 1] !== '') {
      merged.push('')
    }
    if (!merged.includes('# Added by Murph setup.')) {
      merged.push('# Added by Murph setup.')
    }
    for (const [key, value] of pending) {
      merged.push(`${key}=${formatDotenvValue(value)}`)
    }
  }

  return `${trimTrailingBlankLines(merged).join('\n')}\n`
}

function parseDotenvAssignmentKey(line: string): string | null {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)
  return match?.[1] ?? null
}

function formatDotenvValue(value: string): string {
  return JSON.stringify(value)
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines]
  while (next.length > 0 && next[next.length - 1] === '') {
    next.pop()
  }
  return next
}

function isDotenvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)
}

async function readOptionalTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function ensureDirectoryStep(input: {
  absolutePath: string
  detailWhenCreated: string
  detailWhenExisting: string
  dryRun: boolean
  fileExists: (absolutePath: string) => Promise<boolean>
  id: string
  kind: SetupStepKind
  steps: SetupStepResult[]
  title: string
}): Promise<void> {
  const exists = await input.fileExists(input.absolutePath)
  if (exists) {
    input.steps.push(
      createStep({
        detail: input.detailWhenExisting,
        id: input.id,
        kind: input.kind,
        status: 'reused',
        title: input.title,
      }),
    )
    return
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: input.detailWhenCreated,
        id: input.id,
        kind: input.kind,
        status: 'planned',
        title: input.title,
      }),
    )
    return
  }

  await mkdir(input.absolutePath, { recursive: true })
  input.steps.push(
    createStep({
      detail: input.detailWhenCreated,
      id: input.id,
      kind: input.kind,
      status: 'completed',
      title: input.title,
    }),
  )
}
