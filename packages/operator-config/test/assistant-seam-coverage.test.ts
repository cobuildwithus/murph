import assert from 'node:assert/strict'

import { test } from 'vitest'

import { isValidAssistantOpaqueId } from '@murphai/runtime-state/assistant-ids'
import {
  assistantModelTargetsEqual,
  assistantModelTargetToProviderConfigInput,
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
  normalizeAssistantModelTarget,
  sanitizeAssistantModelTargetForPersistence,
} from '../src/assistant-backend.ts'
import {
  createHostedAssistantConfig,
  createHostedAssistantProfile,
  hostedAssistantConfigsEqual,
  hostedAssistantProfilesEqual,
  normalizeHostedAssistantConfig,
  resolveHostedAssistantActiveProfile,
  resolveHostedAssistantProfileLabel,
} from '../src/assistant/hosted-config.ts'
import {
  assistantProviderConfigsEqual,
  compactAssistantProviderConfigInput,
  inferAssistantProviderFromConfigInput,
  mergeAssistantProviderConfigs,
  mergeAssistantProviderConfigsForProvider,
  normalizeAssistantHeaders,
  normalizeAssistantPersistedHeaders,
  normalizeAssistantProviderConfig,
  resolveAssistantChatProviderFromConfig,
  resolveAssistantProvider,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
  shouldUseAssistantOpenAIResponsesApi,
  supportsAssistantReasoningEffort,
  supportsAssistantZeroDataRetention,
} from '../src/assistant/provider-config.ts'
import {
  splitAssistantHeadersForPersistence,
} from '../src/assistant/redaction.ts'
import {
  isAssistantOpenAIBaseUrl,
  isAssistantVercelAIGatewayBaseUrl,
  readAssistantEnvString,
} from '../src/assistant/shared.ts'
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
} from '../src/assistant/target-runtime.ts'

test('assistant shared and state-id helpers handle empty, invalid, and valid inputs', () => {
  const nonStringEnv = { ...process.env }
  Object.defineProperty(nonStringEnv, 'OPENAI_API_KEY', {
    configurable: true,
    enumerable: true,
    value: 123,
  })

  assert.equal(readAssistantEnvString({ OPENAI_API_KEY: '  key  ' }, ' OPENAI_API_KEY '), 'key')
  assert.equal(readAssistantEnvString({ OPENAI_API_KEY: '' }, 'OPENAI_API_KEY'), null)
  assert.equal(readAssistantEnvString({ OPENAI_API_KEY: 'key' }, '  '), null)
  assert.equal(readAssistantEnvString(nonStringEnv, 'OPENAI_API_KEY'), null)

  assert.equal(isAssistantOpenAIBaseUrl(' https://api.openai.com/v1 '), true)
  assert.equal(
    isAssistantVercelAIGatewayBaseUrl(' https://ai-gateway.vercel.sh/v1 '),
    true,
  )
  assert.equal(isAssistantOpenAIBaseUrl('   '), false)
  assert.equal(isAssistantOpenAIBaseUrl('http://api.openai.com/v1'), false)
  assert.equal(isAssistantOpenAIBaseUrl('https://example.test/v1'), false)
  assert.equal(isAssistantOpenAIBaseUrl('not a url'), false)

  assert.equal(isValidAssistantOpaqueId('opaque_id-123'), true)
  assert.equal(isValidAssistantOpaqueId(' bad id '), false)
  assert.equal(isValidAssistantOpaqueId('-bad-prefix'), false)
  assert.equal(isValidAssistantOpaqueId(null), false)
})

test('assistant backend helpers cover Codex persistence branches and legacy fail-closed input', () => {
  assert.deepEqual(createDefaultLocalAssistantModelTarget(), {
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: null,
    model: null,
    modelProvider: null,
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })

  assert.equal(createAssistantModelTarget(null), null)
  assert.equal(normalizeAssistantModelTarget(null), null)
  assert.equal(normalizeAssistantModelTarget({ adapter: 'missing' }), null)

  const codexTarget = createAssistantModelTarget({
    provider: 'codex-cli',
    codexHome: ' /tmp/codex ',
    modelProvider: ' Vercel-AI-Gateway ',
  })
  assert.deepEqual(codexTarget, {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    codexHome: '/tmp/codex',
    model: null,
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: null,
  })
  assert.deepEqual(sanitizeAssistantModelTargetForPersistence(codexTarget), codexTarget)
  assert.equal(sanitizeAssistantModelTargetForPersistence(null), null)
  assert.deepEqual(assistantModelTargetToProviderConfigInput(codexTarget), {
    approvalPolicy: null,
    codexCommand: null,
    codexHome: '/tmp/codex',
    model: null,
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    sandbox: null,
  })
  assert.equal(
    assistantModelTargetsEqual(codexTarget, {
      adapter: 'codex-cli',
      approvalPolicy: null,
      codexCommand: null,
      codexHome: ' /tmp/codex ',
      model: null,
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
    }),
    true,
  )
  assert.throws(
    () =>
      createAssistantModelTarget({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5',
      }),
    /OpenAI-compatible assistant runtimes are no longer supported/u,
  )
})

test('assistant provider helpers cover Codex inference and serialization branches', () => {
  assert.equal(resolveAssistantProvider(null), 'codex-cli')
  assert.equal(inferAssistantProviderFromConfigInput({}), null)
  assert.equal(compactAssistantProviderConfigInput(null), null)
  assert.equal(compactAssistantProviderConfigInput({ provider: null }), null)
  assert.deepEqual(normalizeAssistantHeaders({ ' --- ': 'value', 'x-empty': '   ' }), {
    '': 'value',
  })
  assert.deepEqual(normalizeAssistantPersistedHeaders(null), null)
  assert.deepEqual(splitAssistantHeadersForPersistence({ 'X-Trace-Id': 'trace-123' }), {
    persistedHeaders: { 'X-Trace-Id': 'trace-123' },
    secretHeaders: null,
  })

  const mergedCodex = mergeAssistantProviderConfigs(null, {
    provider: 'codex-cli',
    model: ' gpt-5.5 ',
    modelProvider: ' Vercel-AI-Gateway ',
  })
  assert.deepEqual(mergedCodex, {
    policy: {
      approvalPolicy: null,
      reasoningEffort: 'medium',
      sandbox: null,
      webSearch: null,
      zeroDataRetention: null,
    },
    target: {
      kind: 'codex-cli',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      oss: false,
      profile: null,
    },
  })
  assert.equal(resolveAssistantChatProviderFromConfig(mergedCodex), 'codex-cli')
  assert.deepEqual(
    mergeAssistantProviderConfigsForProvider('codex-cli', null, {
      profile: ' hosted ',
    }).target,
    {
      kind: 'codex-cli',
      codexCommand: null,
      codexHome: null,
      model: null,
      modelProvider: null,
      modelProviderConfig: null,
      oss: false,
      profile: 'hosted',
    },
  )
  assert.deepEqual(serializeAssistantProviderSessionOptions(mergedCodex), {
    continuityFingerprint: resolveAssistantProviderRuntimeTarget(mergedCodex)
      .continuityFingerprint,
    executionDriver: 'codex-app-server',
    approvalPolicy: null,
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    resumeKind: 'codex-thread',
    sandbox: null,
  })
  assert.deepEqual(serializeAssistantProviderOperatorDefaults(mergedCodex), {
    approvalPolicy: null,
    apiKeyEnv: null,
    baseUrl: null,
    codexCommand: null,
    codexHome: null,
    headers: null,
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
    oss: false,
    presetId: null,
    profile: null,
    providerName: null,
    reasoningEffort: 'medium',
    sandbox: null,
    webSearch: null,
    zeroDataRetention: null,
  })
  assert.equal(
    assistantProviderConfigsEqual({ provider: 'codex-cli', model: 'gpt-5' }, null),
    false,
  )
  assert.equal(shouldUseAssistantOpenAIResponsesApi(mergedCodex), false)
  assert.equal(supportsAssistantReasoningEffort(mergedCodex), true)
  assert.equal(supportsAssistantZeroDataRetention(mergedCodex), false)
  assert.throws(
    () =>
      normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
      }),
    /OpenAI-compatible assistant runtimes are no longer supported/u,
  )
})

test('hosted assistant config helpers normalize Codex profiles and sparse fallbacks', () => {
  assert.throws(
    () =>
      createHostedAssistantProfile({
        id: 'bad-profile',
        providerConfig: {
          provider: 'openai-compatible',
          model: 'gpt-5',
        },
      }),
    /OpenAI-compatible assistant runtimes are no longer supported/u,
  )

  const codexProfile = createHostedAssistantProfile({
    id: ' codex-profile ',
    providerConfig: {
      provider: 'codex-cli',
      model: ' gpt-5.5 ',
      modelProvider: ' vercel-ai-gateway ',
    },
  })
  assert.equal(codexProfile.label, 'Vercel AI Gateway')

  const hostedConfig = createHostedAssistantConfig({
    activeProfileId: null,
    profiles: [codexProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })
  const emptyHostedConfig = createHostedAssistantConfig({
    activeProfileId: null,
    profiles: [],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  assert.deepEqual(resolveHostedAssistantActiveProfile(hostedConfig), codexProfile)
  assert.equal(resolveHostedAssistantActiveProfile(emptyHostedConfig), null)
  assert.equal(resolveHostedAssistantProfileLabel({ provider: 'codex-cli' }), 'Codex App Server')
  assert.equal(hostedAssistantProfilesEqual(codexProfile, null), false)
  assert.equal(hostedAssistantProfilesEqual(null, null), true)
  assert.equal(resolveHostedAssistantActiveProfile(null), null)
  assert.equal(
    hostedAssistantConfigsEqual(
      normalizeHostedAssistantConfig({
        schema: 'murph.hosted-assistant-config.v1',
        activeProfileId: null,
        profiles: [],
        updatedAt: '2026-04-08T10:00:00.000Z',
      }),
      null,
    ),
    false,
  )
  assert.equal(normalizeHostedAssistantConfig('not-an-object' as never), null)
  assert.equal(
    normalizeHostedAssistantConfig({
      schema: 'murph.hosted-assistant-config.v1',
      activeProfileId: null,
      profiles: {},
      updatedAt: '2026-04-08T10:00:00.000Z',
    } as never),
    null,
  )
  assert.throws(
    () =>
      createHostedAssistantProfile({
        id: '   ',
        providerConfig: {
          provider: 'codex-cli',
          model: 'gpt-5.5',
          modelProvider: 'vercel-ai-gateway',
        },
      }),
    /profile id is required/u,
  )
})
