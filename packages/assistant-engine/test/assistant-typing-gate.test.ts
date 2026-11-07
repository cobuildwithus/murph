import { afterEach, expect, it, vi } from 'vitest'
import { createAssistantChannelTypingHandle } from '../src/assistant/channel-typing.ts'
import {
  normalizeCodexEvent, extractCodexProgressEventFromNormalized,
  extractCodexTraceUpdatesFromNormalized,
} from '../src/assistant-codex-events.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
afterEach(() => vi.useRealTimers())

it.each(['final_answer', 'commentary', undefined, 'unknown'])(
  'normalizes a text-free item start with phase %s without output', (phase) => {
    const event = normalizeCodexEvent({ method: 'item/started', params: {
      item: { type: 'agentMessage', id: 'answer', phase, text: '' },
    } })
    expect(event.kind).toBe(phase === 'final_answer' ? 'final_answer_started' : 'unknown')
    expect(extractCodexProgressEventFromNormalized(event)).toBeNull()
    expect(extractCodexTraceUpdatesFromNormalized(event)).toEqual([])
    expect(event).not.toHaveProperty('text')
  },
)

it.each(['uncovered', 'error', 'timeout'])( 'fails open for %s after one bounded read', async (mode) => {
  vi.useFakeTimers()
  const start = vi.fn(async () => ({ stop: vi.fn() }))
  const readAckCoverage = vi.fn(() => mode === 'error' ? Promise.reject(new Error('offline'))
    : mode === 'timeout' ? new Promise<boolean>(() => {}) : Promise.resolve(false))
  const handle = createAssistantChannelTypingHandle({ start, readAckCoverage })
  await vi.advanceTimersByTimeAsync(499)
  expect(readAckCoverage).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(mode === 'timeout' ? 1001 : 1)
  expect(readAckCoverage).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledTimes(1)
  await handle.stop()
})

it.each(['final', 'deadline'])('releases covered typing once at %s across repeated release signals', async (mode) => {
  vi.useFakeTimers()
  const start = vi.fn(async () => ({ stop: vi.fn() }))
  const readAckCoverage = vi.fn(async () => true)
  const handle = createAssistantChannelTypingHandle({ start, readAckCoverage })
  await vi.advanceTimersByTimeAsync(29_999)
  expect(start).not.toHaveBeenCalled()
  if (mode === 'final') handle.release?.()
  else await vi.advanceTimersByTimeAsync(1)
  handle.release?.()
  handle.release?.()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(start).toHaveBeenCalledTimes(1)
  expect(readAckCoverage).toHaveBeenCalledTimes(1)
  await handle.stop()
})

it('starts immediately when the final answer precedes the coverage result', async () => {
  vi.useFakeTimers()
  const read = deferred<boolean>()
  const start = vi.fn(async () => ({ stop: vi.fn() }))
  const handle = createAssistantChannelTypingHandle({ start, readAckCoverage: () => read.promise })
  await vi.advanceTimersByTimeAsync(500)
  handle.release?.()
  await vi.advanceTimersByTimeAsync(0)
  expect(start).toHaveBeenCalledTimes(1)
  read.resolve(true)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(start).toHaveBeenCalledTimes(1)
  await handle.stop()
})

it.each([0, 500, 1500, 29_999])('closes synchronously when stopped at %d ms', async (at) => {
  vi.useFakeTimers()
  const read = deferred<boolean>()
  const start = vi.fn(async () => ({ stop: vi.fn() }))
  const handle = createAssistantChannelTypingHandle({ start, readAckCoverage: () => read.promise })
  if (at > 500) read.resolve(true)
  await vi.advanceTimersByTimeAsync(at)
  await handle.stop({ providerStop: false })
  handle.release?.()
  read.resolve(true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(start).not.toHaveBeenCalled()
  expect(await handle.ready).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('clears provider-visible late acceptance without delaying delivery completion', async () => {
  const pending = deferred<void>()
  let visible = false
  const stop = vi.fn(async () => { visible = false })
  const handle = createAssistantChannelTypingHandle({ start: async () => {
    await pending.promise
    visible = true
    return { stop }
  } })
  await Promise.resolve()
  await handle.stop({ providerStop: false })
  expect(stop).not.toHaveBeenCalled()
  pending.resolve()
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
  expect(visible).toBe(false)
  expect(stop).toHaveBeenCalledWith()
})

it('lets final cleanup await a stop that a terminal path started without waiting', async () => {
  const providerStop = deferred<void>()
  const stop = vi.fn(() => providerStop.promise)
  const handle = createAssistantChannelTypingHandle({ start: async () => ({ acceptedAt: 'now', stop }) })
  await handle.ready
  void handle.stop({ providerStop: false })
  let cleanupFinished = false
  const cleanup = handle.stop({ providerStop: false }).then(() => { cleanupFinished = true })
  await Promise.resolve()
  expect(cleanupFinished).toBe(false)
  providerStop.resolve()
  await cleanup
  expect(stop).toHaveBeenCalledTimes(1)
})

it('sends a real stop after the reply on a gated handle, even when typing was accepted first', async () => {
  vi.useFakeTimers()
  const stop = vi.fn(async () => {})
  const handle = createAssistantChannelTypingHandle({
    start: async () => ({ acceptedAt: 'now', stop }),
    readAckCoverage: async () => false,
  })
  await vi.advanceTimersByTimeAsync(500)
  await handle.ready
  await handle.stop({ providerStop: false })
  expect(stop).toHaveBeenCalledWith({ providerStop: true })
})

it('keeps the reply-cleared stop for an ungated handle', async () => {
  const stop = vi.fn(async () => {})
  const handle = createAssistantChannelTypingHandle({ start: async () => ({ acceptedAt: 'now', stop }) })
  await handle.ready
  await handle.stop({ providerStop: false })
  expect(stop).toHaveBeenCalledWith({ providerStop: false })
})

it('applies a message refresh once a pending start settles', async () => {
  const pending = deferred<{ acceptedAt: string; refreshAfterMessage(): Promise<void>; stop(): Promise<void> }>()
  const refreshAfterMessage = vi.fn(async () => {})
  const handle = createAssistantChannelTypingHandle({ start: () => pending.promise })
  await Promise.resolve()
  const refreshed = handle.refreshAfterMessage!()
  expect(refreshAfterMessage).not.toHaveBeenCalled()
  pending.resolve({ acceptedAt: 'now', refreshAfterMessage, stop: vi.fn(async () => {}) })
  await refreshed
  expect(refreshAfterMessage).toHaveBeenCalledTimes(1)
  await handle.stop()
})

it('returns from a refresh at once while the gate holds, and starts nothing', async () => {
  vi.useFakeTimers()
  const start = vi.fn(async () => ({ stop: vi.fn(async () => {}) }))
  const handle = createAssistantChannelTypingHandle({ start, readAckCoverage: async () => true })
  await vi.advanceTimersByTimeAsync(500)
  await handle.refreshAfterMessage!()
  expect(start).not.toHaveBeenCalled()
  await handle.stop()
})
