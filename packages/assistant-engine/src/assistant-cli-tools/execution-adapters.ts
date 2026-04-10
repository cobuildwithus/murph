import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAssistantDirectCliEnv } from '../assistant-cli-access.js'
import { normalizeNullableString } from '../assistant/shared.js'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { sanitizeChildProcessEnv } from '../child-process-env.js'
import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import {
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  readHostedAssistantApiKeyEnvName,
} from '@murphai/operator-config/hosted-assistant-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { assistantMemoryTurnEnvKeys } from '../assistant/memory/turn-context.js'
import type { AssistantExecutionContext } from '../assistant/execution-context.js'
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

const assistantCliAllowedEnvKeys = new Set<string>([
  'ANTHROPIC_API_KEY',
  'APPDATA',
  'BRAVE_API_KEY',
  'CEREBRAS_API_KEY',
  'ComSpec',
  'DEEPSEEK_API_KEY',
  'DEVICE_SYNC_PUBLIC_BASE_URL',
  'DEVICE_SYNC_SECRET',
  'FFMPEG_COMMAND',
  'FIREWORKS_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'HF_TOKEN',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HUGGINGFACEHUB_API_TOKEN',
  'HUGGINGFACE_API_KEY',
  'HUGGING_FACE_HUB_TOKEN',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LINQ_API_BASE_URL',
  'LINQ_API_TOKEN',
  'LINQ_WEBHOOK_SECRET',
  'LITELLM_PROXY_API_KEY',
  'LM_STUDIO_API_KEY',
  'LOCALAPPDATA',
  'MAPBOX_ACCESS_TOKEN',
  'MISTRAL_API_KEY',
  'MURPH_WEB_FETCH_ENABLED',
  'MURPH_WEB_FETCH_MAX_CHARS',
  'MURPH_WEB_FETCH_MAX_REDIRECTS',
  'MURPH_WEB_FETCH_MAX_RESPONSE_BYTES',
  'MURPH_WEB_FETCH_TIMEOUT_MS',
  'MURPH_WEB_SEARCH_MAX_RESULTS',
  'MURPH_WEB_SEARCH_PROVIDER',
  'MURPH_WEB_SEARCH_TIMEOUT_MS',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'NVIDIA_API_KEY',
  'NGC_API_KEY',
  'OLLAMA_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'OURA_CLIENT_ID',
  'OURA_CLIENT_SECRET',
  'PATH',
  'PATHEXT',
  'PDFTOTEXT_COMMAND',
  'PERPLEXITY_API_KEY',
  'PROGRAMDATA',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SystemRoot',
  'SystemDrive',
  'TEMP',
  'TELEGRAM_API_BASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_FILE_BASE_URL',
  'TMP',
  'TMPDIR',
  'TOGETHER_API_KEY',
  'TZ',
  'USERPROFILE',
  'VAULT',
  'VERCEL_AI_API_KEY',
  'VENICE_API_KEY',
  'VLLM_API_KEY',
  'WHISPER_COMMAND',
  'WHISPER_MODEL_PATH',
  'WHOOP_CLIENT_ID',
  'WHOOP_CLIENT_SECRET',
  'XAI_API_KEY',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  ...assistantMemoryTurnEnvKeys,
  ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
])

const assistantCliDisallowedReferencedEnvKeys = new Set([
  'HOME',
  'NODE_OPTIONS',
  'PATH',
  'PORT',
  'PWD',
  'VAULT',
])

const assistantCliDisallowedReferencedEnvPrefixes = [
  'AGENTMAIL_',
  'CF_',
  'HOSTED_EXECUTION_',
  'WRANGLER_',
]

export async function readAssistantCliLlmsManifest(input: {
  cliEnv?: NodeJS.ProcessEnv
  detail?: 'compact' | 'full'
  executionContext?: AssistantExecutionContext | null
  vault: string
  workingDirectory?: string | null
}): Promise<AssistantCliLlmsManifest> {
  const detail = input.detail ?? 'compact'
  const result = await executeAssistantCliCommand({
    args: [detail === 'full' ? '--llms-full' : '--llms', '--format', 'json'],
    input: {
      cliEnv: input.cliEnv,
      executionContext: input.executionContext,
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
  const disableConfigAutodiscovery = shouldDisableAssistantCliConfigAutodiscovery(input.input)
  const argv = disableConfigAutodiscovery
    ? ['--no-config', ...preparedRequest.args]
    : [...preparedRequest.args]
  const env = buildAssistantCliProcessEnv({
    cliEnv: input.input.cliEnv,
  })
  const timeoutMs = input.timeoutMs ?? assistantCliDefaultTimeoutMs

  try {
    const launcher = await resolveAssistantCliLauncher(env)
    return await new Promise((resolve, reject) => {
      const child = spawn(launcher.command, [...launcher.argvPrefix, ...argv], {
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
            argv: ['vault-cli', ...(disableConfigAutodiscovery
              ? ['--no-config', ...preparedRequest.redactedArgv]
              : preparedRequest.redactedArgv)],
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

function shouldDisableAssistantCliConfigAutodiscovery(
  input: Pick<AssistantToolContext, 'executionContext'>,
): boolean {
  return Boolean(input.executionContext?.hosted?.memberId)
}

function buildAssistantCliProcessEnv(input: {
  ambientEnv?: NodeJS.ProcessEnv
  cliEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const ambientEnv = input.ambientEnv ?? process.env
  const env: NodeJS.ProcessEnv = {}

  copyAllowedAssistantCliEnvEntries(env, ambientEnv)
  copyAllowedAssistantCliEnvEntries(env, input.cliEnv)

  const hostedAssistantApiKeyEnv = readHostedAssistantApiKeyEnvName(env)
  if (
    hostedAssistantApiKeyEnv &&
    isAllowedAssistantCliReferencedEnvKey(hostedAssistantApiKeyEnv)
  ) {
    const referencedValue = normalizeNullableString(
      input.cliEnv?.[hostedAssistantApiKeyEnv] ?? ambientEnv[hostedAssistantApiKeyEnv],
    )

    if (referencedValue) {
      env[hostedAssistantApiKeyEnv] = referencedValue
    }
  }

  env.NO_COLOR = '1'

  return sanitizeChildProcessEnv(prepareAssistantDirectCliEnv(env))
}

function copyAllowedAssistantCliEnvEntries(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv | undefined,
): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      !assistantCliAllowedEnvKeys.has(key)
    ) {
      continue
    }

    target[key] = value
  }
}

function isAllowedAssistantCliReferencedEnvKey(key: string): boolean {
  return !assistantCliDisallowedReferencedEnvKeys.has(key) &&
    !assistantCliDisallowedReferencedEnvPrefixes.some((prefix) => key.startsWith(prefix))
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

const ASSISTANT_PAYLOAD_TEMP_DIRECTORY_MODE = 0o700
const ASSISTANT_PAYLOAD_TEMP_FILE_MODE = 0o600

export async function withAssistantPayloadFile<TResult>(
  vaultRoot: string,
  toolName: string,
  payload: Record<string, unknown>,
  action: (inputFile: string) => Promise<TResult>,
): Promise<TResult> {
  const { cleanupPath, inputFile } = await createAssistantPayloadFile(
    vaultRoot,
    toolName,
    payload,
  )

  try {
    return await action(inputFile)
  } finally {
    await rm(cleanupPath, { force: true, recursive: true })
  }
}

async function createAssistantPayloadFile(
  vaultRoot: string,
  toolName: string,
  payload: Record<string, unknown>,
): Promise<{
  cleanupPath: string
  inputFile: string
}> {
  const runtimePaths = resolveRuntimePaths(vaultRoot)
  const payloadRoot = path.join(runtimePaths.tempRoot, 'assistant', 'payloads')
  await mkdir(payloadRoot, {
    recursive: true,
    mode: ASSISTANT_PAYLOAD_TEMP_DIRECTORY_MODE,
  })

  const tempDirectory = await mkdtemp(
    path.join(payloadRoot, `${sanitizeToolName(toolName) || 'payload'}-`),
  )
  const inputFile = path.join(tempDirectory, 'payload.json')

  try {
    await writeFile(inputFile, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: ASSISTANT_PAYLOAD_TEMP_FILE_MODE,
    })
  } catch (error) {
    await rm(tempDirectory, { force: true, recursive: true })
    throw error
  }

  return {
    cleanupPath: tempDirectory,
    inputFile,
  }
}

async function resolveAssistantCliLauncher(
  env: NodeJS.ProcessEnv,
): Promise<AssistantCliLauncher> {
  const preparedEnv = prepareAssistantDirectCliEnv(env)
  const localBuiltCliBinPath = resolveLocalBuiltWorkspaceCliBinPath()
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
  const moduleDir = resolveExecutionAdaptersModuleDir()
  if (!moduleDir) {
    return null
  }

  return path.resolve(moduleDir, '../../../cli/dist/bin.js')
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
