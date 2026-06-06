import type { Cli } from 'incur'

type CliServeOptions = Parameters<Cli.Cli['serve']>[1]

const VALUE_FLAGS = new Set([
  '--config',
  '--filter-output',
  '--format',
  '--token-limit',
  '--token-offset',
])

const BOOLEAN_FLAGS = new Set([
  '--full-output',
  '--help',
  '--llms',
  '--llms-full',
  '--mcp',
  '--no-config',
  '--schema',
  '--token-count',
  '--version',
  '-h',
])

interface ScopedLlmsMarkdownRequest {
  commandPath: string[]
}

export function installVaultCliLlmsNormalizer(
  cli: Cli.Cli,
  commandName = 'vault-cli',
): void {
  const serve = cli.serve.bind(cli)

  cli.serve = async (argv = process.argv.slice(2), options = {}) => {
    const request = parseScopedLlmsMarkdownRequest(argv)
    if (!request) {
      await serve(argv, options)
      return
    }

    const result = await captureServeOutput(serve, argv, options)
    writeStdout(
      options,
      normalizeScopedLlmsMarkdownOutput(result.output, commandName, request.commandPath),
    )

    if (result.exitCode !== null) {
      exitProcess(options, result.exitCode)
    }
  }
}

function parseScopedLlmsMarkdownRequest(
  argv: readonly string[],
): ScopedLlmsMarkdownRequest | null {
  let hasLlmsFlag = false
  let explicitFormat: string | null = null
  const commandPath: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || token === '--') {
      break
    }

    if (token === '--llms' || token === '--llms-full') {
      hasLlmsFlag = true
      continue
    }

    if (token === '--json') {
      explicitFormat = 'json'
      continue
    }

    if (token === '--format') {
      explicitFormat = argv[index + 1] ?? null
      index += 1
      continue
    }

    if (token.startsWith('--format=')) {
      explicitFormat = token.slice('--format='.length)
      continue
    }

    if (VALUE_FLAGS.has(token)) {
      index += 1
      continue
    }

    if (
      token.startsWith('--config=') ||
      token.startsWith('--filter-output=') ||
      token.startsWith('--token-limit=') ||
      token.startsWith('--token-offset=')
    ) {
      continue
    }

    if (BOOLEAN_FLAGS.has(token)) {
      continue
    }

    if (token.startsWith('-')) {
      break
    }

    commandPath.push(token)
  }

  if (!hasLlmsFlag || commandPath.length === 0) {
    return null
  }

  if (explicitFormat !== null && explicitFormat !== 'md') {
    return null
  }

  return { commandPath }
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

function normalizeScopedLlmsMarkdownOutput(
  output: string,
  commandName: string,
  commandPath: readonly string[],
): string {
  let normalized = output

  for (let length = commandPath.length; length >= 1; length -= 1) {
    const prefix = commandPath.slice(0, length).join(' ')
    const duplicate = `${commandName} ${prefix} ${prefix}`
    const replacement = `${commandName} ${prefix}`
    const pattern = new RegExp(
      `(^|[\\s\`])${escapeRegExp(duplicate)}(?=\\s|$)`,
      'gu',
    )

    normalized = normalized.replace(
      pattern,
      (_match, leading: string) => `${leading}${replacement}`,
    )
  }

  return normalized
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function writeStdout(options: CliServeOptions | undefined, chunk: string): void {
  const stdout = options?.stdout ?? ((s: string) => process.stdout.write(s))
  stdout(chunk)
}

function exitProcess(options: CliServeOptions | undefined, code: number): void {
  const exit = options?.exit ?? ((exitCode: number) => process.exit(exitCode))
  exit(code)
}
