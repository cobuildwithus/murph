import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const outboundMocks = vi.hoisted(() => ({
  appendAssistantTurnReceiptEvent: vi.fn(),
  createAssistantBinding: vi.fn(),
  createAssistantTurnReceipt: vi.fn(),
  deliverAssistantOutboxMessage: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  mergeAssistantBinding: vi.fn((binding, update) => ({
    ...binding,
    ...update,
    delivery:
      update.deliveryKind && update.deliveryTarget
        ? {
            kind: update.deliveryKind,
            target: update.deliveryTarget,
          }
        : binding.delivery,
  })),
  normalizeAssistantDeliveryError: vi.fn(),
  normalizeRequiredText: vi.fn((value: string) => value.trim()),
  parse: vi.fn((value) => value),
  readAssistantOutboxIntent: vi.fn(),
  redactAssistantDisplayPath: vi.fn((vault: string) => `display:${vault}`),
  redactAssistantSessionForDisplay: vi.fn((session) => session),
  resolveAssistantSession: vi.fn(),
  resolveDeliveryCandidates: vi.fn(() => []),
  saveAssistantSession: vi.fn(),
  sendEmailMessage: vi.fn(),
  sendLinqMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
  updateAssistantTurnReceipt: vi.fn(),
  warnAssistantBestEffortFailure: vi.fn(),
}))

vi.mock('@murphai/operator-config/assistant-cli-contracts', () => ({
  assistantDeliverResultSchema: {
    parse: outboundMocks.parse,
  },
}))

vi.mock('../src/assistant/channel-adapters.js', () => ({
  getAssistantChannelAdapter: outboundMocks.getAssistantChannelAdapter,
  resolveDeliveryCandidates: outboundMocks.resolveDeliveryCandidates,
  sendEmailMessage: outboundMocks.sendEmailMessage,
  sendLinqMessage: outboundMocks.sendLinqMessage,
  sendTelegramMessage: outboundMocks.sendTelegramMessage,
}))

vi.mock('../src/assistant/bindings.js', () => ({
  createAssistantBinding: outboundMocks.createAssistantBinding,
  mergeAssistantBinding: outboundMocks.mergeAssistantBinding,
}))

vi.mock('../src/assistant/outbox.js', () => ({
  deliverAssistantOutboxMessage: outboundMocks.deliverAssistantOutboxMessage,
  normalizeAssistantDeliveryError: outboundMocks.normalizeAssistantDeliveryError,
  readAssistantOutboxIntent: outboundMocks.readAssistantOutboxIntent,
}))

vi.mock('../src/assistant/turns.js', () => ({
  appendAssistantTurnReceiptEvent: outboundMocks.appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt: outboundMocks.createAssistantTurnReceipt,
  updateAssistantTurnReceipt: outboundMocks.updateAssistantTurnReceipt,
}))

vi.mock('../src/assistant/store.js', () => ({
  redactAssistantDisplayPath: outboundMocks.redactAssistantDisplayPath,
  resolveAssistantSession: outboundMocks.resolveAssistantSession,
  saveAssistantSession: outboundMocks.saveAssistantSession,
}))

vi.mock('../src/assistant/redaction.js', () => ({
  redactAssistantSessionForDisplay: outboundMocks.redactAssistantSessionForDisplay,
}))

vi.mock('../src/assistant/shared.js', () => ({
  normalizeRequiredText: outboundMocks.normalizeRequiredText,
  warnAssistantBestEffortFailure: outboundMocks.warnAssistantBestEffortFailure,
}))

import {
  deliverAssistantMessage,
  deliverAssistantMessageOverBinding,
} from '../src/outbound-channel.ts'

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    binding: {
      actorId: 'actor-1',
      channel: 'telegram',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: true,
    },
    provider: 'codex',
    providerOptions: {
      model: 'gpt-5.4',
    },
    sessionId: 'session-1',
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...overrides,
  }
}

function createDelivery(
  overrides: Record<string, unknown> = {},
) {
  return {
    channel: 'telegram',
    providerMessageId: 'provider-message-1',
    sentAt: '2026-04-08T01:00:00.000Z',
    target: 'thread-2',
    targetKind: 'thread',
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  outboundMocks.appendAssistantTurnReceiptEvent
    .mockReset()
    .mockResolvedValue(undefined)
  outboundMocks.createAssistantBinding.mockReset().mockReturnValue({
    channel: 'telegram',
    delivery: {
      kind: 'thread',
      target: 'thread-1',
    },
    identityId: 'identity-1',
    threadId: 'thread-1',
    threadIsDirect: true,
  })
  outboundMocks.createAssistantTurnReceipt.mockReset().mockResolvedValue({
    turnId: 'turn-1',
  })
  outboundMocks.deliverAssistantOutboxMessage.mockReset()
  outboundMocks.getAssistantChannelAdapter.mockReset()
  outboundMocks.mergeAssistantBinding.mockClear()
  outboundMocks.normalizeAssistantDeliveryError
    .mockReset()
    .mockImplementation((error) =>
      error instanceof VaultCliError
        ? {
            code: error.code,
            message: error.message,
          }
        : {
            code: 'ASSISTANT_DELIVERY_FAILED',
            message:
              error instanceof Error ? error.message : 'unknown delivery failure',
          },
    )
  outboundMocks.normalizeRequiredText.mockClear()
  outboundMocks.parse.mockClear()
  outboundMocks.readAssistantOutboxIntent.mockReset().mockResolvedValue({
    status: 'failed',
  })
  outboundMocks.redactAssistantDisplayPath.mockClear()
  outboundMocks.redactAssistantSessionForDisplay.mockClear()
  outboundMocks.resolveAssistantSession.mockReset().mockResolvedValue({
    session: createSession(),
  })
  outboundMocks.resolveDeliveryCandidates.mockClear().mockReturnValue([])
  outboundMocks.saveAssistantSession
    .mockReset()
    .mockImplementation(async (_vault, session) => session)
  outboundMocks.updateAssistantTurnReceipt.mockReset().mockResolvedValue(undefined)
  outboundMocks.warnAssistantBestEffortFailure.mockReset()
})

describe('outbound channel runtime', () => {
  it('delivers through the outbox, trims explicit targets, and persists a channel-only binding update', async () => {
    const delivery = createDelivery({
      target: 'participant-2',
      targetKind: 'participant',
    })
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery,
      intent: {
        intentId: 'intent-1',
      },
      kind: 'sent',
      session: null,
    })

    const result = await deliverAssistantMessage({
      message: '  hello there  ',
      replyToMessageId: 'reply-1',
      target: '  participant-2  ',
      vault: 'vault-alpha',
    })

    expect(outboundMocks.deliverAssistantOutboxMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitTarget: 'participant-2',
        message: 'hello there',
        replyToMessageId: 'reply-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: 'vault-alpha',
      }),
    )
    expect(outboundMocks.mergeAssistantBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
      }),
      {
        channel: 'telegram',
      },
    )
    expect(outboundMocks.saveAssistantSession).toHaveBeenCalledOnce()
    expect(result).toEqual(
      expect.objectContaining({
        delivery,
        message: 'hello there',
        vault: 'display:vault-alpha',
      }),
    )
  })

  it('rewrites thread delivery metadata when the provider moves the thread target', async () => {
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: createDelivery({
        target: 'thread-2',
        targetKind: 'thread',
      }),
      intent: {
        intentId: 'intent-2',
      },
      kind: 'sent',
      session: null,
    })

    await deliverAssistantMessage({
      message: 'thread retarget',
      vault: 'vault-thread',
    })

    expect(outboundMocks.mergeAssistantBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
        threadId: 'thread-1',
      }),
      {
        channel: 'telegram',
        deliveryKind: 'thread',
        deliveryTarget: 'thread-2',
        threadId: 'thread-2',
      },
    )
  })

  it('rewrites participant delivery metadata when the provider returns a new participant target', async () => {
    outboundMocks.resolveAssistantSession.mockResolvedValue({
      session: createSession({
        binding: {
          actorId: 'actor-1',
          channel: 'telegram',
          delivery: {
            kind: 'participant',
            target: 'participant-1',
          },
          identityId: 'identity-1',
          threadId: null,
          threadIsDirect: true,
        },
      }),
    })
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: createDelivery({
        target: 'participant-2',
        targetKind: 'participant',
      }),
      intent: {
        intentId: 'intent-3',
      },
      kind: 'sent',
      session: null,
    })

    await deliverAssistantMessage({
      message: 'participant retarget',
      vault: 'vault-participant',
    })

    expect(outboundMocks.mergeAssistantBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: {
          kind: 'participant',
          target: 'participant-1',
        },
      }),
      {
        channel: 'telegram',
        deliveryKind: 'participant',
        deliveryTarget: 'participant-2',
      },
    )
  })

  it('passes optional session-routing fields through resolution and keeps the default binding when the target is unchanged', async () => {
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: createDelivery({
        target: 'thread-1',
        targetKind: 'thread',
      }),
      intent: {
        intentId: 'intent-default-binding',
      },
      kind: 'sent',
      session: null,
    })

    await deliverAssistantMessage({
      conversation: {
        directness: 'direct',
        participantId: 'participant-9',
        threadId: 'thread-1',
      },
      message: 'default binding branch',
      sourceThreadId: 'source-thread-9',
      threadIsDirect: false,
      vault: 'vault-routing',
    })

    expect(outboundMocks.resolveAssistantSession).toHaveBeenCalledWith({
      conversation: {
        directness: 'direct',
        participantId: 'participant-9',
        threadId: 'thread-1',
      },
      sourceThreadId: 'source-thread-9',
      threadIsDirect: false,
      vault: 'vault-routing',
    })
    expect(outboundMocks.mergeAssistantBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
        threadId: 'thread-1',
      }),
      {
        channel: 'telegram',
      },
    )
  })

  it('returns an outbox-provided session without persisting a replacement session snapshot', async () => {
    const providedSession = createSession({
      binding: {
        actorId: 'actor-2',
        channel: 'telegram',
        delivery: {
          kind: 'thread',
          target: 'thread-provided',
        },
        identityId: 'identity-2',
        threadId: 'thread-provided',
        threadIsDirect: true,
      },
      sessionId: 'session-provided',
    })
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: createDelivery({
        target: 'thread-provided',
      }),
      intent: {
        intentId: 'intent-provided',
      },
      kind: 'sent',
      session: providedSession,
    })

    const result = await deliverAssistantMessage({
      message: 'use provided session',
      vault: 'vault-provided',
    })

    expect(outboundMocks.saveAssistantSession).not.toHaveBeenCalled()
    expect(outboundMocks.redactAssistantSessionForDisplay).toHaveBeenCalledWith(
      providedSession,
    )
    expect(result).toEqual(
      expect.objectContaining({
        session: providedSession,
      }),
    )
  })

  it('records fallback receipt failures when an outbox intent fails before sending', async () => {
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: null,
      deliveryError: null,
      intent: {
        intentId: null,
      },
      kind: 'queued',
      session: null,
    })

    await expect(
      deliverAssistantMessage({
        message: 'will fail',
        vault: 'vault-failed',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'Assistant outbound delivery did not complete successfully.',
    })

    expect(outboundMocks.appendAssistantTurnReceiptEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'Assistant outbound delivery did not complete successfully.',
        kind: 'delivery.failed',
        turnId: 'turn-1',
        vault: 'vault-failed',
      }),
    )
    expect(outboundMocks.updateAssistantTurnReceipt).toHaveBeenCalledOnce()
  })

  it('skips fallback receipt writes when the outbox intent is already marked sent', async () => {
    const deliveryError = new VaultCliError(
      'ASSISTANT_DELIVERY_FAILED',
      'already reconciled',
    )
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: null,
      deliveryError,
      intent: {
        intentId: 'intent-sent',
      },
      kind: 'failed',
      session: null,
    })
    outboundMocks.readAssistantOutboxIntent.mockResolvedValue({
      status: 'sent',
    })

    await expect(
      deliverAssistantMessage({
        message: 'already sent',
        vault: 'vault-sent',
      }),
    ).rejects.toBe(deliveryError)

    expect(outboundMocks.appendAssistantTurnReceiptEvent).not.toHaveBeenCalled()
    expect(outboundMocks.updateAssistantTurnReceipt).not.toHaveBeenCalled()
  })

  it('warns when receipt fallback bookkeeping or outbox-intent decoration fails', async () => {
    const deliveryError = Object.preventExtensions(
      new VaultCliError('ASSISTANT_DELIVERY_FAILED', 'non-extensible failure'),
    )
    let mutatedReceipt: Record<string, unknown> | null = null
    outboundMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: null,
      deliveryError,
      intent: {
        intentId: 'intent-warning',
      },
      kind: 'failed',
      session: null,
    })
    outboundMocks.readAssistantOutboxIntent.mockRejectedValueOnce(
      new Error('lookup failed'),
    )
    outboundMocks.appendAssistantTurnReceiptEvent.mockRejectedValueOnce(
      new Error('append failed'),
    )
    outboundMocks.updateAssistantTurnReceipt.mockImplementationOnce(
      async ({ mutate }: { mutate(receipt: Record<string, unknown>): Record<string, unknown> }) => {
        mutatedReceipt = mutate({
          status: 'started',
        })
        throw new Error('update failed')
      },
    )

    await expect(
      deliverAssistantMessage({
        message: 'warn on bookkeeping',
        vault: 'vault-warning',
      }),
    ).rejects.toBe(deliveryError)

    expect(mutatedReceipt).toEqual(
      expect.objectContaining({
        completedAt: expect.any(String),
        deliveryDisposition: 'failed',
        lastError: {
          code: 'ASSISTANT_DELIVERY_FAILED',
          message: 'non-extensible failure',
        },
        status: 'failed',
        updatedAt: expect.any(String),
      }),
    )
    expect(outboundMocks.warnAssistantBestEffortFailure).toHaveBeenCalledTimes(3)
    expect(outboundMocks.warnAssistantBestEffortFailure).toHaveBeenNthCalledWith(1, {
      error: expect.any(TypeError),
      operation: 'delivery error outbox-intent decoration',
    })
    expect(outboundMocks.warnAssistantBestEffortFailure).toHaveBeenNthCalledWith(2, {
      error: expect.any(Error),
      operation: 'delivery failure receipt append',
    })
    expect(outboundMocks.warnAssistantBestEffortFailure).toHaveBeenNthCalledWith(3, {
      error: expect.any(Error),
      operation: 'delivery failure receipt update',
    })
  })

  it('rejects missing and unsupported channels when delivering over a binding', async () => {
    outboundMocks.createAssistantBinding.mockReturnValueOnce({
      channel: '   ',
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    })

    await expect(
      deliverAssistantMessageOverBinding({
        message: 'missing channel',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CHANNEL_REQUIRED',
    })

    outboundMocks.createAssistantBinding.mockReturnValueOnce({
      channel: 'pager',
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    })
    outboundMocks.getAssistantChannelAdapter.mockReturnValueOnce(null)

    await expect(
      deliverAssistantMessageOverBinding({
        message: 'unsupported channel',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CHANNEL_UNSUPPORTED',
    })
  })

  it('delivers over a bound channel adapter and reports transport idempotency', async () => {
    const delivery = createDelivery({
      sentAt: '2026-04-08T03:00:00.000Z',
      target: 'thread-1',
      targetKind: 'thread',
    })
    const send = vi.fn().mockResolvedValue(delivery)
    outboundMocks.getAssistantChannelAdapter.mockReturnValue({
      send,
      supportsIdempotencyKey: true,
    })

    const result = await deliverAssistantMessageOverBinding({
      idempotencyKey: 'idem-1',
      message: 'hello binding',
      replyToMessageId: 'reply-over-binding',
      session: {
        binding: {
          actorId: 'actor-1',
          channel: 'telegram',
          conversationKey: null,
          delivery: {
            kind: 'thread',
            target: 'thread-1',
          },
          identityId: 'identity-1',
          threadId: 'thread-1',
          threadIsDirect: true,
        },
      },
      target: '  thread-2  ',
    })

    expect(outboundMocks.resolveDeliveryCandidates).toHaveBeenCalledWith({
      bindingDelivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      explicitTarget: 'thread-2',
    })
    expect(send).toHaveBeenCalledWith(
      {
        bindingDelivery: {
          kind: 'thread',
          target: 'thread-1',
        },
        explicitTarget: 'thread-2',
        idempotencyKey: 'idem-1',
        identityId: 'identity-1',
        message: 'hello binding',
        replyToMessageId: 'reply-over-binding',
      },
      {},
    )
    expect(result).toEqual({
      delivery,
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
    })
  })
})
