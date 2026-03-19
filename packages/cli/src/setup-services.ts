import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createIntegratedInboxCliServices,
  type InboxCliServices,
} from './inbox-services.js'
import {
  createIntegratedVaultCliServices,
  type VaultCliServices,
} from './vault-cli-services.js'
import { VaultCliError } from './vault-cli-errors.js'
import { resolveEffectiveTopLevelToken } from './command-helpers.js'
import {
  normalizeVaultForConfig,
  readOperatorConfig,
  saveDefaultVaultConfig,
} from './operator-config.js'
import {
  type SetupChannel,
  type SetupResult,
  type SetupStepKind,
  type SetupStepResult,
  type SetupTools,
  type WhisperModel,
} from './setup-cli-contracts.js'
import type { InboxBootstrapResult } from './inbox-cli-contracts.js'
import {
  configureSetupChannels,
  normalizeSetupChannels,
} from './setup-services/channels.js'
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
  buildBaseFormulaSpecs,
  buildPythonFormulaSpec,
  createStep,
  DEFAULT_TOOLCHAIN_DIRECTORY,
  modelFileNames,
  whisperModelDownloadUrl,
  type FormulaCommandKey,
} from './setup-services/steps.js'
import {
  ensureBrewFormula,
  ensureHomebrew,
  ensurePaddleXOcr,
  ensureWhisperModel,
} from './setup-services/toolchain.js'

interface SetupInput {
  vault: string
  channels?: readonly SetupChannel[] | null
  requestId?: string | null
  dryRun?: boolean
  rebuild?: boolean
  strict?: boolean
  toolchainRoot?: string
  whisperModel?: WhisperModel
  skipOcr?: boolean
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
  inboxServices?: Pick<InboxCliServices, 'bootstrap'> &
    Partial<Pick<InboxCliServices, 'doctor' | 'sourceAdd' | 'sourceList'>>
  vaultServices?: Pick<VaultCliServices, 'core'>
}

interface SetupServices {
  setupMacos(input: SetupInput): Promise<SetupResult>
}

export function createSetupServices(
  dependencies: SetupServicesDependencies = {},
): SetupServices {
  const getArch = dependencies.arch ?? (() => process.arch)
  const getBaseEnv = dependencies.env ?? (() => ({ ...process.env }))
  const fileExists = dependencies.fileExists ?? defaultFileExists
  const getCwd = dependencies.getCwd ?? (() => process.cwd())
  const getHomeDirectory = dependencies.getHomeDirectory ?? (() => os.homedir())
  const getPlatform = dependencies.platform ?? (() => process.platform)
  const log = dependencies.log ?? defaultLogger
  const resolveCliBinPath =
    dependencies.resolveCliBinPath ?? defaultResolveCliBinPath
  const runCommand = dependencies.runCommand ?? createDefaultCommandRunner(log)
  const downloadFile = dependencies.downloadFile ?? defaultDownloadFile
  const vaultServices =
    dependencies.vaultServices ?? createIntegratedVaultCliServices()
  const inboxServices =
    dependencies.inboxServices ?? createIntegratedInboxCliServices()

  async function setupMacos(input: SetupInput): Promise<SetupResult> {
    const platform = getPlatform()
    if (platform !== 'darwin') {
      throw new VaultCliError(
        'unsupported_platform',
        'Healthy Bob setup currently supports macOS only.',
        {
          platform,
        },
      )
    }

    const arch = getArch()
    const dryRun = input.dryRun ?? false
    const strict = input.strict ?? true
    const vault = path.resolve(getCwd(), input.vault)
    const requestId = input.requestId ?? null
    const whisperModel = input.whisperModel ?? 'base.en'
    const homeDirectory = path.resolve(getHomeDirectory())
    const cliBinPath = path.resolve(resolveCliBinPath())
    const toolchainRoot = path.resolve(
      getCwd(),
      input.toolchainRoot ?? path.join(homeDirectory, DEFAULT_TOOLCHAIN_DIRECTORY),
    )
    const notes: string[] = []
    const steps: SetupStepResult[] = []

    log(
      `Healthy Bob setup targeting ${redactHomePathInText(vault, homeDirectory)} on macOS (${arch}).`,
    )

    let state = await ensureHomebrew({
      arch,
      dryRun,
      env: getBaseEnv(),
      log,
      runCommand,
      steps,
    })

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

    const formulaCommands: Record<FormulaCommandKey, string | null> = {
      ffmpegCommand: null,
      pdftotextCommand: null,
      whisperCommand: null,
    }
    for (const formulaSpec of buildBaseFormulaSpecs()) {
      const formulaResult = await ensureBrewFormula({
        brewState: state,
        commandCandidates: formulaSpec.commandCandidates,
        dryRun,
        formula: formulaSpec.formula,
        id: formulaSpec.id,
        installDetail: formulaSpec.installDetail,
        kind: 'install',
        missingPlanDetail: formulaSpec.missingPlanDetail,
        runCommand,
        steps,
        title: formulaSpec.title,
      })
      state = {
        ...state,
        env: formulaResult.env,
      }
      formulaCommands[formulaSpec.key] = formulaResult.command
    }

    const whisperModelPath = path.join(
      toolchainRoot,
      'models',
      'whisper',
      modelFileNames[whisperModel],
    )
    await ensureWhisperModel({
      destinationPath: whisperModelPath,
      dryRun,
      downloadFile,
      downloadUrl: whisperModelDownloadUrl(whisperModel),
      fileExists,
      id: 'whisper-model',
      model: whisperModel,
      steps,
      title: 'Whisper model',
    })

    let paddleocrCommand: string | null = null
    if (input.skipOcr) {
      steps.push(
        createStep({
          detail: 'Skipped PaddleX OCR because --skipOcr was set.',
          id: 'paddlex-ocr',
          kind: 'install',
          status: 'skipped',
          title: 'PaddleX OCR',
        }),
      )
      notes.push('OCR installation was skipped by request.')
    } else if (arch !== 'arm64') {
      steps.push(
        createStep({
          detail:
            'Skipped PaddleX OCR because current macOS Paddle wheels only support Apple Silicon.',
          id: 'paddlex-ocr',
          kind: 'install',
          status: 'skipped',
          title: 'PaddleX OCR',
        }),
      )
      notes.push(
        'OCR was skipped because PaddlePaddle does not currently publish macOS x86_64 support.',
      )
    } else {
      const pythonFormulaSpec = buildPythonFormulaSpec()
      const pythonResult = await ensureBrewFormula({
        brewState: state,
        commandCandidates: pythonFormulaSpec.commandCandidates,
        dryRun,
        formula: pythonFormulaSpec.formula,
        id: pythonFormulaSpec.id,
        installDetail: pythonFormulaSpec.installDetail,
        kind: 'install',
        missingPlanDetail: pythonFormulaSpec.missingPlanDetail,
        runCommand,
        steps,
        title: pythonFormulaSpec.title,
      })
      state = {
        ...state,
        env: pythonResult.env,
      }
      paddleocrCommand = await ensurePaddleXOcr({
        dryRun,
        env: state.env,
        fileExists,
        pythonCommand: pythonResult.command,
        runCommand,
        steps,
        toolchainRoot,
      })
    }

    const tools: SetupTools = {
      ffmpegCommand: formulaCommands.ffmpegCommand,
      pdftotextCommand: formulaCommands.pdftotextCommand,
      whisperCommand: formulaCommands.whisperCommand,
      whisperModelPath,
      paddleocrCommand,
    }

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
            'Would bootstrap the inbox runtime, parser toolchain config, and post-setup doctor checks.',
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
        paddleocrCommand: tools.paddleocrCommand ?? undefined,
        pdftotextCommand: tools.pdftotextCommand ?? undefined,
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
            'Wrote parser toolchain config under .runtime/parsers and completed inbox doctor checks.',
          id: 'inbox-bootstrap',
          kind: 'configure',
          status: 'completed',
          title: 'Inbox bootstrap',
        }),
      )
    }

    await ensureCliShims({
      cliBinPath,
      dryRun,
      env: state.env,
      fileExists,
      homeDirectory,
      notes,
      steps,
    })
    await ensureDefaultVaultSelection({
      dryRun,
      homeDirectory,
      steps,
      vault,
    })

    const channels =
      input.channels == null
        ? []
        : await configureSetupChannels({
            channels: normalizeSetupChannels(input.channels),
            dryRun,
            env: state.env,
            inboxServices,
            requestId,
            steps,
            vault,
          })

    return {
      arch,
      bootstrap:
        bootstrap === null
          ? null
          : redactHomePathsInValue(bootstrap, homeDirectory),
      channels: channels.map((channel) => ({
        ...channel,
        connectorId: channel.connectorId,
        detail: redactHomePathInText(channel.detail, homeDirectory),
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
        pdftotextCommand: redactNullableHomePath(tools.pdftotextCommand, homeDirectory),
        whisperCommand: redactNullableHomePath(tools.whisperCommand, homeDirectory),
        whisperModelPath: redactHomePath(tools.whisperModelPath, homeDirectory),
        paddleocrCommand: redactNullableHomePath(tools.paddleocrCommand, homeDirectory),
      },
      vault: redactHomePath(vault, homeDirectory),
      whisperModel,
    }
  }

  return {
    setupMacos,
  }
}

export function detectSetupProgramName(argv0: string | undefined): string {
  const baseName = path.basename(argv0 ?? '')
  return baseName === 'healthybob' ? 'healthybob' : 'vault-cli'
}

export function isSetupInvocation(
  args: string[],
  programName = 'vault-cli',
): boolean {
  const commandToken = resolveEffectiveTopLevelToken(args)
  if (commandToken === 'setup' || commandToken === 'onboard') {
    return true
  }

  if (programName !== 'healthybob') {
    return false
  }

  return commandToken === null || commandToken === 'help'
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

async function ensureDefaultVaultSelection(input: {
  dryRun: boolean
  homeDirectory: string
  steps: SetupStepResult[]
  vault: string
}): Promise<void> {
  const existing = await readOperatorConfig(input.homeDirectory)
  const existingDefaultVault =
    existing?.defaultVault === null || existing?.defaultVault === undefined
      ? null
      : existing.defaultVault
  const nextDefaultVault = normalizeVaultForConfig(input.vault, input.homeDirectory)
  const status =
    existingDefaultVault === nextDefaultVault
      ? 'reused'
      : input.dryRun
        ? 'planned'
        : 'completed'
  const detail =
    existingDefaultVault === nextDefaultVault
      ? `Reusing ${nextDefaultVault} as the default Healthy Bob vault for future CLI commands.`
      : input.dryRun
        ? `Would save ${nextDefaultVault} as the default Healthy Bob vault for future CLI commands.`
        : `Saved ${nextDefaultVault} as the default Healthy Bob vault for future CLI commands.`

  if (!input.dryRun && existingDefaultVault !== nextDefaultVault) {
    await saveDefaultVaultConfig(input.vault, input.homeDirectory)
  }

  input.steps.push(
    createStep({
      detail,
      id: 'default-vault',
      kind: 'configure',
      status,
      title: 'Default vault selection',
    }),
  )
}

function defaultResolveCliBinPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'bin.js')
}
