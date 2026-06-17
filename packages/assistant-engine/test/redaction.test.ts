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
    const providerSecret = ['sk', 'providersecret12345'].join('-')
    const webhookSecret = ['whsec', 'runtimehook12345'].join('_')
    expect(
      redactAssistantStateString(
        'Authorization: Bearer secret-token-value api_key=my-api-key',
      ),
    ).toBe('Authorization: [REDACTED] api_key=[REDACTED]')
    expect(
      redactAssistantStateString(
        `Provider rejected ${providerSecret} and ${webhookSecret}`,
      ),
    ).toBe('Provider rejected [REDACTED] and [REDACTED]')
    expect(
      redactAssistantStateString(
        'failed hosted-user-runtime:member_123 for member_123 and user_123; status user_not_active',
      ),
    ).toBe(
      'failed hosted-user-runtime:[redacted-id] for member_[redacted-id] and user_[redacted-id]; status user_not_active',
    )
    expect(
      containsInlineAssistantSecretMaterial('cookie=session-secret'),
    ).toBe(true)
    expect(
      containsInlineAssistantSecretMaterial('ordinary text'),
    ).toBe(false)

    expect(
      redactAssistantStateStructuredValue({
        accessToken: 'access-token-value',
        clientSecret: 'client-secret-value',
        nested: [
          {
            authorization: 'Bearer abcdefghijklmnop',
          },
          {
            refreshToken: 'refresh-token-value',
          },
          {
            note: 'token=my-secret',
          },
        ],
        password: 'password-value',
        headers: {
          cookie: 'cookie-value',
        },
      }),
    ).toEqual({
      accessToken: '[REDACTED]',
      clientSecret: '[REDACTED]',
      headers: {
        cookie: '[REDACTED]',
      },
      nested: [
        {
          authorization: '[REDACTED]',
        },
        {
          refreshToken: '[REDACTED]',
        },
        {
          note: 'token=[REDACTED]',
        },
      ],
      password: '[REDACTED]',
    })
  })

  it('redacts non-Bearer authorization scheme credentials without leaving token values', () => {
    expect(
      redactAssistantStateString(
        'Authorization: Token token-secret-value Proxy-Authorization: ApiKey api-key-secret',
      ),
    ).toBe('Authorization: [REDACTED] Proxy-Authorization: [REDACTED]')
    expect(
      redactAssistantStateString('authorization=Api-Key abc123'),
    ).toBe('authorization=[REDACTED]')
    expect(
      redactAssistantStateString('Authorization=secret-token-123456'),
    ).toBe('Authorization=[REDACTED]')
    expect(
      redactAssistantStateString('Authorization: secret-token-123456 status=ok'),
    ).toBe('Authorization: [REDACTED] status=ok')
    expect(
      redactAssistantStateString('Authorization: OAuth oauth-secret-value, status=ok'),
    ).toBe('Authorization: [REDACTED], status=ok')
    expect(
      redactAssistantStateString('Authorization: Custom raw-secret-value'),
    ).toBe('Authorization: [REDACTED]')
    expect(
      redactAssistantStateString('Authorization: Custom raw-secret-value status=ok'),
    ).toBe('Authorization: [REDACTED] status=ok')
    expect(
      redactAssistantStateString('Authorization: AWS4-HMAC-SHA256 Credential=secret, status=ok'),
    ).toBe('Authorization: [REDACTED], status=ok')
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

  it('leaves Codex provider and session display data free of legacy headers', () => {
    const providerOptions = redactAssistantProviderOptionsForDisplay({
      provider: 'codex-cli',
      approvalPolicy: 'never',
      continuityFingerprint: 'fingerprint-provider',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.4',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
      sandbox: 'workspace-write',
      codexHome: '/tmp/codex-home',
    })
    expect(providerOptions.codexHome).toBe('[path]')
    expect(providerOptions.headers).toBeNull()

    const session = redactAssistantSessionForDisplay({
      schema: 'murph.assistant-conversation.v2',
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
      codexResume: null,
      codexTarget: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: '/tmp/codex-cli',
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
      conversationId: 'session-alpha',
      createdAt: '2026-04-08T00:00:00.000Z',
      lastTurnAt: null,
      provider: 'codex-cli',
      providerOptions: {
        provider: 'codex-cli',
        approvalPolicy: 'never',
        continuityFingerprint: 'fingerprint-session',
        executionDriver: 'codex-app-server',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        resumeKind: 'codex-thread',
        sandbox: 'workspace-write',
        codexHome: '/tmp/codex-home',
      },
      resumeState: null,
      sessionId: 'session-alpha',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: '/tmp/codex-cli',
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
      turnCount: 0,
      updatedAt: '2026-04-08T00:00:00.000Z',
    })
    expect(session.target).toEqual({
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: '[path]',
      codexHome: '[path]',
      model: 'gpt-5.4',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'workspace-write',
    })
    expect(session.providerOptions.codexHome).toBe('[path]')
    expect(session.providerOptions.headers).toBeNull()
    expect(session.resumeState).toBeNull()

    expect(
      redactAssistantSessionsForDisplay([session]).map((entry) => entry.sessionId),
    ).toEqual(['session-alpha'])
  })
})
