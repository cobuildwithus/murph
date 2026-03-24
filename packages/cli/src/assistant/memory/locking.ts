import {
  createAssistantStateWriteLock,
  type AssistantStateWriteLockMetadata,
} from '../state-write-lock.js'
import type { AssistantMemoryPaths } from './paths.js'

const ASSISTANT_MEMORY_LOCK_DIRECTORY = '.locks/assistant-memory-write'
const ASSISTANT_MEMORY_LOCK_METADATA_PATH = `${ASSISTANT_MEMORY_LOCK_DIRECTORY}/owner.json`

type AssistantMemoryWriteLockMetadata = AssistantStateWriteLockMetadata

const assistantMemoryWriteLock = createAssistantStateWriteLock<AssistantMemoryPaths>({
  ownerKeyPrefix: 'assistant-memory',
  lockDirectory: ASSISTANT_MEMORY_LOCK_DIRECTORY,
  lockMetadataPath: ASSISTANT_MEMORY_LOCK_METADATA_PATH,
  invalidMetadataReason: 'Assistant memory write lock metadata is malformed.',
  heldLockErrorCode: 'ASSISTANT_MEMORY_WRITE_LOCKED',
  formatHeldLockMessage(owner) {
    return owner
      ? `Assistant memory writes are already in progress (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
      : 'Assistant memory writes are already in progress.'
  },
})

export async function withAssistantMemoryWriteLock<TResult>(
  paths: AssistantMemoryPaths,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return assistantMemoryWriteLock.withWriteLock(paths, run)
}

async function acquireAssistantMemoryWriteLock(paths: AssistantMemoryPaths): Promise<{
  release(): Promise<void>
}> {
  return assistantMemoryWriteLock.acquireWriteLock(paths)
}

function isAssistantMemoryWriteLockMetadata(
  value: unknown,
): value is AssistantMemoryWriteLockMetadata {
  return assistantMemoryWriteLock.isWriteLockMetadata(value)
}
