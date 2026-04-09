import {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from '../command-helpers.js'

export const TOP_LEVEL_COMMANDS_REQUIRING_VAULT = new Set([
  'allergy',
  'assistant',
  'audit',
  'automation',
  'blood-test',
  'chat',
  'condition',
  'doctor',
  'device',
  'document',
  'event',
  'experiment',
  'export',
  'family',
  'food',
  'genetics',
  'goal',
  'history',
  'inbox',
  'init',
  'intake',
  'intervention',
  'journal',
  'knowledge',
  'list',
  'meal',
  'memory',
  'profile',
  'provider',
  'recipe',
  'protocol',
  'research',
  'run',
  'samples',
  'search',
  'status',
  'stop',
  'supplement',
  'deepthink',
  'show',
  'timeline',
  'validate',
  'vault',
  'wearables',
  'workout',
])

const NON_EXECUTING_BUILTIN_FLAGS = new Set([
  '--help',
  '-h',
  '--llms',
  '--llms-full',
  '--mcp',
  '--schema',
  '--version',
])

const COMMAND_GROUP_PATHS_REQUIRING_SUBCOMMAND = new Set([
  'allergy',
  'assistant',
  'assistant session',
  'assistant self-target',
  'automation',
  'audit',
  'blood-test',
  'condition',
  'device',
  'device account',
  'device daemon',
  'device provider',
  'document',
  'event',
  'experiment',
  'export',
  'export pack',
  'family',
  'food',
  'genetics',
  'goal',
  'history',
  'inbox',
  'inbox attachment',
  'inbox model',
  'inbox promote',
  'inbox source',
  'intake',
  'intervention',
  'journal',
  'knowledge',
  'knowledge index',
  'memory',
  'meal',
  'query',
  'query projection',
  'provider',
  'recipe',
  'protocol',
  'samples',
  'samples batch',
  'search',
  'supplement',
  'supplement compound',
  'vault',
  'wearables',
  'wearables activity',
  'wearables body',
  'wearables recovery',
  'wearables sleep',
  'wearables sources',
  'workout',
  'workout format',
])

const COMMAND_PATHS_EXEMPT_FROM_VAULT = new Set([
  'assistant self-target',
])

export function hasExplicitVaultOption(args: readonly string[]): boolean {
  for (const token of args) {
    if (token === '--') {
      return false
    }

    if (token === '--vault' || token.startsWith('--vault=')) {
      return true
    }
  }

  return false
}

export function applyDefaultVaultToArgs(
  args: readonly string[],
  vault: string | null,
): string[] {
  if (!vault || hasExplicitVaultOption(args) || hasNonExecutingBuiltinFlag(args)) {
    return [...args]
  }

  const topLevelToken = resolveEffectiveTopLevelToken(args)
  if (!topLevelToken || !TOP_LEVEL_COMMANDS_REQUIRING_VAULT.has(topLevelToken)) {
    return [...args]
  }

  if (hasVaultExemptCommandPath(args)) {
    return [...args]
  }

  if (hasIncompleteCommandGroupPath(args)) {
    return [...args]
  }

  const separatorIndex = args.indexOf('--')
  if (separatorIndex < 0) {
    return [...args, '--vault', vault]
  }

  return [
    ...args.slice(0, separatorIndex),
    '--vault',
    vault,
    ...args.slice(separatorIndex),
  ]
}

function hasNonExecutingBuiltinFlag(args: readonly string[]): boolean {
  return args.some((token) => NON_EXECUTING_BUILTIN_FLAGS.has(token))
}

function hasIncompleteCommandGroupPath(args: readonly string[]): boolean {
  const commandPath = getCommandPath(args)
  if (commandPath === null) {
    return false
  }

  return COMMAND_GROUP_PATHS_REQUIRING_SUBCOMMAND.has(commandPath)
}

function hasVaultExemptCommandPath(args: readonly string[]): boolean {
  const commandPath = getCommandPath(args)
  if (commandPath === null) {
    return false
  }

  return [...COMMAND_PATHS_EXEMPT_FROM_VAULT].some(
    (prefix) => commandPath === prefix || commandPath.startsWith(`${prefix} `),
  )
}

function getCommandPath(args: readonly string[]): string | null {
  const commandTokens: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token || token === '--') {
      break
    }

    if (token.startsWith('-')) {
      if (commandTokens.length === 0 && ROOT_OPTIONS_WITH_VALUES.has(token)) {
        index += 1
        continue
      }

      break
    }

    commandTokens.push(token)
  }

  return commandTokens.length > 0 ? commandTokens.join(' ') : null
}
