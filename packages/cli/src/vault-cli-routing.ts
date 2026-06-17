import path from 'node:path'

import {
  extractVaultOverride,
  type VaultOverrideParseResult,
} from './vault-cli-vault-argv.js'

export type VaultCliProgramName = 'murph' | 'vault-cli'

const lazyRootCommands = [
  'assistant',
  'automation',
  'batch',
  'blood-test',
  'chat',
  'commons',
  'device',
  'doctor',
  'encounter',
  'experiment',
  'exercise',
  'goal',
  'immunization',
  'init',
  'list',
  'meal',
  'medication',
  'measurement',
  'memory',
  'protocol',
  'query',
  'regimen',
  'run',
  'search',
  'show',
  'status',
  'stop',
  'supplement',
  'timeline',
  'validate',
  'vault',
  'wearables',
] as const
const lazyRootCommandSet = new Set<string>(lazyRootCommands)

export type KnownLazyRootCommand = (typeof lazyRootCommands)[number]

export type CliInvocationPlan =
  | { kind: 'setup' }
  | { kind: 'scoped'; root: KnownLazyRootCommand }
  | { kind: 'full'; reason: string }

export interface PlannedVaultCliInvocation {
  plan: CliInvocationPlan
  vaultOverride: VaultOverrideParseResult
}

const rootOptionsWithValues = new Set([
  '--config',
  '--filter-output',
  '--format',
  '--token-limit',
  '--token-offset',
])

const rootOptionsWithoutValues = new Set([
  '--full-output',
  '--json',
  '--no-config',
  '--token-count',
])

const rootDiscoveryFlags = new Set([
  '--help',
  '-h',
  '--llms',
  '--llms-full',
  '--mcp',
  '--schema',
])

export function detectCliProgramName(
  argv0: string | undefined,
  shimProgramName = process.env.SETUP_PROGRAM_NAME,
): VaultCliProgramName {
  const normalizedShimProgramName = shimProgramName?.trim().toLowerCase()
  if (normalizedShimProgramName === 'murph') {
    return 'murph'
  }

  const baseName = path.basename(argv0 ?? '').toLowerCase()
  return baseName === 'murph' ? 'murph' : 'vault-cli'
}

export function planVaultCliInvocation(
  args: readonly string[],
  input: {
    env?: NodeJS.ProcessEnv
    programName?: VaultCliProgramName
  } = {},
): PlannedVaultCliInvocation {
  const vaultOverride = extractVaultOverride(args)

  return {
    vaultOverride,
    plan: classifyVaultCliInvocation(vaultOverride.argv, {
      env: input.env,
      programName: input.programName,
    }),
  }
}

export function classifyVaultCliInvocation(
  argv: readonly string[],
  input: {
    env?: NodeJS.ProcessEnv
    programName?: VaultCliProgramName
  } = {},
): CliInvocationPlan {
  if (isCompletionEnvironment(input.env)) {
    return {
      kind: 'full',
      reason: 'completion-environment',
    }
  }

  const programName = input.programName ?? 'vault-cli'
  let sawRootDiscovery = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token) {
      continue
    }

    if (token === '--') {
      return {
        kind: 'full',
        reason: 'argument-terminator-before-root',
      }
    }

    if (rootDiscoveryFlags.has(token)) {
      sawRootDiscovery = true
      continue
    }

    if (isRootOptionWithValue(token)) {
      if (!token.includes('=')) {
        index += 1
      }
      continue
    }

    if (rootOptionsWithoutValues.has(token)) {
      continue
    }

    if (token.startsWith('-')) {
      return {
        kind: 'full',
        reason: 'unknown-leading-flag',
      }
    }

    if (sawRootDiscovery) {
      return {
        kind: 'full',
        reason: 'root-discovery-before-root',
      }
    }

    return classifyRootToken(token, programName)
  }

  if (sawRootDiscovery) {
    return {
      kind: 'full',
      reason: 'root-discovery',
    }
  }

  if (programName === 'murph') {
    return { kind: 'setup' }
  }

  return {
    kind: 'full',
    reason: sawRootDiscovery ? 'root-discovery' : 'missing-root',
  }
}

function classifyRootToken(
  root: string,
  programName: VaultCliProgramName,
): CliInvocationPlan {
  if (root === 'onboard') {
    return { kind: 'setup' }
  }

  if (programName === 'murph' && (root === 'help' || root === 'use')) {
    return { kind: 'setup' }
  }

  if (isKnownLazyRoot(root)) {
    return {
      kind: 'scoped',
      root,
    }
  }

  return {
    kind: 'full',
    reason: 'unknown-root',
  }
}

function isRootOptionWithValue(token: string): boolean {
  const optionToken = token.split('=', 1)[0] ?? token
  return rootOptionsWithValues.has(optionToken)
}

function isKnownLazyRoot(root: string): root is KnownLazyRootCommand {
  return lazyRootCommandSet.has(root)
}

function isCompletionEnvironment(env: NodeJS.ProcessEnv | undefined): boolean {
  if (env === undefined) {
    return false
  }

  return (
    env.COMP_LINE !== undefined ||
    env.COMP_POINT !== undefined ||
    env.COMP_WORDS !== undefined ||
    env.COMP_CWORD !== undefined ||
    env.COMPLETE !== undefined ||
    env._COMPLETE_INDEX !== undefined
  )
}
