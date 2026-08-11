import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assistantStatusAutomationSchema,
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'

test('assistant session options expose only Codex app-server execution and resume values', () => {
  const options = serializeAssistantProviderSessionOptions({
    provider: 'codex-cli',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
  })
  assert.equal(options.executionDriver, 'codex-app-server')
  assert.equal(options.resumeKind, 'codex-thread')
  assert.equal(options.modelProvider, 'vercel-ai-gateway')
  assert.equal(options.provider, 'codex-cli')

  assert.throws(
    () =>
      serializeAssistantProviderSessionOptions({
        provider: 'unsupported-provider',
        model: 'gpt-5.4',
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )
})

test('assistant session parsing resolves Codex modelProvider and status automation cursors', () => {
  const sessionOptions = serializeAssistantProviderSessionOptions({
    provider: 'codex-cli',
    approvalPolicy: 'never',
    codexHome: '/tmp/codex-home',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: 'default',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })

  const parsedSession = parseAssistantSessionRecord({
    alias: null,
    binding: {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    createdAt: '2026-04-08T12:00:00.000Z',
    lastTurnAt: null,
    resumeState: {
      providerSessionId: 'codex-thread-123',
      resumeRouteId: sessionOptions.continuityFingerprint,
    },
    schema: 'murph.assistant-session.v1',
    sessionId: 'session_codex_runtime',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'default',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    turnCount: 2,
    updatedAt: '2026-04-08T12:05:00.000Z',
  })

  assert.equal(parsedSession.codexResume?.threadId, 'codex-thread-123')
  assert.equal(parsedSession.resumeState?.threadId, 'codex-thread-123')
  assert.equal(
    parsedSession.providerOptions.continuityFingerprint,
    sessionOptions.continuityFingerprint,
  )
  assert.equal(parsedSession.providerOptions.executionDriver, 'codex-app-server')
  assert.equal(parsedSession.providerOptions.modelProvider, 'vercel-ai-gateway')
  assert.equal(parsedSession.providerOptions.resumeKind, 'codex-thread')

  const statusAutomation = assistantStatusAutomationSchema.parse({
    autoReply: [
      {
        channel: 'telegram',
        enabledAt: '2026-04-08T12:00:00.000Z',
        eligibleAfter: null,
      },
      {
        channel: 'email',
        enabledAt: '2026-04-08T12:01:00.000Z',
        eligibleAfter: {
          createdAt: null,
          inputId: 'input-2',
          occurredAt: '2026-04-08T12:06:00.000Z',
          sourceKind: 'inbox-capture',
        },
      },
    ],
    updatedAt: '2026-04-08T12:10:00.000Z',
  })

  assert.equal(statusAutomation.autoReply[0]?.eligibleAfter, null)
  assert.equal(statusAutomation.autoReply[1]?.eligibleAfter?.inputId, 'input-2')

  assert.throws(() =>
    assistantStatusAutomationSchema.parse({
      autoReply: [
        {
          channel: 'telegram',
          cursor: {
            captureId: 'capture-legacy',
            occurredAt: '2026-04-08T12:05:00.000Z',
          },
        },
      ],
      updatedAt: '2026-04-08T12:10:00.000Z',
    }),
  )
})

test('assistant session parsing fails closed for unsupported persisted sessions', () => {
  assert.throws(
    () =>
      parseAssistantSessionRecord({
        alias: null,
        binding: {
          actorId: null,
          channel: null,
          conversationKey: null,
          delivery: null,
          identityId: null,
          threadId: null,
          threadIsDirect: null,
        },
        createdAt: '2026-04-08T12:00:00.000Z',
        lastTurnAt: null,
        resumeState: {
          providerSessionId: 'resp_456',
          resumeRouteId: 'route-stored',
        },
        schema: 'murph.assistant-session.v1',
        sessionId: 'session_legacy_resume_contract',
        target: {
          adapter: 'unsupported-provider',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.example.test/v1',
          headers: null,
          model: 'gpt-5.4',
          presetId: 'legacy',
          providerName: 'Legacy',
          reasoningEffort: 'high',
          webSearch: null,
        },
        turnCount: 1,
        updatedAt: '2026-04-08T12:05:00.000Z',
      }),
  )
})
