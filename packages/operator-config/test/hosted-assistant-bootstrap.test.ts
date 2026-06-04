import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  type HostedAssistantConfig,
  createHostedAssistantConfig,
  createHostedAssistantProfile,
} from '../src/assistant/hosted-config.ts'
import {
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
  VENICE_CODEX_MODEL_PROVIDER_CONFIG,
} from '../src/assistant/target-runtime.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function loadHostedAssistantModule(options?: {
  readOperatorConfigResult?: {
    hostedAssistant?: HostedAssistantConfig | null
    hostedAssistantInvalid?: boolean
  } | null
  saveHostedAssistantConfigImpl?: (
    config: HostedAssistantConfig | null,
    homeDirectory: string | undefined,
  ) => Promise<{ hostedAssistant: HostedAssistantConfig | null }>
}) {
  vi.resetModules()
  const readOperatorConfig = vi.fn(async () => options?.readOperatorConfigResult ?? null)
  const saveHostedAssistantConfig = vi.fn(
    options?.saveHostedAssistantConfigImpl ??
      (async (config: HostedAssistantConfig | null) => ({ hostedAssistant: config })),
  )

  vi.doMock('../src/operator-config.ts', () => ({
    readOperatorConfig,
    saveHostedAssistantConfig,
  }))

  const module = await import('../src/hosted-assistant-config.ts')
  return {
    ...module,
    readOperatorConfig,
    saveHostedAssistantConfig,
  }
}

function assertCodexOpenAiProfile(
  profile: HostedAssistantConfig['profiles'][number] | undefined,
  expected: {
    approvalPolicy?: string | null
    model?: string | null
    reasoningEffort?: string | null
    sandbox?: string | null
  } = {},
) {
  const {
    approvalPolicy = 'never',
    model = 'gpt-5.5',
    reasoningEffort = 'low',
    sandbox = 'danger-full-access',
  } = expected

  assert.ok(profile)
  assert.equal(profile.target.adapter, 'codex-cli')
  if (profile.target.adapter !== 'codex-cli') {
    throw new Error('expected hosted profile to use Codex')
  }

  assert.equal(profile.target.approvalPolicy, approvalPolicy)
  assert.equal(profile.target.model, model)
  assert.equal(profile.target.modelProvider, 'openai')
  assert.equal(profile.target.reasoningEffort, reasoningEffort)
  assert.equal(profile.target.sandbox, sandbox)
}

test('hosted assistant config parsing and readiness helpers normalize Codex hosted profiles', async () => {
  const hostedConfigModule = await loadHostedAssistantModule()
  const {
    compileHostedAssistantProfileProviderConfig,
    isHostedAssistantProfileReady,
    parseHostedAssistantConfig,
    parseHostedAssistantConfigJson,
    prepareHostedAssistantConfigForWrite,
    resolveActiveHostedAssistantProfile,
    resolveHostedAssistantOperatorDefaultsState,
    resolveHostedAssistantProfile,
    resolveHostedAssistantProviderConfig,
    resolveReadyHostedAssistantProfile,
    tryParseHostedAssistantConfig,
  } = hostedConfigModule

  const readyProfile = createHostedAssistantProfile({
    id: 'platform-default',
    managedBy: 'platform',
    providerConfig: {
      provider: 'codex-cli',
      model: ' gpt-5.5 ',
      modelProvider: ' openai ',
      reasoningEffort: ' medium ',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    },
  })
  const providerOnlyProfile = createHostedAssistantProfile({
    id: 'member-provider-only',
    providerConfig: {
      provider: 'codex-cli',
      modelProvider: 'openai',
    },
  })
  const veniceProfile = createHostedAssistantProfile({
    id: 'member-venice',
    providerConfig: {
      provider: 'codex-cli',
      model: 'venice-model',
      modelProvider: VENICE_CODEX_MODEL_PROVIDER_CONFIG.id,
    },
  })
  const config = createHostedAssistantConfig({
    activeProfileId: readyProfile.id,
    profiles: [readyProfile, providerOnlyProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  assert.deepEqual(parseHostedAssistantConfig(config), config)
  assert.deepEqual(parseHostedAssistantConfigJson(JSON.stringify(config)), config)
  assert.equal(tryParseHostedAssistantConfig('bad-json-shape'), null)
  assert.deepEqual(prepareHostedAssistantConfigForWrite(config), config)
  assert.deepEqual(resolveHostedAssistantProfile(config, ' platform-default '), readyProfile)
  assert.equal(resolveHostedAssistantProfile(config, 'missing'), null)
  assert.deepEqual(resolveActiveHostedAssistantProfile(config), readyProfile)
  assert.deepEqual(resolveReadyHostedAssistantProfile(config), readyProfile)
  assert.equal(resolveReadyHostedAssistantProfile(null), null)
  assert.equal(isHostedAssistantProfileReady(providerOnlyProfile), true)
  assert.equal(isHostedAssistantProfileReady(veniceProfile), false)
  assert.equal(isHostedAssistantProfileReady(null), false)
  assert.deepEqual(compileHostedAssistantProfileProviderConfig(readyProfile), {
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.5',
    modelProvider: 'openai',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
  assert.deepEqual(resolveHostedAssistantProviderConfig(config), {
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.5',
    modelProvider: 'openai',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })

  const nullModelProfile = createHostedAssistantProfile({
    id: 'member-null-model',
    providerConfig: {
      provider: 'codex-cli',
      model: null,
      modelProvider: null,
    },
  })
  const nullModelConfig = createHostedAssistantConfig({
    activeProfileId: nullModelProfile.id,
    profiles: [nullModelProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  assert.equal(resolveReadyHostedAssistantProfile(nullModelConfig), null)
  assert.equal(resolveHostedAssistantProviderConfig(nullModelConfig), null)
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState(config), {
    configured: true,
    provider: 'codex-cli',
  })
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState(nullModelConfig), {
    configured: false,
    provider: 'codex-cli',
  })
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState(null), {
    configured: false,
    provider: null,
  })
  assert.throws(() => parseHostedAssistantConfig(null), /required/u)
})

test('hosted assistant bootstrap maps OpenAI env to Codex model provider config', async () => {
  const hostedConfigModule = await loadHostedAssistantModule({
    readOperatorConfigResult: null,
  })

  vi.stubEnv('HOSTED_ASSISTANT_PROVIDER', 'openai')
  vi.stubEnv('HOSTED_ASSISTANT_REASONING_EFFORT', 'medium')
  vi.stubEnv('HOSTED_ASSISTANT_APPROVAL_POLICY', 'never')
  vi.stubEnv('HOSTED_ASSISTANT_SANDBOX', 'danger-full-access')

  const seeded = await hostedConfigModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    homeDirectory: '/tmp/operator-home',
  })

  assert.deepEqual(seeded, {
    configured: true,
    provider: 'codex-cli',
    seeded: true,
    source: 'hosted-env',
  })
  assert.equal(hostedConfigModule.saveHostedAssistantConfig.mock.calls.length, 1)
  assert.equal(
    hostedConfigModule.saveHostedAssistantConfig.mock.calls[0]?.[1],
    '/tmp/operator-home',
  )

  const savedProfile = hostedConfigModule.saveHostedAssistantConfig.mock.calls[0]?.[0]
    ?.profiles?.[0]
  assertCodexOpenAiProfile(savedProfile, {
    reasoningEffort: 'medium',
  })
  assert.equal(
    OPENAI_CODEX_MODEL_PROVIDER_CONFIG.envKey,
    'OPENAI_API_KEY',
  )
})

test('hosted assistant bootstrap rejects removed local Codex bridge env', async () => {
  const hostedConfigModule = await loadHostedAssistantModule({
    readOperatorConfigResult: null,
  })

  await assert.rejects(
    () =>
      hostedConfigModule.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'local-codex',
          HOSTED_ASSISTANT_REASONING_EFFORT: 'medium',
          HOSTED_ASSISTANT_APPROVAL_POLICY: 'never',
          HOSTED_ASSISTANT_SANDBOX: 'danger-full-access',
        },
      }),
    (error) =>
      error instanceof hostedConfigModule.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      error.message.includes('HOSTED_ASSISTANT_PROVIDER=local-codex') &&
      error.message.includes('HOSTED_ASSISTANT_PROVIDER=openai') &&
      error.message.includes('OPENAI_API_KEY'),
  )
  assert.equal(hostedConfigModule.saveHostedAssistantConfig.mock.calls.length, 0)
})

test('hosted assistant bootstrap returns missing or invalid states and throws required errors', async () => {
  const hostedConfigModule = await loadHostedAssistantModule({
    readOperatorConfigResult: null,
  })
  const {
    HostedAssistantConfigurationError,
    ensureHostedAssistantOperatorDefaults,
  } = hostedConfigModule

  assert.deepEqual(
    await ensureHostedAssistantOperatorDefaults({
      allowMissing: true,
      env: {},
    }),
    {
      configured: false,
      provider: null,
      seeded: false,
      source: 'missing',
    },
  )

  await assert.rejects(
    () =>
      ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {},
      }),
    (error) =>
      error instanceof HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_REQUIRED' &&
      /HOSTED_ASSISTANT_PROVIDER/u.test(error.message),
  )

  const invalidModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: null,
      hostedAssistantInvalid: true,
    },
  })

  assert.deepEqual(
    await invalidModule.ensureHostedAssistantOperatorDefaults({
      allowMissing: true,
      env: {},
    }),
    {
      configured: false,
      provider: null,
      seeded: false,
      source: 'invalid',
    },
  )

  await assert.rejects(
    () =>
      invalidModule.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {},
      }),
    (error) =>
      error instanceof invalidModule.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /present but invalid/u.test(error.message),
  )
})

test('hosted assistant bootstrap updates platform Codex profiles from hosted env', async () => {
  const existingPlatformProfile = createHostedAssistantProfile({
    id: 'platform-default',
    managedBy: 'platform',
    providerConfig: {
      provider: 'codex-cli',
      model: 'gpt-5.4',
      modelProvider: 'openai',
    },
  })
  const existingConfig = createHostedAssistantConfig({
    activeProfileId: existingPlatformProfile.id,
    profiles: [existingPlatformProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  const updatedModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: existingConfig,
      hostedAssistantInvalid: false,
    },
  })
  const updated = await updatedModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    env: {
      HOSTED_ASSISTANT_PROVIDER: 'openai',
    },
  })
  assert.deepEqual(updated, {
    configured: true,
    provider: 'codex-cli',
    seeded: true,
    source: 'hosted-env',
  })
  assert.equal(updatedModule.saveHostedAssistantConfig.mock.calls.length, 1)
  assertCodexOpenAiProfile(updatedModule.saveHostedAssistantConfig.mock.calls[0]?.[0]?.profiles?.[0])

  const unchangedModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: createHostedAssistantConfig({
        activeProfileId: existingPlatformProfile.id,
        profiles: [
          createHostedAssistantProfile({
            id: 'platform-default',
            managedBy: 'platform',
            providerConfig: {
              approvalPolicy: 'never',
              provider: 'codex-cli',
              model: 'gpt-5.5',
              modelProvider: 'openai',
              reasoningEffort: 'low',
              sandbox: 'danger-full-access',
            },
          }),
        ],
        updatedAt: '2026-04-08T10:00:00.000Z',
      }),
      hostedAssistantInvalid: false,
    },
  })
  const unchanged = await unchangedModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    env: {
      HOSTED_ASSISTANT_PROVIDER: 'openai',
    },
  })
  assert.deepEqual(unchanged, {
    configured: true,
    provider: 'codex-cli',
    seeded: false,
    source: 'saved',
  })
  assert.equal(unchangedModule.saveHostedAssistantConfig.mock.calls.length, 0)
})

test('hosted assistant bootstrap rejects unsupported hosted provider aliases', async () => {
  const moduleWithProfile = await loadHostedAssistantModule({
    readOperatorConfigResult: null,
  })

  for (const provider of ['codex-cli', 'not-a-provider', 'venice']) {
    await assert.rejects(
      () =>
        moduleWithProfile.ensureHostedAssistantOperatorDefaults({
          allowMissing: false,
          env: {
            HOSTED_ASSISTANT_PROVIDER: provider,
            HOSTED_ASSISTANT_MODEL: 'gpt-5',
          },
        }),
      (error) =>
        error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
        error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
        /openai/u.test(error.message),
    )
  }

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5.5',
          HOSTED_ASSISTANT_BASE_URL: 'https://gateway.internal.test/v1',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_BASE_URL cannot be used/u.test(error.message),
  )
})
