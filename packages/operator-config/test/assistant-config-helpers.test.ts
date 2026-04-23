import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  createHostedAssistantConfig,
  createHostedAssistantProfile,
  hostedAssistantConfigsEqual,
  hostedAssistantProfilesEqual,
  hostedAssistantProfileToProviderConfigInput,
  normalizeHostedAssistantConfig,
  resolveHostedAssistantActiveProfile,
  resolveHostedAssistantProfileLabel,
  serializeHostedAssistantConfigForWrite,
} from '../src/assistant/hosted-config.ts'
import {
  assistantProviderConfigsEqual,
  compactAssistantProviderConfigInput,
  DEFAULT_MURPH_CODEX_REASONING_EFFORT,
  inferAssistantProviderFromConfigInput,
  mergeAssistantProviderConfigs,
  mergeAssistantProviderConfigsForProvider,
  normalizeAssistantHeaders,
  normalizeAssistantPersistedHeaders,
  normalizeAssistantProviderConfig,
  resolveAssistantChatProviderFromConfig,
  resolveAssistantProviderRuntimeTarget,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
  shouldUseAssistantOpenAIResponsesApi,
  supportsAssistantReasoningEffort,
  supportsAssistantZeroDataRetention,
} from '../src/assistant/provider-config.ts'
import {
  isSensitiveAssistantHeader,
  isSensitiveAssistantHeaderName,
  isSensitiveAssistantHeaderValue,
  mergeAssistantHeaders,
  splitAssistantHeadersForPersistence,
} from '../src/assistant/redaction.ts'

test('assistant header helpers canonicalize, dedupe, sort, and redact persistence-unsafe values', () => {
  const normalizedHeaders = normalizeAssistantHeaders({
    authorization: 'Bearer kept-secret-value',
    'x-api-key': 'opaque-api-key',
    'x-custom-token': 'custom-token',
    'x-empty': '   ',
    'x-trace-id': ' trace-id ',
    'x-zeta': 'z',
    'X-Trace-Id': 'replacement-trace-id',
    ' x-user ': '  user-123  ',
  })

  assert.deepEqual(normalizedHeaders, {
    Authorization: 'Bearer kept-secret-value',
    'X-Api-Key': 'opaque-api-key',
    'X-Custom-Token': 'custom-token',
    'X-Trace-Id': 'replacement-trace-id',
    'X-User': 'user-123',
    'X-Zeta': 'z',
  })
  assert.equal(isSensitiveAssistantHeaderName('x-api-key'), true)
  assert.equal(isSensitiveAssistantHeaderName('x-custom-token'), true)
  assert.equal(isSensitiveAssistantHeaderName('x-trace-id'), false)
  assert.equal(isSensitiveAssistantHeader('x-trace-id', 'Bearer secret-token-1234'), true)
  assert.equal(isSensitiveAssistantHeaderValue('Bearer secret-token-1234'), true)
  assert.equal(isSensitiveAssistantHeaderValue('Basic second-secret-4567'), true)
  assert.equal(isSensitiveAssistantHeaderValue('Bearer third-secret-8901'), true)
  assert.equal(isSensitiveAssistantHeaderValue('trace-id-1234'), false)
  const split = splitAssistantHeadersForPersistence(normalizedHeaders)
  assert.deepEqual(split, {
    persistedHeaders: {
      'X-Trace-Id': 'replacement-trace-id',
      'X-User': 'user-123',
      'X-Zeta': 'z',
    },
    secretHeaders: {
      Authorization: 'Bearer kept-secret-value',
      'X-Api-Key': 'opaque-api-key',
      'X-Custom-Token': 'custom-token',
    },
  })
  assert.deepEqual(
    mergeAssistantHeaders(split.persistedHeaders, split.secretHeaders),
    normalizedHeaders,
  )
  assert.deepEqual(normalizeAssistantPersistedHeaders(normalizedHeaders), {
    'X-Trace-Id': 'replacement-trace-id',
    'X-User': 'user-123',
    'X-Zeta': 'z',
  })
})

test('assistant provider config helpers infer, merge, compact, and serialize by provider', () => {
  assert.equal(
    inferAssistantProviderFromConfigInput({
      baseUrl: ' https://api.example.test/v1 ',
      model: 'gpt-4.1',
    }),
    null,
  )
  assert.equal(
    inferAssistantProviderFromConfigInput({
      approvalPolicy: 'never',
      profile: ' default ',
    }),
    null,
  )

  const mergedOpenAiInputs = [
    {
      provider: 'codex-cli',
      approvalPolicy: 'on-request',
      codexHome: ' /tmp/codex ',
      model: ' codex-model ',
    },
    {
      provider: 'openai-compatible',
      apiKeyEnv: ' OPENAI_API_KEY ',
      baseUrl: ' https://api.openai.com/v1 ',
      headers: {
        authorization: 'Bearer secret-value-1234',
        'x-trace-id': ' trace-id ',
      },
      providerName: ' OpenAI ',
      reasoningEffort: ' high ',
    },
  ] as const
  const mergedOpenAi = mergeAssistantProviderConfigs(...mergedOpenAiInputs)
  const mergedOpenAiInput = {
    provider: 'openai-compatible',
    model: ' codex-model ',
    apiKeyEnv: ' OPENAI_API_KEY ',
    baseUrl: ' https://api.openai.com/v1 ',
    headers: {
      authorization: 'Bearer secret-value-1234',
      'x-trace-id': ' trace-id ',
    },
    providerName: ' OpenAI ',
    reasoningEffort: ' high ',
  } as const

  assert.deepEqual(
    {
      policy: mergedOpenAi.policy,
      target: mergedOpenAi.target,
    },
    {
      policy: {
        approvalPolicy: null,
        reasoningEffort: 'high',
        sandbox: null,
        webSearch: null,
        zeroDataRetention: null,
      },
      target: {
        kind: 'responses',
        via: 'openai',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        gatewayOnlyProviders: null,
        headers: {
          Authorization: 'Bearer secret-value-1234',
          'X-Trace-Id': 'trace-id',
        },
        model: 'codex-model',
        presetId: 'openai',
        providerName: 'OpenAI',
      },
    },
  )
  assert.equal(resolveAssistantChatProviderFromConfig(mergedOpenAi), 'openai-compatible')
  const mergedOpenAiRuntime = resolveAssistantProviderRuntimeTarget(mergedOpenAi)
  assert.deepEqual(serializeAssistantProviderSessionOptions(mergedOpenAiInput), {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    continuityFingerprint: mergedOpenAiRuntime.continuityFingerprint,
    executionDriver: 'responses',
    headers: {
      Authorization: 'Bearer secret-value-1234',
      'X-Trace-Id': 'trace-id',
    },
    model: 'codex-model',
    oss: false,
    presetId: 'openai',
    profile: null,
    provider: 'openai-compatible',
    providerName: 'OpenAI',
    reasoningEffort: 'high',
    resumeKind: 'openai-response-id',
    sandbox: null,
    approvalPolicy: null,
  })
  assert.deepEqual(serializeAssistantProviderOperatorDefaults(mergedOpenAiInput), {
    approvalPolicy: null,
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    codexCommand: null,
    codexHome: null,
    headers: {
      'X-Trace-Id': 'trace-id',
    },
    model: 'codex-model',
    oss: false,
    presetId: 'openai',
    profile: null,
    providerName: 'OpenAI',
    reasoningEffort: 'high',
    sandbox: null,
    webSearch: null,
    zeroDataRetention: null,
  })
  assert.equal(shouldUseAssistantOpenAIResponsesApi(mergedOpenAi), true)
  assert.equal(supportsAssistantReasoningEffort(mergedOpenAi), true)
  assert.equal(supportsAssistantZeroDataRetention(mergedOpenAi), false)
  assert.deepEqual(
    compactAssistantProviderConfigInput({
      provider: 'openai-compatible',
      baseUrl: null,
      apiKeyEnv: undefined,
      providerName: 'Example',
    }),
    {
      provider: 'openai-compatible',
      providerName: 'Example',
    },
  )

  const mergedCodex = mergeAssistantProviderConfigsForProvider(
    'codex-cli',
    {
      approvalPolicy: 'never',
      codexCommand: ' codex ',
      oss: false,
      reasoningEffort: ' low ',
    },
    {
      codexHome: ' /tmp/home ',
      model: ' gpt-5 ',
      oss: true,
      profile: ' default ',
      sandbox: 'workspace-write',
    },
  )

  assert.deepEqual(
    {
      policy: mergedCodex.policy,
      target: mergedCodex.target,
    },
    {
      policy: {
        approvalPolicy: 'never',
        reasoningEffort: 'low',
        sandbox: 'workspace-write',
        webSearch: null,
        zeroDataRetention: null,
      },
      target: {
        kind: 'codex-cli',
        codexCommand: 'codex',
        codexHome: '/tmp/home',
        model: 'gpt-5',
        oss: true,
        profile: 'default',
      },
    },
  )
  assert.equal(resolveAssistantChatProviderFromConfig(mergedCodex), 'codex-cli')
  assert.equal(
    normalizeAssistantProviderConfig({ provider: 'codex-cli' }).policy.reasoningEffort,
    DEFAULT_MURPH_CODEX_REASONING_EFFORT,
  )
  assert.equal(
    assistantProviderConfigsEqual(
      {
        provider: 'codex-cli',
        profile: ' default ',
      },
      {
        profile: 'default',
      },
    ),
    true,
  )
  assert.equal(
    assistantProviderConfigsEqual(
      {
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      {
        profile: 'default',
      },
    ),
    false,
  )
  assert.equal(
    shouldUseAssistantOpenAIResponsesApi({
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      presetId: 'openai',
    }),
    false,
  )
  assert.equal(supportsAssistantReasoningEffort({ provider: 'codex-cli' }), true)
  assert.equal(
    supportsAssistantZeroDataRetention({
      provider: 'openai-compatible',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      presetId: 'vercel-ai-gateway',
      zeroDataRetention: true,
    }),
    true,
  )
  const normalizedStaleCompatiblePreset = normalizeAssistantProviderConfig({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    providerName: 'ollama',
    presetId: 'openrouter',
  })
  assert.notEqual(normalizedStaleCompatiblePreset.target.kind, 'codex-cli')
  if (normalizedStaleCompatiblePreset.target.kind === 'codex-cli') {
    throw new Error('Expected an OpenAI-compatible normalized provider target.')
  }
  assert.equal(normalizedStaleCompatiblePreset.target.presetId, 'ollama')
})

test('hosted assistant helpers normalize equality, labels, and active-profile fallback', () => {
  const memberProfile = createHostedAssistantProfile({
    id: ' member-openai ',
    providerConfig: {
      provider: 'openai-compatible',
      apiKeyEnv: ' OPENAI_API_KEY ',
      baseUrl: ' https://api.openai.com/v1 ',
      headers: {
        authorization: 'Bearer secret-value-1234',
        'x-trace-id': ' trace-id ',
      },
      model: ' gpt-4.1 ',
    },
  })
  const platformProfile = createHostedAssistantProfile({
    id: 'platform-custom',
    label: '  Team Hosted Endpoint  ',
    managedBy: 'platform',
    providerConfig: {
      provider: 'openai-compatible',
      apiKeyEnv: ' TEAM_API_KEY ',
      baseUrl: ' https://gateway.example.test/v1 ',
      headers: {
        'x-session-key': 'super-secret',
        'x-team': ' team-a ',
      },
      providerName: ' Internal Gateway ',
    },
  })

  assert.deepEqual(memberProfile, {
    id: 'member-openai',
    label: 'OpenAI',
    managedBy: 'member',
    target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.openai.com/v1',
      headers: {
        'X-Trace-Id': 'trace-id',
      },
      model: 'gpt-4.1',
      presetId: 'openai',
      providerName: null,
      reasoningEffort: null,
      webSearch: null,
    },
  })
  assert.deepEqual(hostedAssistantProfileToProviderConfigInput(platformProfile), {
    apiKeyEnv: 'TEAM_API_KEY',
    baseUrl: 'https://gateway.example.test/v1',
    headers: {
      'X-Team': 'team-a',
    },
    model: null,
    presetId: null,
    provider: 'openai-compatible',
    providerName: 'Internal Gateway',
    reasoningEffort: null,
    webSearch: null,
    zeroDataRetention: null,
  })

  const normalizedConfig = createHostedAssistantConfig({
    activeProfileId: ' missing-profile ',
    profiles: [memberProfile, platformProfile],
    updatedAt: '2026-04-08T12:00:00.000Z',
  })

  assert.equal(normalizedConfig.activeProfileId, 'member-openai')
  assert.deepEqual(resolveHostedAssistantActiveProfile(normalizedConfig), memberProfile)
  assert.deepEqual(
    resolveHostedAssistantActiveProfile({
      ...normalizedConfig,
      activeProfileId: ' platform-custom ',
    }),
    platformProfile,
  )
  assert.equal(
    hostedAssistantProfilesEqual(
      platformProfile,
      createHostedAssistantProfile({
        id: ' platform-custom ',
        label: 'Team Hosted Endpoint',
        managedBy: 'platform',
        providerConfig: {
          provider: 'openai-compatible',
          apiKeyEnv: 'TEAM_API_KEY',
          baseUrl: 'https://gateway.example.test/v1',
          headers: {
            authorization: 'Bearer other-secret-value',
            'x-team': 'team-a',
          },
          providerName: 'Internal Gateway',
        },
      }),
    ),
    true,
  )
  assert.equal(
    hostedAssistantConfigsEqual(normalizedConfig, {
      ...normalizedConfig,
      updatedAt: '2026-04-09T12:00:00.000Z',
    }),
    true,
  )
  assert.equal(
    hostedAssistantConfigsEqual(normalizedConfig, {
      ...normalizedConfig,
      activeProfileId: 'platform-custom',
    }),
    false,
  )
  assert.deepEqual(
    serializeHostedAssistantConfigForWrite({
      ...normalizedConfig,
      activeProfileId: 'missing-profile',
    }),
    normalizedConfig,
  )
  assert.equal(
    resolveHostedAssistantProfileLabel({
      apiKeyEnv: ' OPENAI_API_KEY ',
      baseUrl: ' https://gateway.example.test/v1 ',
      providerName: 'ignored',
    }),
    'ignored',
  )
  assert.equal(
    resolveHostedAssistantProfileLabel({
      baseUrl: ' https://gateway.example.test/v1 ',
      providerName: ' Internal Gateway ',
    }),
    'Internal Gateway',
  )
  assert.equal(
    resolveHostedAssistantProfileLabel({
      baseUrl: ' https://gateway.example.test/v1 ',
    }),
    'gateway.example.test',
  )
  assert.equal(
    resolveHostedAssistantProfileLabel({
      provider: 'openai-compatible',
    }),
    'OpenAI-compatible endpoint',
  )
})
