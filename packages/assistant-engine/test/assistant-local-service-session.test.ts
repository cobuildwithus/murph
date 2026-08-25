import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  createAssistantSession,
  loadLocalServiceModule,
} from './assistant-local-service-runtime.harness.ts'

test('updateAssistantSessionOptionsLocal resolves and saves the refreshed session config', async () => {
  const updatedSession = createAssistantSession({
    sessionId: 'session-updated',
  })
  const { mocks, updateAssistantSessionOptionsLocal } = await loadLocalServiceModule()

  mocks.resolveAssistantSession.mockResolvedValueOnce({
    session: createAssistantSession({
      sessionId: 'session-updated',
      resumeState: {
        routeFingerprint: 'route-1',
        threadId: 'provider-session-1',
      },
    }),
  })
  mocks.saveAssistantSession.mockResolvedValueOnce(updatedSession)

  const result = await updateAssistantSessionOptionsLocal({
    providerOptions: {
      model: 'gpt-5.4-mini',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'low',
    },
    sessionId: 'session-updated',
    vault: '/vaults/test',
  })

  assert.equal(result, updatedSession)
  assert.equal(mocks.resolveAssistantSession.mock.calls.length, 1)
  assert.equal(mocks.saveAssistantSession.mock.calls.length, 1)
  assert.equal(
    mocks.saveAssistantSession.mock.calls[0]?.[1]?.providerOptions?.model,
    'gpt-5.4-mini',
  )
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.provider, 'codex-cli')
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.adapter, 'codex-cli')
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.resumeState, null)
})

test('updateAssistantSessionOptionsLocal preserves codex target-only fields', async () => {
  const updatedSession = createAssistantSession({
    provider: 'codex-cli',
    providerOptions: {
      provider: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: '/tmp/codex-home',
      continuityFingerprint: 'fingerprint-codex',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'prod',
      reasoningEffort: 'high',
      resumeKind: 'codex-thread',
      sandbox: 'workspace-write',
    },
    sessionId: 'session-codex-updated',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: '/opt/murph/bin/custom-codex',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'prod',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    },
  })
  const { mocks, updateAssistantSessionOptionsLocal } = await loadLocalServiceModule()

  mocks.resolveAssistantSession.mockResolvedValueOnce({
    session: createAssistantSession({
      provider: 'codex-cli',
      providerOptions: {
        provider: 'codex-cli',
        approvalPolicy: 'never',
        codexHome: '/tmp/codex-home',
        continuityFingerprint: 'fingerprint-codex',
        executionDriver: 'codex-app-server',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: 'prod',
        reasoningEffort: 'high',
        resumeKind: 'codex-thread',
        sandbox: 'workspace-write',
      },
      sessionId: 'session-codex-updated',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: '/opt/murph/bin/custom-codex',
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: 'prod',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      },
    }),
  })
  mocks.saveAssistantSession.mockResolvedValueOnce(updatedSession)

  const result = await updateAssistantSessionOptionsLocal({
    providerOptions: {
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
    },
    sessionId: 'session-codex-updated',
    vault: '/vaults/test',
  })

  assert.equal(result, updatedSession)
  assert.equal(
    mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.codexCommand,
    '/opt/murph/bin/custom-codex',
  )
  assert.equal(
    mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.codexHome,
    '/tmp/codex-home',
  )
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.model, 'gpt-5.6-terra')
})

test('openAssistantConversationLocal forwards defaults into session resolution', async () => {
  const { mocks, openAssistantConversationLocal } = await loadLocalServiceModule()

  mocks.resolveAssistantSession.mockResolvedValueOnce({
    session: createAssistantSession({
      sessionId: 'session-open',
    }),
  })

  const result = await openAssistantConversationLocal({
    channel: 'telegram',
    vault: '/vaults/test',
  })

  assert.equal(result.session.sessionId, 'session-open')
  assert.equal(mocks.resolveAssistantOperatorDefaults.mock.calls.length, 1)
  assert.equal(mocks.resolveAssistantSession.mock.calls.length, 1)
})
