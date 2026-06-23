import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'

import {
  buildHostedAssistantContextFingerprintDetails,
  emitHostedAssistantContextSessionResolvedTrace,
  emitHostedAssistantContextTimingTrace,
  fingerprintHostedAssistantContextValue,
  resolveHostedAssistantContextFingerprintSecret,
} from '../src/assistant/hosted-context-diagnostics.js'
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from '../src/assistant/first-contact-welcome.js'
import {
  appendAssistantTranscriptEntries,
  resolveAssistantStatePaths,
  type ResolvedAssistantSession,
} from '../src/assistant/store.js'

describe('hosted assistant context diagnostics', () => {
  it('correlates matching actor fallback while separating different threads', () => {
    const env = {
      HOSTED_LOG_FINGERPRINT_SECRET: 'diagnostic-secret',
    }
    const first = buildHostedAssistantContextFingerprintDetails({
      actorId: 'actor-alpha',
      channel: 'linq',
      env,
      identityId: 'identity-alpha',
      threadId: 'thread-one',
      threadIsDirect: true,
    })
    const second = buildHostedAssistantContextFingerprintDetails({
      actorId: 'actor-alpha',
      channel: 'linq',
      env,
      identityId: 'identity-alpha',
      threadId: 'thread-two',
      threadIsDirect: true,
    })

    expect(first.fingerprintReady).toBe(true)
    expect(first.actorFingerprint).toEqual(second.actorFingerprint)
    expect(first.identityFingerprint).toEqual(second.identityFingerprint)
    expect(first.actorFallbackConversationFingerprint).toEqual(
      second.actorFallbackConversationFingerprint,
    )
    expect(first.threadFingerprint).not.toEqual(second.threadFingerprint)
    expect(first.primaryConversationFingerprint).not.toEqual(
      second.primaryConversationFingerprint,
    )
    expect(first.primaryConversationScope).toBe('thread')
    expect(first.actorFallbackConversationScope).toBe('actor')
    expect(JSON.stringify(first)).not.toContain('actor-alpha')
    expect(JSON.stringify(first)).not.toContain('identity-alpha')
    expect(JSON.stringify(first)).not.toContain('thread-one')
  })

  it('omits fingerprints when no platform secret is configured', () => {
    const details = buildHostedAssistantContextFingerprintDetails({
      actorId: 'actor-alpha',
      channel: 'linq',
      env: {},
      identityId: 'identity-alpha',
      threadId: 'thread-one',
      threadIsDirect: true,
    })

    expect(details).toEqual({
      actorFallbackConversationScope: 'actor',
      actorPresent: true,
      channel: 'linq',
      fingerprintReady: false,
      identityPresent: true,
      primaryConversationScope: 'thread',
      sessionPresent: false,
      threadIsDirect: true,
      threadPresent: true,
    })
  })

  it('falls back to the existing usage reporting secret', () => {
    expect(resolveHostedAssistantContextFingerprintSecret({
      HOSTED_AI_USAGE_REPORTING_SECRET: ' usage-secret ',
    })).toBe('usage-secret')
    expect(
      fingerprintHostedAssistantContextValue('usage-secret', 'thread', 'thread-one'),
    ).toMatch(/^h1_[a-f0-9]{24}$/u)
  })

  it('prefers the hosted log secret and rejects incomplete fingerprint inputs', () => {
    expect(resolveHostedAssistantContextFingerprintSecret({
      HOSTED_AI_USAGE_REPORTING_SECRET: 'usage-secret',
      HOSTED_LOG_FINGERPRINT_SECRET: ' log-secret ',
    })).toBe('log-secret')

    expect(fingerprintHostedAssistantContextValue('', 'thread', 'thread-one')).toBeNull()
    expect(
      fingerprintHostedAssistantContextValue('log-secret', 'bad field', 'thread-one'),
    ).toBeNull()
    expect(
      fingerprintHostedAssistantContextValue('log-secret', 'thread', '   '),
    ).toBeNull()
  })

  it('emits hosted timing diagnostics without raw identifiers', () => {
    const traceEvents: unknown[] = []

    emitHostedAssistantContextTimingTrace({
      message: {
        executionContext: {
          hosted: {
            memberId: 'member-context-timing',
            userEnvKeys: [],
          },
        },
        onTraceEvent(event) {
          traceEvents.push(event)
        },
      },
      preProviderAdmissionCount: 0,
      preProviderSetupMs: 123,
      providerRequestOrdinal: 0,
      stage: 'assistant-pre-provider-ready',
      turnLockWaitMs: 45,
    })

    expect(traceEvents).toHaveLength(1)
    expect(traceEvents[0]).toEqual({
      codexThreadId: null,
      rawEvent: {
        schema: 'murph.assistant-context-diagnostics.v1',
        type: 'assistant.context.diagnostics',
        stage: 'assistant-pre-provider-ready',
        preProviderAdmissionCount: 0,
        preProviderSetupMs: 123,
        providerRequestOrdinal: 0,
        turnLockWaitMs: 45,
      },
      updates: [],
    })
    expect(JSON.stringify(traceEvents[0])).not.toContain('member-context-timing')
  })

  it('emits hosted turn-lock timing diagnostics without raw identifiers', () => {
    const traceEvents: unknown[] = []

    emitHostedAssistantContextTimingTrace({
      message: {
        executionContext: {
          hosted: {
            memberId: 'member-lock-timing',
            userEnvKeys: [],
          },
        },
        onTraceEvent(event) {
          traceEvents.push(event)
        },
      },
      stage: 'assistant-turn-lock-acquired',
      turnLockWaitMs: 321,
    })

    expect(traceEvents).toHaveLength(1)
    expect(traceEvents[0]).toEqual({
      codexThreadId: null,
      rawEvent: {
        schema: 'murph.assistant-context-diagnostics.v1',
        type: 'assistant.context.diagnostics',
        stage: 'assistant-turn-lock-acquired',
        preProviderAdmissionCount: null,
        preProviderSetupMs: null,
        providerRequestOrdinal: null,
        turnLockWaitMs: 321,
      },
      updates: [],
    })
    expect(JSON.stringify(traceEvents[0])).not.toContain('member-lock-timing')
  })

  it('records absent binding inputs without leaking raw values or claiming scope', () => {
    const details = buildHostedAssistantContextFingerprintDetails({
      actorId: '   ',
      channel: null,
      env: {
        HOSTED_LOG_FINGERPRINT_SECRET: 'diagnostic-secret',
      },
      identityId: undefined,
      sessionId: '',
      threadId: null,
      threadIsDirect: undefined,
    })

    expect(details).toEqual({
      actorFallbackConversationFingerprint: null,
      actorFallbackConversationScope: 'none',
      actorFingerprint: null,
      actorPresent: false,
      channel: null,
      fingerprintReady: true,
      identityFingerprint: null,
      identityPresent: false,
      primaryConversationFingerprint: null,
      primaryConversationScope: 'none',
      sessionFingerprint: null,
      sessionPresent: false,
      threadFingerprint: null,
      threadIsDirect: null,
      threadPresent: false,
    })
  })

  it('emits session-resolution trace metrics from existing transcript entries', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'murph-context-diagnostics-'))
    const sessionId = 'session-context-diagnostics'
    await appendAssistantTranscriptEntries(vault, sessionId, [
      {
        createdAt: '2026-04-25T09:00:00.000Z',
        kind: 'assistant',
        text: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
      },
      {
        createdAt: '2026-04-25T09:01:00.000Z',
        kind: 'user',
        text: 'Continue setup.',
      },
    ])

    const providerOptions = serializeAssistantProviderSessionOptions({
      approvalPolicy: 'never',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    })
    const target = createAssistantModelTarget(providerOptions)
    if (!target) {
      throw new Error('Expected assistant target.')
    }
    const resolved: ResolvedAssistantSession = {
      created: false,
      paths: resolveAssistantStatePaths(vault),
      resolutionDiagnostics: {
        actorFallbackConversationIndexed: false,
        conversationLookupIndexedCandidateCount: 1,
        conversationLookupKeyCount: 2,
        conversationLookupMatchedScope: 'thread',
        primaryConversationIndexed: true,
        sessionResolutionLookupSource: 'conversation-key',
      },
      session: {
        alias: null,
        binding: {
          actorId: 'actor-alpha',
          channel: 'linq',
          conversationKey: 'channel:linq|thread:thread-one',
          delivery: null,
          identityId: 'identity-alpha',
          threadId: 'thread-one',
          threadIsDirect: true,
        },
        codexResume: null,
        codexTarget: target,
        conversationId: sessionId,
        createdAt: '2026-04-25T09:00:00.000Z',
        lastTurnAt: null,
        provider: 'codex-cli',
        providerOptions,
        resumeState: null,
        pendingComputerResume: null,
        schema: 'murph.assistant-conversation.v2',
        sessionId,
        target,
        turnCount: 2,
        updatedAt: '2026-04-25T09:01:00.000Z',
      },
    }
    const traceEvents: unknown[] = []

    await emitHostedAssistantContextSessionResolvedTrace({
      message: {
        actorId: null,
        channel: null,
        executionContext: {
          hosted: {
            memberId: 'member-alpha',
            userEnvKeys: [],
          },
        },
        identityId: null,
        onTraceEvent: (event) => {
          traceEvents.push(event.rawEvent)
        },
        threadId: null,
        threadIsDirect: undefined,
        vault,
      },
      resolved,
      source: 'assistant-message',
    })

    expect(traceEvents).toHaveLength(1)
    expect(traceEvents[0]).toMatchObject({
      existingTranscriptEntryCount: 2,
      existingTranscriptWelcomeVisible: true,
      actorFallbackConversationIndexed: false,
      conversationLookupIndexedCandidateCount: 1,
      conversationLookupKeyCount: 2,
      conversationLookupMatchedScope: 'thread',
      primaryConversationIndexed: true,
      primaryConversationScope: 'thread',
      sessionResolutionCreated: false,
      sessionResolutionLookupSource: 'conversation-key',
      sessionTurnCount: 2,
      source: 'assistant-message',
    })
    expect(JSON.stringify(traceEvents[0])).not.toContain('actor-alpha')
    expect(JSON.stringify(traceEvents[0])).not.toContain('identity-alpha')
    expect(JSON.stringify(traceEvents[0])).not.toContain('thread-one')
  })
})
