import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type {
  AssistantApprovalPolicy,
  AssistantSandbox,
} from './assistant-cli-contracts.js'
import { VaultCliError } from './vault-cli-errors.js'

export interface CodexExecInput {
  approvalPolicy?: AssistantApprovalPolicy
  codexCommand?: string
  env?: NodeJS.ProcessEnv
  model?: string | null
  oss?: boolean
  profile?: string | null
  prompt: string
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  workingDirectory: string
}

export interface CodexExecResult {
  finalMessage: string
  jsonEvents: unknown[]
  sessionId: string | null
  stderr: string
  stdout: string
}

export interface CodexDisplayOptions {
  model: string | null
  reasoningEffort: string | null
}

export async function executeCodexPrompt(
  input: CodexExecInput,
): Promise<CodexExecResult> {
  const codexCommand = input.codexCommand?.trim() || 'codex'
  const workingDirectory = path.resolve(input.workingDirectory)
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-codex-'))
  const outputFile = path.join(tempRoot, 'last-message.txt')
  const args = buildCodexArgs({
    ...input,
    outputFile,
    workingDirectory,
  })

  let stdout = ''
  let stderr = ''
  const jsonEvents: unknown[] = []
  const nonJsonStdoutLines: string[] = []
  let discoveredSessionId = input.resumeSessionId ?? null
  let lastEventError: string | null = null

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(codexCommand, args, {
        cwd: workingDirectory,
        env: input.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new VaultCliError(
              'ASSISTANT_CODEX_NOT_FOUND',
              `Codex CLI executable "${codexCommand}" was not found. Install @openai/codex or pass --codexCommand.`,
            ),
          )
          return
        }

        reject(error)
      })

      let stdoutBuffer = ''

      child.stdout.on('data', (chunk) => {
        const text = String(chunk)
        stdout += text
        stdoutBuffer += text
        stdoutBuffer = consumeCompleteLines(stdoutBuffer, (line) => {
          const parsed = tryParseJsonLine(line)
          if (parsed.ok) {
            jsonEvents.push(parsed.value)
            discoveredSessionId =
              discoveredSessionId ?? extractCodexSessionId(parsed.value)
            lastEventError =
              extractCodexErrorMessage(parsed.value) ?? lastEventError
            return
          }

          const trimmed = line.trim()
          if (trimmed.length > 0) {
            nonJsonStdoutLines.push(trimmed)
          }
        })
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('close', (code, signal) => {
        if (stdoutBuffer.trim().length > 0) {
          const parsed = tryParseJsonLine(stdoutBuffer)
          if (parsed.ok) {
            jsonEvents.push(parsed.value)
            discoveredSessionId =
              discoveredSessionId ?? extractCodexSessionId(parsed.value)
            lastEventError =
              extractCodexErrorMessage(parsed.value) ?? lastEventError
          } else {
            nonJsonStdoutLines.push(stdoutBuffer.trim())
          }
        }

        if (code !== 0) {
          reject(
            new VaultCliError(
              'ASSISTANT_CODEX_FAILED',
              buildCodexFailureMessage({
                code,
                signal,
                stderr,
                fallback: lastEventError,
              }),
            ),
          )
          return
        }

        resolve()
      })
    })

    const finalMessage =
      (await readOptionalTextFile(outputFile)) ??
      nonJsonStdoutLines.join('\n').trim()

    return {
      finalMessage,
      jsonEvents,
      sessionId: discoveredSessionId,
      stderr: stderr.trim(),
      stdout: stdout.trim(),
    }
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
    })
  }
}

export async function resolveCodexDisplayOptions(input: {
  configPath?: string
  model?: string | null
  profile?: string | null
}): Promise<CodexDisplayOptions> {
  const explicitModel = normalizeNullableString(input.model)
  const explicitProfile = normalizeNullableString(input.profile)
  const config = await readCodexDisplayConfig(input.configPath)
  const activeProfile = explicitProfile
    ? config.profiles[explicitProfile] ?? null
    : null

  return {
    model: explicitModel ?? activeProfile?.model ?? config.model,
    reasoningEffort:
      activeProfile?.reasoningEffort ?? config.reasoningEffort,
  }
}

export function buildCodexArgs(
  input: CodexExecInput & {
    outputFile: string
    workingDirectory: string
  },
): string[] {
  const resumeSessionId = normalizeNullableString(input.resumeSessionId)
  const rootArgs: string[] = []
  const args = resumeSessionId
    ? ['exec', 'resume', resumeSessionId]
    : ['exec']

  if (input.approvalPolicy) {
    rootArgs.push('--ask-for-approval', input.approvalPolicy)
  }

  args.push('--json', '--skip-git-repo-check')
  args.push('--output-last-message', input.outputFile)

  if (!resumeSessionId) {
    args.push('--cd', input.workingDirectory)

    if (input.sandbox) {
      args.push('--sandbox', input.sandbox)
    }

    if (input.oss) {
      args.push('--oss')
    }

    if (input.profile) {
      args.push('--profile', input.profile)
    }
  }

  if (input.model) {
    args.push('--model', input.model)
  }

  if (input.reasoningEffort) {
    args.push(
      '--config',
      `model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`,
    )
  }

  args.push(input.prompt)

  return [...rootArgs, ...args]
}

async function readCodexDisplayConfig(
  configPath = path.join(homedir(), '.codex', 'config.toml'),
): Promise<CodexDisplayConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    return parseCodexDisplayConfig(raw)
  } catch {
    return {
      defaultProfile: null,
      model: null,
      reasoningEffort: null,
      profiles: {},
    }
  }
}

function parseCodexDisplayConfig(raw: string): CodexDisplayConfig {
  const config: CodexDisplayConfig = {
    defaultProfile: null,
    model: null,
    reasoningEffort: null,
    profiles: {},
  }

  let activeProfile: string | null = null

  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const profileSectionMatch = /^\[profiles\.([^\]]+)\]$/u.exec(line)
    if (profileSectionMatch) {
      activeProfile = profileSectionMatch[1] ?? null
      if (activeProfile && !config.profiles[activeProfile]) {
        config.profiles[activeProfile] = {
          model: null,
          reasoningEffort: null,
        }
      }
      continue
    }

    if (/^\[.*\]$/u.test(line)) {
      activeProfile = null
      continue
    }

    const stringAssignmentMatch =
      /^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/u.exec(line)
    if (!stringAssignmentMatch) {
      continue
    }

    const [, key, value] = stringAssignmentMatch
    const normalizedValue = normalizeNullableString(value)

    if (activeProfile) {
      const profile = config.profiles[activeProfile]
      if (!profile) {
        continue
      }

      if (key === 'model') {
        profile.model = normalizedValue
      } else if (key === 'model_reasoning_effort') {
        profile.reasoningEffort = normalizedValue
      }
      continue
    }

    if (key === 'model') {
      config.model = normalizedValue
    } else if (key === 'model_reasoning_effort') {
      config.reasoningEffort = normalizedValue
    } else if (key === 'profile') {
      config.defaultProfile = normalizedValue
    }
  }

  return config
}

function consumeCompleteLines(
  buffer: string,
  onLine: (line: string) => void,
): string {
  let nextBuffer = buffer

  while (true) {
    const newlineIndex = nextBuffer.indexOf('\n')
    if (newlineIndex < 0) {
      return nextBuffer
    }

    const line = nextBuffer.slice(0, newlineIndex).replace(/\r$/u, '')
    onLine(line)
    nextBuffer = nextBuffer.slice(newlineIndex + 1)
  }
}

function tryParseJsonLine(
  line: string,
):
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
    } {
  try {
    return {
      ok: true,
      value: JSON.parse(line) as unknown,
    }
  } catch {
    return {
      ok: false,
    }
  }
}

function extractCodexSessionId(event: unknown): string | null {
  const record = asRecord(event)
  const eventType = typeof record?.type === 'string' ? record.type : null

  if (eventType && eventType.startsWith('thread.')) {
    return (
      findDeepStringByKeys(record, ['thread_id', 'threadId']) ??
      findDeepStringByKeys(record, ['conversation_id', 'conversationId']) ??
      findDeepStringByKeys(record, ['id'])
    )
  }

  return (
    findDeepStringByKeys(record, ['thread_id', 'threadId']) ??
    findDeepStringByKeys(record, ['conversation_id', 'conversationId'])
  )
}

function extractCodexErrorMessage(event: unknown): string | null {
  const record = asRecord(event)
  if (!record) {
    return null
  }

  const eventType = typeof record.type === 'string' ? record.type : null
  if (
    eventType !== 'error' &&
    eventType !== 'turn.failed' &&
    eventType !== 'turn.error'
  ) {
    return null
  }

  return (
    findDeepStringByKeys(record, ['message']) ??
    findDeepStringByKeys(record, ['error_message', 'errorMessage']) ??
    null
  )
}

function findDeepStringByKeys(
  value: unknown,
  keys: readonly string[],
  visited = new Set<unknown>(),
): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (visited.has(value)) {
    return null
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepStringByKeys(item, keys, visited)
      if (found) {
        return found
      }
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  for (const nested of Object.values(record)) {
    const found = findDeepStringByKeys(nested, keys, visited)
    if (found) {
      return found
    }
  }

  return null
}

function buildCodexFailureMessage(input: {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
  fallback: string | null
}): string {
  const parts = ['Codex CLI failed.']

  if (typeof input.code === 'number') {
    parts.push(`exit code ${input.code}.`)
  }

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  const detail = input.fallback ?? tailText(input.stderr)
  if (detail) {
    parts.push(detail)
  }

  return parts.join(' ')
}

interface CodexDisplayConfig {
  defaultProfile: string | null
  model: string | null
  reasoningEffort: string | null
  profiles: Record<
    string,
    {
      model: string | null
      reasoningEffort: string | null
    }
  >
}

function tailText(value: string): string | null {
  const lines = value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return null
  }

  return lines.slice(-3).join(' ')
}

async function readOptionalTextFile(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : ''
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null
    }

    throw error
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}
