import { access } from 'node:fs/promises'
import path from 'node:path'
import { writeJsonFileAtomic, errorMessage } from '../shared.js'
import type { sendAssistantMessage } from '../service.js'

export async function assistantResultArtifactExists(
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
  )
}

export async function writeAssistantChatResultArtifacts(input: {
  captureIds: readonly string[]
  respondedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<void> {
  await Promise.all(
    input.captureIds.map((captureId) =>
      writeJsonFileAtomic(
        path.join(
          input.vault,
          'derived',
          'inbox',
          captureId,
          'assistant',
          'chat-result.json',
        ),
        {
          schema: 'healthybob.assistant-chat-result.v1',
          captureId,
          groupCaptureIds: [...input.captureIds],
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

  await Promise.all(
    input.captureIds.map((captureId) =>
      writeJsonFileAtomic(
        path.join(
          input.vault,
          'derived',
          'inbox',
          captureId,
          'assistant',
          'chat-error.json',
        ),
        {
          schema: 'healthybob.assistant-chat-error.v1',
          captureId,
          groupCaptureIds: [...input.captureIds],
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
    await access(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        captureId,
        'assistant',
        fileName,
      ),
    )
    return true
  } catch {
    return false
  }
}
