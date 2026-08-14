import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, test } from 'vitest'

import {
  buildAssistantProviderDefaultsPatch,
  applyAssistantSelfDeliveryTargetDefaults,
  clearAssistantSelfDeliveryTargets,
  expandConfiguredVaultPath,
  listAssistantSelfDeliveryTargets,
  normalizeVaultForConfig,
  readOperatorConfig,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  resolveAssistantSelfDeliveryTarget,
  resolveConfiguredDefaultVault,
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
    providerConfig: {
      approvalPolicy: 'never',
      codexHome: ' /tmp/codex-home ',
      model: ' gpt-5.6-terra ',
      modelProvider: ' vercel-ai-gateway ',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
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
      identityId: ' user-123 ',
    },
    homeDirectory,
  )

  assert.equal(savedDefaultsConfig.assistant?.identityId, ' user-123 ')
  assert.deepEqual(
    resolveAssistantProviderDefaults(savedDefaultsConfig.assistant),
    {
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
  )

  const hostedConfig = createHostedAssistantConfig({
    activeProfileId: 'platform-default',
    profiles: [
      createHostedAssistantProfile({
        id: 'platform-default',
        managedBy: 'platform',
        providerConfig: {
          model: 'gpt-5.6-terra',
          modelProvider: 'vercel-ai-gateway',
          provider: 'codex-cli',
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

test('operator config resolves default vaults without owning command argv mutation', async () => {
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
  assert.equal(await resolveConfiguredDefaultVault(homeDirectory), configuredVault)

  await rm(configuredVault, { force: true, recursive: true })
  assert.equal(
    await realpath((await resolveDefaultVault(homeDirectory, {})) ?? ''),
    await realpath(cwdVault),
  )
  assert.equal(await resolveConfiguredDefaultVault(homeDirectory), null)

  await rm(cwdVault, { force: true, recursive: true })
  assert.equal(await resolveDefaultVault(homeDirectory, {}), null)
  assert.equal(await resolveConfiguredDefaultVault(homeDirectory), null)
})

test('operator config saves, sorts, resolves, and clears assistant self-delivery targets', async () => {
  const homeDirectory = await createTempHome('operator-config-self-target-')

  await saveAssistantSelfDeliveryTarget(
    {
      channel: ' Telegram ',
      deliverySource: null,
      deliveryTarget: ' chat-123 ',
      identityId: ' identity-1 ',
      participantId: ' person-1 ',
      threadId: ' source-1 ',
    },
    homeDirectory,
  )
  await saveAssistantSelfDeliveryTarget(
    {
      channel: 'email',
      deliverySource: null,
      deliveryTarget: 'person@example.test',
      identityId: null,
      participantId: null,
      threadId: null,
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
    deliverySource: null,
    deliveryTarget: 'chat-123',
    identityId: 'identity-1',
    participantId: 'person-1',
    threadId: 'source-1',
  })
  assert.equal(await resolveAssistantSelfDeliveryTarget('   ', homeDirectory), null)

  assert.deepEqual(
    await applyAssistantSelfDeliveryTargetDefaults(
      {
        channel: 'telegram',
        deliveryTarget: '  explicit-target  ',
        identityId: '  ',
        participantId: undefined,
        threadId: null,
      },
      undefined,
      homeDirectory,
    ),
    {
      channel: 'telegram',
      deliveryTarget: 'explicit-target',
      identityId: 'identity-1',
      participantId: 'person-1',
      threadId: 'source-1',
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
        threadId: null,
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
      threadId: null,
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
        threadId: ' source-2 ',
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
      threadId: 'source-2',
    },
  )
  assert.deepEqual(await clearAssistantSelfDeliveryTargets(undefined, homeDirectory), [])

  await assert.rejects(
    () =>
      saveAssistantSelfDeliveryTarget(
          {
            channel: '   ',
            deliverySource: null,
            deliveryTarget: 'chat-123',
            identityId: null,
          participantId: null,
          threadId: null,
        },
        homeDirectory,
    ),
    /channel/u,
  )

})

test('assistant self delivery targets treat iMessage as the linq route alias', async () => {
  const homeDirectory = await createTempHome('operator-config-home-')

  await saveAssistantSelfDeliveryTarget(
    {
      channel: ' iMessage ',
      deliverySource: null,
      deliveryTarget: ' chat-123 ',
      identityId: ' identity-1 ',
      participantId: null,
      threadId: ' chat-123 ',
    },
    homeDirectory,
  )

  assert.deepEqual(await listAssistantSelfDeliveryTargets(homeDirectory), [
    {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'chat-123',
      identityId: 'identity-1',
      participantId: null,
      threadId: 'chat-123',
    },
  ])

  assert.deepEqual(await resolveAssistantSelfDeliveryTarget('i-message', homeDirectory), {
    channel: 'linq',
    deliverySource: null,
    deliveryTarget: 'chat-123',
    identityId: 'identity-1',
    participantId: null,
    threadId: 'chat-123',
  })

  assert.deepEqual(
    await applyAssistantSelfDeliveryTargetDefaults(
      {
        channel: 'iMessage',
      },
      { allowSingleSavedTargetFallback: false },
      homeDirectory,
    ),
    {
      channel: 'linq',
      deliveryTarget: 'chat-123',
      identityId: 'identity-1',
      participantId: null,
      threadId: 'chat-123',
    },
  )
})
