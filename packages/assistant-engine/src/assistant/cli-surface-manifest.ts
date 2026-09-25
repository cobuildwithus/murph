import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import {
  normalizeNullableString,
  redactSensitivePathSegments,
} from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { prepareAssistantDirectCliEnv } from '../assistant-cli-access.js'
import { sanitizeChildProcessEnv } from '../child-process-env.js'

export interface AssistantCliLlmsManifestSchemaNode {
  description?: string
  enum?: readonly string[]
  items?: AssistantCliLlmsManifestSchemaNode
  properties?: Record<string, AssistantCliLlmsManifestSchemaNode>
  required?: readonly string[]
  type?: string
}

export interface AssistantCliLlmsManifestCommandSchema {
  args?: AssistantCliLlmsManifestSchemaNode
  options?: AssistantCliLlmsManifestSchemaNode
  output?: AssistantCliLlmsManifestSchemaNode
}

export interface AssistantCliLlmsManifestCommand {
  description?: string
  examples?: readonly unknown[]
  hint?: string
  name: string
  schema?: AssistantCliLlmsManifestCommandSchema
}

export interface AssistantCliLlmsManifest {
  commands: AssistantCliLlmsManifestCommand[]
  version?: string
}

const assistantCliSurfaceAssemblyTimeoutMs = 5 * 60_000
const assistantCliManifestMaxOutputChars = 80_000
const assistantCliFullManifestMaxOutputChars = 8_000_000

const assistantCliManifestAllowedEnvKeys = new Set<string>([
  'APPDATA',
  'ComSpec',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'PATH',
  'PATHEXT',
  'PROGRAMDATA',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SystemRoot',
  'SystemDrive',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'VAULT',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
])

export async function readAssistantCliLlmsFullManifestFromCliEntry(input: {
  cliEntryPath: string
  workingDirectory?: string | null
}): Promise<AssistantCliLlmsManifest> {
  if (!(await pathExists(input.cliEntryPath))) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_FAILED',
      'Could not assemble the assistant CLI surface because the required built workspace CLI is unavailable. Build `@murphai/murph` first.',
    )
  }

  const result = await executeAssistantCliManifestCommand({
    cliEntryPath: input.cliEntryPath,
    workingDirectory: input.workingDirectory,
  })

  if (!isAssistantCliLlmsManifest(result.json)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_FAILED',
      'vault-cli --llms-full --format json returned an unexpected manifest shape.',
      {
        argv: result.argv,
      },
    )
  }

  return result.json
}

export function buildAssistantCliProcessEnv(input: {
  ambientEnv?: NodeJS.ProcessEnv
  cliEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const ambientEnv = input.ambientEnv ?? process.env
  const env: NodeJS.ProcessEnv = {}

  copyAllowedAssistantCliManifestEnvEntries(env, ambientEnv)
  copyAllowedAssistantCliManifestEnvEntries(env, input.cliEnv, {
    allowEmptyPath: true,
  })

  env.NO_COLOR = '1'

  return sanitizeChildProcessEnv(prepareAssistantDirectCliEnv(env))
}

async function executeAssistantCliManifestCommand(input: {
  cliEntryPath: string
  workingDirectory?: string | null
}): Promise<{
  argv: string[]
  exitCode: number
  json: unknown | null
  stderr: string
  stdout: string
}> {
  const timeoutMs = assistantCliSurfaceAssemblyTimeoutMs
  const argv = ['--llms-full', '--format', 'json']
  const env = buildAssistantCliProcessEnv({})

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [input.cliEntryPath, ...argv], {
      cwd: normalizeNullableString(input.workingDirectory) ?? process.cwd(),
      env,
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let forceKillTimer: NodeJS.Timeout | null = null
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, 2_000)
      settle(() => {
        reject(
          new VaultCliError(
            'ASSISTANT_CLI_COMMAND_TIMEOUT',
            `vault-cli ${argv.join(' ')} timed out while loading the CLI manifest.`,
            {
              argv,
              timeoutMs,
            },
          ),
        )
      })
    }, timeoutMs)

    const settle = (handler: () => void) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      handler()
    }

    child.on('error', (error) => {
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer)
      }
      settle(() => {
        reject(
          new VaultCliError(
            'ASSISTANT_CLI_COMMAND_FAILED',
            `Could not start vault-cli: ${error instanceof Error ? error.message : String(error)}`,
            {
              argv,
            },
          ),
        )
      })
    })

    child.stdout.on('data', (chunk) => {
      stdout = appendAssistantCliManifestOutputChunk(
        stdout,
        String(chunk),
        assistantCliFullManifestMaxOutputChars,
      )
    })

    child.stderr.on('data', (chunk) => {
      stderr = appendAssistantCliManifestOutputChunk(
        stderr,
        String(chunk),
        assistantCliManifestMaxOutputChars,
      )
    })

    child.stdin.on('error', () => {
      // Ignore stdin teardown races after process exit.
    })
    child.stdin.end()

    child.on('close', (code, signal) => {
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer)
      }
      settle(() => {
        const redactedStdout = redactAssistantCliManifestOutput(stdout)
        const redactedStderr = redactAssistantCliManifestOutput(stderr)
        const exitCode = typeof code === 'number' ? code : signal ? 1 : 0

        if (signal || exitCode !== 0) {
          reject(
            new VaultCliError(
              'ASSISTANT_CLI_COMMAND_FAILED',
              [
                `vault-cli ${argv.join(' ')} failed while loading the CLI manifest.`,
                redactedStderr.length > 0 ? redactedStderr : redactedStdout,
              ]
                .filter((value) => value.length > 0)
                .join(' '),
              {
                argv,
                exitCode,
                signal,
                stderr: redactedStderr,
                stdout: redactedStdout,
              },
            ),
          )
          return
        }

        resolve({
          argv: ['vault-cli', ...argv],
          exitCode,
          json: tryParseAssistantCliJsonOutput(redactedStdout),
          stderr: redactedStderr,
          stdout: redactedStdout,
        })
      })
    })
  })
}

function copyAllowedAssistantCliManifestEnvEntries(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv | undefined,
  options: {
    allowEmptyPath?: boolean
  } = {},
): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    const normalizedKey = key.toUpperCase() === 'PATH' ? 'PATH' : key
    const isExplicitEmptyPath =
      normalizedKey === 'PATH' &&
      value === '' &&
      options.allowEmptyPath === true

    if (
      typeof value !== 'string' ||
      (!isExplicitEmptyPath && value.length === 0) ||
      !assistantCliManifestAllowedEnvKeys.has(normalizedKey)
    ) {
      continue
    }

    target[normalizedKey] = value
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function appendAssistantCliManifestOutputChunk(
  existing: string,
  chunk: string,
  maxOutputChars: number,
): string {
  if (existing.length >= maxOutputChars) {
    return existing
  }

  const remainingChars = maxOutputChars - existing.length
  if (chunk.length <= remainingChars) {
    return existing + chunk
  }

  return existing + chunk.slice(0, remainingChars)
}

function redactAssistantCliManifestOutput(value: string): string {
  return redactSensitivePathSegments(value.trim())
}

function tryParseAssistantCliJsonOutput(value: string): unknown | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function isAssistantCliLlmsManifest(
  value: unknown,
): value is AssistantCliLlmsManifest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const commands = (value as { commands?: unknown }).commands
  return (
    Array.isArray(commands) &&
    commands.every(
      (command) =>
        command &&
        typeof command === 'object' &&
        typeof (command as { name?: unknown }).name === 'string' &&
        ((command as { description?: unknown }).description === undefined ||
          typeof (command as { description?: unknown }).description === 'string') &&
        ((command as { hint?: unknown }).hint === undefined ||
          typeof (command as { hint?: unknown }).hint === 'string'),
    )
  )
}
