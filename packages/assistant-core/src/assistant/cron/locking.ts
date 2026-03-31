import {
  createAssistantStateWriteLock,
} from '../state-write-lock.js'
import type { AssistantStatePaths } from '@murph/runtime-state'

const ASSISTANT_CRON_LOCK_DIRECTORY = '.locks/assistant-cron-write'
const ASSISTANT_CRON_LOCK_METADATA_PATH = `${ASSISTANT_CRON_LOCK_DIRECTORY}/owner.json`

const assistantCronWriteLock = createAssistantStateWriteLock<AssistantStatePaths>({
  ownerKeyPrefix: 'assistant-cron',
  lockDirectory: ASSISTANT_CRON_LOCK_DIRECTORY,
  lockMetadataPath: ASSISTANT_CRON_LOCK_METADATA_PATH,
  invalidMetadataReason: 'Assistant cron write lock metadata is malformed.',
  heldLockErrorCode: 'ASSISTANT_CRON_LOCKED',
  formatHeldLockMessage(owner) {
    return owner
      ? `Assistant cron writes are already in progress (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
      : 'Assistant cron writes are already in progress.'
  },
})

export async function withAssistantCronWriteLock<TResult>(
  paths: AssistantStatePaths,
  run: () => Promise<TResult>,
): Promise<TResult> {
  return assistantCronWriteLock.withWriteLock(paths, run)
}
