import { describe, expect, it, vi } from 'vitest'
import { CodexRealtimeBinding } from '../src/assistant-codex/realtime.ts'

function fixture(managed = true, signal?: AbortSignal) {
  const onInput = vi.fn()
  const onUsage = vi.fn()
  const request = vi.fn(async (method: string, _params: Record<string, unknown>): Promise<unknown> => {
    if (method === 'thread/realtime/start') return managed ? { clientManagedInputs: true } : {}
    return {}
  })
  const binding = new CodexRealtimeBinding('media-thread', {
    sessionId: 'active-call', sdp: 'offer', prompt: 'Synthetic voice instructions', onInput, onUsage, signal,
  }, request)
  const notify = (method: string, fields: Record<string, unknown> = {}, threadId = 'media-thread') =>
    binding.handle({ method: `thread/realtime/${method}`, params: { threadId, ...fields } })
  const item = (value: Record<string, unknown>) => notify('itemAdded', { item: value })
  const input = { type: 'input.requested', realtimeSessionId: 'active-call', inputId: 'input-1', text: 'Synthetic request' }
  const receipt = { type: 'session.closed', session: { id: 'provider-call' }, reason: 'close_requested', usage: { seconds: 12 } }
  return { binding, request, notify, item, input, receipt, onInput, onUsage }
}

describe('native voice notification binding', () => {
  it('does not create a provider session for an already-canceled runtime', async () => {
    const controller = new AbortController()
    controller.abort()
    const f = fixture(true, controller.signal)
    await expect(f.binding.start()).rejects.toThrow('canceled before startup')
    expect((await f.binding.close()).providerConfirmed).toBe(false)
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(['thread/unsubscribe'])
  })

  it('closes an in-flight start when the runtime is canceled before SDP', async () => {
    const controller = new AbortController()
    const f = fixture(true, controller.signal)
    const started = f.binding.start()
    const rejected = expect(started).rejects.toThrow('closed before its connection answer')
    controller.abort()
    f.item(f.input)
    f.item(f.receipt)
    f.notify('closed')
    await rejected
    expect(f.onInput).not.toHaveBeenCalled()
    expect((await f.binding.close()).providerConfirmed).toBe(true)
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      'thread/realtime/start', 'thread/realtime/stop', 'thread/unsubscribe',
    ])
  })

  it('requires explicit managed-input confirmation before returning browser SDP', async () => {
    const f = fixture(false)
    f.notify('sdp', { sdp: 'answer' })
    await expect(f.binding.start()).rejects.toThrow('patched host-managed input protocol')
    f.binding.processClosed()
    expect(await f.binding.close()).toEqual({ providerConfirmed: false, providerSessionId: null, seconds: null })
  })

  it('fences stale and closing input while preserving trusted usage and a single shutdown', async () => {
    const f = fixture()
    f.notify('sdp', { sdp: 'answer' })
    const session = await f.binding.start()
    expect(f.notify('itemAdded', { item: f.input }, 'other-thread')).toBe(false)
    f.item({ ...f.input, realtimeSessionId: 'old-call' })
    expect(f.onInput).not.toHaveBeenCalled()
    f.item(f.input)
    expect(f.onInput).toHaveBeenCalledExactlyOnceWith({ inputId: 'input-1', text: 'Synthetic request' })
    f.item({ type: 'session.usage.updated', usage: { seconds: 6 } })
    const stopped = session.close()
    expect(session.close()).toBe(stopped)
    f.item({ ...f.input, inputId: 'late-input' })
    f.item(f.receipt)
    f.notify('closed')
    expect(await stopped).toEqual({ providerConfirmed: true, providerSessionId: 'provider-call', seconds: 12 })
    expect(f.onUsage.mock.calls).toEqual([[6], [12]])
    expect(f.onInput).toHaveBeenCalledTimes(1)
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      'thread/realtime/start', 'thread/realtime/stop', 'thread/unsubscribe',
    ])
    await expect(session.speak('Late answer')).rejects.toThrow('closed')
  })

  it.each(['closed', 'process loss'] as const)('does not invent a final provider receipt after %s', async (end) => {
    const f = fixture()
    f.notify('sdp', { sdp: 'answer' })
    const session = await f.binding.start()
    f.item({ type: 'session.usage.updated', usage: { seconds: 6 } })
    if (end === 'closed') f.notify('closed')
    else f.binding.processClosed()
    expect(await session.closed).toEqual({ providerConfirmed: false, providerSessionId: null, seconds: null })
    await session.close()
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(['thread/realtime/start', 'thread/unsubscribe'])
  })
})
