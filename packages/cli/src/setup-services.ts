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
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
  type AssistantOperatorDefaults,
} from './operator-config.js'
import {
  type SetupChannel,
  type SetupConfiguredAssistant,
  type SetupResult,
  type SetupStepKind,
  type SetupStepResult,
  type SetupTools,
  type SetupWearable,
  type WhisperModel,
} from './setup-cli-contracts.js'
import type { InboxBootstrapResult } from './inbox-cli-contracts.js'
import {
  configureSetupChannels,
  normalizeSetupChannels,
} from './setup-services/channels.js'
import {
  createSetupAgentmailSelectionResolver,
  type SetupAgentmailSelectionResolver,
} from './setup-agentmail.js'
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
  resolveExecutablePath,
} from './setup-services/toolchain.js'
import { describeSelectedSetupWearables } from './setup-runtime-env.js'
import { errorMessage } from './inbox-services/shared.js'

interface SetupInput {
  vault: string
  assistant?: SetupConfiguredAssistant | null
  allowChannelPrompts?: boolean
  channels?: readonly SetupChannel[] | null
  envOverrides?: NodeJS.ProcessEnv
  requestId?: string | null
  dryRun?: boolean
  rebuild?: boolean
  strict?: boolean
  toolchainRoot?: string
  wearables?: readonly SetupWearable[] | null
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
    Partial<
      Pick<InboxCliServices, 'doctor' | 'sourceAdd' | 'sourceList' | 'sourceSetEnabled'>
    >
  resolveAgentmailInboxSelection?: SetupAgentmailSelectionResolver
  vaultServices?: Pick<VaultCliServices, 'core'>
}

interface SetupServices {
  setupHost(input: SetupInput): Promise<SetupResult>
  setupMacos(input: SetupInput): Promise<SetupResult>
}

interface SetupProvisioningInput {
  arch: string
  dryRun: boolean
  env: NodeJS.ProcessEnv
  fileExists: (absolutePath: string) => Promise<boolean>
  log: (message: string) => void
  notes: string[]
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  skipOcr?: boolean
  steps: SetupStepResult[]
  toolchainRoot: string
  whisperModel: WhisperModel
  downloadFile: (url: string, destinationPath: string) => Promise<void>
}

interface SetupProvisioningResult {
  env: NodeJS.ProcessEnv
  tools: SetupTools
}

interface AptRunnerState {
  command: string | null
  baseArgs: string[]
  env: NodeJS.ProcessEnv
  updateAttempted: boolean
  updateSucceeded: boolean
}

interface AptInstallResult {
  apt: AptRunnerState
  installed: boolean
  reason: string | null
}

interface LinuxResolvedCommandContext {
  command: string
  env: NodeJS.ProcessEnv
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
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
  const resolveAgentmailInboxSelection =
    dependencies.resolveAgentmailInboxSelection ??
    createSetupAgentmailSelectionResolver()

  async function setupHost(input: SetupInput): Promise<SetupResult> {
    const platform = getPlatform()
    if (platform !== 'darwin' && platform !== 'linux') {
      throw unsupportedSetupPlatform(platform)
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
    const effectiveEnv = {
      ...getBaseEnv(),
      ...(input.envOverrides ?? {}),
    }

    log(
      `Healthy Bob setup targeting ${redactHomePathInText(vault, homeDirectory)} on ${describeSetupHost(platform)} (${arch}).`,
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

    const provisioning =
      platform === 'darwin'
        ? await provisionMacosToolchain({
            arch,
            downloadFile,
            dryRun,
            env: effectiveEnv,
            fileExists,
            log,
            notes,
            runCommand,
            skipOcr: input.skipOcr,
            steps,
            toolchainRoot,
            whisperModel,
          })
        : await provisionLinuxToolchain({
            arch,
            downloadFile,
            dryRun,
            env: effectiveEnv,
            fileExists,
            log,
            notes,
            runCommand,
            skipOcr: input.skipOcr,
            steps,
            toolchainRoot,
            whisperModel,
          })
    const toolchainEnv = provisioning.env
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
      env: toolchainEnv,
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
    const assistant =
      input.assistant == null
        ? null
        : await ensureAssistantDefaultSelection({
            assistant: input.assistant,
            dryRun,
            homeDirectory,
            notes,
            steps,
          })

    const channels =
      input.channels == null
        ? []
        : await configureSetupChannels({
            allowPrompt: input.allowChannelPrompts ?? false,
            channels: normalizeSetupChannels(input.channels),
            dryRun,
            env: toolchainEnv,
            inboxServices,
            platform,
            requestId,
            resolveAgentmailInboxSelection,
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

    return {
      arch,
      bootstrap:
        bootstrap === null
          ? null
          : redactHomePathsInValue(bootstrap, homeDirectory),
      assistant:
        assistant === null
          ? null
          : {
              ...assistant,
              detail: redactHomePathInText(assistant.detail, homeDirectory),
            },
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
        pdftotextCommand: redactNullableHomePath(tools.pdftotextCommand, homeDirectory),
        whisperCommand: redactNullableHomePath(tools.whisperCommand, homeDirectory),
        whisperModelPath: redactHomePath(tools.whisperModelPath, homeDirectory),
        paddleocrCommand: redactNullableHomePath(tools.paddleocrCommand, homeDirectory),
      },
      vault: redactHomePath(vault, homeDirectory),
      whisperModel,
    }
  }

  async function setupMacos(input: SetupInput): Promise<SetupResult> {
    const platform = getPlatform()
    if (platform !== 'darwin') {
      throw unsupportedSetupPlatform(platform, 'Healthy Bob setup currently supports macOS only through setupMacos(). Use setupHost() for Linux support.')
    }

    return await setupHost(input)
  }

  return {
    setupHost,
    setupMacos,
  }
}

async function provisionMacosToolchain(
  input: SetupProvisioningInput,
): Promise<SetupProvisioningResult> {
  let state = await ensureHomebrew({
    arch: input.arch,
    dryRun: input.dryRun,
    env: input.env,
    log: input.log,
    runCommand: input.runCommand,
    steps: input.steps,
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
      dryRun: input.dryRun,
      formula: formulaSpec.formula,
      id: formulaSpec.id,
      installDetail: formulaSpec.installDetail,
      kind: 'install',
      missingPlanDetail: formulaSpec.missingPlanDetail,
      runCommand: input.runCommand,
      steps: input.steps,
      title: formulaSpec.title,
    })
    state = {
      ...state,
      env: formulaResult.env,
    }
    formulaCommands[formulaSpec.key] = formulaResult.command
  }

  const whisperModelPath = path.join(
    input.toolchainRoot,
    'models',
    'whisper',
    modelFileNames[input.whisperModel],
  )
  await ensureWhisperModel({
    destinationPath: whisperModelPath,
    dryRun: input.dryRun,
    downloadFile: input.downloadFile,
    downloadUrl: whisperModelDownloadUrl(input.whisperModel),
    fileExists: input.fileExists,
    id: 'whisper-model',
    model: input.whisperModel,
    steps: input.steps,
    title: 'Whisper model',
  })

  let paddleocrCommand: string | null = null
  if (input.skipOcr) {
    input.steps.push(
      createStep({
        detail: 'Skipped PaddleX OCR because --skipOcr was set.',
        id: 'paddlex-ocr',
        kind: 'install',
        status: 'skipped',
        title: 'PaddleX OCR',
      }),
    )
    input.notes.push('OCR installation was skipped by request.')
  } else if (input.arch !== 'arm64') {
    input.steps.push(
      createStep({
        detail:
          'Skipped PaddleX OCR because current macOS Paddle wheels only support Apple Silicon.',
        id: 'paddlex-ocr',
        kind: 'install',
        status: 'skipped',
        title: 'PaddleX OCR',
      }),
    )
    input.notes.push(
      'OCR was skipped because PaddlePaddle does not currently publish macOS x86_64 support.',
    )
  } else {
    const pythonFormulaSpec = buildPythonFormulaSpec()
    const pythonResult = await ensureBrewFormula({
      brewState: state,
      commandCandidates: pythonFormulaSpec.commandCandidates,
      dryRun: input.dryRun,
      formula: pythonFormulaSpec.formula,
      id: pythonFormulaSpec.id,
      installDetail: pythonFormulaSpec.installDetail,
      kind: 'install',
      missingPlanDetail: pythonFormulaSpec.missingPlanDetail,
      runCommand: input.runCommand,
      steps: input.steps,
      title: pythonFormulaSpec.title,
    })
    state = {
      ...state,
      env: pythonResult.env,
    }
    paddleocrCommand = await ensurePaddleXOcr({
      dryRun: input.dryRun,
      env: state.env,
      fileExists: input.fileExists,
      pythonCommand: pythonResult.command,
      runCommand: input.runCommand,
      steps: input.steps,
      toolchainRoot: input.toolchainRoot,
    })
  }

  return {
    env: state.env,
    tools: {
      ffmpegCommand: formulaCommands.ffmpegCommand,
      pdftotextCommand: formulaCommands.pdftotextCommand,
      whisperCommand: formulaCommands.whisperCommand,
      whisperModelPath,
      paddleocrCommand,
    },
  }
}

async function provisionLinuxToolchain(
  input: SetupProvisioningInput,
): Promise<SetupProvisioningResult> {
  let apt = await resolveAptRunner(input.env)

  const ffmpeg = await ensureLinuxCommand({
    apt,
    commandCandidates: ['ffmpeg'],
    dryRun: input.dryRun,
    env: input.env,
    id: 'ffmpeg',
    installPackages: ['ffmpeg'],
    missingStepDetail:
      'ffmpeg was not found on PATH and Healthy Bob could not install it automatically. Install ffmpeg manually or rerun setup with apt/sudo access.',
    missingPlanDetail:
      'Would reuse ffmpeg from PATH when available, or install the ffmpeg package via apt-get for audio/video normalization.',
    notes: input.notes,
    runCommand: input.runCommand,
    steps: input.steps,
    title: 'ffmpeg',
  })
  apt = ffmpeg.apt

  const pdftotext = await ensureLinuxCommand({
    apt,
    commandCandidates: ['pdftotext'],
    dryRun: input.dryRun,
    env: ffmpeg.env,
    id: 'pdftotext',
    installPackages: ['poppler-utils'],
    missingStepDetail:
      'pdftotext was not found on PATH and Healthy Bob could not install it automatically. Install poppler-utils manually or rerun setup with apt/sudo access.',
    missingPlanDetail:
      'Would reuse pdftotext from PATH when available, or install poppler-utils via apt-get for PDF parsing.',
    notes: input.notes,
    runCommand: input.runCommand,
    steps: input.steps,
    title: 'pdftotext',
  })
  apt = pdftotext.apt

  const whisper = await ensureLinuxCommand({
    apt,
    commandCandidates: ['whisper-cli', 'whisper-cpp'],
    dryRun: input.dryRun,
    env: pdftotext.env,
    id: 'whisper-cpp',
    installPackages: ['whisper-cpp'],
    missingStepDetail:
      'whisper.cpp was not found on PATH and Healthy Bob could not install it automatically. Install whisper.cpp manually or rerun setup with apt/sudo access.',
    missingPlanDetail:
      'Would reuse whisper.cpp from PATH when available, or install the whisper-cpp package via apt-get for local transcription.',
    notes: input.notes,
    runCommand: input.runCommand,
    steps: input.steps,
    title: 'whisper.cpp',
  })
  apt = whisper.apt

  const whisperModelPath = path.join(
    input.toolchainRoot,
    'models',
    'whisper',
    modelFileNames[input.whisperModel],
  )
  await ensureWhisperModel({
    destinationPath: whisperModelPath,
    dryRun: input.dryRun,
    downloadFile: input.downloadFile,
    downloadUrl: whisperModelDownloadUrl(input.whisperModel),
    fileExists: input.fileExists,
    id: 'whisper-model',
    model: input.whisperModel,
    steps: input.steps,
    title: 'Whisper model',
  })

  let paddleocrCommand: string | null = null
  if (input.skipOcr) {
    input.steps.push(
      createStep({
        detail: 'Skipped PaddleX OCR because --skipOcr was set.',
        id: 'paddlex-ocr',
        kind: 'install',
        status: 'skipped',
        title: 'PaddleX OCR',
      }),
    )
    input.notes.push('OCR installation was skipped by request.')
  } else if (input.arch !== 'x64') {
    input.steps.push(
      createStep({
        detail:
          'Skipped PaddleX OCR because automatic Linux OCR setup currently targets x86_64 hosts.',
        id: 'paddlex-ocr',
        kind: 'install',
        status: 'skipped',
        title: 'PaddleX OCR',
      }),
    )
    input.notes.push(
      'OCR was skipped because automatic Linux PaddleX setup currently targets x86_64 hosts.',
    )
  } else {
    const existingPaddlex = await resolveExecutablePath(['paddlex'], whisper.env)
    if (existingPaddlex) {
      input.steps.push(
        createStep({
          detail: `Reusing PaddleX OCR from ${existingPaddlex}.`,
          id: 'paddlex-ocr',
          kind: 'install',
          status: 'reused',
          title: 'PaddleX OCR',
        }),
      )
      paddleocrCommand = existingPaddlex
    } else {
      const python = await ensureLinuxPythonCommand({
        apt,
        dryRun: input.dryRun,
        env: whisper.env,
        notes: input.notes,
        runCommand: input.runCommand,
        steps: input.steps,
      })
      apt = python.apt
      if (python.command) {
        try {
          paddleocrCommand = await ensurePaddleXOcr({
            dryRun: input.dryRun,
            env: python.env,
            fileExists: input.fileExists,
            pythonCommand: python.command,
            runCommand: input.runCommand,
            steps: input.steps,
            toolchainRoot: input.toolchainRoot,
          })
        } catch (error) {
          input.steps.push(
            createStep({
              detail:
                'Skipped PaddleX OCR because the Python environment could not install paddlex[ocr] automatically on this host.',
              id: 'paddlex-ocr',
              kind: 'install',
              status: 'skipped',
              title: 'PaddleX OCR',
            }),
          )
          input.notes.push(
            `OCR was skipped because automatic Linux PaddleX setup failed: ${errorMessage(error)}.`,
          )
        }
      } else if (!input.dryRun) {
        input.steps.push(
          createStep({
            detail:
              'Skipped PaddleX OCR because Python 3 with venv support could not be resolved on this host.',
            id: 'paddlex-ocr',
            kind: 'install',
            status: 'skipped',
            title: 'PaddleX OCR',
          }),
        )
      }
    }
  }

  return {
    env: whisper.env,
    tools: {
      ffmpegCommand: ffmpeg.command,
      pdftotextCommand: pdftotext.command,
      whisperCommand: whisper.command,
      whisperModelPath,
      paddleocrCommand,
    },
  }
}

async function ensureLinuxCommand(input: {
  apt: AptRunnerState
  commandCandidates: string[]
  dryRun: boolean
  env: NodeJS.ProcessEnv
  completedDetail?: string
  id: string
  installPackages: string[]
  missingNoteDetail?: string
  missingStepDetail: string
  missingPlanDetail: string
  notes: string[]
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  reuseDetail?: (command: string) => string
  steps: SetupStepResult[]
  title: string
  validateResolvedCommand?: (
    context: LinuxResolvedCommandContext,
  ) => Promise<boolean>
}): Promise<{
  apt: AptRunnerState
  command: string | null
  env: NodeJS.ProcessEnv
}> {
  const resolveValidatedCommand = async (): Promise<{
    command: string | null
    rawCommand: string | null
  }> => {
    const rawCommand = await resolveExecutablePath(
      input.commandCandidates,
      input.env,
    )
    if (!rawCommand) {
      return {
        command: null,
        rawCommand: null,
      }
    }
    if (
      input.validateResolvedCommand &&
      !(await input.validateResolvedCommand({
        command: rawCommand,
        env: input.env,
        runCommand: input.runCommand,
      }))
    ) {
      return {
        command: null,
        rawCommand,
      }
    }
    return {
      command: rawCommand,
      rawCommand,
    }
  }

  const existingResolution = await resolveValidatedCommand()
  const existing = existingResolution.command
  if (existing) {
    input.steps.push(
      createStep({
        detail:
          input.reuseDetail?.(existing) ?? `Reusing ${input.title} from ${existing}.`,
        id: input.id,
        kind: 'install',
        status: 'reused',
        title: input.title,
      }),
    )
    return {
      apt: input.apt,
      command: existing,
      env: input.env,
    }
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: input.missingPlanDetail,
        id: input.id,
        kind: 'install',
        status: 'planned',
        title: input.title,
      }),
    )
    return {
      apt: input.apt,
      command: existingResolution.rawCommand,
      env: input.env,
    }
  }

  const install = await ensureAptPackages({
    apt: input.apt,
    env: input.env,
    packages: input.installPackages,
    runCommand: input.runCommand,
  })
  const resolved = (await resolveValidatedCommand()).command
  if (resolved) {
    input.steps.push(
      createStep({
        detail:
          input.completedDetail ?? `Installed ${input.title} through apt-get.`,
        id: input.id,
        kind: 'install',
        status: 'completed',
        title: input.title,
      }),
    )
    return {
      apt: install.apt,
      command: resolved,
      env: input.env,
    }
  }

  input.steps.push(
    createStep({
      detail: install.reason ?? input.missingStepDetail,
      id: input.id,
      kind: 'install',
      status: 'skipped',
      title: input.title,
    }),
  )
  input.notes.push(input.missingNoteDetail ?? input.missingStepDetail)
  if (install.reason && install.reason !== input.missingStepDetail) {
    input.notes.push(`${input.title} auto-install detail: ${install.reason}`)
  }

  return {
    apt: install.apt,
    command: null,
    env: input.env,
  }
}

async function ensureLinuxPythonCommand(input: {
  apt: AptRunnerState
  dryRun: boolean
  env: NodeJS.ProcessEnv
  notes: string[]
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
}): Promise<{
  apt: AptRunnerState
  command: string | null
  env: NodeJS.ProcessEnv
}> {
  const title = 'Python 3'
  return ensureLinuxCommand({
    apt: input.apt,
    commandCandidates: ['python3.12', 'python3', 'python'],
    completedDetail:
      'Installed Python 3 with venv support through apt-get for OCR tooling.',
    dryRun: input.dryRun,
    env: input.env,
    id: 'python',
    installPackages: ['python3', 'python3-venv'],
    missingNoteDetail:
      'OCR setup could not resolve Python 3 with venv support automatically. Install python3 and python3-venv manually or rerun setup with apt/sudo access.',
    missingStepDetail:
      'Python 3 with venv support was not found on PATH and Healthy Bob could not install it automatically.',
    missingPlanDetail:
      'Would reuse Python 3 with venv support from PATH when available, or install python3 plus python3-venv via apt-get for OCR tooling.',
    notes: input.notes,
    reuseDetail: (command) => `Reusing ${title} from ${command} for OCR tooling.`,
    runCommand: input.runCommand,
    steps: input.steps,
    title,
    validateResolvedCommand: async ({ command, env, runCommand }) =>
      pythonSupportsVenv(command, env, runCommand),
  })
}

async function pythonSupportsVenv(
  pythonCommand: string,
  env: NodeJS.ProcessEnv,
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>,
): Promise<boolean> {
  const result = await runCommand({
    args: ['-m', 'venv', '--help'],
    env,
    file: pythonCommand,
  })
  return result.exitCode === 0
}

async function resolveAptRunner(env: NodeJS.ProcessEnv): Promise<AptRunnerState> {
  const aptGet = await resolveExecutablePath(
    ['apt-get'],
    env,
    ['/usr/bin/apt-get', '/bin/apt-get'],
  )
  if (!aptGet) {
    return {
      command: null,
      baseArgs: [],
      env,
      updateAttempted: false,
      updateSucceeded: false,
    }
  }

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return {
      command: aptGet,
      baseArgs: [],
      env,
      updateAttempted: false,
      updateSucceeded: false,
    }
  }

  const sudo = await resolveExecutablePath(
    ['sudo'],
    env,
    ['/usr/bin/sudo', '/bin/sudo'],
  )
  if (!sudo) {
    return {
      command: null,
      baseArgs: [],
      env,
      updateAttempted: false,
      updateSucceeded: false,
    }
  }

  return {
    command: sudo,
    baseArgs: ['-n', aptGet],
    env,
    updateAttempted: false,
    updateSucceeded: false,
  }
}

async function ensureAptPackages(input: {
  apt: AptRunnerState
  env: NodeJS.ProcessEnv
  packages: string[]
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
}): Promise<AptInstallResult> {
  if (!input.apt.command) {
    return {
      apt: input.apt,
      installed: false,
      reason: 'apt-get or passwordless sudo is unavailable on this host.',
    }
  }

  let apt = input.apt
  const aptCommand = input.apt.command
  const aptEnv = {
    ...input.env,
    DEBIAN_FRONTEND: 'noninteractive',
  }

  if (!apt.updateAttempted) {
    const updateResult = await input.runCommand({
      args: [...apt.baseArgs, 'update'],
      env: aptEnv,
      file: aptCommand,
    })
    apt = {
      ...apt,
      updateAttempted: true,
      updateSucceeded: updateResult.exitCode === 0,
    }
    if (updateResult.exitCode !== 0) {
      return {
        apt,
        installed: false,
        reason: summarizeCommandFailure(
          updateResult,
          'apt-get update failed during automatic Linux tool provisioning.',
        ),
      }
    }
  }

  const installResult = await input.runCommand({
    args: [...apt.baseArgs, 'install', '-y', ...input.packages],
    env: aptEnv,
    file: aptCommand,
  })
  if (installResult.exitCode !== 0) {
    return {
      apt,
      installed: false,
      reason: summarizeCommandFailure(
        installResult,
        `apt-get install failed for ${input.packages.join(', ')}.`,
      ),
    }
  }

  return {
    apt,
    installed: true,
    reason: null,
  }
}

function summarizeCommandFailure(
  result: CommandRunResult,
  fallback: string,
): string {
  const stderr = result.stderr.trim()
  if (stderr.length > 0) {
    return stderr
  }

  const stdout = result.stdout.trim()
  if (stdout.length > 0) {
    return stdout
  }

  return fallback
}

function unsupportedSetupPlatform(
  platform: NodeJS.Platform,
  message = 'Healthy Bob setup currently supports macOS and Linux only.',
): VaultCliError {
  return new VaultCliError('unsupported_platform', message, {
    platform,
  })
}

function describeSetupHost(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'macOS' : platform
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



async function ensureAssistantDefaultSelection(input: {
  assistant: SetupConfiguredAssistant
  dryRun: boolean
  homeDirectory: string
  notes: string[]
  steps: SetupStepResult[]
}): Promise<SetupConfiguredAssistant> {
  if (!input.assistant.enabled || input.assistant.provider === null) {
    input.steps.push(
      createStep({
        detail:
          'Skipped saving assistant defaults during setup and left any existing assistant config unchanged.',
        id: 'assistant-defaults',
        kind: 'configure',
        status: 'skipped',
        title: 'Assistant defaults',
      }),
    )
    return input.assistant
  }

  const existing = await readOperatorConfig(input.homeDirectory)
  const nextDefaults = assistantSelectionToOperatorDefaults(input.assistant)
  const status = assistantOperatorDefaultsMatch(
    existing?.assistant ?? null,
    nextDefaults,
  )
    ? 'reused'
    : input.dryRun
      ? 'planned'
      : 'completed'
  const summary = formatAssistantDefaultsSummary(input.assistant)
  const detail =
    status === 'reused'
      ? `Reusing ${summary} as the default assistant for future chats and auto-reply.`
      : input.dryRun
        ? `Would save ${summary} as the default assistant for future chats and auto-reply.`
        : `Saved ${summary} as the default assistant for future chats and auto-reply.`

  if (status !== 'reused' && !input.dryRun) {
    await saveAssistantOperatorDefaultsPatch(nextDefaults, input.homeDirectory)
  }

  if (input.assistant.provider === 'openai-compatible' && input.assistant.apiKeyEnv) {
    input.notes.push(
      `Export ${input.assistant.apiKeyEnv} before using the saved OpenAI-compatible assistant backend.`,
    )
  }

  input.steps.push(
    createStep({
      detail,
      id: 'assistant-defaults',
      kind: 'configure',
      status,
      title: 'Assistant defaults',
    }),
  )

  return input.assistant
}

function assistantSelectionToOperatorDefaults(
  assistant: SetupConfiguredAssistant,
): Partial<AssistantOperatorDefaults> {
  return {
    provider: assistant.provider,
    codexCommand: assistant.codexCommand,
    model: assistant.model,
    reasoningEffort: assistant.reasoningEffort,
    sandbox: assistant.sandbox,
    approvalPolicy: assistant.approvalPolicy,
    profile: assistant.profile,
    oss: assistant.oss,
    baseUrl: assistant.baseUrl,
    apiKeyEnv: assistant.apiKeyEnv,
    providerName: assistant.providerName,
    account: assistant.account ?? null,
  }
}

function assistantOperatorDefaultsMatch(
  existing: AssistantOperatorDefaults | null,
  next: Partial<AssistantOperatorDefaults>,
): boolean {
  return (
    normalizeNullableConfigField(existing?.provider) ===
      normalizeNullableConfigField(next.provider) &&
    normalizeNullableConfigField(existing?.codexCommand) ===
      normalizeNullableConfigField(next.codexCommand) &&
    normalizeNullableConfigField(existing?.model) ===
      normalizeNullableConfigField(next.model) &&
    normalizeNullableConfigField(existing?.reasoningEffort) ===
      normalizeNullableConfigField(next.reasoningEffort) &&
    normalizeNullableConfigField(existing?.sandbox) ===
      normalizeNullableConfigField(next.sandbox) &&
    normalizeNullableConfigField(existing?.approvalPolicy) ===
      normalizeNullableConfigField(next.approvalPolicy) &&
    normalizeNullableConfigField(existing?.profile) ===
      normalizeNullableConfigField(next.profile) &&
    normalizeNullableConfigField(existing?.baseUrl) ===
      normalizeNullableConfigField(next.baseUrl) &&
    normalizeNullableConfigField(existing?.apiKeyEnv) ===
      normalizeNullableConfigField(next.apiKeyEnv) &&
    normalizeNullableConfigField(existing?.providerName) ===
      normalizeNullableConfigField(next.providerName) &&
    JSON.stringify(existing?.account ?? null) ===
      JSON.stringify(next.account ?? null) &&
    (existing?.oss ?? null) === (next.oss ?? null)
  )
}

function formatAssistantDefaultsSummary(
  assistant: SetupConfiguredAssistant,
): string {
  if (assistant.provider === 'openai-compatible') {
    return assistant.baseUrl
      ? `${assistant.model ?? 'the configured model'} via ${assistant.baseUrl}`
      : `${assistant.model ?? 'the configured model'} via the saved OpenAI-compatible endpoint`
  }

  if (assistant.oss) {
    return appendAssistantAccountSummary(
      `${assistant.model ?? 'the configured local model'} in Codex OSS`,
      assistant,
    )
  }

  return appendAssistantAccountSummary(
    `${assistant.model ?? 'the configured model'} in Codex CLI`,
    assistant,
  )
}

function normalizeNullableConfigField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function appendAssistantAccountSummary(
  summary: string,
  assistant: SetupConfiguredAssistant,
): string {
  const planName = normalizeNullableConfigField(assistant.account?.planName)
  if (planName) {
    return `${summary} (${planName} account)`
  }

  if (assistant.account?.kind === 'api-key') {
    return `${summary} (API key account)`
  }

  return summary
}

function defaultResolveCliBinPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'bin.js')
}
