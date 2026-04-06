import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applyDefaultVaultToArgs,
  hasExplicitVaultOption,
  ROOT_OPTIONS_WITH_VALUES,
} from '../operator-config.js'
import { redactSensitivePathSegments } from '../text/shared.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  assistantCliMaxOutputChars,
} from './shared.js'

const assistantCliBlockedCommandPaths = new Set([
  'assistant ask',
  'assistant chat',
  'assistant run',
  'chat',
  'run',
])

export interface PreparedAssistantCliExecutionRequest {
  args: string[]
  cleanupPath: string | null
  redactedArgv: string[]
  stdinText: string
}

export const assistantCliPolicyWrapperKinds = Object.freeze([
  'command-blocking',
  'default-vault-injection',
  'format-default',
  'stdin-input-materialization',
  'argv-redaction',
  'output-redaction',
] as const)

export type AssistantCliPolicyWrapperKind =
  (typeof assistantCliPolicyWrapperKinds)[number]

export async function prepareAssistantCliExecutionRequest(input: {
  args: readonly string[]
  stdin?: string
  vault: string
}): Promise<PreparedAssistantCliExecutionRequest> {
  if (hasExplicitVaultOption(input.args)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_BLOCKED',
      'The provider-turn CLI executor does not allow an explicit `--vault` override.',
    )
  }

  const commandPath = readAssistantCliCommandPath(input.args)
  if (commandPath && assistantCliBlockedCommandPaths.has(commandPath)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_BLOCKED',
      `Command path \`${commandPath}\` is blocked from the provider-turn CLI executor.`,
      {
        commandPath,
      },
    )
  }

  const argvWithDefaults = applyDefaultVaultToArgs(
    normalizeAssistantCliRunArgs(input.args),
    input.vault,
  )
  const cliPayload = await materializeAssistantCliInputPayload(argvWithDefaults, input.stdin)

  return {
    ...cliPayload,
    redactedArgv: redactAssistantCliArgv(cliPayload.args),
  }
}

export function redactAssistantCliProcessOutput(value: string): string {
  return redactSensitivePathSegments(value.trim())
}

export function appendAssistantCliOutputChunk(existing: string, chunk: string): string {
  if (existing.length >= assistantCliMaxOutputChars) {
    return existing
  }

  const remainingChars = assistantCliMaxOutputChars - existing.length
  if (chunk.length <= remainingChars) {
    return existing + chunk
  }

  return existing + chunk.slice(0, remainingChars)
}

function normalizeAssistantCliRunArgs(args: readonly string[]): string[] {
  const normalized = [...args]

  if (hasAssistantCliBuiltinTextSurface(normalized) || hasExplicitFormatOption(normalized)) {
    return normalized
  }

  return [...normalized, '--format', 'json']
}

function redactAssistantCliArgv(args: readonly string[]): string[] {
  return args.map((token) => redactAssistantCliArg(token))
}

function redactAssistantCliArg(token: string): string {
  const redacted = redactSensitivePathSegments(token)

  if (redacted.startsWith('@/')) {
    return '@<REDACTED_PATH>'
  }

  if (redacted.startsWith('/')) {
    return '<REDACTED_PATH>'
  }

  return redacted.replace(/=(@)?\/[^\s]*/gu, (_match, atSign: string | undefined) =>
    atSign ? '=@<REDACTED_PATH>' : '=<REDACTED_PATH>',
  )
}

function hasExplicitFormatOption(args: readonly string[]): boolean {
  return args.some((token) => token === '--format' || token.startsWith('--format='))
}

function hasAssistantCliBuiltinTextSurface(args: readonly string[]): boolean {
  return args.some((token) =>
    token === '--help' ||
    token === '-h' ||
    token === '--llms' ||
    token === '--llms-full' ||
    token === '--version',
  )
}

function readAssistantCliCommandPath(args: readonly string[]): string | null {
  const tokens: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token || token === '--') {
      break
    }

    if (token.startsWith('-')) {
      const rootOptionToken = token.split('=', 1)[0] ?? token
      if (tokens.length === 0 && ROOT_OPTIONS_WITH_VALUES.has(rootOptionToken)) {
        if (!token.includes('=')) {
          index += 1
        }
        continue
      }

      break
    }

    tokens.push(token)
  }

  return tokens.length > 0 ? tokens.slice(0, 2).join(' ') : null
}

async function materializeAssistantCliInputPayload(
  args: readonly string[],
  stdin: string | undefined,
): Promise<{
  args: string[]
  cleanupPath: string | null
  stdinText: string
}> {
  if (typeof stdin !== 'string') {
    return {
      args: [...args],
      cleanupPath: null,
      stdinText: '',
    }
  }

  const inputArgIndex = args.findIndex((token) => token === '--input')
  const inlineInputArgIndex = args.findIndex((token) => token === '--input=-')

  if (inputArgIndex === -1 && inlineInputArgIndex === -1) {
    return {
      args: [...args],
      cleanupPath: null,
      stdinText: stdin,
    }
  }

  const nextValue = inputArgIndex >= 0 ? args[inputArgIndex + 1] : null
  const usesStdinInput = nextValue === '-' || inlineInputArgIndex >= 0

  if (!usesStdinInput) {
    return {
      args: [...args],
      cleanupPath: null,
      stdinText: stdin,
    }
  }

  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-cli-input-'),
  )
  const tempPath = path.join(tempDirectory, 'payload.json')
  await writeFile(tempPath, stdin, {
    encoding: 'utf8',
    mode: 0o600,
  })

  const rewrittenArgs = [...args]
  if (inlineInputArgIndex >= 0) {
    rewrittenArgs[inlineInputArgIndex] = `--input=@${tempPath}`
  } else if (inputArgIndex >= 0) {
    rewrittenArgs[inputArgIndex + 1] = `@${tempPath}`
  }

  return {
    args: rewrittenArgs,
    cleanupPath: tempDirectory,
    stdinText: '',
  }
}
