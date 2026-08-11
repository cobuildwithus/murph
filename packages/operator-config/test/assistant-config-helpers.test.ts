import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  createHostedAssistantConfig,
  createHostedAssistantProfile,
  hostedAssistantConfigsEqual,
  hostedAssistantProfilesEqual,
  hostedAssistantProfileToProviderConfigInput,
  resolveHostedAssistantActiveProfile,
  resolveHostedAssistantProfileLabel,
  serializeHostedAssistantConfigForWrite,
} from '../src/assistant/hosted-config.ts'
import {
  assistantProviderConfigsEqual,
  compactAssistantProviderConfigInput,
  DEFAULT_MURPH_CODEX_REASONING_EFFORT,
  mergeAssistantProviderConfigs,
  normalizeAssistantHeaders,
  normalizeAssistantPersistedHeaders,
  normalizeAssistantProviderConfig,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
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

test('assistant provider config helpers merge, compact, and serialize Codex targets only', () => {
  assert.deepEqual(
    compactAssistantProviderConfigInput({
      provider: 'codex-cli',
      modelProvider: 'vercel-ai-gateway',
    }),
    {
      modelProvider: 'vercel-ai-gateway',
    },
  )
  assert.equal(
    compactAssistantProviderConfigInput({ provider: 'codex-cli' }),
    null,
  )
  const mergedCodex = mergeAssistantProviderConfigs(
    {
      approvalPolicy: 'never',
      codexCommand: ' codex ',
      modelProvider: ' Vercel-AI-Gateway ',
      oss: false,
      reasoningEffort: ' low ',
    },
    {
      codexHome: ' /tmp/home ',
      model: ' gpt-5.6-terra ',
      oss: true,
      profile: ' default ',
      sandbox: 'danger-full-access',
    },
  )

  assert.deepEqual(mergedCodex, {
    policy: {
      approvalPolicy: 'never',
      reasoningEffort: 'low',
      sandbox: 'danger-full-access',
    },
    target: {
      codexCommand: 'codex',
      codexHome: '/tmp/home',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: true,
      profile: 'default',
    },
  })
  assert.deepEqual(mergeAssistantProviderConfigs(null, mergedCodex), mergedCodex)
  assert.equal(
    normalizeAssistantProviderConfig({ provider: 'codex-cli' }).policy.reasoningEffort,
    DEFAULT_MURPH_CODEX_REASONING_EFFORT,
  )
  assert.equal(
    assistantProviderConfigsEqual(
      {
        provider: 'codex-cli',
        modelProvider: ' Vercel-AI-Gateway ',
      },
      {
        modelProvider: 'vercel-ai-gateway',
      },
    ),
    true,
  )

  assert.deepEqual(serializeAssistantProviderSessionOptions(mergedCodex), {
    approvalPolicy: 'never',
    codexHome: '/tmp/home',
    continuityFingerprint:
      'sha256:2659438fad64495ab8f5401b4378500461339eba8faddc9c47ebc440aa7bbf15',
    executionDriver: 'codex-app-server',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: true,
    profile: 'default',
    provider: 'codex-cli',
    reasoningEffort: 'low',
    resumeKind: 'codex-thread',
    sandbox: 'danger-full-access',
  })
  assert.deepEqual(serializeAssistantProviderOperatorDefaults(mergedCodex), {
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome: '/tmp/home',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: true,
    profile: 'default',
    reasoningEffort: 'low',
    sandbox: 'danger-full-access',
  })
  assert.throws(
    () =>
      normalizeAssistantProviderConfig({
        provider: 'unsupported-provider',
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )
})

test('hosted assistant helpers normalize Codex profiles and active-profile fallback', () => {
  const memberProfile = createHostedAssistantProfile({
    id: ' member-codex ',
    providerConfig: {
      provider: 'codex-cli',
      model: ' gpt-5.6-terra ',
      modelProvider: ' vercel-ai-gateway ',
      reasoningEffort: ' medium ',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    },
  })
  const platformProfile = createHostedAssistantProfile({
    id: 'platform-codex',
    label: '  Hosted Codex  ',
    managedBy: 'platform',
    providerConfig: {
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'medium',
    },
  })

  assert.equal(memberProfile.target.adapter, 'codex-cli')
  assert.deepEqual(hostedAssistantProfileToProviderConfigInput(platformProfile), {
    approvalPolicy: null,
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    sandbox: null,
  })

  const normalizedConfig = createHostedAssistantConfig({
    activeProfileId: ' missing-profile ',
    profiles: [memberProfile, platformProfile],
    updatedAt: '2026-04-08T12:00:00.000Z',
  })

  assert.equal(normalizedConfig.activeProfileId, 'member-codex')
  assert.deepEqual(resolveHostedAssistantActiveProfile(normalizedConfig), memberProfile)
  assert.deepEqual(
    resolveHostedAssistantActiveProfile({
      ...normalizedConfig,
      activeProfileId: ' platform-codex ',
    }),
    platformProfile,
  )
  assert.equal(
    hostedAssistantProfilesEqual(
      platformProfile,
      createHostedAssistantProfile({
        id: ' platform-codex ',
        label: 'Hosted Codex',
        managedBy: 'platform',
        providerConfig: {
          provider: 'codex-cli',
          model: 'gpt-5.6-terra',
          modelProvider: 'vercel-ai-gateway',
          reasoningEffort: 'medium',
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
  assert.deepEqual(
    serializeHostedAssistantConfigForWrite({
      ...normalizedConfig,
      activeProfileId: 'missing-profile',
    }),
    normalizedConfig,
  )
  assert.equal(
    resolveHostedAssistantProfileLabel({}),
    'Codex App Server',
  )
})
