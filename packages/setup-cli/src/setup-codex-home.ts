import { constants as fsConstants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { prepareSetupPromptInput } from '@murphai/operator-config/setup-prompt-io'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const CODEX_HOME_MARKERS = ['auth.json', 'config.toml', 'sessions', 'archived_sessions'] as const
const MANUAL_SELECTION_VALUE = '__manual__'
const AMBIENT_SELECTION_VALUE = '__ambient__'
const DEFAULT_CODEX_HOME_DIRNAME = '.codex'

export interface SetupCodexHomeSelection {
  codexHome: string | null
  discoveredHomes: readonly string[]
}

interface ResolveSetupCodexHomeSelectionDependencies {
  env?: () => NodeJS.ProcessEnv
  getHomeDirectory?: () => string
}

export async function resolveSetupCodexHomeSelection(input: {
  allowPrompt: boolean
  currentCodexHome?: string | null
  explicitCodexHome?: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  dependencies?: ResolveSetupCodexHomeSelectionDependencies
}): Promise<SetupCodexHomeSelection> {
  const env = input.dependencies?.env?.() ?? process.env
  const homeDirectory =
    input.dependencies?.getHomeDirectory?.() ?? os.homedir()
  const currentCodexHome = normalizeCodexHomePath(
    input.currentCodexHome,
    homeDirectory,
  )
  const explicitCodexHome = normalizeCodexHomePath(
    input.explicitCodexHome,
    homeDirectory,
  )

  if (explicitCodexHome !== null) {
    const validatedCodexHome = await assertCodexHomeDirectory(
      explicitCodexHome,
      homeDirectory,
    )
    return {
      codexHome: validatedCodexHome,
      discoveredHomes: [],
    }
  }

  const selectableCurrentCodexHome =
    currentCodexHome &&
    await isReadableCodexHomeDirectory(currentCodexHome, homeDirectory)
      ? currentCodexHome
      : null

  if (!input.allowPrompt) {
    return {
      codexHome: currentCodexHome,
      discoveredHomes: [],
    }
  }

  const discoveredHomes = await discoverCodexHomes({
    env,
    homeDirectory,
  })
  const ambientCodexHome = resolveAmbientCodexHomePath({
    env,
    homeDirectory,
  })
  const selectableHomes = mergeSelectableCodexHomes({
    ambientCodexHome,
    currentCodexHome: selectableCurrentCodexHome,
    discoveredHomes,
  })
  const selectedValue = await promptForCodexHomeSelection({
    ambientCodexHome,
    currentCodexHome,
    input: input.input,
    output: input.output,
    selectableHomes,
  })

  if (selectedValue === AMBIENT_SELECTION_VALUE) {
    return {
      codexHome: null,
      discoveredHomes,
    }
  }

  const codexHome =
    selectedValue === MANUAL_SELECTION_VALUE
      ? await promptForManualCodexHome({
          currentCodexHome,
          homeDirectory,
          input: input.input,
          output: input.output,
        })
      : selectedValue

  await assertCodexHomeDirectory(codexHome, homeDirectory)
  return {
    codexHome,
    discoveredHomes,
  }
}

export async function discoverCodexHomes(input?: {
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
}): Promise<string[]> {
  const homeDirectory = input?.homeDirectory ?? os.homedir()
  const entries = await readdir(homeDirectory, {
    withFileTypes: true,
  }).catch(() => [])
  const ambientCodexHome = resolveAmbientCodexHomePath({
    env: input?.env ?? process.env,
    homeDirectory,
  })
  const discovered = new Set<string>()

  for (const entry of entries) {
    if (!entry.isDirectory() || !looksLikeCodexHomeDirectoryName(entry.name)) {
      continue
    }

    const candidatePath = path.join(homeDirectory, entry.name)
    if (candidatePath === ambientCodexHome) {
      continue
    }

    if (await hasCodexHomeMarkers(candidatePath)) {
      discovered.add(candidatePath)
    }
  }

  return [...discovered].sort((left, right) => left.localeCompare(right))
}

function normalizeCodexHomePath(
  filePath: string | null | undefined,
  homeDirectory: string,
): string | null {
  const normalized = filePath?.trim()
  if (!normalized) {
    return null
  }

  if (normalized === '~') {
    return homeDirectory
  }

  if (normalized.startsWith(`~${path.sep}`)) {
    return path.resolve(homeDirectory, normalized.slice(2))
  }

  return path.resolve(normalized)
}

function resolveAmbientCodexHomePath(input: {
  env: NodeJS.ProcessEnv
  homeDirectory: string
}): string {
  return (
    normalizeCodexHomePath(input.env.CODEX_HOME, input.homeDirectory) ??
    path.join(input.homeDirectory, DEFAULT_CODEX_HOME_DIRNAME)
  )
}

async function assertCodexHomeDirectory(
  candidatePath: string | null | undefined,
  homeDirectory: string,
): Promise<string> {
  const resolvedPath = normalizeCodexHomePath(candidatePath, homeDirectory)
  if (!resolvedPath) {
    throw new VaultCliError(
      'invalid_option',
      'Codex home must be an existing directory.',
    )
  }

  let candidateStats
  try {
    await access(
      resolvedPath,
      fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK,
    )
    candidateStats = await stat(resolvedPath)
  } catch {
    throw new VaultCliError(
      'invalid_option',
      `Codex home must be an existing directory: ${resolvedPath}`,
    )
  }

  if (!candidateStats.isDirectory()) {
    throw new VaultCliError(
      'invalid_option',
      `Codex home must be an existing directory: ${resolvedPath}`,
    )
  }

  return resolvedPath
}

function looksLikeCodexHomeDirectoryName(directoryName: string): boolean {
  return /^\.?codex(?:[-_.].+)?$/iu.test(directoryName)
}

async function hasCodexHomeMarkers(candidatePath: string): Promise<boolean> {
  for (const marker of CODEX_HOME_MARKERS) {
    try {
      await access(path.join(candidatePath, marker))
      return true
    } catch {
      continue
    }
  }

  return false
}

function mergeSelectableCodexHomes(input: {
  ambientCodexHome: string
  currentCodexHome: string | null
  discoveredHomes: readonly string[]
}): string[] {
  const merged = new Set<string>(input.discoveredHomes)
  if (
    input.currentCodexHome &&
    input.currentCodexHome !== input.ambientCodexHome
  ) {
    merged.add(input.currentCodexHome)
  }
  return [...merged].sort((left, right) => left.localeCompare(right))
}

async function promptForCodexHomeSelection(input: {
  ambientCodexHome: string
  currentCodexHome: string | null
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  selectableHomes: readonly string[]
}): Promise<string> {
  prepareSetupPromptInput(input.input)
  const rl = readline.createInterface({
    input: input.input,
    output: input.output,
  })

  const options = [
    AMBIENT_SELECTION_VALUE,
    ...input.selectableHomes,
    MANUAL_SELECTION_VALUE,
  ]
  const defaultChoice = resolveDefaultCodexHomeChoice({
    ambientCodexHome: input.ambientCodexHome,
    currentCodexHome: input.currentCodexHome,
    selectableHomes: input.selectableHomes,
  })

  try {
    input.output.write('\nSelect the Codex home Murph should use:\n')
    input.output.write(
      `  1. Ambient/default home (${input.ambientCodexHome})\n`,
    )

    for (const [index, selectableHome] of input.selectableHomes.entries()) {
      input.output.write(`  ${index + 2}. ${selectableHome}\n`)
    }

    input.output.write(
      `  ${input.selectableHomes.length + 2}. Enter a path manually\n`,
    )

    while (true) {
      const answer = (
        await rl.question(`Choice [${defaultChoice}]: `)
      ).trim()
      const selectedChoice = answer.length > 0 ? answer : defaultChoice
      const numericChoice = Number.parseInt(selectedChoice, 10)

      if (
        Number.isFinite(numericChoice) &&
        numericChoice >= 1 &&
        numericChoice <= options.length
      ) {
        return options[numericChoice - 1] ?? AMBIENT_SELECTION_VALUE
      }

      input.output.write(
        `Enter a number between 1 and ${options.length}.\n`,
      )
    }
  } finally {
    rl.close()
  }
}

function resolveDefaultCodexHomeChoice(input: {
  ambientCodexHome: string
  currentCodexHome: string | null
  selectableHomes: readonly string[]
}): string {
  if (!input.currentCodexHome || input.currentCodexHome === input.ambientCodexHome) {
    return '1'
  }

  const index = input.selectableHomes.findIndex(
    (candidate) => candidate === input.currentCodexHome,
  )
  if (index >= 0) {
    return String(index + 2)
  }

  return String(input.selectableHomes.length + 2)
}

async function promptForManualCodexHome(input: {
  currentCodexHome: string | null
  homeDirectory: string
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
}): Promise<string> {
  prepareSetupPromptInput(input.input)
  const rl = readline.createInterface({
    input: input.input,
    output: input.output,
  })

  try {
    while (true) {
      const suffix = input.currentCodexHome ? ` [${input.currentCodexHome}]` : ''
      const answer = await rl.question(`Codex home directory${suffix}: `)
      const nextValue =
        normalizeCodexHomePath(answer, input.homeDirectory) ??
        input.currentCodexHome

      if (!nextValue) {
        input.output.write('Enter an existing Codex home directory.\n')
        continue
      }

      try {
        return await assertCodexHomeDirectory(nextValue, input.homeDirectory)
      } catch (error) {
        input.output.write(`${String((error as Error).message)}\n`)
      }
    }
  } finally {
    rl.close()
  }
}

async function isReadableCodexHomeDirectory(
  candidatePath: string,
  homeDirectory: string,
): Promise<boolean> {
  try {
    await assertCodexHomeDirectory(candidatePath, homeDirectory)
    return true
  } catch {
    return false
  }
}
