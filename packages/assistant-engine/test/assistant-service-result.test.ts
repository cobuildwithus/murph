import { describe, expect, it } from 'vitest'
import { assistantAskResultSchema, parseAssistantSessionRecord } from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeAssistantAskResultForReturn } from '../src/assistant/service-result.ts'

describe('assistant service-result seam', () => {
  it('normalizes ask results for return with Codex session options', () => {
    const result = normalizeAssistantAskResultForReturn({
      vault: '/tmp/assistant-vault',
      status: 'completed',
      prompt: 'Hello',
      response: 'Hi there',
      media: [],
      session: parseAssistantSessionRecord({
        schema: 'murph.assistant-session.v1',
        sessionId: 'session-service-result',
        target: {
          adapter: 'codex-cli',
          approvalPolicy: 'never',
          codexCommand: null,
          codexHome: null,
          model: 'gpt-6.1-sol',
          modelProvider: 'hosted-openai',
          oss: false,
          profile: null,
          reasoningEffort: 'medium',
          sandbox: 'danger-full-access',
        },
        resumeState: {
          threadId: 'codex-thread-1',
          routeFingerprint: 'route-1',
        },
        alias: 'service-result',
        binding: {
          conversationKey: null,
          actorId: null,
          channel: 'telegram',
          delivery: null,
          identityId: null,
          threadId: 'thread-1',
          threadIsDirect: true,
        },
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
        lastTurnAt: null,
        turnCount: 1,
      }),
      delivery: null,
      deliveryDeferred: false,
      deliveryIntentId: null,
      deliveryError: null,
    })

    expect(assistantAskResultSchema.parse(result)).toEqual(result)
    expect(result.session.target).toMatchObject({
      adapter: 'codex-cli',
      model: 'gpt-6.1-sol',
      modelProvider: 'hosted-openai',
    })
    expect(result.session.providerOptions).toMatchObject({
      executionDriver: 'codex-app-server',
      model: 'gpt-6.1-sol',
      modelProvider: 'hosted-openai',
      provider: 'codex-cli',
      resumeKind: 'codex-thread',
    })
    expect(result.session.resumeState).toEqual({
      routeFingerprint: 'route-1',
      threadId: 'codex-thread-1',
    })
  })
})
