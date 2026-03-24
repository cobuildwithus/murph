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

export interface CodexProgressEvent {
  id: string | null
  kind:
    | 'command'
    | 'file'
    | 'message'
    | 'plan'
    | 'reasoning'
    | 'search'
    | 'status'
    | 'tool'
  rawEvent: unknown
  state: 'completed' | 'running'
  text: string
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

    const updates = extractCodexTraceUpdates(event)
    for (const update of updates) {
      recordAssistantTraceUpdate(update)
    }

    input.onTraceEvent?.({
      providerSessionId: discoveredSessionId,
      rawEvent: event,
      updates,
    })

    const progressEvent = extractCodexProgressEvent(event)
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
        stdio: ['ignore', 'pipe', 'pipe'],
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
      (await readOptionalTextFile(outputFile)) ??
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

function sanitizeChildProcessEnv(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const nextEnv = { ...(env ?? process.env) }
  delete nextEnv.NODE_V8_COVERAGE
  return nextEnv
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

function extractCodexProgressEvent(event: unknown): CodexProgressEvent | null {
  const record = asRecord(event)
  if (!record) {
    return null
  }

  const eventType = normalizeIdentifier(
    typeof record.type === 'string' ? record.type : null,
  )
  if (!eventType) {
    return null
  }

  const errorText = normalizeStatusText(extractCodexErrorMessage(record))
  if (errorText) {
    return {
      id: 'codex-status',
      kind: 'status',
      rawEvent: event,
      state: 'completed',
      text: errorText,
    }
  }

  const item = extractCodexEventItem(record)
  const itemId = extractCodexItemId(record, item)
  const itemType = normalizeIdentifier(
    typeof item?.type === 'string'
      ? item.type
      : typeof record.item_type === 'string'
        ? record.item_type
        : typeof record.itemType === 'string'
          ? record.itemType
          : null,
  )
  if (!itemType || (eventType !== 'item.started' && eventType !== 'item.completed')) {
    return null
  }

  const state = eventType === 'item.started' ? 'running' : 'completed'

  if (itemType === 'reasoning') {
    return {
      id: itemId,
      kind: 'reasoning',
      rawEvent: event,
      state,
      text:
        extractReasoningTextFromItem(item) ??
        (state === 'running' ? 'Thinking…' : 'Thought through the next step.'),
    }
  }

  if (itemType === 'command.execution') {
    const command = extractCommandLikeLabel(item)
    if (!command) {
      return null
    }

    return {
      id: itemId,
      kind: 'command',
      rawEvent: event,
      state,
      text: `$ ${command}`,
    }
  }

  if (itemType === 'mcp.tool.call' || itemType === 'tool.call') {
    const server = normalizeStatusText(
      findDeepStringByKeys(item, ['server', 'server_name', 'serverName']) ?? null,
    )
    const tool = normalizeStatusText(
      findDeepStringByKeys(item, ['tool', 'tool_name', 'toolName', 'name']) ?? null,
    )

    return {
      id: itemId,
      kind: 'tool',
      rawEvent: event,
      state,
      text:
        tool && server && server !== tool
          ? `Tool ${server}.${tool}`
          : tool
            ? `Tool ${tool}`
            : server
              ? `Tool ${server}`
              : 'Used a tool.',
    }
  }

  if (itemType === 'web.search') {
    const query = normalizeStatusText(
      findDeepStringByKeys(item, ['query', 'search_query', 'searchQuery']) ?? null,
    )

    return {
      id: itemId,
      kind: 'search',
      rawEvent: event,
      state,
      text: query ? `Web: ${query}` : 'Ran a web search.',
    }
  }

  if (itemType === 'file.change') {
    const paths = collectFilePaths(item)
    const text =
      paths.length === 0
        ? 'Updated files.'
        : paths.length === 1
          ? `Changed ${paths[0]}`
          : `Changed files: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''}`

    return {
      id: itemId,
      kind: 'file',
      rawEvent: event,
      state,
      text,
    }
  }

  if (itemType === 'plan') {
    const planText = normalizeStreamingText(
      findDeepStringByKeys(item, ['explanation', 'summary', 'message', 'text']) ??
        findDeepStringByKeys(record, ['explanation', 'summary', 'plan']) ??
        null,
    )

    return {
      id: itemId,
      kind: 'plan',
      rawEvent: event,
      state,
      text: planText ? `Plan:\n${planText}` : 'Updated the plan.',
    }
  }

  if (itemType === 'agent.message' || itemType === 'assistant.message') {
    const assistantText = extractAssistantTextFromItem(item)
    if (!assistantText) {
      return null
    }

    return {
      id: itemId,
      kind: 'message',
      rawEvent: event,
      state,
      text: assistantText,
    }
  }

  const statusText = summarizeCodexStatusItem({
    eventType,
    item,
    itemId,
    itemType,
  })
  if (!statusText) {
    return null
  }

  return {
    id: itemId ?? `status:${itemType}`,
    kind: 'status',
    rawEvent: event,
    state,
    text: statusText,
  }
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
  const record = asRecord(event)
  if (!record) {
    return []
  }

  const eventType = normalizeIdentifier(
    typeof record.type === 'string' ? record.type : null,
  )
  if (eventType === null) {
    return []
  }

  const errorMessage = extractCodexErrorMessage(record)
  if (errorMessage) {
    const normalizedErrorMessage = normalizeStatusText(errorMessage)
    if (!normalizedErrorMessage) {
      return []
    }

    return [
      isRetryableConnectionStatus(normalizedErrorMessage)
        ? {
            kind: 'status',
            mode: 'replace',
            streamKey: 'status:connection',
            text: normalizedErrorMessage,
          }
        : {
            kind: 'error',
            text: normalizedErrorMessage,
          },
    ]
  }

  const item = extractCodexEventItem(record)
  const itemId = extractCodexItemId(record, item)
  const itemType = normalizeIdentifier(
    typeof item?.type === 'string'
      ? item.type
      : typeof record.item_type === 'string'
        ? record.item_type
        : typeof record.itemType === 'string'
          ? record.itemType
          : null,
  )

  if (
    eventType.includes('agent.message.delta') ||
    eventType.includes('assistant.message.delta')
  ) {
    const textDelta = extractEventTextDelta(record)
    return textDelta
      ? [
          {
            kind: 'assistant',
            mode: 'append',
            streamKey: buildTraceStreamKey('assistant', itemId),
            text: textDelta,
          },
        ]
      : []
  }

  if (
    eventType.includes('reasoning.summary.text.delta') ||
    eventType.includes('reasoning.text.delta')
  ) {
    const textDelta = extractEventTextDelta(record)
    return textDelta
      ? [
          {
            kind: 'thinking',
            mode: 'append',
            streamKey: buildTraceStreamKey('thinking', itemId),
            text: textDelta,
          },
        ]
      : []
  }

  if (eventType.endsWith('plan.updated')) {
    const planText = normalizeStreamingText(
      findDeepStringByKeys(record, ['explanation', 'summary', 'plan']) ?? null,
    )

    return planText
      ? [
          {
            kind: 'thinking',
            mode: 'replace',
            streamKey: buildTraceStreamKey('thinking', itemId ?? 'plan'),
            text: planText,
          },
        ]
      : []
  }

  if (eventType === 'model.rerouted') {
    const reroutedModel = normalizeStatusText(
      findDeepStringByKeys(record, ['model', 'target_model', 'targetModel']) ?? null,
    )

    return reroutedModel
      ? [
          {
            kind: 'status',
            mode: 'replace',
            streamKey: 'status:model-reroute',
            text: `Switched to ${reroutedModel}.`,
          },
        ]
      : []
  }

  if (eventType !== 'item.started' && eventType !== 'item.completed') {
    return []
  }

  if (itemType === 'agent.message' || itemType === 'assistant.message') {
    const assistantText = extractAssistantTextFromItem(item)
    return assistantText
      ? [
          {
            kind: 'assistant',
            mode: 'replace',
            streamKey: buildTraceStreamKey('assistant', itemId),
            text: assistantText,
          },
        ]
      : []
  }

  if (itemType === 'reasoning') {
    const reasoningText = extractReasoningTextFromItem(item)
    return reasoningText
      ? [
          {
            kind: 'thinking',
            mode: 'replace',
            streamKey: buildTraceStreamKey('thinking', itemId),
            text: reasoningText,
          },
        ]
      : []
  }

  const statusText = summarizeCodexStatusItem({
    eventType,
    item,
    itemId,
    itemType,
  })

  return statusText
    ? [
        {
          kind: 'status',
          mode: 'replace',
          streamKey: buildTraceStreamKey('status', itemId ?? itemType),
          text: statusText,
        },
      ]
    : []
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

function summarizeCodexStatusItem(input: {
  eventType: string
  item: Record<string, unknown> | null
  itemId: string | null
  itemType: string | null
}): string | null {
  const itemType = input.itemType
  if (!itemType) {
    return null
  }

  const started = input.eventType === 'item.started'
  const completed = input.eventType === 'item.completed'

  if (itemType === 'command.execution') {
    const command = extractCommandLikeLabel(input.item)
    const exitCode = extractNumericField(input.item, ['exit_code', 'exitCode'])

    if (started) {
      return command ? `Running ${command}.` : 'Running command.'
    }

    if (completed && typeof exitCode === 'number') {
      return command
        ? exitCode === 0
          ? `Finished ${command}.`
          : `${command} exited with code ${exitCode}.`
        : exitCode === 0
          ? 'Command finished.'
          : `Command exited with code ${exitCode}.`
    }

    return command ? `Finished ${command}.` : 'Command finished.'
  }

  if (itemType === 'mcp.tool.call' || itemType === 'tool.call') {
    const server = normalizeStatusText(
      findDeepStringByKeys(input.item, ['server', 'server_name', 'serverName']) ?? null,
    )
    const tool = normalizeStatusText(
      findDeepStringByKeys(input.item, ['tool', 'tool_name', 'toolName', 'name']) ?? null,
    )
    const label =
      server && tool
        ? `${server}/${tool}`
        : tool ?? server ?? 'tool call'

    return started
      ? `Using ${label}.`
      : completed
        ? `Finished ${label}.`
        : null
  }

  if (itemType === 'web.search') {
    const query = normalizeStatusText(
      findDeepStringByKeys(input.item, ['query', 'search_query', 'searchQuery']) ?? null,
    )

    if (started) {
      return query ? `Searching the web for ${JSON.stringify(query)}.` : 'Searching the web.'
    }

    return query ? `Finished web search for ${JSON.stringify(query)}.` : 'Finished web search.'
  }

  if (itemType === 'file.change' && completed) {
    const paths = collectFilePaths(input.item)
    if (paths.length === 0) {
      return 'Updated files.'
    }

    if (paths.length === 1) {
      return `Updated ${paths[0]}.`
    }

    return `Updated files: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''}.`
  }

  return null
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
      `Healthy Bob preserved provider session ${input.providerSessionId}, so the next turn can resume it.`,
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
      ? 'Healthy Bob preserved the provider session and will try to resume it automatically on the next turn once connectivity returns.'
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
        `Healthy Bob recovered provider session ${input.sessionId}, so the next chat turn can resume it.`,
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
