import { describe, expect, it } from 'vitest'

import { parseAssistantSessionRecord } from '../src/assistant-cli-contracts.js'

const providerSessionId = '00000000-0000-4000-8000-000000000123'
const codexRolloutRelativePath =
  `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${providerSessionId}.jsonl`

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
  })

  it('normalizes complete legacy resumable state into Codex resume state', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          codexRolloutRelativePath: ` ${codexRolloutRelativePath} `,
          providerSessionId,
          resumeRouteId: 'route-new',
        },
      }),
    )

    expect(session.resumeState).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-new',
      threadId: providerSessionId,
    })
    expect(session.codexResume).toEqual(session.resumeState)
  })

  it('preserves Codex assistant contract fingerprints when present', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          assistantContractFingerprint:
            ' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ',
          providerSessionId,
          resumeRouteId: 'route-new',
        },
      }),
    )

    expect(session.resumeState).toEqual({
      assistantContractFingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      routeFingerprint: 'route-new',
      threadId: providerSessionId,
    })
    expect(session.codexResume).toEqual(session.resumeState)
  })

  it('drops legacy thread ids without route fingerprints', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          providerSessionId: 'provider-session-123',
          resumeRouteId: null,
        },
      }),
    )

    expect(session.codexResume).toBeNull()
    expect(session.resumeState).toBeNull()
  })

  it('drops legacy thread instruction fingerprints', () => {
    const trimmed = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          providerSessionId: 'provider-session-123',
          resumeRouteId: 'route-new',
          threadInstructionsFingerprint:
            `thread-instructions-v1:${'a'.repeat(64)}:${'b'.repeat(64)}`,
        },
      }),
    )

    expect(trimmed.resumeState).toEqual({
      routeFingerprint: 'route-new',
      threadId: 'provider-session-123',
    })

    const withoutFingerprint = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          providerSessionId: 'provider-session-123',
          resumeRouteId: 'route-new',
          threadInstructionsFingerprint: '   ',
        },
      }),
    )

    expect(withoutFingerprint.resumeState).toEqual({
      routeFingerprint: 'route-new',
      threadId: 'provider-session-123',
    })
  })

  it('drops unsafe Codex rollout paths from otherwise resumable state', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          codexRolloutRelativePath: '/tmp/codex/sessions/rollout.jsonl',
          providerSessionId: 'provider-session-123',
          resumeRouteId: 'route-new',
        },
      }),
    )

    expect(session.resumeState).toEqual({
      routeFingerprint: 'route-new',
      threadId: 'provider-session-123',
    })
  })

  it('parses v2 conversation records with Codex resume state', () => {
    const {
      sessionId: _sessionId,
      target,
      resumeState: _resumeState,
      ...baseRecord
    } = createPersistedSessionRecord()
    const session = parseAssistantSessionRecord({
      ...baseRecord,
      schema: 'murph.assistant-conversation.v2',
      conversationId: 'session_123',
      codexTarget: target,
      codexResume: {
        assistantContractFingerprint:
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        rolloutRelativePath: codexRolloutRelativePath,
        routeFingerprint: 'route-v2',
        threadId: providerSessionId,
      },
    })

    expect(session.conversationId).toBe('session_123')
    expect(session.sessionId).toBe('session_123')
    expect(session.codexResume).toEqual({
      assistantContractFingerprint:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-v2',
      threadId: providerSessionId,
    })
    expect(session.resumeState).toEqual(session.codexResume)
  })

  it('normalizes v2 Codex resume without route fingerprint to null', () => {
    const {
      sessionId: _sessionId,
      target,
      resumeState: _resumeState,
      ...baseRecord
    } = createPersistedSessionRecord()
    const session = parseAssistantSessionRecord({
      ...baseRecord,
      schema: 'murph.assistant-conversation.v2',
      conversationId: 'session_123',
      codexTarget: target,
      codexResume: {
        rolloutRelativePath: codexRolloutRelativePath,
        routeFingerprint: null,
        threadId: providerSessionId,
      },
    })

    expect(session.codexResume).toBeNull()
    expect(session.resumeState).toBeNull()
  })
})
