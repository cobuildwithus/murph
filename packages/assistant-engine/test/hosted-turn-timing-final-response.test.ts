import { describe, expect, it } from 'vitest'

import {
  buildHostedAssistantFinalResponseCompletionTiming,
} from '../src/assistant/hosted-turn-timing.ts'

const resultAt = Date.parse('2026-01-10T12:00:00.000Z')

describe('hosted final response completion timing', () => {
  it('pairs the exact provider-result epoch with a monotonic completion interval', () => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: { kind: 'observed', observedAtMonotonicMs: 1_000.2 },
      finalReplySelected: true,
      providerResultAtEpochMs: resultAt,
      providerResultAtMonotonicMs: 1_250.7,
    })).toEqual({
      finalResponseCompletedToProviderResultMs: 251,
      finalResponseCompletion: 'observed',
      providerResultAtEpochMs: resultAt,
    })
  })

  it('accepts an exactly simultaneous completion as zero', () => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: { kind: 'observed', observedAtMonotonicMs: 50 },
      finalReplySelected: true,
      providerResultAtEpochMs: resultAt,
      providerResultAtMonotonicMs: 50,
    })).toMatchObject({ finalResponseCompletedToProviderResultMs: 0 })
  })

  it.each([
    ['a small negative interval that would round to zero', 1_000.4, 1_000],
    ['a negative interval', 2_000, 1_000],
    ['a non-finite observation', Number.NaN, 1_000],
    ['an infinite observation', Number.NEGATIVE_INFINITY, 1_000],
  ])('marks %s invalid instead of zero', (_label, observedAt, resultAtMonotonic) => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: { kind: 'observed', observedAtMonotonicMs: observedAt },
      finalReplySelected: true,
      providerResultAtEpochMs: resultAt,
      providerResultAtMonotonicMs: resultAtMonotonic,
    })).toEqual({ finalResponseCompletion: 'invalid', providerResultAtEpochMs: resultAt })
  })

  it('marks a missing provider-result monotonic reading invalid', () => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: { kind: 'observed', observedAtMonotonicMs: 10 },
      finalReplySelected: true,
      providerResultAtEpochMs: resultAt,
      providerResultAtMonotonicMs: null,
    })).toEqual({ finalResponseCompletion: 'invalid', providerResultAtEpochMs: resultAt })
  })

  it.each(['superseded', 'unavailable'] as const)(
    'passes %s through without an interval or fallback origin',
    (kind) => {
      expect(buildHostedAssistantFinalResponseCompletionTiming({
        completion: { kind },
        finalReplySelected: true,
        providerResultAtEpochMs: resultAt,
        providerResultAtMonotonicMs: 10,
      })).toEqual({ finalResponseCompletion: kind, providerResultAtEpochMs: resultAt })
    },
  )

  it('emits only the anchor when the provider reports no observation', () => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: undefined,
      finalReplySelected: true,
      providerResultAtEpochMs: resultAt,
      providerResultAtMonotonicMs: 10,
    })).toEqual({ providerResultAtEpochMs: resultAt })
  })

  it('emits nothing when no final reply was selected', () => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: { kind: 'observed', observedAtMonotonicMs: 1 },
      finalReplySelected: false,
      providerResultAtEpochMs: resultAt,
      providerResultAtMonotonicMs: 2,
    })).toEqual({})
  })

  it.each([null, -1, 1.5, Number.NaN])('emits nothing for an invalid anchor %s', (anchor) => {
    expect(buildHostedAssistantFinalResponseCompletionTiming({
      completion: { kind: 'observed', observedAtMonotonicMs: 1 },
      finalReplySelected: true,
      providerResultAtEpochMs: anchor,
      providerResultAtMonotonicMs: 2,
    })).toEqual({})
  })
})
