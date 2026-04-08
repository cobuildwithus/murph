import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  createHostedAssistantConfig,
  createHostedAssistantProfile,
} from '../src/assistant/hosted-config.ts'
import { importWithMocks } from './import-with-mocks.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function loadHostedAssistantModule(options?: {
  readOperatorConfigResult?: unknown
  saveHostedAssistantConfigImpl?: (config: unknown, homeDirectory: string | undefined) => Promise<unknown>
}) {
  vi.doUnmock('../src/operator-config.ts')

  const readOperatorConfig = vi.fn(async () => options?.readOperatorConfigResult ?? null)
  const saveHostedAssistantConfig = vi.fn(
    options?.saveHostedAssistantConfigImpl ??
      (async (config: unknown) => ({ hostedAssistant: config })),
  )

  const module = await importWithMocks('../src/hosted-assistant-config.ts', () => {
    vi.doMock('../src/operator-config.ts', () => ({
      readOperatorConfig,
      saveHostedAssistantConfig,
    }))
  })
  return {
    ...module,
    readOperatorConfig,
    saveHostedAssistantConfig,
  }
}

test('hosted assistant config parsing and readiness helpers normalize expected shapes', async () => {
  const hostedConfigModule = await loadHostedAssistantModule()
  const {
    HOSTED_ASSISTANT_API_KEY_ENV,
    compileHostedAssistantProfileProviderConfig,
    isHostedAssistantProfileReady,
    parseHostedAssistantConfig,
    parseHostedAssistantConfigJson,
    prepareHostedAssistantConfigForWrite,
    readHostedAssistantApiKeyEnvName,
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
      provider: 'openai-compatible',
      apiKeyEnv: ' OPENAI_API_KEY ',
      baseUrl: ' https://api.openai.com/v1 ',
      model: ' gpt-5 ',
    },
  })
  const incompleteProfile = createHostedAssistantProfile({
    id: 'member-incomplete',
    providerConfig: {
      provider: 'openai-compatible',
      baseUrl: ' https://gateway.example.test/v1 ',
      providerName: 'Gateway',
    },
  })
  const config = createHostedAssistantConfig({
    activeProfileId: readyProfile.id,
    profiles: [readyProfile, incompleteProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  assert.deepEqual(parseHostedAssistantConfig(config), config)
  assert.deepEqual(parseHostedAssistantConfigJson(JSON.stringify(config)), config)
  assert.equal(tryParseHostedAssistantConfig('bad-json-shape'), null)
  assert.deepEqual(prepareHostedAssistantConfigForWrite(config), config)
  assert.equal(readHostedAssistantApiKeyEnvName({ [HOSTED_ASSISTANT_API_KEY_ENV]: ' OPENAI_API_KEY ' }), 'OPENAI_API_KEY')
  assert.equal(readHostedAssistantApiKeyEnvName({ [HOSTED_ASSISTANT_API_KEY_ENV]: '   ' }), null)
  assert.deepEqual(resolveHostedAssistantProfile(config, ' platform-default '), readyProfile)
  assert.equal(resolveHostedAssistantProfile(config, 'missing'), null)
  assert.equal(resolveHostedAssistantProfile(config, '   '), null)
  assert.deepEqual(resolveActiveHostedAssistantProfile(config), readyProfile)
  assert.deepEqual(resolveReadyHostedAssistantProfile(config), readyProfile)
  assert.equal(resolveReadyHostedAssistantProfile(null), null)
  assert.equal(isHostedAssistantProfileReady(incompleteProfile), false)
  assert.equal(isHostedAssistantProfileReady(null), false)
  assert.deepEqual(compileHostedAssistantProfileProviderConfig(readyProfile), {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    headers: null,
    model: 'gpt-5',
    provider: 'openai-compatible',
    providerName: null,
    reasoningEffort: null,
  })
  assert.deepEqual(resolveHostedAssistantProviderConfig(config), {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    headers: null,
    model: 'gpt-5',
    provider: 'openai-compatible',
    providerName: null,
    reasoningEffort: null,
  })
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState(config), {
    configured: true,
    provider: 'openai-compatible',
  })
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState({ profiles: 'bad' }), {
    configured: false,
    provider: null,
  })
  assert.deepEqual(
    resolveHostedAssistantOperatorDefaultsState(
      createHostedAssistantConfig({
        activeProfileId: incompleteProfile.id,
        profiles: [incompleteProfile],
        updatedAt: '2026-04-08T10:00:00.000Z',
      }),
    ),
    {
      configured: false,
      provider: 'openai-compatible',
    },
  )
  assert.throws(() => parseHostedAssistantConfig(null), /required/u)
})

test('hosted assistant bootstrap reads process env and accepts valid boolean and enum values', async () => {
  const hostedConfigModule = await loadHostedAssistantModule({
    readOperatorConfigResult: null,
  })

  vi.stubEnv('HOSTED_ASSISTANT_PROVIDER', 'openai')
  vi.stubEnv('HOSTED_ASSISTANT_MODEL', 'gpt-5')
  vi.stubEnv('HOSTED_ASSISTANT_REASONING_EFFORT', 'high')

  const seeded = await hostedConfigModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
  })

  assert.deepEqual(seeded, {
    configured: true,
    provider: 'openai-compatible',
    seeded: true,
    source: 'hosted-env',
  })

  await assert.rejects(
    () =>
      hostedConfigModule.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
          HOSTED_ASSISTANT_REASONING_EFFORT: 'high',
          HOSTED_ASSISTANT_OSS: 'enabled',
        },
      }),
    (error) =>
      error instanceof hostedConfigModule.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_OSS cannot be used/u.test(error.message),
  )

  await assert.rejects(
    () =>
      hostedConfigModule.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
          HOSTED_ASSISTANT_OSS: 'disabled',
        },
      }),
    (error) =>
      error instanceof hostedConfigModule.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_OSS cannot be used/u.test(error.message),
  )

  await assert.rejects(
    () =>
      hostedConfigModule.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
          HOSTED_ASSISTANT_APPROVAL_POLICY: 'never',
        },
      }),
    (error) =>
      error instanceof hostedConfigModule.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_APPROVAL_POLICY cannot be used/u.test(error.message),
  )
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

test('hosted assistant bootstrap seeds or updates platform profiles from hosted env', async () => {
  const existingPlatformProfile = createHostedAssistantProfile({
    id: 'platform-default',
    managedBy: 'platform',
    providerConfig: {
      provider: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      providerName: 'openai',
    },
  })
  const existingConfig = createHostedAssistantConfig({
    activeProfileId: existingPlatformProfile.id,
    profiles: [existingPlatformProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  const seededModule = await loadHostedAssistantModule({
    readOperatorConfigResult: null,
  })
  const seeded = await seededModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    env: {
      HOSTED_ASSISTANT_PROVIDER: 'openai',
      HOSTED_ASSISTANT_MODEL: 'gpt-5',
    },
    homeDirectory: '/tmp/operator-home',
  })
  assert.deepEqual(seeded, {
    configured: true,
    provider: 'openai-compatible',
    seeded: true,
    source: 'hosted-env',
  })
  assert.equal(seededModule.saveHostedAssistantConfig.mock.calls.length, 1)
  assert.equal(
    seededModule.saveHostedAssistantConfig.mock.calls[0]?.[1],
    '/tmp/operator-home',
  )

  const updatedModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: existingConfig,
      hostedAssistantInvalid: false,
    },
  })
  const updated = await updatedModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    env: {
      HOSTED_ASSISTANT_PROVIDER: 'openrouter',
      HOSTED_ASSISTANT_MODEL: 'openrouter/auto',
    },
  })
  assert.deepEqual(updated, {
    configured: true,
    provider: 'openai-compatible',
    seeded: true,
    source: 'hosted-env',
  })
  assert.equal(updatedModule.saveHostedAssistantConfig.mock.calls.length, 1)

  const unchangedModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: existingConfig,
      hostedAssistantInvalid: false,
    },
  })
  const unchanged = await unchangedModule.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    env: {
      HOSTED_ASSISTANT_PROVIDER: 'openai',
      HOSTED_ASSISTANT_MODEL: 'gpt-4.1',
    },
  })
  assert.deepEqual(unchanged, {
    configured: true,
    provider: 'openai-compatible',
    seeded: false,
    source: 'saved',
  })
  assert.equal(unchangedModule.saveHostedAssistantConfig.mock.calls.length, 0)
})

test('hosted assistant bootstrap validates env combinations and unsupported provider settings', async () => {
  const existingIncompletePlatformProfile = createHostedAssistantProfile({
    id: 'platform-default',
    managedBy: 'platform',
    providerConfig: {
      provider: 'openai-compatible',
      baseUrl: 'https://gateway.example.test/v1',
      providerName: 'Gateway',
    },
  })
  const existingIncompleteConfig = createHostedAssistantConfig({
    activeProfileId: existingIncompletePlatformProfile.id,
    profiles: [existingIncompletePlatformProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })

  const moduleWithProfile = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: existingIncompleteConfig,
      hostedAssistantInvalid: false,
    },
  })

  const adopted = await moduleWithProfile.ensureHostedAssistantOperatorDefaults({
    allowMissing: false,
    env: {
      HOSTED_ASSISTANT_PROVIDER: 'OpenRouter',
      HOSTED_ASSISTANT_MODEL: 'openrouter/auto',
    },
  })
  assert.deepEqual(adopted, {
    configured: true,
    provider: 'openai-compatible',
    seeded: true,
    source: 'hosted-env',
  })

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_PROVIDER is required/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_MODEL must be configured/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'custom',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_BASE_URL must be configured/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
          HOSTED_ASSISTANT_CODEX_COMMAND: 'codex',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /HOSTED_ASSISTANT_CODEX_COMMAND cannot be used/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
          HOSTED_ASSISTANT_OSS: 'sometimes',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /boolean value/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'openai',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
          HOSTED_ASSISTANT_REASONING_EFFORT: 'extreme',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /must be one of/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'codex-cli',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /not supported for hosted assistant execution/u.test(error.message),
  )

  await assert.rejects(
    () =>
      moduleWithProfile.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {
          HOSTED_ASSISTANT_PROVIDER: 'not-a-provider',
          HOSTED_ASSISTANT_MODEL: 'gpt-5',
        },
      }),
    (error) =>
      error instanceof moduleWithProfile.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /supported OpenAI-compatible provider alias/u.test(error.message),
  )

  const memberProfile = createHostedAssistantProfile({
    id: 'member-profile',
    providerConfig: {
      provider: 'openai-compatible',
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-4.1',
      providerName: 'Gateway',
    },
  })
  const memberConfig = createHostedAssistantConfig({
    activeProfileId: memberProfile.id,
    profiles: [memberProfile],
    updatedAt: '2026-04-08T10:00:00.000Z',
  })
  const memberModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: memberConfig,
      hostedAssistantInvalid: false,
    },
  })

  assert.deepEqual(
    await memberModule.ensureHostedAssistantOperatorDefaults({
      allowMissing: true,
      env: {},
    }),
    {
      configured: true,
      provider: 'openai-compatible',
      seeded: false,
      source: 'saved',
    },
  )

  const invalidReadyModule = await loadHostedAssistantModule({
    readOperatorConfigResult: {
      hostedAssistant: existingIncompleteConfig,
      hostedAssistantInvalid: false,
    },
  })

  await assert.rejects(
    () =>
      invalidReadyModule.ensureHostedAssistantOperatorDefaults({
        allowMissing: false,
        env: {},
      }),
    (error) =>
      error instanceof invalidReadyModule.HostedAssistantConfigurationError &&
      error.code === 'HOSTED_ASSISTANT_CONFIG_INVALID' &&
      /does not define a ready active profile/u.test(error.message),
  )
})
