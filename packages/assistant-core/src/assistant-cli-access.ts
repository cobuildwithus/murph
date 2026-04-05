import path from 'node:path'
import { resolveOperatorHomeDirectory } from './operator-config.js'

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
    'Murph tools are the primary runtime surface in this session.',
    `\`${access.rawCommand}\` is the canonical Murph CLI for vault, inbox, and assistant operations. \`${access.setupCommand}\` is the setup entrypoint and also exposes the same top-level \`chat\` and \`run\` aliases after setup.`,
    `These CLIs are Incur-backed. Use exact known commands first instead of broad discovery. If the command path is unclear, start with \`${access.rawCommand} <command> --help\`. When you need exact args, options, or output, use \`${access.rawCommand} <command> --schema --format json\`. When you need parseable command results, prefer \`--format json\`. Use \`${access.rawCommand} --llms\` or \`${access.rawCommand} --llms-full\` only for broad discovery.`,
    'Do not guess command syntax from this prompt or from memory when the CLI can tell you directly.',
    'When the user asks you to inspect or operate through Murph, prefer the bound assistant tools first and otherwise map the request onto the canonical CLI surface instead of improvising from raw files.',
    'If a needed CLI action is unavailable through the bound tools in this session, give the user the exact command instead of pretending it already ran.',
    'Do not edit canonical vault files directly through shell or file tools. When Murph data needs to change, use the matching `vault-cli` write surface so validation and audit paths stay intact.',
  ].join('\n\n')
}

export function prepareAssistantDirectCliEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const homeDirectory = resolveOperatorHomeDirectory(env)
  const userBinDirectory = path.join(homeDirectory, ...DEFAULT_USER_BIN_SEGMENTS)
  return withPrependedPath(env, [userBinDirectory])
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
