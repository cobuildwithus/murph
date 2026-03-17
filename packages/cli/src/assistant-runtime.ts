import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantAskResultSchema,
  assistantChatResultSchema,
  assistantRunResultSchema,
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantSandbox,
} from './assistant-cli-contracts.js'
import { deliverAssistantMessage } from './assistant-channel.js'
import {
  executeAssistantProviderTurn,
  resolveAssistantProviderOptions,
} from './assistant-provider.js'
import type { AssistantModelSpec } from './assistant-harness.js'
import { routeInboxCaptureWithModel } from './inbox-model-harness.js'
import type { InboxCliServices } from './inbox-services.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant-state.js'
import type { VaultCliServices } from './vault-cli-services.js'

export interface AssistantMessageInput {
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  channel?: string | null
  codexCommand?: string
  deliverResponse?: boolean
  deliveryTarget?: string | null
  identityId?: string | null
  model?: string | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  prompt: string
  provider?: AssistantChatProvider
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  sourceThreadId?: string | null
  vault: string
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'prompt'> {
  initialPrompt?: string | null
}

export interface AssistantRunEvent {
  captureId?: string
  details?: string
  tools?: string[]
  type:
    | 'capture.failed'
    | 'capture.noop'
    | 'capture.routed'
    | 'capture.skipped'
    | 'scan.started'
}

export interface AssistantInboxScanResult {
  considered: number
  failed: number
  noAction: number
  routed: number
  skipped: number
}

export interface RunAssistantAutomationInput {
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec: AssistantModelSpec
  onEvent?: (event: AssistantRunEvent) => void
  once?: boolean
  requestId?: string | null
  scanIntervalMs?: number
  signal?: AbortSignal
  startDaemon?: boolean
  vault: string
  vaultServices?: VaultCliServices
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
): Promise<ReturnType<typeof assistantAskResultSchema.parse>> {
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    participantId: input.participantId,
    sourceThreadId: input.sourceThreadId,
    provider: input.provider,
    model: input.model,
    sandbox: input.sandbox ?? 'read-only',
    approvalPolicy: input.approvalPolicy ?? 'never',
    oss: input.oss ?? false,
    profile: input.profile,
  })

  const aliasKey = resolveAssistantAliasKey(input)
  const providerOptions = resolveAssistantProviderOptions({
    model: input.model ?? resolved.session.providerOptions.model,
    sandbox: input.sandbox ?? resolved.session.providerOptions.sandbox,
    approvalPolicy:
      input.approvalPolicy ?? resolved.session.providerOptions.approvalPolicy,
    profile: input.profile ?? resolved.session.providerOptions.profile,
    oss: input.oss ?? resolved.session.providerOptions.oss,
  })

  const providerResult = await executeAssistantProviderTurn({
    provider: input.provider ?? resolved.session.provider,
    workingDirectory: input.workingDirectory ?? input.vault,
    prompt: buildAssistantPrompt({
      prompt: input.prompt,
      session: resolved.session,
      isFirstTurn: resolved.created || resolved.session.turnCount === 0,
    }),
    resumeProviderSessionId: resolved.session.providerSessionId,
    codexCommand: input.codexCommand,
    model: providerOptions.model,
    sandbox: providerOptions.sandbox,
    approvalPolicy: providerOptions.approvalPolicy,
    profile: providerOptions.profile,
    oss: providerOptions.oss,
  })

  const updatedAt = new Date().toISOString()
  let session = await saveAssistantSession(input.vault, {
    ...resolved.session,
    provider: providerResult.provider,
    providerSessionId:
      providerResult.providerSessionId ?? resolved.session.providerSessionId,
    providerOptions,
    alias: aliasKey ?? resolved.session.alias,
    channel: normalizeNullableString(input.channel) ?? resolved.session.channel,
    identityId:
      normalizeNullableString(input.identityId) ?? resolved.session.identityId,
    participantId:
      normalizeNullableString(input.participantId) ??
      resolved.session.participantId,
    sourceThreadId:
      normalizeNullableString(input.sourceThreadId) ??
      resolved.session.sourceThreadId,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: resolved.session.turnCount + 1,
    lastUserMessage: summarizeAssistantTurn(input.prompt),
    lastAssistantMessage: summarizeAssistantTurn(providerResult.response),
  })

  let delivery: ReturnType<typeof assistantAskResultSchema.parse>['delivery'] = null

  if (input.deliverResponse) {
    const delivered = await deliverAssistantMessage({
      vault: input.vault,
      sessionId: session.sessionId,
      channel: session.channel,
      identityId: session.identityId,
      participantId: session.participantId,
      sourceThreadId: session.sourceThreadId,
      target: normalizeNullableString(input.deliveryTarget),
      message: providerResult.response,
    })
    session = delivered.session
    delivery = delivered.delivery
  }

  return assistantAskResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    prompt: input.prompt,
    response: providerResult.response,
    session,
    delivery,
  })
}

export async function runAssistantChat(
  input: AssistantChatInput,
): Promise<ReturnType<typeof assistantChatResultSchema.parse>> {
  const { runAssistantChatWithInk } = await import('./assistant-chat-ink.js')
  return runAssistantChatWithInk(input)
}

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
): Promise<ReturnType<typeof assistantRunResultSchema.parse>> {
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  const cleanup = bridgeAbortSignals(controller, input.signal)
  const aggregate: AssistantInboxScanResult = {
    considered: 0,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }
  let scans = 0
  let lastError: string | null = null
  const daemonStarted = input.startDaemon ?? true

  let daemonPromise: Promise<unknown> | null = null
  if (daemonStarted) {
    daemonPromise = input.inboxServices
      .run(
        {
          vault: input.vault,
          requestId: input.requestId ?? null,
        },
        {
          signal: controller.signal,
        },
      )
      .catch((error) => {
        lastError = errorMessage(error)
        controller.abort()
        throw error
      })
  }

  try {
    while (!controller.signal.aborted) {
      scans += 1
      const scanResult = await scanAssistantInboxOnce({
        inboxServices: input.inboxServices,
        requestId: input.requestId,
        vault: input.vault,
        vaultServices: input.vaultServices,
        modelSpec: input.modelSpec,
        maxPerScan: input.maxPerScan,
        signal: controller.signal,
        onEvent: input.onEvent,
      })
      aggregate.considered += scanResult.considered
      aggregate.failed += scanResult.failed
      aggregate.noAction += scanResult.noAction
      aggregate.routed += scanResult.routed
      aggregate.skipped += scanResult.skipped

      if (input.once) {
        break
      }

      await waitForAbortOrTimeout(
        controller.signal,
        normalizeScanInterval(input.scanIntervalMs),
      )
    }

    const finalReason =
      lastError !== null
        ? 'error'
        : controller.signal.aborted
          ? 'signal'
          : 'completed'

    return assistantRunResultSchema.parse({
      vault: redactAssistantDisplayPath(input.vault),
      startedAt,
      stoppedAt: new Date().toISOString(),
      reason: finalReason,
      daemonStarted,
      scans,
      considered: aggregate.considered,
      routed: aggregate.routed,
      noAction: aggregate.noAction,
      skipped: aggregate.skipped,
      failed: aggregate.failed,
      lastError,
    })
  } catch (error) {
    lastError = errorMessage(error)
    throw error
  } finally {
    controller.abort()
    cleanup()

    if (daemonPromise) {
      try {
        await daemonPromise
      } catch {
        // surfaced through lastError/reason when relevant
      }
    }
  }
}

export async function scanAssistantInboxOnce(input: {
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec: AssistantModelSpec
  onEvent?: (event: AssistantRunEvent) => void
  requestId?: string | null
  signal?: AbortSignal
  vault: string
  vaultServices?: VaultCliServices
  }): Promise<AssistantInboxScanResult> {
  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: normalizeScanLimit(input.maxPerScan),
    sourceId: null,
  })
  const captures = [...listed.items].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  )
  input.onEvent?.({
    type: 'scan.started',
    details: `${captures.length} capture(s)`,
  })

  const summary: AssistantInboxScanResult = {
    considered: captures.length,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }

  for (const capture of captures) {
    if (input.signal?.aborted) {
      break
    }

    try {
      const existingArtifact = await assistantResultArtifactExists(
        input.vault,
        capture.captureId,
      )
      if (existingArtifact) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'assistant result already exists',
        })
        continue
      }

      if (capture.promotions.length > 0) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'capture already promoted',
        })
        continue
      }

      const shown = await input.inboxServices.show({
        vault: input.vault,
        requestId: input.requestId ?? null,
        captureId: capture.captureId,
      })

      const waitingForParser = shown.capture.attachments.some(
        (attachment) =>
          attachment.parseState === 'pending' ||
          attachment.parseState === 'running',
      )
      if (waitingForParser) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'waiting for parser completion',
        })
        continue
      }

      const result = await routeInboxCaptureWithModel({
        inboxServices: input.inboxServices,
        requestId: input.requestId ?? undefined,
        captureId: capture.captureId,
        vault: input.vault,
        vaultServices: input.vaultServices,
        apply: true,
        modelSpec: input.modelSpec,
      })

      if (result.plan.actions.length === 0) {
        summary.noAction += 1
        input.onEvent?.({
          type: 'capture.noop',
          captureId: capture.captureId,
          details: 'model chose no canonical writes',
        })
        continue
      }

      summary.routed += 1
      input.onEvent?.({
        type: 'capture.routed',
        captureId: capture.captureId,
        tools: result.plan.actions.map((action) => action.tool),
      })
    } catch (error) {
      summary.failed += 1
      input.onEvent?.({
        type: 'capture.failed',
        captureId: capture.captureId,
        details: errorMessage(error),
      })
    }
  }

  return summary
}

async function assistantResultArtifactExists(
  vaultRoot: string,
  captureId: string,
): Promise<boolean> {
  try {
    await access(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        captureId,
        'assistant',
        'result.json',
      ),
    )
    return true
  } catch {
    return false
  }
}

function buildAssistantPrompt(input: {
  isFirstTurn: boolean
  prompt: string
  session: {
    channel: string | null
    identityId: string | null
    participantId: string | null
    sourceThreadId: string | null
  }
}): string {
  if (!input.isFirstTurn) {
    return input.prompt
  }

  const contextLines = [
    input.session.channel ? `channel: ${input.session.channel}` : null,
    input.session.identityId ? `identity: ${input.session.identityId}` : null,
    input.session.participantId
      ? `participant: ${input.session.participantId}`
      : null,
    input.session.sourceThreadId
      ? `source thread: ${input.session.sourceThreadId}`
      : null,
  ].filter((line): line is string => Boolean(line))

  return [
    'You are Healthy Bob, a local-first health assistant operating over the current working directory as a file-native health vault.',
    'Use the workspace files as the source of truth when relevant.',
    'Default to read-only analysis and conversational answers.',
    'Do not modify files unless the user explicitly asks you to propose changes.',
    'When you reference evidence from the vault, mention relative file paths when practical.',
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    `User message:\n${input.prompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

function bridgeAbortSignals(
  controller: AbortController,
  upstream?: AbortSignal,
): () => void {
  const abort = () => controller.abort()
  const onSigint = () => controller.abort()
  const onSigterm = () => controller.abort()

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  if (upstream) {
    if (upstream.aborted) {
      controller.abort()
    } else {
      upstream.addEventListener('abort', abort, { once: true })
    }
  }

  return () => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    upstream?.removeEventListener('abort', abort)
  }
}

async function waitForAbortOrTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (signal.aborted) {
    return
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, timeoutMs)

    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeScanInterval(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 5000
  }

  return Math.min(Math.max(Math.trunc(value), 250), 60000)
}

function normalizeScanLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 50
  }

  return Math.min(Math.max(Math.trunc(value), 1), 200)
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}

function summarizeAssistantTurn(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= 280) {
    return normalized
  }

  return `${normalized.slice(0, 277)}...`
}
