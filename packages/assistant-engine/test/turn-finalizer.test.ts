import { describe, expect, it } from 'vitest'

import { resolveAssistantResumeStateFromProviderTurn } from '../src/assistant/turn-finalizer.js'

describe('resolveAssistantResumeStateFromProviderTurn', () => {
  it('records the route that produced the resumable provider session', () => {
    const codexThreadId = '00000000-0000-4000-8000-000000000123'
    const codexRolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${codexThreadId}.jsonl`
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        codexRolloutRelativePath,
        codexThreadId,
        routeFingerprint: 'route-new',
      }),
    ).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-new',
      threadId: codexThreadId,
    })
  })

  it('drops non-resumable turns instead of persisting route-only state', () => {
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        codexThreadId: null,
        routeFingerprint: 'route-new',
      }),
    ).toBeNull()
  })
})
