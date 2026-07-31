import type { Prisma } from '@prisma/client'
import {
  buildHostedExecutionTelegramConversationMessageWake,
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
} from '@murphai/hosted-execution'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock('@/src/lib/hosted-mailbox/store', () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

import {
  appendConsumedHostedGroupReactionMailboxEnvelopeTx,
} from '@/src/lib/hosted-onboarding/group-reaction-mailbox';

describe('appendConsumedHostedGroupReactionMailboxEnvelopeTx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        id: 'mailbox-reaction-1',
        lane: 'conversation',
        laneSeq: '9',
      },
    });
  });

  it('uses the ordinary mailbox append and immediately marks the exact row consumed', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      hostedMailboxItem: { updateMany },
    } as unknown as Prisma.TransactionClient;
    const envelope = buildReactionEnvelope();

    await expect(appendConsumedHostedGroupReactionMailboxEnvelopeTx({
      envelope,
      tx,
    })).resolves.toMatchObject({ inserted: true });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope,
      tx,
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        consumedAt: new Date('2026-07-30T12:00:00.000Z'),
      },
      where: {
        consumedAt: null,
        id: 'mailbox-reaction-1',
        userId: 'member-group-1',
      },
    });
  });

  it('allows an idempotent replay when the existing row is already consumed', async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: {
        id: 'mailbox-reaction-1',
        lane: 'conversation',
        laneSeq: '9',
      },
    });
    const tx = {
      hostedMailboxItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(appendConsumedHostedGroupReactionMailboxEnvelopeTx({
      envelope: buildReactionEnvelope(),
      tx,
    })).resolves.toMatchObject({ duplicate: true, inserted: false });
  });

  it('fails closed on a mailbox dedupe conflict or an unconsumed new row', async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
      item: {
        id: 'mailbox-reaction-1',
        lane: 'conversation',
        laneSeq: '9',
      },
    });
    const tx = {
      hostedMailboxItem: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(appendConsumedHostedGroupReactionMailboxEnvelopeTx({
      envelope: buildReactionEnvelope(),
      tx,
    })).rejects.toThrow('dedupe conflict');

    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValueOnce({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        id: 'mailbox-reaction-2',
        lane: 'conversation',
        laneSeq: '10',
      },
    });
    await expect(appendConsumedHostedGroupReactionMailboxEnvelopeTx({
      envelope: buildReactionEnvelope(),
      tx,
    })).rejects.toThrow('was not consumed');
  });
});

function buildReactionEnvelope() {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId: 'telegram:update:99',
    occurredAt: '2026-07-30T12:00:00.000Z',
    routeAuthority: {
      channel: 'telegram',
      containerMemberId: 'member-group-1',
      threadId: '-1001',
    },
    telegramMessage: {
      messageId: 'telegram:update:99',
      schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
      text: formatHostedExecutionGroupReactionEventText({
        actor: 'telegram-user:42',
        changes: [{ operation: 'added', reaction: '😂' }],
        channel: 'telegram',
        mode: 'delta',
        targetMessageId: '17',
        targetText: null,
      }),
      threadId: '-1001',
      threadIsDirect: false,
    },
    userId: 'member-group-1',
  });
}
