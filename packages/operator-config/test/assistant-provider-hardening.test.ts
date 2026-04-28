import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  sanitizeAssistantBackendTargetForPersistence,
} from '../src/assistant-backend.ts'
import {
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
  resolveAssistantRuntimeTarget,
} from '../src/assistant/target-runtime.ts'

test('legacy OpenAI-compatible assistant config paths fail closed with a Codex reconfigure error', () => {
  const message = /OpenAI-compatible assistant runtimes are no longer supported/u

  assert.throws(
    () =>
      normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://proxy.example.test/v1',
        model: 'gpt-5.4',
        presetId: 'openai',
        providerName: 'OpenAI',
      }),
    message,
  )

  assert.throws(
    () =>
      resolveAssistantRuntimeTarget({
        provider: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://proxy.example.test/v1',
        model: 'gpt-5.4',
        presetId: 'openai',
        providerName: 'OpenAI',
      }),
    message,
  )

  assert.throws(
    () =>
      sanitizeAssistantBackendTargetForPersistence({
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: 'https://proxy.example.test/v1',
        headers: null,
        model: 'gpt-5.4',
        presetId: 'openai',
        providerName: 'OpenAI',
        reasoningEffort: 'high',
        webSearch: null,
      }),
    message,
  )
})

test('legacy OpenAI-compatible persisted sessions fail closed during parsing', () => {
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
        createdAt: '2026-04-23T10:00:00.000Z',
        lastTurnAt: null,
        resumeState: null,
        schema: 'murph.assistant-session.v1',
        sessionId: 'session_custom_precedence',
        target: {
          adapter: 'openai-compatible',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://proxy.example.test/v1',
          headers: null,
          model: 'gpt-5.4',
          presetId: 'openai',
          providerName: 'OpenAI',
          reasoningEffort: 'high',
          webSearch: null,
        },
        turnCount: 1,
        updatedAt: '2026-04-23T10:05:00.000Z',
      }),
    /Reconfigure the assistant for Codex App Server/u,
  )
})

test('explicit Codex provider inputs ignore legacy request-shaping fields', () => {
  const legacyCodexInput = {
    provider: 'codex-cli',
    approvalPolicy: 'never',
    apiKeyEnv: 'VERCEL_AI_API_KEY',
    baseUrl: 'https://gateway.example.test/v1',
    codexCommand: 'codex',
    gatewayOnlyProviders: ['openai'],
    headers: {
      Authorization: '<REDACTED_TOKEN>',
      'X-Test': 'value',
    },
    model: 'gpt-5.5',
    modelProvider: ' vercel-ai-gateway ',
    oss: true,
    profile: 'hosted',
    providerName: 'Example Gateway',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    webSearch: 'gateway',
    zeroDataRetention: true,
  } as const

  assert.deepEqual(normalizeAssistantProviderConfig(legacyCodexInput), {
    policy: {
      approvalPolicy: 'never',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      webSearch: null,
      zeroDataRetention: null,
    },
    target: {
      kind: 'codex-cli',
      codexCommand: 'codex',
      codexHome: null,
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      oss: true,
      profile: 'hosted',
    },
  })

  assert.deepEqual(serializeAssistantProviderSessionOptions(legacyCodexInput), {
    approvalPolicy: 'never',
    continuityFingerprint: serializeAssistantProviderSessionOptions({
      provider: 'codex-cli',
      approvalPolicy: 'never',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: true,
      profile: 'hosted',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    }).continuityFingerprint,
    executionDriver: 'codex-app-server',
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
    oss: true,
    profile: 'hosted',
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    resumeKind: 'codex-thread',
    sandbox: 'danger-full-access',
  })

  assert.deepEqual(serializeAssistantProviderOperatorDefaults(legacyCodexInput), {
    approvalPolicy: 'never',
    apiKeyEnv: null,
    baseUrl: null,
    codexCommand: 'codex',
    codexHome: null,
    headers: null,
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
    oss: true,
    presetId: null,
    profile: 'hosted',
    providerName: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    webSearch: null,
    zeroDataRetention: null,
  })
})
