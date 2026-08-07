import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'
import {
  createAssistantStateWriteLock,
  type AssistantStateWriteLockMetadata,
} from './assistant-state-write-lock.js'

const assistantRuntimeWriteLock = createAssistantStateWriteLock<AssistantStatePaths>({
  ownerKeyPrefix: 'assistant-runtime-write',
  lockDirectory: '.runtime-write.lock',
  lockMetadataPath: '.runtime-write.lock/owner.json',
  invalidMetadataReason: 'Assistant runtime write-lock metadata is malformed.',
  heldLockErrorCode: 'ASSISTANT_RUNTIME_WRITE_LOCKED',
  formatHeldLockMessage(metadata: AssistantStateWriteLockMetadata | null) {
    const detail = metadata
      ? `${metadata.command} (pid ${metadata.pid}) started ${metadata.startedAt}`
      : 'another assistant runtime writer'
    return `Assistant runtime state is already being updated for this vault: ${detail}.`
  },
})

export async function withAssistantRuntimeWriteLock<TResult>(
  vault: string,
  run: (paths: AssistantStatePaths) => Promise<TResult>,
  signal?: AbortSignal | null,
): Promise<TResult> {
  const paths = resolveAssistantStatePaths(vault)
  return assistantRuntimeWriteLock.withWriteLock(paths, () => run(paths), signal)
}

export async function inspectAssistantRuntimeWriteLock(vault: string) {
  const paths = resolveAssistantStatePaths(vault)
  return await assistantRuntimeWriteLock.inspectWriteLock(paths)
}

export async function clearAssistantRuntimeWriteLock(
  vault: string,
): Promise<void> {
  const paths = resolveAssistantStatePaths(vault)
  await assistantRuntimeWriteLock.clearWriteLock(paths)
}
