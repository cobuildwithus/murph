import { describe, expect, it } from 'vitest'

import { resolveAssistantResumeStateFromProviderTurn } from '../src/assistant/turn-finalizer.js'

describe('resolveAssistantResumeStateFromProviderTurn', () => {
  it('records the route that produced the resumable provider session', () => {
    const providerSessionId = '00000000-0000-4000-8000-000000000123'
    const codexRolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${providerSessionId}.jsonl`
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        codexRolloutRelativePath,
        providerSessionId,
        routeFingerprint: 'route-new',
      }),
    ).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-new',
      threadId: providerSessionId,
    })
  })

  it('drops non-resumable turns instead of persisting route-only state', () => {
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        providerSessionId: null,
        routeFingerprint: 'route-new',
      }),
    ).toBeNull()
  })
})
