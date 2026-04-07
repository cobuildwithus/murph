import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAssistantDirectCliEnv } from '../assistant-cli-access.js'
import { normalizeNullableString } from '../assistant/shared.js'
import { resolveAssistantVaultPath } from '../assistant-vault-paths.js'
import { sanitizeChildProcessEnv } from '../child-process-env.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantToolContext, AssistantCliLlmsManifest } from './shared.js'
import {
  assistantCliDefaultTimeoutMs,
  assistantToolTextReadChunkBytes,
  assistantToolTextReadDefaultMaxChars,
} from './shared.js'
import {
  appendAssistantCliOutputChunk,
  prepareAssistantCliExecutionRequest,
  redactAssistantCliProcessOutput,
} from './policy-wrappers.js'

interface AssistantCliLauncher {
  argvPrefix: string[]
  command: string
}

export async function readAssistantCliLlmsManifest(input: {
  cliEnv?: NodeJS.ProcessEnv
  detail?: 'compact' | 'full'
  vault: string
  workingDirectory?: string | null
}): Promise<AssistantCliLlmsManifest> {
  const detail = input.detail ?? 'compact'
  const result = await executeAssistantCliCommand({
    args: [detail === 'full' ? '--llms-full' : '--llms', '--format', 'json'],
    input: {
      cliEnv: input.cliEnv,
      vault: input.vault,
      workingDirectory: input.workingDirectory ?? undefined,
    },
  })

  if (!isAssistantCliLlmsManifest(result.json)) {
    throw new VaultCliError(
      'ASSISTANT_CLI_COMMAND_FAILED',
      `vault-cli ${detail === 'full' ? '--llms-full' : '--llms'} --format json returned an unexpected manifest shape.`,
      {
        argv: result.argv,
        stdout: result.stdout,
      },
    )
  }

  return result.json
}

export async function executeAssistantCliCommand(input: {
  args: readonly string[]
  input: AssistantToolContext
  stdin?: string
  timeoutMs?: number
}): Promise<{
  argv: string[]
  exitCode: number
  json: unknown | null
  stderr: string
  stdout: string
}> {
  const preparedRequest = await prepareAssistantCliExecutionRequest({
    args: input.args,
    stdin: input.stdin,
    vault: input.input.vault,
  })
  const env = sanitizeChildProcessEnv(
    prepareAssistantDirectCliEnv({
      NO_COLOR: '1',
      ...process.env,
      ...input.input.cliEnv,
    }),
  )
  const timeoutMs = input.timeoutMs ?? assistantCliDefaultTimeoutMs

  try {
    const launcher = await resolveAssistantCliLauncher(env)
    return await new Promise((resolve, reject) => {
      const child = spawn(launcher.command, [...launcher.argvPrefix, ...preparedRequest.args], {
        cwd: normalizeNullableString(input.input.workingDirectory) ?? process.cwd(),
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
              `vault-cli ${preparedRequest.redactedArgv.join(' ')} timed out after ${timeoutMs}ms.`,
              {
                timeoutMs,
                argv: preparedRequest.redactedArgv,
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
                argv: preparedRequest.redactedArgv,
              },
            ),
          )
        })
      })

      child.stdout.on('data', (chunk) => {
        stdout = appendAssistantCliOutputChunk(stdout, String(chunk))
      })

      child.stderr.on('data', (chunk) => {
        stderr = appendAssistantCliOutputChunk(stderr, String(chunk))
      })

      child.stdin.on('error', () => {
        // Ignore stdin teardown races after process exit.
      })
      child.stdin.end(preparedRequest.stdinText)

      child.on('close', (code, signal) => {
        if (forceKillTimer !== null) {
          clearTimeout(forceKillTimer)
        }
        settle(() => {
          const redactedStdout = redactAssistantCliProcessOutput(stdout)
          const redactedStderr = redactAssistantCliProcessOutput(stderr)
          const exitCode = typeof code === 'number' ? code : signal ? 1 : 0

          if (signal || exitCode !== 0) {
            reject(
              new VaultCliError(
                'ASSISTANT_CLI_COMMAND_FAILED',
                [
                  `vault-cli ${preparedRequest.redactedArgv.join(' ')} failed.`,
                  redactedStderr.length > 0 ? redactedStderr : redactedStdout,
                ]
                  .filter((value) => value.length > 0)
                  .join(' '),
                {
                  argv: preparedRequest.redactedArgv,
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
            argv: ['vault-cli', ...preparedRequest.redactedArgv],
            exitCode,
            json: tryParseAssistantCliJsonOutput(redactedStdout),
            stderr: redactedStderr,
            stdout: redactedStdout,
          })
        })
      })
    })
  } finally {
    if (preparedRequest.cleanupPath !== null) {
      await rm(preparedRequest.cleanupPath, { force: true, recursive: true })
    }
  }
}

export async function readAssistantTextFile(
  vaultRoot: string,
  candidatePath: string,
  maxChars?: number,
): Promise<{
  path: string
  text: string
  totalChars: number
  truncated: boolean
}> {
  const resolvedPath = await resolveAssistantVaultPath(vaultRoot, candidatePath, 'file path')
  const limit = maxChars ?? assistantToolTextReadDefaultMaxChars
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const fileHandle = await open(resolvedPath, 'r')
  const buffer = Buffer.allocUnsafe(assistantToolTextReadChunkBytes)
  let text = ''
  let totalChars = 0

  try {
    while (true) {
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }

      const chunk = buffer.subarray(0, bytesRead)
      if (chunk.includes(0)) {
        throw createAssistantToolFileNotTextError(candidatePath)
      }

      const chunkText = decodeAssistantTextChunk(decoder, chunk, candidatePath)
      totalChars += chunkText.length
      if (text.length < limit) {
        text += chunkText.slice(0, limit - text.length)
      }
    }

    const trailingText = decodeAssistantTextChunk(decoder, undefined, candidatePath)
    totalChars += trailingText.length
    if (text.length < limit) {
      text += trailingText.slice(0, limit - text.length)
    }
  } finally {
    await fileHandle.close()
  }

  const truncated = totalChars > limit
  const relativePath = path.relative(vaultRoot, resolvedPath).split(path.sep).join('/')

  return {
    path: relativePath,
    text:
      truncated
        ? `${text.slice(0, limit)}\n\n[truncated ${totalChars - limit} characters]`
        : text,
    totalChars,
    truncated,
  }
}

export async function writeAssistantPayloadFile(
  vaultRoot: string,
  toolName: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`
  const directory = path.join(
    vaultRoot,
    'derived',
    'assistant',
    'payloads',
    sanitizeToolName(toolName),
  )
  const absolutePath = path.join(directory, fileName)
  await mkdir(directory, { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return absolutePath
}

async function resolveAssistantCliLauncher(
  env: NodeJS.ProcessEnv,
): Promise<AssistantCliLauncher> {
  const preparedEnv = prepareAssistantDirectCliEnv(env)
  const workspaceCliBinPath = resolveWorkspaceCliBinPath()
  const workspaceBuiltCliBinPath = resolveWorkspaceBuiltCliBinPath()
  const workspaceTsxBinPath = resolveWorkspaceTsxBinPath()
  const vaultCliBinary = await resolveExecutableOnPath(
    'vault-cli',
    preparedEnv,
  )
  if (vaultCliBinary) {
    return {
      argvPrefix: [],
      command: vaultCliBinary,
    }
  }

  if (workspaceBuiltCliBinPath && await pathExists(workspaceBuiltCliBinPath)) {
    return {
      argvPrefix: [workspaceBuiltCliBinPath],
      command: process.execPath,
    }
  }

  const workspaceTsxCliPath = await resolveWorkspaceTsxCliPath()
  if (workspaceTsxCliPath !== null && workspaceCliBinPath !== null) {
    return {
      argvPrefix: [workspaceTsxCliPath, workspaceCliBinPath],
      command: process.execPath,
    }
  }

  if (workspaceTsxBinPath && workspaceCliBinPath && await isExecutable(workspaceTsxBinPath)) {
    return {
      argvPrefix: [workspaceCliBinPath],
      command: workspaceTsxBinPath,
    }
  }

  const pnpmBinary = await resolveExecutableOnPath(
    'pnpm',
    preparedEnv,
  )
  if (pnpmBinary && workspaceCliBinPath !== null) {
    return {
      argvPrefix: ['exec', 'tsx', workspaceCliBinPath],
      command: pnpmBinary,
    }
  }

  const npxBinary = await resolveExecutableOnPath(
    'npx',
    preparedEnv,
  )
  if (npxBinary && workspaceCliBinPath !== null) {
    return {
      argvPrefix: ['--yes', 'tsx', workspaceCliBinPath],
      command: npxBinary,
    }
  }

  throw new VaultCliError(
    'ASSISTANT_CLI_COMMAND_FAILED',
    'Could not resolve `vault-cli` on PATH and no workspace tsx fallback was available.',
  )
}

function resolveWorkspaceCliBinPath(): string | null {
  const moduleDir = resolveExecutionAdaptersModuleDir()
  if (!moduleDir) {
    return null
  }

  return path.resolve(moduleDir, '../../../cli/src/bin.ts')
}

function resolveWorkspaceBuiltCliBinPath(): string | null {
  const moduleDir = resolveExecutionAdaptersModuleDir()
  if (!moduleDir) {
    return null
  }

  return path.resolve(moduleDir, '../../../cli/dist/bin.js')
}

function resolveWorkspaceTsxBinPath(): string | null {
  const moduleDir = resolveExecutionAdaptersModuleDir()
  if (!moduleDir) {
    return null
  }

  return path.resolve(
    moduleDir,
    '../../../../node_modules/.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  )
}

function resolveExecutionAdaptersModuleDir(): string | null {
  if (typeof import.meta.url !== 'string' || import.meta.url.length === 0) {
    return null
  }

  try {
    return path.dirname(fileURLToPath(import.meta.url))
  } catch {
    return null
  }
}

async function resolveExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (path.isAbsolute(command)) {
    return (await isExecutable(command)) ? command : null
  }

  const pathValue = env.PATH ?? process.env.PATH ?? ''
  const entries = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const candidates = process.platform === 'win32'
    ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    : [command]

  for (const entry of entries) {
    for (const candidate of candidates) {
      const candidatePath = path.join(entry, candidate)
      if (await isExecutable(candidatePath)) {
        return candidatePath
      }
    }
  }

  return null
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isExecutable(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveWorkspaceTsxCliPath(): Promise<string | null> {
  if (typeof import.meta.url !== 'string' || import.meta.url.length === 0) {
    return null
  }

  try {
    const { createRequire } = await import('node:module')
    const assistantCliRequire = createRequire(import.meta.url)
    return assistantCliRequire.resolve('tsx/cli')
  } catch {
    return null
  }
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

function isAssistantCliLlmsManifest(value: unknown): value is AssistantCliLlmsManifest {
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

function createAssistantToolFileNotTextError(candidatePath: string) {
  return new VaultCliError(
    'ASSISTANT_TOOL_FILE_NOT_TEXT',
    `Assistant file path "${candidatePath}" must reference a UTF-8 text file inside the vault.`,
  )
}

function decodeAssistantTextChunk(
  decoder: TextDecoder,
  chunk: Buffer | undefined,
  candidatePath: string,
): string {
  try {
    return chunk
      ? decoder.decode(chunk, { stream: true })
      : decoder.decode()
  } catch {
    throw createAssistantToolFileNotTextError(candidatePath)
  }
}

function sanitizeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/[.]+/gu, '-')
}
