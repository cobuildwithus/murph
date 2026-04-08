import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type { SetupConfiguredAssistant } from '@murphai/operator-config/setup-cli-contracts'
import {
  detectCodexAccountFromAuthJson,
  formatSetupAssistantAccountLabel,
} from '../src/setup-assistant-account.js'
import {
  assistantOperatorDefaultsMatch,
  assistantSelectionToOperatorDefaults,
  buildSetupAssistantOptionsFromDefaults,
  formatAssistantDefaultsSummary,
  formatSavedAssistantDefaultsSummary,
} from '../src/setup-assistant-defaults.js'
import {
  getDefaultSetupAssistantPreset,
  hasExplicitSetupAssistantOptions,
  inferSetupAssistantPresetFromOptions,
} from '../src/setup-assistant.js'

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/gu, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
}

function buildFakeJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64Url(JSON.stringify({ alg: 'none' }))}.${encodeBase64Url(JSON.stringify(payload))}.`
}

test('setup assistant option normalization infers presets from explicit assistant inputs', () => {
  assert.equal(getDefaultSetupAssistantPreset(), 'codex')
  assert.equal(hasExplicitSetupAssistantOptions({}), false)
  assert.equal(
    hasExplicitSetupAssistantOptions({
      assistantModel: 'gpt-5.4',
    }),
    true,
  )
  assert.equal(
    inferSetupAssistantPresetFromOptions({
      assistantBaseUrl: 'https://openrouter.ai/api/v1',
    }),
    'openai-compatible',
  )
  assert.equal(
    inferSetupAssistantPresetFromOptions({
      assistantModel: 'gpt-5.4',
    }),
    'codex',
  )
  assert.equal(
    inferSetupAssistantPresetFromOptions({
      assistantPreset: 'skip',
    }),
    'skip',
  )
  assert.equal(inferSetupAssistantPresetFromOptions({}), null)
})

test('setup assistant defaults round-trip between saved operator defaults and setup options', () => {
  const codexDefaults: AssistantOperatorDefaults = {
    backend: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.4',
      oss: true,
      profile: 'primary',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    identityId: null,
    failoverRoutes: null,
    account: {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'team',
      planName: 'Team',
      quota: null,
    },
    selfDeliveryTargets: null,
  }
  const openAiDefaults: AssistantOperatorDefaults = {
    backend: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      endpoint: 'https://openrouter.ai/api/v1',
      headers: null,
      model: 'openrouter/auto',
      providerName: 'openrouter',
      reasoningEffort: 'high',
    },
    identityId: null,
    failoverRoutes: null,
    account: {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    },
    selfDeliveryTargets: null,
  }

  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(codexDefaults), {
    assistantPreset: 'codex',
    assistantModel: 'gpt-5.4',
    assistantCodexCommand: 'codex',
    assistantCodexHome: '/tmp/codex-home',
    assistantProfile: 'primary',
    assistantReasoningEffort: 'medium',
    assistantOss: true,
  })
  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(openAiDefaults), {
    assistantPreset: 'openai-compatible',
    assistantModel: 'openrouter/auto',
    assistantBaseUrl: 'https://openrouter.ai/api/v1',
    assistantApiKeyEnv: 'OPENROUTER_API_KEY',
    assistantProviderName: 'openrouter',
    assistantReasoningEffort: 'high',
  })
  assert.equal(
    formatSavedAssistantDefaultsSummary(codexDefaults),
    'gpt-5.4 in Codex OSS (Team account)',
  )
  assert.equal(
    formatSavedAssistantDefaultsSummary(openAiDefaults),
    'openrouter/auto via https://openrouter.ai/api/v1 (API key account)',
  )
})

test('setup assistant summary helpers label accounts consistently for selected and saved defaults', () => {
  const assistant: SetupConfiguredAssistant = {
    preset: 'openai-compatible',
    enabled: true,
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
    baseUrl: null,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerName: 'openrouter',
    codexCommand: null,
    codexHome: undefined,
    profile: null,
    reasoningEffort: 'high',
    sandbox: null,
    approvalPolicy: null,
    oss: false,
    account: {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'plus',
      planName: 'Plus',
      quota: null,
    },
    detail: 'OpenRouter',
  }

  assert.equal(
    formatAssistantDefaultsSummary(assistant),
    'gpt-4.1-mini via the saved OpenAI-compatible endpoint (Plus account)',
  )
  assert.equal(
    formatSetupAssistantAccountLabel(assistant.account),
    'Plus account',
  )
  assert.equal(
    formatSetupAssistantAccountLabel({
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    }),
    'API key account',
  )
})

test('setup assistant codex auth detection reads plan metadata and api key accounts', () => {
  const account = detectCodexAccountFromAuthJson(
    JSON.stringify({
      tokens: {
        idToken: buildFakeJwt({
          'https://api.openai.com/auth': {
            chatgpt_plan_type: 'team',
          },
        }),
      },
    }),
  )

  assert.deepEqual(account, {
    source: 'codex-auth-json',
    kind: 'account',
    planCode: 'team',
    planName: 'Team',
    quota: null,
  })
  assert.equal(formatSetupAssistantAccountLabel(account), 'Team account')
  assert.equal(
    detectCodexAccountFromAuthJson(
      JSON.stringify({
        OPENAI_API_KEY: 'sk-example',
      }),
    )?.kind,
    'api-key',
  )
})

test('setup assistant selection normalizes chosen assistant values into operator defaults patches', () => {
  const assistant: SetupConfiguredAssistant = {
    preset: 'openai-compatible',
    enabled: true,
    provider: 'openai-compatible',
    model: 'gpt-4o-mini',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerName: 'openrouter',
    codexCommand: null,
    codexHome: undefined,
    profile: null,
    reasoningEffort: 'high',
    sandbox: null,
    approvalPolicy: null,
    oss: false,
    account: {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    },
    detail: 'OpenRouter',
  }

  const patch = assistantSelectionToOperatorDefaults(assistant, null)
  assert.deepEqual(patch, {
    backend: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      endpoint: 'https://openrouter.ai/api/v1',
      headers: null,
      model: 'gpt-4o-mini',
      providerName: 'openrouter',
      reasoningEffort: 'high',
    },
    account: {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    },
  })
  assert.equal(
    assistantOperatorDefaultsMatch(
      {
        backend: patch.backend ?? null,
        identityId: null,
        failoverRoutes: null,
        account: patch.account ?? null,
        selfDeliveryTargets: null,
      },
      patch,
    ),
    true,
  )
})

test('setup assistant defaults helpers clear backend state and summarize empty saved defaults', () => {
  const patch = assistantSelectionToOperatorDefaults(
    {
      preset: 'skip',
      enabled: false,
      provider: null,
      model: null,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: undefined,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      account: null,
      detail: 'Skipped',
    },
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: 'codex',
        codexHome: null,
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
      identityId: null,
      failoverRoutes: null,
      account: null,
      selfDeliveryTargets: null,
    },
  )

  assert.deepEqual(patch, {
    backend: null,
    account: null,
  })
  assert.equal(
    assistantOperatorDefaultsMatch(
      {
        backend: {
          adapter: 'codex-cli',
          approvalPolicy: 'never',
          codexCommand: 'codex',
          codexHome: null,
          model: 'gpt-5.4',
          oss: false,
          profile: null,
          reasoningEffort: 'medium',
          sandbox: 'workspace-write',
        },
        identityId: null,
        failoverRoutes: null,
        account: null,
        selfDeliveryTargets: null,
      },
      patch,
    ),
    false,
  )
  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(null), {})
  assert.equal(formatSavedAssistantDefaultsSummary(null), null)
})
