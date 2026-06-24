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
  DEFAULT_SETUP_CODEX_MODEL,
  createSetupAssistantResolver,
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

test('setup assistant option normalization infers Codex presets and rejects legacy provider inputs', () => {
  assert.equal(getDefaultSetupAssistantPreset(), 'codex')
  assert.equal(hasExplicitSetupAssistantOptions({}), false)
  assert.equal(
    hasExplicitSetupAssistantOptions({
      assistantModel: 'gpt-5.5',
    }),
    true,
  )
  assert.equal(
    hasExplicitSetupAssistantOptions({
      assistantModelProvider: 'vercel-ai-gateway',
    }),
    true,
  )
  assert.equal(
    inferSetupAssistantPresetFromOptions({
      assistantModel: 'gpt-5.5',
    }),
    'codex',
  )
  assert.equal(
    inferSetupAssistantPresetFromOptions({
      assistantPreset: 'skip',
    }),
    'skip',
  )
  assert.equal(
    inferSetupAssistantPresetFromOptions({
      assistantModelProvider: 'venice',
    }),
    'codex',
  )
  assert.equal(inferSetupAssistantPresetFromOptions({}), null)
})

test('setup assistant defaults round-trip Codex defaults', () => {
  const codexDefaults: AssistantOperatorDefaults = {
    backend: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: true,
      profile: 'primary',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    identityId: null,
    account: {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'team',
      planName: 'Team',
      quota: null,
    },
    selfDeliveryTargets: null,
  }
  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(codexDefaults), {
    assistantPreset: 'codex',
    assistantModel: 'gpt-5.5',
    assistantModelProvider: 'vercel-ai-gateway',
    assistantCodexCommand: 'codex',
    assistantCodexHome: '/tmp/codex-home',
    assistantProfile: 'primary',
    assistantReasoningEffort: 'medium',
    assistantOss: true,
  })
  assert.equal(
    formatSavedAssistantDefaultsSummary(codexDefaults),
    'gpt-5.5 via Codex OSS app-server (Team account)',
  )
  assert.equal(formatSavedAssistantDefaultsSummary(null), null)
  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(null), {})
})

test('setup assistant summary helpers label Codex accounts consistently', () => {
  const assistant: SetupConfiguredAssistant = {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.5',
    modelProvider: null,
    codexCommand: null,
    codexHome: undefined,
    profile: null,
    reasoningEffort: 'high',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: {
      source: 'codex-auth-json',
      kind: 'account',
      planCode: 'plus',
      planName: 'Plus',
      quota: null,
    },
    detail: 'Codex',
  }

  assert.equal(
    formatAssistantDefaultsSummary(assistant),
    'gpt-5.5 via Codex app-server (Plus account)',
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
      model: null,
      account: {
        source: 'codex-auth-json',
        kind: 'unknown',
        planCode: null,
        planName: '   ',
        quota: null,
      },
    }),
    'the configured model via Codex app-server',
  )
})

test('setup assistant codex auth detection reads plan metadata and API key accounts', () => {
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
      '/tmp/home',
    ),
    '/tmp/codex-home/auth.json',
  )
  assert.equal(
    resolveCodexAuthFilePath({} as NodeJS.ProcessEnv, '/tmp/home'),
    '/tmp/home/.codex/auth.json',
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
  assert.equal(
    await loadCodexAuthAccountSnapshot({
      env: {} as NodeJS.ProcessEnv,
      getHomeDirectory: () => '/tmp/home',
      readTextFile: async () => {
        throw new Error('missing')
      },
    }),
    null,
  )
})

test('setup assistant account resolver merges Codex auth and RPC snapshots', async () => {
  let observedPath = ''
  let observedEnv: NodeJS.ProcessEnv | null = null
  const resolver = createSetupAssistantAccountResolver({
    env: () => ({
      OPENAI_API_KEY: 'sk-env',
    }),
    getHomeDirectory: () => '/tmp/home',
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

  const resolved = await resolver.resolve({
    assistant: {
      preset: 'codex',
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.5',
      modelProvider: null,
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

test('setup assistant selection normalizes Codex values into operator defaults patches', () => {
  const assistant: SetupConfiguredAssistant = {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    codexCommand: 'codex',
    codexHome: '/tmp/codex-home',
    profile: 'team',
    reasoningEffort: 'high',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: {
      source: 'codex-auth-json',
      kind: 'api-key',
      planCode: null,
      planName: null,
      quota: null,
    },
    detail: 'Codex',
  }

  const patch = assistantSelectionToOperatorDefaults(assistant, null)
  assert.deepEqual(patch, {
    backend: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: 'codex',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'team',
      reasoningEffort: 'high',
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
    assistantOperatorDefaultsMatch(
      {
        backend: patch.backend ?? null,
        identityId: null,
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
      modelProvider: null,
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
        model: 'gpt-5.5',
        modelProvider: null,
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
      identityId: null,
      account: null,
      selfDeliveryTargets: null,
    },
  )

  assert.deepEqual(patch, {
    backend: null,
    account: null,
  })
  assert.deepEqual(buildSetupAssistantOptionsFromDefaults(null), {})
  assert.equal(formatSavedAssistantDefaultsSummary(null), null)
})

test('setup assistant resolver handles skip, Codex cloud, and Codex OSS', async () => {
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
          : null
      },
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
  assert.equal(capturedAssistants.length, 0)

  const defaultCodex = await resolver.resolve({
    allowPrompt: false,
    commandName: 'murph setup',
    options: createSetupOptions(),
    preset: 'codex',
  })
  assert.equal(defaultCodex.model, DEFAULT_SETUP_CODEX_MODEL)
  assert.equal(defaultCodex.modelProvider, null)
  assert.equal(
    defaultCodex.detail,
    'Use Codex with gpt-5.5. An explicit Codex home is configured; path redacted in CLI output. Detected Team account from local Codex credentials.',
  )

  const codex = await resolver.resolve({
    allowPrompt: false,
    commandName: 'murph setup',
    options: createSetupOptions({
      assistantModel: 'gpt-5.5',
      assistantModelProvider: 'vercel-ai-gateway',
      assistantCodexCommand: 'codex-beta',
      assistantProfile: 'team',
    }),
    preset: 'codex',
  })
  assert.deepEqual(codex, {
    preset: 'codex',
    enabled: true,
    provider: 'codex-cli',
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    codexCommand: 'codex-beta',
    codexHome: '/tmp/codex-home',
    profile: 'team',
    reasoningEffort: 'low',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    oss: false,
    account: null,
    detail:
      'Use Codex with gpt-5.5. Use Codex model provider vercel-ai-gateway. An explicit Codex home is configured; path redacted in CLI output.',
  })
  assert.equal(capturedAssistants.length, 1)
})

test('setup assistant resolver rejects skip with Codex-specific options', async () => {
  const resolver = createSetupAssistantResolver()

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantModelProvider: 'venice',
        assistantPreset: 'skip',
      }),
      preset: 'skip',
    }),
    /--assistant-model-provider cannot be used with --assistant-preset skip/u,
  )
})

test('setup assistant resolver fails closed for invalid provider combinations', async () => {
  const resolver = createSetupAssistantResolver()

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantModelProvider: 'venice',
        assistantOss: true,
      }),
      preset: 'codex',
    }),
    /--assistant-model-provider cannot be used with --assistant-oss/u,
  )

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantModelProvider: 'unknown-provider',
      }),
      preset: 'codex',
    }),
    /Unknown Codex model provider: unknown-provider/u,
  )

  await assert.rejects(
    resolver.resolve({
      allowPrompt: false,
      commandName: 'murph setup',
      options: createSetupOptions({
        assistantModelProvider: 'venice',
      }),
      preset: 'codex',
    }),
    /--assistant-model is required when --assistant-model-provider venice is selected/u,
  )
})

test('setup assistant plan name helpers cover known and custom plans', () => {
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
})
