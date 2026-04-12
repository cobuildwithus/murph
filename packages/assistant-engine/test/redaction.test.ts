import { describe, expect, it } from 'vitest'

import {
  containsInlineAssistantSecretMaterial,
  mergeAssistantHeaders,
  redactAssistantHeadersForDisplay,
  redactAssistantProviderOptionsForDisplay,
  redactAssistantSessionForDisplay,
  redactAssistantSessionsForDisplay,
  redactAssistantStateString,
  redactAssistantStateStructuredValue,
  splitAssistantHeadersForPersistence,
} from '../src/assistant/redaction.ts'

describe('assistant redaction helpers', () => {
  it('redacts inline secrets from strings and nested structured values', () => {
    expect(
      redactAssistantStateString(
        'Authorization: Bearer secret-token-value api_key=my-api-key',
      ),
    ).toBe('Authorization: [REDACTED] [REDACTED] api_key=[REDACTED]')
    expect(
      containsInlineAssistantSecretMaterial('cookie=session-secret'),
    ).toBe(true)
    expect(
      containsInlineAssistantSecretMaterial('ordinary text'),
    ).toBe(false)

    expect(
      redactAssistantStateStructuredValue({
        nested: [
          {
            authorization: 'Bearer abcdefghijklmnop',
          },
          {
            note: 'token=my-secret',
          },
        ],
        headers: {
          cookie: 'cookie-value',
        },
      }),
    ).toEqual({
      headers: {
        cookie: '[REDACTED]',
      },
      nested: [
        {
          authorization: '[REDACTED]',
        },
        {
          note: 'token=[REDACTED]',
        },
      ],
    })
  })

  it('splits persisted and secret headers and redacts secret ones for display', () => {
    const split = splitAssistantHeadersForPersistence({
      Authorization: 'Bearer secret-token',
      Cookie: 'session-cookie',
      'X-Trace': 'trace-123',
    })
    expect(split).toEqual({
      persistedHeaders: {
        'X-Trace': 'trace-123',
      },
      secretHeaders: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
      },
    })

    expect(
      redactAssistantHeadersForDisplay({
        Authorization: 'Bearer secret-token',
        'X-Trace': 'trace-123',
      }),
    ).toEqual({
      Authorization: '[REDACTED]',
      'X-Trace': 'trace-123',
    })

    expect(
      mergeAssistantHeaders(
        {
          'X-Trace': 'trace-123',
        },
        {
          Authorization: '[REDACTED]',
        },
      ),
    ).toEqual({
      'X-Trace': 'trace-123',
      Authorization: '[REDACTED]',
    })
  })

  it('redacts provider and session headers only on supported target shapes', () => {
    const providerOptions = redactAssistantProviderOptionsForDisplay({
      approvalPolicy: 'never',
      continuityFingerprint: 'fingerprint-provider',
      executionDriver: 'openai-compatible',
      headers: {
        Authorization: 'Bearer provider-secret',
        'X-Trace': 'trace-123',
      },
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      providerName: 'murph-openai',
      reasoningEffort: 'medium',
      resumeKind: null,
      sandbox: 'workspace-write',
    })
    expect(providerOptions.headers).toEqual({
      Authorization: '[REDACTED]',
      'X-Trace': 'trace-123',
    })

    const session = redactAssistantSessionForDisplay({
      schema: 'murph.assistant-session.v1',
      alias: 'session-alpha',
      binding: {
        actorId: null,
        channel: 'telegram',
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: 'thread-1',
        threadIsDirect: true,
      },
      createdAt: '2026-04-08T00:00:00.000Z',
      lastTurnAt: null,
      provider: 'openai-compatible',
      providerBinding: {
        provider: 'openai-compatible',
        providerOptions: {
          approvalPolicy: 'never',
          continuityFingerprint: 'fingerprint-bound',
          executionDriver: 'openai-compatible',
          headers: {
            Authorization: 'Bearer bound-secret',
            'X-Trace': 'trace-456',
          },
          model: 'gpt-5.4',
          oss: false,
          profile: null,
          providerName: 'murph-openai',
          reasoningEffort: 'medium',
          resumeKind: null,
          sandbox: 'workspace-write',
        },
        providerSessionId: 'provider-session',
        providerState: null,
      },
      providerOptions: {
        approvalPolicy: 'never',
        continuityFingerprint: 'fingerprint-session',
        executionDriver: 'openai-compatible',
        headers: {
          Authorization: 'Bearer session-secret',
          'X-Trace': 'trace-789',
        },
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        providerName: 'murph-openai',
        reasoningEffort: 'medium',
        resumeKind: null,
        sandbox: 'workspace-write',
      },
      resumeState: null,
      sessionId: 'session-alpha',
      target: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: 'https://api.example.com/v1',
        headers: {
          Authorization: 'Bearer target-secret',
          'X-Trace': 'trace-321',
        },
        model: 'gpt-5.4',
        presetId: null,
        providerName: 'murph-openai',
        reasoningEffort: 'medium',
        webSearch: null,
      },
      turnCount: 0,
      updatedAt: '2026-04-08T00:00:00.000Z',
    })
    expect(session.target).toMatchObject({
      adapter: 'openai-compatible',
      headers: {
        Authorization: '[REDACTED]',
        'X-Trace': 'trace-321',
      },
    })
    expect(session.providerOptions.headers).toEqual({
      Authorization: '[REDACTED]',
      'X-Trace': 'trace-789',
    })
    expect(session.providerBinding?.providerOptions.headers).toEqual({
      Authorization: '[REDACTED]',
      'X-Trace': 'trace-456',
    })

    const codexSession = redactAssistantSessionForDisplay({
      ...session,
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
    })
      expect(codexSession.target).toEqual({
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      })

    expect(
      redactAssistantSessionsForDisplay([session]).map((entry) => entry.sessionId),
    ).toEqual(['session-alpha'])
  })
})
