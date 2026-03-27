import { setTimeout as sleep } from 'node:timers/promises'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store.js'
import { createAssistantStateWriteLock } from './state-write-lock.js'
import { VaultCliError } from '../vault-cli-errors.js'

const ASSISTANT_TURN_LOCK_DIRECTORY = '.locks/assistant-turn'
const ASSISTANT_TURN_LOCK_METADATA_PATH =
  `${ASSISTANT_TURN_LOCK_DIRECTORY}/owner.json`
const ASSISTANT_TURN_LOCK_RETRY_MS = 50
const ASSISTANT_TURN_LOCK_HELD_CODE = 'ASSISTANT_TURN_LOCKED'

const assistantTurnLock = createAssistantStateWriteLock<AssistantStatePaths>({
  ownerKeyPrefix: 'assistant-turn',
  lockDirectory: ASSISTANT_TURN_LOCK_DIRECTORY,
  lockMetadataPath: ASSISTANT_TURN_LOCK_METADATA_PATH,
  invalidMetadataReason: 'Assistant turn lock metadata is malformed.',
  heldLockErrorCode: ASSISTANT_TURN_LOCK_HELD_CODE,
  formatHeldLockMessage(owner) {
    return owner
      ? `Assistant turn is already in progress for this vault (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
      : 'Assistant turn is already in progress for this vault.'
  },
})

export async function withAssistantTurnLock<TResult>(input: {
  abortSignal?: AbortSignal
  run: () => Promise<TResult>
  vault: string
}): Promise<TResult> {
  const paths = resolveAssistantStatePaths(input.vault)

  while (true) {
    throwIfAssistantTurnLockAborted(input.abortSignal)

    try {
      return await assistantTurnLock.withWriteLock(paths, input.run)
    } catch (error) {
      if (!isAssistantTurnLockHeldError(error)) {
        throw error
      }

      await waitForAssistantTurnLockAvailability(input.abortSignal)
    }
  }
}

async function waitForAssistantTurnLockAvailability(
  abortSignal?: AbortSignal,
): Promise<void> {
  try {
    await sleep(
      ASSISTANT_TURN_LOCK_RETRY_MS,
      undefined,
      abortSignal ? { signal: abortSignal } : undefined,
    )
  } catch (error) {
    if (isAbortError(error)) {
      throw createAssistantTurnAbortedError()
    }

    throw error
  }
}

function throwIfAssistantTurnLockAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAssistantTurnAbortedError()
  }
}

function createAssistantTurnAbortedError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_TURN_ABORTED',
    'Assistant turn was aborted while waiting for the vault turn lock.',
  )
}

function isAssistantTurnLockHeldError(error: unknown): error is VaultCliError {
  return error instanceof VaultCliError && error.code === ASSISTANT_TURN_LOCK_HELD_CODE
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
