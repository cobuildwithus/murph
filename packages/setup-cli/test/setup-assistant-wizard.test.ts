import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildSetupWizardAssistantMethodBadges,
  buildSetupWizardAssistantProviderBadges,
  doesSetupWizardAssistantProviderRequireMethod,
  findSetupAssistantWizardProviderIndex,
  findSetupWizardAssistantMethodIndex,
  findSetupWizardAssistantProviderIndex,
  getDefaultSetupWizardAssistantPreset,
  inferSetupWizardAssistantMethod,
  inferSetupWizardAssistantProvider,
  listSetupAssistantWizardProviderOptions,
  listSetupWizardAssistantMethodOptions,
  listSetupWizardAssistantProviderOptions,
  normalizeSetupAssistantWizardProvider,
  resolveSetupWizardAssistantMethodForProvider,
  resolveSetupWizardAssistantSelection,
} from '../src/setup-assistant-wizard.js'

test('setup assistant wizard provider lists and indices normalize to safe defaults', () => {
  assert.equal(getDefaultSetupWizardAssistantPreset(), 'codex')

  const allProviders = listSetupWizardAssistantProviderOptions()
  const selectableProviders = listSetupAssistantWizardProviderOptions()

  assert.equal(allProviders.at(-1)?.provider, 'skip')
  assert.ok(selectableProviders.every((option) => option.provider !== 'skip'))
  assert.equal(findSetupWizardAssistantProviderIndex('openai'), 0)
  assert.equal(findSetupWizardAssistantProviderIndex('skip'), allProviders.length - 1)
  assert.equal(findSetupAssistantWizardProviderIndex('skip'), 0)
  assert.equal(findSetupWizardAssistantProviderIndex('custom'), selectableProviders.length - 1)
  assert.equal(findSetupWizardAssistantProviderIndex('not-real' as 'openai'), 0)
  assert.equal(findSetupAssistantWizardProviderIndex('not-real' as 'openai'), 0)
  assert.equal(normalizeSetupAssistantWizardProvider('skip'), 'openai')
  assert.equal(normalizeSetupAssistantWizardProvider('openrouter'), 'openrouter')
})

test('setup assistant wizard infers providers and methods from saved selections', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'codex',
      oss: false,
    }),
    'openai',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'codex',
      oss: true,
      baseUrl: 'http://127.0.0.1:11434/v1',
    }),
    'ollama',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'openai-compatible',
      providerPreset: 'openrouter',
    }),
    'openrouter',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
    }),
    'openai',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      providerName: 'custom-provider',
    }),
    'custom',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'skip',
    }),
    'skip',
  )

  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'codex',
      provider: 'openai',
      oss: false,
    }),
    'openai-codex',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'codex',
      provider: 'ollama',
      oss: true,
    }),
    'compatible-codex-local',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'openai-compatible',
      provider: 'openai',
      oss: false,
    }),
    'openai-api-key',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'openai-compatible',
      provider: 'openrouter',
      oss: false,
    }),
    'compatible-provider',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'openai-compatible',
      provider: 'custom',
      oss: false,
    }),
    'compatible-endpoint',
  )
  assert.equal(
    inferSetupWizardAssistantMethod({
      preset: 'skip',
      provider: 'skip',
      oss: null,
    }),
    'skip',
  )
})

test('setup assistant wizard method helpers constrain provider-specific flows', () => {
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('openai'), true)
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('custom'), true)
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('openrouter'), false)
  assert.equal(doesSetupWizardAssistantProviderRequireMethod('skip'), false)

  assert.deepEqual(
    listSetupWizardAssistantMethodOptions('openai').map((option) => option.method),
    ['openai-codex', 'openai-api-key'],
  )
  assert.deepEqual(
    listSetupWizardAssistantMethodOptions('custom').map((option) => option.method),
    ['compatible-endpoint', 'compatible-codex-local'],
  )
  assert.deepEqual(listSetupWizardAssistantMethodOptions('skip'), [])
  assert.equal(findSetupWizardAssistantMethodIndex('openai', 'openai-api-key'), 1)
  assert.equal(findSetupWizardAssistantMethodIndex('custom', 'skip'), 0)

  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'openai-api-key',
      provider: 'openai',
    }),
    'openai-api-key',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'compatible-provider',
      provider: 'custom',
    }),
    'compatible-endpoint',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'compatible-codex-local',
      provider: 'custom',
    }),
    'compatible-codex-local',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'compatible-endpoint',
      provider: 'openrouter',
    }),
    'compatible-provider',
  )
  assert.equal(
    resolveSetupWizardAssistantMethodForProvider({
      currentMethod: 'openai-codex',
      provider: 'skip',
    }),
    'skip',
  )
})

test('setup assistant wizard resolves provider selections into saved backend choices', () => {
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'skip',
      method: 'skip',
    }),
    {
      apiKeyEnv: null,
      baseUrl: null,
      detail: 'Murph will leave your current assistant settings alone for now.',
      methodLabel: null,
      oss: null,
      preset: 'skip',
      providerLabel: 'Skip for now',
      providerName: null,
      summary: 'Skip for now',
    },
  )

  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'openai',
      method: 'openai-api-key',
      initialProvider: 'openai',
      initialApiKeyEnv: '  CUSTOM_OPENAI_KEY  ',
      initialBaseUrl: ' https://api.openai.com/v1 ',
      initialProviderName: ' openai ',
    }),
    {
      apiKeyEnv: 'CUSTOM_OPENAI_KEY',
      baseUrl: 'https://api.openai.com/v1',
      detail:
        'Murph will use CUSTOM_OPENAI_KEY and ask which model to save next.',
      methodLabel: 'OpenAI API key',
      oss: false,
      preset: 'openai-compatible',
      providerLabel: 'OpenAI',
      providerName: 'openai',
      summary: 'OpenAI · API key',
    },
  )

  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'custom',
      method: 'compatible-codex-local',
    }),
    {
      apiKeyEnv: null,
      baseUrl: null,
      detail:
        'Murph will keep the Codex flow and ask which local model to save next.',
      methodLabel: 'Codex local model',
      oss: true,
      preset: 'codex',
      providerLabel: 'Custom endpoint',
      providerName: null,
      summary: 'Custom endpoint · Codex local model',
    },
  )

  const openRouterSelection = resolveSetupWizardAssistantSelection({
    provider: 'openrouter',
    method: 'compatible-provider',
    initialProvider: 'openrouter',
    initialApiKeyEnv: '  ALT_OPENROUTER_KEY ',
    initialBaseUrl: ' https://openrouter.ai/api/v1 ',
    initialProviderName: ' openrouter ',
  })
  assert.equal(openRouterSelection.preset, 'openai-compatible')
  assert.equal(openRouterSelection.providerLabel, 'OpenRouter')
  assert.equal(openRouterSelection.providerName, 'openrouter')
  assert.equal(openRouterSelection.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(openRouterSelection.apiKeyEnv, 'ALT_OPENROUTER_KEY')
  assert.match(openRouterSelection.detail, /ALT_OPENROUTER_KEY/u)
})

test('setup assistant wizard infers named OpenAI selections from provider names and API keys', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'openai-compatible',
      providerName: '  openai  ',
    }),
    'openai',
  )
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
    }),
    'openai',
  )
})

test('setup assistant wizard describes named providers without saved API keys', () => {
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'openrouter',
      method: 'compatible-provider',
      initialApiKeyEnv: null,
      initialBaseUrl: null,
      initialProviderName: null,
    }),
    {
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseUrl: 'https://openrouter.ai/api/v1',
      detail:
        'Murph will use OpenRouter and read the key from OPENROUTER_API_KEY. It will ask which model to save next.',
      methodLabel: null,
      oss: false,
      preset: 'openai-compatible',
      providerLabel: 'OpenRouter',
      providerName: 'openrouter',
      summary: 'OpenRouter',
    },
  )
})

test('setup assistant wizard badges reflect provider kind and current selections', () => {
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'openai',
      provider: 'openai',
    }),
    [
      { label: 'recommended', tone: 'success' },
      { label: 'current', tone: 'accent' },
    ],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'openai',
      provider: 'ollama',
    }),
    [{ label: 'local', tone: 'accent' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'openai',
      provider: 'openrouter',
    }),
    [{ label: 'gateway', tone: 'accent' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'openai',
      provider: 'custom',
    }),
    [{ label: 'manual', tone: 'accent' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'openai',
      provider: 'skip',
    }),
    [{ label: 'no change', tone: 'muted' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantMethodBadges({
      currentMethod: 'openai-api-key',
      method: 'openai-api-key',
      optionBadges: [{ label: 'manual', tone: 'accent' }],
    }),
    [
      { label: 'manual', tone: 'accent' },
      { label: 'current', tone: 'accent' },
    ],
  )
  assert.deepEqual(
    buildSetupWizardAssistantProviderBadges({
      currentProvider: 'openai',
      provider: 'deepseek',
    }),
    [{ label: 'hosted', tone: 'muted' }],
  )
  assert.deepEqual(
    buildSetupWizardAssistantMethodBadges({
      currentMethod: 'compatible-provider',
      method: 'openai-api-key',
    }),
    [],
  )
})

test('setup assistant wizard falls back to custom providers when saved endpoint metadata is not a named preset', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      preset: 'openai-compatible',
      baseUrl: ' https://example.test/v1 ',
    }),
    'custom',
  )
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      provider: 'custom',
      method: 'compatible-endpoint',
      initialProvider: 'openrouter',
      initialApiKeyEnv: 'OPENROUTER_API_KEY',
      initialBaseUrl: 'https://openrouter.ai/api/v1',
      initialProviderName: 'openrouter',
    }),
    {
      apiKeyEnv: null,
      baseUrl: 'http://127.0.0.1:11434/v1',
      detail: 'Murph will ask for the endpoint URL and then let you choose a model.',
      methodLabel: 'Compatible endpoint',
      oss: false,
      preset: 'openai-compatible',
      providerLabel: 'Custom endpoint',
      providerName: null,
      summary: 'Custom endpoint · Compatible endpoint',
    },
  )
})
