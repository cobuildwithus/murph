import { describe, expect, it } from 'vitest'

import {
  assistantModelTargetSchema,
  assistantPersistedSessionSchema,
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.js'

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

  it('drops malformed Codex assistant contract fingerprints', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          assistantContractFingerprint: 'not-a-valid-contract-fingerprint',
          providerSessionId,
          resumeRouteId: 'route-new',
        },
      }),
    )

    expect(session.resumeState).toEqual({
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


describe('OpenAI-only persisted conversation migration', () => {
  const retiredTargets = [
    { modelProvider: 'venice', oss: false },
    { modelProvider: 'hosted-custom-inference', oss: false },
    { modelProvider: 'vercel-ai-gateway', oss: false },
    { modelProvider: 'venice-local-test', oss: false },
    { modelProvider: 'ollama', oss: true },
    { modelProvider: null, oss: true },
  ]

  for (const version of ['v1', 'v2'] as const) {
    it.each(retiredTargets)(
      `preserves ${version} conversation identity while retiring $modelProvider / oss=$oss`,
      (retiredTarget) => {
        const original = createPersistedSessionRecord({
          alias: 'saved-conversation',
          lastTurnAt: '2026-04-12T00:04:00.000Z',
          turnCount: 7,
        })
        const target = {
          ...original.target,
          ...retiredTarget,
          model: 'retired-model',
          profile: 'retired-profile',
        }
        const resume = {
          routeFingerprint: 'old-provider-route',
          threadCompatibilityFingerprint: 'old-provider-compatibility',
          threadId: providerSessionId,
          rolloutRelativePath: codexRolloutRelativePath,
        }
        const { sessionId, target: _target, resumeState: _resume, ...fields } = original
        const v2 = {
          ...fields,
          schema: 'murph.assistant-conversation.v2',
          conversationId: sessionId,
          codexTarget: target,
          codexResume: resume,
        }
        const session = parseAssistantSessionRecord(version === 'v1'
          ? { ...original, target, resumeState: resume }
          : v2)

        expect(session).toMatchObject({
          schema: 'murph.assistant-conversation.v2',
          conversationId: original.sessionId,
          sessionId: original.sessionId,
          alias: original.alias,
          binding: original.binding,
          createdAt: original.createdAt,
          updatedAt: original.updatedAt,
          lastTurnAt: original.lastTurnAt,
          turnCount: original.turnCount,
          codexTarget: { model: null, modelProvider: 'openai', oss: false, profile: null },
          target: { model: null, modelProvider: 'openai', oss: false, profile: null },
          codexResume: null,
          resumeState: null,
          providerOptions: { model: null, modelProvider: 'openai', oss: false, profile: null },
        })
        expect(assistantModelTargetSchema.safeParse(target).success).toBe(false)
        expect(assistantPersistedSessionSchema.safeParse(v2).success).toBe(false)
        const migrated = {
          ...v2,
          codexTarget: session.codexTarget,
          codexResume: session.codexResume,
        }
        expect(assistantPersistedSessionSchema.safeParse(migrated).success).toBe(true)
        expect(parseAssistantSessionRecord(migrated)).toEqual(session)
      },
    )
  }

  it('still rejects malformed persisted conversation fields', () => {
    const record = createPersistedSessionRecord()
    expect(() => parseAssistantSessionRecord({
      ...record,
      target: { ...record.target, modelProvider: 'venice' },
      turnCount: -1,
    })).toThrow()
    expect(() => parseAssistantSessionRecord({
      ...record,
      target: { ...record.target, adapter: 'unsupported-provider' },
    })).toThrow()
  })
})
