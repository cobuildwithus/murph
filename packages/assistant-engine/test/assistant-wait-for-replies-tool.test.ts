import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AssistantConversationScope,
} from '../src/assistant/conversation-policy.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'
import {
  createMurphWaitForRepliesTurnState,
  executeMurphDynamicToolRequest,
  MURPH_WAIT_FOR_REPLIES_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
  type MurphWaitForRepliesTurnState,
} from '../src/assistant-codex/dynamic-tools.js'

describe('murph.wait_for_replies dynamic tool', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is available only for group conversation scope', () => {
    expect(resolveMurphDynamicTools({
      conversationScope: 'group',
    })).toContain(MURPH_WAIT_FOR_REPLIES_TOOL)
    expect(resolveMurphDynamicTools({
      conversationScope: 'direct',
    })).not.toContain(MURPH_WAIT_FOR_REPLIES_TOOL)
    expect(resolveMurphDynamicTools({
      conversationScope: 'unverified-external',
    })).not.toContain(MURPH_WAIT_FOR_REPLIES_TOOL)
    expect(resolveMurphDynamicTools({})).not.toContain(
      MURPH_WAIT_FOR_REPLIES_TOOL,
    )
    expect(MURPH_WAIT_FOR_REPLIES_TOOL.description).toContain(
      'New messages arrive as normal messages after the wait.',
    )
    expect(MURPH_WAIT_FOR_REPLIES_TOOL.description).toContain(
      'never to delay an answer someone is waiting on',
    )
  })

  it('rejects hidden execution outside group scope', async () => {
    for (const conversationScope of [
      'direct',
      'unverified-external',
    ] as const) {
      const result = await executeWait({
        conversationScope,
        seconds: 3,
        turnState: createMurphWaitForRepliesTurnState(),
      })

      expect(result.rpcResult.success).toBe(false)
      expect(readResultText(result)).toContain(
        'available only in a group conversation',
      )
    }
  })

  it('accepts only the seconds argument', () => {
    expect(readMurphDynamicToolRequest(dynamicToolCall({
      seconds: 5,
      extra: true,
    }))).toMatchObject({
      kind: 'invalid-wait-for-replies-arguments',
    })
    expect(readMurphDynamicToolRequest(dynamicToolCall({
      seconds: '5',
    }))).toMatchObject({
      kind: 'invalid-wait-for-replies-arguments',
    })
  })

  it.each([
    [1, 3],
    [30, 10],
  ] as const)('clamps %s seconds to %s seconds', async (
    requestedSeconds,
    expectedSeconds,
  ) => {
    const pending = executeWait({
      conversationScope: 'group',
      seconds: requestedSeconds,
      turnState: createMurphWaitForRepliesTurnState(),
    })
    let settled = false
    void pending.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(expectedSeconds * 1_000 - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const result = await pending
    expect(result.rpcResult.success).toBe(true)
    expect(readResultPayload(result)).toEqual({
      budgetExhausted: false,
      waitedSeconds: expectedSeconds,
    })
  })

  it('limits one turn to two calls and fifteen cumulative seconds', async () => {
    const turnState = createMurphWaitForRepliesTurnState()
    const firstPending = executeWait({
      conversationScope: 'group',
      seconds: 8,
      turnState,
    })
    await vi.advanceTimersByTimeAsync(8_000)
    expect(readResultPayload(await firstPending)).toEqual({
      budgetExhausted: false,
      waitedSeconds: 8,
    })

    const secondPending = executeWait({
      conversationScope: 'group',
      seconds: 10,
      turnState,
    })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(readResultPayload(await secondPending)).toEqual({
      budgetExhausted: false,
      waitedSeconds: 7,
    })

    const exhausted = await executeWait({
      conversationScope: 'group',
      seconds: 3,
      turnState,
    })
    expect(readResultPayload(exhausted)).toEqual({
      budgetExhausted: true,
      waitedSeconds: 0,
    })
    expect(vi.getTimerCount()).toBe(0)

    const freshTurnPending = executeWait({
      conversationScope: 'group',
      seconds: 3,
      turnState: createMurphWaitForRepliesTurnState(),
    })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(readResultPayload(await freshTurnPending)).toEqual({
      budgetExhausted: false,
      waitedSeconds: 3,
    })
  })

  it('resolves early when the live turn is aborted', async () => {
    const abortController = new AbortController()
    const pending = executeWait({
      abortSignal: abortController.signal,
      conversationScope: 'group',
      seconds: 10,
      turnState: createMurphWaitForRepliesTurnState(),
    })

    await vi.advanceTimersByTimeAsync(1_250)
    abortController.abort()
    const result = await pending

    expect(result.rpcResult.success).toBe(true)
    expect(readResultPayload(result)).toEqual({
      budgetExhausted: false,
      waitedSeconds: 1.25,
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})

async function executeWait(input: {
  abortSignal?: AbortSignal | null
  conversationScope: AssistantConversationScope
  seconds: number
  turnState: MurphWaitForRepliesTurnState
}) {
  const request = readMurphDynamicToolRequest(dynamicToolCall({
    seconds: input.seconds,
  }))
  if (!request || request.kind !== 'wait-for-replies') {
    throw new Error('Expected a wait-for-replies request.')
  }

  return await executeMurphDynamicToolRequest({
    abortSignal: input.abortSignal ?? null,
    env: {},
    fetchImpl: fetch,
    hostedToolContext: createHostedToolContext(input.conversationScope),
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    request,
    waitForRepliesTurnState: input.turnState,
  })
}

function dynamicToolCall(argumentsValue: unknown): Record<string, unknown> {
  return {
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: MURPH_WAIT_FOR_REPLIES_TOOL.name,
    },
  }
}

function createHostedToolContext(
  conversationScope: AssistantConversationScope,
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () => ({
      acceptedInputIds: ['ain_group_wait_0123456789abcdef0123456789ab'],
      conversationId: 'conversation-group-wait',
      conversationScope,
      inboundMailboxItemIds: ['mailbox-item-group-wait'],
      originSessionId: 'session-group-wait',
      recipientKey: 'recipient-group-wait',
    }),
    sendVaultFile: vi.fn(async () => ({
      filename: 'unused.txt',
      status: 'denied' as const,
    })),
    vaultFileSendAvailable: false,
  }
}

function readResultText(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): string {
  return result.rpcResult.contentItems[0]?.text ?? ''
}

function readResultPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  return JSON.parse(readResultText(result))
}
