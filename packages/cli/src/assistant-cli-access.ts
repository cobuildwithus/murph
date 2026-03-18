import path from 'node:path'
import { resolveOperatorHomeDirectory } from './operator-config.js'

const DEFAULT_USER_BIN_SEGMENTS = ['.local', 'bin'] as const

export interface AssistantCliAccessContext {
  env: NodeJS.ProcessEnv
  rawCommand: 'vault-cli'
  setupCommand: 'healthybob'
}

export function resolveAssistantCliAccessContext(
  env: NodeJS.ProcessEnv = process.env,
): AssistantCliAccessContext {
  const homeDirectory = resolveOperatorHomeDirectory(env)
  const userBinDirectory = path.join(homeDirectory, ...DEFAULT_USER_BIN_SEGMENTS)

  return {
    env: withPrependedPath(env, [userBinDirectory]),
    rawCommand: 'vault-cli',
    setupCommand: 'healthybob',
  }
}

export function buildAssistantCliGuidanceText(
  access: Pick<AssistantCliAccessContext, 'rawCommand' | 'setupCommand'>,
): string {
  return [
    `The raw Healthy Bob CLI is available in this session through the existing Incur command surface. Use \`${access.rawCommand}\` for vault and inbox operations. Use \`${access.setupCommand}\` only for setup-oriented flows.`,
    `Do not rely on this prompt for command semantics. Start with the narrowest CLI discovery that answers the user: use \`${access.rawCommand} <command> --help\` for syntax and examples, \`${access.rawCommand} <command> --schema --format json\` when you need exact flags or output shapes, and \`${access.rawCommand} --llms\` or \`${access.rawCommand} --llms-full\` only for broad CLI discovery.`,
    'When a user asks you to inspect or operate through Healthy Bob, prefer using the CLI directly over manually inferring behavior from files alone.',
  ].join('\n\n')
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
