import { setTimeout as sleep } from 'node:timers/promises'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.js'
import { createAssistantStateWriteLock } from './state-write-lock.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const ASSISTANT_TURN_LOCK_DIRECTORY = '.locks/assistant-turn'
const ASSISTANT_TURN_LOCK_METADATA_PATH =
  `${ASSISTANT_TURN_LOCK_DIRECTORY}/owner.json`
const ASSISTANT_TURN_LOCK_RETRY_MS = 50
const ASSISTANT_TURN_LOCK_HELD_CODE = 'ASSISTANT_TURN_LOCKED'
const processTurnQueues = new Map<string, Promise<void>>()

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
  const releaseProcessQueue = await waitForProcessTurnQueue(
    paths.assistantStateRoot,
    input.abortSignal,
  )

  try {
    while (true) {
      throwIfAssistantTurnLockAborted(input.abortSignal)

      try {
        const handle = await assistantTurnLock.acquireWriteLock(paths)

        try {
          return await input.run()
        } finally {
          await handle.release()
        }
      } catch (error) {
        if (!isAssistantTurnLockHeldError(error)) {
          throw error
        }

        await waitForAssistantTurnLockAvailability(input.abortSignal)
      }
    }
  } finally {
    releaseProcessQueue()
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

function createDeferredPromise<TResult>() {
  let resolve!: (value: TResult | PromiseLike<TResult>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return {
    promise,
    reject,
    resolve,
  }
}

async function waitForProcessTurnQueue(
  assistantStateRoot: string,
  abortSignal?: AbortSignal,
): Promise<() => void> {
  const prior = processTurnQueues.get(assistantStateRoot) ?? Promise.resolve()
  const { promise: queued, resolve: releaseQueue } = createDeferredPromise<void>()
  const continueQueue = () => queued
  const tail = prior.then(continueQueue, continueQueue)
  processTurnQueues.set(assistantStateRoot, tail)

  try {
    await waitForPriorTurn(prior, abortSignal)
    return () => {
      releaseQueue()
      if (processTurnQueues.get(assistantStateRoot) === tail) {
        processTurnQueues.delete(assistantStateRoot)
      }
    }
  } catch (error) {
    releaseQueue()
    if (processTurnQueues.get(assistantStateRoot) === tail) {
      processTurnQueues.delete(assistantStateRoot)
    }
    throw error
  }
}

async function waitForPriorTurn(
  prior: Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  const ignorePriorFailure = () => undefined
  if (!abortSignal) {
    await prior.catch(ignorePriorFailure)
    return
  }

  if (abortSignal.aborted) {
    throw createAssistantTurnAbortedError()
  }

  let onAbort: (() => void) | null = null

  try {
    const abortDeferred = createDeferredPromise<never>()
    onAbort = () => {
      abortDeferred.reject(createAssistantTurnAbortedError())
    }
    abortSignal.addEventListener('abort', onAbort, {
      once: true,
    })
    await Promise.race([
      prior.catch(ignorePriorFailure),
      abortDeferred.promise,
    ])
  } finally {
    if (onAbort) {
      abortSignal.removeEventListener('abort', onAbort)
    }
  }
}
