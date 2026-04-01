import {
  createAssistantStateWriteLock,
} from '../state-write-lock.js'
import type { AssistantStatePaths } from '@murph/runtime-state/node'

const ASSISTANT_STATE_DOC_LOCK_DIRECTORY = '.locks/assistant-state-doc-write'
const ASSISTANT_STATE_DOC_LOCK_METADATA_PATH =
  `${ASSISTANT_STATE_DOC_LOCK_DIRECTORY}/owner.json`

const assistantStateDocumentWriteLock = createAssistantStateWriteLock<AssistantStatePaths>({
  ownerKeyPrefix: 'assistant-state-doc',
  lockDirectory: ASSISTANT_STATE_DOC_LOCK_DIRECTORY,
  lockMetadataPath: ASSISTANT_STATE_DOC_LOCK_METADATA_PATH,
  invalidMetadataReason: 'Assistant state document write lock metadata is malformed.',
  heldLockErrorCode: 'ASSISTANT_STATE_WRITE_LOCKED',
  formatHeldLockMessage(owner) {
    return owner
      ? `Assistant state document writes are already in progress (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
      : 'Assistant state document writes are already in progress.'
  },
})

export async function withAssistantStateDocumentWriteLock<TResult>(
  paths: AssistantStatePaths,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return assistantStateDocumentWriteLock.withWriteLock(paths, run)
}
