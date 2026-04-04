import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type {
  AssistantApprovalPolicy,
  AssistantSandbox,
} from './assistant-cli-contracts.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import type {
  AssistantProviderProgressEvent,
} from './assistant/provider-progress.js'
import { sanitizeChildProcessEnv } from './child-process-env.js'
import { normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

export interface CodexExecInput {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy
  configOverrides?: readonly string[]
  codexCommand?: string
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

export type CodexProgressEvent = AssistantProviderProgressEvent

export async function executeCodexPrompt(
  input: CodexExecInput,
): Promise<CodexExecResult> {
  const codexCommand = input.codexCommand?.trim() || 'codex'
  const workingDirectory = path.resolve(input.workingDirectory)
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
        env: sanitizeChildProcessEnv(input.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let settled = false
      let abortRequested = false

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
                  fallback: lastEventError,
                  providerSessionId: discoveredSessionId,
                }),
          )
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

type CodexEventState = 'completed' | 'running'

type CodexNormalizedEvent =
  | {
      kind: 'assistant_delta'
      deltaText: string
      itemId: string | null
      rawEvent: unknown
    }
  | {
      kind: 'assistant_message'
      itemId: string | null
      itemState: CodexEventState
      rawEvent: unknown
      text: string
    }
  | {
      kind: 'error'
      message: string
      rawEvent: unknown
    }
  | {
      kind: 'model_rerouted'
      model: string
      rawEvent: unknown
    }
  | {
      kind: 'plan_update'
      itemId: string | null
      rawEvent: unknown
      text: string
    }
  | {
      kind: 'reasoning_delta'
      deltaText: string
      itemId: string | null
      rawEvent: unknown
    }
  | {
      kind: 'status_item'
      commandLabel: string | null
      exitCode: number | null
      filePaths: string[]
      itemId: string | null
      itemState: CodexEventState
      itemType: string
      planText: string | null
      reasoningText: string | null
      rawEvent: unknown
    }
  | {
      kind: 'tool_call'
      itemId: string | null
      itemState: CodexEventState
      rawEvent: unknown
      toolName: string | null
      toolServer: string | null
    }
  | {
      kind: 'web_search'
      itemId: string | null
      itemState: CodexEventState
      query: string | null
      rawEvent: unknown
    }
  | {
      kind: 'unknown'
      eventType: string | null
      rawEvent: unknown
    }

function normalizeCodexEvent(event: unknown): CodexNormalizedEvent {
  const record = asRecord(event)
  if (!record) {
    return {
      kind: 'unknown',
      eventType: null,
      rawEvent: event,
    }
  }

  const eventType = normalizeIdentifier(
    typeof record.type === 'string' ? record.type : null,
  )

  const errorText = extractCodexErrorMessage(event)
  const normalizedErrorText = normalizeStatusText(errorText)
  if (normalizedErrorText) {
    return {
      kind: 'error',
      message: normalizedErrorText,
      rawEvent: event,
    }
  }

  if (!eventType) {
    return {
      kind: 'unknown',
      eventType: null,
      rawEvent: event,
    }
  }

  if (eventType === 'model.rerouted') {
    const model = normalizeStatusText(
      findDeepStringByKeys(record, ['model', 'target_model', 'targetModel']) ??
        null,
    )
    if (!model) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'model_rerouted',
      model,
      rawEvent: event,
    }
  }

  const item = extractCodexEventItem(record)
  const itemType = extractCodexEventItemType(record, item)
  const itemState =
    eventType === 'item.started'
      ? 'running'
      : eventType === 'item.completed'
        ? 'completed'
        : null
  const itemId = extractCodexItemId(record, item)

  if (
    eventType.includes('agent.message.delta') ||
    eventType.includes('assistant.message.delta')
  ) {
    const deltaText = extractEventTextDelta(record)
    if (!deltaText) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'assistant_delta',
      deltaText,
      itemId,
      rawEvent: event,
    }
  }

  if (
    eventType.includes('reasoning.summary.text.delta') ||
    eventType.includes('reasoning.text.delta')
  ) {
    const deltaText = extractEventTextDelta(record)
    if (!deltaText) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'reasoning_delta',
      deltaText,
      itemId,
      rawEvent: event,
    }
  }

  if (eventType.endsWith('plan.updated')) {
    const text = extractCodexEventPlanText(record)
    if (!text) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'plan_update',
      itemId,
      rawEvent: event,
      text,
    }
  }

  if (itemType === 'agent.message' || itemType === 'assistant.message') {
    if (!itemState) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    const text = extractAssistantTextFromItem(item)
    if (!text) {
      return {
        kind: 'unknown',
        eventType,
        rawEvent: event,
      }
    }

    return {
      kind: 'assistant_message',
      itemId,
      itemState,
      rawEvent: event,
      text,
    }
  }

  if (!itemType || !itemState) {
    return {
      kind: 'unknown',
      eventType,
      rawEvent: event,
    }
  }

  if (itemType === 'web.search') {
    return {
      kind: 'web_search',
      itemId,
      itemState,
      query: normalizeStatusText(
        findDeepStringByKeys(item, ['query', 'search_query', 'searchQuery']) ??
          null,
      ),
      rawEvent: event,
    }
  }

  if (itemType === 'mcp.tool.call' || itemType === 'tool.call') {
    return {
      kind: 'tool_call',
      itemId,
      itemState,
      rawEvent: event,
      toolName: normalizeStatusText(
        findDeepStringByKeys(item, ['tool', 'tool_name', 'toolName', 'name']) ??
          null,
      ),
      toolServer: normalizeStatusText(
        findDeepStringByKeys(item, ['server', 'server_name', 'serverName']) ??
          null,
      ),
    }
  }

  return {
    kind: 'status_item',
    commandLabel: extractCommandLikeLabel(item),
    exitCode: extractNumericField(item, ['exit_code', 'exitCode']),
    filePaths: collectFilePaths(item),
    itemId,
    itemState,
    itemType,
    planText: extractCodexItemPlanText(item),
    reasoningText: extractReasoningTextFromItem(item),
    rawEvent: event,
  }
}

function extractCodexProgressEventFromNormalized(
  normalized: CodexNormalizedEvent,
): CodexProgressEvent | null {
  if (normalized.kind === 'error') {
    return {
      id: 'codex-status',
      kind: 'status',
      rawEvent: normalized.rawEvent,
      state: 'completed',
      text: normalized.message,
    }
  }

  if (normalized.kind === 'assistant_message') {
    return {
      id: normalized.itemId,
      kind: 'message',
      rawEvent: normalized.rawEvent,
      state: normalized.itemState,
      text: normalized.text,
    }
  }

  if (normalized.kind === 'status_item') {
    const text = statusItemProgressText(normalized)
    if (!text) {
      return null
    }

    const safeLabel =
      normalized.itemType === 'command.execution'
        ? summarizeCodexCommandProgressLabel(normalized.commandLabel)
        : null

    return {
      id: normalized.itemId,
      kind: statusItemProgressKind(normalized),
      label:
        normalized.itemType === 'command.execution'
          ? normalized.commandLabel
          : null,
      rawEvent: normalized.rawEvent,
      safeLabel,
      safeText:
        normalized.itemType === 'command.execution'
          ? commandProgressSafeText(normalized.itemState, safeLabel)
          : null,
      state: normalized.itemState,
      text,
    }
  }

  if (normalized.kind === 'tool_call') {
    const safeLabel = toolCallSafeLabel(normalized)
    return {
      id: normalized.itemId,
      kind: 'tool',
      label: toolCallLabel(normalized),
      rawEvent: normalized.rawEvent,
      safeLabel,
      safeText: toolCallSafeText(normalized.itemState, safeLabel),
      state: normalized.itemState,
      text: toolCallText(normalized),
    }
  }

  if (normalized.kind === 'web_search') {
    return {
      id: normalized.itemId,
      kind: 'search',
      rawEvent: normalized.rawEvent,
      state: normalized.itemState,
      text: webSearchProgressText(normalized),
    }
  }

  return null
}

function extractCodexStatusEventFromStderrLine(
  line: string,
): CodexProgressEvent | null {
  const text = normalizeStatusText(line)
  if (!text || !isCodexConnectionLossText(text)) {
    return null
  }

  return {
    id: 'codex-connection-status',
    kind: 'status',
    rawEvent: {
      type: 'stderr',
      line: text,
    },
    state: /\bre-connecting\b|\bretrying\b/iu.test(text) ? 'running' : 'completed',
    text,
  }
}

export function extractCodexTraceUpdates(
  event: unknown,
): AssistantProviderTraceUpdate[] {
  const normalized = normalizeCodexEvent(event)
  return extractCodexTraceUpdatesFromNormalized(normalized)
}

function extractCodexTraceUpdatesFromNormalized(
  normalized: CodexNormalizedEvent,
): AssistantProviderTraceUpdate[] {
  if (normalized.kind === 'error') {
    return [
      isRetryableConnectionStatus(normalized.message)
        ? {
            kind: 'status',
            mode: 'replace',
            streamKey: 'status:connection',
            text: normalized.message,
          }
        : {
            kind: 'error',
            text: normalized.message,
          },
    ]
  }

  if (normalized.kind === 'assistant_delta') {
    return [
      {
        kind: 'assistant',
        mode: 'append',
        streamKey: buildTraceStreamKey('assistant', normalized.itemId),
        text: normalized.deltaText,
      },
    ]
  }

  if (normalized.kind === 'reasoning_delta') {
    return [
      {
        kind: 'thinking',
        mode: 'append',
        streamKey: buildTraceStreamKey('thinking', normalized.itemId),
        text: normalized.deltaText,
      },
    ]
  }

  if (normalized.kind === 'plan_update') {
    return [
      {
        kind: 'thinking',
        mode: 'replace',
        streamKey: buildTraceStreamKey('thinking', normalized.itemId ?? 'plan'),
        text: normalized.text,
      },
    ]
  }

  if (normalized.kind === 'model_rerouted') {
    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'status:model-reroute',
        text: `Switched to ${normalized.model}.`,
      },
    ]
  }

  if (normalized.kind === 'assistant_message') {
    return [
      {
        kind: 'assistant',
        mode: 'replace',
        streamKey: buildTraceStreamKey('assistant', normalized.itemId),
        text: normalized.text,
      },
    ]
  }

  if (normalized.kind === 'status_item') {
    if (normalized.itemType === 'reasoning') {
      const text = statusItemTraceText(normalized)
      if (!text) {
        return []
      }

      return [
        {
          kind: 'thinking',
          mode: 'replace',
          streamKey: buildTraceStreamKey('thinking', normalized.itemId),
          text,
        },
      ]
    }

    const text = statusItemTraceText(normalized)
    if (!text) {
      return []
    }

    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: buildTraceStreamKey('status', statusItemTraceStreamId(normalized)),
        text,
      },
    ]
  }

  if (normalized.kind === 'tool_call') {
    const text = toolCallTraceText(normalized)
    if (!text) {
      return []
    }

    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: buildTraceStreamKey(
          'status',
          normalized.itemId ?? 'tool.call',
        ),
        text,
      },
    ]
  }

  if (normalized.kind === 'web_search') {
    const text = webSearchTraceText(normalized)
    if (!text) {
      return []
    }

    return [
      {
        kind: 'status',
        mode: 'replace',
        streamKey: buildTraceStreamKey('status', normalized.itemId ?? 'web.search'),
        text,
      },
    ]
  }

  return []
}

function statusItemProgressKind(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): CodexProgressEvent['kind'] {
  if (event.itemType === 'reasoning') {
    return 'reasoning'
  }
  if (event.itemType === 'command.execution') {
    return 'command'
  }
  if (event.itemType === 'file.change') {
    return 'file'
  }
  if (event.itemType === 'plan') {
    return 'plan'
  }

  return 'status'
}

function statusItemProgressText(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string | null {
  if (event.itemType === 'reasoning') {
    return (
      event.reasoningText ??
      (event.itemState === 'running'
        ? 'Thinking…'
        : 'Thought through the next step.')
    )
  }

  if (event.itemType === 'command.execution') {
    if (!event.commandLabel) {
      return null
    }

    return `$ ${event.commandLabel}`
  }

  if (event.itemType === 'file.change') {
    return event.filePaths.length === 0
      ? 'Updated files.'
      : event.filePaths.length === 1
        ? `Changed ${event.filePaths[0]}`
        : `Changed files: ${event.filePaths.slice(0, 3).join(', ')}${event.filePaths.length > 3 ? ', …' : ''}`
  }

  if (event.itemType === 'plan') {
    return event.planText
      ? `Plan:\n${event.planText}`
      : 'Updated the plan.'
  }

  return null
}

function statusItemTraceText(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string | null {
  if (event.itemType === 'command.execution') {
    const isRunning = event.itemState === 'running'
    if (isRunning) {
      return event.commandLabel
        ? `Running ${event.commandLabel}.`
        : 'Running command.'
    }

    if (typeof event.exitCode === 'number') {
      return event.commandLabel
        ? event.exitCode === 0
          ? `Finished ${event.commandLabel}.`
          : `${event.commandLabel} exited with code ${event.exitCode}.`
        : event.exitCode === 0
          ? 'Command finished.'
          : `Command exited with code ${event.exitCode}.`
    }

    return event.commandLabel
      ? `Finished ${event.commandLabel}.`
      : 'Command finished.'
  }

  if (event.itemType === 'reasoning') {
    return event.reasoningText ?? null
  }

  if (event.itemType === 'file.change' && event.itemState === 'completed') {
    if (event.filePaths.length === 0) {
      return 'Updated files.'
    }

    if (event.filePaths.length === 1) {
      return `Updated ${event.filePaths[0]}.`
    }

    return `Updated files: ${event.filePaths.slice(0, 3).join(', ')}${event.filePaths.length > 3 ? ', …' : ''}.`
  }

  return null
}

function toolCallText(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string {
  return event.toolName &&
    event.toolServer &&
    event.toolServer !== event.toolName
    ? `Tool ${event.toolServer}.${event.toolName}`
    : event.toolName
      ? `Tool ${event.toolName}`
      : event.toolServer
        ? `Tool ${event.toolServer}`
        : 'Used a tool.'
}

function toolCallLabel(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string | null {
  return event.toolServer && event.toolName
    ? `${event.toolServer}/${event.toolName}`
    : event.toolName ?? event.toolServer ?? null
}

function toolCallSafeLabel(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string | null {
  return normalizeStatusText(toolCallLabel(event))
}

function toolCallSafeText(
  state: 'completed' | 'running',
  safeLabel: string | null,
): string | null {
  if (!safeLabel) {
    return null
  }

  return state === 'running'
    ? `using ${safeLabel}`
    : `finished ${safeLabel}`
}

function toolCallTraceText(
  event: Extract<CodexNormalizedEvent, { kind: 'tool_call' }>,
): string | null {
  const label = toolCallLabel(event) ?? 'tool call'

  return event.itemState === 'running'
    ? `Using ${label}.`
    : `Finished ${label}.`
}

function webSearchProgressText(
  event: Extract<CodexNormalizedEvent, { kind: 'web_search' }>,
): string {
  return event.query ? `Web: ${event.query}` : 'Ran a web search.'
}

function webSearchTraceText(
  event: Extract<CodexNormalizedEvent, { kind: 'web_search' }>,
): string {
  return event.itemState === 'running'
    ? event.query
      ? `Searching the web for ${JSON.stringify(event.query)}.`
      : 'Searching the web.'
    : event.query
      ? `Finished web search for ${JSON.stringify(event.query)}.`
      : 'Finished web search.'
}

function commandProgressSafeText(
  state: 'completed' | 'running',
  safeLabel: string | null,
): string | null {
  if (!safeLabel) {
    return null
  }

  return state === 'running'
    ? `running ${safeLabel}`
    : `finished ${safeLabel}`
}

function statusItemTraceStreamId(
  event: Extract<CodexNormalizedEvent, { kind: 'status_item' }>,
): string {
  return event.itemId ?? event.itemType
}

function extractCodexEventItem(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const directItem = asRecord(event.item)
  if (directItem) {
    return directItem
  }

  const data = asRecord(event.data)
  const nestedItem = asRecord(data?.item)
  if (nestedItem) {
    return nestedItem
  }

  return null
}

function extractCodexEventItemType(
  event: Record<string, unknown>,
  item: Record<string, unknown> | null,
): string | null {
  return normalizeIdentifier(
    typeof item?.type === 'string'
      ? item.type
      : typeof event.item_type === 'string'
        ? event.item_type
        : typeof event.itemType === 'string'
          ? event.itemType
          : null,
  )
}

function extractCodexItemId(
  event: Record<string, unknown>,
  item: Record<string, unknown> | null,
): string | null {
  return (
    normalizeNullableString(
      typeof item?.id === 'string'
        ? item.id
        : typeof event.item_id === 'string'
          ? event.item_id
          : typeof event.itemId === 'string'
            ? event.itemId
            : null,
    ) ?? null
  )
}

function extractCodexEventPlanText(
  event: Record<string, unknown>,
): string | null {
  return normalizeStreamingText(
    findDeepStringByKeys(event, ['explanation', 'summary', 'plan']) ?? null,
  )
}

function extractCodexItemPlanText(
  item: Record<string, unknown> | null,
): string | null {
  return normalizeStreamingText(
    findDeepStringByKeys(item, ['explanation', 'summary', 'message', 'text']) ?? null,
  )
}

function extractAssistantTextFromItem(
  item: Record<string, unknown> | null,
): string | null {
  if (!item) {
    return null
  }

  return normalizeStreamingText(
    typeof item.text === 'string'
      ? item.text
      : typeof item.message === 'string'
        ? item.message
        : collectTextParts(item.content) ?? collectTextParts(item.parts),
  )
}

function extractReasoningTextFromItem(
  item: Record<string, unknown> | null,
): string | null {
  if (!item) {
    return null
  }

  return normalizeStreamingText(
    collectReasoningSummaryParts(item.summary) ??
      collectReasoningSummaryParts(item.summary_parts) ??
      collectTextParts(item.content) ??
      collectTextParts(item.parts) ??
      (typeof item.text === 'string' ? item.text : null),
  )
}

function collectReasoningSummaryParts(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null
  }

  const parts = value
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      const record = asRecord(part)
      if (!record) {
        return null
      }

      return collectTextParts(record.text) ?? collectTextParts(record.content)
    })
    .filter((part): part is string => typeof part === 'string' && part.length > 0)

  if (parts.length === 0) {
    return null
  }

  return parts.join('\n\n')
}

function collectTextParts(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (!Array.isArray(value)) {
    const record = asRecord(value)
    if (!record) {
      return null
    }

    return (
      (typeof record.text === 'string' ? record.text : null) ??
      (typeof record.value === 'string' ? record.value : null) ??
      collectTextParts(record.content)
    )
  }

  const parts: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      parts.push(entry)
      continue
    }

    const record = asRecord(entry)
    if (!record) {
      continue
    }

    const nestedText =
      (typeof record.text === 'string' ? record.text : null) ??
      (typeof record.value === 'string' ? record.value : null) ??
      collectTextParts(record.content)

    if (nestedText) {
      parts.push(nestedText)
    }
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join('')
}

function extractEventTextDelta(record: Record<string, unknown>): string | null {
  const directDelta =
    (typeof record.delta === 'string' ? record.delta : null) ??
    (typeof record.text_delta === 'string' ? record.text_delta : null) ??
    (typeof record.textDelta === 'string' ? record.textDelta : null) ??
    (typeof record.text === 'string' ? record.text : null) ??
    (typeof record.value === 'string' ? record.value : null)

  if (directDelta) {
    return normalizeStreamingText(directDelta)
  }

  const delta = asRecord(record.delta)
  if (!delta) {
    return null
  }

  return normalizeStreamingText(
    (typeof delta.text === 'string' ? delta.text : null) ??
      (typeof delta.value === 'string' ? delta.value : null) ??
      (typeof delta.content === 'string' ? delta.content : null) ??
      null,
  )
}

function extractCommandLikeLabel(item: Record<string, unknown> | null): string | null {
  return normalizeStatusText(
    findDeepStringByKeys(item, [
      'command',
      'command_line',
      'commandLine',
      'cmd',
      'label',
      'description',
      'query',
    ]) ?? null,
  )
}

function summarizeCodexCommandProgressLabel(value: string | null | undefined): string | null {
  const normalized = normalizeStatusText(value)
  if (!normalized) {
    return null
  }

  const tokens = splitCodexCommandLabel(normalized)
  if (tokens.length === 0) {
    return normalized
  }

  if (
    tokens.length >= 3 &&
    ['bash', 'sh', 'zsh'].includes(tokens[0]!.toLowerCase()) &&
    tokens[1] === '-lc'
  ) {
    return summarizeCodexCommandProgressLabel(tokens.slice(2).join(' '))
  }

  let startIndex = 0
  if (
    tokens[0]?.toLowerCase() === 'node' &&
    tokens[1] &&
    simplifyCodexCommandToken(tokens[1]) === 'bin.js'
  ) {
    startIndex = 2
  } else if (simplifyCodexCommandToken(tokens[0]) === 'bin.js') {
    startIndex = 1
  }

  const summaryTokens: string[] = []
  for (const token of tokens.slice(startIndex)) {
    const normalizedToken = simplifyCodexCommandToken(token)
    if (!normalizedToken) {
      continue
    }

    if (normalizedToken.startsWith('-') && summaryTokens.length > 0) {
      break
    }

    summaryTokens.push(normalizedToken)
    if (summaryTokens.length >= 5) {
      break
    }
  }

  return normalizeStatusText(summaryTokens.join(' ')) ?? normalized
}

function splitCodexCommandLabel(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/gu) ?? []
}

function simplifyCodexCommandToken(token: string): string | null {
  const trimmed = token.trim()
  if (trimmed.length === 0) {
    return null
  }

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed
  const compact = unquoted.trim()
  if (compact.length === 0) {
    return null
  }

  const slashParts = compact.split(/[\\/]/u)
  const tail = slashParts[slashParts.length - 1] ?? compact
  if (tail.length === 0) {
    return null
  }

  return normalizeStatusText(tail) ?? normalizeStatusText(compact)
}

function collectFilePaths(item: Record<string, unknown> | null): string[] {
  const collected = new Set<string>()
  collectDeepStringsByKeys(
    item,
    ['path', 'file_path', 'filePath', 'relative_path', 'relativePath'],
    collected,
  )
  return [...collected]
}

function collectDeepStringsByKeys(
  value: unknown,
  keys: readonly string[],
  output: Set<string>,
  visited = new Set<unknown>(),
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (visited.has(value)) {
    return
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDeepStringsByKeys(entry, keys, output, visited)
    }
    return
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string') {
      const normalizedCandidate = redactCodexStatusText(candidate.trim())
      if (normalizedCandidate.length > 0) {
        output.add(normalizedCandidate)
      }
    }
  }

  for (const nested of Object.values(record)) {
    collectDeepStringsByKeys(nested, keys, output, visited)
  }
}

function extractNumericField(
  value: unknown,
  keys: readonly string[],
  visited = new Set<unknown>(),
): number | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (visited.has(value)) {
    return null
  }
  visited.add(value)

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractNumericField(entry, keys, visited)
      if (nested !== null) {
        return nested
      }
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }

  for (const nested of Object.values(record)) {
    const result = extractNumericField(nested, keys, visited)
    if (result !== null) {
      return result
    }
  }

  return null
}

function extractAssistantMessageFallback(input: {
  assistantStreams: Map<string, string>
  assistantStreamOrder: readonly string[]
}): string | null {
  for (let index = input.assistantStreamOrder.length - 1; index >= 0; index -= 1) {
    const streamKey = input.assistantStreamOrder[index]
    if (!streamKey) {
      continue
    }

    const text = normalizeStreamingText(input.assistantStreams.get(streamKey) ?? null)
    if (text) {
      return text.trim()
    }
  }

  return null
}

function buildTraceStreamKey(
  kind: 'assistant' | 'status' | 'thinking',
  itemId: string | null,
): string {
  return `${kind}:${itemId ?? 'main'}`
}

function normalizeIdentifier(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  return trimmed
    .replace(/([a-z0-9])([A-Z])/gu, '$1.$2')
    .replace(/[^A-Za-z0-9]+/gu, '.')
    .replace(/\.+/gu, '.')
    .replace(/^\.|\.$/gu, '')
    .toLowerCase()
}

function normalizeStreamingText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/\r\n?/gu, '\n')
  return normalized.length > 0 ? normalized : null
}

function normalizeStatusText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = redactCodexStatusText(value.replace(/\r\n?/gu, '\n')).trim()
  return normalized.length > 0 ? normalized : null
}

function redactCodexStatusText(value: string): string {
  const homeRoot = homedir().trim()
  if (homeRoot.length === 0) {
    return value
  }

  return value.replaceAll(homeRoot, '~')
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
  const connectionLost = isCodexConnectionLossText(
    [detail, input.stderr].filter((value): value is string => Boolean(value)).join('\n'),
  )

  return new VaultCliError(
    connectionLost
      ? 'ASSISTANT_CODEX_CONNECTION_LOST'
      : 'ASSISTANT_CODEX_FAILED',
    connectionLost
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
      providerSessionId: connectionLost ? input.providerSessionId : null,
      recoverableConnectionLoss: connectionLost,
      retryable: connectionLost,
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

function isRetryableConnectionStatus(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('reconnect') ||
    normalized.includes('retry') ||
    normalized.includes('trying again')
  )
}

function isCodexConnectionLossText(message: string): boolean {
  const normalized = message.toLowerCase()
  if (isCodexMcpBootstrapFailureText(normalized)) {
    return false
  }

  return (
    normalized.includes('stream disconnected') ||
    normalized.includes('stream closed before response.completed') ||
    normalized.includes('lost the provider stream') ||
    normalized.includes('network error while contacting openai') ||
    normalized.includes('connection closed prematurely') ||
    normalized.includes('connection reset') ||
    normalized.includes('connection lost') ||
    normalized.includes('connection closed') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('etimedout') ||
    normalized.includes('enotfound') ||
    normalized.includes('eai_again') ||
    normalized.includes('fetch failed') ||
    normalized.includes('exceeded retry limit') ||
    normalized.includes('retry limit') ||
    normalized.includes('re-connecting') ||
    normalized.includes('retrying') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout')
  )
}

function isCodexMcpBootstrapFailureText(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes('required mcp servers failed to initialize') ||
    normalizedMessage.includes('handshaking with mcp server failed') ||
    normalizedMessage.includes('initialize response')
  )
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}
