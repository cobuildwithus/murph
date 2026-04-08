import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assistantBackendTargetsEqual,
  createAssistantBackendTarget,
  normalizeAssistantBackendTarget,
  sanitizeAssistantBackendTargetForPersistence,
} from '../src/assistant-backend.ts'
import {
  firstString,
  parseHeadersJsonOption,
  requestIdFromOptions,
  resolveEffectiveTopLevelToken,
} from '../src/command-helpers.ts'
import { readEnvValue } from '../src/env-values.ts'
import {
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_CONFIG_SCHEMA,
  parseHostedAssistantConfig,
  readHostedAssistantApiKeyEnvName,
  resolveHostedAssistantOperatorDefaultsState,
  resolveHostedAssistantProfile,
  resolveHostedAssistantProviderConfig,
  resolveReadyHostedAssistantProfile,
  tryParseHostedAssistantConfig,
} from '../src/hosted-assistant-config.ts'
import { normalizeHostedAssistantConfig } from '../src/assistant/hosted-config.ts'
import {
  applySetupRuntimeEnvOverridesToProcess,
  describeSelectedSetupWearables,
  describeSetupChannelStatus,
  resolveSetupChannelMissingEnv,
  resolveSetupWearableMissingEnv,
} from '../src/setup-runtime-env.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

async function withTemporaryProcessEnv(
  entries: Record<string, string | undefined>,
  run: () => void | Promise<void>,
): Promise<void> {
  const originalValues = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(entries)) {
    originalValues.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    await run()
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('setup env helpers trim values, report missing keys, and surface platform readiness', () => {
  const env: NodeJS.ProcessEnv = {
    AGENTMAIL_API_KEY: '  agentmail-key  ',
    LINQ_API_TOKEN: '  linq-token  ',
    LINQ_WEBHOOK_SECRET: '   ',
    TELEGRAM_BOT_TOKEN: '   telegram-bot-token   ',
  }

  assert.equal(readEnvValue(env, ['TELEGRAM_BOT_TOKEN', 'AGENTMAIL_API_KEY']), 'telegram-bot-token')
  assert.deepEqual(resolveSetupChannelMissingEnv('telegram', env), [])
  assert.deepEqual(resolveSetupChannelMissingEnv('linq', env), ['LINQ_WEBHOOK_SECRET'])
  assert.deepEqual(resolveSetupChannelMissingEnv('email', env), [])
  const imessageDarwinStatus = describeSetupChannelStatus('imessage', env, 'darwin')
  const imessageLinuxStatus = describeSetupChannelStatus('imessage', env, 'linux')

  assert.equal(imessageDarwinStatus.badge, 'ready')
  assert.equal(imessageDarwinStatus.ready, true)
  assert.deepEqual(imessageDarwinStatus.missingEnv, [])
  assert.match(imessageDarwinStatus.detail, /Messages\.app/u)
  assert.equal(imessageLinuxStatus.badge, 'macOS only')
  assert.equal(imessageLinuxStatus.ready, false)
  assert.match(imessageLinuxStatus.detail, /macOS host/u)
})

test('setup wearables are deduplicated, sorted, and keyed off trimmed env values', () => {
  const env: NodeJS.ProcessEnv = {
    GARMIN_CLIENT_ID: '  garmin-id  ',
    GARMIN_CLIENT_SECRET: '   ',
    OURA_CLIENT_ID: '  oura-id  ',
    OURA_CLIENT_SECRET: '  oura-secret  ',
    WHOOP_CLIENT_ID: '  whoop-id  ',
    WHOOP_CLIENT_SECRET: '  whoop-secret  ',
  }

  assert.deepEqual(resolveSetupWearableMissingEnv('garmin', env), ['GARMIN_CLIENT_SECRET'])

  const configuredWearables = describeSelectedSetupWearables({
    env,
    wearables: ['whoop', 'garmin', 'oura', 'whoop'],
  })

  assert.deepEqual(
    configuredWearables.map(({ wearable, ready, missingEnv }) => ({
      missingEnv,
      ready,
      wearable,
    })),
    [
      {
        missingEnv: ['GARMIN_CLIENT_SECRET'],
        ready: false,
        wearable: 'garmin',
      },
      {
        missingEnv: [],
        ready: true,
        wearable: 'oura',
      },
      {
        missingEnv: [],
        ready: true,
        wearable: 'whoop',
      },
    ],
  )
  assert.match(
    configuredWearables[0]?.detail ?? '',
    /GARMIN_CLIENT_SECRET/u,
  )
})

test('applySetupRuntimeEnvOverridesToProcess only writes trimmed non-empty overrides', async () => {
  await withTemporaryProcessEnv(
    {
      MURPH_OPERATOR_CONFIG_TEST_KEEP: 'keep-me',
      MURPH_OPERATOR_CONFIG_TEST_NEW: undefined,
      MURPH_OPERATOR_CONFIG_TEST_SET: 'original',
    },
    async () => {
      applySetupRuntimeEnvOverridesToProcess({
        MURPH_OPERATOR_CONFIG_TEST_KEEP: '   ',
        MURPH_OPERATOR_CONFIG_TEST_NEW: 'new-value',
        MURPH_OPERATOR_CONFIG_TEST_SET: '  updated  ',
      })

      assert.equal(process.env.MURPH_OPERATOR_CONFIG_TEST_KEEP, 'keep-me')
      assert.equal(process.env.MURPH_OPERATOR_CONFIG_TEST_NEW, 'new-value')
      assert.equal(process.env.MURPH_OPERATOR_CONFIG_TEST_SET, '  updated  ')
    },
  )
})

test('command helpers normalize top-level tokens, request ids, and JSON headers', () => {
  const headers = parseHeadersJsonOption(
    '{"Authorization":"Bearer abcdefghijklmnop","X-Trace":" trace-id "}',
  )

  assert.deepEqual(headers, {
    Authorization: 'Bearer abcdefghijklmnop',
    'X-Trace': ' trace-id ',
  })
  assert.throws(
    () => parseHeadersJsonOption('[]'),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'invalid_payload' &&
      error.message === 'headersJson must be a JSON object with string values.',
  )
  assert.equal(
    resolveEffectiveTopLevelToken([
      '--format',
      'json',
      '--token-limit',
      '10',
      'assistant',
      'status',
    ]),
    'assistant',
  )
  assert.equal(resolveEffectiveTopLevelToken(['--format', 'json', '--', 'show']), 'show')
  assert.equal(firstString({ a: '   ', b: '  keep-me  ' }, ['a', 'b']), 'keep-me')
  assert.equal(
    requestIdFromOptions({ requestId: 'req-123', vault: '/vault' }),
    'req-123',
  )
  assert.equal(requestIdFromOptions({ vault: '/vault' }), null)
})

test('assistant backend targets trim config input and strip sensitive headers before persistence', () => {
  const normalizedCodexTarget = normalizeAssistantBackendTarget({
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: '  codex  ',
    codexHome: '  /tmp/codex-home  ',
    model: '  gpt-4o  ',
    oss: true,
    profile: '  default  ',
    sandbox: 'workspace-write',
  })

  assert.deepEqual(normalizedCodexTarget, {
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome: '/tmp/codex-home',
    model: 'gpt-4o',
    oss: true,
    profile: 'default',
    reasoningEffort: 'medium',
    sandbox: 'workspace-write',
  })

  const persistedOpenAiTarget = sanitizeAssistantBackendTargetForPersistence({
    adapter: 'openai-compatible',
    apiKeyEnv: '  OPENAI_API_KEY  ',
    endpoint: '  https://api.example.com/v1  ',
    headers: {
      Authorization: 'Bearer abcdefghijklmnop',
      'X-Empty': '   ',
      'X-Trace': ' trace-id ',
    },
    model: '  gpt-4o  ',
    providerName: '  Example Provider  ',
    reasoningEffort: 'high',
  })

  assert.deepEqual(persistedOpenAiTarget, {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://api.example.com/v1',
    headers: {
      'X-Trace': 'trace-id',
    },
    model: 'gpt-4o',
    providerName: 'Example Provider',
    reasoningEffort: 'high',
  })
  assert.equal(
    assistantBackendTargetsEqual(
      normalizedCodexTarget,
      createAssistantBackendTarget({
        approvalPolicy: 'never',
        codexCommand: 'codex',
        codexHome: '/tmp/codex-home',
        model: 'gpt-4o',
        oss: true,
        profile: 'default',
        provider: 'codex-cli',
        sandbox: 'workspace-write',
      }),
    ),
    true,
  )
})

test('hosted assistant config normalization keeps the active profile ready and strips secret headers', () => {
  const normalizedConfig = normalizeHostedAssistantConfig({
    activeProfileId: ' platform-profile ',
    profiles: [
      {
        id: ' platform-profile ',
        label: ' ',
        managedBy: 'platform',
        target: {
          adapter: 'openai-compatible',
          apiKeyEnv: '  OPENAI_API_KEY  ',
          endpoint: '  https://api.example.com/v1  ',
          headers: {
            Authorization: 'Bearer abcdefghijklmnop',
            'X-Trace': ' trace-id ',
          },
          model: '  gpt-4o  ',
          providerName: ' ',
          reasoningEffort: 'high',
        },
      },
    ],
    schema: HOSTED_ASSISTANT_CONFIG_SCHEMA,
    updatedAt: '2026-04-08T00:00:00.000Z',
  })

  assert.deepEqual(normalizedConfig, {
    activeProfileId: 'platform-profile',
    profiles: [
      {
        id: 'platform-profile',
        label: 'OpenAI',
        managedBy: 'platform',
        target: {
          adapter: 'openai-compatible',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.example.com/v1',
          headers: {
            'X-Trace': 'trace-id',
          },
          model: 'gpt-4o',
          providerName: null,
          reasoningEffort: 'high',
        },
      },
    ],
    schema: HOSTED_ASSISTANT_CONFIG_SCHEMA,
    updatedAt: '2026-04-08T00:00:00.000Z',
  })
  assert.deepEqual(parseHostedAssistantConfig(normalizedConfig), normalizedConfig)
  assert.equal(
    tryParseHostedAssistantConfig({
      activeProfileId: null,
      profiles: 'oops',
      schema: HOSTED_ASSISTANT_CONFIG_SCHEMA,
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
    null,
  )
  assert.deepEqual(
    resolveHostedAssistantProfile(normalizedConfig, ' platform-profile '),
    normalizedConfig?.profiles[0] ?? null,
  )
  assert.deepEqual(resolveReadyHostedAssistantProfile(normalizedConfig), normalizedConfig?.profiles[0] ?? null)
  assert.deepEqual(resolveHostedAssistantProviderConfig(normalizedConfig), {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.example.com/v1',
    headers: {
      'X-Trace': 'trace-id',
    },
    model: 'gpt-4o',
    provider: 'openai-compatible',
    providerName: null,
    reasoningEffort: 'high',
  })
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState(normalizedConfig), {
    configured: true,
    provider: 'openai-compatible',
  })
  assert.equal(
    readHostedAssistantApiKeyEnvName({
      [HOSTED_ASSISTANT_API_KEY_ENV]: '  OPENAI_API_KEY  ',
    }),
    'OPENAI_API_KEY',
  )
  assert.equal(
    readHostedAssistantApiKeyEnvName({
      [HOSTED_ASSISTANT_API_KEY_ENV]: '   ',
    }),
    null,
  )
  assert.throws(
    () => parseHostedAssistantConfig(null),
    TypeError,
  )
})
