export interface AssistantQuiescentMaintenanceOwner {
  foregroundCompleted(): void
  foregroundStarted(): void
  start(): void
  stop(): void
}

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
      .then(async () => await input.run(nextController.signal))
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
