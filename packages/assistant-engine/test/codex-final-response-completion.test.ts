import { describe, expect, it } from 'vitest'

import {
  createCodexFinalResponseCompletionTracker,
} from '../src/assistant-codex/final-response-completion.ts'

function createClockedTracker() {
  let now = 0
  const tracker = createCodexFinalResponseCompletionTracker(() => now)
  return {
    complete(at: number, messageTurnId: string | null = 'turn-active') {
      now = at
      tracker.observeRawNotification({
        activeTurnId: 'turn-active',
        messageTurnId,
        method: 'rawResponse/completed',
      })
    },
    tracker,
  }
}

describe('Codex final response completion tracker', () => {
  it('keeps the latest turn-scoped completion instant across samplings', () => {
    const { complete, tracker } = createClockedTracker()
    complete(100)
    tracker.observeProviderActivity()
    complete(250)

    expect(tracker.read({ selectedFromEarlierSampling: false })).toEqual({
      kind: 'observed',
      observedAtMonotonicMs: 250,
    })
  })

  it('ignores another turn, a missing turn id, and raw item notifications', () => {
    const { complete, tracker } = createClockedTracker()
    complete(100)
    complete(900, 'turn-foreign')
    complete(950, null)
    tracker.observeRawNotification({
      activeTurnId: 'turn-active',
      messageTurnId: 'turn-active',
      method: 'rawResponseItem/completed',
    })

    expect(tracker.read({ selectedFromEarlierSampling: false })).toEqual({
      kind: 'observed',
      observedAtMonotonicMs: 100,
    })
  })

  it('stays superseded after later activity until a newer completion arrives', () => {
    const { complete, tracker } = createClockedTracker()
    complete(100)
    tracker.observeProviderActivity()
    expect(tracker.read({ selectedFromEarlierSampling: false })).toEqual({ kind: 'superseded' })

    complete(300)
    expect(tracker.read({ selectedFromEarlierSampling: false })).toEqual({
      kind: 'observed',
      observedAtMonotonicMs: 300,
    })
  })

  it('reports unavailable without a completion, even after activity', () => {
    const { tracker } = createClockedTracker()
    tracker.observeProviderActivity()
    expect(tracker.read({ selectedFromEarlierSampling: false })).toEqual({ kind: 'unavailable' })
  })

  it('never attributes the latest completion to a retained earlier answer', () => {
    const { complete, tracker } = createClockedTracker()
    complete(100)
    expect(tracker.read({ selectedFromEarlierSampling: true })).toEqual({ kind: 'superseded' })
  })
})
