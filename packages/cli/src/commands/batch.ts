import { Buffer } from 'node:buffer'

import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  resolveVaultCliCommandPath,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  pathSchema,
  VAULT_CLI_BATCH_MAX_COMMANDS,
  VAULT_CLI_BATCH_RESULT_SCHEMA,
} from '@murphai/operator-config/vault-cli-contracts'

const batchCommandOptionSchema = z.string().min(1)

const batchCommandResultSchema = z.object({
  index: z.number().int().nonnegative(),
  argv: z.array(z.string().min(1)),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  outputBytes: z.number().int().nonnegative().describe(
    'UTF-8 byte length of captured child stdout before compact mode may clear stdout.',
  ),
  outputChars: z.number().int().nonnegative().describe(
    'Legacy UTF-16 code-unit length of captured child stdout before compact mode may clear stdout.',
  ),
  stdout: z.string(),
  data: z.unknown().optional(),
  error: z.object({
    message: z.string().min(1),
  }).optional(),
})

export const batchRunResultSchema = z.object({
  schema: z.string().min(1),
  vault: pathSchema,
  count: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  commands: z.array(batchCommandResultSchema),
})

type BatchCommandResult = z.output<typeof batchCommandResultSchema>

export function registerBatchCommands(cli: Cli.Cli) {
  cli.command('batch', {
    description:
      'Run multiple vault-cli argv arrays in one process and return structured per-command results.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      command: z.array(batchCommandOptionSchema).min(1).max(
        VAULT_CLI_BATCH_MAX_COMMANDS,
      ),
      compact: z.boolean().default(false).describe(
        'Replace duplicate raw JSON output with an empty stdout string after successful parsing.',
      ),
      stopOnError: z.boolean().default(false),
    }),
    output: batchRunResultSchema,
    async run({ options }) {
      const commands: BatchCommandResult[] = []

      for (const [index, command] of options.command.entries()) {
        const result = await runBatchCommand({
          command,
          compact: options.compact,
          index,
          vault: options.vault,
        })
        commands.push(result)

        if (!result.ok && options.stopOnError) {
          break
        }
      }

      return {
        schema: VAULT_CLI_BATCH_RESULT_SCHEMA,
        vault: options.vault,
        count: commands.length,
        failed: commands.filter((command) => !command.ok).length,
        commands,
      }
    },
  })
}

function parseBatchCommandOption(value: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Each --command value must be a JSON array of argv tokens.')
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((token) => typeof token !== 'string' || token.length === 0)
  ) {
    throw new Error(
      'Each --command value must be a non-empty JSON array of non-empty string argv tokens.',
    )
  }

  return parsed
}

function prepareBatchCommandArgv(argv: readonly string[], vault: string): string[] {
  const normalizedArgv = [...argv]
  assertBatchCommandAllowed(normalizedArgv)

  if (!hasVaultOption(normalizedArgv)) {
    insertDefaultOption(normalizedArgv, ['--vault', vault])
  }

  if (!hasOutputModeOption(normalizedArgv)) {
    insertDefaultOption(normalizedArgv, ['--format', 'json'])
  }

  return normalizedArgv
}

function assertBatchCommandAllowed(argv: readonly string[]) {
  if (hasToken(argv, '--mcp')) {
    throw new Error('Batch commands cannot run MCP server mode.')
  }

  const commandPath = resolveVaultCliCommandPath(argv)
  const [root, subcommand] = commandPath

  if (root === 'batch') {
    throw new Error('Nested batch commands are not supported.')
  }

  if (root === 'onboard') {
    throw new Error('Batch commands cannot run onboarding setup.')
  }

  if (root === 'chat' || (root === 'assistant' && subcommand === 'chat')) {
    throw new Error('Batch commands cannot run interactive assistant chat.')
  }

  const isAssistantRun =
    root === 'run' || (root === 'assistant' && subcommand === 'run')
  if (isAssistantRun) {
    throw new Error('Batch commands cannot run assistant automation.')
  }
}

async function runBatchCommand(input: {
  command: string
  compact: boolean
  index: number
  vault: string
}): Promise<BatchCommandResult> {
  const startedAt = Date.now()
  const stdout: string[] = []
  const previousExitCode = process.exitCode
  let argv: string[] = []

  try {
    argv = prepareBatchCommandArgv(parseBatchCommandOption(input.command), input.vault)
    process.exitCode = undefined
    const { runMurphCliAction } = await import('../cli-entry.js')
    await runMurphCliAction(argv, {
      argv0: 'vault-cli',
      exit(code) {
        if (code && code !== 0) {
          throw new Error(`Command exited with status ${code}.`)
        }
      },
      stdout(chunk) {
        stdout.push(chunk)
      },
    })

    if (process.exitCode && process.exitCode !== 0) {
      throw new Error(`Command exited with status ${process.exitCode}.`)
    }

    const output = stdout.join('')
    const parsedOutput = parseJsonOutput(output)
    return {
      index: input.index,
      argv,
      durationMs: elapsedMs(startedAt),
      ok: true,
      outputBytes: Buffer.byteLength(output, 'utf8'),
      outputChars: output.length,
      stdout: input.compact && parsedOutput.ok ? '' : output,
      ...(parsedOutput.ok ? { data: parsedOutput.data } : {}),
    }
  } catch (error) {
    const output = stdout.join('')
    return {
      index: input.index,
      argv,
      durationMs: elapsedMs(startedAt),
      ok: false,
      outputBytes: Buffer.byteLength(output, 'utf8'),
      outputChars: output.length,
      stdout: output,
      error: {
        message: error instanceof Error ? error.message : 'Batch command failed.',
      },
    }
  } finally {
    process.exitCode = previousExitCode
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function hasVaultOption(argv: readonly string[]): boolean {
  return hasOption(argv, '--vault')
}

function hasOutputModeOption(argv: readonly string[]): boolean {
  return (
    hasOption(argv, '--format') ||
    hasToken(argv, '--json') ||
    hasToken(argv, '--help') ||
    hasToken(argv, '-h') ||
    hasToken(argv, '--llms') ||
    hasToken(argv, '--llms-full') ||
    hasToken(argv, '--schema')
  )
}

function hasOption(argv: readonly string[], optionName: string): boolean {
  for (const token of argv) {
    if (token === '--') {
      return false
    }

    if (token === optionName || token.startsWith(`${optionName}=`)) {
      return true
    }
  }

  return false
}

function hasToken(argv: readonly string[], expected: string): boolean {
  for (const token of argv) {
    if (token === '--') {
      return false
    }

    if (token === expected) {
      return true
    }
  }

  return false
}

function insertDefaultOption(argv: string[], option: readonly [string, string]) {
  const terminatorIndex = argv.indexOf('--')
  if (terminatorIndex === -1) {
    argv.push(...option)
    return
  }

  argv.splice(terminatorIndex, 0, ...option)
}

function parseJsonOutput(stdout: string):
  | {
      data: unknown
      ok: true
    }
  | {
      ok: false
    } {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return {
      ok: false,
    }
  }

  try {
    return {
      data: JSON.parse(trimmed),
      ok: true,
    }
  } catch {
    return {
      ok: false,
    }
  }
}
