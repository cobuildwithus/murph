import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type {
  SetupCommandOptions,
  SetupConfiguredAssistant,
} from '@murphai/operator-config/setup-cli-contracts'
import {
  createSetupAssistantAccountResolver,
  detectCodexAccountFromAuthJson,
  formatCodexPlanName,
  formatSetupAssistantAccountLabel,
  loadCodexAuthAccountSnapshot,
  mergeSetupAssistantAccounts,
  parseJwtPayload,
  resolveCodexAuthFilePath,
} from '../src/setup-assistant-account.js'
import {
  assistantOperatorDefaultsMatch,
  assistantSelectionToOperatorDefaults,
  buildSetupAssistantOptionsFromDefaults,
  formatAssistantDefaultsSummary,
  formatSavedAssistantDefaultsSummary,
} from '../src/setup-assistant-defaults.js'
import {
  createSetupAssistantResolver,
  getDefaultSetupAssistantPreset,
  hasExplicitSetupAssistantOptions,
  inferSetupAssistantPresetFromOptions,
  resolveSetupAssistantProviderPreset,
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

function createSetupOptions(
  overrides: Partial<SetupCommandOptions> = {},
): SetupCommandOptions {
  return {
    vault: '/tmp/test-vault',
    strict: false,
    whisperModel: 'base.en',
    ...overrides,
  }
}

function createDiscoveredModel(id: string) {
  return {
    id,
    label: id,
    description: `${id} description`,
    source: 'discovered' as const,
    capabilities: {
      images: false,
      pdf: false,
      reasoning: true,
      streaming: true,
      tools: true,
    },
  }
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
      assistantZeroDataRetention: true,
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
      zeroDataRetention: true,
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
    assistantZeroDataRetention: true,
  })
  assert.equal(
    formatSavedAssistantDefaultsSummary(codexDefaults),
    'gpt-5.4 in Codex OSS (Team account)',
  )
  assert.equal(
    formatSavedAssistantDefaultsSummary(openAiDefaults),
    'openrouter/auto via https://openrouter.ai/api/v1 (API key account)',
  )
  assert.equal(formatSavedAssistantDefaultsSummary(null), null)
  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(null), {})
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
  assert.equal(
    formatAssistantDefaultsSummary({
      ...assistant,
      provider: 'codex-cli',
      baseUrl: null,
      model: null,
      oss: false,
      account: {
        source: 'codex-auth-json',
        kind: 'unknown',
        planCode: null,
        planName: '   ',
        quota: null,
      },
    }),
    'the configured model in Codex CLI',
  )
  assert.equal(
    formatSavedAssistantDefaultsSummary({
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: 'codex',
        codexHome: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: 'danger-full-access',
      },
      identityId: null,
      failoverRoutes: null,
      account: {
        source: 'codex-auth-json',
        kind: 'unknown',
        planCode: null,
        planName: '   ',
        quota: null,
      },
      selfDeliveryTargets: null,
    }),
    'the configured model in Codex CLI',
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
  assert.equal(detectCodexAccountFromAuthJson('{not-json'), null)
  assert.equal(detectCodexAccountFromAuthJson('[]'), null)
})

test('setup assistant account helpers cover auth path resolution, JWT parsing, and snapshot fallbacks', async () => {
  assert.equal(
    resolveCodexAuthFilePath(
      {
        CODEX_HOME: '/tmp/codex-home',
      } as NodeJS.ProcessEnv,
      '/Users/example',
    ),
    '/tmp/codex-home/auth.json',
  )
  assert.equal(
    resolveCodexAuthFilePath({} as NodeJS.ProcessEnv, '/Users/example'),
    '/Users/example/.codex/auth.json',
  )
  assert.equal(parseJwtPayload('not-a-jwt'), null)
  assert.equal(parseJwtPayload('a.b.c'), null)
  assert.equal(formatCodexPlanName('free-workspace'), 'Free Workspace')
  assert.equal(formatCodexPlanName('custom-tier'), 'Custom Tier')
  assert.equal(
    formatSetupAssistantAccountLabel({
      source: 'codex-rpc',
      kind: 'account',
      planCode: null,
      planName: null,
      quota: null,
    }),
    'signed-in account',
  )
  assert.deepEqual(
    mergeSetupAssistantAccounts(
      {
        source: 'codex-rpc',
        kind: 'unknown',
        planCode: null,
        planName: null,
        quota: null,
      },
      {
        source: 'codex-auth-json',
        kind: 'api-key',
        planCode: null,
        planName: null,
        quota: null,
      },
    ),
    {
      source: 'codex-rpc+codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    },
  )
  assert.deepEqual(
    mergeSetupAssistantAccounts(null, {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'team',
      planName: 'Team',
      quota: null,
    }),
    {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'team',
      planName: 'Team',
      quota: null,
    },
  )
  assert.equal(
    await loadCodexAuthAccountSnapshot({
      env: {} as NodeJS.ProcessEnv,
      getHomeDirectory: () => '/Users/example',
      readTextFile: async () => {
        throw new Error('missing')
      },
    }),
    null,
  )
})

test('setup assistant account resolver merges codex auth and RPC snapshots', async () => {
  let observedPath = ''
  let observedEnv: NodeJS.ProcessEnv | null = null
  const resolver = createSetupAssistantAccountResolver({
    env: () => ({
      OPENAI_API_KEY: 'sk-env',
    }),
    getHomeDirectory: () => '/Users/example',
    readTextFile: async (filePath) => {
      observedPath = filePath
      return JSON.stringify({
        OPENAI_API_KEY: 'sk-auth',
      })
    },
    async probeCodexRpc(input) {
      observedEnv = input.env
      return {
        source: 'codex-rpc',
        kind: 'account',
        planCode: 'business',
        planName: 'Business',
        quota: null,
      }
    },
  })

  assert.equal(
    await resolver.resolve({
      assistant: {
        preset: 'openai-compatible',
        enabled: true,
        provider: 'openai-compatible',
        model: 'gpt-4.1',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        providerName: 'openai',
        codexCommand: null,
        codexHome: undefined,
        profile: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        oss: false,
        account: null,
        detail: 'OpenAI',
      },
    }),
    null,
  )

  const resolved = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.4',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: 'codex',
      codexHome: '/tmp/custom-codex',
      profile: 'default',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'Codex',
    },
  })

  assert.equal(observedPath, '/tmp/custom-codex/auth.json')
  const observedCodexHome = (
    observedEnv ?? ({} as Record<string, string | undefined>)
  ).CODEX_HOME
  assert.equal(observedCodexHome, '/tmp/custom-codex')
  assert.deepEqual(resolved, {
    source: 'codex-rpc+codex-auth-json',
    kind: 'account',
    planCode: 'business',
    planName: 'Business',
    quota: null,
  })
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

test('setup assistant defaults helpers preserve codex null home and surface mismatched backends', () => {
  const assistant: SetupConfiguredAssistant = {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.4',
    baseUrl: null,
    apiKeyEnv: null,
    providerName: null,
    codexCommand: null,
    codexHome: null,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: null,
    detail: 'Codex',
  }

  assert.deepEqual(assistantSelectionToOperatorDefaults(assistant, null), {
    backend: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    account: null,
  })
  assert.equal(
    assistantOperatorDefaultsMatch(null, {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: null,
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      account: null,
    }),
    false,
  )
})

test('setup assistant defaults helpers retain explicit codex command and surface null saved backend fields', () => {
  const codexAssistant: SetupConfiguredAssistant = {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: null,
    baseUrl: null,
    apiKeyEnv: null,
    providerName: null,
    codexCommand: 'codex-beta',
    codexHome: '/tmp/codex-home',
    profile: null,
    reasoningEffort: null,
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: true,
    account: {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    },
    detail: 'Codex',
  }

  assert.deepEqual(assistantSelectionToOperatorDefaults(codexAssistant, null), {
    backend: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: 'codex-beta',
      codexHome: '/tmp/codex-home',
      model: null,
      oss: true,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
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
    formatAssistantDefaultsSummary({
      ...codexAssistant,
      account: {
        source: 'codex-auth-json',
        kind: 'unknown',
        planCode: null,
        planName: null,
        quota: null,
      },
    }),
    'the configured local model in Codex OSS',
  )
  assert.equal(
    formatSavedAssistantDefaultsSummary({
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: null,
        endpoint: null,
        headers: null,
        model: 'gpt-4.1-mini',
        providerName: null,
        reasoningEffort: null,
      },
      identityId: null,
      failoverRoutes: null,
      account: null,
      selfDeliveryTargets: null,
    }),
    'gpt-4.1-mini via the saved OpenAI-compatible endpoint',
  )
  assert.deepEqual(
    buildSetupAssistantOptionsFromDefaults({
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: null,
        endpoint: null,
        headers: null,
        model: 'gpt-4.1-mini',
        providerName: null,
        reasoningEffort: null,
      },
      identityId: null,
      failoverRoutes: null,
      account: null,
      selfDeliveryTargets: null,
    }),
    {
      assistantPreset: 'openai-compatible',
      assistantModel: 'gpt-4.1-mini',
      assistantBaseUrl: undefined,
      assistantApiKeyEnv: undefined,
      assistantProviderName: undefined,
      assistantReasoningEffort: undefined,
      assistantZeroDataRetention: undefined,
    },
  )
})

test('setup assistant provider preset resolution prefers explicit preset ids and inferred endpoints', () => {
  assert.equal(
    resolveSetupAssistantProviderPreset({
      assistantProviderPreset: 'openrouter',
      assistantBaseUrl: 'https://api.openai.com/v1',
      assistantApiKeyEnv: 'OPENAI_API_KEY',
      assistantProviderName: 'openai',
    })?.id,
    'openrouter',
  )
  assert.equal(
    resolveSetupAssistantProviderPreset({
      assistantProviderPreset: undefined,
      assistantBaseUrl: 'http://127.0.0.1:11434/v1',
      assistantApiKeyEnv: undefined,
      assistantProviderName: undefined,
    })?.id,
    'ollama',
  )
  assert.equal(
    resolveSetupAssistantProviderPreset({
      assistantProviderPreset: undefined,
      assistantBaseUrl: undefined,
      assistantApiKeyEnv: undefined,
      assistantProviderName: undefined,
    }),
    null,
  )
  assert.equal(
    resolveSetupAssistantProviderPreset({
      assistantProviderPreset: undefined,
      assistantBaseUrl: 'https://ai-gateway.vercel.sh/v1',
      assistantApiKeyEnv: undefined,
      assistantProviderName: undefined,
    })?.id,
    'vercel-ai-gateway',
  )
})

test('setup assistant resolver handles skip, codex OSS, and discovered OpenAI-compatible models', async () => {
  const capturedAssistants: SetupConfiguredAssistant[] = []
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve(input) {
        capturedAssistants.push(input.assistant)
        return input.assistant.provider === 'codex-cli'
          ? {
              source: 'codex-auth-json',
              kind: 'account',
              planCode: 'team',
              planName: 'Team',
              quota: null,
            }
          : {
              source: 'codex-auth-json',
              kind: 'api-key',
              planCode: null,
              planName: null,
              quota: null,
            }
      },
    },
    async discoverModels() {
      return {
        models: [
          createDiscoveredModel('openai/gpt-4.1'),
          createDiscoveredModel('openai/gpt-4.1-mini'),
        ],
        message: 'Discovered models',
        status: 'ok',
      }
    },
    async resolveCodexHome() {
      return {
        codexHome: '/tmp/codex-home',
        discoveredHomes: [],
      }
    },
  })

  const skipped = await resolver.resolve({
    allowPrompt: false,
    commandName: 'murph setup',
    options: createSetupOptions(),
    preset: 'skip',
  })
  assert.equal(skipped.enabled, false)
  assert.equal(skipped.provider, null)
  assert.match(skipped.detail, /Skipped assistant setup/u)
  assert.equal(capturedAssistants[0]?.provider, null)

  const codex = await resolver.resolve({
    allowPrompt: false,
    commandName: 'murph setup',
    options: createSetupOptions({
      assistantOss: true,
      assistantCodexCommand: 'codex-beta',
      assistantProfile: 'team',
    }),
    preset: 'codex',
  })
  assert.deepEqual(codex, {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-oss:20b',
    baseUrl: null,
    apiKeyEnv: null,
    providerName: null,
    codexCommand: 'codex-beta',
    codexHome: '/tmp/codex-home',
    profile: 'team',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: true,
    account: {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'team',
      planName: 'Team',
      quota: null,
    },
    detail:
      'Use Codex with the local model gpt-oss:20b. Use the explicit Codex home at /tmp/codex-home. Detected Team account from local Codex credentials.',
  })

  const compatible = await resolver.resolve({
    allowPrompt: false,
    commandName: 'murph setup',
    options: createSetupOptions({
      assistantProviderPreset: 'openrouter',
    }),
    preset: 'openai-compatible',
  })
  assert.deepEqual(compatible, {
    preset: 'openai-compatible',
    enabled: true,
    provider: 'openai-compatible',
    model: 'openai/gpt-4.1',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerName: 'openrouter',
    codexCommand: null,
    profile: null,
    reasoningEffort: null,
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
    detail:
      'Use openai/gpt-4.1 from OpenRouter. Murph will read the key from OPENROUTER_API_KEY. Detected API key account from local Codex credentials.',
  })
})

test('setup assistant resolver requires an explicit model when discovery returns no models without prompting', async () => {
  const resolver = createSetupAssistantResolver({
    assistantAccount: {
      async resolve() {
        return null
      },
    },
    async discoverModels() {
      return {
        models: [],
        message: 'No models were returned.',
        status: 'ok',
      }
    },
    async resolveCodexHome() {
      return {
        codexHome: null,
        discoveredHomes: [],
      }
    },
  })

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantBaseUrl: 'https://example.test/v1',
      }),
      preset: 'openai-compatible',
    }),
    /explicit model.*No models were returned/u,
  )
})

test('setup assistant summaries and account helpers cover OSS and fallback branches', () => {
  assert.equal(
    formatAssistantDefaultsSummary({
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: null,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: true,
      account: {
        source: 'codex-auth-json',
        kind: 'api-key',
        planCode: null,
        planName: null,
        quota: null,
      },
      detail: 'Codex OSS',
    }),
    'the configured local model in Codex OSS (API key account)',
  )

  assert.equal(detectCodexAccountFromAuthJson('not-json'), null)
  assert.equal(detectCodexAccountFromAuthJson('[]'), null)
  assert.equal(detectCodexAccountFromAuthJson('{}'), null)

  for (const [planCode, label] of [
    ['guest', 'Guest'],
    ['free', 'Free'],
    ['go', 'Go'],
    ['plus', 'Plus'],
    ['pro', 'Pro'],
    ['education', 'Education'],
    ['quorum', 'Quorum'],
    ['k12', 'K12'],
    ['enterprise', 'Enterprise'],
    ['edu', 'Edu'],
  ] as const) {
    assert.equal(formatCodexPlanName(planCode), label)
  }
  assert.equal(formatCodexPlanName(null), null)

  assert.equal(formatSetupAssistantAccountLabel(null), null)
  assert.equal(
    formatSetupAssistantAccountLabel({
      source: 'codex-rpc',
      kind: 'account',
      planCode: null,
      planName: null,
      quota: null,
    }),
    'signed-in account',
  )
  assert.equal(
    mergeSetupAssistantAccounts(null, {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    })?.source,
    'codex-auth-json',
  )
  assert.equal(
    mergeSetupAssistantAccounts(
      {
        source: 'codex-rpc',
        kind: 'unknown',
        planCode: null,
        planName: null,
        quota: null,
      },
      null,
    )?.source,
    'codex-rpc',
  )
})
