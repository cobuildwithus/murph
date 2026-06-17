import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  resolveEffectiveTopLevelToken,
  resolveRootOptionTokenWithValue,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'

const batchCommandOptionSchema = z.string().min(1)

const batchCommandResultSchema = z.object({
  index: z.number().int().nonnegative(),
  argv: z.array(z.string().min(1)),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  stdout: z.string(),
  data: z.unknown().optional(),
  error: z.object({
    message: z.string().min(1),
  }).optional(),
})

export const batchRunResultSchema = z.object({
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
      command: z.array(batchCommandOptionSchema).min(1).max(50),
      stopOnError: z.boolean().default(false),
    }),
    output: batchRunResultSchema,
    async run({ options }) {
      const commands: BatchCommandResult[] = []

      for (const [index, command] of options.command.entries()) {
        const result = await runBatchCommand({
          command,
          index,
          vault: options.vault,
        })
        commands.push(result)

        if (!result.ok && options.stopOnError) {
          break
        }
      }

      return {
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

  if (resolveEffectiveTopLevelToken(normalizedArgv) === 'batch') {
    throw new Error('Nested batch commands are not supported.')
  }

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

  const commandPath = readBatchCommandPath(argv)
  const [root, subcommand] = commandPath

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

function readBatchCommandPath(argv: readonly string[]): string[] {
  const commandPath: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token) {
      continue
    }

    if (token === '--') {
      const nextToken = argv[index + 1]
      return nextToken ? [nextToken] : commandPath
    }

    const rootOptionWithValue = resolveRootOptionTokenWithValue(token)
    if (rootOptionWithValue !== null) {
      if (!token.includes('=')) {
        index += 1
      }
      continue
    }

    if (isRootOptionWithoutValue(token)) {
      continue
    }

    if (token.startsWith('-')) {
      continue
    }

    commandPath.push(token)
    if (commandPath.length >= 2) {
      break
    }
  }

  return commandPath
}

function isRootOptionWithoutValue(token: string): boolean {
  return (
    token === '--full-output' ||
    token === '--json' ||
    token === '--no-config' ||
    token === '--token-count'
  )
}

async function runBatchCommand(input: {
  command: string
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
    return {
      index: input.index,
      argv,
      durationMs: elapsedMs(startedAt),
      ok: true,
      stdout: output,
      ...parseJsonOutput(output),
    }
  } catch (error) {
    return {
      index: input.index,
      argv,
      durationMs: elapsedMs(startedAt),
      ok: false,
      stdout: stdout.join(''),
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

function parseJsonOutput(stdout: string): { data?: unknown } {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return {}
  }

  try {
    return {
      data: JSON.parse(trimmed),
    }
  } catch {
    return {}
  }
}
