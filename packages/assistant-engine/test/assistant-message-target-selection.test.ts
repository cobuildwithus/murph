import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readAssistantTargetProviderScalar,
  resolveAssistantAcceptedMessageParticipant,
  resolveAssistantAcceptedMessageTarget,
  supportsAssistantAcceptedMessageTargetingRoute,
} from '../src/assistant/message-target-selection.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  )
})

describe('accepted message target selection', () => {
  it('uses one accepted Linq iMessage event for native reply and reaction', async () => {
    const fixture = await createTargetFixture({
      channel: 'linq',
      messageId: 'linq-message-1',
      reactionEligible: true,
      service: 'iMessage',
    })

    const nativeReply = await resolveTarget(fixture, 'native-reply')
    const reaction = await resolveTarget(fixture, 'reaction')

    expect(nativeReply).toEqual({
      deliveryReplyToMessageId: 'linq-message-1',
      targetInputId: fixture.inputId,
    })
    expect(reaction).toEqual({
      deliveryMessageReactionsAvailable: true,
      deliveryReplyToMessageId: 'linq-message-1',
      targetInputId: fixture.inputId,
    })
  })

  it('uses the thread binding when no duplicate explicit target exists', async () => {
    const fixture = await createTargetFixture({
      channel: 'linq',
      messageId: 'linq-message-binding-only',
      reactionEligible: true,
      service: 'iMessage',
    })
    await expect(resolveTarget(fixture, 'native-reply')).resolves.toMatchObject({
      targetInputId: fixture.inputId,
    })
    await expect(resolveTarget(fixture, 'reaction')).resolves.toMatchObject({
      targetInputId: fixture.inputId,
    })
  })

  it.each(['sms', 'rcs', null])(
    'rejects Linq service %s for both actions',
    async (service) => {
      const fixture = await createTargetFixture({
        channel: 'linq',
        messageId: 'linq-message-2',
        reactionEligible: true,
        service,
      })

      await expect(resolveTarget(fixture, 'native-reply')).rejects.toMatchObject({
        code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
      })
      await expect(resolveTarget(fixture, 'reaction')).rejects.toMatchObject({
        code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
      })
    },
  )

  it('allows different group actors only with Linq external thread authority', async () => {
    const authorized = await createTargetFixture({
      channel: 'linq',
      externalThreadRouteAuthorityPresent: true,
      messageId: 'linq-group-message',
      reactionEligible: true,
      service: 'imessage',
      threadIsDirect: false,
    })
    authorized.route.actorId = 'another-group-actor'

    await expect(resolveTarget(authorized, 'native-reply')).resolves.toMatchObject({
      targetInputId: authorized.inputId,
    })

    const unauthorized = await createTargetFixture({
      channel: 'linq',
      externalThreadRouteAuthorityPresent: false,
      messageId: 'linq-group-message-2',
      reactionEligible: true,
      service: 'imessage',
      threadIsDirect: false,
    })
    await expect(resolveTarget(unauthorized, 'reaction')).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('rejects a direct actor mismatch and a ref outside the exact context', async () => {
    const fixture = await createTargetFixture({
      channel: 'linq',
      messageId: 'linq-message-3',
      reactionEligible: true,
      service: 'imessage',
    })

    fixture.route.actorId = 'another-direct-actor'
    await expect(resolveTarget(fixture, 'native-reply')).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })

    fixture.route.actorId = 'actor-hash'
    await expect(
      resolveAssistantAcceptedMessageTarget({
        acceptedInputIds: [],
        action: 'native-reply',
        messageRef: fixture.inputId,
        route: fixture.route,
        vault: fixture.vault,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('rechecks route identity, thread, target, channel, and directness at resolution time', async () => {
    const fixture = await createTargetFixture({
      channel: 'linq',
      messageId: 'linq-message-route-check',
      reactionEligible: true,
      service: 'imessage',
    })

    const routeMismatches: Array<() => void> = [
      () => {
        fixture.route.identityId = 'another-account'
      },
      () => {
        fixture.route.identityId = fixture.accountId
        fixture.route.threadId = 'another-thread'
      },
      () => {
        fixture.route.threadId = 'thread-hash'
        fixture.route.bindingDelivery = {
          kind: 'thread',
          target: 'another-provider-thread',
        }
      },
      () => {
        fixture.route.bindingDelivery = {
          kind: 'thread',
          target: 'provider-thread',
        }
        fixture.route.channel = 'telegram'
      },
      () => {
        fixture.route.channel = 'linq'
        fixture.route.threadIsDirect = false
      },
    ]

    for (const applyMismatch of routeMismatches) {
      applyMismatch()
      await expect(resolveTarget(fixture, 'native-reply')).rejects.toMatchObject({
        code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
      })
    }
  })

  it('keeps Linq reaction eligibility action-specific', async () => {
    const fixture = await createTargetFixture({
      channel: 'linq',
      messageId: 'linq-message-not-reaction-eligible',
      reactionEligible: false,
      service: 'imessage',
    })

    await expect(resolveTarget(fixture, 'native-reply')).resolves.toMatchObject({
      targetInputId: fixture.inputId,
    })
    await expect(resolveTarget(fixture, 'reaction')).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('accepts the production Telegram account shape and requires a numeric message id', async () => {
    const fixture = await createTargetFixture({
      channel: 'telegram',
      messageId: '4242',
    })
    expect(fixture.accountId).toBe('account-hash')
    expect(fixture.route.identityId).toBeNull()

    await expect(resolveTarget(fixture, 'native-reply')).resolves.toMatchObject({
      deliveryReplyToMessageId: '4242',
    })
    await expect(resolveTarget(fixture, 'reaction')).resolves.toMatchObject({
      deliveryReplyToMessageId: '4242',
    })

    const malformed = await createTargetFixture({
      channel: 'telegram',
      messageId: 'not-numeric',
    })
    await expect(resolveTarget(malformed, 'native-reply')).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('preserves the Telegram business reaction exclusion', async () => {
    const fixture = await createTargetFixture({
      channel: 'telegram',
      messageId: '55',
      providerThreadTarget: '123:business:business-connection',
    })

    await expect(resolveTarget(fixture, 'native-reply')).resolves.toMatchObject({
      targetInputId: fixture.inputId,
    })
    await expect(resolveTarget(fixture, 'reaction')).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('derives the exact participant from each accepted mixed-sender group message', async () => {
    const context = await createTempVaultContext('assistant-message-participant-')
    tempRoots.push(context.parentRoot)
    const first = await createTargetFixture({
      actorId: 'actor-a',
      channel: 'linq',
      externalThreadRouteAuthorityPresent: true,
      messageId: 'linq-group-participant-a',
      reactionEligible: true,
      senderHandle: '+15551110000',
      service: 'iMessage',
      threadIsDirect: false,
      vault: context.vaultRoot,
    })
    const second = await createTargetFixture({
      actorId: 'actor-b',
      channel: 'linq',
      externalThreadRouteAuthorityPresent: true,
      messageId: 'linq-group-participant-b',
      reactionEligible: true,
      senderHandle: '+15552220000',
      service: 'iMessage',
      threadIsDirect: false,
      vault: context.vaultRoot,
    })
    const acceptedInputIds = [first.inputId, second.inputId]

    await expect(resolveParticipant(first, acceptedInputIds, first.inputId))
      .resolves.toEqual({
        participant: {
          assistantInputId: first.inputId,
          senderHandle: '+15551110000',
          source: 'linq',
        },
        targetInputId: first.inputId,
      })
    await expect(resolveParticipant(first, acceptedInputIds, second.inputId))
      .resolves.toEqual({
        participant: {
          assistantInputId: second.inputId,
          senderHandle: '+15552220000',
          source: 'linq',
        },
        targetInputId: second.inputId,
      })
  })

  it('rejects invented, cross-turn, and cross-room participant refs', async () => {
    const fixture = await createTargetFixture({
      channel: 'telegram',
      externalThreadRouteAuthorityPresent: true,
      messageId: '424242',
      senderHandle: '7770001',
      threadIsDirect: false,
    })
    const inventedRef = 'ain_ffffffffffffffffffffffffffffffff'

    await expect(
      resolveParticipant(fixture, [inventedRef], inventedRef),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
    await expect(
      resolveParticipant(fixture, [], fixture.inputId),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })

    fixture.route.threadId = 'another-room'
    await expect(
      resolveParticipant(fixture, [fixture.inputId], fixture.inputId),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
    fixture.route.threadId = 'thread-hash'
    fixture.route.bindingDelivery = {
      kind: 'thread',
      target: 'another-provider-room',
    }
    await expect(
      resolveParticipant(fixture, [fixture.inputId], fixture.inputId),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('fails participant effects closed when sender evidence is missing without disabling normal reply targeting', async () => {
    const fixture = await createTargetFixture({
      channel: 'linq',
      externalThreadRouteAuthorityPresent: true,
      messageId: 'linq-group-unattributed',
      reactionEligible: true,
      service: 'iMessage',
      threadIsDirect: false,
    })

    await expect(resolveTarget(fixture, 'native-reply')).resolves.toMatchObject({
      targetInputId: fixture.inputId,
    })
    await expect(
      resolveParticipant(fixture, [fixture.inputId], fixture.inputId),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('gates static tool availability on a real conversational route', () => {
    expect(
      supportsAssistantAcceptedMessageTargetingRoute({
        bindingDelivery: { kind: 'thread', target: '123' },
        channel: 'telegram',
        threadId: 'thread-hash',
        threadIsDirect: true,
      }),
    ).toBe(true)
    expect(
      supportsAssistantAcceptedMessageTargetingRoute({
        bindingDelivery: { kind: 'thread', target: 'hid_private' },
        channel: 'linq',
        threadId: 'thread-hash',
        threadIsDirect: true,
      }),
    ).toBe(false)
  })

  it.each([
    'AIN_private',
    'H1_0123456789ABCDEF01234567',
    '[ReDaCtEd provider message]',
    'linq:HID_private',
    'wrapped:HBID:private',
    'wrapped:HBIDX:private',
  ])('rejects private target identity %s case-insensitively', (value) => {
    expect(readAssistantTargetProviderScalar(value)).toBeNull()
  })
})

interface TargetFixture {
  accountId: string
  inputId: string
  route: {
    actorId: string | null
    bindingDelivery: {
      kind: 'thread'
      target: string
    } | null
    channel: string
    identityId: string | null
    threadId: string
    threadIsDirect: boolean
  }
  vault: string
}

async function resolveTarget(
  fixture: TargetFixture,
  action: 'native-reply' | 'reaction',
) {
  return await resolveAssistantAcceptedMessageTarget({
    acceptedInputIds: [fixture.inputId],
    action,
    messageRef: fixture.inputId,
    route: fixture.route,
    vault: fixture.vault,
  })
}

async function resolveParticipant(
  fixture: TargetFixture,
  acceptedInputIds: readonly string[],
  messageRef: string,
) {
  return await resolveAssistantAcceptedMessageParticipant({
    acceptedInputIds,
    messageRef,
    route: fixture.route,
    vault: fixture.vault,
  })
}

async function createTargetFixture(input: {
  actorId?: string
  channel: 'linq' | 'telegram'
  externalThreadRouteAuthorityPresent?: boolean
  messageId: string
  providerThreadTarget?: string
  reactionEligible?: boolean
  senderHandle?: string | null
  service?: string | null
  threadIsDirect?: boolean
  vault?: string
}): Promise<TargetFixture> {
  const context = input.vault
    ? null
    : await createTempVaultContext('assistant-message-target-')
  if (context) {
    tempRoots.push(context.parentRoot)
  }
  const vault = input.vault ?? context!.vaultRoot
  const accountId = 'account-hash'
  const providerThreadTarget = input.providerThreadTarget ?? 'provider-thread'
  const stored = await upsertAssistantInputEvent({
    vault,
    event: {
      content: { text: 'target message' },
      conversation: {
        accountId,
        actorId: input.actorId ?? 'actor-hash',
        actorIsSelf: false,
        source: input.channel,
        threadId: 'thread-hash',
        threadIsDirect: input.threadIsDirect ?? true,
      },
      occurredAt: '2026-07-16T12:00:00.000Z',
      receivedAt: '2026-07-16T12:00:01.000Z',
      replyTarget: {
        channel: input.channel,
        messageId: input.messageId,
        threadId: providerThreadTarget,
      },
      sourceMetadata:
        input.channel === 'linq'
          ? {
              ...(input.externalThreadRouteAuthorityPresent
                ? { externalThreadRouteAuthorityPresent: true }
                : {}),
              kind: 'linq',
              partCount: 1,
              reactionEligible: input.reactionEligible ?? false,
              replyToMessageId: null,
              ...(input.senderHandle !== undefined
                ? { senderHandle: input.senderHandle }
                : {}),
              service: input.service ?? null,
            }
          : {
              ...(input.externalThreadRouteAuthorityPresent
                ? { externalThreadRouteAuthorityPresent: true }
                : {}),
              kind: 'telegram',
              mediaGroupId: null,
              replyContext: null,
              ...(input.senderHandle !== undefined
                ? { senderHandle: input.senderHandle }
                : {}),
            },
      sourceRef: {
        dedupeKey: `dedupe-${input.messageId}`,
        eventId: `event-${input.messageId}`,
        itemId: `item-${input.messageId}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.messageId,
        payloadSchema: 'murph.hosted-payload.v1',
        payloadSource: 'sidecar',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-wake.v1',
      },
    },
  })

  return {
    accountId,
    inputId: stored.inputId,
    route: {
      actorId: input.actorId ?? 'actor-hash',
      bindingDelivery: {
        kind: 'thread',
        target: providerThreadTarget,
      },
      channel: input.channel,
      identityId: input.channel === 'linq' ? accountId : null,
      threadId: 'thread-hash',
      threadIsDirect: input.threadIsDirect ?? true,
    },
    vault,
  }
}
