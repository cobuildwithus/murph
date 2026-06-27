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

interface LlmsJsonManifestRequest {
  kind: 'json-manifest'
}

interface RootLlmsMarkdownNormalizationRequest {
  kind: 'root-markdown'
}

interface ScopedLlmsMarkdownNormalizationRequest extends ScopedLlmsMarkdownRequest {
  kind: 'scoped-markdown'
}

interface ScopedHelpNormalizationRequest {
  commandPath: string[]
  kind: 'scoped-help'
}

type LlmsNormalizationRequest =
  | LlmsJsonManifestRequest
  | RootLlmsMarkdownNormalizationRequest
  | ScopedHelpNormalizationRequest
  | ScopedLlmsMarkdownNormalizationRequest

export function installVaultCliLlmsNormalizer(
  cli: Cli.Cli,
  commandName = 'vault-cli',
): void {
  const serve = cli.serve.bind(cli)

  cli.serve = async (argv = process.argv.slice(2), options = {}) => {
    const request = parseLlmsNormalizationRequest(argv)
    if (!request) {
      await serve(argv, options)
      return
    }

    const result = await captureServeOutput(serve, argv, options)
    let output: string
    if (request.kind === 'json-manifest') {
      output = await normalizeLlmsJsonManifestOutput(result.output)
    } else if (request.kind === 'root-markdown') {
      output = normalizeRootLlmsMarkdownOutput(result.output, commandName)
    } else if (request.kind === 'scoped-help') {
      output = normalizeScopedHelpOutput(result.output, request.commandPath)
    } else {
      output = normalizeScopedLlmsMarkdownOutput(
        result.output,
        commandName,
        request.commandPath,
      )
    }
    writeStdout(options, output)

    if (result.exitCode !== null) {
      exitProcess(options, result.exitCode)
    }
  }
}

function parseLlmsNormalizationRequest(
  argv: readonly string[],
): LlmsNormalizationRequest | null {
  let hasLlmsFlag = false
  let hasHelpFlag = false
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

    if (token === '--help' || token === '-h') {
      hasHelpFlag = true
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

  if (hasHelpFlag && !hasLlmsFlag) {
    if (
      commandPath.length > 0 &&
      scopedCommandHasHiddenChild(commandPath)
    ) {
      return { commandPath, kind: 'scoped-help' }
    }
    return null
  }

  if (!hasLlmsFlag) {
    return null
  }

  if (commandPath.length === 0) {
    if (explicitFormat === 'json') {
      return { kind: 'json-manifest' }
    }
    if (explicitFormat === null || explicitFormat === 'md') {
      return { kind: 'root-markdown' }
    }
    return null
  }

  if (explicitFormat === 'json') {
    return { kind: 'json-manifest' }
  }

  if (explicitFormat !== null && explicitFormat !== 'md') {
    return null
  }

  return { commandPath, kind: 'scoped-markdown' }
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

function normalizeRootLlmsMarkdownOutput(
  output: string,
  commandName: string,
): string {
  return stripHiddenCommandsFromLlmsMarkdownOutput(output, commandName)
}

function scopedCommandHasHiddenChild(commandPath: readonly string[]): boolean {
  if (vaultCliLlmsHiddenCommandNames.size === 0) {
    return false
  }

  const prefix = `${commandPath.join(' ')} `
  for (const hiddenName of vaultCliLlmsHiddenCommandNames) {
    if (hiddenName.startsWith(prefix)) {
      return true
    }
  }
  return false
}

function normalizeScopedHelpOutput(
  output: string,
  commandPath: readonly string[],
): string {
  const prefix = `${commandPath.join(' ')} `
  const childLeafNames: string[] = []
  for (const hiddenName of vaultCliLlmsHiddenCommandNames) {
    if (hiddenName.startsWith(prefix)) {
      childLeafNames.push(hiddenName.slice(prefix.length))
    }
  }
  if (childLeafNames.length === 0) {
    return output
  }

  const leafLinePattern = new RegExp(
    `^\\s+(${childLeafNames.map(escapeRegExp).join('|')})\\s`,
    'u',
  )

  const lines = output.split('\n')
  const filtered = lines.filter((line) => !leafLinePattern.test(line))
  return filtered.join('\n')
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

  return stripHiddenCommandsFromLlmsMarkdownOutput(normalized, commandName)
}

function stripHiddenCommandsFromLlmsMarkdownOutput(
  output: string,
  commandName: string,
): string {
  if (vaultCliLlmsHiddenCommandNames.size === 0) {
    return output
  }

  const lines = output.split('\n')
  const filtered: string[] = []
  for (const line of lines) {
    if (lineMentionsHiddenCommand(line, commandName)) {
      continue
    }
    filtered.push(line)
  }

  return filtered.join('\n')
}

function lineMentionsHiddenCommand(line: string, commandName: string): boolean {
  for (const hiddenName of vaultCliLlmsHiddenCommandNames) {
    const reference = `\`${commandName} ${hiddenName}`
    if (line.includes(reference)) {
      return true
    }
  }
  return false
}

// Commands that stay registered for explicit operator/script invocation but
// must not appear in any agent-visible CLI manifest. Use this when a leaf
// command accepts a complex `--input @file|-` payload without a paired
// Incur-discoverable shape path (`docs/contracts/00-invariants.md` § Agent-Visible
// CLI Payloads). Adding a sibling `payload-schema` command is the way back into
// the agent-visible surface.
export const vaultCliLlmsHiddenCommandNames: ReadonlySet<string> = new Set([
  'capture import-json',
])

async function normalizeLlmsJsonManifestOutput(output: string): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return output
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.commands)) {
    return output
  }

  const hintsByCommandName = await collectVaultCliDescriptorHintsByCommandName()
  let changed = false
  const commands: unknown[] = []
  for (const command of parsed.commands) {
    if (
      isRecord(command) &&
      typeof command.name === 'string' &&
      vaultCliLlmsHiddenCommandNames.has(command.name)
    ) {
      changed = true
      continue
    }

    if (!isRecord(command) || typeof command.name !== 'string') {
      commands.push(command)
      continue
    }

    const existingHint = command.hint
    if (typeof existingHint === 'string' && existingHint.trim().length > 0) {
      commands.push(command)
      continue
    }

    const hint = hintsByCommandName.get(command.name)
    if (!hint) {
      commands.push(command)
      continue
    }

    changed = true
    commands.push({
      ...command,
      hint,
    })
  }

  if (!changed) {
    return output
  }

  return `${JSON.stringify(
    {
      ...parsed,
      commands,
    },
    null,
    2,
  )}\n`
}

async function collectVaultCliDescriptorHintsByCommandName(): Promise<
  Map<string, string>
> {
  // Lazy import: the command manifest transitively loads every command
  // module, which is far too heavy for the per-invocation hot path. Only
  // `--llms` manifest normalization needs the descriptor hints.
  const { vaultCliCommandDescriptors } = await import(
    './vault-cli-command-manifest.js'
  )
  const hintsByCommandName = new Map<string, string>()

  for (const descriptor of vaultCliCommandDescriptors) {
    const leafCommands =
      'leafCommands' in descriptor ? descriptor.leafCommands : undefined
    for (const leafCommand of leafCommands ?? []) {
      const hint =
        'hint' in leafCommand && typeof leafCommand.hint === 'string'
          ? leafCommand.hint.trim()
          : undefined
      if (hint === undefined || hint.length === 0) {
        continue
      }

      hintsByCommandName.set(leafCommand.path.join(' '), hint)
    }
  }

  return hintsByCommandName
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
