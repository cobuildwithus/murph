import type { Cli } from 'incur'

type CliServeOptions = Parameters<Cli.Cli['serve']>[1]

interface CommandManifest {
  commands?: CommandManifestEntry[]
  version?: string
}

interface CommandManifestEntry {
  description?: string
  examples?: unknown[]
  name?: string
  schema?: unknown
}

interface SchemaIndex {
  commands: CommandManifestEntry[]
  command: string | null
  kind: 'group' | 'root'
  note: string
  version: 'murph.schema-index.v1'
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

    const originalResult = await captureServeOutput(serve, argv, options)
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

    writeStdout(options, `${JSON.stringify(buildSchemaIndex(commandPath, manifest), null, 2)}\n`)
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
  return argv.includes('--schema') && usesJsonFormat(argv)
}

function isHelpRequest(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h')
}

function usesJsonFormat(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--json') {
      return true
    }
    if (token === '--format' && argv[index + 1] === 'json') {
      return true
    }
    if (token === '--format=json') {
      return true
    }
  }

  return false
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
    commands: manifest.commands ?? [],
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
