import { Buffer } from 'node:buffer'

import { Cli, Formatter, z } from 'incur'
import {
  emptyArgsSchema,
  resolveVaultCliCommandPath,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  VAULT_CLI_BATCH_RESULT_SCHEMA,
  VAULT_CLI_BATCH_MAX_COMMANDS,
  vaultCliBatchCommandErrorSchema,
  vaultCliBatchCommandResultEnvelopeSchema,
  vaultCliBatchResultEnvelopeSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { projectVaultCliError } from '@murphai/operator-config/vault-cli-error-projection'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const batchCommandOptionSchema = z.string().min(1)

export const batchRunResultSchema = vaultCliBatchResultEnvelopeSchema

type BatchCommandResult = z.output<
  typeof vaultCliBatchCommandResultEnvelopeSchema
>
type BatchChildRenderedFormat = 'md' | 'toon' | 'yaml'

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
        schema:
          VAULT_CLI_BATCH_RESULT_SCHEMA as typeof VAULT_CLI_BATCH_RESULT_SCHEMA,
        vault: options.vault,
        count: commands.length,
        requested: options.command.length,
        executed: commands.length,
        succeeded: commands.filter((command) => command.ok).length,
        stoppedEarly: commands.length < options.command.length,
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
    return invalidBatchCommand('Each --command value must be a JSON array of argv tokens.')
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((token) => typeof token !== 'string' || token.length === 0)
  ) {
    return invalidBatchCommand(
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
    return invalidBatchCommand('Batch commands cannot run MCP server mode.')
  }

  const commandPath = resolveVaultCliCommandPath(argv)
  const [root, subcommand] = commandPath

  if (root === 'batch') {
    return invalidBatchCommand('Nested batch commands are not supported.')
  }

  if (root === 'onboard') {
    return invalidBatchCommand('Batch commands cannot run onboarding setup.')
  }

  if (root === 'chat' || (root === 'assistant' && subcommand === 'chat')) {
    return invalidBatchCommand('Batch commands cannot run interactive assistant chat.')
  }

  const isAssistantRun =
    root === 'run' || (root === 'assistant' && subcommand === 'run')
  if (isAssistantRun) {
    return invalidBatchCommand('Batch commands cannot run assistant automation.')
  }
}

function invalidBatchCommand(message: string): never {
  throw new VaultCliError('invalid_option', message, {
    retryable: false,
    issues: [{ code: 'custom', publicPath: ['command'] }],
    stage: 'validation',
  })
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
  let renderedFormat: BatchChildRenderedFormat | null = null

  try {
    argv = prepareBatchCommandArgv(parseBatchCommandOption(input.command), input.vault)
    renderedFormat = resolveBatchChildRenderedFormat(argv)
    const executionArgv = renderedFormat
      ? forceBatchChildJsonOutput(argv)
      : argv
    process.exitCode = undefined
    const { runMurphCliAction } = await import('../cli-entry.js')
    await runMurphCliAction(executionArgv, {
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

    const internalOutput = stdout.join('')
    const parsedInternalOutput = parseJsonOutput(internalOutput)
    const output = renderedFormat && parsedInternalOutput.ok
      ? formatBatchChildOutput(parsedInternalOutput.data, renderedFormat)
      : internalOutput
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
    const internalOutput = stdout.join('')
    const parsedInternalOutput = parseJsonOutput(internalOutput)
    const output = renderedFormat && parsedInternalOutput.ok
      ? formatBatchChildOutput(parsedInternalOutput.data, renderedFormat)
      : internalOutput
    const parsedOutput = parseJsonOutput(output)
    const parsedChildError = parseChildCommandError(internalOutput)
    const childError = parsedChildError ?? projectBatchCommandError(error)
    return {
      index: input.index,
      argv,
      durationMs: elapsedMs(startedAt),
      ok: false,
      outputBytes: Buffer.byteLength(output, 'utf8'),
      outputChars: output.length,
      stdout:
        input.compact && parsedOutput.ok && parsedChildError !== null
          ? ''
          : output,
      error: childError,
    }
  } finally {
    process.exitCode = previousExitCode
  }
}

function resolveBatchChildRenderedFormat(
  argv: readonly string[],
): BatchChildRenderedFormat | null {
  if (hasBatchChildPresentationMode(argv)) {
    return null
  }

  let format: BatchChildRenderedFormat | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      break
    }
    if (token === '--json') {
      format = null
      continue
    }
    if (token === '--format') {
      format = batchChildRenderedFormat(argv[index + 1])
      index += 1
      continue
    }
    if (token?.startsWith('--format=')) {
      format = batchChildRenderedFormat(token.slice('--format='.length))
    }
  }

  return format
}

function batchChildRenderedFormat(
  value: string | undefined,
): BatchChildRenderedFormat | null {
  return value === 'md' || value === 'toon' || value === 'yaml'
    ? value
    : null
}

function hasBatchChildPresentationMode(argv: readonly string[]): boolean {
  return (
    hasToken(argv, '--help') ||
    hasToken(argv, '-h') ||
    hasToken(argv, '--llms') ||
    hasToken(argv, '--llms-full') ||
    hasToken(argv, '--schema')
  )
}

function forceBatchChildJsonOutput(argv: readonly string[]): string[] {
  const normalizedArgv: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      normalizedArgv.push(...argv.slice(index))
      break
    }
    if (token === '--json' || token?.startsWith('--format=')) {
      continue
    }
    if (token === '--format') {
      index += 1
      continue
    }
    if (token !== undefined) {
      normalizedArgv.push(token)
    }
  }

  insertDefaultOption(normalizedArgv, ['--format', 'json'])
  return normalizedArgv
}

function formatBatchChildOutput(
  output: unknown,
  format: BatchChildRenderedFormat,
): string {
  const rendered = Formatter.format(output, format)
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`
}

function parseChildCommandError(
  stdout: string,
): z.output<typeof vaultCliBatchCommandErrorSchema> | null {
  const parsedOutput = parseJsonOutput(stdout)
  if (!parsedOutput.ok || !parsedOutput.data || typeof parsedOutput.data !== 'object') {
    return null
  }

  const record = parsedOutput.data as Record<string, unknown>
  const parsedError = vaultCliBatchCommandErrorSchema.safeParse(record.error ?? record)
  return parsedError.success ? parsedError.data : null
}

function projectBatchCommandError(
  error: unknown,
): z.output<typeof vaultCliBatchCommandErrorSchema> {
  const projected = vaultCliBatchCommandErrorSchema.safeParse(projectVaultCliError(error))
  return projected.success
    ? projected.data
    : {
        code: 'UNKNOWN',
        message: 'The command failed without a safe recoverable detail.',
        retryable: false,
        stage: 'command',
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
