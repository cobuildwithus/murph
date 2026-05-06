import { describe, expect, it } from 'vitest'

import { parseAssistantSessionRecord } from '../src/assistant-cli-contracts.js'

const threadInstructionsFingerprint =
  `thread-instructions-v1:${'a'.repeat(64)}:${'b'.repeat(64)}`
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

  it('retains complete resumable state', () => {
    const session = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          codexRolloutRelativePath: ` ${codexRolloutRelativePath} `,
          providerSessionId,
          resumeRouteId: 'route-new',
          threadInstructionsFingerprint,
        },
      }),
    )

    expect(session.resumeState).toEqual({
      codexRolloutRelativePath,
      providerSessionId,
      resumeRouteId: 'route-new',
      threadInstructionsFingerprint,
    })
  })

  it('trims and drops blank thread instruction fingerprints', () => {
    const trimmed = parseAssistantSessionRecord(
      createPersistedSessionRecord({
        resumeState: {
          providerSessionId: 'provider-session-123',
          resumeRouteId: 'route-new',
          threadInstructionsFingerprint:
            ` ${threadInstructionsFingerprint} `,
        },
      }),
    )

    expect(trimmed.resumeState).toEqual({
      providerSessionId: 'provider-session-123',
      resumeRouteId: 'route-new',
      threadInstructionsFingerprint,
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
      providerSessionId: 'provider-session-123',
      resumeRouteId: 'route-new',
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
      providerSessionId: 'provider-session-123',
      resumeRouteId: 'route-new',
    })
  })
})
