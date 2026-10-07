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
  mergeAssistantProviderConfigs,
  normalizeAssistantHeaders,
  normalizeAssistantPersistedHeaders,
  normalizeAssistantProviderConfig,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'
import {
  splitAssistantHeadersForPersistence,
} from '../src/assistant/redaction.ts'
import {
  readAssistantEnvString,
} from '../src/assistant/shared.ts'
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
    reasoningEffort: 'low',
    sandbox: 'danger-full-access',
  })

  assert.equal(createAssistantModelTarget(null), null)
  assert.equal(normalizeAssistantModelTarget(null), null)
  assert.throws(
    () => normalizeAssistantModelTarget({ adapter: 'missing' }),
    /Assistant runtime targets must use Codex App Server/u,
  )
  assert.throws(
    () =>
      normalizeAssistantModelTarget({
        adapter: 'unsupported-provider',
        apiKeyEnv: 'PROVIDER_API_KEY',
        model: 'gpt-5',
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )

  const codexTarget = createAssistantModelTarget({
    provider: 'codex-cli',
    codexHome: ' /tmp/codex ',
    modelProvider: ' OpenAI ',
  })
  assert.deepEqual(codexTarget, {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    codexHome: '/tmp/codex',
    model: null,
    modelProvider: 'openai',
    oss: false,
    profile: null,
    reasoningEffort: 'low',
    sandbox: null,
  })
  assert.deepEqual(sanitizeAssistantModelTargetForPersistence(codexTarget), codexTarget)
  assert.equal(sanitizeAssistantModelTargetForPersistence(null), null)
  assert.deepEqual(assistantModelTargetToProviderConfigInput(codexTarget), {
    approvalPolicy: null,
    codexCommand: null,
    codexHome: '/tmp/codex',
    model: null,
    modelProvider: 'openai',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'low',
    sandbox: null,
  })
  assert.equal(
    assistantModelTargetsEqual(codexTarget, {
      adapter: 'codex-cli',
      approvalPolicy: null,
      codexCommand: null,
      codexHome: ' /tmp/codex ',
      model: null,
      modelProvider: 'openai',
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
        provider: 'unsupported-provider',
        model: 'gpt-5',
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )
})

test('assistant provider helpers cover Codex inference and serialization branches', () => {
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
    model: ' gpt-5.6-terra ',
    modelProvider: ' OpenAI ',
  })
  assert.deepEqual(mergedCodex, {
    policy: {
      approvalPolicy: null,
      reasoningEffort: 'low',
      sandbox: null,
    },
    target: {
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.6-terra',
      modelProvider: 'openai',
      oss: false,
      profile: null,
    },
  })
  assert.deepEqual(
    mergeAssistantProviderConfigs(null, { profile: ' hosted ' }).target,
    {
      codexCommand: null,
      codexHome: null,
      model: null,
      modelProvider: null,
      oss: false,
      profile: 'hosted',
    },
  )
  assert.deepEqual(serializeAssistantProviderSessionOptions(mergedCodex), {
    continuityFingerprint:
      'sha256:f5efdf258853d4e25eaea6c82afed8676c17ee9001ce6533148d8bf5c236dc28',
    executionDriver: 'codex-app-server',
    approvalPolicy: null,
    model: 'gpt-5.6-terra',
    modelProvider: 'openai',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'low',
    resumeKind: 'codex-thread',
    sandbox: null,
  })
  assert.deepEqual(serializeAssistantProviderOperatorDefaults(mergedCodex), {
    approvalPolicy: null,
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.6-terra',
    modelProvider: 'openai',
    oss: false,
    profile: null,
    reasoningEffort: 'low',
    sandbox: null,
  })
  assert.equal(
    assistantProviderConfigsEqual({ provider: 'codex-cli', model: 'gpt-5' }, null),
    false,
  )
  assert.throws(
    () =>
      normalizeAssistantProviderConfig({
        provider: 'unsupported-provider',
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )
})

test('hosted assistant config helpers normalize Codex profiles and sparse fallbacks', () => {
  assert.throws(
    () =>
      createHostedAssistantProfile({
        id: 'bad-profile',
        providerConfig: {
          provider: 'unsupported-provider',
          model: 'gpt-5',
        },
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )

  const codexProfile = createHostedAssistantProfile({
    id: ' codex-profile ',
    providerConfig: {
      provider: 'codex-cli',
      model: ' gpt-5.6-terra ',
      modelProvider: ' openai ',
    },
  })
  assert.equal(codexProfile.label, 'OpenAI')

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
  assert.equal(resolveHostedAssistantProfileLabel({}), 'Codex App Server')
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
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
        },
      }),
    /profile id is required/u,
  )
})
