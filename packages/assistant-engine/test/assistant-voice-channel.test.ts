import { describe, expect, it, vi } from 'vitest'
import { getAssistantChannelAdapter } from '../src/assistant/channels/registry.ts'

describe('voice delivery through the ordinary channel owner', () => {
  const delivery = {
    actorId: null,
    answeredMailboxItemIds: ['mailbox_synthetic_1'],
    bindingDelivery: null,
    explicitTarget: 'call_synthetic_1',
    identityId: null,
    message: 'The synthetic record is saved.',
    threadIsDirect: true,
  }

  it('delivers only through an invocation-bound call port and preserves uncertainty', async () => {
    const adapter = getAssistantChannelAdapter('voice')!
    const sendVoice = vi.fn(async () => {})
    expect(adapter).not.toBeNull()
    const receipt = await adapter.send(delivery, { sendVoice })
    expect(sendVoice).toHaveBeenCalledExactlyOnceWith({
      callId: 'call_synthetic_1',
      message: delivery.message,
      answeredMailboxItemIds: ['mailbox_synthetic_1'],
    })
    expect(receipt).toMatchObject({ channel: 'voice', providerThreadId: 'call_synthetic_1' })
    expect(adapter.resolveDeliveryTransportIdempotent({ message: delivery.message })).toBe(false)
    const uncertain = new Error('synthetic connection loss after dispatch')
    sendVoice.mockRejectedValueOnce(uncertain)
    await expect(adapter.send(delivery, { sendVoice })).rejects.toBe(uncertain)
    expect(sendVoice).toHaveBeenCalledTimes(2)
  })

  it.each([
    { threadIsDirect: false },
    { threadIsDirect: null },
    { answeredMailboxItemIds: [] },
  ])('rejects an unproven private accepted reply: %j', async (override) => {
    const sendVoice = vi.fn(async () => {})
    await expect(getAssistantChannelAdapter('voice')!.send({ ...delivery, ...override }, { sendVoice }))
      .rejects.toMatchObject({ code: 'ASSISTANT_VOICE_DELIVERY_UNAVAILABLE', retryable: false, deliveryMayHaveSucceeded: false })
    expect(sendVoice).not.toHaveBeenCalled()
  })

  it('never falls back to an ambient provider or inferred participant', async () => {
    const adapter = getAssistantChannelAdapter('voice')!
    await expect(adapter.send(delivery, {})).rejects.toMatchObject({ code: 'ASSISTANT_VOICE_DELIVERY_UNAVAILABLE' })
    expect(adapter.inferBindingDelivery({ conversation: {
      participantId: 'synthetic-participant', threadId: 'hid_synthetic',
    } })).toBeNull()
    expect(adapter.inferBindingDelivery({ conversation: {}, deliveryTarget: 'call_synthetic_1' }))
      .toEqual({ kind: 'thread', target: 'call_synthetic_1' })
    expect(adapter.canAutoReply({ source: 'voice', threadIsDirect: true })).toBeNull()
    expect(adapter.canAutoReply({ source: 'telegram', threadIsDirect: true })).not.toBeNull()
  })
})
