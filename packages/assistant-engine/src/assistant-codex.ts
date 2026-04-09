import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantApprovalPolicy,
  AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  CodexProgressEvent,
} from './assistant-codex-events.js'
import {
  extractAssistantMessageFallback,
  extractCodexErrorMessage,
  extractCodexProgressEventFromNormalized,
  extractCodexSessionId,
  extractCodexStatusEventFromStderrLine,
  extractCodexTraceUpdatesFromNormalized,
  isCodexConnectionLossText,
  normalizeCodexEvent,
  normalizeStatusText,
  normalizeStreamingText,
} from './assistant-codex-events.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import { sanitizeChildProcessEnv } from './child-process-env.js'

export { extractCodexTraceUpdates } from './assistant-codex-events.js'
export type { CodexProgressEvent } from './assistant-codex-events.js'

export interface CodexExecInput {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy
  configOverrides?: readonly string[]
  codexCommand?: string
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
  model?: string | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
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
  const childEnv = await resolveCodexChildEnv({
    codexHome: input.codexHome,
    env: input.env,
  })
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-codex-'))
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
  let lastAgentMessage: string | null = null
  let lastEventError: string | null = null
  const assistantStreams = new Map<string, string>()
  const assistantStreamOrder: string[] = []

  const recordAssistantTraceUpdate = (update: AssistantProviderTraceUpdate) => {
    if (update.kind !== 'assistant') {
      return
    }

    const normalizedText = normalizeStreamingText(update.text)
    if (!normalizedText) {
      return
    }

    const streamKey = normalizeNullableString(update.streamKey) ?? 'assistant:main'
    const previousText = assistantStreams.get(streamKey) ?? ''

    if (!assistantStreams.has(streamKey)) {
      assistantStreamOrder.push(streamKey)
    }

    assistantStreams.set(
      streamKey,
      update.mode === 'append'
        ? `${previousText}${normalizedText}`
        : normalizedText,
    )
  }

  const handleParsedEvent = (event: unknown) => {
    jsonEvents.push(event)
    discoveredSessionId = discoveredSessionId ?? extractCodexSessionId(event)
    lastEventError = extractCodexErrorMessage(event) ?? lastEventError

    const normalizedEvent = normalizeCodexEvent(event)
    const updates = extractCodexTraceUpdatesFromNormalized(normalizedEvent)
    for (const update of updates) {
      recordAssistantTraceUpdate(update)
    }

    input.onTraceEvent?.({
      providerSessionId: discoveredSessionId,
      rawEvent: event,
      updates,
    })

    const progressEvent = extractCodexProgressEventFromNormalized(normalizedEvent)
    if (progressEvent) {
      if (progressEvent.kind === 'message') {
        lastAgentMessage = progressEvent.text
      }
      input.onProgress?.(progressEvent)
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(codexCommand, args, {
        cwd: workingDirectory,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let settled = false
      let abortRequested = false
      let deferredStdinError: NodeJS.ErrnoException | null = null

      const cleanupAbortListener = attachCodexAbortListener({
        abortSignal: input.abortSignal,
        onAbort: () => {
          abortRequested = true
          child.kill('SIGINT')
        },
      })

      const resolveOnce = () => {
        if (settled) {
          return
        }

        settled = true
        cleanupAbortListener()
        resolve()
      }

      const rejectOnce = (error: unknown) => {
        if (settled) {
          return
        }

        settled = true
        cleanupAbortListener()
        reject(error)
      }

      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          rejectOnce(
            new VaultCliError(
              'ASSISTANT_CODEX_NOT_FOUND',
              `Codex CLI executable "${codexCommand}" was not found. Install @openai/codex or pass --codexCommand.`,
            ),
          )
          return
        }

        rejectOnce(error)
      })

      let stdoutBuffer = ''
      let stderrBuffer = ''

      child.stdout.on('data', (chunk) => {
        const text = String(chunk)
        stdout += text
        stdoutBuffer += text
        stdoutBuffer = consumeCompleteLines(stdoutBuffer, (line) => {
          const parsed = tryParseJsonLine(line)
          if (parsed.ok) {
            handleParsedEvent(parsed.value)
            return
          }

          const trimmed = line.trim()
          if (trimmed.length > 0) {
            nonJsonStdoutLines.push(trimmed)
          }
        })
      })

      child.stderr.on('data', (chunk) => {
        const text = String(chunk)
        stderr += text
        stderrBuffer += text
        stderrBuffer = consumeCompleteLines(stderrBuffer, (line) => {
          const progressEvent = extractCodexStatusEventFromStderrLine(line)
          if (progressEvent) {
            input.onProgress?.(progressEvent)
          }
        })
      })

      child.stdin.on('error', (error) => {
        if (
          input.resumeSessionId &&
          (error as NodeJS.ErrnoException).code === 'EPIPE'
        ) {
          deferredStdinError = error as NodeJS.ErrnoException
          return
        }

        rejectOnce(error)
      })
      child.stdin.end(input.prompt)

      child.on('close', (code, signal) => {
        if (stderrBuffer.trim().length > 0) {
          const progressEvent = extractCodexStatusEventFromStderrLine(stderrBuffer)
          if (progressEvent) {
            input.onProgress?.(progressEvent)
          }
        }

        if (stdoutBuffer.trim().length > 0) {
          const parsed = tryParseJsonLine(stdoutBuffer)
          if (parsed.ok) {
            handleParsedEvent(parsed.value)
          } else {
            nonJsonStdoutLines.push(stdoutBuffer.trim())
          }
        }

        if (signal || code !== 0) {
          rejectOnce(
            abortRequested || signal === 'SIGINT'
              ? buildCodexInterruptedError({
                  providerSessionId: discoveredSessionId,
                  signal,
                })
              : buildCodexFailure({
                  code,
                  signal,
                  stderr,
                  fallback:
                    lastEventError ??
                    (stderr.trim().length === 0
                      ? deferredStdinError?.message ?? null
                      : null),
                  providerSessionId: discoveredSessionId,
                }),
          )
          return
        }

        if (deferredStdinError) {
          rejectOnce(deferredStdinError)
          return
        }

        resolveOnce()
      })
    })

    const finalMessage =
      (await readOptionalNonBlankTextFile(outputFile)) ??
      extractAssistantMessageFallback({
        assistantStreams,
        assistantStreamOrder,
      }) ??
      lastAgentMessage ??
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

async function resolveCodexChildEnv(input: {
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<NodeJS.ProcessEnv> {
  const nextEnv = sanitizeChildProcessEnv(input.env)
  const resolvedHome = resolveConfiguredCodexHome(input.codexHome)
  if (!resolvedHome) {
    return nextEnv
  }
  await assertAccessibleCodexHomeDirectory(resolvedHome)

  return {
    ...nextEnv,
    CODEX_HOME: resolvedHome,
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
  const activeProfileName = explicitProfile ?? config.defaultProfile
  const activeProfile = activeProfileName
    ? config.profiles[activeProfileName] ?? null
    : null

  return {
    model: explicitModel ?? activeProfile?.model ?? config.model,
    reasoningEffort:
      activeProfile?.reasoningEffort ?? config.reasoningEffort,
  }
}

function attachCodexAbortListener(input: {
  abortSignal?: AbortSignal
  onAbort: () => void
}): () => void {
  const signal = input.abortSignal
  if (!signal) {
    return () => {}
  }

  const handleAbort = () => {
    input.onAbort()
  }

  signal.addEventListener('abort', handleAbort, {
    once: true,
  })

  if (signal.aborted) {
    handleAbort()
  }

  return () => {
    signal.removeEventListener('abort', handleAbort)
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

  for (const override of input.configOverrides ?? []) {
    rootArgs.push('--config', override)
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

  args.push('-')

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

function resolveConfiguredCodexHome(
  codexHome: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(codexHome)
  if (!normalized) {
    return null
  }

  if (normalized === '~') {
    return homedir()
  }

  if (normalized.startsWith(`~${path.sep}`)) {
    return path.resolve(homedir(), normalized.slice(2))
  }

  return path.resolve(normalized)
}

async function assertAccessibleCodexHomeDirectory(
  resolvedHome: string,
): Promise<void> {
  try {
    await stat(resolvedHome)
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      `Configured Codex home does not exist: ${resolvedHome}`,
    )
  }

  let resolvedStats
  try {
    await access(
      resolvedHome,
      fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK,
    )
    resolvedStats = await stat(resolvedHome)
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      `Configured Codex home is not accessible: ${resolvedHome}`,
    )
  }

  if (!resolvedStats.isDirectory()) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      `Configured Codex home is not a directory: ${resolvedHome}`,
    )
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


function buildCodexFailure(input: {
  code: number | null
  fallback: string | null
  providerSessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): VaultCliError {
  const detail =
    normalizeStatusText(input.fallback ?? tailText(input.stderr)) ??
    input.fallback ??
    tailText(input.stderr)
  const resumeStale = isCodexResumeStaleText(
    [detail, input.stderr].filter((value): value is string => Boolean(value)).join('\n'),
  )
  const connectionLost = isCodexConnectionLossText(
    [detail, input.stderr].filter((value): value is string => Boolean(value)).join('\n'),
  )

  return new VaultCliError(
    resumeStale
      ? 'ASSISTANT_CODEX_RESUME_STALE'
      : connectionLost
        ? 'ASSISTANT_CODEX_CONNECTION_LOST'
        : 'ASSISTANT_CODEX_FAILED',
    resumeStale
      ? buildCodexResumeStaleMessage({
          ...input,
          fallback: detail,
        })
      : connectionLost
      ? buildCodexConnectionFailureMessage({
          ...input,
          fallback: detail,
        })
      : buildCodexFailureMessage({
          ...input,
          fallback: detail,
          sessionId: input.providerSessionId,
        }),
    {
      connectionLost,
      providerSessionId:
        connectionLost || resumeStale ? input.providerSessionId : null,
      recoverableConnectionLoss: connectionLost,
      retryable: connectionLost || resumeStale,
      staleResume: resumeStale,
    },
  )
}

function buildCodexInterruptedError(input: {
  providerSessionId: string | null
  signal: NodeJS.Signals | null
}): VaultCliError {
  const parts = ['Codex CLI was interrupted.']

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (input.providerSessionId) {
    parts.push(
      `Murph preserved provider session ${input.providerSessionId}, so the next turn can resume it.`,
    )
  }

  return new VaultCliError(
    'ASSISTANT_CODEX_INTERRUPTED',
    parts.join(' '),
    {
      interrupted: true,
      providerSessionId: input.providerSessionId,
      retryable: false,
    },
  )
}

function buildCodexConnectionFailureMessage(input: {
  code: number | null
  fallback: string | null
  providerSessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const parts = ['Codex CLI lost its connection while waiting for the model.']

  if (typeof input.code === 'number') {
    parts.push(`exit code ${input.code}.`)
  }

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (input.fallback) {
    parts.push(input.fallback)
  }

  parts.push(
    input.providerSessionId
      ? 'Murph preserved the provider session and will try to resume it automatically on the next turn once connectivity returns.'
      : 'Restore connectivity, then retry the request.',
  )

  return parts.join(' ')
}

function buildCodexFailureMessage(input: {
  code: number | null
  fallback: string | null
  sessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const detail =
    normalizeStatusText(input.fallback ?? tailText(input.stderr)) ??
    input.fallback ??
    tailText(input.stderr)
  const recoverableConnectionLoss =
    detail !== null && isCodexConnectionLossText(detail)

  if (recoverableConnectionLoss) {
    const parts = ['Codex CLI lost the provider stream before the turn finished.']

    if (typeof input.code === 'number') {
      parts.push(`exit code ${input.code}.`)
    }

    if (input.signal) {
      parts.push(`signal ${input.signal}.`)
    }

    if (detail) {
      parts.push(detail)
    }

    if (input.sessionId) {
      parts.push(
        `Murph recovered provider session ${input.sessionId}, so the next chat turn can resume it.`,
      )
    } else {
      parts.push('Send another message to retry the turn.')
    }

    return parts.join(' ')
  }

  const parts = ['Codex CLI failed.']

  if (typeof input.code === 'number') {
    parts.push(`exit code ${input.code}.`)
  }

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (detail) {
    parts.push(detail)
  }

  return parts.join(' ')
}

function buildCodexResumeStaleMessage(input: {
  code: number | null
  fallback: string | null
  providerSessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const parts = ['Codex CLI could not resume the saved provider session.']

  if (typeof input.code === 'number') {
    parts.push(`exit code ${input.code}.`)
  }

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (input.fallback) {
    parts.push(input.fallback)
  }

  parts.push('Murph should start a fresh provider session for this turn.')

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

function isCodexResumeStaleText(value: string): boolean {
  if (!value) {
    return false
  }

  const normalized = value.toLowerCase()
  return (
    normalized.includes('thread/resume failed') ||
    normalized.includes('no rollout found for thread id')
  )
}

async function readOptionalNonBlankTextFile(
  filePath: string,
): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
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
