import type { AssistantChannelActivityHandle } from './types.js'

const ASSISTANT_TYPING_STOP_WAIT_MS = 2_000
// Lets a warm turn's tapback confirm first. This delays the default bubble, so keep it short.
const ASSISTANT_TYPING_ACK_GRACE_MS = 500
const ASSISTANT_TYPING_ACK_LOOKUP_MS = 1_000
const ASSISTANT_TYPING_ACK_FALLBACK_MS = 30_000

/** One lifecycle for immediate or tapback-covered typing, including preparation handoff. */
export function createAssistantChannelTypingHandle(input: {
  start: () => Promise<AssistantChannelActivityHandle | null | void>
  readAckCoverage?: (signal: AbortSignal) => Promise<boolean>
  onStoppedBeforeStart?: () => void
}): AssistantChannelActivityHandle & { ready: Promise<string | null>; isActive(): boolean } {
  let activeIndicator: AssistantChannelActivityHandle | null = null
  let acceptedAt: string | null = null
  let stopRequested = false
  let stopping: Promise<void> | undefined
  let released = false
  let started = false
  let startSettled: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lookup: AbortController | undefined
  let settle!: (at: string | null) => void
  const ready = new Promise<string | null>((resolve) => { settle = resolve })
  const requestedAt = Date.now()
  const clearWait = () => {
    clearTimeout(timer)
    lookup?.abort()
  }
  const start = () => {
    if (stopRequested || started) return
    started = true
    clearWait()
    const starting = Promise.resolve().then(input.start).then((indicator) => {
      activeIndicator = indicator ?? null
      return indicator
    })
    startSettled = starting.then(() => undefined, () => undefined)
    void starting.then(async (indicator) => {
      if (!indicator) { settle(null); return }
      if (stopRequested) {
        // A provider acceptance after delivery needs a real stop. The hosted
        // handle checks the current chat claim before touching the provider.
        void runAssistantTypingBestEffort(() => indicator.stop(), {
          timeoutMs: ASSISTANT_TYPING_STOP_WAIT_MS,
        })
        settle(null)
        return
      }
      if (released) indicator.release?.()
      const at = indicator.ready ? await indicator.ready : indicator.acceptedAt ?? new Date().toISOString()
      acceptedAt = at
      settle(stopRequested ? null : at)
    }).catch(() => settle(null))
  }
  // A message can clear the bubble while the start is in flight, so a pending
  // start still gets its refresh. A held gate has no bubble to refresh.
  const refresh = async (afterMessage: boolean) => {
    if (stopRequested || !startSettled) return
    await startSettled
    const indicator = activeIndicator
    if (stopRequested || !indicator) return
    const run = afterMessage ? indicator.refreshAfterMessage ?? indicator.refreshNow : indicator.refreshNow
    if (run) await runAssistantTypingBestEffort(() => run.call(indicator))
  }
  if (input.readAckCoverage) {
    // Receipt time is not present at this seam. Both waits share the first
    // typing request, including attachment preparation and provider retries.
    timer = setTimeout(() => {
      if (stopRequested || started) return
      lookup = new AbortController()
      timer = setTimeout(start, ASSISTANT_TYPING_ACK_LOOKUP_MS)
      void Promise.resolve().then(() => input.readAckCoverage!(lookup!.signal)).then((covered) => {
        if (stopRequested || started) return
        clearWait()
        if (covered !== true) start()
        else timer = setTimeout(start, Math.max(0, requestedAt + ASSISTANT_TYPING_ACK_FALLBACK_MS - Date.now()))
      }).catch(start)
    }, ASSISTANT_TYPING_ACK_GRACE_MS)
  } else start()

  return {
    ready,
    get acceptedAt() { return acceptedAt ?? undefined },
    isActive: () => !stopRequested && acceptedAt !== null && activeIndicator?.isActive?.() !== false,
    release() {
      released = true
      start()
      activeIndicator?.release?.()
    },
    refreshAfterMessage: () => refresh(true),
    refreshNow: () => refresh(false),
    // Terminal paths close early without waiting, so the turn's final cleanup
    // must still be able to await the same stop.
    stop(options = {}) {
      return stopping ??= (async () => {
        stopRequested = true
        if (!started) input.onStoppedBeforeStart?.()
        clearWait()
        settle(null)
        if (activeIndicator) {
          const indicator = activeIndicator
          // A deferred start can overlap the reply, so the reply may not have
          // cleared it. The hosted handle checks the chat claim before stopping.
          const replyClearedTyping = acceptedAt && !input.readAckCoverage
          await runAssistantTypingBestEffort(() => indicator.stop(
            replyClearedTyping ? options : { ...options, providerStop: true },
          ), { timeoutMs: ASSISTANT_TYPING_STOP_WAIT_MS })
        }
      })()
    },
  }
}

async function runAssistantTypingBestEffort(
  task: () => Promise<unknown>,
  options: {
    timeoutMs?: number
  } = {},
): Promise<void> {
  try {
    const taskPromise = task()
    if (options.timeoutMs) {
      await withAssistantTypingTimeout(taskPromise, options.timeoutMs)
      return
    }

    await taskPromise
  } catch {}
}

async function withAssistantTypingTimeout(
  taskPromise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<void>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('ASSISTANT_TYPING_STOP_TIMEOUT'))
    }, timeoutMs)
    if (typeof timeout.unref === 'function') {
      timeout.unref()
    }
  })
  taskPromise.catch(() => {})

  try {
    await Promise.race([taskPromise, timeoutPromise])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}
