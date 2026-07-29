import { rm } from 'node:fs/promises'

import type {
  HostedPhoneCallBrief,
} from '@murphai/hosted-execution/phone-calls'
import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  hasDeliveredAssistantGroupPhoneCallPreview,
  renderAssistantGroupPhoneCallPreview,
  resolveDeliveredAssistantGroupPhoneCallPreviewAuthority,
} from '../src/assistant/group-phone-call-preview-authority.js'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.js'
import {
  createAssistantOutboxIntent,
  markAssistantOutboxIntentSentById,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.js'
import { createTempVaultContext } from './test-helpers.js'

const BRIEF: HostedPhoneCallBrief = {
  allowTransferToUser: false,
  callerName: 'Sam',
  goal: 'Reserve an outdoor table for six on August 15, 2026 at 7:00 p.m.',
  instructions: [
    'Do not accept a deposit above $50.',
    'The deposit must be refundable until 24 hours before the reservation.',
  ],
  shareableFacts: {
    party_size: 'Six people',
    requester_name: 'Sam',
  },
  successCriteria: 'The restaurant confirms the exact reservation and total fee.',
  timeZone: 'America/New_York',
  to: {
    label: 'Public restaurant',
    phoneNumber: '+12025550123',
  },
}

const SESSION_ID = 'session_group_phone_preview'
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      })
    ),
  )
})

describe('group phone-call preview authority', () => {
  it.each(['linq', 'telegram'] as const)(
    'derives %s authority from an exact sent preview that precedes the confirmation',
    async (channel) => {
      const context = await createContext()
      const confirmationInputId = await createConfirmationInput({
        channel,
        receivedAt: '2026-08-01T12:00:10.000Z',
        vault: context.vaultRoot,
      })
      await createPreviewIntent({
        channel,
        sentAt: '2026-08-01T12:00:05.000Z',
        vault: context.vaultRoot,
      })

      await expect(hasDeliveredAssistantGroupPhoneCallPreview({
        acceptedInputIds: [confirmationInputId],
        brief: BRIEF,
        channel,
        confirmationInputId,
        sessionId: SESSION_ID,
        vault: context.vaultRoot,
      })).resolves.toBe(true)
    },
  )

  it.each([
    'pending',
    'retryable',
    'failed',
    'abandoned',
  ] as const)(
    'rejects a %s preview delivery',
    async (status) => {
      const context = await createContext()
      const confirmationInputId = await createConfirmationInput({
        receivedAt: '2026-08-01T12:00:10.000Z',
        vault: context.vaultRoot,
      })
      await createPreviewIntent({
        status,
        vault: context.vaultRoot,
      })

      await expect(hasDeliveredAssistantGroupPhoneCallPreview({
        acceptedInputIds: [confirmationInputId],
        brief: BRIEF,
        channel: 'linq',
        sessionId: SESSION_ID,
        vault: context.vaultRoot,
      })).resolves.toBe(false)
    },
  )

  it('rejects a preview delivered after the confirmation was received', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      sentAt: '2026-08-01T12:00:11.000Z',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it('rejects a confirmation without a transport receipt timestamp', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      receivedAt: null,
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      sentAt: '2026-08-01T12:00:05.000Z',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it('rejects a stale sent preview when a newer revision is not sent', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      createdAt: '2026-08-01T12:00:00.000Z',
      sentAt: '2026-08-01T12:00:05.000Z',
      turnId: 'turn_group_phone_preview_original',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      createdAt: '2026-08-01T12:00:06.000Z',
      status: 'retryable',
      turnId: 'turn_group_phone_preview_revision',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it('rejects a delivered preview whose visible values differ from the call brief', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      message: buildPreviewMessage().replace('$50', '$75'),
      sentAt: '2026-08-01T12:00:05.000Z',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      confirmationInputId,
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it('returns the exact confirming assistant input and hosted mailbox item', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      itemId: 'exact-confirmation-mailbox-item',
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      sentAt: '2026-08-01T12:00:05.000Z',
      vault: context.vaultRoot,
    })

    await expect(resolveDeliveredAssistantGroupPhoneCallPreviewAuthority({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      confirmationInputId,
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toEqual({
      assistantInputId: confirmationInputId,
      inboundMailboxItemId: 'exact-confirmation-mailbox-item',
    })
  })

  it('rejects a referenced confirmation when any newer input has been accepted', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      itemId: 'confirmation-mailbox-item',
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    const cancellationInputId = await createConfirmationInput({
      itemId: 'cancellation-mailbox-item',
      receivedAt: '2026-08-01T12:00:11.000Z',
      text: 'Cancel that request.',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      sentAt: '2026-08-01T12:00:05.000Z',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId, cancellationInputId],
      brief: BRIEF,
      channel: 'linq',
      confirmationInputId,
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it('does not borrow a later unrelated input for a pre-delivery confirmation', async () => {
    const context = await createContext()
    const earlyConfirmationInputId = await createConfirmationInput({
      itemId: 'early-confirmation-mailbox-item',
      receivedAt: '2026-08-01T12:00:04.000Z',
      vault: context.vaultRoot,
    })
    const unrelatedInputId = await createConfirmationInput({
      itemId: 'unrelated-mailbox-item',
      receivedAt: '2026-08-01T12:00:10.000Z',
      text: 'What time does the place close?',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      sentAt: '2026-08-01T12:00:05.000Z',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [earlyConfirmationInputId, unrelatedInputId],
      brief: BRIEF,
      channel: 'linq',
      confirmationInputId: earlyConfirmationInputId,
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it.each([
    {
      name: 'omitted instructions',
      preview: renderAssistantGroupPhoneCallPreview({
        ...BRIEF,
        instructions: [],
      }),
    },
    {
      name: 'emptied shareable facts',
      preview: renderAssistantGroupPhoneCallPreview({
        ...BRIEF,
        shareableFacts: {},
      }),
    },
    {
      name: 'omitted caller and destination label',
      preview: renderAssistantGroupPhoneCallPreview({
        ...BRIEF,
        callerName: undefined,
        to: {
          phoneNumber: BRIEF.to.phoneNumber,
        },
      }),
    },
    {
      name: 'swapped goal and success criteria',
      preview: renderAssistantGroupPhoneCallPreview({
        ...BRIEF,
        goal: BRIEF.successCriteria,
        successCriteria: BRIEF.goal,
      }),
    },
    {
      name: 'swapped fact associations',
      preview: renderAssistantGroupPhoneCallPreview({
        ...BRIEF,
        shareableFacts: {
          party_size: BRIEF.shareableFacts.requester_name!,
          requester_name: BRIEF.shareableFacts.party_size!,
        },
      }),
    },
    {
      name: 'extra contradictory terms',
      preview: `${renderAssistantGroupPhoneCallPreview(BRIEF)}\nDeposit limit: $75`,
    },
  ])('rejects a canonical preview with $name', async ({ preview }) => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      message: preview,
      sentAt: '2026-08-01T12:00:05.000Z',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      confirmationInputId,
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(false)
  })

  it('accepts one exact canonical preview delivered across ordered message bubbles', async () => {
    const context = await createContext()
    const confirmationInputId = await createConfirmationInput({
      receivedAt: '2026-08-01T12:00:10.000Z',
      vault: context.vaultRoot,
    })
    const previewLines = renderAssistantGroupPhoneCallPreview(BRIEF).split('\n')
    await createPreviewIntent({
      createdAt: '2026-08-01T12:00:00.000Z',
      deliveryIdempotencyKey: 'group-preview:bubble:0',
      message: previewLines.slice(0, 5).join('\n'),
      sentAt: '2026-08-01T12:00:05.000Z',
      turnId: 'turn_group_phone_preview_split',
      vault: context.vaultRoot,
    })
    await createPreviewIntent({
      createdAt: '2026-08-01T12:00:01.000Z',
      deliveryIdempotencyKey: 'group-preview:bubble:1',
      message: previewLines.slice(5).join('\n'),
      sentAt: '2026-08-01T12:00:06.000Z',
      turnId: 'turn_group_phone_preview_split',
      vault: context.vaultRoot,
    })

    await expect(hasDeliveredAssistantGroupPhoneCallPreview({
      acceptedInputIds: [confirmationInputId],
      brief: BRIEF,
      channel: 'linq',
      confirmationInputId,
      sessionId: SESSION_ID,
      vault: context.vaultRoot,
    })).resolves.toBe(true)
  })
})

async function createContext(): Promise<{
  vaultRoot: string
}> {
  const context = await createTempVaultContext(
    'assistant-group-phone-preview-authority-',
  )
  tempRoots.push(context.parentRoot)
  return { vaultRoot: context.vaultRoot }
}

async function createConfirmationInput(input: {
  channel?: 'linq' | 'telegram'
  itemId?: string
  receivedAt: string | null
  text?: string
  vault: string
}): Promise<string> {
  const channel = input.channel ?? 'linq'
  const itemId = input.itemId ?? 'confirmation-mailbox-item'
  const occurredAt = input.receivedAt ?? '2026-08-01T12:00:10.000Z'
  const event = await upsertAssistantInputEvent({
    event: {
      content: {
        attachmentDescriptors: [],
        text: input.text ?? 'I confirm the exact delivered group call preview.',
      },
      conversation: {
        accountId: 'linq-account',
        actorId: 'requester-member',
        actorIsSelf: false,
        source: channel,
        threadId: 'group-thread',
        threadIsDirect: false,
      },
      occurredAt,
      receivedAt: input.receivedAt,
      sourceMetadata: channel === 'linq'
        ? {
            kind: 'linq',
            partCount: 1,
            reactionEligible: true,
            replyToMessageId: null,
            service: 'iMessage',
          }
        : {
            kind: 'telegram',
            mediaGroupId: null,
            replyContext: null,
          },
      sourceRef: {
        dedupeKey: `${itemId}-dedupe`,
        eventId: `${itemId}-event`,
        itemId,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.receivedAt ?? '2',
        payloadSchema: 'murph.hosted-payload.v1',
        payloadSource: 'sidecar',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-wake.v1',
      },
    },
    vault: input.vault,
  })
  return event.inputId
}

async function createPreviewIntent(input: {
  channel?: 'linq' | 'telegram'
  createdAt?: string
  deliveryIdempotencyKey?: string
  message?: string
  sentAt?: string
  status?: Exclude<AssistantOutboxIntent['status'], 'sent'>
  turnId?: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  const channel = input.channel ?? 'linq'
  const intent = await createAssistantOutboxIntent({
    answeredMailboxItemIds: ['request-mailbox-item'],
    channel,
    createdAt: input.createdAt ?? '2026-08-01T12:00:00.000Z',
    dedupeToken:
      input.deliveryIdempotencyKey
      ?? input.turnId
      ?? 'turn_group_phone_preview',
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    explicitTarget: 'group-thread',
    identityId: 'group-assistant',
    message: input.message ?? buildPreviewMessage(),
    sessionId: SESSION_ID,
    threadId: 'group-thread',
    threadIsDirect: false,
    turnId: input.turnId ?? 'turn_group_phone_preview',
    vault: input.vault,
  })
  if (input.sentAt) {
    const sent = await markAssistantOutboxIntentSentById({
      delivery: {
        channel,
        idempotencyKey: null,
        messageLength: intent.message.length,
        providerMessageId: `provider-${intent.intentId}`,
        providerThreadId: 'group-thread',
        sentAt: input.sentAt,
        target: 'group-thread',
        targetKind: 'thread',
      },
      intentId: intent.intentId,
      vault: input.vault,
    })
    if (!sent) {
      throw new Error('Expected the preview intent to exist.')
    }
    return sent
  }
  if (input.status && input.status !== 'pending') {
    return await saveAssistantOutboxIntent(input.vault, {
      ...intent,
      status: input.status,
      updatedAt: '2026-08-01T12:00:05.000Z',
    })
  }
  return intent
}

function buildPreviewMessage(): string {
  return renderAssistantGroupPhoneCallPreview(BRIEF)
}
