import { describe, expect, it } from 'vitest'

import {
  parseCodexAppServerMessage,
  readCodexThreadTokenUsage,
} from '../src/assistant-codex/app-server-protocol.ts'
import {
  readCodexRpcResponseId,
  readCodexRpcServerRequestId,
  tryParseJsonLine,
} from '../src/assistant-codex/app-server-rpc.ts'

const usage = {
  cacheWriteInputTokens: 3,
  cachedInputTokens: 5,
  inputTokens: 11,
  outputTokens: 7,
  reasoningOutputTokens: 2,
  totalTokens: 18,
}

describe('Codex app-server protocol boundary', () => {
  it.each([
    {
      emittedAtMs: 10,
      method: 'item/completed',
      params: {
        completedAtMs: 9,
        item: {
          id: 'item-1',
          phase: 'final_answer',
          text: 'Done.',
          type: 'agentMessage',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    },
    {
      id: '',
      method: 'item/tool/call',
      params: {
        arguments: {},
        callId: 'call-1',
        namespace: 'murph',
        threadId: 'thread-1',
        tool: 'finish_without_reply',
        turnId: 'turn-1',
      },
    },
    {
      method: 'future/newNotification',
      params: { opaque: true },
    },
    { id: -4, result: { turn: { id: 'turn-4' } } },
    {
      error: {
        code: -32_000,
        data: { retryable: false },
        message: 'request failed',
      },
      id: 'response-5',
    },
    {
      error: {
        code: -32_001,
        data: null,
        message: 'request failed without details',
      },
      id: 6,
    },
  ])('accepts canonical app-server envelope %#', (message) => {
    expect(parseCodexAppServerMessage(message)).toBe(message)
    expect(tryParseJsonLine(JSON.stringify(message))).toEqual({
      ok: true,
      value: message,
    })
  })

  it.each([
    null,
    [],
    { type: 'turn.completed', params: {} },
    { event: 'item.completed', params: {} },
    { method: 'turn.completed', params: {} },
    { method: 'thread/token_usage/updated', params: {} },
    { method: 'item/completed', data: { item: {} } },
    { method: 'item/completed', item: {} },
    { method: 'item/completed', params: null },
    { method: 'item/completed', params: {}, result: {} },
    { jsonrpc: '2.0', method: 'item/completed', params: {} },
    {
      id: 1,
      method: 'item/tool/call',
      params: {},
      trace: { traceparent: '00-00000000000000000000000000000000-0000000000000000-00' },
    },
    { emitted_at_ms: 1, method: 'item/completed', params: {} },
    { id: 1 },
    { id: 1, result: {}, error: { code: -1, message: 'no' } },
    { id: 1, params: {}, result: {} },
    { id: 1.5, result: {} },
    { id: 1, error: { message: 'missing code' } },
  ])('rejects noncanonical compatibility envelope %#', (message) => {
    expect(parseCodexAppServerMessage(message)).toBeNull()
    expect(tryParseJsonLine(JSON.stringify(message))).toEqual({ ok: false })
  })

  it('preserves string and signed integer request ids through RPC routing', () => {
    expect(readCodexRpcServerRequestId({
      id: '',
      method: 'item/tool/call',
      params: {},
    })).toBe('')
    expect(readCodexRpcResponseId({ id: 'server-request', result: {} }))
      .toBe('server-request')
    expect(readCodexRpcResponseId({ id: -7, result: {} })).toBe(-7)
  })

  it('requires the complete pinned token-usage shape', () => {
    expect(readCodexThreadTokenUsage({
      last: usage,
      modelContextWindow: 200_000,
      total: usage,
    })).toEqual({
      last: usage,
      modelContextWindow: 200_000,
      total: usage,
    })
    expect(readCodexThreadTokenUsage({
      last: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      modelContextWindow: 200_000,
      total: usage,
    })).toBeNull()
  })

  it.each(['', ' ', 'not-json', '[]', 'null'])('rejects invalid line %j', (line) => {
    expect(tryParseJsonLine(line)).toEqual({ ok: false })
  })
})
