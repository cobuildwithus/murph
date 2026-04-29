import { access, mkdir } from 'node:fs/promises'
import { writeJsonFileAtomic } from '../shared.js'
import { resolveAssistantInboxArtifactPath } from '@murphai/vault-usecases/assistant-vault-paths'
import type { AssistantAutoReplyFailureSnapshot } from './failure-observability.js'

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

async function writeAssistantArtifactFile(
  artifactPath: Awaited<ReturnType<typeof resolveAssistantInboxArtifactPath>>,
  value: unknown,
): Promise<void> {
  await mkdir(artifactPath.absoluteDirectory, { recursive: true })
  await writeJsonFileAtomic(artifactPath.absolutePath, value)
}
