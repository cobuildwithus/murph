import { describe, expect, it } from 'vitest'

import { parseAssistantSessionRecord } from '../src/assistant-cli-contracts.js'

function createPersistedSessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'murph.assistant-session.v1',
    sessionId: 'session_123',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    resumeState: null,
    alias: null,
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-04-12T00:00:00.000Z',
    updatedAt: '2026-04-12T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
    ...overrides,
  }
}

describe('assistant session resume state normalization', () => {
  it('drops route-only persisted resume state', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          providerSessionId: null,
          resumeRouteId: 'route-new',
        },
      }),
    )

    expect(session.resumeState).toBeNull()
    expect(session.providerBinding).toBeNull()
  })

  it('retains complete resumable state', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          providerSessionId: 'provider-session-123',
          resumeRouteId: 'route-new',
        },
      }),
    )

    expect(session.resumeState).toEqual({
      providerSessionId: 'provider-session-123',
      resumeRouteId: 'route-new',
    })
    expect(session.providerBinding).toMatchObject({
      provider: 'codex-cli',
      providerSessionId: 'provider-session-123',
      providerState: {
        resumeRouteId: 'route-new',
      },
    })
  })
})
