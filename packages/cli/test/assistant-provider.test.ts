import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  executeCodexPrompt: vi.fn(),
}))

vi.mock('../src/assistant-codex.js', () => ({
  executeCodexPrompt: providerMocks.executeCodexPrompt,
}))

import {
  executeAssistantProviderTurn,
  resolveAssistantProviderOptions,
} from '../src/assistant-provider.js'

beforeEach(() => {
  providerMocks.executeCodexPrompt.mockReset()
})

test('resolveAssistantProviderOptions normalizes provider session settings', () => {
  assert.deepEqual(
    resolveAssistantProviderOptions({
      model: ' gpt-oss:20b ',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: ' primary ',
      oss: true,
    }),
    {
      model: 'gpt-oss:20b',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: 'primary',
      oss: true,
    },
  )
})

test('executeAssistantProviderTurn dispatches to the Codex adapter and preserves the provider session id', async () => {
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [{ type: 'thread.started', thread_id: 'thread-123' }],
    sessionId: 'thread-123',
    stderr: 'stderr output',
    stdout: 'stdout output',
  })

  const result = await executeAssistantProviderTurn({
    provider: 'codex-cli',
    workingDirectory: '/tmp/vault',
    prompt: 'hello',
    resumeProviderSessionId: 'thread-existing',
    codexCommand: '/opt/homebrew/bin/codex',
    model: 'gpt-oss:20b',
    sandbox: 'read-only',
    approvalPolicy: 'never',
    profile: 'primary',
    oss: true,
  })

  assert.deepEqual(providerMocks.executeCodexPrompt.mock.calls, [
    [
      {
        codexCommand: '/opt/homebrew/bin/codex',
        workingDirectory: '/tmp/vault',
        prompt: 'hello',
        resumeSessionId: 'thread-existing',
        model: 'gpt-oss:20b',
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: 'primary',
        oss: true,
      },
    ],
  ])
  assert.deepEqual(result, {
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'assistant reply',
    stderr: 'stderr output',
    stdout: 'stdout output',
    rawEvents: [{ type: 'thread.started', thread_id: 'thread-123' }],
  })
})
