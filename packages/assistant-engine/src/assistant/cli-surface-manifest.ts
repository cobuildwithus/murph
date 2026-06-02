import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  normalizeNullableString,
  redactSensitivePathSegments,
} from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { prepareAssistantDirectCliEnv } from '../assistant-cli-access.js'
import { sanitizeChildProcessEnv } from '../child-process-env.js'
import type { AssistantExecutionContext } from './execution-context.js'

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
  name: string
  schema?: AssistantCliLlmsManifestCommandSchema
}

export interface AssistantCliLlmsManifest {
  commands: AssistantCliLlmsManifestCommand[]
  version?: string
}

interface AssistantCliLauncher {
  argvPrefix: string[]
  command: string
}

const assistantCliManifestTimeoutMs = 60_000
const assistantCliManifestMaxOutputChars = 80_000

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

export async function readAssistantCliLlmsManifest(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: AssistantExecutionContext | null
  workingDirectory?: string | null
}): Promise<AssistantCliLlmsManifest> {
  const result = await executeAssistantCliManifestCommand({
    args: ['--llms', '--format', 'json'],
    cliEnv: input.cliEnv,
    executionContext: input.executionContext,
    workingDirectory: input.workingDirectory,
  })

  if (!isAssistantCliLlmsManifest(result.json)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_FAILED',
      'vault-cli --llms --format json returned an unexpected manifest shape.',
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
  args: readonly string[]
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: AssistantExecutionContext | null
  workingDirectory?: string | null
}): Promise<{
  argv: string[]
  exitCode: number
  json: unknown | null
  stderr: string
  stdout: string
}> {
  const disableConfigAutodiscovery = Boolean(input.executionContext?.hosted?.memberId)
  const argv = disableConfigAutodiscovery
    ? ['--no-config', ...input.args]
    : [...input.args]
  const env = buildAssistantCliProcessEnv({
    cliEnv: input.cliEnv,
  })
  const launcher = await resolveAssistantCliLauncher(env)

  return await new Promise((resolve, reject) => {
    const child = spawn(launcher.command, [...launcher.argvPrefix, ...argv], {
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
              timeoutMs: assistantCliManifestTimeoutMs,
            },
          ),
        )
      })
    }, assistantCliManifestTimeoutMs)

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
      stdout = appendAssistantCliManifestOutputChunk(stdout, String(chunk))
    })

    child.stderr.on('data', (chunk) => {
      stderr = appendAssistantCliManifestOutputChunk(stderr, String(chunk))
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

async function resolveAssistantCliLauncher(
  cliProcessEnv: NodeJS.ProcessEnv,
): Promise<AssistantCliLauncher> {
  const localWorkspaceCliSourceLauncher =
    await resolveLocalWorkspaceCliSourceLauncher(cliProcessEnv)
  if (localWorkspaceCliSourceLauncher) {
    return localWorkspaceCliSourceLauncher
  }

  const vaultCliBinaries = await resolveExecutablesOnPath('vault-cli', cliProcessEnv)
  for (const vaultCliBinary of vaultCliBinaries) {
    if (await isKnownStaleSetupCliShim(vaultCliBinary)) {
      continue
    }

    return {
      argvPrefix: [],
      command: vaultCliBinary,
    }
  }

  const localBuiltCliBinPath = resolveLocalBuiltWorkspaceCliBinPath()
  if (localBuiltCliBinPath && await pathExists(localBuiltCliBinPath)) {
    return {
      argvPrefix: [localBuiltCliBinPath],
      command: process.execPath,
    }
  }

  throw new VaultCliError(
    'ASSISTANT_CLI_COMMAND_FAILED',
    'Could not resolve `vault-cli` on PATH and no local built workspace CLI artifact was available.',
  )
}

function resolveLocalBuiltWorkspaceCliBinPath(): string | null {
  try {
    return path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../cli/dist/bin.js',
    )
  } catch {
    return null
  }
}

function resolveLocalWorkspaceCliSourceEntryPath(): string | null {
  try {
    return path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../cli/src/bin.ts',
    )
  } catch {
    return null
  }
}

function resolveLocalWorkspaceCliSourceTsconfigPath(
  sourceEntryPath: string,
): string {
  return path.resolve(path.dirname(sourceEntryPath), '../../..', 'tsconfig.base.json')
}

async function resolveLocalWorkspaceCliSourceLauncher(
  cliProcessEnv: NodeJS.ProcessEnv,
): Promise<AssistantCliLauncher | null> {
  const sourceEntryPath = resolveLocalWorkspaceCliSourceEntryPath()
  if (!sourceEntryPath || !(await pathExists(sourceEntryPath))) {
    return null
  }

  const tsconfigPath = resolveLocalWorkspaceCliSourceTsconfigPath(sourceEntryPath)
  if (!(await pathExists(tsconfigPath))) {
    return null
  }

  const tsxBinary = await resolveExecutableOnPath('tsx', cliProcessEnv)
  if (!tsxBinary) {
    return null
  }

  return {
    argvPrefix: ['--tsconfig', tsconfigPath, sourceEntryPath],
    command: tsxBinary,
  }
}

async function resolveExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const candidates = await resolveExecutablesOnPath(command, env)
  return candidates[0] ?? null
}

async function resolveExecutablesOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  if (path.isAbsolute(command)) {
    return (await isExecutable(command)) ? [command] : []
  }

  const pathValue = env.PATH ?? env.Path ?? ''
  const entries = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const candidates = process.platform === 'win32'
    ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    : [command]
  const resolvedCandidates: string[] = []

  for (const entry of entries) {
    for (const candidate of candidates) {
      const candidatePath = path.join(entry, candidate)
      if (await isExecutable(candidatePath)) {
        resolvedCandidates.push(candidatePath)
      }
    }
  }

  return resolvedCandidates
}

async function isExecutable(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.X_OK)
    return true
  } catch {
    return false
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

async function isKnownStaleSetupCliShim(candidatePath: string): Promise<boolean> {
  try {
    const contents = await readFile(candidatePath, 'utf8')
    return (
      contents.includes('packages/setup-cli/dist/bin.js') ||
      contents.includes('packages\\setup-cli\\dist\\bin.js')
    )
  } catch {
    return false
  }
}

function appendAssistantCliManifestOutputChunk(
  existing: string,
  chunk: string,
): string {
  if (existing.length >= assistantCliManifestMaxOutputChars) {
    return existing
  }

  const remainingChars = assistantCliManifestMaxOutputChars - existing.length
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
          typeof (command as { description?: unknown }).description === 'string'),
    )
  )
}
