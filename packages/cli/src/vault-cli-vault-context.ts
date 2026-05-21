import { Cli } from 'incur'
import { z } from 'zod'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface VaultCliVaultContext {
  current: string | null
  missingVaultMessage: string | null
}

export interface VaultOverrideParseResult {
  argv: string[]
  explicit: boolean
  vault: string | null
}

const DEFAULT_MISSING_VAULT_MESSAGE =
  'No vault was provided. Pass --vault <path> or select a default vault before running this command.'

const vaultContextRunWrapped = Symbol('murph.vaultContextRunWrapped')

type CommandMap = ReadonlyMap<string, unknown>
type CommandRun = (context: CommandRunContext) => unknown
type VaultOptionShape = z.ZodRawShape & {
  vault: z.ZodType
}

interface CommandRunContext {
  options: Record<string, unknown>
  [key: string]: unknown
}

interface CommandGroupEntry {
  _group: true
  commands: CommandMap
}

interface CommandDefinitionEntry {
  examples?: unknown
  options?: z.ZodObject<z.ZodRawShape>
  run: CommandRun
  usage?: unknown
  [vaultContextRunWrapped]?: true
}

export function createVaultCliVaultContext(
  vault: string | null = null,
): VaultCliVaultContext {
  return {
    current: vault,
    missingVaultMessage: null,
  }
}

export function installVaultCliVaultContext(
  cli: Cli.Cli,
  context: VaultCliVaultContext,
): void {
  const commands = Cli.toCommands.get(cli)
  if (commands !== undefined) {
    installVaultContextOnCommands(commands, context)
  }

  const serve = cli.serve.bind(cli)
  cli.serve = async (argv = process.argv.slice(2), options = {}) => {
    const parsed = extractVaultOverride(argv)
    const previousVault = context.current
    if (parsed.explicit) {
      context.current = parsed.vault
    }

    try {
      await serve(parsed.argv, options)
    } finally {
      context.current = previousVault
    }
  }
}

export function extractVaultOverride(
  args: readonly string[],
): VaultOverrideParseResult {
  const argv: string[] = []
  let vault: string | null = null
  let explicit = false

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === '--') {
      argv.push(...args.slice(index))
      break
    }

    if (token === '--vault') {
      if (explicit) {
        throw new VaultCliError(
          'invalid_option',
          'Pass --vault only once.',
        )
      }

      const value = args[index + 1]
      if (value === undefined || value === '--') {
        throw new VaultCliError(
          'invalid_option',
          'Missing value for --vault.',
        )
      }

      vault = value
      explicit = true
      index += 1
      continue
    }

    if (token?.startsWith('--vault=')) {
      if (explicit) {
        throw new VaultCliError(
          'invalid_option',
          'Pass --vault only once.',
        )
      }

      const value = token.slice('--vault='.length)
      if (value.length === 0) {
        throw new VaultCliError(
          'invalid_option',
          'Missing value for --vault.',
        )
      }

      vault = value
      explicit = true
      continue
    }

    if (token !== undefined) {
      argv.push(token)
    }
  }

  return {
    argv,
    explicit,
    vault,
  }
}

function installVaultContextOnCommands(
  commands: CommandMap,
  context: VaultCliVaultContext,
): void {
  for (const entry of commands.values()) {
    if (isCommandGroupEntry(entry)) {
      installVaultContextOnCommands(entry.commands, context)
      continue
    }

    if (!isCommandDefinitionEntry(entry) || !hasVaultOption(entry.options)) {
      continue
    }

    entry.options = entry.options.omit({ vault: true })
    entry.examples = stripVaultFromExamples(entry.examples)
    entry.usage = stripVaultFromExamples(entry.usage)

    if (entry[vaultContextRunWrapped]) {
      continue
    }

    const run = entry.run
    entry.run = (runContext) => {
      const vault = context.current
      if (vault === null || vault.length === 0) {
        throw new VaultCliError(
          'missing_vault',
          context.missingVaultMessage ?? DEFAULT_MISSING_VAULT_MESSAGE,
        )
      }

      return run({
        ...runContext,
        options: {
          ...runContext.options,
          vault,
        },
      })
    }
    entry[vaultContextRunWrapped] = true
  }
}

function hasVaultOption(
  options: z.ZodObject<z.ZodRawShape> | undefined,
): options is z.ZodObject<VaultOptionShape> {
  return options !== undefined && Object.hasOwn(options.shape, 'vault')
}

function isCommandGroupEntry(value: unknown): value is CommandGroupEntry {
  return isRecord(value) && value._group === true && value.commands instanceof Map
}

function isCommandDefinitionEntry(value: unknown): value is CommandDefinitionEntry {
  return isRecord(value) && typeof value.run === 'function'
}

function stripVaultFromExamples(examples: unknown): unknown {
  if (!Array.isArray(examples)) {
    return examples
  }

  let changed = false
  const nextExamples = examples.map((example) => {
    if (!isRecord(example) || !isRecord(example.options)) {
      return example
    }

    if (!Object.hasOwn(example.options, 'vault')) {
      return example
    }

    const nextOptions = { ...example.options }
    delete nextOptions.vault

    const nextExample = { ...example }
    if (Object.keys(nextOptions).length > 0) {
      nextExample.options = nextOptions
    } else {
      delete nextExample.options
    }

    changed = true
    return nextExample
  })

  return changed ? nextExamples : examples
}

function isRecord(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
