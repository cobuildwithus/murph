import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assistantStatusAutomationSchema,
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
  normalizeAssistantExecutionDriver,
  normalizeAssistantResumeKind,
  normalizeAssistantWebSearchMode,
  resolveAssistantRuntimeTarget,
  resolveAssistantTargetPresetId,
  shouldAssistantTargetUseGatewayWebSearch,
  shouldAssistantTargetUseMurphWebSearch,
  shouldAssistantTargetUseProviderWebSearch,
} from '../src/assistant/target-runtime.ts'

test('assistant target runtime exposes only Codex app-server execution and resume values', () => {
  assert.equal(normalizeAssistantExecutionDriver(' codex-app-server '), 'codex-app-server')
  assert.equal(normalizeAssistantExecutionDriver('responses'), null)
  assert.equal(normalizeAssistantResumeKind(' codex-thread '), 'codex-thread')
  assert.equal(normalizeAssistantResumeKind('openai-response-id'), null)
  assert.equal(normalizeAssistantWebSearchMode(' provider '), 'provider')
  assert.equal(normalizeAssistantWebSearchMode('invalid'), null)

  assert.equal(resolveAssistantTargetPresetId({ presetId: 'openrouter' }), null)

  const codexTarget = resolveAssistantRuntimeTarget({
    provider: 'codex-cli',
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    webSearch: 'murph',
  })
  assert.equal(codexTarget.executionDriver, 'codex-app-server')
  assert.equal(codexTarget.resumeKind, 'codex-thread')
  assert.equal(codexTarget.modelProvider, 'vercel-ai-gateway')
  assert.deepEqual(
    codexTarget.modelProviderConfig,
    VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
  )
  assert.equal(codexTarget.supportsNativeResume, true)
  assert.equal(codexTarget.supportsReasoningEffort, true)
  assert.equal(codexTarget.supportsZeroDataRetention, false)
  assert.equal(shouldAssistantTargetUseProviderWebSearch({ provider: 'codex-cli' }), false)
  assert.equal(shouldAssistantTargetUseGatewayWebSearch({ provider: 'codex-cli' }), false)
  assert.equal(shouldAssistantTargetUseMurphWebSearch({ provider: 'codex-cli' }), false)

  assert.throws(
    () =>
      resolveAssistantRuntimeTarget({
        provider: 'openai-compatible',
        presetId: 'openai',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.example.test/v1',
        model: 'gpt-5.4',
      }),
    /Reconfigure the assistant for Codex App Server/u,
  )
})

test('assistant session parsing resolves Codex modelProvider and status automation cursors', () => {
  const runtimeTarget = resolveAssistantRuntimeTarget({
    provider: 'codex-cli',
    approvalPolicy: 'never',
    codexHome: '/tmp/codex-home',
    model: 'gpt-5.5',
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
      resumeRouteId: null,
    },
    schema: 'murph.assistant-session.v1',
    sessionId: 'session_codex_runtime',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'default',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    turnCount: 2,
    updatedAt: '2026-04-08T12:05:00.000Z',
  })

  assert.equal(parsedSession.resumeState?.providerSessionId, 'codex-thread-123')
  assert.equal(parsedSession.providerOptions.continuityFingerprint, runtimeTarget.continuityFingerprint)
  assert.equal(parsedSession.providerOptions.executionDriver, 'codex-app-server')
  assert.equal(parsedSession.providerOptions.modelProvider, 'vercel-ai-gateway')
  assert.deepEqual(
    parsedSession.providerOptions.modelProviderConfig,
    VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
  )
  assert.equal(parsedSession.providerOptions.resumeKind, 'codex-thread')

  const statusAutomation = assistantStatusAutomationSchema.parse({
    inboxScanCursor: {
      captureId: 'capture-1',
      occurredAt: '2026-04-08T12:05:00.000Z',
    },
    autoReply: [
      {
        channel: 'telegram',
        cursor: null,
      },
      {
        channel: 'email',
        cursor: {
          captureId: 'capture-2',
          occurredAt: '2026-04-08T12:06:00.000Z',
        },
      },
    ],
    updatedAt: '2026-04-08T12:10:00.000Z',
  })

  assert.equal(statusAutomation.inboxScanCursor?.captureId, 'capture-1')
  assert.equal(statusAutomation.autoReply[0]?.cursor, null)
  assert.equal(statusAutomation.autoReply[1]?.cursor?.captureId, 'capture-2')
})

test('assistant session parsing fails closed for persisted OpenAI-compatible sessions', () => {
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
          adapter: 'openai-compatible',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.openai.com/v1',
          headers: null,
          model: 'gpt-5.4',
          presetId: 'openai',
          providerName: 'OpenAI',
          reasoningEffort: 'high',
          webSearch: null,
        },
        turnCount: 1,
        updatedAt: '2026-04-08T12:05:00.000Z',
      }),
    /OpenAI-compatible assistant runtimes are no longer supported/u,
  )
})
