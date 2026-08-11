import { AsyncLocalStorage } from 'node:async_hooks'
import { Cli } from 'incur'
import type * as z from '@murphai/contracts/zod-runtime'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  extractVaultOverride,
  type VaultOverrideParseResult,
} from './vault-cli-vault-argv.js'

export interface VaultCliVaultContext {
  current: string | null
  missingVaultMessage: string | null
}

const DEFAULT_MISSING_VAULT_MESSAGE =
  'No vault was provided. Pass --vault <path> or select a default vault before running this command.'
const FETCH_VAULT_HEADER = 'x-murph-vault'

const invocationStorage = new AsyncLocalStorage<VaultCliInvocationContext>()
const installedClis = new WeakSet<Cli.Cli>()

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
}

interface VaultCliInvocationContext {
  missingVaultMessage: string | null
  vault: string | null
}

export function createVaultCliVaultContext(
  vault: string | null = null,
): VaultCliVaultContext {
  return {
    current: vault,
    missingVaultMessage: null,
  }
}

export { extractVaultOverride }

export function installVaultCliVaultContext(
  cli: Cli.Cli,
  context: VaultCliVaultContext,
): void {
  if (installedClis.has(cli)) {
    return
  }
  installedClis.add(cli)

  const commands = Cli.toCommands.get(cli)
  if (commands !== undefined) {
    installVaultContextOnCommands(commands, context)
  }

  const serve = cli.serve.bind(cli)
  cli.serve = async (argv = process.argv.slice(2), options = {}) => {
    const parsed = extractVaultOverride(argv)
    await invocationStorage.run(
      resolveInvocationContext(context, parsed.vault),
      () => serve(parsed.argv, options),
    )
  }

  if (typeof cli.fetch === 'function') {
    const fetch = cli.fetch.bind(cli)
    cli.fetch = async (request) => {
      let parsed: ReturnType<typeof extractFetchVaultOverride>
      try {
        parsed = extractFetchVaultOverride(request)
      } catch (error) {
        if (error instanceof VaultCliError) {
          return createFetchVaultErrorResponse(error)
        }
        throw error
      }
      return await invocationStorage.run(
        resolveInvocationContext(context, parsed.vault),
        () => fetch(parsed.request),
      )
    }
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

    const run = entry.run
    entry.run = (runContext) => {
      const invocationContext = invocationStorage.getStore()
      const vault = invocationContext?.vault ?? context.current
      if (vault === null || vault.length === 0) {
        throw new VaultCliError(
          'missing_vault',
          invocationContext?.missingVaultMessage ??
            context.missingVaultMessage ??
            DEFAULT_MISSING_VAULT_MESSAGE,
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
  }
}

function resolveInvocationContext(
  context: VaultCliVaultContext,
  vaultOverride: string | null,
): VaultCliInvocationContext {
  const currentInvocation = invocationStorage.getStore()

  return {
    missingVaultMessage:
      currentInvocation?.missingVaultMessage ?? context.missingVaultMessage,
    vault: vaultOverride ?? currentInvocation?.vault ?? context.current,
  }
}

function extractFetchVaultOverride(request: Request): {
  request: Request
  vault: string | null
} {
  const headerVault = request.headers.get(FETCH_VAULT_HEADER)
  const url = new URL(request.url)
  const queryVaults = url.searchParams.getAll('vault')
  let vault: string | null = null

  for (const value of [headerVault, ...queryVaults]) {
    if (value === null) {
      continue
    }

    if (vault !== null) {
      throw new VaultCliError('invalid_option', 'Pass vault only once.')
    }

    if (value.length === 0) {
      throw new VaultCliError('invalid_option', 'Missing value for vault.')
    }

    vault = value
  }

  if (queryVaults.length === 0) {
    return {
      request,
      vault,
    }
  }

  url.searchParams.delete('vault')
  return {
    request: new Request(url, request),
    vault,
  }
}

function createFetchVaultErrorResponse(error: VaultCliError): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    }),
    {
      status: 400,
      headers: {
        'content-type': 'application/json',
      },
    },
  )
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
