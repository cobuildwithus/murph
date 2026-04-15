import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOperatorHomeDirectory } from '@murphai/operator-config/operator-config'

const DEFAULT_USER_BIN_SEGMENTS = ['.local', 'bin'] as const

export interface AssistantCliAccessContext {
  env: NodeJS.ProcessEnv
  rawCommand: 'vault-cli'
  setupCommand: 'murph'
}

export function resolveAssistantCliAccessContext(
  env: NodeJS.ProcessEnv = process.env,
): AssistantCliAccessContext {
  return {
    env,
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  }
}

export function buildAssistantCliGuidanceText(
  access: Pick<AssistantCliAccessContext, 'rawCommand' | 'setupCommand'>,
): string {
  return [
    `\`${access.rawCommand}\` is the canonical Murph CLI. \`${access.setupCommand}\` is the setup entrypoint and also exposes the same top-level \`chat\` and \`run\` aliases after setup.`,
    'Prefer the bound assistant tools when they are available. Otherwise use the matching canonical CLI command. Do not edit canonical vault files directly through shell or file tools.',
  ].join('\n\n')
}

export function prepareAssistantDirectCliEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const homeDirectory = resolveOperatorHomeDirectory(env)
  const userBinDirectory = path.join(homeDirectory, ...DEFAULT_USER_BIN_SEGMENTS)
  return withPrependedPath(env, [userBinDirectory, ...resolveAssistantCliBinPathEntries()])
}

function resolveAssistantCliBinPathEntries(): string[] {
  const packageRoot = resolveAssistantCliPackageRoot()
  if (!packageRoot) {
    return []
  }

  return [
    path.join(packageRoot, 'node_modules', '.bin'),
    path.resolve(packageRoot, '../../node_modules/.bin'),
    ...resolveAncestorNodeModulesBinPaths(packageRoot, 2),
  ]
}

function resolveAssistantCliPackageRoot(): string | null {
  if (typeof import.meta.url !== 'string' || import.meta.url.length === 0) {
    return null
  }

  try {
    return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    return null
  }
}

function resolveAncestorNodeModulesBinPaths(
  startDirectory: string,
  maxEntries: number,
): string[] {
  const entries: string[] = []
  let currentDirectory = startDirectory

  while (entries.length < maxEntries) {
    if (path.basename(currentDirectory) === 'node_modules') {
      entries.push(path.join(currentDirectory, '.bin'))
    }

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      break
    }

    currentDirectory = parentDirectory
  }

  return entries
}

function withPrependedPath(
  env: NodeJS.ProcessEnv,
  entries: readonly string[],
): NodeJS.ProcessEnv {
  const currentEntries = listPathSegments(env.PATH)
  const nextEntries = [...entries.filter((entry) => entry.length > 0), ...currentEntries]
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

function listPathSegments(pathValue: string | undefined): string[] {
  if (!pathValue || pathValue.trim().length === 0) {
    return []
  }

  return pathValue
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}
