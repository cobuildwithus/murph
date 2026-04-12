import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assistantStatusAutomationSchema,
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  normalizeAssistantExecutionDriver,
  normalizeAssistantResumeKind,
  normalizeAssistantWebSearchMode,
  resolveAssistantRuntimeTarget,
  resolveAssistantTargetPresetId,
  shouldAssistantTargetUseGatewayWebSearch,
  shouldAssistantTargetUseMurphWebSearch,
  shouldAssistantTargetUseProviderWebSearch,
} from '../src/assistant/target-runtime.ts'

test('assistant target runtime resolves drivers, namespaces, and web-search fallbacks', () => {
  assert.equal(normalizeAssistantExecutionDriver(' gateway '), 'gateway')
  assert.equal(normalizeAssistantExecutionDriver('unknown'), null)
  assert.equal(normalizeAssistantResumeKind(' openai-response-id '), 'openai-response-id')
  assert.equal(normalizeAssistantResumeKind('invalid'), null)
  assert.equal(normalizeAssistantWebSearchMode(' provider '), 'provider')
  assert.equal(normalizeAssistantWebSearchMode('invalid'), null)

  assert.equal(
    resolveAssistantTargetPresetId({
      presetId: null,
    }),
    null,
  )
  assert.equal(
    resolveAssistantTargetPresetId({
      presetId: 'openrouter',
    }),
    'openrouter',
  )
  assert.equal(
    resolveAssistantTargetPresetId({
      presetId: null,
    }),
    null,
  )

  const codexTarget = resolveAssistantRuntimeTarget({
    provider: 'codex-cli',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    webSearch: 'murph',
  })
  assert.equal(codexTarget.executionDriver, 'codex-cli')
  assert.equal(codexTarget.resumeKind, 'codex-session')
  assert.equal(codexTarget.supportsNativeResume, true)
  assert.equal(shouldAssistantTargetUseMurphWebSearch({ provider: 'codex-cli', webSearch: 'murph' }), true)

  const explicitOpenAiTargetInput = {
    provider: 'openai-compatible' as const,
    presetId: 'openai' as const,
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.example.test/v1',
    headers: {
      'X-Trace-Id': 'trace',
    },
    model: 'gpt-5.4',
    providerName: 'OpenAI',
    reasoningEffort: 'high',
  }
  const openAiTarget = resolveAssistantRuntimeTarget(explicitOpenAiTargetInput)
  assert.equal(openAiTarget.executionDriver, 'openai-responses')
  assert.equal(openAiTarget.resumeKind, 'openai-response-id')
  assert.equal(openAiTarget.supportsProviderWebSearch, true)
  assert.equal(openAiTarget.supportsReasoningEffort, true)
  assert.equal(shouldAssistantTargetUseProviderWebSearch(explicitOpenAiTargetInput), true)
  assert.equal(
    shouldAssistantTargetUseMurphWebSearch({
      ...explicitOpenAiTargetInput,
      webSearch: 'off',
    }),
    false,
  )

  const unlabeledCompatibleTarget = resolveAssistantRuntimeTarget({
    provider: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.example.test/v1',
    model: 'gpt-5.4',
    providerName: 'OpenAI',
  })
  assert.equal(unlabeledCompatibleTarget.executionDriver, 'openai-compatible')
  assert.equal(unlabeledCompatibleTarget.resumeKind, null)
  assert.equal(unlabeledCompatibleTarget.supportsProviderWebSearch, false)
  assert.equal(unlabeledCompatibleTarget.supportsReasoningEffort, false)

  const gatewayOpenAiInput = {
    provider: 'openai-compatible' as const,
    presetId: 'vercel-ai-gateway',
    baseUrl: 'https://gateway.internal.test/v1',
    model: 'openai/gpt-5.4',
    providerName: 'Vercel AI Gateway',
    webSearch: 'gateway',
    zeroDataRetention: true,
  }
  const gatewayOpenAi = resolveAssistantRuntimeTarget(gatewayOpenAiInput)
  assert.equal(gatewayOpenAi.executionDriver, 'gateway')
  assert.equal(gatewayOpenAi.resumeKind, 'openai-response-id')
  assert.equal(gatewayOpenAi.supportsGatewayWebSearch, true)
  assert.equal(gatewayOpenAi.supportsProviderWebSearch, true)
  assert.equal(gatewayOpenAi.supportsReasoningEffort, true)
  assert.equal(gatewayOpenAi.supportsZeroDataRetention, true)
  assert.equal(shouldAssistantTargetUseGatewayWebSearch(gatewayOpenAiInput), true)
  assert.equal(
    shouldAssistantTargetUseMurphWebSearch({
      ...gatewayOpenAiInput,
      webSearch: 'provider',
    }),
    false,
  )

  const gatewayAnthropicInput = {
    provider: 'openai-compatible' as const,
    presetId: 'vercel-ai-gateway' as const,
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    model: 'anthropic/claude-sonnet-4',
    webSearch: 'gateway',
  }
  const gatewayAnthropic = resolveAssistantRuntimeTarget(gatewayAnthropicInput)
  assert.equal(gatewayAnthropic.executionDriver, 'gateway')
  assert.equal(gatewayAnthropic.resumeKind, null)
  assert.equal(gatewayAnthropic.supportsProviderWebSearch, false)
  assert.equal(gatewayAnthropic.supportsReasoningEffort, false)
  assert.equal(shouldAssistantTargetUseGatewayWebSearch(gatewayAnthropicInput), true)

  const customCompatibleInput = {
    provider: 'openai-compatible' as const,
    presetId: 'custom',
    baseUrl: 'https://proxy.example.test/v1',
    providerName: '---',
    webSearch: 'provider',
  }
  const customCompatible = resolveAssistantRuntimeTarget(customCompatibleInput)
  assert.equal(customCompatible.executionDriver, 'openai-compatible')
  assert.equal(customCompatible.resumeKind, null)
  assert.equal(customCompatible.supportsProviderWebSearch, false)
  assert.equal(customCompatible.supportsGatewayWebSearch, false)
  assert.equal(shouldAssistantTargetUseProviderWebSearch(customCompatibleInput), false)
  assert.equal(shouldAssistantTargetUseMurphWebSearch(customCompatibleInput), true)

  const heuristicGateway = resolveAssistantRuntimeTarget({
    provider: 'openai-compatible',
    presetId: 'custom',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    model: 'model-without-slash',
  })
  assert.equal(heuristicGateway.executionDriver, 'openai-compatible')
  assert.equal(
    shouldAssistantTargetUseMurphWebSearch({
      provider: 'openai-compatible',
      presetId: 'custom',
      webSearch: 'gateway',
    }),
    true,
  )
})

test('assistant session parsing resolves runtime options from explicit target identity and status automation cursors', () => {
  const runtimeTarget = resolveAssistantRuntimeTarget({
    provider: 'openai-compatible',
    presetId: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    headers: {
      'X-Trace-Id': 'trace',
    },
    model: 'gpt-5.4',
    providerName: 'OpenAI',
    reasoningEffort: 'high',
    webSearch: 'provider',
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
      resumeState: null,
      schema: 'murph.assistant-session.v1',
      sessionId: 'session_runtime_v5',
      target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.openai.com/v1',
      headers: {
        'X-Trace-Id': 'trace',
      },
      model: 'gpt-5.4',
      presetId: 'openai',
      providerName: 'OpenAI',
      reasoningEffort: 'high',
      webSearch: 'provider',
    },
    turnCount: 2,
    updatedAt: '2026-04-08T12:05:00.000Z',
  })

  assert.equal(parsedSession.resumeState, null)
  assert.equal(parsedSession.providerBinding, null)
  assert.equal(parsedSession.providerOptions.continuityFingerprint, runtimeTarget.continuityFingerprint)
  assert.equal(parsedSession.providerOptions.executionDriver, 'openai-responses')
  assert.equal(parsedSession.providerOptions.resumeKind, 'openai-response-id')
  assert.equal(parsedSession.providerOptions.webSearch, 'provider')

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

  const preservedResumeContract = parseAssistantSessionRecord({
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
    sessionId: 'session_resume_contract',
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
  })
  const preservedRuntimeTarget = resolveAssistantRuntimeTarget({
    provider: 'openai-compatible',
    presetId: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
    providerName: 'OpenAI',
    reasoningEffort: 'high',
  })

  assert.equal(
    preservedResumeContract.providerBinding?.providerOptions.continuityFingerprint,
    preservedRuntimeTarget.continuityFingerprint,
  )
  assert.equal(
    preservedResumeContract.providerBinding?.providerOptions.resumeKind,
    'openai-response-id',
  )
})

test('assistant session parsing handles null resume state and resolves codex resume metadata from the target', () => {
  const codexRuntimeTarget = resolveAssistantRuntimeTarget({
    provider: 'codex-cli',
    approvalPolicy: 'on-request',
    codexHome: '/tmp/codex-home',
    model: 'gpt-5.4',
    oss: false,
    profile: 'default',
    reasoningEffort: 'medium',
    sandbox: 'workspace-write',
  })
  const sessionWithoutResumeState = parseAssistantSessionRecord({
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
    schema: 'murph.assistant-session.v1',
    sessionId: 'session_without_resume_state',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'on-request',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.4',
      oss: false,
      profile: 'default',
      reasoningEffort: 'medium',
      sandbox: 'workspace-write',
    },
    turnCount: 0,
    updatedAt: '2026-04-08T12:05:00.000Z',
  })

  assert.equal(sessionWithoutResumeState.resumeState, null)
  assert.equal(sessionWithoutResumeState.providerBinding, null)
  assert.equal(
    sessionWithoutResumeState.providerOptions.continuityFingerprint,
    codexRuntimeTarget.continuityFingerprint,
  )
  assert.equal(sessionWithoutResumeState.providerOptions.resumeKind, 'codex-session')

  const codexResumeContract = parseAssistantSessionRecord({
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
      providerSessionId: 'codex-session-123',
      resumeRouteId: null,
    },
    schema: 'murph.assistant-session.v1',
    sessionId: 'session_codex_resume_contract',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.4',
      oss: true,
      profile: 'oss',
      reasoningEffort: 'high',
      sandbox: 'danger-full-access',
    },
    turnCount: 1,
    updatedAt: '2026-04-08T12:05:00.000Z',
  })
  const codexResumeRuntimeTarget = resolveAssistantRuntimeTarget({
    provider: 'codex-cli',
    approvalPolicy: 'never',
    codexHome: '/tmp/codex-home',
    model: 'gpt-5.4',
    oss: true,
    profile: 'oss',
    reasoningEffort: 'high',
    sandbox: 'danger-full-access',
  })

  assert.equal(
    codexResumeContract.providerBinding?.providerOptions.continuityFingerprint,
    codexResumeRuntimeTarget.continuityFingerprint,
  )
  assert.equal(codexResumeContract.providerBinding?.providerOptions.resumeKind, 'codex-session')
  assert.equal(codexResumeContract.providerBinding?.providerSessionId, 'codex-session-123')
})
