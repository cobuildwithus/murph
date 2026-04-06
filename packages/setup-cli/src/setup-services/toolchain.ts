import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  SetupStepKind,
  SetupStepResult,
  WhisperModel,
} from '@murphai/operator-config/setup-cli-contracts'
import {
  assertCommandSucceeded,
  isExecutable,
  type CommandRunInput,
  type CommandRunResult,
} from './process.js'
import {
  BREW_INSTALL_COMMAND,
  createStep,
} from './steps.js'
import { hasNonEmptyFile } from './shell.js'

export interface BrewState {
  available: boolean
  brewCommand: string | null
  env: NodeJS.ProcessEnv
}

export interface FormulaInstallResult {
  command: string | null
  env: NodeJS.ProcessEnv
}

export async function ensureHomebrew(input: {
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

export async function ensureBrewFormula(input: {
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

export async function ensureWhisperModel(input: {
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

export async function resolveExecutablePath(
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

export function withPrependedPath(
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

function listPathSegments(pathValue: string | undefined): string[] {
  return (pathValue ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function isExplicitPath(candidate: string): boolean {
  return candidate.includes(path.sep) || path.isAbsolute(candidate)
}
