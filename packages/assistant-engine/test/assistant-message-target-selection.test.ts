import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readAssistantTargetProviderScalar,
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
        fixture.route.explicitTarget = 'another-provider-thread'
      },
      () => {
        fixture.route.explicitTarget = 'provider-thread'
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
      explicitTarget: '123:business:business-connection',
      messageId: '55',
    })

    await expect(resolveTarget(fixture, 'native-reply')).resolves.toMatchObject({
      targetInputId: fixture.inputId,
    })
    await expect(resolveTarget(fixture, 'reaction')).rejects.toMatchObject({
      code: 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE',
    })
  })

  it('gates static tool availability on a real conversational route', () => {
    expect(
      supportsAssistantAcceptedMessageTargetingRoute({
        channel: 'telegram',
        explicitTarget: '123',
        threadId: 'thread-hash',
        threadIsDirect: true,
      }),
    ).toBe(true)
    expect(
      supportsAssistantAcceptedMessageTargetingRoute({
        channel: 'linq',
        explicitTarget: 'hid_private',
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
    channel: string
    explicitTarget: string
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

async function createTargetFixture(input: {
  channel: 'linq' | 'telegram'
  explicitTarget?: string
  externalThreadRouteAuthorityPresent?: boolean
  messageId: string
  reactionEligible?: boolean
  service?: string | null
  threadIsDirect?: boolean
}): Promise<TargetFixture> {
  const context = await createTempVaultContext('assistant-message-target-')
  tempRoots.push(context.parentRoot)
  const accountId = 'account-hash'
  const explicitTarget = input.explicitTarget ?? 'provider-thread'
  const stored = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    event: {
      content: { text: 'target message' },
      conversation: {
        accountId,
        actorId: 'actor-hash',
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
        threadId: explicitTarget,
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
              service: input.service ?? null,
            }
          : {
              kind: 'telegram',
              mediaGroupId: null,
              replyContext: null,
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
      actorId: 'actor-hash',
      channel: input.channel,
      explicitTarget,
      identityId: input.channel === 'linq' ? accountId : null,
      threadId: 'thread-hash',
      threadIsDirect: input.threadIsDirect ?? true,
    },
    vault: context.vaultRoot,
  }
}
