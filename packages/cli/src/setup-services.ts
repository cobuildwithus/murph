import { spawn } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  createIntegratedInboxCliServices,
  type InboxCliServices,
} from './inbox-services.js'
import {
  createIntegratedVaultCliServices,
  type VaultCliServices,
} from './vault-cli-services.js'
import { VaultCliError } from './vault-cli-errors.js'
import {
  type SetupResult,
  type SetupStepKind,
  type SetupStepResult,
  type SetupStepStatus,
  type SetupTools,
  type WhisperModel,
} from './setup-cli-contracts.js'
import type { InboxBootstrapResult } from './inbox-cli-contracts.js'

interface CommandRunInput {
  file: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

interface CommandRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface SetupInput {
  vault: string
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
  runCommand?: (input: CommandRunInput) => Promise<CommandRunResult>
  inboxServices?: Pick<InboxCliServices, 'bootstrap'>
  vaultServices?: Pick<VaultCliServices, 'core'>
}

interface SetupServices {
  setupMacos(input: SetupInput): Promise<SetupResult>
}

interface BrewState {
  available: boolean
  brewCommand: string | null
  env: NodeJS.ProcessEnv
}

interface FormulaInstallResult {
  command: string | null
  env: NodeJS.ProcessEnv
}

type FormulaCommandKey = 'ffmpegCommand' | 'pdftotextCommand' | 'whisperCommand'

interface FormulaSpec {
  commandCandidates: string[]
  formula: string
  id: string
  installDetail: string
  missingPlanDetail: string
  title: string
}

interface ToolFormulaSpec extends FormulaSpec {
  key: FormulaCommandKey
}

const DEFAULT_TOOLCHAIN_DIRECTORY = path.join('.healthybob', 'toolchain')
const PADDLEX_VENV_NAME = 'paddlex-ocr'
const PADDLEX_REQUIREMENT = 'paddlex[ocr]'
const BREW_INSTALL_COMMAND =
  'NONINTERACTIVE=1 CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

const modelFileNames: Record<WhisperModel, string> = {
  tiny: 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  small: 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  medium: 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
  'large-v3-turbo': 'ggml-large-v3-turbo.bin',
}

function whisperModelDownloadUrl(model: WhisperModel): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFileNames[model]}`
}

const rootOptionsWithValues = new Set(['--format'])

function buildBaseFormulaSpecs(): ToolFormulaSpec[] {
  return [
    {
      commandCandidates: ['ffmpeg'],
      formula: 'ffmpeg',
      id: 'ffmpeg',
      installDetail: 'Installed ffmpeg through Homebrew.',
      key: 'ffmpegCommand',
      missingPlanDetail:
        'Would install ffmpeg through Homebrew for audio/video normalization.',
      title: 'ffmpeg',
    },
    {
      commandCandidates: ['pdftotext'],
      formula: 'poppler',
      id: 'pdftotext',
      installDetail: 'Installed poppler so pdftotext is available for PDF parsing.',
      key: 'pdftotextCommand',
      missingPlanDetail:
        'Would install poppler through Homebrew so pdftotext is available for PDF parsing.',
      title: 'pdftotext',
    },
    {
      commandCandidates: ['whisper-cli', 'whisper-cpp'],
      formula: 'whisper-cpp',
      id: 'whisper-cpp',
      installDetail: 'Installed whisper.cpp through Homebrew.',
      key: 'whisperCommand',
      missingPlanDetail:
        'Would install whisper.cpp through Homebrew for local transcription.',
      title: 'whisper.cpp',
    },
  ]
}

function buildPythonFormulaSpec(): FormulaSpec {
  return {
    commandCandidates: ['python3.12', 'python3', 'python'],
    formula: 'python@3.12',
    id: 'python',
    installDetail: 'Installed Python 3.12 through Homebrew for OCR tooling.',
    missingPlanDetail:
      'Would install Python 3.12 through Homebrew for OCR tooling.',
    title: 'Python 3.12',
  }
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

    return {
      arch,
      bootstrap:
        bootstrap === null
          ? null
          : {
              ...bootstrap,
              vault: redactHomePath(bootstrap.vault, homeDirectory),
            },
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

function resolveEffectiveTopLevelToken(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) {
      continue
    }

    if (token === '--') {
      return args[index + 1] ?? null
    }

    if (!token.startsWith('-')) {
      return token
    }

    if (rootOptionsWithValues.has(token)) {
      index += 1
      continue
    }
  }

  return null
}

export function isSetupInvocation(
  args: string[],
  programName = 'vault-cli',
): boolean {
  const commandToken = resolveEffectiveTopLevelToken(args)
  if (commandToken === 'setup') {
    return true
  }

  if (programName !== 'healthybob') {
    return false
  }

  return commandToken === null || commandToken === 'help'
}

function createStep(input: {
  id: string
  title: string
  kind: SetupStepKind
  status: SetupStepStatus
  detail: string
}): SetupStepResult {
  return {
    detail: input.detail,
    id: input.id,
    kind: input.kind,
    status: input.status,
    title: input.title,
  }
}

async function ensureHomebrew(input: {
  arch: string
  dryRun: boolean
  env: NodeJS.ProcessEnv
  log: (message: string) => void
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
}): Promise<BrewState> {
  let brewCommand = await resolveExecutablePath(
    ['brew'],
    input.env,
    preferredBrewCommandPaths(input.arch),
  )

  if (brewCommand) {
    input.steps.push(
      createStep({
        detail: `Reusing Homebrew at ${brewCommand}.`,
        id: 'homebrew',
        kind: 'install',
        status: 'reused',
        title: 'Homebrew',
      }),
    )
    return {
      available: true,
      brewCommand,
      env: withPrependedPath(input.env, [path.dirname(brewCommand)]),
    }
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: 'Would install Homebrew through the official installer.',
        id: 'homebrew',
        kind: 'install',
        status: 'planned',
        title: 'Homebrew',
      }),
    )
    return {
      available: false,
      brewCommand: null,
      env: input.env,
    }
  }

  input.log('Installing Homebrew via the official installer...')
  const installResult = await input.runCommand({
    args: ['-lc', BREW_INSTALL_COMMAND],
    env: input.env,
    file: '/bin/bash',
  })
  assertCommandSucceeded(installResult, 'homebrew_install_failed', {
    command: '/bin/bash -lc <homebrew install>',
  })

  brewCommand = await resolveExecutablePath(
    ['brew'],
    input.env,
    preferredBrewCommandPaths(input.arch),
  )

  if (!brewCommand) {
    throw new VaultCliError(
      'homebrew_install_failed',
      'Homebrew installation completed, but the brew command could not be found afterwards.',
    )
  }

  input.steps.push(
    createStep({
      detail: `Installed Homebrew at ${brewCommand}.`,
      id: 'homebrew',
      kind: 'install',
      status: 'completed',
      title: 'Homebrew',
    }),
  )

  return {
    available: true,
    brewCommand,
    env: withPrependedPath(input.env, [path.dirname(brewCommand)]),
  }
}

async function ensureBrewFormula(input: {
  brewState: BrewState
  commandCandidates: string[]
  dryRun: boolean
  formula: string
  id: string
  installDetail: string
  kind: SetupStepKind
  missingPlanDetail: string
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
  title: string
}): Promise<FormulaInstallResult> {
  if (!input.brewState.available || !input.brewState.brewCommand) {
    input.steps.push(
      createStep({
        detail: input.missingPlanDetail,
        id: input.id,
        kind: input.kind,
        status: 'planned',
        title: input.title,
      }),
    )
    return {
      command: null,
      env: input.brewState.env,
    }
  }

  const installed = await isBrewFormulaInstalled(
    input.brewState.brewCommand,
    input.formula,
    input.brewState.env,
    input.runCommand,
  )

  if (!installed && input.dryRun) {
    input.steps.push(
      createStep({
        detail: input.missingPlanDetail,
        id: input.id,
        kind: input.kind,
        status: 'planned',
        title: input.title,
      }),
    )
    return {
      command: null,
      env: input.brewState.env,
    }
  }

  if (!installed) {
    const installResult = await input.runCommand({
      args: ['install', input.formula],
      env: input.brewState.env,
      file: input.brewState.brewCommand,
    })
    assertCommandSucceeded(installResult, 'brew_install_failed', {
      formula: input.formula,
    })
  }

  const envWithFormula = await withFormulaBinPath(
    input.brewState.brewCommand,
    input.formula,
    input.brewState.env,
    input.runCommand,
  )
  const command = await resolveExecutablePath(
    input.commandCandidates,
    envWithFormula,
  )

  if (!command && !input.dryRun) {
    throw new VaultCliError(
      'formula_command_missing',
      `${input.title} was installed, but no executable could be resolved afterwards.`,
      {
        commandCandidates: input.commandCandidates,
        formula: input.formula,
      },
    )
  }

  input.steps.push(
    createStep({
      detail:
        command && installed
          ? `Reusing ${input.title} from ${command}.`
          : input.installDetail,
      id: input.id,
      kind: input.kind,
      status: installed ? 'reused' : 'completed',
      title: input.title,
    }),
  )

  return {
    command,
    env: envWithFormula,
  }
}

async function ensureWhisperModel(input: {
  destinationPath: string
  dryRun: boolean
  downloadFile: (url: string, destinationPath: string) => Promise<void>
  downloadUrl: string
  fileExists: (absolutePath: string) => Promise<boolean>
  id: string
  model: WhisperModel
  steps: SetupStepResult[]
  title: string
}): Promise<void> {
  const alreadyPresent = await hasNonEmptyFile(input.destinationPath, input.fileExists)
  if (alreadyPresent) {
    input.steps.push(
      createStep({
        detail: `Reusing Whisper model ${input.model} at ${input.destinationPath}.`,
        id: input.id,
        kind: 'download',
        status: 'reused',
        title: input.title,
      }),
    )
    return
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: `Would download Whisper model ${input.model} to ${input.destinationPath}.`,
        id: input.id,
        kind: 'download',
        status: 'planned',
        title: input.title,
      }),
    )
    return
  }

  await mkdir(path.dirname(input.destinationPath), { recursive: true })
  await input.downloadFile(input.downloadUrl, input.destinationPath)

  input.steps.push(
    createStep({
      detail: `Downloaded Whisper model ${input.model} to ${input.destinationPath}.`,
      id: input.id,
      kind: 'download',
      status: 'completed',
      title: input.title,
    }),
  )
}

async function ensurePaddleXOcr(input: {
  dryRun: boolean
  env: NodeJS.ProcessEnv
  fileExists: (absolutePath: string) => Promise<boolean>
  pythonCommand: string | null
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
  toolchainRoot: string
}): Promise<string | null> {
  const venvRoot = path.join(input.toolchainRoot, 'venvs', PADDLEX_VENV_NAME)
  const paddlexCommand = path.join(venvRoot, 'bin', 'paddlex')
  const venvPython = path.join(venvRoot, 'bin', 'python')

  if (await input.fileExists(paddlexCommand)) {
    input.steps.push(
      createStep({
        detail: `Reusing PaddleX OCR from ${paddlexCommand}.`,
        id: 'paddlex-ocr',
        kind: 'install',
        status: 'reused',
        title: 'PaddleX OCR',
      }),
    )
    return paddlexCommand
  }

  if (input.dryRun) {
    input.steps.push(
      createStep({
        detail: `Would create ${venvRoot} and install paddlepaddle plus ${PADDLEX_REQUIREMENT}.`,
        id: 'paddlex-ocr',
        kind: 'install',
        status: 'planned',
        title: 'PaddleX OCR',
      }),
    )
    return null
  }

  if (!input.pythonCommand) {
    throw new VaultCliError(
      'python_command_missing',
      'Python 3.12 was expected for OCR setup, but no Python command was resolved.',
    )
  }

  await mkdir(path.dirname(venvRoot), { recursive: true })
  if (!(await input.fileExists(venvPython))) {
    const venvResult = await input.runCommand({
      args: ['-m', 'venv', venvRoot],
      env: input.env,
      file: input.pythonCommand,
    })
    assertCommandSucceeded(venvResult, 'python_venv_failed', {
      venvRoot,
    })
  }

  const upgradePipResult = await input.runCommand({
    args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
    env: input.env,
    file: venvPython,
  })
  assertCommandSucceeded(upgradePipResult, 'pip_install_failed', {
    package: 'pip setuptools wheel',
  })

  const installOcrResult = await input.runCommand({
    args: ['-m', 'pip', 'install', 'paddlepaddle', PADDLEX_REQUIREMENT],
    env: input.env,
    file: venvPython,
  })
  assertCommandSucceeded(installOcrResult, 'pip_install_failed', {
    package: `paddlepaddle ${PADDLEX_REQUIREMENT}`,
  })

  if (!(await input.fileExists(paddlexCommand))) {
    throw new VaultCliError(
      'paddlex_install_failed',
      'PaddleX OCR installation completed, but the paddlex command was not created.',
      {
        paddlexCommand,
      },
    )
  }

  input.steps.push(
    createStep({
      detail: `Installed PaddleX OCR in ${venvRoot}.`,
      id: 'paddlex-ocr',
      kind: 'install',
      status: 'completed',
      title: 'PaddleX OCR',
    }),
  )

  return paddlexCommand
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

async function isBrewFormulaInstalled(
  brewCommand: string,
  formula: string,
  env: NodeJS.ProcessEnv,
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>,
): Promise<boolean> {
  const result = await runCommand({
    args: ['list', '--versions', formula],
    env,
    file: brewCommand,
  })
  return result.exitCode === 0 && result.stdout.trim().length > 0
}

async function withFormulaBinPath(
  brewCommand: string,
  formula: string,
  env: NodeJS.ProcessEnv,
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>,
): Promise<NodeJS.ProcessEnv> {
  const prefixResult = await runCommand({
    args: ['--prefix', formula],
    env,
    file: brewCommand,
  })

  if (prefixResult.exitCode !== 0) {
    return env
  }

  const formulaPrefix = prefixResult.stdout.trim()
  if (formulaPrefix.length === 0) {
    return env
  }

  return withPrependedPath(env, [path.join(formulaPrefix, 'bin')])
}

async function resolveExecutablePath(
  candidates: string[],
  env: NodeJS.ProcessEnv,
  absoluteFallbacks: string[] = [],
): Promise<string | null> {
  for (const candidate of [...absoluteFallbacks, ...candidates]) {
    const normalized = candidate.trim()
    if (normalized.length === 0) {
      continue
    }

    if (isExplicitPath(normalized)) {
      if (await isExecutable(normalized)) {
        return normalized
      }
      continue
    }

    for (const segment of listPathSegments(env.PATH)) {
      const absolutePath = path.join(segment, normalized)
      if (await isExecutable(absolutePath)) {
        return absolutePath
      }
    }
  }

  return null
}

function withPrependedPath(
  env: NodeJS.ProcessEnv,
  entries: string[],
): NodeJS.ProcessEnv {
  const currentEntries = listPathSegments(env.PATH)
  const nextEntries = [
    ...entries.filter((entry) => entry.length > 0),
    ...currentEntries,
  ]
  const seen = new Set<string>()
  const deduped = nextEntries.filter((entry) => {
    if (seen.has(entry)) {
      return false
    }
    seen.add(entry)
    return true
  })

  return {
    ...env,
    PATH: deduped.join(path.delimiter),
  }
}

function preferredBrewCommandPaths(arch: string): string[] {
  return arch === 'arm64'
    ? ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
    : ['/usr/local/bin/brew', '/opt/homebrew/bin/brew']
}

function redactNullableHomePath(
  value: string | null,
  homeDirectory: string,
): string | null {
  return value === null ? null : redactHomePath(value, homeDirectory)
}

function redactHomePath(value: string, homeDirectory: string): string {
  const normalizedValue = path.resolve(value)
  const normalizedHome = path.resolve(homeDirectory)

  if (normalizedValue === normalizedHome) {
    return '~'
  }

  if (normalizedValue.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~${normalizedValue.slice(normalizedHome.length)}`
  }

  return value
}

function redactHomePathInText(text: string, homeDirectory: string): string {
  const normalizedHome = path.resolve(homeDirectory)
  const escapedHome = escapeRegExp(normalizedHome)
  return text.replace(new RegExp(escapedHome, 'g'), '~')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function listPathSegments(pathValue: string | undefined): string[] {
  return (pathValue ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function isExplicitPath(candidate: string): boolean {
  return candidate.includes(path.sep) || path.isAbsolute(candidate)
}

async function isExecutable(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function hasNonEmptyFile(
  absolutePath: string,
  fileExists: (absolutePath: string) => Promise<boolean>,
): Promise<boolean> {
  if (!(await fileExists(absolutePath))) {
    return false
  }

  const fileStat = await stat(absolutePath)
  return fileStat.isFile() && fileStat.size > 0
}

function assertCommandSucceeded(
  result: CommandRunResult,
  code: string,
  details?: Record<string, unknown>,
): void {
  if (result.exitCode === 0) {
    return
  }

  throw new VaultCliError(
    code,
    result.stderr.trim().length > 0
      ? result.stderr.trim()
      : result.stdout.trim().length > 0
        ? result.stdout.trim()
        : 'External setup command failed.',
    {
      ...(details ?? {}),
      exitCode: result.exitCode,
    },
  )
}

function createDefaultCommandRunner(
  log: (message: string) => void,
): (input: CommandRunInput) => Promise<CommandRunResult> {
  return async (input: CommandRunInput) => {
    return await new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(input.file, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        stdout = appendOutput(stdout, text)
        if (text.trim().length > 0) {
          log(text)
        }
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        stderr = appendOutput(stderr, text)
        if (text.trim().length > 0) {
          log(text)
        }
      })
      child.on('error', reject)
      child.on('close', (exitCode) => {
        resolve({
          exitCode: exitCode ?? 1,
          stderr,
          stdout,
        })
      })
    })
  }
}

function appendOutput(current: string, next: string): string {
  const combined = `${current}${next}`
  return combined.length <= 16000 ? combined : combined.slice(-16000)
}

async function defaultDownloadFile(
  url: string,
  destinationPath: string,
): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new VaultCliError(
      'download_failed',
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    )
  }

  const tempPath = `${destinationPath}.download`
  await mkdir(path.dirname(destinationPath), { recursive: true })

  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      createWriteStream(tempPath),
    )
    await rename(tempPath, destinationPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function defaultFileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

function defaultLogger(message: string): void {
  process.stderr.write(message.endsWith('\n') ? message : `${message}\n`)
}
