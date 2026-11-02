import {
  extractVaultOverride,
  type VaultOverrideParseResult,
} from './vault-cli-vault-argv.js'

const lazyRootCommands = [
  'allergy',
  'assistant',
  'assertion',
  'automation',
  'batch',
  'blood-test',
  'capture',
  'commons',
  'condition',
  'device',
  'clinical-note',
  'diagnostic-test',
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
  'route',
  'search',
  'show',
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

export function planVaultCliInvocation(
  args: readonly string[],
  input: {
    env?: NodeJS.ProcessEnv
  } = {},
): PlannedVaultCliInvocation {
  const vaultOverride = extractVaultOverride(args)
  const plan = classifyVaultCliInvocation(vaultOverride.argv, {
    env: input.env,
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

    return classifyRootToken(token)
  }

  if (sawRootDiscovery) {
    return {
      kind: 'full',
      reason: 'root-discovery',
    }
  }

  return {
    kind: 'full',
    reason: sawRootDiscovery ? 'root-discovery' : 'missing-root',
  }
}

function classifyRootToken(root: string): CliInvocationPlan {
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
