import assert from 'node:assert/strict'

import { test } from 'vitest'

import { sanitizeAssistantBackendTargetForPersistence } from '../src/assistant-backend.ts'
import { parseAssistantSessionRecord } from '../src/assistant-cli-contracts.ts'
import {
  resolveOpenAICompatibleProviderPresetFromBaseUrl,
  resolveOpenAICompatibleProviderTargetPresetId,
} from '../src/assistant/openai-compatible-provider-presets.ts'
import { normalizeAssistantProviderConfig } from '../src/assistant/provider-config.ts'
import {
  isAssistantOpenAIBaseUrl,
  isAssistantVercelAIGatewayBaseUrl,
} from '../src/assistant/shared.ts'
import { resolveAssistantRuntimeTarget } from '../src/assistant/target-runtime.ts'

test('assistant official-host detection rejects lookalikes and userinfo-bearing URLs', () => {
  for (const value of [
    'https://api.openai.com.evil.test/v1',
    'https://api.openai.com@evil.test/v1',
    'http://api.openai.com/v1',
    'https://user:pass@api.openai.com/v1',
  ]) {
    assert.equal(isAssistantOpenAIBaseUrl(value), false)
    assert.equal(resolveOpenAICompatibleProviderPresetFromBaseUrl(value), null)
  }

  for (const value of [
    'https://ai-gateway.vercel.sh.evil.test/v1',
    'https://ai-gateway.vercel.sh@evil.test/v1',
    'http://ai-gateway.vercel.sh/v1',
    'https://user:pass@ai-gateway.vercel.sh/v1',
  ]) {
    assert.equal(isAssistantVercelAIGatewayBaseUrl(value), false)
    assert.equal(resolveOpenAICompatibleProviderPresetFromBaseUrl(value), null)
  }
})

test('assistant target preset resolution keeps custom endpoints conservative', () => {
  assert.equal(
    resolveOpenAICompatibleProviderTargetPresetId({
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://proxy.example.test/v1',
      presetId: 'openai',
      providerName: 'OpenAI',
    }),
    null,
  )
  assert.equal(
    resolveOpenAICompatibleProviderTargetPresetId({
      apiKeyEnv: 'VERCEL_AI_API_KEY',
      baseUrl: 'https://gateway.internal.test/v1',
      presetId: 'vercel-ai-gateway',
      providerName: 'vercel-ai-gateway',
    }),
    null,
  )
  assert.equal(
    resolveOpenAICompatibleProviderTargetPresetId({
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      presetId: 'openai',
      providerName: 'OpenAI',
    }),
    'vercel-ai-gateway',
  )
  assert.equal(
    resolveOpenAICompatibleProviderTargetPresetId({
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      presetId: 'custom',
      providerName: 'vercel-ai-gateway',
    }),
    'custom',
  )
})

test('assistant normalization, persistence, session parsing, and runtime resolution honor custom baseUrl precedence', () => {
  const staleOfficialHints = {
    provider: 'openai-compatible' as const,
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://proxy.example.test/v1',
    model: 'gpt-5.4',
    presetId: 'openai' as const,
    providerName: 'OpenAI',
    webSearch: 'provider' as const,
    zeroDataRetention: true,
  }

  const normalized = normalizeAssistantProviderConfig(staleOfficialHints)
  if (normalized.target.kind !== 'openai-compatible') {
    throw new TypeError('expected a custom OpenAI-compatible target')
  }
  assert.equal(normalized.target.kind, 'openai-compatible')
  assert.equal(normalized.target.presetId, null)
  assert.equal(normalized.policy.zeroDataRetention, null)

  const persistedTarget = sanitizeAssistantBackendTargetForPersistence({
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://proxy.example.test/v1',
    headers: null,
    model: 'gpt-5.4',
    presetId: 'openai',
    providerName: 'OpenAI',
    reasoningEffort: 'high',
    webSearch: null,
  })
  assert.deepEqual(persistedTarget, {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://proxy.example.test/v1',
    headers: null,
    model: 'gpt-5.4',
    presetId: null,
    providerName: 'OpenAI',
    reasoningEffort: 'high',
    webSearch: null,
  })

  const runtimeTarget = resolveAssistantRuntimeTarget(staleOfficialHints)
  assert.equal(runtimeTarget.executionDriver, 'openai-compatible')
  assert.equal(runtimeTarget.presetId, null)
  assert.equal(runtimeTarget.resumeKind, null)
  assert.equal(runtimeTarget.supportsProviderWebSearch, false)

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
  })

  assert.equal(parsedSession.providerOptions.executionDriver, 'openai-compatible')
  assert.equal(parsedSession.providerOptions.resumeKind, null)
  assert.equal(parsedSession.providerOptions.presetId, null)
})

test('assistant runtime target keeps insecure official-lookalike urls off trusted responses paths', () => {
  for (const baseUrl of [
    'http://api.openai.com/v1',
    'http://ai-gateway.vercel.sh/v1',
  ]) {
    const runtimeTarget = resolveAssistantRuntimeTarget({
      apiKeyEnv: baseUrl.includes('vercel')
        ? 'VERCEL_AI_API_KEY'
        : 'OPENAI_API_KEY',
      baseUrl,
      model: 'gpt-5.4',
      presetId: baseUrl.includes('vercel')
        ? 'vercel-ai-gateway'
        : 'openai',
      provider: 'openai-compatible',
      providerName: baseUrl.includes('vercel')
        ? 'vercel-ai-gateway'
        : 'openai',
    })

    assert.equal(runtimeTarget.executionDriver, 'openai-compatible')
    assert.equal(runtimeTarget.presetId, null)
    assert.equal(runtimeTarget.resumeKind, null)
  }
})
