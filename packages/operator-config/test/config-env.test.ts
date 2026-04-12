import assert from 'node:assert/strict'

import { z } from 'zod'
import { test } from 'vitest'

import {
  assistantBackendTargetsEqual,
  createAssistantBackendTarget,
  normalizeAssistantBackendTarget,
  sanitizeAssistantBackendTargetForPersistence,
} from '../src/assistant-backend.ts'
import {
  assistantSessionIdSchema,
  assistantStatusAutomationSchema,
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  emptyArgsSchema,
  firstString,
  parseHeadersJsonOption,
  requestIdFromOptions,
  resolveEffectiveTopLevelToken,
  withBaseOptions,
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
import { resolveAssistantRuntimeTarget } from '../src/assistant/target-runtime.ts'
import {
  applySetupRuntimeEnvOverridesToProcess,
  describeSelectedSetupWearables,
  describeSetupChannelStatus,
  resolveSetupChannelMissingEnv,
  resolveSetupWearableMissingEnv,
} from '../src/setup-runtime-env.ts'
import { normalizeSetupWearables } from '../src/setup-cli-contracts.ts'
import {
  timeZoneSchema,
  workoutFormatListResultSchema,
} from '../src/vault-cli-contracts.ts'
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

test('setup env helpers trim values, report missing keys, and surface channel readiness', () => {
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
  assert.deepEqual(describeSetupChannelStatus('telegram', env, 'darwin'), {
    badge: 'ready',
    detail: 'Bot token is available in the current environment.',
    missingEnv: [],
    ready: true,
  })
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
  assert.deepEqual(
    normalizeSetupWearables(['whoop', 'garmin', 'whoop']),
    ['garmin', 'whoop'],
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
  assert.deepEqual(emptyArgsSchema.parse({}), {})
  assert.deepEqual(
    withBaseOptions({
      extra: z.string().min(1),
    }).parse({
      extra: 'value',
      vault: '/vault',
    }),
    {
      extra: 'value',
      vault: '/vault',
    },
  )
  assert.equal(parseHeadersJsonOption(), undefined)

  const headers = parseHeadersJsonOption(
    '{"Authorization":"Bearer abcdefghijklmnop","X-Trace":" trace-id "}',
  )

  assert.deepEqual(headers, {
    Authorization: 'Bearer abcdefghijklmnop',
    'X-Trace': ' trace-id ',
  })
  assert.throws(
    () => parseHeadersJsonOption('{'),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'invalid_payload' &&
      error.message === 'headersJson must be a valid JSON object.' &&
      typeof error.context?.cause === 'string',
  )
  assert.throws(
    () => parseHeadersJsonOption('[]'),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'invalid_payload' &&
      error.message === 'headersJson must be a JSON object with string values.',
  )
  assert.throws(
    () => parseHeadersJsonOption('{"X-Trace":1}'),
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
  assert.equal(resolveEffectiveTopLevelToken(['', '--token-offset', '5']), null)
  assert.equal(resolveEffectiveTopLevelToken(['--format', 'json', '--', 'show']), 'show')
  assert.equal(firstString({ a: '   ', b: '  keep-me  ' }, ['a', 'b']), 'keep-me')
  assert.equal(firstString({ a: '   ', b: 1 }, ['a', 'b']), null)
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
    presetId: null,
    providerName: '  Example Provider  ',
    reasoningEffort: 'high',
    webSearch: null,
  })

  assert.deepEqual(persistedOpenAiTarget, {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://api.example.com/v1',
    headers: {
      'X-Trace': 'trace-id',
    },
    model: 'gpt-4o',
    presetId: null,
    providerName: 'Example Provider',
    reasoningEffort: 'high',
    webSearch: null,
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

test('representative contract schemas stay wired to the owned setup/operator seams', () => {
  assert.equal(timeZoneSchema.parse('Australia/Sydney'), 'Australia/Sydney')
  assert.equal(timeZoneSchema.safeParse('Not/A_Zone').success, false)
  assert.equal(
    workoutFormatListResultSchema.parse({
      count: 1,
      filters: {
        limit: 25,
      },
      items: [
        {
          data: {},
          id: 'entity-1',
          kind: 'note',
          links: [],
          markdown: null,
          occurredAt: '2026-04-08T12:00:00.000Z',
          path: 'notes/entity-1.md',
          title: 'Entity',
        },
      ],
      nextCursor: null,
      vault: '/vault',
    }).items[0]?.id,
    'entity-1',
  )

  assert.equal(assistantSessionIdSchema.safeParse('session_1').success, true)
  assert.equal(assistantSessionIdSchema.safeParse('../session').success, false)
  assert.deepEqual(
    parseAssistantSessionRecord({
      alias: 'daily',
      binding: {
        actorId: null,
        channel: 'telegram',
        conversationKey: 'conv-1',
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
      },
      createdAt: '2026-04-08T12:00:00.000Z',
      lastTurnAt: null,
      resumeState: {
        providerSessionId: ' provider-session ',
        resumeRouteId: ' route-1 ',
      },
      schema: 'murph.assistant-session.v4',
      sessionId: 'session_1',
      target: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: 'https://api.example.test/v1',
        headers: {
          'X-Trace-Id': 'trace',
        },
        model: 'gpt-5.4',
        presetId: null,
        providerName: 'Example',
        reasoningEffort: 'high',
        webSearch: null,
      },
      turnCount: 3,
      updatedAt: '2026-04-08T12:05:00.000Z',
    }).providerBinding,
    {
      provider: 'openai-compatible',
      providerOptions: {
        apiKeyEnv: 'OPENAI_API_KEY',
        approvalPolicy: null,
        baseUrl: 'https://api.example.test/v1',
        continuityFingerprint: null,
        executionDriver: 'openai-responses',
        headers: {
          'X-Trace-Id': 'trace',
        },
        model: 'gpt-5.4',
        oss: false,
        presetId: null,
        profile: null,
        providerName: 'Example',
        reasoningEffort: 'high',
        resumeKind: null,
        sandbox: null,
      },
      providerSessionId: 'provider-session',
      providerState: {
        resumeRouteId: 'route-1',
      },
    },
  )
  assert.deepEqual(
    assistantStatusAutomationSchema.parse({
      autoReply: [
        {
          channel: 'telegram',
          cursor: {
            captureId: 'capture-1',
            occurredAt: '2026-04-08T12:05:00.000Z',
          },
        },
      ],
      inboxScanCursor: null,
      updatedAt: '2026-04-08T12:10:00.000Z',
    }).autoReply,
    [
      {
        channel: 'telegram',
        cursor: {
          captureId: 'capture-1',
          occurredAt: '2026-04-08T12:05:00.000Z',
        },
      },
    ],
  )
  assert.deepEqual(
    parseAssistantSessionRecord({
      alias: null,
      binding: {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: null,
        threadIsDirect: null,
      },
      createdAt: '2026-04-08T12:00:00.000Z',
      lastTurnAt: null,
      resumeState: null,
      schema: 'murph.assistant-session.v4',
      sessionId: 'session_codex',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: null,
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
      turnCount: 0,
      updatedAt: '2026-04-08T12:05:00.000Z',
    }).providerBinding,
    null,
  )
  assert.deepEqual(
    parseAssistantSessionRecord({
      alias: null,
      binding: {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: null,
        threadIsDirect: null,
      },
      createdAt: '2026-04-08T12:00:00.000Z',
      lastTurnAt: null,
      resumeState: {
        providerSessionId: '   ',
        resumeRouteId: ' route-only ',
      },
      schema: 'murph.assistant-session.v4',
      sessionId: 'session_route_only',
      target: {
        adapter: 'openai-compatible',
        apiKeyEnv: null,
        endpoint: null,
        headers: null,
        model: 'gpt-5.4',
        presetId: null,
        providerName: null,
        reasoningEffort: 'medium',
        webSearch: null,
      },
      turnCount: 1,
      updatedAt: '2026-04-08T12:05:00.000Z',
    }).providerBinding,
    {
      provider: 'openai-compatible',
      providerOptions: {
        approvalPolicy: null,
        continuityFingerprint: null,
        executionDriver: 'openai-compatible',
        model: 'gpt-5.4',
        oss: false,
        presetId: null,
        profile: null,
        reasoningEffort: 'medium',
        resumeKind: null,
        sandbox: null,
      },
      providerSessionId: null,
      providerState: {
        resumeRouteId: 'route-only',
      },
    },
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
          presetId: null,
          providerName: ' ',
          reasoningEffort: 'high',
          webSearch: null,
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
          presetId: null,
          providerName: null,
          reasoningEffort: 'high',
          webSearch: null,
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
    presetId: null,
    provider: 'openai-compatible',
    providerName: null,
    reasoningEffort: 'high',
    webSearch: null,
    zeroDataRetention: null,
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
