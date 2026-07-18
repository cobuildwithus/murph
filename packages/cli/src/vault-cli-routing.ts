import path from 'node:path'

import {
  extractVaultOverride,
  type VaultOverrideParseResult,
} from './vault-cli-vault-argv.js'

export type VaultCliProgramName = 'murph' | 'vault-cli'

const lazyRootCommands = [
  'allergy',
  'assistant',
  'assertion',
  'automation',
  'batch',
  'blood-test',
  'capture',
  'chat',
  'commons',
  'condition',
  'device',
  'clinical-note',
  'diagnostic-test',
  'doctor',
  'encounter',
  'event',
  'experiment',
  'exercise',
  'food',
  'goal',
  'habitat',
  'immunization',
  'init',
  'journal',
  'knowledge',
  'list',
  'meal',
  'medication',
  'measurement',
  'memory',
  'protocol',
  'query',
  'regimen',
  'research',
  'route',
  'run',
  'search',
  'show',
  'status',
  'stop',
  'social-history',
  'supplement',
  'timeline',
  'validate',
  'vault',
  'vitals',
  'wearables',
  'workout',
] as const
const lazyRootCommandSet = new Set<string>(lazyRootCommands)

export type KnownLazyRootCommand = (typeof lazyRootCommands)[number]

export type CliInvocationPlan =
  | { kind: 'version' }
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
  const plan = classifyVaultCliInvocation(vaultOverride.argv, {
    env: input.env,
    programName: input.programName,
  })

  return {
    vaultOverride,
    plan:
      vaultOverride.explicit && plan.kind === 'version'
        ? { kind: 'full', reason: 'version-with-vault-override' }
        : plan,
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

  if (argv.length === 1 && argv[0] === '--version') {
    return { kind: 'version' }
  }

  if (hasEffectiveMcpFlag(argv)) {
    return {
      kind: 'full',
      reason: 'mcp-invocation',
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

export function hasEffectiveMcpFlag(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token) {
      continue
    }

    if (isRootOptionWithValue(token)) {
      if (!token.includes('=')) {
        index += 1
      }
      continue
    }

    if (token === '--mcp') {
      return true
    }
  }

  return false
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
