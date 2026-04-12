import { describe, expect, it } from 'vitest'

import { resolveAssistantResumeStateFromProviderTurn } from '../src/assistant/turn-finalizer.js'

describe('resolveAssistantResumeStateFromProviderTurn', () => {
  it('records the route that produced the resumable provider session', () => {
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        providerSessionId: 'provider-session-123',
        routeId: 'route-new',
      }),
    ).toEqual({
      providerSessionId: 'provider-session-123',
      resumeRouteId: 'route-new',
    })
  })

  it('drops non-resumable turns instead of persisting route-only state', () => {
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        providerSessionId: null,
        routeId: 'route-new',
      }),
    ).toBeNull()
  })
})
