import { access, mkdir, readFile } from 'node:fs/promises'
import { writeJsonFileAtomic } from '../shared.js'
import { resolveAssistantInboxArtifactPath } from '@murphai/vault-usecases/assistant-vault-paths'
import type { sendAssistantMessage } from '../service.js'
import type { AssistantAutoReplyFailureSnapshot } from './failure-observability.js'

const ASSISTANT_AUTO_REPLY_GROUP_OUTCOME_ARTIFACT =
  'chat-group-outcome.json'

export interface AssistantAutoReplyTerminalArtifactSnapshot {
  deliveryIntentId: string | null
  groupCaptureIds: string[] | null
  outcome: 'deferred' | 'result'
  recordedAt: string
  sessionId: string
}

export async function assistantResultArtifactExists(
  vaultRoot: string,
  captureId: string,
): Promise<boolean> {
  try {
    const artifactPath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      captureId,
      'result.json',
    )
    await access(artifactPath.absolutePath)
    return true
  } catch {
    return false
  }
}

export async function assistantChatReplyArtifactExists(
  vaultRoot: string,
  captureId: string,
): Promise<boolean> {
  return (
    await assistantArtifactExists(
      vaultRoot,
      captureId,
      'chat-result.json',
    )
  ) || (
    await assistantArtifactExists(
      vaultRoot,
      captureId,
      'chat-deferred.json',
    )
  )
}

export async function assistantAutoReplyGroupOutcomeArtifactExists(
  vaultRoot: string,
  captureId: string,
): Promise<boolean> {
  return assistantArtifactExists(
    vaultRoot,
    captureId,
    ASSISTANT_AUTO_REPLY_GROUP_OUTCOME_ARTIFACT,
  )
}

export async function readAssistantAutoReplyGroupOutcomeArtifact(
  vaultRoot: string,
  captureId: string,
): Promise<AssistantAutoReplyTerminalArtifactSnapshot | null> {
  const value = await readAssistantArtifact(
    vaultRoot,
    captureId,
    ASSISTANT_AUTO_REPLY_GROUP_OUTCOME_ARTIFACT,
  )
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    deliveryIntentId?: unknown
    groupCaptureIds?: unknown
    outcome?: unknown
    recordedAt?: unknown
    schema?: unknown
    sessionId?: unknown
  }
  if (record.schema !== 'murph.assistant-auto-reply-group-outcome.v1') {
    return null
  }
  return parseAssistantAutoReplyTerminalArtifactSnapshot({
    deliveryIntentId: record.deliveryIntentId,
    groupCaptureIds: record.groupCaptureIds,
    outcome: record.outcome,
    recordedAt: record.recordedAt,
    sessionId: record.sessionId,
  })
}

export async function readAssistantChatReplyArtifact(
  vaultRoot: string,
  captureId: string,
): Promise<AssistantAutoReplyTerminalArtifactSnapshot | null> {
  const result = await readAssistantArtifact(vaultRoot, captureId, 'chat-result.json')
  const resultSnapshot = parseAssistantChatResultArtifact(result)
  if (resultSnapshot) {
    return resultSnapshot
  }

  return parseAssistantChatDeferredArtifact(
    await readAssistantArtifact(vaultRoot, captureId, 'chat-deferred.json'),
  )
}

export async function writeAssistantAutoReplyGroupOutcomeArtifact(input: {
  captureIds: readonly string[]
  outcome: 'deferred' | 'result'
  recordedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<void> {
  const [primaryCaptureId] = input.captureIds
  if (!primaryCaptureId) {
    throw new Error(
      'assistant auto-reply outcome artifacts require at least one capture id',
    )
  }

  const [artifactPath, ...groupArtifactPaths] = await Promise.all(
    input.captureIds.map((captureId, index) =>
      resolveAssistantInboxArtifactPath(
        input.vault,
        captureId,
        index === 0
          ? ASSISTANT_AUTO_REPLY_GROUP_OUTCOME_ARTIFACT
          : 'chat-result.json',
      ),
    ),
  )
  if (!artifactPath) {
    throw new Error(
      'assistant auto-reply outcome artifacts require a primary capture artifact path',
    )
  }
  const normalizedCaptureIds = [
    artifactPath.captureId,
    ...groupArtifactPaths.map((groupArtifactPath) => groupArtifactPath.captureId),
  ]

  await writeAssistantArtifactFile(artifactPath, {
    schema: 'murph.assistant-auto-reply-group-outcome.v1',
    captureId: artifactPath.captureId,
    groupCaptureIds: normalizedCaptureIds,
    sessionId: input.result.session.sessionId,
    outcome: input.outcome,
    recordedAt: input.recordedAt,
    delivery: input.result.delivery
      ? {
          channel: input.result.delivery.channel,
          target: input.result.delivery.target,
          sentAt: input.result.delivery.sentAt,
        }
      : null,
    deliveryIntentId: input.result.deliveryIntentId,
    deliveryError: input.result.deliveryError,
    response: input.result.response,
  })
}

export async function writeAssistantChatResultArtifacts(input: {
  captureIds: readonly string[]
  respondedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<void> {
  const artifactPaths = await Promise.all(
    input.captureIds.map((captureId) =>
      resolveAssistantInboxArtifactPath(
        input.vault,
        captureId,
        'chat-result.json',
      ),
    ),
  )
  const normalizedCaptureIds = artifactPaths.map((artifactPath) => artifactPath.captureId)

  await Promise.all(
    artifactPaths.map((artifactPath) =>
      writeAssistantArtifactFile(
        artifactPath,
        {
          schema: 'murph.assistant-chat-result.v1',
          captureId: artifactPath.captureId,
          groupCaptureIds: [...normalizedCaptureIds],
          sessionId: input.result.session.sessionId,
          channel: input.result.delivery?.channel ?? null,
          target: input.result.delivery?.target ?? null,
          respondedAt: input.respondedAt,
          response: input.result.response,
        },
      ),
    ),
  )
}

export async function writeAssistantChatDeferredArtifacts(input: {
  captureIds: readonly string[]
  queuedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<void> {
  const artifactPaths = await Promise.all(
    input.captureIds.map((captureId) =>
      resolveAssistantInboxArtifactPath(
        input.vault,
        captureId,
        'chat-deferred.json',
      ),
    ),
  )
  const normalizedCaptureIds = artifactPaths.map((artifactPath) => artifactPath.captureId)

  await Promise.all(
    artifactPaths.map((artifactPath) =>
      writeAssistantArtifactFile(
        artifactPath,
        {
          schema: 'murph.assistant-chat-deferred.v1',
          captureId: artifactPath.captureId,
          groupCaptureIds: [...normalizedCaptureIds],
          sessionId: input.result.session.sessionId,
          queuedAt: input.queuedAt,
          response: input.result.response,
          deliveryIntentId: input.result.deliveryIntentId,
          deliveryError: input.result.deliveryError,
        },
      ),
    ),
  )
}

export async function writeAssistantChatErrorArtifacts(input: {
  captureIds: readonly string[]
  failure: AssistantAutoReplyFailureSnapshot
  vault: string
}): Promise<void> {
  const artifactPaths = await Promise.all(
    input.captureIds.map((captureId) =>
      resolveAssistantInboxArtifactPath(
        input.vault,
        captureId,
        'chat-error.json',
      ),
    ),
  )
  const normalizedCaptureIds = artifactPaths.map((artifactPath) => artifactPath.captureId)

  await Promise.all(
    artifactPaths.map((artifactPath) =>
      writeAssistantArtifactFile(
        artifactPath,
        {
          schema: 'murph.assistant-chat-error.v1',
          captureId: artifactPath.captureId,
          groupCaptureIds: [...normalizedCaptureIds],
          code: input.failure.code,
          context: input.failure.context,
          failedAt: new Date().toISOString(),
          kind: input.failure.kind,
          message: input.failure.message,
          retryable: input.failure.retryable,
          safeSummary: input.failure.safeSummary,
        },
      ),
    ),
  )
}

async function assistantArtifactExists(
  vaultRoot: string,
  captureId: string,
  fileName: string,
): Promise<boolean> {
  try {
    const artifactPath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      captureId,
      fileName,
    )
    await access(artifactPath.absolutePath)
    return true
  } catch {
    return false
  }
}

async function readAssistantArtifact(
  vaultRoot: string,
  captureId: string,
  fileName: string,
): Promise<unknown | null> {
  try {
    const artifactPath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      captureId,
      fileName,
    )
    return JSON.parse(await readFile(artifactPath.absolutePath, 'utf8'))
  } catch {
    return null
  }
}

async function writeAssistantArtifactFile(
  artifactPath: Awaited<ReturnType<typeof resolveAssistantInboxArtifactPath>>,
  value: unknown,
): Promise<void> {
  await mkdir(artifactPath.absoluteDirectory, { recursive: true })
  await writeJsonFileAtomic(artifactPath.absolutePath, value)
}

function parseAssistantChatResultArtifact(
  value: unknown,
): AssistantAutoReplyTerminalArtifactSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    groupCaptureIds?: unknown
    respondedAt?: unknown
    schema?: unknown
    sessionId?: unknown
  }
  if (record.schema !== 'murph.assistant-chat-result.v1') {
    return null
  }
  return parseAssistantAutoReplyTerminalArtifactSnapshot({
    deliveryIntentId: null,
    groupCaptureIds: record.groupCaptureIds,
    outcome: 'result',
    recordedAt: record.respondedAt,
    sessionId: record.sessionId,
  })
}

function parseAssistantChatDeferredArtifact(
  value: unknown,
): AssistantAutoReplyTerminalArtifactSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    deliveryIntentId?: unknown
    groupCaptureIds?: unknown
    queuedAt?: unknown
    schema?: unknown
    sessionId?: unknown
  }
  if (record.schema !== 'murph.assistant-chat-deferred.v1') {
    return null
  }
  return parseAssistantAutoReplyTerminalArtifactSnapshot({
    deliveryIntentId: record.deliveryIntentId,
    groupCaptureIds: record.groupCaptureIds,
    outcome: 'deferred',
    recordedAt: record.queuedAt,
    sessionId: record.sessionId,
  })
}

function parseAssistantAutoReplyTerminalArtifactSnapshot(input: {
  deliveryIntentId: unknown
  groupCaptureIds: unknown
  outcome: unknown
  recordedAt: unknown
  sessionId: unknown
}): AssistantAutoReplyTerminalArtifactSnapshot | null {
  if (
    input.outcome !== 'deferred' &&
    input.outcome !== 'result'
  ) {
    return null
  }
  if (
    typeof input.recordedAt !== 'string' ||
    input.recordedAt.trim().length === 0 ||
    typeof input.sessionId !== 'string' ||
    input.sessionId.trim().length === 0
  ) {
    return null
  }

  return {
    deliveryIntentId:
      typeof input.deliveryIntentId === 'string' && input.deliveryIntentId.trim().length > 0
        ? input.deliveryIntentId
        : null,
    groupCaptureIds: Array.isArray(input.groupCaptureIds)
      ? input.groupCaptureIds
          .map((item) => typeof item === 'string' ? item.trim() : '')
          .filter((item) => item.length > 0)
      : null,
    outcome: input.outcome,
    recordedAt: input.recordedAt,
    sessionId: input.sessionId,
  }
}
