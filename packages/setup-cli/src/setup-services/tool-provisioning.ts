import type {
  SetupStepResult,
  SetupTools,
  WhisperModel,
} from '@murphai/operator-config/setup-cli-contracts'
import {
  buildBaseFormulaSpecs,
  createStep,
  resolveWhisperModelPath,
  whisperModelDownloadUrl,
  type FormulaCommandKey,
  type ToolRequirementSpec,
} from './steps.js'
import {
  ensureBrewFormula,
  ensureHomebrew,
  ensureWhisperModel,
  resolveExecutablePath,
} from './toolchain.js'
import type {
  CommandRunInput,
  CommandRunResult,
} from './process.js'

/**
 * Tool provisioning owns the OS-specific ffmpeg/whisper install and
 * validation flow so setup-services.ts can stay focused on the higher-level
 * host setup sequence.
 */

interface SetupProvisioningInput {
  arch: string
  dryRun: boolean
  downloadFile: (url: string, destinationPath: string) => Promise<void>
  env: NodeJS.ProcessEnv
  fileExists: (absolutePath: string) => Promise<boolean>
  log: (message: string) => void
  notes: string[]
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
  toolchainRoot: string
  whisperModel: WhisperModel
}

interface SetupProvisioningResult {
  env: NodeJS.ProcessEnv
  tools: SetupTools
}

interface AptRunnerState {
  command: string | null
  baseArgs: string[]
  updateAttempted: boolean
}

interface AptInstallResult {
  apt: AptRunnerState
  reason: string | null
}

interface LinuxResolvedCommandContext {
  command: string
  env: NodeJS.ProcessEnv
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
}

export async function provisionHostToolchain(
  input: SetupProvisioningInput & {
    platform: 'darwin' | 'linux'
  },
): Promise<SetupProvisioningResult> {
  return input.platform === 'darwin'
    ? provisionMacosToolchain(input)
    : provisionLinuxToolchain(input)
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
    whisperCommand: null,
  }
  for (const requirement of buildBaseFormulaSpecs()) {
    const formulaResult = await ensureMacosToolRequirement({
      brewState: state,
      dryRun: input.dryRun,
      requirement,
      runCommand: input.runCommand,
      steps: input.steps,
    })
    state = {
      ...state,
      env: formulaResult.env,
    }
    formulaCommands[requirement.key] = formulaResult.command
  }

  const whisperModelPath = await ensureProvisionedWhisperModel(input)

  return {
    env: state.env,
    tools: {
      ffmpegCommand: formulaCommands.ffmpegCommand,
      whisperCommand: formulaCommands.whisperCommand,
      whisperModelPath,
    },
  }
}

async function provisionLinuxToolchain(
  input: SetupProvisioningInput,
): Promise<SetupProvisioningResult> {
  let apt = await resolveAptRunner(input.env)
  const resolvedCommands: Record<FormulaCommandKey, string | null> = {
    ffmpegCommand: null,
    whisperCommand: null,
  }
  for (const requirement of buildBaseFormulaSpecs()) {
    const resolved = await ensureLinuxToolRequirement({
      apt,
      dryRun: input.dryRun,
      env: input.env,
      notes: input.notes,
      requirement,
      runCommand: input.runCommand,
      steps: input.steps,
    })
    apt = resolved.apt
    resolvedCommands[requirement.key] = resolved.command
  }

  const whisperModelPath = await ensureProvisionedWhisperModel(input)

  return {
    env: input.env,
    tools: {
      ffmpegCommand: resolvedCommands.ffmpegCommand,
      whisperCommand: resolvedCommands.whisperCommand,
      whisperModelPath,
    },
  }
}

async function ensureProvisionedWhisperModel(
  input: SetupProvisioningInput,
): Promise<string> {
  const whisperModelPath = resolveWhisperModelPath(
    input.toolchainRoot,
    input.whisperModel,
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
  return whisperModelPath
}

async function ensureMacosToolRequirement(input: {
  brewState: {
    available: boolean
    brewCommand: string | null
    env: NodeJS.ProcessEnv
  }
  dryRun: boolean
  requirement: ToolRequirementSpec | Omit<ToolRequirementSpec, 'key'>
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
}): Promise<{
  command: string | null
  env: NodeJS.ProcessEnv
}> {
  const macos = input.requirement.macos
  return ensureBrewFormula({
    brewState: input.brewState,
    commandCandidates: input.requirement.commandCandidates,
    dryRun: input.dryRun,
    formula: macos.formula,
    id: input.requirement.id,
    installDetail: macos.installDetail,
    kind: 'install',
    missingPlanDetail: macos.missingPlanDetail,
    runCommand: input.runCommand,
    steps: input.steps,
    title: macos.title,
  })
}

async function ensureLinuxToolRequirement(input: {
  apt: AptRunnerState
  dryRun: boolean
  env: NodeJS.ProcessEnv
  notes: string[]
  requirement: ToolRequirementSpec | Omit<ToolRequirementSpec, 'key'>
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
  validateResolvedCommand?: (
    context: LinuxResolvedCommandContext,
  ) => Promise<boolean>
}): Promise<{
  apt: AptRunnerState
  command: string | null
}> {
  const linux = input.requirement.linux
  return ensureLinuxCommand({
    apt: input.apt,
    commandCandidates: input.requirement.commandCandidates,
    completedDetail: linux.completedDetail,
    dryRun: input.dryRun,
    env: input.env,
    id: input.requirement.id,
    installPackages: linux.installPackages,
    missingNoteDetail: linux.missingNoteDetail,
    missingStepDetail: linux.missingStepDetail,
    missingPlanDetail: linux.missingPlanDetail,
    notes: input.notes,
    reuseDetail: linux.reuseDetail,
    runCommand: input.runCommand,
    steps: input.steps,
    title: linux.title,
    validateResolvedCommand: input.validateResolvedCommand,
  })
}

async function ensureLinuxCommand(input: {
  apt: AptRunnerState
  commandCandidates: string[]
  completedDetail?: string
  dryRun: boolean
  env: NodeJS.ProcessEnv
  id: string
  installPackages: string[]
  missingNoteDetail?: string
  missingPlanDetail: string
  missingStepDetail: string
  notes: string[]
  reuseDetail?: (command: string) => string
  runCommand: (input: CommandRunInput) => Promise<CommandRunResult>
  steps: SetupStepResult[]
  title: string
  validateResolvedCommand?: (
    context: LinuxResolvedCommandContext,
  ) => Promise<boolean>
}): Promise<{
  apt: AptRunnerState
  command: string | null
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
  }
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
      updateAttempted: false,
    }
  }

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return {
      command: aptGet,
      baseArgs: [],
      updateAttempted: false,
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
      updateAttempted: false,
    }
  }

  return {
    command: sudo,
    baseArgs: ['-n', aptGet],
    updateAttempted: false,
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
    }
    if (updateResult.exitCode !== 0) {
      return {
        apt,
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
      reason: summarizeCommandFailure(
        installResult,
        `apt-get install failed for ${input.packages.join(', ')}.`,
      ),
    }
  }

  return {
    apt,
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
