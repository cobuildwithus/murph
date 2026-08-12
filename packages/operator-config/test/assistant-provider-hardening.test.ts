import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  parseAssistantSessionRecord,
} from '../src/assistant-cli-contracts.ts'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderOperatorDefaults,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'

test('unsupported assistant config paths fail closed with a Codex runtime error', () => {
  const message = /Assistant runtime targets must use Codex App Server/u

  assert.throws(
    () =>
      normalizeAssistantProviderConfig({
        provider: 'unsupported-provider',
        model: 'gpt-5.4',
      }),
    message,
  )

  assert.throws(
    () =>
      normalizeAssistantProviderConfig(
        JSON.parse(
          JSON.stringify({
            policy: {
              approvalPolicy: null,
              reasoningEffort: 'medium',
              sandbox: null,
            },
            target: {
              kind: 'unsupported-provider',
              baseUrl: 'https://proxy.example.test/v1',
              model: 'gpt-5.4',
              providerName: 'Proxy',
            },
          }),
        ),
      ),
    message,
  )

  assert.throws(
    () =>
      normalizeAssistantProviderConfig(
        JSON.parse(
          JSON.stringify({
            provider: 'unsupported-provider',
            policy: {
              approvalPolicy: null,
              reasoningEffort: 'medium',
              sandbox: null,
            },
            target: {
              codexCommand: null,
              codexHome: null,
              model: 'gpt-5.4',
              modelProvider: null,
              oss: false,
              profile: null,
            },
          }),
        ),
      ),
    message,
  )
})

test('unsupported persisted sessions fail closed during parsing', () => {
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
        createdAt: '2026-04-23T10:00:00.000Z',
        lastTurnAt: null,
        resumeState: null,
        schema: 'murph.assistant-session.v1',
        sessionId: 'session_custom_precedence',
        target: {
          adapter: 'unsupported-provider',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://proxy.example.test/v1',
          headers: null,
          model: 'gpt-5.4',
          presetId: 'legacy',
          providerName: 'Legacy',
          reasoningEffort: 'high',
          webSearch: null,
        },
        turnCount: 1,
        updatedAt: '2026-04-23T10:05:00.000Z',
      }),
  )
})

test('explicit Codex provider inputs serialize only Codex request-shaping fields', () => {
  const codexInput = {
    provider: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: 'codex',
    model: 'gpt-5.6-terra',
    modelProvider: ' vercel-ai-gateway ',
    oss: true,
    profile: 'hosted',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  } as const

  assert.deepEqual(normalizeAssistantProviderConfig(codexInput), {
    policy: {
      approvalPolicy: 'never',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    target: {
      codexCommand: 'codex',
      codexHome: null,
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: true,
      profile: 'hosted',
    },
  })

  assert.deepEqual(serializeAssistantProviderSessionOptions(codexInput), {
    approvalPolicy: 'never',
    continuityFingerprint: serializeAssistantProviderSessionOptions({
      provider: 'codex-cli',
      approvalPolicy: 'never',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: true,
      profile: 'hosted',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    }).continuityFingerprint,
    executionDriver: 'codex-app-server',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: true,
    profile: 'hosted',
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    resumeKind: 'codex-thread',
    sandbox: 'danger-full-access',
  })

  assert.deepEqual(serializeAssistantProviderOperatorDefaults(codexInput), {
    approvalPolicy: 'never',
    codexCommand: 'codex',
    codexHome: null,
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    oss: true,
    profile: 'hosted',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
})
