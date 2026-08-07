import { setTimeout as waitForTimeout } from 'node:timers/promises'

export interface AssistantQuiescentMaintenanceOwner {
  foregroundCompleted(): void
  foregroundStarted(): void
  start(): void
  stop(): void
}

const ASSISTANT_RUNTIME_WRITE_LOCK_RETRY_DELAY_MS = 250

export function createAssistantQuiescentMaintenanceOwner(input: {
  run(signal: AbortSignal): Promise<void>
}): AssistantQuiescentMaintenanceOwner {
  let activeForegroundRequests = 0
  let controller: AbortController | null = null
  let currentRun: Promise<void> | null = null
  let restartRequested = false
  let stopped = false

  const start = () => {
    if (stopped || activeForegroundRequests > 0) {
      return
    }
    if (currentRun) {
      return
    }

    const nextController = new AbortController()
    controller = nextController
    const run = Promise.resolve()
      .then(async () => {
        while (true) {
          try {
            await input.run(nextController.signal)
            return
          } catch (error) {
            nextController.signal.throwIfAborted()
            if (!isAssistantRuntimeWriteLockedError(error)) {
              throw error
            }
            await waitForTimeout(
              ASSISTANT_RUNTIME_WRITE_LOCK_RETRY_DELAY_MS,
              undefined,
              { signal: nextController.signal },
            )
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (currentRun !== run) {
          return
        }
        currentRun = null
        if (controller === nextController) {
          controller = null
        }
        const shouldRestart =
          restartRequested && !stopped && activeForegroundRequests === 0
        restartRequested = false
        if (shouldRestart) {
          start()
        }
      })
    currentRun = run
  }

  return {
    foregroundCompleted() {
      if (activeForegroundRequests === 0) {
        return
      }
      activeForegroundRequests -= 1
      if (activeForegroundRequests > 0) {
        return
      }
      if (currentRun) {
        restartRequested = true
        return
      }
      start()
    },
    foregroundStarted() {
      activeForegroundRequests += 1
      controller?.abort(new DOMException(
        'Assistant foreground work preempted quiescent maintenance.',
        'AbortError',
      ))
    },
    start,
    stop() {
      stopped = true
      restartRequested = false
      controller?.abort(new DOMException(
        'Assistant daemon stopped quiescent maintenance.',
        'AbortError',
      ))
    },
  }
}

function isAssistantRuntimeWriteLockedError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ASSISTANT_RUNTIME_WRITE_LOCKED'
}
