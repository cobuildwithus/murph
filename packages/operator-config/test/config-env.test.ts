import assert from 'node:assert/strict'

import * as z from '@murphai/contracts/zod-runtime'
import { test } from 'vitest'

import {
  assistantBackendTargetsEqual,
  createAssistantBackendTarget,
  normalizeAssistantBackendTarget,
} from '../src/assistant-backend.ts'
import {
  DEFAULT_MURPH_CODEX_REASONING_EFFORT,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'
import {
  assistantSessionIdSchema,
  assistantStatusAutomationSchema,
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  emptyArgsSchema,
  firstString,
  httpBaseUrlSchema,
  normalizeHttpBaseUrlOption,
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
import {
  applySetupRuntimeEnvOverridesToProcess,
  describeSelectedSetupWearables,
  describeSetupChannelStatus,
  resolveSetupChannelMissingEnv,
  resolveSetupWearableMissingEnv,
} from '../src/setup-runtime-env.ts'
import {
  normalizeSetupWearables,
  setupCommandOptionsSchema,
} from '../src/setup-cli-contracts.ts'
import {
  timeZoneSchema,
  workoutFormatListResultSchema,
} from '../src/vault-cli-contracts.ts'

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
    WHOOP_CLIENT_ID: '  whoop-id  ',
    TELEGRAM_BOT_TOKEN: '   telegram-bot-token   ',
  }

  assert.equal(readEnvValue(env, ['TELEGRAM_BOT_TOKEN', 'WHOOP_CLIENT_ID']), 'telegram-bot-token')
  assert.deepEqual(resolveSetupChannelMissingEnv('telegram', env), [])
  assert.deepEqual(describeSetupChannelStatus('telegram', env, 'darwin'), {
    badge: 'ready',
    detail: 'Bot token is available in the current environment.',
    missingEnv: [],
    ready: true,
  })
})

test('setup wearables are deduplicated, sorted, and keyed off trimmed env values', () => {
  const env: NodeJS.ProcessEnv = {
    JUNCTION_API_KEY: '  sk_us_junction-test  ',
    JUNCTION_CLIENT_USER_ID_SECRET: '  junction-user-secret  ',
    JUNCTION_ENV: 'sandbox',
    JUNCTION_REGION: '   ',
    OURA_CLIENT_ID: '  oura-id  ',
    OURA_CLIENT_SECRET: '  oura-secret  ',
    WHOOP_CLIENT_ID: '  whoop-id  ',
    WHOOP_CLIENT_SECRET: '  whoop-secret  ',
  }

  assert.deepEqual(resolveSetupWearableMissingEnv('garmin', env), ['JUNCTION_REGION'])

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
        missingEnv: ['JUNCTION_REGION'],
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
    /JUNCTION_REGION/u,
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

test('setup command options prefer explicit vault, then VAULT env, then ./vault', async () => {
  await withTemporaryProcessEnv(
    {
      VAULT: '  /env-vault  ',
    },
    async () => {
      assert.equal(
        setupCommandOptionsSchema.parse({ vault: '/explicit-vault' }).vault,
        '/explicit-vault',
      )
      assert.equal(
        setupCommandOptionsSchema.parse({}).vault,
        '/env-vault',
      )
    },
  )

  await withTemporaryProcessEnv(
    {
      VAULT: '   ',
    },
    async () => {
      assert.equal(
        setupCommandOptionsSchema.parse({}).vault,
        './vault',
      )
    },
  )
})

test('command helpers normalize top-level tokens and request ids', () => {
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
  assert.equal(
    resolveEffectiveTopLevelToken([
      '--format=json',
      '--token-limit=10',
      'assistant',
      'status',
    ]),
    'assistant',
  )
  assert.equal(
    resolveEffectiveTopLevelToken([
      '--filter-output=result',
      '--token-offset=5',
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

test('command helper option schemas reject unsafe base URLs and env names', () => {
  assert.equal(
    normalizeHttpBaseUrlOption(' http://127.0.0.1:11434/v1/ '),
    'http://127.0.0.1:11434/v1',
  )
  assert.throws(
    () => httpBaseUrlSchema.parse('https://user:secret@example.test/v1'),
    /embedded credentials/u,
  )
  assert.throws(
    () => httpBaseUrlSchema.parse('https://example.test/v1?token=secret'),
    /query parameters/u,
  )
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
    modelProvider: null,
    oss: true,
    profile: 'default',
    reasoningEffort: DEFAULT_MURPH_CODEX_REASONING_EFFORT,
    sandbox: 'workspace-write',
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
  assert.throws(
    () =>
      serializeAssistantProviderSessionOptions({
        provider: 'unsupported-provider',
        model: 'gpt-5.4',
      }),
    /Assistant runtime targets must use Codex App Server/u,
  )
  const parsedAssistantSession = parseAssistantSessionRecord({
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
      schema: 'murph.assistant-session.v1',
      sessionId: 'session_1',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: null,
        reasoningEffort: 'high',
        sandbox: 'danger-full-access',
      },
      turnCount: 3,
      updatedAt: '2026-04-08T12:05:00.000Z',
    })
  assert.deepEqual(parsedAssistantSession.resumeState, {
    routeFingerprint: 'route-1',
    threadId: 'provider-session',
  })
  assert.deepEqual(parsedAssistantSession.providerOptions, {
    approvalPolicy: 'never',
    continuityFingerprint: serializeAssistantProviderSessionOptions({
      provider: 'codex-cli',
      approvalPolicy: 'never',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
      sandbox: 'danger-full-access',
    }).continuityFingerprint,
    executionDriver: 'codex-app-server',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'high',
    resumeKind: 'codex-thread',
    sandbox: 'danger-full-access',
  })
  assert.deepEqual(
    assistantStatusAutomationSchema.parse({
      autoReply: [
        {
          channel: 'telegram',
          enabledAt: '2026-04-08T12:05:00.000Z',
          eligibleAfter: {
            createdAt: null,
            inputId: 'input-1',
            occurredAt: '2026-04-08T12:05:00.000Z',
            sourceKind: 'inbox-capture',
          },
        },
      ],
      updatedAt: '2026-04-08T12:10:00.000Z',
    }).autoReply,
    [
      {
        channel: 'telegram',
        enabledAt: '2026-04-08T12:05:00.000Z',
        eligibleAfter: {
          createdAt: null,
          inputId: 'input-1',
          occurredAt: '2026-04-08T12:05:00.000Z',
          sourceKind: 'inbox-capture',
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
      schema: 'murph.assistant-session.v1',
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
    }).resumeState,
    null,
  )
  assert.throws(
    () =>
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
        schema: 'murph.assistant-session.v1',
        sessionId: 'session_route_only',
        target: {
          adapter: 'unsupported-provider',
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
      }),
  )
})

test('hosted assistant config normalization keeps the active Codex profile ready', () => {
  const normalizedConfig = normalizeHostedAssistantConfig({
    activeProfileId: ' platform-profile ',
    profiles: [
      {
        id: ' platform-profile ',
        label: ' ',
        managedBy: 'platform',
        target: {
          adapter: 'codex-cli',
          approvalPolicy: null,
          codexCommand: null,
          model: '  gpt-5.6-terra  ',
          modelProvider: '  openai  ',
          oss: false,
          profile: null,
          reasoningEffort: 'high',
          sandbox: null,
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
          adapter: 'codex-cli',
          approvalPolicy: null,
          codexCommand: null,
          model: 'gpt-5.6-terra',
          modelProvider: 'openai',
          oss: false,
          profile: null,
          reasoningEffort: 'high',
          sandbox: null,
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
    approvalPolicy: null,
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.6-terra',
    modelProvider: 'openai',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: 'high',
    sandbox: null,
  })
  assert.deepEqual(resolveHostedAssistantOperatorDefaultsState(normalizedConfig), {
    configured: true,
    provider: 'codex-cli',
  })
  assert.equal(
    readHostedAssistantApiKeyEnvName({
      OPENAI_API_KEY: 'secret-value',
    }),
    'OPENAI_API_KEY',
  )
  assert.equal(
    readHostedAssistantApiKeyEnvName({
      [HOSTED_ASSISTANT_API_KEY_ENV]: '  OPENAI_API_KEY  ',
    }),
    null,
  )
  assert.throws(
    () => parseHostedAssistantConfig(null),
    TypeError,
  )
})
