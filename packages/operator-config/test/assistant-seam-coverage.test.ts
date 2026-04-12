import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assistantModelTargetsEqual,
  assistantModelTargetToProviderConfigInput,
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
  normalizeAssistantModelTarget,
  sanitizeAssistantBackendTargetForPersistence,
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
  getOpenAICompatibleProviderPreset,
  isOpenAICompatibleProviderPresetId,
  listNamedOpenAICompatibleProviderPresets,
  listOpenAICompatibleProviderPresets,
  resolveOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPresetFromApiKeyEnv,
  resolveOpenAICompatibleProviderPresetFromBaseUrl,
  resolveOpenAICompatibleProviderPresetFromId,
  resolveOpenAICompatibleProviderPresetFromProviderName,
  resolveOpenAICompatibleProviderTitle,
} from '../src/assistant/openai-compatible-provider-presets.ts'
import {
  assistantProviderConfigsEqual,
  compactAssistantProviderConfigInput,
  inferAssistantProviderFromConfigInput,
  mergeAssistantProviderConfigs,
  mergeAssistantProviderConfigsForProvider,
  normalizeAssistantHeaders,
  normalizeAssistantPersistedHeaders,
  normalizeAssistantProviderConfig,
  resolveAssistantProviderRuntimeTarget,
  resolveAssistantProvider,
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
import { isValidAssistantOpaqueId } from '../src/assistant/state-ids.ts'

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

test('assistant backend helpers cover null, codex, and openai-compatible persistence branches', () => {
  assert.deepEqual(createDefaultLocalAssistantModelTarget(), {
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: null,
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })

  assert.equal(createAssistantModelTarget(null), null)
  assert.equal(
    createAssistantModelTarget({
      provider: 'openai-compatible',
      headers: {},
    }),
    null,
  )
  assert.equal(normalizeAssistantModelTarget(null), null)
  assert.equal(normalizeAssistantModelTarget({ adapter: 'missing' }), null)

  const codexTarget = createAssistantModelTarget({
    provider: 'codex-cli',
    codexHome: ' /tmp/codex ',
  })
  assert.deepEqual(codexTarget, {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    codexHome: '/tmp/codex',
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: null,
  })
  assert.deepEqual(sanitizeAssistantModelTargetForPersistence(codexTarget), codexTarget)
  assert.equal(sanitizeAssistantModelTargetForPersistence(null), null)

  const openAiTarget = createAssistantModelTarget({
    provider: 'openai-compatible',
    apiKeyEnv: ' OPENAI_API_KEY ',
    baseUrl: ' https://api.openai.com/v1 ',
    headers: {
      authorization: 'Bearer top-secret-token',
      'x-trace-id': ' trace-123 ',
    },
    model: ' gpt-5 ',
    providerName: ' OpenAI ',
    reasoningEffort: ' high ',
  })
  const gatewayTarget = createAssistantModelTarget({
    provider: 'openai-compatible',
    apiKeyEnv: ' VERCEL_AI_API_KEY ',
    baseUrl: ' https://ai-gateway.vercel.sh/v1 ',
    model: ' openai/gpt-5.4 ',
    providerName: ' vercel-ai-gateway ',
    zeroDataRetention: true,
  })

  assert.deepEqual(sanitizeAssistantModelTargetForPersistence(openAiTarget), {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1',
    headers: {
      'X-Trace-Id': 'trace-123',
    },
    model: 'gpt-5',
    presetId: null,
    providerName: 'OpenAI',
    reasoningEffort: 'high',
    webSearch: null,
  })
  assert.deepEqual(assistantModelTargetToProviderConfigInput(codexTarget), {
    approvalPolicy: null,
    codexCommand: null,
    codexHome: '/tmp/codex',
    model: null,
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    sandbox: null,
  })
  assert.deepEqual(sanitizeAssistantModelTargetForPersistence(gatewayTarget), {
    adapter: 'openai-compatible',
    apiKeyEnv: 'VERCEL_AI_API_KEY',
    endpoint: 'https://ai-gateway.vercel.sh/v1',
    headers: null,
    model: 'openai/gpt-5.4',
    presetId: null,
    providerName: 'vercel-ai-gateway',
    reasoningEffort: null,
    webSearch: null,
    zeroDataRetention: true,
  })
  assert.equal(
    assistantModelTargetsEqual(codexTarget, {
      adapter: 'codex-cli',
      approvalPolicy: null,
      codexCommand: null,
      codexHome: ' /tmp/codex ',
      model: null,
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
    }),
    true,
  )
  assert.equal(
    assistantModelTargetsEqual(codexTarget, {
      adapter: 'codex-cli',
      approvalPolicy: codexTarget.approvalPolicy,
      codexCommand: codexTarget.codexCommand,
      codexHome: '/tmp/other-codex',
      model: codexTarget.model,
      oss: codexTarget.oss,
      profile: codexTarget.profile,
      reasoningEffort: codexTarget.reasoningEffort,
      sandbox: codexTarget.sandbox,
    }),
    false,
  )
  assert.deepEqual(
    normalizeAssistantModelTarget({
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.openai.com/v1',
      headers: null,
      model: 'gpt-5',
      providerName: 'OpenAI',
      reasoningEffort: 'invalid',
    }),
    null,
  )
  assert.deepEqual(
    normalizeAssistantModelTarget({
      adapter: 'codex-cli',
      approvalPolicy: null,
      codexCommand: null,
      codexHome: null,
      model: null,
      oss: true,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
    }),
    {
      adapter: 'codex-cli',
      approvalPolicy: null,
      codexCommand: null,
      model: null,
      oss: true,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: null,
    },
  )
})

test('assistant provider helpers cover null inference and empty header canonicalization branches', () => {
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
  assert.deepEqual(
    normalizeAssistantProviderConfig({
      provider: 'openai-compatible',
      baseUrl: ' https://example.test/v1 ',
      headers: { ' --- ': 'value' },
    }),
    {
      approvalPolicy: null,
      apiKeyEnv: null,
      baseUrl: 'https://example.test/v1',
      codexCommand: null,
      codexHome: null,
      headers: {
        '': 'value',
      },
      model: null,
      oss: false,
      presetId: null,
      profile: null,
      provider: 'openai-compatible',
      providerName: null,
      reasoningEffort: null,
      sandbox: null,
      webSearch: null,
      zeroDataRetention: null,
    },
  )
  assert.deepEqual(
    mergeAssistantProviderConfigs(null, { model: ' gpt-5 ' }),
    {
      approvalPolicy: null,
      apiKeyEnv: null,
      baseUrl: null,
      codexCommand: null,
      codexHome: null,
      headers: null,
      model: 'gpt-5',
      oss: false,
      presetId: null,
      profile: null,
      provider: 'codex-cli',
      providerName: null,
      reasoningEffort: 'medium',
      sandbox: null,
      webSearch: null,
      zeroDataRetention: null,
    },
  )
  assert.deepEqual(
    mergeAssistantProviderConfigsForProvider('openai-compatible', null, {
      providerName: ' Example ',
    }),
    {
      approvalPolicy: null,
      apiKeyEnv: null,
      baseUrl: null,
      codexCommand: null,
      codexHome: null,
      headers: null,
      model: null,
      oss: false,
      presetId: null,
      profile: null,
      provider: 'openai-compatible',
      providerName: 'Example',
      reasoningEffort: null,
      sandbox: null,
      webSearch: null,
      zeroDataRetention: null,
    },
  )
  assert.deepEqual(
    serializeAssistantProviderSessionOptions({ provider: 'codex-cli', model: 'gpt-5' }),
    {
      continuityFingerprint: resolveAssistantProviderRuntimeTarget({
        provider: 'codex-cli',
        model: 'gpt-5',
      }).continuityFingerprint,
      executionDriver: 'codex-cli',
      approvalPolicy: null,
      model: 'gpt-5',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      resumeKind: 'codex-session',
      sandbox: null,
    },
  )
  assert.deepEqual(
    serializeAssistantProviderOperatorDefaults({ provider: 'codex-cli', model: 'gpt-5' }),
    {
      approvalPolicy: null,
      apiKeyEnv: null,
      baseUrl: null,
      codexCommand: null,
      codexHome: null,
      headers: null,
      model: 'gpt-5',
      oss: false,
      presetId: null,
      profile: null,
      providerName: null,
      reasoningEffort: 'medium',
      sandbox: null,
      webSearch: null,
      zeroDataRetention: null,
    },
  )
  assert.equal(
    assistantProviderConfigsEqual({ provider: 'codex-cli', model: 'gpt-5' }, null),
    false,
  )
  assert.equal(
    shouldUseAssistantOpenAIResponsesApi({ provider: 'codex-cli', model: 'gpt-5' }),
    false,
  )
  assert.equal(
    supportsAssistantReasoningEffort({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      presetId: 'openai',
    }),
    true,
  )
  assert.equal(
    supportsAssistantZeroDataRetention({
      provider: 'openai-compatible',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      presetId: 'vercel-ai-gateway',
      zeroDataRetention: true,
    }),
    true,
  )
})

test('openai-compatible provider preset helpers resolve aliases, fallbacks, and non-matches', () => {
  const allPresets = listOpenAICompatibleProviderPresets()
  const namedPresets = listNamedOpenAICompatibleProviderPresets()

  assert.equal(allPresets.some((preset) => preset.id === 'custom'), true)
  assert.equal(namedPresets.some((preset) => preset.id === 'custom'), false)
  assert.equal(getOpenAICompatibleProviderPreset('custom').id, 'custom')
  assert.equal(getOpenAICompatibleProviderPreset('missing' as never).id, 'custom')
  assert.equal(isOpenAICompatibleProviderPresetId('openai'), true)
  assert.equal(isOpenAICompatibleProviderPresetId('unknown'), false)
  assert.equal(resolveOpenAICompatibleProviderPresetFromId('openrouter')?.id, 'openrouter')
  assert.equal(
    resolveOpenAICompatibleProviderPresetFromId('vercel-ai-gateway')?.id,
    'vercel-ai-gateway',
  )
  assert.equal(resolveOpenAICompatibleProviderPresetFromId('unknown'), null)
  assert.equal(
    resolveOpenAICompatibleProviderPresetFromProviderName(' Hugging Face ' )?.id,
    'huggingface',
  )
  assert.equal(resolveOpenAICompatibleProviderPresetFromProviderName(''), null)
  assert.equal(resolveOpenAICompatibleProviderPresetFromApiKeyEnv(' ngc_api_key ')?.id, 'nvidia')
  assert.equal(
    resolveOpenAICompatibleProviderPresetFromApiKeyEnv(' vercel_ai_api_key ')?.id,
    'vercel-ai-gateway',
  )
  assert.equal(resolveOpenAICompatibleProviderPresetFromApiKeyEnv(' ai_gateway_api_key '), null)
  assert.equal(resolveOpenAICompatibleProviderPresetFromApiKeyEnv('missing'), null)
  assert.equal(resolveOpenAICompatibleProviderPresetFromBaseUrl('https://openrouter.ai/api/v1/chat/completions')?.id, 'openrouter')
  assert.equal(
    resolveOpenAICompatibleProviderPresetFromBaseUrl('https://ai-gateway.vercel.sh/v1/chat/completions')?.id,
    'vercel-ai-gateway',
  )
  assert.equal(resolveOpenAICompatibleProviderPresetFromBaseUrl('http://localhost:11434/api/tags')?.id, 'ollama')
  assert.equal(resolveOpenAICompatibleProviderPresetFromBaseUrl('http://localhost:9999/v1'), null)
  assert.equal(resolveOpenAICompatibleProviderPresetFromBaseUrl('not a url'), null)
  assert.equal(
    resolveOpenAICompatibleProviderPreset({
      baseUrl: 'https://router.huggingface.co/v1',
      providerName: 'OpenAI',
      apiKeyEnv: 'OPENAI_API_KEY',
    })?.id,
    'huggingface',
  )
  assert.equal(
    resolveOpenAICompatibleProviderPreset({
      providerName: 'lite llm',
    })?.id,
    'litellm',
  )
  assert.equal(
    resolveOpenAICompatibleProviderPreset({
      providerName: 'vercel ai gateway',
    })?.id,
    'vercel-ai-gateway',
  )
  assert.equal(
    resolveOpenAICompatibleProviderPreset({
      apiKeyEnv: 'OPENAI_API_KEY',
    })?.id,
    'openai',
  )
  assert.equal(resolveOpenAICompatibleProviderPreset({ providerName: 'missing' }), null)
  assert.equal(resolveOpenAICompatibleProviderTitle({ providerName: 'lm studio' }), 'LM Studio')
  assert.equal(resolveOpenAICompatibleProviderTitle({ providerName: 'missing' }), null)
})

test('hosted assistant config helpers reject invalid profiles and normalize sparse fallbacks', () => {
  assert.throws(
    () =>
      createHostedAssistantProfile({
        id: 'bad-profile',
        providerConfig: {
          provider: 'codex-cli',
          profile: 'default',
        },
      }),
    /OpenAI-compatible target/u,
  )

  const customProfile = createHostedAssistantProfile({
    id: ' custom-profile ',
    providerConfig: {
      provider: 'openai-compatible',
      baseUrl: ' not a valid url ',
      model: ' gpt-5 ',
    },
  })
  assert.equal(customProfile.label, 'not a valid url')

  const hostedConfig = createHostedAssistantConfig({
    activeProfileId: null,
    profiles: [customProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })
  const emptyHostedConfig = createHostedAssistantConfig({
    activeProfileId: null,
    profiles: [],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  assert.deepEqual(resolveHostedAssistantActiveProfile(hostedConfig), customProfile)
  assert.equal(resolveHostedAssistantActiveProfile(emptyHostedConfig), null)
  assert.equal(
    resolveHostedAssistantProfileLabel({
      providerName: '  ',
    }),
    'Hosted assistant profile',
  )
  assert.equal(
    hostedAssistantProfilesEqual(customProfile, null),
    false,
  )
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
  assert.equal(
    normalizeHostedAssistantConfig({
      schema: 'murph.hosted-assistant-config.v1',
      activeProfileId: null,
      updatedAt: '2026-04-08T10:00:00.000Z',
      extra: true,
    } as never)?.profiles.length,
    0,
  )
  const fallbackNormalized = normalizeHostedAssistantConfig({
    schema: 'murph.hosted-assistant-config.v1',
    activeProfileId: 'custom-profile',
    updatedAt: '2026-04-08T10:00:00.000Z',
    extra: true,
    profiles: [customProfile],
  } as never)
  assert.deepEqual(resolveHostedAssistantActiveProfile(fallbackNormalized), customProfile)
  assert.equal(
    normalizeHostedAssistantConfig({
      schema: 'murph.hosted-assistant-config.v1',
      activeProfileId: null,
      profiles: [
        {
          id: 'bad',
          label: 'Bad',
          managedBy: 'member',
          target: {
            adapter: 'codex-cli',
            profile: 'default',
          },
        },
      ],
      updatedAt: '2026-04-08T10:00:00.000Z',
    } as never),
    null,
  )
  assert.equal(
    normalizeHostedAssistantConfig({
      schema: 'murph.hosted-assistant-config.v1',
      activeProfileId: 'custom-profile',
      updatedAt: '2026-04-08T10:00:00.000Z',
      profiles: [{ bad: true }],
      extra: true,
    } as never),
    null,
  )
  assert.throws(
    () =>
      createHostedAssistantProfile({
        id: '   ',
        providerConfig: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5',
        },
      }),
    /profile id is required/u,
  )
})
