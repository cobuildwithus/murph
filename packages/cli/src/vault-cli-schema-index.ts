import type { Cli } from 'incur'
import { estimateTokenCount, sliceByTokens } from 'tokenx'

type CliServeOptions = Parameters<Cli.Cli['serve']>[1]

interface CommandManifest {
  commands?: CommandManifestEntry[]
  version?: string
}

interface CommandManifestEntry {
  description?: string
  name?: string
}

interface SchemaIndexCommand {
  description?: string
  name: string
}

interface SchemaIndex {
  commands: SchemaIndexCommand[]
  command: string | null
  kind: 'group' | 'root'
  note: string
  version: 'murph.schema-index.v1'
}

interface SchemaIndexTokenControls {
  argv: string[]
  count: boolean
  limit?: number
  offset?: number
}

const SCHEMA_INDEX_NOTE =
  'This is a command index for a root or command group. Run one leaf command with --schema --format json for its args/options/output schema. File-body contracts for supported JSON/JSONL imports live under payload-schema commands.'

export function installVaultCliSchemaIndex(cli: Cli.Cli): void {
  const serve = cli.serve.bind(cli)

  cli.serve = async (argv = process.argv.slice(2), options = {}) => {
    if (!isJsonSchemaRequest(argv) || isHelpRequest(argv)) {
      await serve(argv, options)
      return
    }

    const tokenControls = extractTokenControls(argv)
    const originalResult = await captureServeOutput(
      serve,
      tokenControls.argv,
      options,
    )
    if (originalResult.exitCode !== null || parsesAsJson(originalResult.output)) {
      replayServeResult(originalResult, options)
      return
    }

    const commandPath = extractSchemaCommandPath(argv)
    const manifestResult = await captureServeOutput(
      serve,
      ['--llms-full', '--format', 'json', ...commandPath],
      options,
    )
    if (manifestResult.exitCode !== null) {
      replayServeResult(originalResult, options)
      return
    }

    const manifest = parseCommandManifest(manifestResult.output)
    if (!manifest) {
      replayServeResult(originalResult, options)
      return
    }

    writeStdout(
      options,
      renderSchemaIndex(buildSchemaIndex(commandPath, manifest), tokenControls),
    )
  }
}

async function captureServeOutput(
  serve: Cli.Cli['serve'],
  argv: string[],
  options: CliServeOptions | undefined,
): Promise<{
  exitCode: number | null
  output: string
}> {
  const output: string[] = []
  let exitCode: number | null = null

  await serve(argv, {
    ...options,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    exitCode,
    output: output.join(''),
  }
}

function replayServeResult(
  result: {
    exitCode: number | null
    output: string
  },
  options: CliServeOptions | undefined,
): void {
  writeStdout(options, result.output)

  if (result.exitCode !== null) {
    exitProcess(options, result.exitCode)
  }
}

function writeStdout(options: CliServeOptions | undefined, chunk: string): void {
  const stdout = options?.stdout ?? ((s: string) => process.stdout.write(s))
  stdout(chunk)
}

function exitProcess(options: CliServeOptions | undefined, code: number): void {
  const exit = options?.exit ?? ((exitCode: number) => process.exit(exitCode))
  exit(code)
}

function isJsonSchemaRequest(argv: readonly string[]): boolean {
  return hasFlagBeforeTerminator(argv, ['--schema']) && usesJsonFormat(argv)
}

function isHelpRequest(argv: readonly string[]): boolean {
  return hasFlagBeforeTerminator(argv, ['--help', '-h'])
}

function hasFlagBeforeTerminator(
  argv: readonly string[],
  flags: readonly string[],
): boolean {
  for (const token of argv) {
    if (token === '--') {
      break
    }
    if (flags.includes(token)) {
      return true
    }
  }

  return false
}

function usesJsonFormat(argv: readonly string[]): boolean {
  let format: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      break
    }
    if (token === '--json') {
      format = 'json'
      continue
    }
    if (token === '--format') {
      format = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (token.startsWith('--format=')) {
      format = token.slice('--format='.length)
    }
  }

  return format === 'json'
}

function parsesAsJson(output: string): boolean {
  try {
    JSON.parse(output)
    return true
  } catch {
    return false
  }
}

function parseCommandManifest(output: string): CommandManifest | null {
  try {
    const parsed = JSON.parse(output) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'commands' in parsed &&
      Array.isArray((parsed as CommandManifest).commands)
    ) {
      return parsed as CommandManifest
    }
  } catch {
    return null
  }

  return null
}

function buildSchemaIndex(
  commandPath: string[],
  manifest: CommandManifest,
): SchemaIndex {
  return {
    version: 'murph.schema-index.v1',
    kind: commandPath.length === 0 ? 'root' : 'group',
    command: commandPath.length === 0 ? null : commandPath.join(' '),
    note: SCHEMA_INDEX_NOTE,
    commands: projectSchemaIndexCommands(manifest.commands ?? []),
  }
}

function projectSchemaIndexCommands(
  commands: readonly CommandManifestEntry[],
): SchemaIndexCommand[] {
  const projected: SchemaIndexCommand[] = []

  for (const command of commands) {
    if (typeof command.name !== 'string' || command.name.length === 0) {
      continue
    }

    projected.push({
      name: command.name,
      ...(typeof command.description === 'string' && command.description.length > 0
        ? { description: command.description }
        : {}),
    })
  }

  return projected
}

function renderSchemaIndex(
  index: SchemaIndex,
  tokenControls: SchemaIndexTokenControls,
): string {
  const formatted = JSON.stringify(index, null, 2)

  if (tokenControls.count) {
    return `${estimateTokenCount(formatted)}\n`
  }

  if (tokenControls.limit === undefined && tokenControls.offset === undefined) {
    return `${formatted}\n`
  }

  const total = estimateTokenCount(formatted)
  const offset = tokenControls.offset ?? 0
  const end =
    tokenControls.limit === undefined ? total : offset + tokenControls.limit

  if (offset === 0 && end >= total) {
    return `${formatted}\n`
  }

  const sliced = sliceByTokens(formatted, offset, end)
  const actualEnd = Math.min(end, total)
  return `${sliced}\n[truncated: showing tokens ${offset}–${actualEnd} of ${total}]\n`
}

function extractTokenControls(argv: readonly string[]): SchemaIndexTokenControls {
  const delegateArgv: string[] = []
  let count = false
  let limit: number | undefined
  let offset: number | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      break
    }
    if (token === '--token-count') {
      delegateArgv.push(token)
      count = true
      continue
    }
    if (
      token === '--token-limit' ||
      token === '--token-offset' ||
      token.startsWith('--token-limit=') ||
      token.startsWith('--token-offset=')
    ) {
      const isLimit =
        token === '--token-limit' || token.startsWith('--token-limit=')
      const isSeparated = token === '--token-limit' || token === '--token-offset'
      const value = isSeparated
        ? argv[index + 1]
        : token.slice(token.indexOf('=') + 1)
      const delegateFlag = isLimit ? '--token-limit' : '--token-offset'

      delegateArgv.push(delegateFlag)
      if (value !== undefined) {
        delegateArgv.push(value)
      }

      const parsed = value === undefined ? Number.NaN : Number(value)
      if (isSeparated) {
        index += 1
      }

      if (!Number.isFinite(parsed) || value?.trim() === '') {
        continue
      }

      if (isLimit) {
        limit = parsed
      } else {
        offset = parsed
      }
      continue
    }

    delegateArgv.push(token)
  }

  return {
    argv: delegateArgv,
    count,
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  }
}

function extractSchemaCommandPath(argv: readonly string[]): string[] {
  const commandPath: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      break
    }
    if (token === '--schema' || token === '--json') {
      continue
    }
    if (token === '--format' || token === '--config' || token === '--filter-output') {
      index += 1
      continue
    }
    if (
      token.startsWith('--format=') ||
      token.startsWith('--config=') ||
      token.startsWith('--filter-output=') ||
      token.startsWith('--token-limit=') ||
      token.startsWith('--token-offset=')
    ) {
      continue
    }
    if (token === '--token-limit' || token === '--token-offset') {
      index += 1
      continue
    }
    if (
      token === '--full-output' ||
      token === '--token-count' ||
      token === '--no-config'
    ) {
      continue
    }
    if (token.startsWith('-')) {
      continue
    }

    commandPath.push(token)
  }

  return commandPath
}
