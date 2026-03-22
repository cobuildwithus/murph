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
} from '../src/chat-provider.js'

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
      reasoningEffort: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: 'primary',
      oss: true,
    },
  )
})

test('executeAssistantProviderTurn dispatches to the Codex adapter and preserves the provider session id', async () => {
  const onEvent = vi.fn()
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [{ type: 'thread.started', thread_id: 'thread-123' }],
    sessionId: 'thread-123',
    stderr: 'stderr output',
    stdout: 'stdout output',
  })

  const result = await executeAssistantProviderTurn({
    provider: 'codex-cli',
    configOverrides: ['mcp_servers.healthybob_memory.command="node"'],
    env: {
      PATH: '/tmp/healthybob-bin',
    },
    workingDirectory: '/tmp/vault',
    systemPrompt: 'system prompt',
    userPrompt: 'hello',
    sessionContext: {
      binding: {
        conversationKey: 'channel:imessage|thread:chat-123',
        channel: 'imessage',
        identityId: null,
        actorId: 'contact:bob',
        threadId: 'chat-123',
        threadIsDirect: false,
        delivery: {
          kind: 'thread',
          target: 'chat-123',
        },
      },
    },
    resumeProviderSessionId: 'thread-existing',
    codexCommand: '/opt/homebrew/bin/codex',
    model: 'gpt-oss:20b',
    onEvent,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    profile: 'primary',
    oss: true,
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.equal(call?.codexCommand, '/opt/homebrew/bin/codex')
  assert.deepEqual(call?.configOverrides, ['mcp_servers.healthybob_memory.command="node"'])
  assert.deepEqual(call?.env, {
    PATH: '/tmp/healthybob-bin',
  })
  assert.equal(call?.workingDirectory, '/tmp/vault')
  assert.equal(call?.resumeSessionId, 'thread-existing')
  assert.equal(call?.model, 'gpt-oss:20b')
  assert.equal(call?.sandbox, 'read-only')
  assert.equal(call?.approvalPolicy, 'never')
  assert.equal(call?.onProgress, onEvent)
  assert.equal(call?.profile, 'primary')
  assert.equal(call?.oss, true)
  assert.match(call?.prompt ?? '', /system prompt/u)
  assert.match(call?.prompt ?? '', /channel: imessage/u)
  assert.match(call?.prompt ?? '', /thread: chat-123/u)
  assert.match(call?.prompt ?? '', /User message:\nhello/u)
  assert.deepEqual(result, {
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'assistant reply',
    stderr: 'stderr output',
    stdout: 'stdout output',
    rawEvents: [{ type: 'thread.started', thread_id: 'thread-123' }],
  })
})


test('executeAssistantProviderTurn enables reasoning summary traces when requested', async () => {
  const onTraceEvent = vi.fn()
  providerMocks.executeCodexPrompt.mockResolvedValue({
    finalMessage: 'assistant reply',
    jsonEvents: [],
    sessionId: 'thread-thinking',
    stderr: '',
    stdout: '',
  })

  await executeAssistantProviderTurn({
    provider: 'codex-cli',
    configOverrides: ['mcp_servers.healthybob_memory.command="node"'],
    workingDirectory: '/tmp/vault',
    userPrompt: 'hello',
    showThinkingTraces: true,
    onTraceEvent,
  })

  const call = providerMocks.executeCodexPrompt.mock.calls[0]?.[0]
  assert.deepEqual(call?.configOverrides, [
    'mcp_servers.healthybob_memory.command="node"',
    'model_reasoning_summary="auto"',
    'hide_agent_reasoning=false',
  ])
  assert.equal(call?.onTraceEvent, onTraceEvent)
})
