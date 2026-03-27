import { access, mkdir } from 'node:fs/promises'
import { writeJsonFileAtomic, errorMessage } from '../shared.js'
import { resolveAssistantInboxArtifactPath } from '../../assistant-vault-paths.js'
import type { sendAssistantMessage } from '../service.js'

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
      'chat-error.json',
    )
  ) || (
    await assistantArtifactExists(
      vaultRoot,
      captureId,
      'chat-deferred.json',
    )
  )
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
  error: unknown
  vault: string
}): Promise<void> {
  const message = errorMessage(input.error)
  const code =
    typeof input.error === 'object' &&
    input.error !== null &&
    'code' in input.error &&
    typeof (input.error as { code?: unknown }).code === 'string'
      ? (input.error as { code: string }).code
      : null

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
          code,
          failedAt: new Date().toISOString(),
          message,
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

async function writeAssistantArtifactFile(
  artifactPath: Awaited<ReturnType<typeof resolveAssistantInboxArtifactPath>>,
  value: unknown,
): Promise<void> {
  await mkdir(artifactPath.absoluteDirectory, { recursive: true })
  await writeJsonFileAtomic(artifactPath.absolutePath, value)
}
