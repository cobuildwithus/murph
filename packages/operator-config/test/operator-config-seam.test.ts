import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  buildAssistantProviderDefaultsPatch,
  applyAssistantSelfDeliveryTargetDefaults,
  applyDefaultVaultToArgs,
  clearAssistantSelfDeliveryTargets,
  expandConfiguredVaultPath,
  hasExplicitVaultOption,
  listAssistantSelfDeliveryTargets,
  normalizeVaultForConfig,
  readOperatorConfig,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  resolveAssistantSelfDeliveryTarget,
  resolveDefaultVault,
  resolveHostedAssistantConfig,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  saveAssistantOperatorDefaultsPatch,
  saveAssistantSelfDeliveryTarget,
  saveDefaultVaultConfig,
  saveHostedAssistantConfig,
} from '../src/operator-config.ts'
import {
  createHostedAssistantConfig,
  createHostedAssistantProfile,
} from '../src/assistant/hosted-config.ts'

const tempDirectories = new Set<string>()
const originalCwd = process.cwd()

afterEach(async () => {
  process.chdir(originalCwd)

  for (const directory of tempDirectories) {
    await rm(directory, { force: true, recursive: true })
  }

  tempDirectories.clear()
})

async function createTempHome(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirectories.add(directory)
  return directory
}

test('operator config persists defaults, hosted config, and invalid hosted payload flags', async () => {
  const homeDirectory = await createTempHome('operator-config-home-')
  const nestedVault = path.join(homeDirectory, 'vaults', 'primary')
  await mkdir(nestedVault, { recursive: true })

  assert.equal(resolveOperatorHomeDirectory({ HOME: ` ${homeDirectory} ` }), homeDirectory)
  assert.equal(resolveOperatorHomeDirectory({ HOME: '   ' }), path.resolve(os.homedir()))
  assert.equal(normalizeVaultForConfig(nestedVault, homeDirectory), '~/vaults/primary')
  assert.equal(expandConfiguredVaultPath('~/vaults/primary', homeDirectory), nestedVault)

  const savedVaultConfig = await saveDefaultVaultConfig(nestedVault, homeDirectory)
  assert.equal(savedVaultConfig.defaultVault, '~/vaults/primary')

  const providerPatch = buildAssistantProviderDefaultsPatch({
    defaults: null,
    provider: 'openai-compatible',
    providerConfig: {
      apiKeyEnv: ' OPENAI_API_KEY ',
      baseUrl: ' https://api.example.test/v1 ',
      headers: {
        authorization: 'Bearer should-not-persist',
        'x-trace-id': ' trace-id ',
      },
      model: ' gpt-4.1 ',
      providerName: ' Example API ',
      reasoningEffort: 'medium',
    },
  })

  const savedDefaultsConfig = await saveAssistantOperatorDefaultsPatch(
    {
      ...providerPatch,
      account: {
        kind: 'account',
        planCode: 'pro',
        planName: 'Pro',
        quota: null,
        source: 'billing',
      },
      failoverRoutes: [
        {
          name: 'fallback',
          provider: 'codex-cli',
        },
      ],
      identityId: ' user-123 ',
    },
    homeDirectory,
  )

  assert.equal(savedDefaultsConfig.assistant?.identityId, ' user-123 ')
  assert.deepEqual(
    resolveAssistantProviderDefaults(savedDefaultsConfig.assistant, 'openai-compatible'),
    {
      approvalPolicy: null,
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.example.test/v1',
      codexCommand: null,
      codexHome: null,
      headers: {
        'X-Trace-Id': 'trace-id',
      },
      model: 'gpt-4.1',
      oss: false,
      profile: null,
      providerName: 'Example API',
      reasoningEffort: 'medium',
      sandbox: null,
      zeroDataRetention: null,
    },
  )

  const hostedConfig = createHostedAssistantConfig({
    activeProfileId: 'platform-default',
    profiles: [
      createHostedAssistantProfile({
        id: 'platform-default',
        managedBy: 'platform',
        providerConfig: {
          apiKeyEnv: 'HOSTED_API_KEY',
          baseUrl: 'https://gateway.example.test/v1',
          model: 'gpt-4.1',
          provider: 'openai-compatible',
          providerName: 'Gateway',
        },
      }),
    ],
    updatedAt: '2026-04-08T12:00:00.000Z',
  })

  const savedHostedConfig = await saveHostedAssistantConfig(hostedConfig, homeDirectory)
  assert.deepEqual(savedHostedConfig.hostedAssistant, hostedConfig)

  const resolvedConfigPath = resolveOperatorConfigPath(homeDirectory)
  const rawSavedConfig = await readFile(resolvedConfigPath, 'utf8')
  assert.match(rawSavedConfig, /"defaultVault": "~\/vaults\/primary"/u)
  if (process.platform !== 'win32') {
    const directoryStats = await stat(path.dirname(resolvedConfigPath))
    const fileStats = await stat(resolvedConfigPath)
    assert.equal(directoryStats.mode & 0o777, 0o700)
    assert.equal(fileStats.mode & 0o777, 0o600)
  }

  assert.deepEqual((await readOperatorConfig(homeDirectory))?.hostedAssistant, hostedConfig)
  assert.deepEqual(await resolveHostedAssistantConfig(homeDirectory), hostedConfig)
  assert.equal(
    (await resolveAssistantOperatorDefaults(homeDirectory))?.identityId,
    ' user-123 ',
  )

  await writeFile(
    resolvedConfigPath,
    JSON.stringify({
      assistant: null,
      defaultVault: '~/vaults/primary',
      hostedAssistant: {
        profiles: 'invalid',
      },
      schema: 'murph.operator-config.v1',
      updatedAt: '2026-04-08T12:00:00.000Z',
    }),
  )

  const invalidHostedConfig = await readOperatorConfig(homeDirectory)
  assert.equal(invalidHostedConfig?.hostedAssistant, null)
  assert.equal(invalidHostedConfig?.hostedAssistantInvalid, true)

  await writeFile(
    resolvedConfigPath,
    '{not-json',
    'utf8',
  )
  assert.equal(await readOperatorConfig(homeDirectory), null)
})

test('operator config resolves default vaults and injects them only for eligible command paths', async () => {
  const homeDirectory = await createTempHome('operator-config-vault-')
  const envVault = path.join(homeDirectory, 'env-vault')
  const configuredVault = path.join(homeDirectory, 'configured-vault')
  const cwdDirectory = await createTempHome('operator-config-cwd-')
  const cwdVault = path.join(cwdDirectory, 'vault')

  await mkdir(configuredVault, { recursive: true })
  await mkdir(cwdVault, { recursive: true })

  process.chdir(cwdDirectory)

  assert.equal(
    await resolveDefaultVault(homeDirectory, { VAULT: '~/env-vault' }),
    envVault,
  )

  await saveDefaultVaultConfig(configuredVault, homeDirectory)
  assert.equal(await resolveDefaultVault(homeDirectory, {}), configuredVault)

  await rm(configuredVault, { force: true, recursive: true })
  assert.equal(
    await realpath((await resolveDefaultVault(homeDirectory, {})) ?? ''),
    await realpath(cwdVault),
  )

  await rm(cwdVault, { force: true, recursive: true })
  assert.equal(await resolveDefaultVault(homeDirectory, {}), null)

  assert.equal(hasExplicitVaultOption(['assistant', '--vault', '/tmp/vault']), true)
  assert.equal(hasExplicitVaultOption(['assistant', '--vault=/tmp/vault']), true)
  assert.equal(hasExplicitVaultOption(['assistant', '--', '--vault']), false)

  assert.deepEqual(applyDefaultVaultToArgs(['assistant', 'run'], null), ['assistant', 'run'])
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'run', '--vault', '/tmp/existing'], '/tmp/default'),
    ['assistant', 'run', '--vault', '/tmp/existing'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['--help', 'assistant'], '/tmp/default'),
    ['--help', 'assistant'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['unknown-command'], '/tmp/default'),
    ['unknown-command'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'self-target', 'list'], '/tmp/default'),
    ['assistant', 'self-target', 'list'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant'], '/tmp/default'),
    ['assistant'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'run', '--', '--model', 'gpt-4.1'], '/tmp/default'),
    ['assistant', 'run', '--vault', '/tmp/default', '--', '--model', 'gpt-4.1'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'run'], '/tmp/default'),
    ['assistant', 'run', '--vault', '/tmp/default'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['--format', 'json'], '/tmp/default'),
    ['--format', 'json'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['--format', 'json', 'assistant', 'run'], '/tmp/default'),
    ['--format', 'json', 'assistant', 'run', '--vault', '/tmp/default'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', '--token-offset', '5'], '/tmp/default'),
    ['assistant', '--token-offset', '5'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'self-target', 'clear'], '/tmp/default'),
    ['assistant', 'self-target', 'clear'],
  )
})

test('operator config saves, sorts, resolves, and clears assistant self-delivery targets', async () => {
  const homeDirectory = await createTempHome('operator-config-self-target-')

  await saveAssistantSelfDeliveryTarget(
    {
      channel: ' Telegram ',
      deliveryTarget: ' chat-123 ',
      identityId: ' identity-1 ',
      participantId: ' person-1 ',
      sourceThreadId: ' source-1 ',
    },
    homeDirectory,
  )
  await saveAssistantSelfDeliveryTarget(
    {
      channel: 'email',
      deliveryTarget: 'person@example.test',
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    },
    homeDirectory,
  )

  const targets = await listAssistantSelfDeliveryTargets(homeDirectory)
  assert.deepEqual(
    targets.map((target) => target.channel),
    ['email', 'telegram'],
  )
  assert.deepEqual(await resolveAssistantSelfDeliveryTarget(' TELEGRAM ', homeDirectory), {
    channel: 'telegram',
    deliveryTarget: 'chat-123',
    identityId: 'identity-1',
    participantId: 'person-1',
    sourceThreadId: 'source-1',
  })
  assert.equal(await resolveAssistantSelfDeliveryTarget('   ', homeDirectory), null)

  assert.deepEqual(
    await applyAssistantSelfDeliveryTargetDefaults(
      {
        channel: 'telegram',
        deliveryTarget: '  explicit-target  ',
        identityId: '  ',
        participantId: undefined,
        sourceThreadId: null,
      },
      undefined,
      homeDirectory,
    ),
    {
      channel: 'telegram',
      deliveryTarget: 'explicit-target',
      identityId: 'identity-1',
      participantId: 'person-1',
      sourceThreadId: 'source-1',
    },
  )

  assert.deepEqual(
    await clearAssistantSelfDeliveryTargets('missing', homeDirectory),
    [],
  )
  assert.deepEqual(
    await clearAssistantSelfDeliveryTargets('telegram', homeDirectory),
    ['telegram'],
  )
  assert.deepEqual(
    await applyAssistantSelfDeliveryTargetDefaults(
      {
        channel: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        sourceThreadId: null,
      },
      {
        allowSingleSavedTargetFallback: true,
      },
      homeDirectory,
    ),
    {
      channel: 'email',
      deliveryTarget: 'person@example.test',
      identityId: null,
      participantId: null,
      sourceThreadId: null,
    },
  )
  assert.deepEqual(await clearAssistantSelfDeliveryTargets(undefined, homeDirectory), ['email'])
  assert.equal(await resolveAssistantOperatorDefaults(homeDirectory), null)
})

test('operator config trims explicit self-target defaults and normalizes legacy assistant records', async () => {
  const homeDirectory = await createTempHome('operator-config-legacy-self-target-')

  assert.deepEqual(
    await applyAssistantSelfDeliveryTargetDefaults(
      {
        channel: ' Telegram ',
        deliveryTarget: '  explicit-target  ',
        identityId: ' identity-2 ',
        participantId: ' participant-2 ',
        sourceThreadId: ' source-2 ',
      },
      {
        allowSingleSavedTargetFallback: false,
      },
      homeDirectory,
    ),
    {
      channel: 'telegram',
      deliveryTarget: 'explicit-target',
      identityId: 'identity-2',
      participantId: 'participant-2',
      sourceThreadId: 'source-2',
    },
  )
  assert.deepEqual(await clearAssistantSelfDeliveryTargets(undefined, homeDirectory), [])

  await assert.rejects(
    () =>
      saveAssistantSelfDeliveryTarget(
        {
          channel: '   ',
          deliveryTarget: 'chat-123',
          identityId: null,
          participantId: null,
          sourceThreadId: null,
        },
        homeDirectory,
    ),
    /channel/u,
  )

  await mkdir(path.dirname(resolveOperatorConfigPath(homeDirectory)), {
    recursive: true,
  })
  await writeFile(
    resolveOperatorConfigPath(homeDirectory),
    JSON.stringify({
      assistant: {
        account: {
          kind: 'account',
          planCode: 'pro',
          planName: 'Pro',
          quota: null,
          source: 'billing',
        },
        backend: {
          adapter: 'openai-compatible',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.example.test/v1',
          headers: {
            'X-Trace-Id': 'trace-1',
          },
          model: 'gpt-5.4',
          providerName: 'Example Gateway',
          reasoningEffort: 'high',
        },
        failoverRoutes: [
          {
            approvalPolicy: null,
            baseUrl: null,
            codexCommand: null,
            cooldownMs: null,
            headers: null,
            model: 'gpt-5.4-mini',
            name: 'fallback',
            oss: false,
            profile: null,
            provider: 'openai-compatible',
            providerName: null,
            reasoningEffort: 'medium',
            sandbox: null,
          },
        ],
        identityId: ' operator-123 ',
        selfDeliveryTargets: {
          Telegram: {
            channel: 'telegram',
            deliveryTarget: 'chat-123',
            identityId: 'identity-3',
            participantId: null,
            sourceThreadId: null,
          },
        },
      },
      defaultVault: null,
      hostedAssistant: null,
      schema: 'murph.operator-config.v1',
      updatedAt: '2026-04-08T12:00:00.000Z',
    }),
    'utf8',
  )

  assert.deepEqual((await readOperatorConfig(homeDirectory))?.assistant, {
    account: {
      kind: 'account',
      planCode: 'pro',
      planName: 'Pro',
      quota: null,
      source: 'billing',
    },
    backend: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.example.test/v1',
      headers: {
        'X-Trace-Id': 'trace-1',
      },
      model: 'gpt-5.4',
      providerName: 'Example Gateway',
      reasoningEffort: 'high',
    },
    failoverRoutes: [
      {
        approvalPolicy: null,
        baseUrl: null,
        codexCommand: null,
        cooldownMs: null,
        headers: null,
        model: 'gpt-5.4-mini',
        name: 'fallback',
        oss: false,
        profile: null,
        provider: 'openai-compatible',
        providerName: null,
        reasoningEffort: 'medium',
        sandbox: null,
      },
    ],
    identityId: ' operator-123 ',
    selfDeliveryTargets: {
      telegram: {
        channel: 'telegram',
        deliveryTarget: 'chat-123',
        identityId: 'identity-3',
        participantId: null,
        sourceThreadId: null,
      },
    },
  })
})
